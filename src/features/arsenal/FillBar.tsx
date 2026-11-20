import { FilePicker, isFileToken } from "../generators/FilePicker";
import { tokenSuggestions, type SuggestContext } from "../palette/suggest";
import { TokenInput } from "../palette/TokenInput";
import { cx } from "../../lib/cx";
import "./FillBar.scss";

/**
 * The fill fields of a command or card, in the order its templates first use them (editing never reorders). An
 * unfilled field is amber; an auto-filled one shows its value as text, and typing over it overrides it (clearing
 * falls back to the auto value). Credential secrets are never fields: the credential chip fills them.
 */
export function FillBar({ tokens: all, hasCred = false, auto, overrides, onOverrides, suggest, os, fieldRef }: {
  tokens: string[];
  /** A credential is picked: USER and DOMAIN are not fields while it supplies them (an ownerless one supplies no USER). */
  hasCred?: boolean;
  auto: Record<string, { text: string; unresolved: boolean; dcByName?: boolean }>;
  overrides: Record<string, string>; onOverrides: (next: Record<string, string>) => void;
  suggest: SuggestContext; os: "linux" | "windows" | null;
  fieldRef?: (token: string, el: HTMLInputElement | null) => void;
}) {
  const tokens = hasCred ? all.filter((t) => !((t === "USER" || t === "DOMAIN") && auto[t] && !auto[t].unresolved)) : all;
  if (tokens.length === 0) return null;
  return (
    <div className="fillbar" aria-label="Fill values">
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
          className: cx("fillbar__input", unfilled ? "fillbar__input--unfilled" : typed ? "fillbar__input--typed" : "fillbar__input--auto"),
          autoValue: !typed && !a.unresolved,
          ref: fieldRef ? (el: HTMLInputElement | null) => fieldRef(t, el) : undefined,
        };
        return (
          <label
            key={t}
            {...(t === "DC_IP" && a.dcByName && !typed ? { title: "DC (by name): no Kerberos/LDAP seen, picked by its host name" } : {})}
            className={cx("fillbar__field", unfilled && "fillbar__field--unfilled")}
          >
            <span>
              {t}
              {t === "DC_IP" && a.dcByName && !typed && <span className="fillbar__by-name">(by name)</span>}
            </span>
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
