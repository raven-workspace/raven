import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../../lib/api";
import { onLockedError, reportError } from "../../lib/lockSignal";
import { useCaptureStore } from "../capture/useCaptureStore";
import { useCredPickStore } from "../checklist/credPick";
import { discardNotes, flushNotes, hasPendingNotes, sessionGeneration, setNotesQueryClient, startNotesSession } from "../notes/useNotesStore";
import type { UnlockResult, VaultStatus } from "../../types/vault";
import { Button, Kbd, TitleBar } from "../../ui";
import { SetupScreen } from "./SetupScreen";
import { UnlockScreen } from "./UnlockScreen";
import { useAutoLock } from "./useAutoLock";
import { clearSecretClipboard } from "../../lib/clipboard";

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
    // Which credential fills commands is session state too.
    useCredPickStore.getState().reset();
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
      <Link to="/settings" className="rounded-sm px-2 py-1 text-xs text-muted-2 hover:text-fg">
        Settings
      </Link>
      <Button size="sm" onClick={lock} aria-label="Lock">
        Lock <Kbd>⌘L</Kbd>
      </Button>
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
          <div className="flex flex-col gap-0.5 border-b border-line px-4 py-1.5 text-xs text-muted">
            {notice && <p className="m-0">{notice}</p>}
            {backupError && <p className="m-0">Daily backup failed: {backupError}</p>}
          </div>
        )}
        {children}
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
