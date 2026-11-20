import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { useNow } from "../../lib/keys";
import { cx } from "../../lib/cx";
import { IconButton, labelClass, Tooltip } from "../../ui";
import { Cell, useFitStrip } from "../engagements/StatusStrip";
import "./ReportStrip.scss";

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
function TodoCell({ count, open, onToggle }: { count: number; open: boolean; onToggle(button: HTMLElement): void }) {
  return (
    <Tooltip content={open ? "Hide what's left to do" : "Show what's left to do on this tab"}>
      <button
        type="button"
        aria-label={`To do ${count}`}
        aria-expanded={open}
        onClick={(e) => onToggle(e.currentTarget)}
        className="report-strip__todo"
      >
        <span className={labelClass}>To do</span>
        <span className={cx("report-strip__count", count > 0 && "report-strip__count--todo")}>{count}</span>
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
  /** Toggles the panel; `button` is where focus returns when it closes. */
  onTodo(button: HTMLElement): void;
  /** Under 1200px the evidence column opens and closes (docked beside the page, or a drawer when narrower): its toggle sits at the strip's right. */
  rail?: { open: boolean; onToggle(): void };
}) {
  const now = useNow();
  const { outer, inner } = useFitStrip(LAST_STEP);
  // A group, not a live region: the countdown ticks and must not be announced each minute.
  return (
    <div className="report-strip">
      <div ref={outer} role="group" aria-label="Report status" className="report-strip__status">
        <div ref={inner} className="report-strip__cells">
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
