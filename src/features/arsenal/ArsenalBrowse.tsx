import { useMemo, useState } from "react";
import { Link } from "react-router";
import { filterForKind, HOST_STAGES } from "../../engines/checklist";
import { getCards, getLibrary, useLibraryVersion } from "../../engines/library/store";
import { useEscapeTo } from "../../lib/keys";
import { cx } from "../../lib/cx";
import { labelClass } from "../../ui";
import { useFillBase } from "../palette/fillData";
import { GENERATORS } from "../palette/generators";
import { CardView } from "./CardView";
import { useArsenalStore } from "./useArsenalStore";
import { useFillScope, useLastEngagementStore } from "./useFillScope";

const ON = "bg-accent/10 text-accent shadow-[inset_2px_0_0_var(--accent)]";

/** A filter (aria-pressed) or the open card (aria-current): the selected one carries the accent. */
function FilterButton({ on, onClick, current, children }: { on: boolean; onClick: () => void; current?: boolean; children: string }) {
  return (
    <button
      type="button"
      {...(current ? { "aria-current": on ? "true" : undefined } : { "aria-pressed": on })}
      onClick={onClick}
      className={cx("w-full cursor-default rounded-sm px-2 py-0.5 text-left text-[13px]", on ? ON : "text-fg-2 hover:bg-surface-2")}
    >
      {children}
    </button>
  );
}

/** `/arsenal`: every card by stage and category, and one card in full. No host until one is picked from the active engagement. */
export function ArsenalBrowse() {
  useEscapeTo("/");
  const version = useLibraryVersion();
  const cardId = useArsenalStore((s) => s.cardId);
  const [stage, setStage] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // The engagement (and host) you came from; picking a host here is remembered for ⌘K too.
  const { engagementId, hostId } = useFillScope();
  const setHostId = (id: string | null) => useLastEngagementStore.setState({ engagementId: engagementId || null, hostId: id });
  const { d, host } = useFillBase(engagementId, hostId);

  // getLibrary()/getCards() change only with the library version.
  /* eslint-disable react-hooks/exhaustive-deps */
  const cards = useMemo(() => {
    const kind = d.engagement?.kind;
    return getCards().filter((c) => {
      if (kind) {
        // A card whose every command the exam bans has nothing to show.
        const cmds = getLibrary().filter((x) => x.cardId === c.id);
        if (cmds.length > 0 && filterForKind(cmds, kind, { hostId: host?.id ?? "", msfHostId: d.engagement?.msfHostId ?? null }).shown.length === 0) return false;
      }
      return true;
    });
  }, [d.engagement, host, version]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const categories = [...new Set(cards.map((c) => c.category))].sort();
  const shown = cards.filter((c) => (!stage || c.stage === stage) && (!category || c.category === category));

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_1fr] gap-6 px-6 py-5">
      <nav aria-label="Arsenal" className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        {d.engagement && <p className="m-0 truncate text-xs text-fg-2">{d.engagement.name}</p>}
        <label className="flex items-center gap-2 text-xs text-muted">
          Host
          <select
            aria-label="Host"
            value={hostId ?? ""}
            onChange={(e) => {
              setHostId(e.target.value || null);
              setOverrides({});
            }}
            className="h-7 min-w-0 flex-1 rounded-sm border border-line-2 bg-bg px-1 text-xs text-fg-2"
          >
            <option value="">{engagementId ? "No host" : "No active engagement"}</option>
            {d.hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
        <section className="flex flex-col gap-1" aria-label="Stage">
          <h2 className={`${labelClass} m-0`}>Stage</h2>
          <FilterButton on={stage === null} onClick={() => setStage(null)}>All</FilterButton>
          {HOST_STAGES.map((s) => (
            <FilterButton key={s.id} on={stage === s.id} onClick={() => setStage(stage === s.id ? null : s.id)}>{s.title}</FilterButton>
          ))}
        </section>
        <section className="flex flex-col gap-1" aria-label="Category">
          <h2 className={`${labelClass} m-0`}>Category</h2>
          <FilterButton on={category === null} onClick={() => setCategory(null)}>All</FilterButton>
          {categories.map((c) => (
            <FilterButton key={c} on={category === c} onClick={() => setCategory(category === c ? null : c)}>{c}</FilterButton>
          ))}
        </section>
        <section className="flex flex-col gap-1" aria-label="Generators">
          <h2 className={`${labelClass} m-0`}>Generators</h2>
          {GENERATORS.length === 0 && <p className="m-0 px-2 text-xs text-muted">None yet</p>}
          {GENERATORS.map((g) => (
            <Link key={g.id} to={`/arsenal?generator=${encodeURIComponent(g.id)}`} className="rounded-sm px-2 text-[13px] text-fg-2 underline decoration-line-2 underline-offset-2 hover:text-accent">
              {g.title} ↗
            </Link>
          ))}
        </section>
        <section className="flex flex-col gap-1" aria-label="Cards">
          <h2 className={`${labelClass} m-0`}>Cards</h2>
          {shown.length === 0 && <p className="m-0 px-2 text-xs text-muted">No cards match</p>}
          {shown.map((c) => (
            <FilterButton key={c.id} current on={cardId === c.id} onClick={() => useArsenalStore.setState({ cardId: c.id })}>{c.title}</FilterButton>
          ))}
        </section>
      </nav>
      <main id="arsenal-browse" tabIndex={-1} className="min-h-0 overflow-y-auto outline-none">
        {cardId ? (
          <CardView key={cardId} cardId={cardId} engagementId={engagementId} hostId={hostId} overrides={overrides} onOverrides={setOverrides} />
        ) : (
          <p className="m-0 text-[13px] text-muted">Pick a card.</p>
        )}
      </main>
    </div>
  );
}
