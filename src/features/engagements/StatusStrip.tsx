import { cx } from "../../lib/cx";
import { useNow } from "../../lib/keys";
import type { Engagement } from "../../types/engagement";
import { Kbd, labelClass } from "../../ui";
import { useProgress } from "../hosts/queries";
import { useThreadCounts } from "../notes/useThreadCounts";
import { MsfLock } from "./MsfLock";
import { TimeBar } from "./ActiveCard";
import {
  EMPTY_PROGRESS,
  dateRange,
  formatDuration,
  hasTimebox,
  progressLine,
  timeLeft,
  timeboxElapsed,
} from "./format";

export function StatusStrip({ engagement: e }: { engagement: Engagement }) {
  const now = useNow();
  const progress = useProgress().data?.[e.id] ?? EMPTY_PROGRESS;
  const threads = useThreadCounts(e.id).total;
  return (
    <div
      role="status"
      aria-label="Engagement status"
      className="flex h-9 shrink-0 items-center gap-5 border-b border-line px-6 text-xs text-muted-2"
    >
      {hasTimebox(e) ? (
        <TimeboxStatus start={e.timeboxStart} minutes={e.timeboxMinutes} now={now} />
      ) : (
        <span>{dateRange(e.startsAt, e.endsAt, now)}</span>
      )}
      <span className="text-fg-2">{progressLine(progress)}</span>
      {threads > 0 && <span className="text-fg-2">Threads {threads}</span>}
      {e.kind === "exam-sim" && <MsfLock engagement={e} />}
      <span className="ml-auto flex items-center gap-1.5 text-faint">
        <Kbd>1</Kbd>–<Kbd>6</Kbd> sections <Kbd className="ml-2">esc</Kbd> engagements
      </span>
    </div>
  );
}

function TimeboxStatus({ start, minutes, now }: { start: number | null; minutes: number; now: number }) {
  const left = timeLeft(start, minutes, now);
  const over = left === "Time's up";
  return (
    <span className="flex items-center gap-2.5">
      <span className={labelClass}>Timebox</span>
      <span className={cx("font-mono text-[12px]", over ? "text-warn" : "text-fg")}>{left}</span>
      <span className="w-24">
        <TimeBar fraction={timeboxElapsed(start, minutes, now)} over={over} />
      </span>
      <span className="text-faint">of {formatDuration(minutes)}</span>
    </span>
  );
}
