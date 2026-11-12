import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportNode } from "../engines/report";
import { discardReports, flushReports, hasPendingReports, queueReportSave, useReportSaveStore } from "../features/report/saveQueue";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { ReportSection } from "../types/report";

vi.mock("../lib/api");
const m = vi.mocked(api, true);
const qc = makeQueryClient();
const SAVED = {} as ReportSection;
const page = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }) as unknown as ReportNode;
const sentTexts = () => m.reportSectionSave.mock.calls.map(([id, doc]) => `${id}:${JSON.stringify(doc).match(/"text":"([^"]*)"/)![1]}`);

beforeEach(() => {
  vi.resetAllMocks();
  m.reportSectionSave.mockResolvedValue(SAVED);
});
afterEach(() => {
  discardReports();
  vi.useRealTimers();
});

describe("report save queue", () => {
  it("retries a failed write after 2 s, 5 s, 15 s, then every 30 s, and stops once it lands", async () => {
    vi.useFakeTimers();
    m.reportSectionSave.mockRejectedValue(new Error("disk full"));
    queueReportSave(qc, "s1", page("one"), {});
    await vi.advanceTimersByTimeAsync(600);
    expect(m.reportSectionSave).toHaveBeenCalledTimes(1);
    expect(useReportSaveStore.getState().unsaved).toBe(true);

    for (const [wait, calls] of [[2_000, 2], [5_000, 3], [15_000, 4], [30_000, 5], [30_000, 6]] as const) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(m.reportSectionSave).toHaveBeenCalledTimes(calls - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(m.reportSectionSave).toHaveBeenCalledTimes(calls);
    }

    m.reportSectionSave.mockResolvedValue(SAVED);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(m.reportSectionSave).toHaveBeenCalledTimes(7);
    expect(useReportSaveStore.getState().unsaved).toBe(false);
    expect(hasPendingReports()).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(m.reportSectionSave).toHaveBeenCalledTimes(7);
  });

  it("sends only the newest write queued behind one on its way, once it settles", async () => {
    let release: () => void = () => {};
    m.reportSectionSave.mockImplementationOnce(() => new Promise((r) => (release = () => r(SAVED))));
    queueReportSave(qc, "s1", page("one"), {});
    const first = flushReports();
    queueReportSave(qc, "s1", page("two"), {});
    queueReportSave(qc, "s1", page("three"), {});
    const second = flushReports();
    await Promise.resolve();
    expect(sentTexts()).toEqual(["s1:one"]);
    release();
    await Promise.all([first, second]);
    expect(sentTexts()).toEqual(["s1:one", "s1:three"]);
    expect(hasPendingReports()).toBe(false);
  });

  it("a lock's flush still sends a write queued behind one on its way, though the queue is discarded", async () => {
    let release: () => void = () => {};
    m.reportSectionSave.mockImplementationOnce(() => new Promise((r) => (release = () => r(SAVED))));
    queueReportSave(qc, "s1", page("one"), {});
    void flushReports();
    queueReportSave(qc, "s1", page("last words"), {});
    // What VaultGate's lock does: flush, then discard at once.
    const saved = flushReports();
    discardReports();
    expect(hasPendingReports()).toBe(false);
    release();
    await saved;
    expect(sentTexts()).toEqual(["s1:one", "s1:last words"]);
  });

  it("a write failing after a lock schedules no retry", async () => {
    vi.useFakeTimers();
    m.reportSectionSave.mockRejectedValue(new Error("locked"));
    queueReportSave(qc, "s1", page("one"), {});
    const saved = flushReports();
    discardReports();
    await saved;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.reportSectionSave).toHaveBeenCalledTimes(1);
    expect(useReportSaveStore.getState().unsaved).toBe(false);
  });
});
