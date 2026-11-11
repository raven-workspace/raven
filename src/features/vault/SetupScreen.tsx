import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { Button, Field, Input } from "../../ui";
import { CIPHER_CLEAR, CIPHER_ORIGIN } from "./CipherBackdrop";
import { DecodingWordmark } from "./DecodingWordmark";
import type { CipherControls } from "./UnlockScreen";

export const MIN_PASSWORD = 12;

export function SetupScreen({
  onCreated,
  cipher,
}: {
  onCreated: () => void | Promise<void>;
  cipher?: CipherControls | undefined;
}) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ field: "pw" | "confirm" | "form"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pw.length < MIN_PASSWORD) {
      setError({ field: "pw", msg: `Use at least ${MIN_PASSWORD} characters` });
      cipher?.pulse("error");
      return;
    }
    if (pw !== confirm) {
      setError({ field: "confirm", msg: "Passwords don't match" });
      cipher?.pulse("error");
      return;
    }
    setBusy(true);
    try {
      await api.vaultCreate(pw);
      await onCreated();
    } catch (err) {
      setError({ field: "form", msg: err instanceof Error ? err.message : "Couldn't create the vault" });
      cipher?.pulse("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid h-full place-items-center px-6">
      <form onSubmit={submit} className="grid w-[380px] gap-4" {...CIPHER_CLEAR}>
        <DecodingWordmark className="mb-2 block h-auto w-full" />
        <div className="grid gap-2">
          <h1 className="m-0 text-title text-fg">Create your Raven password</h1>
          <p className="m-0 text-meta text-muted-2">
            This password encrypts everything Raven stores. It can't be recovered: if you forget it, the data is gone.
          </p>
        </div>
        <Field
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters`}
          error={error?.field === "pw" ? error.msg : undefined}
        >
          <Input
            type="password"
            autoFocus
            autoComplete="new-password"
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              cipher?.pulse("key");
            }}
            {...CIPHER_ORIGIN}
          />
        </Field>
        <Field label="Confirm password" error={error?.field === "confirm" ? error.msg : undefined}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              cipher?.pulse("key");
            }}
            {...CIPHER_ORIGIN}
          />
        </Field>
        {error?.field === "form" && <p role="alert" className="m-0 text-meta text-warn">{error.msg}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          Create password
        </Button>
      </form>
    </main>
  );
}
