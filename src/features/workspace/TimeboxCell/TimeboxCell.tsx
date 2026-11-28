import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { cx } from "../../../lib/cx";
import type { Engagement } from "../../../types/engagement";
import { IconButton, labelClass } from "../../../ui/index";
import { TIMEBOX_TEXT } from "../../engagements/ActiveCard/ActiveCard";
import { formatDuration, timeLeft, timeboxElapsed, timeboxNow, timeboxState, type TimeboxState } from "../../engagements/format";
import { useTimeboxPause } from "../../engagements/queries";
import "../../engagements/ActiveCard/ActiveCard.scss";
import "./TimeboxCell.scss";

/** The ring's circumference: 2π × 6, the radius in a 16 × 16 box. */
const CIRCUMFERENCE = 37.7;

/** What the ring says to a screen reader: the total lives here now that "of 24h" is gone. */
export function ringLabel(state: TimeboxState, fraction: number, minutes: number): string {
  const h = minutes / 60;
  const total = Number.isInteger(h) ? `${h} ${h === 1 ? "hour" : "hours"}` : formatDuration(minutes);
  if (state === "not-started") return "Not started";
  if (state === "over") return `${total} used`;
  const used = `${Math.round(fraction * 100)}% of ${total} used`;
  return state === "paused" ? `${used}, paused` : used;
}

/** The timebox as a progress ring (design §1.5): fills clockwise from 12 o'clock as time is used, coloured by state. */
export function TimeRing({ fraction, state, label }: { fraction: number; state: TimeboxState; label: string }) {
  const used = state === "over" ? 1 : fraction;
  return (
    <svg role="img" aria-label={label} width="16" height="16" viewBox="0 0 16 16" className="time-ring">
      <circle cx="8" cy="8" r="6" className="time-ring__track" />
      {state !== "not-started" && (
        <circle
          cx="8"
          cy="8"
          r="6"
          strokeDasharray={`${(used * CIRCUMFERENCE).toFixed(2)} ${CIRCUMFERENCE}`}
          className={`time-ring__used time-ring__used--${state}`}
        />
      )}
    </svg>
  );
}

/**
 * The exam sim's clock at the status bar's right end (design §1.5, §1.6): label, Pause/Resume while running or paused
 * (a click only, never a key), the ring, then the time left. Never drops.
 */
export function TimeboxCell({ engagement: e, now }: { engagement: Engagement & { timeboxMinutes: number }; now: number }) {
  const clock = timeboxNow(e, now);
  const state = timeboxState(e, now);
  const fraction = timeboxElapsed(e.timeboxStart, e.timeboxMinutes, clock);
  const toggle = useTimeboxPause(e.id);
  const paused = state === "paused";
  return (
    <span role="group" aria-label="Timebox" className="timebox-cell">
      <span className={labelClass}>Timebox</span>
      {(state === "running" || paused) && (
        <IconButton
          icon={paused ? PlayIcon : PauseIcon}
          label={paused ? "Resume timebox" : "Pause timebox"}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!paused)}
          className="timebox-cell__pause"
        />
      )}
      <TimeRing fraction={fraction} state={state} label={ringLabel(state, fraction, e.timeboxMinutes)} />
      <span className={cx("timebox-cell__time", TIMEBOX_TEXT[state])}>{timeLeft(e.timeboxStart, e.timeboxMinutes, clock)}</span>
      {toggle.isError && !toggle.isPending && (
        <span role="alert" className="timebox-cell__error">
          {toggle.variables ? "Didn't pause" : "Didn't resume"}
        </span>
      )}
    </span>
  );
}
