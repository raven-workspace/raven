import { useMemo } from "react";
import { fillCommand, filterForKind, HOST_STAGES } from "../../engines/checklist";
import { getCards, getLibrary, getToolkit, useLibraryVersion } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import { Chip } from "../../ui";
import { fillLibraryCommand } from "../checklist/goalCommands";
import { CommandList } from "../checklist/CommandList";
import { useFillBase } from "../palette/fillData";
import { tokenSuggestions, type SuggestContext } from "../palette/suggest";
import { TokenInput } from "../palette/TokenInput";
import { FilePicker, isFileToken } from "../generators/FilePicker";

const STAGE_TITLE = new Map(HOST_STAGES.map((s) => [s.id, s.title]));
export const stageTitle = (id: string) => STAGE_TITLE.get(id) ?? id;

const TOKEN_RE = /(?<![$%])\{([A-Z][A-Z0-9_-]+)\}|<([A-Z][A-Z0-9_]+)>/g;
const TARGET_ALIASES = new Set(["TARGET", "IP", "TARGET-IP"]);
/** Never a chip: they come from the picked credential and stay masked. */
const SECRET_TOKENS = new Set(["PASS", "HASH", "CRED"]);

/** The editable fill tokens a set of templates uses, in first-seen order, aliases folded onto their canonical name. */
function tokensOf(commands: LibraryCommand[]): string[] {
  const out = new Set<string>();
  for (const c of commands) {
    for (const m of c.template.matchAll(TOKEN_RE)) {
      let t = m[1] ?? m[2] ?? "";
      if (TARGET_ALIASES.has(t)) t = "TARGET_IP";
      if (t === "DC-IP") t = "DC_IP";
      if (!SECRET_TOKENS.has(t)) out.add(t);
    }
  }
  return [...out];
}

/**
 * Fill chips plus filled blocks for a list of commands. `engagementId` and `hostId` decide what fills; the exam rules
 * of that engagement hide banned commands. Edits to a chip are `overrides` for every command shown.
 */
export function CommandPane({ commands, also = [], engagementId, hostId, overrides, onOverrides }: {
  commands: LibraryCommand[]; also?: LibraryCommand[]; engagementId: string; hostId: string | null;
  /** Chip edits, owned by the screen so they can be dropped when the host changes. */
  overrides: Record<string, string>; onOverrides: (next: Record<string, string>) => void;
}) {
  const { d, host, makeInput } = useFillBase(engagementId, hostId);
  const kind = d.engagement?.kind;

  const visible = (list: LibraryCommand[]) => {
    if (!kind) return { shown: list, msfMarker: new Set<string>() };
    return filterForKind(list, kind, { hostId: host?.id ?? "", msfHostId: d.engagement?.msfHostId ?? null });
  };
  const main = visible(commands);
  const extra = visible(also);
  const input = useMemo(() => makeInput(overrides), [makeInput, overrides]);
  const tokens = tokensOf([...main.shown, ...extra.shown]);
  const suggestCtx: SuggestContext = { engagement: d.engagement, hosts: d.hosts, services: d.services, credentials: d.credentials, host, toolkit: getToolkit() };

  const block = (c: LibraryCommand, msf: Set<string>) => (
    <div key={c.id} className="flex flex-col gap-1">
      <CommandList commands={[fillLibraryCommand(c, input, msf.has(c.id))]} />
      {c.why && <p className="m-0 text-xs text-muted">{c.why}</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {tokens.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Fill values">
          {tokens.map((t) => {
            const auto = fillCommand(`{${t}}`, { ...input, overrides: {} });
            return (
              <label
                key={t}
                {...(auto.dcByName && !overrides[t] ? { title: "DC (by name): no Kerberos/LDAP seen, picked by its host name" } : {})}
                className={`flex items-center gap-1.5 text-xs ${auto.unresolved.length > 0 && !overrides[t] ? "text-warn" : "text-muted"}`}
              >
                {t}
                {auto.dcByName && !overrides[t] && <span className="text-[11px] text-muted-2">(by name)</span>}
                {isFileToken(t) ? (
                  <FilePicker
                    name={t}
                    os={host?.os === "linux" || host?.os === "windows" ? host.os : null}
                    className="h-7 w-36"
                    placeholder={auto.unresolved.length > 0 ? "" : auto.text}
                    value={overrides[t] ?? ""}
                    onChange={(v) => onOverrides({ ...overrides, [t]: v })}
                  />
                ) : (
                  <TokenInput
                    name={t}
                    className="h-7 w-36"
                    placeholder={auto.unresolved.length > 0 ? "" : auto.text}
                    value={overrides[t] ?? ""}
                    suggestions={tokenSuggestions(t, suggestCtx)}
                    onChange={(v) => onOverrides({ ...overrides, [t]: v })}
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
      <div className="flex flex-col gap-3">{main.shown.map((c) => block(c, main.msfMarker))}</div>
      {main.shown.length === 0 && commands.length > 0 && <p className="m-0 text-xs text-muted">Nothing here is allowed in this exam.</p>}
      {extra.shown.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Also in Raven">
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-label text-muted">Also in Raven</h3>
          {extra.shown.map((c) => block(c, extra.msfMarker))}
        </section>
      )}
    </div>
  );
}

/** One Field-Manual card: title, where it sits, then its blocks in vault order, filled for the host. */
export function CardView({ cardId, engagementId, hostId, overrides, onOverrides }: {
  cardId: string; engagementId: string; hostId: string | null; overrides: Record<string, string>; onOverrides: (next: Record<string, string>) => void;
}) {
  const version = useLibraryVersion();
  const card = getCards().find((c) => c.id === cardId);
  // getLibrary() changes only with the library version.
  /* eslint-disable react-hooks/exhaustive-deps */
  const commands = useMemo(() => getLibrary().filter((c) => c.cardId === cardId), [cardId, version]);
  const also = useMemo(() => {
    const goals = new Set(commands.flatMap((c) => c.goals));
    const ids = new Set(commands.map((c) => c.id));
    return getLibrary().filter((c) => c.source === "raven" && !ids.has(c.id) && c.goals.some((g) => goals.has(g)));
  }, [commands, version]);
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!card) return <p className="m-0 text-xs text-muted">That card is not in the library.</p>;
  return (
    <article className="flex flex-col gap-3" aria-label={card.title}>
      <header className="flex flex-col gap-1.5">
        <h2 className="m-0 text-[15px] font-semibold text-fg">{card.title}</h2>
        <div className="flex flex-wrap gap-1.5">
          <Chip variant="accent">Field Manual</Chip>
          <Chip>{stageTitle(card.stage)}</Chip>
          <Chip>{card.category}</Chip>
          <Chip>{card.os}</Chip>
        </div>
      </header>
      <CommandPane key={cardId} commands={commands} also={also} engagementId={engagementId} hostId={hostId} overrides={overrides} onOverrides={onOverrides} />
    </article>
  );
}
