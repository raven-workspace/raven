import { Link } from "react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "../../../lib/cx";
import { useNow } from "../../../lib/keys";
import type { Engagement } from "../../../types/engagement";
import { Chip, labelClass } from "../../../ui/index";
import { useCleanupCounts } from "../../cleanup/queries";
import { useProgress } from "../../hosts/queries";
import { useThreadCounts } from "../../notes/useThreadCounts";
import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { IconButton } from "../../../ui/index";
import { TIMEBOX_TEXT, TimeBar } from "../ActiveCard/ActiveCard";
import {
  EMPTY_PROGRESS,
  dateRange,
  formatDuration,
  hasTimebox,
  timeLeft,
  timeboxElapsed,
  timeboxNow,
  timeboxState,
} from "../format";
import { Listener } from "../Listener/Listener";
import { MsfLock } from "../MsfLock/MsfLock";
import { useTimeboxPause } from "../queries";
import "./StatusStrip.scss";
import "../ActiveCard/ActiveCard.scss";

/**
 * Drop steps, in order: each step hides one part when the strip has run out of room (see useFitStrip).
 * Secondary parts go first, then Cleanup, Threads, the Metasploit lock and LHOST: the display order stays, but LHOST (the most-copied value) outlasts the cells before it.
 */
// The engagement's name (host pages) goes after Cleanup and Threads but before Metasploit and LHOST: you know which
// engagement you're in; the lock and the listener are what you reach for mid-exam.
const STEP = { of: 1, bar: 2, cleanup: 3, threads: 4, name: 5, msf: 6, lhost: 7, flags: 8, rooted: 9 } as const;
const LAST_STEP = 9;

/** One labelled value. `step` marks the part as droppable at that step. */
export function Cell({ label, value, step, tone }: { label: string; value: string; step?: number; tone?: "warn" }) {
  return (
    <span role="group" aria-label={`${label} ${value}`} data-drop={step} className="status-cell">
      <span className={labelClass}>{label}</span>
      <span className={cx("status-cell__value", tone === "warn" && "status-cell__value--warn")}>{value}</span>
    </span>
  );
}

/**
 * Hides droppable parts (`data-drop="n"`) one step at a time, from step 1 up, until the strip's content fits
 * its own width: drops follow the space the strip has, not the window width. Runs before paint on every render
 * (the clock changes the text width) and whenever the strip is resized.
 */
export function useFitStrip(lastStep: number = LAST_STEP) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const fit = useCallback(() => {
    const box = inner.current;
    if (!box) return;
    const parts = [...box.querySelectorAll<HTMLElement>("[data-drop]")];
    const show = (upTo: number) => {
      for (const el of parts) el.style.display = Number(el.dataset.drop) <= upTo ? "none" : "";
    };
    let step = 0;
    show(step);
    while (box.scrollWidth > box.clientWidth && step < lastStep) show(++step);
  }, [lastStep]);
  // After every render (the clock changes the text width), before paint.
  useLayoutEffect(() => fit());
  // One observer for the strip's life: the strip itself (window/sidebar resize) and its cells (a late text change,
  // e.g. the listener settings arriving or the Metasploit host name). Hidden cells report no size, so refits cannot loop.
  useEffect(() => {
    const ro = new ResizeObserver(() => fit());
    if (outer.current) ro.observe(outer.current);
    for (const c of inner.current?.children ?? []) ro.observe(c);
    const mo = new MutationObserver(() => {
      ro.disconnect();
      if (outer.current) ro.observe(outer.current);
      for (const c of inner.current?.children ?? []) ro.observe(c);
    });
    if (inner.current) mo.observe(inner.current, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [fit]);
  return { outer, inner };
}

/**
 * `named` (a host page, where there is no engagement header): the engagement's name leads the strip as a link back to
 * the board. A long name truncates; when space runs out it drops before the Metasploit and LHOST cells.
 */
export function StatusStrip({ engagement: e, named = false }: { engagement: Engagement; named?: boolean }) {
  const now = useNow();
  const progressQ = useProgress();
  // A failed or pending progress query must never read as "0/0": show a dash while loading, "unavailable" (amber) on failure.
  const progress = progressQ.data ? (progressQ.data[e.id] ?? EMPTY_PROGRESS) : null;
  const failed = !progress && progressQ.isError;
  const dash = failed ? "unavailable" : "\u2014";
  const threads = useThreadCounts(e.id).total;
  const cleanup = useCleanupCounts().data?.[e.id] ?? 0;
  const { outer, inner } = useFitStrip();
  return (
    <div
      ref={outer}
      role="status"
      aria-label="Engagement status"
      className="status-strip"
    >
      <div ref={inner} className="status-strip__parts">
        {named && (
          <Link to={`/e/${e.id}`} title={e.name} data-drop={STEP.name} className="status-strip__name">
            {e.name}
          </Link>
        )}
        {named && e.status === "archived" && <span data-drop={STEP.name}><Chip>archived</Chip></span>}
        {hasTimebox(e) ? (
          <TimeboxStatus engagement={e} now={now} />
        ) : (
          <Cell label="Dates" value={dateRange(e.startsAt, e.endsAt, now)} />
        )}
        <Cell label="Rooted" value={progress ? `${progress.hostsRooted}/${progress.hostsTotal}` : dash} step={STEP.rooted} tone={failed ? "warn" : undefined} />
        <Cell label="Flags" value={progress ? `${progress.flagsFound}/${progress.flagsTotal}` : dash} step={STEP.flags} tone={failed ? "warn" : undefined} />
        {e.kind === "exam-sim" && <MsfLock engagement={e} step={STEP.msf} />}
        {threads > 0 && <Cell label="Threads" value={String(threads)} step={STEP.threads} />}
        {cleanup > 0 && <Cell label="Cleanup" value={String(cleanup)} step={STEP.cleanup} />}
        <Listener step={STEP.lhost} />
      </div>
    </div>
  );
}

/** The exam-sim clock. Pause/resume is a click only, never a key (useTimeboxPause). */
function TimeboxStatus({ engagement: e, now }: { engagement: Engagement & { timeboxMinutes: number }; now: number }) {
  const clock = timeboxNow(e, now);
  const state = timeboxState(e, now);
  const toggle = useTimeboxPause(e.id);
  const paused = state === "paused";
  const of: ReactNode = <span data-drop={STEP.of} className="status-strip__of">of {formatDuration(e.timeboxMinutes)}</span>;
  return (
    <span className="status-cell">
      <span className={labelClass}>Timebox</span>
      {(state === "running" || paused) && (
        <IconButton
          icon={paused ? PlayIcon : PauseIcon}
          label={paused ? "Resume timebox" : "Pause timebox"}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!paused)}
          className="status-strip__pause"
        />
      )}
      <span className={cx("status-strip__time", TIMEBOX_TEXT[state])}>{timeLeft(e.timeboxStart, e.timeboxMinutes, clock)}</span>
      {toggle.isError && !toggle.isPending && (
        <span role="alert" className="status-strip__error">
          {toggle.variables ? "Didn't pause" : "Didn't resume"}
        </span>
      )}
      <span data-drop={STEP.bar} className="status-strip__bar">
        <TimeBar fraction={timeboxElapsed(e.timeboxStart, e.timeboxMinutes, clock)} state={state} />
      </span>
      {of}
    </span>
  );
}
