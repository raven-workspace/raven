import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../../../lib/api";
import type { BackupInfo } from "../../../types/backup";
import type { UnlockResult } from "../../../types/vault";
import { Button, Chip, Field, Input, Wordmark } from "../../../ui/index";
import { CIPHER_CLEAR, CIPHER_ORIGIN } from "../CipherBackdrop/CipherBackdrop";
import type { PulseKind } from "../cipherField";
import { DecodingWordmark } from "../DecodingWordmark/DecodingWordmark";
import { prefersReducedMotion } from "../../../ui/motion";
import "../screens.scss";

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

type OnUnlocked = (r: UnlockResult) => void;

/** The ciphertext field behind the form (see CipherBackdrop). */
export interface CipherControls {
  pulse: (kind: PulseKind) => void;
  /** Hides the field: a damaged database is a recovery moment, not a show. */
  setCalm: (calm: boolean) => void;
}

const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-4px)" },
  { transform: "translateX(4px)" },
  { transform: "translateX(-2px)" },
  { transform: "translateX(0)" },
];

export function UnlockScreen({
  onUnlocked,
  notice,
  cipher,
}: {
  onUnlocked: OnUnlocked;
  notice?: string | undefined;
  cipher?: CipherControls | undefined;
}) {
  const [damaged, setDamaged] = useState(false);
  const [restored, setRestored] = useState(false);
  const setCalm = cipher?.setCalm;

  useEffect(() => {
    setCalm?.(damaged);
  }, [damaged, setCalm]);

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
      pulse={cipher?.pulse}
    />
  );
}

/** The password form. Remounted after a restore, so the field starts empty. */
function UnlockForm({
  onUnlocked,
  onDamaged,
  notice,
  pulse,
}: {
  onUnlocked: OnUnlocked;
  onDamaged: () => void;
  notice: string | undefined;
  pulse: ((kind: PulseKind) => void) | undefined;
}) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

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
      pulse?.("error");
      if (!prefersReducedMotion()) {
        fieldRef.current?.animate?.(SHAKE, { duration: 260, easing: "ease-out" });
      }
      ref.current?.focus();
    }
  }

  return (
    <main className="vault-screen">
      <form onSubmit={submit} className="vault-screen__form vault-screen__form--unlock" {...CIPHER_CLEAR}>
        <h1 className="vault-screen__wordmark"><DecodingWordmark /></h1>
        <div ref={fieldRef} className="vault-screen__field">
          <Field label="Password" error={error ?? undefined}>
            <Input
              ref={ref}
              type="password"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setError(null);
                pulse?.("key");
              }}
              {...CIPHER_ORIGIN}
            />
          </Field>
        </div>
        {notice && <p className="vault-screen__notice">{notice}</p>}
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
    <main className="vault-screen">
      <form onSubmit={submit} className="vault-screen__form vault-screen__form--damaged">
        <h1><Wordmark className="vault-screen__damaged-mark" /></h1>
        <p className="vault-screen__text">Raven can't read its database file. Restore a backup to continue.</p>
        {listError && (
          <div className="vault-screen__retry">
            <p role="alert" className="vault-screen__error">{listError}</p>
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
        {backups && backups.length === 0 && <p className="vault-screen__notice">No backups yet</p>}
        {backups && backups.length > 0 && (
          <div
            role="radiogroup"
            aria-label="Backup"
            onKeyDown={onBackupKey}
            className="vault-screen__backups"
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
                  className="vault-screen__backup"
                >
                  <span aria-hidden className="vault-screen__backup-dot" />
                  <span className="vault-screen__backup-date">{new Date(b.createdAt).toLocaleString()}</span>
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
