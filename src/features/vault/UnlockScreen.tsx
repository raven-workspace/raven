import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { UnlockResult } from "../../types/vault";
import { Button, Field, Input } from "../../ui";

export function UnlockScreen({ onUnlocked, notice }: { onUnlocked: (r: UnlockResult) => void; notice?: string | undefined }) {
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
      setError(code === "wrong_password" ? "Wrong password" : err instanceof Error ? err.message : "Couldn't unlock");
      setBusy(false);
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
        <Button type="submit" variant="primary" disabled={busy}>
          Unlock
        </Button>
      </form>
    </main>
  );
}
