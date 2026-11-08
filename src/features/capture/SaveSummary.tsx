import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { reportError } from "../../lib/lockSignal";
import { Button } from "../../ui";
import { undoExtraction } from "../log/extractions";
import { useSaveSummaryStore } from "./useSaveSummaryStore";

const CLOSE_MS = 5000;

/** What the last save filed, bottom-left (the capture panel is on the right). Closes itself; the timer waits while hovered or focused. */
export function SaveSummary() {
  const qc = useQueryClient();
  const current = useSaveSummaryStore((s) => s.current);
  const close = useSaveSummaryStore((s) => s.close);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const held = hover || focus;

  useEffect(() => {
    if (!current || held) return;
    const t = setTimeout(close, CLOSE_MS);
    return () => clearTimeout(t);
  }, [current, held, close]);

  if (!current) return null;
  const { entryId, summary } = current;
  const undo = async () => {
    close();
    try {
      await undoExtraction(qc, entryId);
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <div
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      className="fixed bottom-4 left-4 z-30 grid w-[min(360px,calc(100vw-2rem))] grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-md border border-line-2 bg-surface px-3 py-2.5 text-xs shadow-lg"
    >
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {summary.wins.map((t, i) => (
          <li key={`w${i}`} className="text-accent">{t}</li>
        ))}
        {summary.counts.map((t, i) => (
          <li key={`c${i}`} className="text-muted">{t}</li>
        ))}
        {summary.ticks.map((t, i) => (
          <li key={`t${i}`} className="text-muted">{t}</li>
        ))}
      </ul>
      <button
        type="button"
        aria-label="Close summary"
        onClick={close}
        className="cursor-default rounded-sm px-1 text-muted-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        ×
      </button>
      <Button size="sm" className="col-span-2 justify-self-start" onClick={() => void undo()}>Undo</Button>
    </div>
  );
}
