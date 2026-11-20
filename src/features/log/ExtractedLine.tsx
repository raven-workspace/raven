import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { reportError } from "../../lib/lockSignal";
import type { LogEntry } from "../../types/log";
import { Button, Collapse } from "../../ui";
import { undoExtraction, useExtractions } from "./extractions";
import "./ExtractedLine.scss";

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
  if (extraction.undoneAt !== null) return <p className="extracted-line__undone">Extracted (undone)</p>;

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
    <div className="extracted-line">
      <div className="extracted-line__lines">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="extracted-line__toggle"
        >
          <span>Extracted{open ? "" : ": "}</span>
          {!open && <span className={lines[0].win ? "extracted-line__win" : undefined}>{lines[0].t}</span>}
          {!open && more > 0 && <span>{`, +${more} more`}</span>}
        </button>
        <Collapse open={open}>
          <ul className="extracted-line__list">
            {lines.map((l, i) => (
              <li key={i} className={l.win ? "extracted-line__item extracted-line__win" : "extracted-line__item"}>{l.t}</li>
            ))}
          </ul>
        </Collapse>
      </div>
      <Button size="sm" onClick={() => void undo()} disabled={busy}>Undo</Button>
    </div>
  );
}
