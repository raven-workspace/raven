import { useQueryClient } from "@tanstack/react-query";
import { reportError } from "../../../lib/lockSignal";
import { Button, TimedNotice } from "../../../ui/index";
import { undoExtraction } from "../../log/extractions";
import { useSaveSummaryStore } from "../useSaveSummaryStore";
import "./SaveSummary.scss";

/** What the last save filed, bottom-left (the capture panel is on the right). Closes itself; the timer waits while hovered or focused. */
export function SaveSummary() {
  const qc = useQueryClient();
  const current = useSaveSummaryStore((s) => s.current);
  const close = useSaveSummaryStore((s) => s.close);

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
    // Undo sits under the close button, beside the lines rather than below them: the toast stays short enough to clear
    // the palette's hint line and the capture sheet's Save button.
    <TimedNotice
      timerKey={current}
      onClose={close}
      closeLabel="Close summary"
      action={
        <Button size="sm" onClick={() => void undo()}>
          Undo
        </Button>
      }
    >
      <ul className="save-summary">
        {summary.wins.map((t, i) => (
          <li key={`w${i}`} className="save-summary__win">{t}</li>
        ))}
        {summary.counts.map((t, i) => (
          <li key={`c${i}`} className="save-summary__line">{t}</li>
        ))}
        {summary.ticks.map((t, i) => (
          <li key={`t${i}`} className="save-summary__line">{t}</li>
        ))}
      </ul>
    </TimedNotice>
  );
}
