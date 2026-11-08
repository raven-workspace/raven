import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { reportError } from "../../lib/lockSignal";
import type { LogEntry } from "../../types/log";
import { Button } from "../../ui";
import { undoExtraction, useExtractions } from "./extractions";

/** What this entry's save filed: one collapsed line with Undo, or every line when opened (the line toggles). */
export function ExtractedLine({ entry }: { entry: LogEntry }) {
  const qc = useQueryClient();
  const extraction = useExtractions(entry.engagementId).data?.get(entry.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!extraction) return null;
  const { wins, counts, ticks } = extraction.summary;
  const lines = [...wins.map((t) => ({ t, win: true })), ...counts.map((t) => ({ t, win: false })), ...ticks.map((t) => ({ t, win: false }))];
  if (lines.length === 0) return null;
  if (extraction.undoneAt !== null) return <p className="m-0 text-xs text-muted">Extracted (undone)</p>;

  const undo = async () => {
    setBusy(true);
    try {
      await undoExtraction(qc, entry.id);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  const more = lines.length - 1;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-t border-line pt-2 text-xs">
      <div className="grid min-w-0 gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 cursor-default truncate rounded-sm text-left text-muted hover:text-fg"
        >
          <span>Extracted{open ? "" : ": "}</span>
          {!open && <span className={lines[0].win ? "text-accent" : undefined}>{lines[0].t}</span>}
          {!open && more > 0 && <span>{` · +${more} more`}</span>}
        </button>
        {open && (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {lines.map((l, i) => (
              <li key={i} className={l.win ? "text-accent" : "text-muted"}>{l.t}</li>
            ))}
          </ul>
        )}
      </div>
      <Button size="sm" onClick={() => void undo()} disabled={busy}>Undo</Button>
    </div>
  );
}
