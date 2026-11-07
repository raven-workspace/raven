import { FilePicker, isFileToken } from "../generators/FilePicker";
import { tokenSuggestions, type SuggestContext } from "../palette/suggest";
import { TokenInput } from "../palette/TokenInput";

/**
 * The fill fields of a command or card, in the order its templates first use them (editing never reorders). An
 * unfilled field is amber; an auto-filled one shows its value as text, and typing over it overrides it (clearing
 * falls back to the auto value). Credential secrets are never fields: the credential chip fills them.
 */
export function FillBar({ tokens, auto, overrides, onOverrides, suggest, os, fieldRef }: {
  tokens: string[];
  auto: Record<string, { text: string; unresolved: boolean; dcByName?: boolean }>;
  overrides: Record<string, string>; onOverrides: (next: Record<string, string>) => void;
  suggest: SuggestContext; os: "linux" | "windows" | null;
  fieldRef?: (token: string, el: HTMLInputElement | null) => void;
}) {
  if (tokens.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Fill values">
      {tokens.map((t) => {
        const a = auto[t] ?? { text: "", unresolved: true };
        const typed = overrides[t] ?? "";
        const unfilled = a.unresolved && !typed;
        const set = (v: string) => {
          if (v) onOverrides({ ...overrides, [t]: v });
          else {
            const rest = { ...overrides };
            delete rest[t];
            onOverrides(rest);
          }
        };
        const shared = {
          name: t,
          value: typed || a.text,
          onChange: set,
          className: `h-7 w-36 ${unfilled ? "border-warn!" : typed ? "text-fg!" : "text-fg-2!"}`,
          autoValue: !typed && !a.unresolved,
          ref: fieldRef ? (el: HTMLInputElement | null) => fieldRef(t, el) : undefined,
        };
        return (
          <label
            key={t}
            {...(t === "DC_IP" && a.dcByName && !typed ? { title: "DC (by name): no Kerberos/LDAP seen, picked by its host name" } : {})}
            className={`flex items-center gap-1.5 text-xs ${unfilled ? "text-warn" : "text-muted"}`}
          >
            {t}
            {t === "DC_IP" && a.dcByName && !typed && <span className="text-[11px] text-muted-2">(by name)</span>}
            {isFileToken(t) ? (
              <FilePicker {...shared} os={os} />
            ) : (
              <TokenInput {...shared} suggestions={tokenSuggestions(t, suggest)} />
            )}
          </label>
        );
      })}
    </div>
  );
}
