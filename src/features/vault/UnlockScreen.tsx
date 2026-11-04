import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import type { BackupInfo } from "../../types/backup";
import type { UnlockResult } from "../../types/vault";
import { Button, Chip, Field, Input } from "../../ui";

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

type OnUnlocked = (r: UnlockResult) => void;

export function UnlockScreen({ onUnlocked, notice }: { onUnlocked: OnUnlocked; notice?: string | undefined }) {
  const [damaged, setDamaged] = useState(false);
  const [restored, setRestored] = useState(false);

  if (damaged) {
    return (
      <DamagedPanel
        onRestored={() => {
          setRestored(true);
          setDamaged(false);
        }}
      />
    );
  }
  return (
    <UnlockForm
      onUnlocked={onUnlocked}
      onDamaged={() => {
        setRestored(false);
        setDamaged(true);
      }}
      notice={restored ? "Restored. Unlock to continue." : notice}
    />
  );
}

/** The password form. Remounted after a restore, so the field starts empty. */
function UnlockForm({
  onUnlocked,
  onDamaged,
  notice,
}: {
  onUnlocked: OnUnlocked;
  onDamaged: () => void;
  notice: string | undefined;
}) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || pw === "") return;
    setBusy(true);
    try {
      const result = await api.vaultUnlock(pw);
      onUnlocked(result);
    } catch (err) {
      const code = (err as { code?: string }).code;
      setBusy(false);
      if (code === "damaged") {
        onDamaged();
        return;
      }
      setError(code === "wrong_password" ? "Wrong password" : errorText(err, "Couldn't unlock"));
      ref.current?.focus();
    }
  }

  return (
    <main className="flex h-full items-center justify-center px-6">
      <form onSubmit={submit} className="flex w-[320px] flex-col gap-4">
        <h1 className="m-0 text-lg font-semibold text-fg">Raven</h1>
        <Field label="Password" error={error ?? undefined}>
          <Input
            ref={ref}
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setError(null);
            }}
          />
        </Field>
        {notice && <p className="m-0 text-xs text-muted">{notice}</p>}
        <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </main>
  );
}

/** Replaces the unlock form when Raven can't read its database: pick a backup, enter its password. */
function DamagedPanel({ onRestored }: { onRestored: () => void }) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    api.backupsList().then(
      (list) => {
        if (!live) return;
        // The backend lists newest first; keep that order explicitly.
        const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
        setBackups(sorted);
        setFile(sorted[0]?.file ?? null);
      },
      (err: unknown) => live && setListError(errorText(err, "Couldn't list backups")),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  function choose(f: string) {
    setFile(f);
    setError(null);
  }

  /** Arrow keys move the choice, as in a native radio group. */
  function onBackupKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!backups?.length) return;
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = backups.findIndex((b) => b.file === file);
    const n = (i + step + backups.length) % backups.length;
    choose(backups[n]!.file);
    (e.currentTarget.children[n] as HTMLElement | undefined)?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || file === null || pw === "") return;
    setBusy(true);
    try {
      await api.backupRestoreLocked(file, pw);
      onRestored();
    } catch (err) {
      setError(errorText(err, "Couldn't restore"));
      setBusy(false);
      ref.current?.focus();
    }
  }

  return (
    <main className="flex h-full items-center justify-center px-6">
      <form onSubmit={submit} className="flex w-[420px] flex-col gap-4">
        <h1 className="m-0 text-lg font-semibold text-fg">Raven</h1>
        <p className="m-0 text-[13px] text-fg-2">Raven can't read its database file. Restore a backup to continue.</p>
        {listError && (
          <div className="flex items-center gap-3">
            <p className="m-0 text-xs text-warn">{listError}</p>
            <Button
              size="sm"
              onClick={() => {
                setListError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {backups && backups.length === 0 && <p className="m-0 text-xs text-muted">No backups yet</p>}
        {backups && backups.length > 0 && (
          <div
            role="radiogroup"
            aria-label="Backup"
            onKeyDown={onBackupKey}
            className="m-0 flex max-h-64 flex-col overflow-y-auto rounded-sm border border-line"
          >
            {backups.map((b) => {
              const on = file === b.file;
              return (
                <button
                  key={b.file}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => choose(b.file)}
                  className={cx(
                    "flex cursor-default items-center gap-3 border-b border-line px-2.5 py-2 text-left last:border-b-0 focus-visible:outline-1 focus-visible:outline-accent",
                    on ? "bg-surface text-fg" : "text-fg-2 hover:bg-surface",
                  )}
                >
                  <span
                    aria-hidden
                    className={cx("size-1.5 shrink-0 rounded-full", on ? "bg-fg" : "border border-line-2")}
                  />
                  <span className="font-mono text-xs">{new Date(b.createdAt).toLocaleString()}</span>
                  <Chip>{b.reason}</Chip>
                </button>
              );
            })}
          </div>
        )}
        <Field label="Password" error={error ?? undefined}>
          <Input
            ref={ref}
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || file === null} aria-busy={busy}>
          {busy ? "Restoring…" : "Restore"}
        </Button>
      </form>
    </main>
  );
}
