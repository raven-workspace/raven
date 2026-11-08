import { useLayoutEffect, useRef, type ReactNode } from "react";
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
 * Drop steps, in order: each step hides one part when the strip has run out of room (see useFitStrip).
 * Secondary parts go first, then whole cells from the end, so LHOST stays as long as there is room for it.
 */
const STEP = { of: 1, bar: 2, lhost: 3, cleanup: 4, threads: 5, msf: 6, flags: 7, rooted: 8 } as const;
const LAST_STEP = 8;

/** One labelled value. `step` marks the part as droppable at that step. */
function Cell({ label, value, step, tone }: { label: string; value: string; step?: number; tone?: "warn" }) {
  return (
    <span role="group" aria-label={`${label} ${value}`} data-drop={step} className="grid grid-flow-col items-center gap-2">
      <span className={labelClass}>{label}</span>
      <span className={cx("font-mono text-meta", tone === "warn" ? "text-warn" : "text-fg")}>{value}</span>
    </span>
  );
}

/**
 * Hides droppable parts (`data-drop="n"`) one step at a time, from step 1 up, until the strip's content fits
 * its own width: drops follow the space the strip has, not the window width. Runs before paint on every render
 * (the clock changes the text width) and whenever the strip is resized.
 */
function useFitStrip() {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const box = inner.current;
      if (!box) return;
      const parts = [...box.querySelectorAll<HTMLElement>("[data-drop]")];
      const show = (upTo: number) => {
        for (const el of parts) el.style.display = Number(el.dataset.drop) <= upTo ? "none" : "";
      };
      let step = 0;
      show(step);
      while (box.scrollWidth > box.clientWidth && step < LAST_STEP) show(++step);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    return () => ro.disconnect();
  });
  return { outer, inner };
}

export function StatusStrip({ engagement: e }: { engagement: Engagement }) {
  const now = useNow();
  const progress = useProgress().data?.[e.id] ?? EMPTY_PROGRESS;
  const threads = useThreadCounts(e.id).total;
  const cleanup = useCleanupCounts().data?.[e.id] ?? 0;
  const { outer, inner } = useFitStrip();
  return (
    <div
      ref={outer}
      role="status"
      aria-label="Engagement status"
      className="h-9 shrink-0 overflow-hidden border-b border-line px-6 text-meta text-muted-2"
    >
      <div ref={inner} className="grid h-full grid-flow-col auto-cols-max items-center justify-start gap-6 whitespace-nowrap">
        {hasTimebox(e) ? (
          <TimeboxStatus start={e.timeboxStart} minutes={e.timeboxMinutes} now={now} />
        ) : (
          <Cell label="Dates" value={dateRange(e.startsAt, e.endsAt, now)} />
        )}
        <Cell label="Rooted" value={`${progress.hostsRooted}/${progress.hostsTotal}`} step={STEP.rooted} />
        <Cell label="Flags" value={`${progress.flagsFound}/${progress.flagsTotal}`} step={STEP.flags} />
        {e.kind === "exam-sim" && <MsfLock engagement={e} step={STEP.msf} />}
        {threads > 0 && <Cell label="Threads" value={String(threads)} step={STEP.threads} />}
        {cleanup > 0 && <Cell label="Cleanup" value={String(cleanup)} step={STEP.cleanup} />}
        <Listener step={STEP.lhost} />
      </div>
    </div>
  );
}

function TimeboxStatus({ start, minutes, now }: { start: number | null; minutes: number; now: number }) {
  const left = timeLeft(start, minutes, now);
  const over = left === "Time's up";
  const of: ReactNode = <span data-drop={STEP.of} className="text-faint">of {formatDuration(minutes)}</span>;
  return (
    <span className="grid grid-flow-col items-center gap-2.5">
      <span className={labelClass}>Timebox</span>
      <span className={cx("font-mono text-meta", over ? "text-warn" : "text-fg")}>{left}</span>
      <span data-drop={STEP.bar} className="w-24">
        <TimeBar fraction={timeboxElapsed(start, minutes, now)} over={over} />
      </span>
      {of}
    </span>
  );
}
