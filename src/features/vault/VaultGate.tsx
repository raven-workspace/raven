import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenText, Gear, Lock, MagnifyingGlass, Package, Stack, X } from "@phosphor-icons/react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../lib/api";
import { onLockedError, reportError } from "../../lib/lockSignal";
import { useSaveSummaryStore } from "../capture/useSaveSummaryStore";
import { useCaptureStore } from "../capture/useCaptureStore";
import { useCredPickStore } from "../checklist/credPick";
import { useFindingDraftStore } from "../findings/useFindingDraftStore";
import { discardNotes, flushNotes, hasPendingNotes, sessionGeneration, setNotesQueryClient, startNotesSession } from "../notes/useNotesStore";
import type { UnlockResult, VaultStatus } from "../../types/vault";
import { Button, IconButton, TitleBar, TitleBarButton, TitleBarGroup, TitleBarIconButton, Wordmark } from "../../ui";
import { SetupScreen } from "./SetupScreen";
import { UnlockScreen, type CipherControls } from "./UnlockScreen";
import { CipherBackdrop, type CipherHandle } from "./CipherBackdrop";
import { setImported } from "../../engines/library/store";
import { applySnapshot, FIELD_MANUAL_KEY, useVaultNewer } from "../fieldManual/queries";
import { useAutoLock } from "./useAutoLock";
import { clearSecretClipboard } from "../../lib/clipboard";
import { isDialogOpen, isFreeKey, useKeydown } from "../../lib/keys";
import { SaveSummary } from "../capture/SaveSummary";
import { ArsenalDrawer } from "../arsenal/ArsenalDrawer";
import { MANUAL_NOTE_ID, manualKeysBlocked } from "../manual/keys";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useLastEngagementStore } from "../arsenal/useFillScope";
import { PayloadsDrawer } from "../payloads/PayloadsDrawer";
import { usePayloadsStore } from "../payloads/usePayloadsStore";
import { Palette } from "../palette/Palette";
import { usePaletteStore } from "../palette/usePaletteStore";

interface VaultContextValue {
  /** Locks the vault now (same path as ⌘L and the idle timer). */
  lock: () => void;
  /** The backend already locked (e.g. after a restore): only move the UI. */
  markLocked: () => void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used inside VaultGate");
  return ctx;
}

const DEFAULT_AUTO_LOCK_MINUTES = 30;
const LOCK_RETRY_MS = 2000;
/** How long the unlock notice (e.g. "backup saved") stays before it clears itself. A failure stays until dismissed. */
const NOTICE_MS = 8000;

/**
 * Setup when there is no vault, unlock when locked, children when unlocked.
 * Renders the TitleBar on every screen. Locking clears the query cache and
 * unmounts the children, so open dialogs and drafts are discarded.
 */
