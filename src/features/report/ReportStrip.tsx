import { cx } from "../../lib/cx";
import { useNow } from "../../lib/keys";
import { labelClass } from "../../ui";

const HOUR = 3_600_000;
const MIN = 60_000;

/** Time left until the report is due: "21h 12m", or "Overdue". */
export function dueIn(dueAt: number, now: number): string {
  const left = dueAt - now;
  if (left <= 0) return "Overdue";
  return `${Math.floor(left / HOUR)}h ${Math.floor((left % HOUR) / MIN)}m`;
}

function Cell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span role="group" aria-label={`${label} ${value}`} className="grid grid-flow-col items-center gap-2">
      <span className={labelClass}>{label}</span>
      <span className={cx("font-mono text-meta", warn ? "text-warn" : "text-fg")}>{value}</span>
    </span>
  );
}

/** The report's status: file name, time left, targets ready and open gaps. Export arrives with the PDF round. */
export function ReportStrip({
  fileName,
  osidValid,
  dueAt,
  ready,
  targets,
  gaps,
}: {
  fileName: string;
  osidValid: boolean;
  dueAt: number | null;
  ready: number;
  targets: number;
  gaps: number;
}) {
  const now = useNow();
  return (
    <div role="status" aria-label="Report status" className="h-9 overflow-hidden border-b border-line text-meta text-muted-2">
      <div className="grid h-full grid-flow-col auto-cols-max items-center justify-start gap-6 whitespace-nowrap">
        <Cell label="Report" value={fileName} warn={!osidValid} />
        {dueAt !== null && <Cell label="Due in" value={dueIn(dueAt, now)} warn={dueAt <= now} />}
        <Cell label="Targets ready" value={`${ready}/${targets}`} />
        <Cell label="Gaps" value={String(gaps)} warn={gaps > 0} />
      </div>
    </div>
  );
}
