import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenText, Gear, Lock, MagnifyingGlass, Package, Stack, X } from "@phosphor-icons/react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../../lib/api";
import { onLockedError, reportError } from "../../../lib/lockSignal";
import { useSaveSummaryStore } from "../../capture/useSaveSummaryStore";
import { useCaptureStore } from "../../capture/useCaptureStore";
import { useCredPickStore } from "../../checklist/credPick";
import { useFindingDraftStore } from "../../findings/useFindingDraftStore";
import { discardReports, flushReports, hasPendingReports } from "../../report/saveQueue";
import { discardNotes, flushNotes, hasPendingNotes, sessionGeneration, setNotesQueryClient, startNotesSession } from "../../notes/useNotesStore";
import type { UnlockResult, VaultStatus } from "../../../types/vault";
import { Button, IconButton, TitleBar, TitleBarButton, TitleBarGroup, TitleBarIconButton, TitleBarShortcuts, type Hint, Wordmark } from "../../../ui/index";
import { SetupScreen } from "../SetupScreen/SetupScreen";
import { UnlockScreen, type CipherControls } from "../UnlockScreen/UnlockScreen";
import { CipherBackdrop, type CipherHandle } from "../CipherBackdrop/CipherBackdrop";
import { freezeCopy, type FrozenCopy } from "../frozenCopy";
import { setImported } from "../../../engines/library/store";
import { applySnapshot, cacheFieldManual, useVaultNewer } from "../../fieldManual/queries";
import { useAutoLock } from "../useAutoLock";
import { clearSecretClipboard } from "../../../lib/clipboard";
import { isDialogOpen, isFreeKey, useKeydown } from "../../../lib/keys";
import { matches, SHORTCUTS } from "../../../lib/shortcuts";
import { SaveSummary } from "../../capture/SaveSummary/SaveSummary";
import { ArsenalDrawer } from "../../arsenal/ArsenalDrawer/ArsenalDrawer";
import { MANUAL_NOTE_ID, manualKeysBlocked } from "../../manual/keys";
import { useArsenalStore } from "../../arsenal/useArsenalStore";
import { useLastEngagementStore } from "../../arsenal/useFillScope";
import { PayloadsDrawer } from "../../payloads/PayloadsDrawer/PayloadsDrawer";
import { usePayloadsStore } from "../../payloads/usePayloadsStore";
import { Palette } from "../../palette/Palette/Palette";
import { usePaletteStore } from "../../palette/usePaletteStore";
import { useSettings } from "../../settings/queries";
import { prefersReducedMotion } from "../../../ui/motion";
import "../screens.scss";
import "./VaultGate.scss";

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
/** The lock's reverse sweep takes about half a second; past this the frozen copy goes regardless. */
const CLOSE_MAX_MS = 1500;

/** How long the unlock notice (e.g. "backup saved") stays before it clears itself. A failure stays until dismissed. */
const NOTICE_MS = 8000;

