import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIRM_MS } from "../../../features/arsenal/copyGuard";
import { useManualStatus } from "../../../features/manual/useManualStatus";

const status = () => useManualStatus.getState();

describe("the Manual's status line", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    status().clear();
  });
  afterEach(() => {
    status().clear();
    vi.useRealTimers();
  });

  it("clears itself after the copy guard's confirm wait, for every tone", () => {
    for (const tone of ["ok", "warn", "muted"] as const) {
      status().set(`said ${tone}`, tone);
      expect(status()).toMatchObject({ text: `said ${tone}`, tone });
      vi.advanceTimersByTime(CONFIRM_MS - 1);
      expect(status().text).toBe(`said ${tone}`);
      vi.advanceTimersByTime(1);
      expect(status()).toMatchObject({ text: null, tone: "ok" });
    }
  });

  it("a newer line restarts the wait", () => {
    status().set("first", "ok");
    vi.advanceTimersByTime(CONFIRM_MS - 500);
    status().set("second", "warn");
    vi.advanceTimersByTime(CONFIRM_MS - 1);
    expect(status()).toMatchObject({ text: "second", tone: "warn" });
    vi.advanceTimersByTime(1);
    expect(status().text).toBeNull();
  });

  it("clear stops the wait: a line set after it keeps its full time", () => {
    status().set("first", "ok");
    vi.advanceTimersByTime(CONFIRM_MS - 10);
    status().clear();
    expect(status().text).toBeNull();
    status().set("again", "ok");
    vi.advanceTimersByTime(CONFIRM_MS - 1);
    expect(status().text).toBe("again");
  });
});
