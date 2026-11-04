import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../../lib/api";
import type { UnlockResult, VaultStatus } from "../../types/vault";
import { Button, Kbd, TitleBar } from "../../ui";
import { SetupScreen } from "./SetupScreen";
import { UnlockScreen } from "./UnlockScreen";
import { useAutoLock } from "./useAutoLock";

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

  const refresh = useCallback(async () => {
    setStatus(await api.vaultStatus());
  }, []);

  useEffect(() => {
    let live = true;
    void api.vaultStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);

  const unlocked = status?.unlocked === true;

  const markLocked = useCallback(() => {
    qc.clear();
    setNotice(null);
    setBackupError(null);
    setStatus((s) => (s ? { ...s, unlocked: false } : s));
  }, [qc]);

  const lock = useCallback(() => {
    // The UI locks even if the backend call fails: never leave data on screen.
    void api.vaultLock().catch(() => undefined);
    markLocked();
  }, [markLocked]);

  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet, enabled: unlocked });
  useAutoLock(settings.data?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES, { enabled: unlocked, onLock: lock });

  const ctx = useMemo(() => ({ lock, markLocked }), [lock, markLocked]);

  const onUnlocked = (r: UnlockResult) => {
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
  if (status && !status.exists) body = <SetupScreen onCreated={() => void refresh()} />;
  else if (status && !status.unlocked) body = <UnlockScreen onUnlocked={onUnlocked} />;
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
      <TitleBar title="Raven" right={right} />
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  );
}
