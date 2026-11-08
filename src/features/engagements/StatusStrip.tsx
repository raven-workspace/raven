import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { useNow } from "../../lib/keys";
import type { Engagement } from "../../types/engagement";
import { labelClass } from "../../ui";
import { useCleanupCounts } from "../cleanup/queries";
import { useProgress } from "../hosts/queries";
import { useThreadCounts } from "../notes/useThreadCounts";
import { TimeBar } from "./ActiveCard";
import {
  EMPTY_PROGRESS,
  dateRange,
  formatDuration,
  hasTimebox,
  timeLeft,
  timeboxElapsed,
} from "./format";
import { Listener } from "./Listener";
import { MsfLock } from "./MsfLock";

/**
 * One labelled value. `drop` is the container-query class that hides the whole cell when the strip is too
 * narrow; cells are listed in priority order, so the later ones drop first.
 */
function Cell({ label, value, drop, tone }: { label: string; value: string; drop?: string; tone?: "warn" }) {
  return (
    <span role="group" aria-label={`${label} ${value}`} className={cx("grid grid-flow-col items-center gap-2", drop)}>
      <span className={labelClass}>{label}</span>
      <span className={cx("font-mono text-meta", tone === "warn" ? "text-warn" : "text-fg")}>{value}</span>
    </span>
  );
}

export function StatusStrip({ engagement: e }: { engagement: Engagement }) {
  const now = useNow();
  const progress = useProgress().data?.[e.id] ?? EMPTY_PROGRESS;
  const threads = useThreadCounts(e.id).total;
  const cleanup = useCleanupCounts().data?.[e.id] ?? 0;
  return (
    <div
      role="status"
      aria-label="Engagement status"
      className="@container h-9 shrink-0 overflow-hidden border-b border-line px-6 text-meta text-muted-2"
    >
      <div className="grid h-full grid-flow-col auto-cols-max items-center justify-start gap-6 whitespace-nowrap">
        {hasTimebox(e) ? (
          <TimeboxStatus start={e.timeboxStart} minutes={e.timeboxMinutes} now={now} />
        ) : (
          <Cell label="Dates" value={dateRange(e.startsAt, e.endsAt, now)} />
        )}
        <Cell label="Rooted" value={`${progress.hostsRooted}/${progress.hostsTotal}`} drop="@max-[560px]:hidden" />
        <Cell label="Flags" value={`${progress.flagsFound}/${progress.flagsTotal}`} drop="@max-[640px]:hidden" />
        {e.kind === "exam-sim" && <MsfLock engagement={e} className="@max-[720px]:hidden" />}
        {threads > 0 && <Cell label="Threads" value={String(threads)} drop="@max-[800px]:hidden" />}
        {cleanup > 0 && <Cell label="Cleanup" value={String(cleanup)} drop="@max-[880px]:hidden" />}
        <Listener className="@max-[960px]:hidden" />
      </div>
    </div>
  );
}

function TimeboxStatus({ start, minutes, now }: { start: number | null; minutes: number; now: number }) {
  const left = timeLeft(start, minutes, now);
  const over = left === "Time's up";
  const of: ReactNode = <span className="text-faint @max-[1180px]:hidden">of {formatDuration(minutes)}</span>;
  return (
    <span className="grid grid-flow-col items-center gap-2.5">
      <span className={labelClass}>Timebox</span>
      <span className={cx("font-mono text-meta", over ? "text-warn" : "text-fg")}>{left}</span>
      <span className="w-24 @max-[1080px]:hidden">
        <TimeBar fraction={timeboxElapsed(start, minutes, now)} over={over} />
      </span>
      {of}
    </span>
  );
}
