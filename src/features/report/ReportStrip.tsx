import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { useNow } from "../../lib/keys";
import { IconButton } from "../../ui";
import { Cell, useFitStrip } from "../engagements/StatusStrip";

const HOUR = 3_600_000;
const MIN = 60_000;

/** Drop steps when the strip runs out of room: Targets ready first, then Due in. The file name and gaps stay. */
const STEP = { ready: 1, due: 2 } as const;
const LAST_STEP = 2;

/** Time left until the report is due: "21h 12m", or "Overdue". */
export function dueIn(dueAt: number, now: number): string {
  const left = dueAt - now;
  if (left <= 0) return "Overdue";
  return `${Math.floor(left / HOUR)}h ${Math.floor((left % HOUR) / MIN)}m`;
}

/** The report's status: file name, time left, targets ready and open gaps. Export arrives with the PDF round. */
export function ReportStrip({
  fileName,
  osidValid,
  dueAt,
  ready,
  targets,
  gaps,
  rail,
}: {
  fileName: string;
  osidValid: boolean;
  dueAt: number | null;
  ready: number;
  targets: number;
  gaps: number;
  /** Under 1200px the evidence rail is a drawer: its toggle sits at the strip's right. */
  rail?: { open: boolean; onToggle(): void };
}) {
  const now = useNow();
  const { outer, inner } = useFitStrip(LAST_STEP);
  // A group, not a live region: the countdown ticks and must not be announced each minute.
  return (
    <div className="grid h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line pr-2">
      <div ref={outer} role="group" aria-label="Report status" className="h-9 overflow-hidden text-meta text-muted-2">
        <div ref={inner} className="grid h-full grid-flow-col auto-cols-max items-center justify-start gap-6 whitespace-nowrap">
          <Cell label="Report" value={fileName} tone={osidValid ? undefined : "warn"} />
          {dueAt !== null && <Cell label="Due in" value={dueIn(dueAt, now)} step={STEP.due} tone={dueAt <= now ? "warn" : undefined} />}
          <Cell label="Targets ready" value={`${ready}/${targets}`} step={STEP.ready} />
          <Cell label="Gaps" value={String(gaps)} tone={gaps > 0 ? "warn" : undefined} />
        </div>
      </div>
      {rail && <IconButton icon={SidebarSimpleIcon} label="Evidence" shortcut="E" active={rail.open} onClick={rail.onToggle} />}
    </div>
  );
}
