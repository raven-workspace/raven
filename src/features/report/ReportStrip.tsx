import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { useNow } from "../../lib/keys";
import { cx } from "../../lib/cx";
import { IconButton, labelClass, Tooltip } from "../../ui";
import { Cell, useFitStrip } from "../engagements/StatusStrip";

const HOUR = 3_600_000;
const MIN = 60_000;

/** Drop steps when the strip runs out of room: Targets ready first, then Due in. The file name and To do stay. */
const STEP = { ready: 1, due: 2 } as const;
const LAST_STEP = 2;

/** Time left until the report is due: "21h 12m", or "Overdue". */
export function dueIn(dueAt: number, now: number): string {
  const left = dueAt - now;
  if (left <= 0) return "Overdue";
  return `${Math.floor(left / HOUR)}h ${Math.floor((left % HOUR) / MIN)}m`;
}

/** The report's To do count: a button that opens the open tab's To do panel (§10.1). */
function TodoCell({ count, open, onToggle }: { count: number; open: boolean; onToggle(): void }) {
  return (
    <Tooltip content={open ? "Hide what's left to do" : "Show what's left to do on this tab"}>
      <button
        type="button"
        aria-label={`To do ${count}`}
        aria-expanded={open}
        onClick={onToggle}
        className={cx("grid h-7 cursor-default grid-flow-col items-center gap-2 rounded-sm border-0 px-1", open ? "bg-surface-hi" : "bg-transparent hover:bg-surface-hi")}
      >
        <span className={labelClass}>To do</span>
        <span className={cx("font-mono text-meta", count > 0 ? "text-warn" : "text-fg")}>{count}</span>
      </button>
    </Tooltip>
  );
}

/** The report's status: file name, time left, targets ready and what's left to do. On the Report it stands in the engagement strip's place. Export arrives with the PDF round. */
export function ReportStrip({
  fileName,
  osidValid,
  dueAt,
  ready,
  targets,
  todo,
  todoOpen,
  onTodo,
  rail,
}: {
  fileName: string;
  osidValid: boolean;
  dueAt: number | null;
  ready: number;
  targets: number;
  /** Failing checks across the report. */
  todo: number;
  todoOpen: boolean;
  onTodo(): void;
  /** Under 1200px the evidence rail is a drawer: its toggle sits at the strip's right. */
  rail?: { open: boolean; onToggle(): void };
}) {
  const now = useNow();
  const { outer, inner } = useFitStrip(LAST_STEP);
  // A group, not a live region: the countdown ticks and must not be announced each minute.
  return (
    <div className="grid h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line pl-6 pr-4">
      <div ref={outer} role="group" aria-label="Report status" className="h-9 overflow-hidden text-meta text-muted-2">
        <div ref={inner} className="grid h-full grid-flow-col auto-cols-max items-center justify-start gap-6 whitespace-nowrap">
          <Cell label="Report" value={fileName} tone={osidValid ? undefined : "warn"} />
          {dueAt !== null && <Cell label="Due in" value={dueIn(dueAt, now)} step={STEP.due} tone={dueAt <= now ? "warn" : undefined} />}
          <Cell label="Targets ready" value={`${ready}/${targets}`} step={STEP.ready} />
          <TodoCell count={todo} open={todoOpen} onToggle={onTodo} />
        </div>
      </div>
      {rail && <IconButton icon={SidebarSimpleIcon} label="Evidence" shortcut="E" active={rail.open} onClick={rail.onToggle} />}
    </div>
  );
}
