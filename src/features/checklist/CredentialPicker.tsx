import { credLabel } from "../../engines/credentials/labels";
import type { Credential } from "../../types/credentials";
import { Select, labelClass } from "../../ui";

const NONE = "none";

/** "Commands use: <credential> ▾": which credential fills USER, PASS and HASH. */
export function CredentialPicker({ credentials, value, onChange }: { credentials: Credential[]; value: Credential | null; onChange: (credId: string | null) => void }) {
  // Two credentials can share a label (same user, different secret): number them so they can be told apart.
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const c of credentials) total.set(credLabel(c), (total.get(credLabel(c)) ?? 0) + 1);
  const options = [
    { value: NONE, label: "None" },
    ...credentials.map((c) => {
      const base = credLabel(c);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { value: c.id, label: (total.get(base) ?? 0) > 1 ? `${base} · #${n}` : base };
    }),
  ];
  return (
    <div className="flex items-center gap-2">
      <span className={labelClass}>Commands use:</span>
      <Select
        aria-label="Commands use"
        className="min-w-48"
        options={options}
        value={value?.id ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
      />
    </div>
  );
}