/** Keys that work on every unlocked screen, listed under the title bar's shortcuts button after the page's own. */
const EVERYWHERE: Hint[] = [
  { keys: "A", label: "Arsenal", priority: 1 },
  { keys: "M", label: "Manual", priority: 1 },
  { keys: "P", label: "Payloads", priority: 1 },
  { keys: SHORTCUTS.search, label: "search", priority: 1 },
  { keys: SHORTCUTS.lock, label: "lock", priority: 1 },
];

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
    // Queued report writes too: `lock()` has already started sending them.
    discardReports();
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
      // Field notes and report pages are saved before the backend locks. If a save failed the text is
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

  // The lock's reverse sweep: the cipher field closes in over a frozen copy of the app (see frozenCopy).
  const bodyRef = useRef<HTMLDivElement>(null);
  const frozenHostRef = useRef<HTMLDivElement>(null);
  const frozen = useRef<FrozenCopy | null>(null);
  const [closing, setClosing] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const endClose = useCallback(() => {
    frozen.current = null;
    setClosing(false);
  }, []);
  useLayoutEffect(() => {
    if (!closing) return;
    const host = frozenHostRef.current;
    const copy = frozen.current;
    if (host && copy) {
      host.append(copy.el);
      copy.restoreScroll();
    }
    const t = setTimeout(endClose, CLOSE_MAX_MS);
    return () => clearTimeout(t);
  }, [closing, endClose]);

  const lock = useCallback(() => {
    // The UI locks at once, never leaving data on screen; the backend lock is
    // retried until the backend confirms it. Only a frozen, inert picture of the screen stays for the reverse
    // sweep to close over, auto-lock included (owner call: macOS locks with the display, so after wake the Mac's
    // own password comes first). Never while hidden (it would wait there) or mid-unlock-sweep.
    const body = bodyRef.current;
    const animate = !sweeping && !document.hidden && !prefersReducedMotion();
    const copy = body && animate ? freezeCopy(body) : null;
    // Start saving notes first: markLocked clears them from the store.
    // Report writes too (the Report view's unmount flush would run after the backend locked).
    const notesSaved = hasPendingNotes() ? flushNotes().catch(reportError) : undefined;
    const reportsSaved = hasPendingReports() ? flushReports() : undefined;
    const saved = notesSaved && reportsSaved ? Promise.all([notesSaved, reportsSaved]).then(() => undefined) : (notesSaved ?? reportsSaved);
    markLocked();
    void lockBackend(saved);
    if (copy) {
      frozen.current = copy;
      setClosing(true);
    }
  }, [markLocked, lockBackend, sweeping]);

  const settings = useSettings(unlocked);
  useAutoLock(settings.data?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES, { enabled: unlocked, onLock: lock });

  // ⌘K: the palette, from anywhere while unlocked (capture phase, like ⌘L). Never over another dialog.
  useEffect(() => {
    if (!unlocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matches(SHORTCUTS.search, e)) return;
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
        cacheFieldManual(qc, snap);
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
    endClose();
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
      <TitleBarButton hint={SHORTCUTS.search} icon={MagnifyingGlass} onClick={() => usePaletteStore.getState().open()}>Search</TitleBarButton>
      <TitleBarGroup>
        <TitleBarShortcuts everywhere={EVERYWHERE} />
        <TitleBarIconButton icon={Lock} label="Lock" shortcut={SHORTCUTS.lock} onClick={() => lock()} />
        <span
          title={vaultNewer ? "The Field Manual has changes to import" : undefined}
          className="vault-gate__settings"
        >
          <TitleBarIconButton icon={Gear} label="Settings" current={pathname === "/settings"} onClick={() => navigate("/settings")} />
          {vaultNewer && <span aria-hidden="true" className="vault-gate__settings-dot" />}
        </span>
      </TitleBarGroup>
    </>
  ) : undefined;

  const showCipher = (!!status && !unlocked && !loadFailed && !calm) || sweeping || closing;

  let body: ReactNode = null;
  if (loadFailed) {
    body = (
      <main className="vault-screen">
        <div className="vault-screen__load-error">
          <p className="vault-screen__text">Raven couldn't check its data.</p>
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
          <div className="vault-gate__notice">
            <div className="vault-gate__notice-lines">
              {notice && <p>{notice}</p>}
              {backupError && <p>Daily backup failed: {backupError}</p>}
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
    <div className="vault-gate">
      <TitleBar
        left={
          unlocked ? (
            <Link to="/" className="vault-gate__home">
              <Wordmark className="vault-gate__wordmark" />
            </Link>
          ) : undefined
        }
        // Setup and unlock carry the wordmark themselves; only the load error needs this one.
        title={!unlocked && (!status || loadFailed) ? <Wordmark className="vault-gate__wordmark" /> : undefined}
        right={right}
      />
      <div className="vault-gate__stage">
        {showCipher && <CipherBackdrop ref={cipherRef} front={sweeping || closing} onClosed={closing ? endClose : undefined} />}
        {closing && <div ref={frozenHostRef} aria-hidden="true" className="vault-gate__frozen" />}
        <div ref={bodyRef} className="vault-gate__body">{body}</div>
      </div>
    </div>
  );
}
