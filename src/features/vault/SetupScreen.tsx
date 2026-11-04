import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { Button, Field, Input } from "../../ui";

export const MIN_PASSWORD = 12;

export function SetupScreen({ onCreated }: { onCreated: () => void }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ field: "pw" | "confirm" | "form"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pw.length < MIN_PASSWORD) {
      setError({ field: "pw", msg: `Use at least ${MIN_PASSWORD} characters` });
      return;
    }
    if (pw !== confirm) {
      setError({ field: "confirm", msg: "Passwords don't match" });
      return;
    }
    setBusy(true);
    try {
      await api.vaultCreate(pw);
      onCreated();
    } catch (err) {
      setError({ field: "form", msg: err instanceof Error ? err.message : "Couldn't create the vault" });
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full items-center justify-center px-6">
      <form onSubmit={submit} className="flex w-[380px] flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-lg font-semibold text-fg">Create your Raven password</h1>
          <p className="m-0 text-[13px] text-muted-2">
            This password encrypts everything Raven stores. It can't be recovered — if you forget it, the data is gone.
          </p>
        </div>
        <Field
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters`}
          error={error?.field === "pw" ? error.msg : undefined}
        >
          <Input type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm password" error={error?.field === "confirm" ? error.msg : undefined}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {error?.field === "form" && <p className="m-0 text-xs text-warn">{error.msg}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          Create password
        </Button>
      </form>
    </main>
  );
}
