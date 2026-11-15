import { describe, expect, it } from "vitest";
import { timeLeft, timeboxElapsed, timeboxNow, timeboxState } from "../features/engagements/format";
import { reportDueAt } from "../engines/report/meta";
import type { Engagement } from "../types/engagement";

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = 1_000 * HOUR;

const sim = (over: Partial<Engagement> = {}): Engagement => ({
  id: "e", name: "Sim", kind: "exam-sim", client: null, subLabel: null, scopeCidrs: [], domain: null, startsAt: null,
  endsAt: null, timeboxStart: START, timeboxMinutes: 1425, status: "active", createdAt: 0, updatedAt: 0,
  lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null, ...over,
});
const left = (e: Engagement, now: number) => timeLeft(e.timeboxStart, e.timeboxMinutes!, timeboxNow(e, now));
const state = (e: Engagement, now: number) => timeboxState({ ...e, timeboxMinutes: e.timeboxMinutes! }, now);

describe("timebox pause", () => {
  it("a running timebox counts real time", () => {
    const e = sim();
    expect(left(e, START + 2 * HOUR)).toBe("21h 45m left");
    expect(state(e, START + 2 * HOUR)).toBe("running");
  });

  it("a paused timebox freezes at the moment it paused", () => {
    const e = sim({ timeboxPausedAt: START + 2 * HOUR });
    expect(left(e, START + 2 * HOUR)).toBe("21h 45m left");
    expect(left(e, START + 30 * HOUR)).toBe("21h 45m left");
    expect(state(e, START + 30 * HOUR)).toBe("paused");
    expect(timeboxElapsed(e.timeboxStart, 1425, timeboxNow(e, START + 30 * HOUR))).toBeCloseTo(120 / 1425);
  });

  it("after resuming, it carries on where it left off", () => {
    // Paused 10 hours overnight, resumed, then 1 more hour of work.
    const e = sim({ timeboxPausedMs: 10 * HOUR });
    expect(left(e, START + 13 * HOUR)).toBe("20h 45m left");
    expect(state(e, START + 13 * HOUR)).toBe("running");
  });

  it("not started and time's up states", () => {
    expect(state(sim({ timeboxStart: null }), START)).toBe("not-started");
    expect(state(sim(), START - HOUR)).toBe("not-started");
    expect(state(sim(), START + 24 * HOUR)).toBe("over");
    expect(state(sim({ timeboxPausedMs: 2 * HOUR }), START + 24 * HOUR)).toBe("running");
  });

  it("the report deadline moves back by the time spent paused", () => {
    const end = START + 1425 * MIN + 24 * HOUR;
    expect(reportDueAt(sim(), {} as never, START)).toBe(end);
    expect(reportDueAt(sim({ timeboxPausedMs: 3 * HOUR }), {} as never, START)).toBe(end + 3 * HOUR);
    expect(reportDueAt(sim({ timeboxPausedMs: HOUR, timeboxPausedAt: START + 5 * HOUR }), {} as never, START + 7 * HOUR)).toBe(end + 3 * HOUR);
  });
});
