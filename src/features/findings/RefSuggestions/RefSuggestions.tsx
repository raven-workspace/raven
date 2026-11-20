import { useMemo } from "react";
import { suggestRefs } from "../../../engines/findings/index";
import type { LogEntry } from "../../../types/log";
import { ChipSet } from "../../../ui/index";
import { useLog } from "../../log/queries";
import { useNotes } from "../../notes/queries";
import { useNotesStore } from "../../notes/useNotesStore";
import "./RefSuggestions.scss";

/** Every piece of text an entry holds: title, observations and its content. */
function entryTexts(e: LogEntry): string[] {
  const out = [e.title, e.observations ?? ""];
  const c = e.content;
  if (c.kind === "command") for (const b of c.blocks) out.push(b.command, b.output);
  else if (c.kind === "http") out.push(c.request, c.response ?? "");
  else if (c.kind === "note") out.push(c.text);
  else if (c.kind === "screenshot") out.push(c.caption);
  else out.push(c.proof ?? "");
  return out;
}

/**
 * CVE and EDB ids found in the hosts' Log entries and notes (the whole engagement's while no host is picked),
 * minus the refs already on the finding, as one-click chips.
 */
export function RefSuggestions({ eid, hostIds, added, onAdd }: {
  eid: string;
  hostIds: string[];
  added: string[];
  onAdd: (ref: string) => void;
}) {
  const log = useLog(eid);
  const notes = useNotes(eid);
  const pending = useNotesStore((s) => s.pending);

  const suggestions = useMemo(() => {
    const mine = (ids: string[]) => hostIds.length === 0 || ids.some((h) => hostIds.includes(h));
    const texts = (log.data ?? []).filter((e) => mine(e.hostIds)).flatMap(entryTexts);
    // Note text not yet saved counts too: it is what's on screen.
    const bodies = new Map<string, { hostId: string | null; body: string }>(
      (notes.data ?? []).map((n) => [`${n.engagementId}:${n.hostId ?? ""}`, n]),
    );
    for (const [k, p] of Object.entries(pending)) if (p.engagementId === eid) bodies.set(k, p);
    for (const n of bodies.values()) if (hostIds.length === 0 || (n.hostId !== null && hostIds.includes(n.hostId))) texts.push(n.body);
    const have = new Set(added.map((r) => r.toUpperCase()));
    return suggestRefs(texts).filter((r) => !have.has(r.toUpperCase()));
  }, [log.data, notes.data, pending, hostIds, added, eid]);

  if (suggestions.length === 0) return null;
  return (
    <div role="group" aria-label="Suggested references" className="ref-suggestions">
      <span className="ref-suggestions__label">Found in the log and notes</span>
      <ChipSet>
      {suggestions.map((r) => (
        <button
          key={r}
          type="button"
          aria-label={`Add ${r}`}
          title={`Add ${r} to the references`}
          onClick={() => onAdd(r)}
          className="ref-suggestions__ref"
        >
          {r}
        </button>
      ))}
      </ChipSet>
    </div>
  );
}
