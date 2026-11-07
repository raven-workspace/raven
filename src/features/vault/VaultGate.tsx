import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../../lib/api";
import { onLockedError, reportError } from "../../lib/lockSignal";
import { useCaptureStore } from "../capture/useCaptureStore";
import { useCredPickStore } from "../checklist/credPick";
import { useFindingDraftStore } from "../findings/useFindingDraftStore";
import { discardNotes, flushNotes, hasPendingNotes, sessionGeneration, setNotesQueryClient, startNotesSession } from "../notes/useNotesStore";
import type { UnlockResult, VaultStatus } from "../../types/vault";
import { Button, TitleBar, TitleBarButton } from "../../ui";
import { SetupScreen } from "./SetupScreen";
import { UnlockScreen } from "./UnlockScreen";
import { setImported } from "../../engines/library/store";
import { applySnapshot, FIELD_MANUAL_KEY, useVaultNewer } from "../fieldManual/queries";
import { useAutoLock } from "./useAutoLock";
import { clearSecretClipboard } from "../../lib/clipboard";
import { isDialogOpen } from "../../lib/keys";
import { ArsenalDrawer } from "../arsenal/ArsenalDrawer";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useLastEngagementStore } from "../arsenal/useFillScope";
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

  const onUnlocked = (r: UnlockResult) => {
    clearTimeout(retryTimer.current);
    startNotesSession();
    setLockRetrying(false);
    setNotice(r.migratedFrom < r.migratedTo ? "Updated Raven's data (backup saved)" : null);
    setBackupError(r.dailyBackupError);
    setStatus({ exists: true, unlocked: true });
  };

  const right = unlocked ? (
    <>
      <Link
        to="/settings"
        title={vaultNewer ? "The Field Manual has changes to import" : undefined}
        className="relative rounded-sm px-2 py-1 text-xs text-muted-2 hover:text-fg"
      >
        Settings
        {vaultNewer && <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
      </Link>
      <TitleBarButton hint="A" onClick={() => useArsenalStore.getState().toggle()}>Arsenal</TitleBarButton>
      <TitleBarButton hint="⌘K" onClick={() => usePaletteStore.getState().open()}>Search</TitleBarButton>
      <TitleBarButton hint="⌘L" onClick={lock}>Lock</TitleBarButton>
    </>
  ) : undefined;

  let body: ReactNode = null;
  if (loadFailed) {
    body = (
      <main className="flex h-full items-center justify-center px-6">
        <div className="flex w-[320px] flex-col items-start gap-3">
          <p className="m-0 text-[13px] text-fg-2">Raven couldn't check its data.</p>
          <Button onClick={() => void retryLoad()} disabled={retrying} aria-busy={retrying}>
            {retrying ? "Trying…" : "Try again"}
          </Button>
        </div>
      </main>
    );
  } else if (status && !status.exists) body = <SetupScreen onCreated={refresh} />;
  else if (status && !status.unlocked) body = <UnlockScreen onUnlocked={onUnlocked} notice={lockRetrying ? "Couldn't lock fully — Raven is retrying" : undefined} />;
  else if (status) {
    body = (
      <VaultContext.Provider value={ctx}>
        {(notice || backupError) && (
          <div className="flex items-start gap-2 border-b border-line px-4 py-1.5 text-xs text-muted">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {notice && <p className="m-0">{notice}</p>}
              {backupError && <p className="m-0">Daily backup failed: {backupError}</p>}
            </div>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => {
                setNotice(null);
                setBackupError(null);
              }}
              className="shrink-0 cursor-default rounded-sm px-1 text-muted-2 hover:text-fg"
            >
              ×
            </button>
          </div>
        )}
        {children}
        <Palette />
        <ArsenalDrawer />
      </VaultContext.Provider>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <TitleBar
        left={
          unlocked ? (
            <Link to="/" className="rounded-sm px-1 py-0.5 text-xs font-semibold text-fg-2 hover:text-fg">
              Raven
            </Link>
          ) : undefined
        }
        title={unlocked ? undefined : "Raven"}
        right={right}
      />
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  );
}
