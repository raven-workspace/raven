import { useMemo } from "react";
import { filterForKind, HOST_STAGES } from "../../engines/checklist";
import { getCards, getLibrary, getToolkit, useLibraryVersion } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import { Chip } from "../../ui";
import { fillLibraryCommand } from "../checklist/goalCommands";
import { CommandList } from "../checklist/CommandList";
import { useFillBase } from "../palette/fillData";
import type { SuggestContext } from "../palette/suggest";
import { useCredPickStore } from "../checklist/credPick";
import { CredChip } from "./CredChip";
import { FillBar } from "./FillBar";
import { autoFill, tokensOf, usesCred } from "./fillTokens";

const STAGE_TITLE = new Map(HOST_STAGES.map((s) => [s.id, s.title]));
export const stageTitle = (id: string) => STAGE_TITLE.get(id) ?? id;

/**
 * Fill chips plus filled blocks for a list of commands. `engagementId` and `hostId` decide what fills; the exam rules
 * of that engagement hide banned commands. Edits to a chip are `overrides` for every command shown.
 */
export function CommandPane({ commands, also = [], engagementId, hostId, overrides, onOverrides }: {
  commands: LibraryCommand[]; also?: LibraryCommand[]; engagementId: string; hostId: string | null;
  /** Chip edits, owned by the screen so they can be dropped when the host changes. */
  overrides: Record<string, string>; onOverrides: (next: Record<string, string>) => void;
}) {
  const { d, host, cred, credOwnerId, makeInput, examReady } = useFillBase(engagementId, hostId);
  const kind = d.engagement?.kind;

  const visible = (list: LibraryCommand[]) => {
    // Fail closed: nothing until the engagement's exam rules are known.
    if (!examReady) return { shown: [], msfMarker: new Set<string>() };
    if (!kind) return { shown: list, msfMarker: new Set<string>() };
    return filterForKind(list, kind, { hostId: host?.id ?? "", msfHostId: d.engagement?.msfHostId ?? null });
  };
  const main = visible(commands);
  const extra = visible(also);
  const input = useMemo(() => makeInput(overrides), [makeInput, overrides]);
  const templates = [...main.shown, ...extra.shown].map((c) => c.template);
  const tokens = tokensOf(templates);
  const auto = autoFill(tokens, makeInput({}));
  const suggestCtx: SuggestContext = { engagement: d.engagement, hosts: d.hosts, services: d.services, credentials: d.credentials, host, toolkit: getToolkit() };

  const block = (c: LibraryCommand, msf: Set<string>) => (
    <div key={c.id} className="flex flex-col gap-1">
      <CommandList commands={[fillLibraryCommand(c, input, msf.has(c.id))]} />
      {c.why && <p className="m-0 text-xs text-muted">{c.why}</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {engagementId && usesCred(templates) && (
        <div className="grid justify-items-start">
          <CredChip
            credentials={d.credentials ?? []} attempts={d.attempts ?? []} hostId={host?.id ?? null} value={cred} align="start"
            onPick={(id) => useCredPickStore.getState().set(credOwnerId, id)}
          />
        </div>
      )}
      <FillBar
        tokens={tokens} auto={auto} overrides={overrides} onOverrides={onOverrides} suggest={suggestCtx}
        os={host?.os === "linux" || host?.os === "windows" ? host.os : null}
      />
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
