import { credLabel } from "../../engines/credentials/labels";
import type { Credential } from "../../types/credentials";
import { Select, labelClass } from "../../ui";

const NONE = "none";

/** "Commands use: <credential> ▾": which credential fills USER, PASS and HASH. */
export function CredentialPicker({ credentials, value, onChange }: { credentials: Credential[]; value: Credential | null; onChange: (credId: string | null) => void }) {
  const options = [{ value: NONE, label: "None" }, ...credentials.map((c) => ({ value: c.id, label: credLabel(c) }))];
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
