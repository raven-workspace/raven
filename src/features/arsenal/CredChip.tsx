import type { Ref } from "react";
import { credLabel } from "../../engines/credentials/labels";
import type { CredAttempt, Credential } from "../../types/credentials";
import { ChipPicker } from "./ChipPicker";
import type { ChipOption, ChipPickerHandle } from "./ChipPicker";

export type CredChipHandle = ChipPickerHandle;

/** `DOMAIN\user`, without credLabel's "(hash)" suffix: the kind is shown on its own. */
const who = (c: Credential): string => credLabel(c).replace(/ \(hash\)$/, "");
const kind = (c: Credential): string => (c.type === "hash" ? "hash" : "password");

/** How the credential has fared on this host: the best recorded result, else "untested". */
export function testedState(credId: string, hostId: string | null | undefined, attempts: CredAttempt[]): string {
  if (!hostId) return "untested";
  const results = new Set(attempts.filter((a) => a.credId === credId && a.hostId === hostId).map((a) => a.result));
  return results.has("admin") ? "admin" : results.has("valid") ? "valid" : results.has("failed") ? "failed" : results.size ? "errored" : "untested";
}

/**
 * The credential in use, as a muted "as <cred> · password ⌄" chip with no Tab stop (same interaction as `HostChip`).
 * The list shows each credential's kind and how it has fared on `hostId`. Callers write the pick to `useCredPickStore`.
 */
export function CredChip({ credentials, value, onPick, attempts = [], hostId = null, align = "end", ref }: {
  credentials: Credential[]; value: Credential | null; onPick: (credId: string | null) => void;
  attempts?: CredAttempt[]; hostId?: string | null; align?: "start" | "end"; ref?: Ref<CredChipHandle>;
}) {
  const options: ChipOption[] = [
    { id: null, name: "No credential" },
    ...credentials.map((c) => ({ id: c.id, name: who(c), detail: `${kind(c)} · ${testedState(c.id, hostId, attempts)}` })),
  ];
  return (
    <div className="grid min-w-0 max-w-1/2">
      <ChipPicker
        ref={ref}
        options={options}
        value={value?.id ?? null}
        onPick={onPick}
        label={`Fill with credential: ${value ? who(value) : "none"}`}
        listLabel="Fill with credential"
        title="Fill with another credential (⌥C)"
        align={align}
        wide
      >
        <span>as</span>
        {value ? (
          <>
            <b className="max-w-40 truncate font-medium text-fg-2">{who(value)}</b>
            <span>· {kind(value)}</span>
          </>
        ) : (
          <b className="font-medium text-fg-2">no credential</b>
        )}
        <span aria-hidden="true" className="text-[10px] opacity-70">⌄</span>
      </ChipPicker>
    </div>
  );
}

/** ⌥C: by key code, since macOS turns ⌥C into "ç". */
export const isCredPickKey = (e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string; key: string }): boolean =>
  e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "KeyC" || e.key.toLowerCase() === "c");
