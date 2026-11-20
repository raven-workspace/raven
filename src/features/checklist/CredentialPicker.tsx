import { credLabel } from "../../engines/credentials/labels";
import type { Credential } from "../../types/credentials";
import { Select, fieldLabelClass } from "../../ui";
import "./CredentialPicker.scss";

const NONE = "none";

/** "Commands use:" above a full-width <credential> ▾: which credential fills USER, PASS and HASH. */
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
      return { value: c.id, label: (total.get(base) ?? 0) > 1 ? `${base} (#${n})` : base };
    }),
  ];
  const selected = options.find((o) => o.value === (value?.id ?? NONE));
  return (
    // Label on its own line, the picker full width below: a long DOMAIN\user (hash) never wraps the label.
    <div className="credential-picker">
      <span className={fieldLabelClass}>Commands use:</span>
      <Select
        aria-label="Commands use"
        className="credential-picker__select"
        {...(selected ? { title: selected.label } : {})}
        options={options}
        value={value?.id ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
      />
    </div>
  );
}