export function VaultGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  /** Never throws: a failure shows the "Try again" line instead of a blank window. */
  const refresh = useCallback(async () => {
    try {
      const s = await api.vaultStatus();
      setStatus(s);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    let live = true;
    api.vaultStatus().then(
      (s) => live && setStatus(s),
      () => live && setLoadFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const retryLoad = async () => {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  };

  const unlocked = status?.unlocked === true;

  const markLocked = useCallback(() => {
    qc.clear();
    // Unsaved capture drafts hold engagement data: they go with the lock.
    useCaptureStore.getState().reset();
    useSaveSummaryStore.getState().close();
    // Finding drafts too: they live in memory only and never outlive the session.
    useFindingDraftStore.getState().clearAll();
    // Which credential fills commands is session state too.
    useCredPickStore.getState().reset();
    // So is the engagement full-screen Arsenal remembers.
    useLastEngagementStore.setState({ engagementId: null, hostId: null });
    // Notes too: after a lock no note text stays in memory. `lock()` has already started the
    // flush, which works from a snapshot.
    discardNotes();
    // A copied secret must not outlive the lock.
    void clearSecretClipboard().catch(() => {});
    setNotice(null);
    setBackupError(null);
    setStatus((s) => (s ? { ...s, unlocked: false } : s));
  }, [qc]);

  // Any command that answers `locked` means the backend is already locked: move the UI.
  useEffect(() => (unlocked ? onLockedError(markLocked) : undefined), [unlocked, markLocked]);

  const [lockRetrying, setLockRetrying] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  useEffect(() => {
    setNotesQueryClient(qc);
    return () => setNotesQueryClient(null);
  }, [qc]);

  const lockBackend = useCallback(async function run(notesSaved?: Promise<void>): Promise<void> {
    clearTimeout(retryTimer.current);
    let gen = sessionGeneration();
    if (notesSaved) {
      // Field notes are saved before the backend locks. If that save failed the text is
      // dropped anyway (see markLocked); a failed save must not keep the vault open.
      await notesSaved;
      // Only if no unlock happened meanwhile, so a quick re-unlock isn't wiped.
      if (gen === sessionGeneration()) {
        discardNotes();
        qc.clear();
        // discardNotes() starts a new generation; follow it so the clear after vaultLock still runs.
        gen = sessionGeneration();
      }
    }
    // Once the backend is locked, clear the cache again: a mutation that finished while the notes flushed or the
    // lock ran may have written to it. Only if no unlock happened meanwhile.
    const locked = () => {
      setLockRetrying(false);
      if (gen === sessionGeneration()) qc.clear();
    };
    for (let i = 0; i < 3; i++) {
      try {
        await api.vaultLock();
        locked();
        return;
      } catch {
        // retry
      }
    }
    const st = await api.vaultStatus().catch(() => null);
    if (st && !st.unlocked) {
      locked();
      return;
    }
    setLockRetrying(true);
    retryTimer.current = setTimeout(() => void run(), LOCK_RETRY_MS);
  }, [qc]);

  const lock = useCallback(() => {
    // The UI locks at once, never leaving data on screen; the backend lock is
    // retried until the backend confirms it.
    // Start saving notes first: markLocked clears them from the store.
    const notesSaved = hasPendingNotes() ? flushNotes().catch(reportError) : undefined;
    markLocked();
    void lockBackend(notesSaved);
  }, [markLocked, lockBackend]);

  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet, enabled: unlocked });
  useAutoLock(settings.data?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES, { enabled: unlocked, onLock: lock });

  // ⌘K: the palette, from anywhere while unlocked (capture phase, like ⌘L). Never over another dialog.
  useEffect(() => {
    if (!unlocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      const palette = usePaletteStore.getState();
      if (palette.isOpen) palette.close();
      else if (!isDialogOpen()) palette.open();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      usePaletteStore.getState().close();
    };
  }, [unlocked]);

  const vaultNewer = useVaultNewer(unlocked);
  // Layer the last import over the built-in library once the vault is open.
  useEffect(() => {
    if (!unlocked) return;
    let live = true;
    void (async () => {
      try {
        const snap = await api.fieldManualLoad();
        if (!live) return;
        if (!snap) {
          if (snap === null) setImported({ commands: [], cards: [] }); // no stale imported layer after a restore
          return;
        }
        applySnapshot(snap);
        qc.setQueryData(FIELD_MANUAL_KEY, snap);
      } catch {
        /* the built-ins still work; Settings › Field Manual reports import problems */
      }
    })();
    return () => {
      live = false;
    };
  }, [unlocked, qc]);

  // The unlock notice is news, not state: it clears itself.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const ctx = useMemo(() => ({ lock, markLocked }), [lock, markLocked]);

  // The lock screen's ciphertext field. It outlives the unlock form by one sweep, which reveals the app.
  const cipherRef = useRef<CipherHandle>(null);
  const [calm, setCalm] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const cipher = useMemo<CipherControls>(() => ({ pulse: (k) => cipherRef.current?.pulse(k), setCalm }), []);

  /** The unlock sweep. Start it while the password field is still on screen: it's where the sweep starts from. */
  const startSweep = () => {
    const sweep = cipherRef.current?.sweep();
    if (!sweep) return;
    setSweeping(true);
    void sweep.then(() => setSweeping(false));
  };

  // Creating the vault leaves it open, so setup ends in the same sweep as an unlock.
  const onCreated = async () => {
    startSweep();
    await refresh();
  };

  const onUnlocked = (r: UnlockResult) => {
    startSweep();
    clearTimeout(retryTimer.current);
    startNotesSession();
    setLockRetrying(false);
    setNotice(r.migratedFrom < r.migratedTo ? "Updated Raven's data (backup saved)" : null);
    setBackupError(r.dailyBackupError);
    setStatus({ exists: true, unlocked: true });
  };

  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onManual = pathname === "/manual" || pathname.startsWith("/manual/");
  /** The Manual at the remembered place; on the Manual, the note pane takes focus instead. */
  const openManual = () => {
    if (onManual) document.getElementById(MANUAL_NOTE_ID)?.focus();
    else void navigate("/manual");
  };
  // M opens the Manual from any unlocked screen: never while typing, or with a drawer or dialog open.
  useKeydown((e) => {
    if (!unlocked || !isFreeKey(e) || (e.key !== "m" && e.key !== "M") || manualKeysBlocked()) return;
    e.preventDefault();
    openManual();
  });
  const arsenalOpen = useArsenalStore((s) => s.open);
  const payloadsOpen = usePayloadsStore((s) => s.open);
  const right = unlocked ? (
    <>
      {/* References, then search, then the app itself (lock, settings): runs set apart by space. */}
      <TitleBarGroup>
        <TitleBarButton hint="A" icon={Stack} open={arsenalOpen} onClick={() => useArsenalStore.getState().toggle()}>Arsenal</TitleBarButton>
        <TitleBarButton hint="M" icon={BookOpenText} current={onManual} onClick={openManual}>Manual</TitleBarButton>
        <TitleBarButton hint="P" icon={Package} open={payloadsOpen} onClick={() => usePayloadsStore.getState().toggle()}>Payloads</TitleBarButton>
      </TitleBarGroup>
      <TitleBarButton hint="⌘K" icon={MagnifyingGlass} onClick={() => usePaletteStore.getState().open()}>Search</TitleBarButton>
      <TitleBarGroup>
        <TitleBarIconButton icon={Lock} label="Lock" shortcut="⌘L" onClick={lock} />
        <span
          title={vaultNewer ? "The Field Manual has changes to import" : undefined}
          className="relative grid"
        >
          <TitleBarIconButton icon={Gear} label="Settings" current={pathname === "/settings"} onClick={() => navigate("/settings")} />
          {vaultNewer && <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
        </span>
      </TitleBarGroup>
    </>
  ) : undefined;

  const showCipher = (!!status && !unlocked && !loadFailed && !calm) || sweeping;

  let body: ReactNode = null;
  if (loadFailed) {
    body = (
      <main className="grid h-full place-items-center px-6">
        <div className="grid w-[320px] justify-items-start gap-3">
          <p className="m-0 text-meta text-fg-2">Raven couldn't check its data.</p>
          <Button onClick={() => void retryLoad()} disabled={retrying} aria-busy={retrying}>
            {retrying ? "Trying…" : "Try again"}
          </Button>
        </div>
      </main>
    );
  } else if (status && !status.exists) body = <SetupScreen onCreated={onCreated} cipher={cipher} />;
  else if (status && !status.unlocked) {
    body = (
      <UnlockScreen
        onUnlocked={onUnlocked}
        notice={lockRetrying ? "Couldn't lock fully, Raven is retrying" : undefined}
        cipher={cipher}
      />
    );
  }
  else if (status) {
    body = (
      <VaultContext.Provider value={ctx}>
        {(notice || backupError) && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line px-4 py-1 text-meta text-muted">
            <div className="grid min-w-0 gap-1">
              {notice && <p className="m-0">{notice}</p>}
              {backupError && <p className="m-0">Daily backup failed: {backupError}</p>}
            </div>
            <IconButton
              icon={X}
              label="Dismiss notice"
              onClick={() => {
                setNotice(null);
                setBackupError(null);
              }}
            />
          </div>
        )}
        {children}
        <Palette />
        <ArsenalDrawer />
        <PayloadsDrawer />
        <SaveSummary />
      </VaultContext.Provider>
    );
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] bg-bg">
      <TitleBar
        left={
          unlocked ? (
            <Link to="/" className="-ml-1 grid h-7 items-center rounded-sm px-1 opacity-90 hover:opacity-100">
              <Wordmark className="h-3" />
            </Link>
          ) : undefined
        }
        // Setup and unlock carry the wordmark themselves; only the load error needs this one.
        title={!unlocked && (!status || loadFailed) ? <Wordmark className="h-3" /> : undefined}
        right={right}
      />
      <div className="relative min-h-0">
        {showCipher && <CipherBackdrop ref={cipherRef} front={sweeping} />}
        <div className="relative h-full overflow-auto">{body}</div>
      </div>
    </div>
  );
}
