import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logCommand } from "../../../features/capture/logCommand";
import { PartialSaveError, saveCapture } from "../../../features/capture/saveCapture";
import { useSaveSummaryStore } from "../../../features/capture/useSaveSummaryStore";
import type { Host } from "../../../types/host";
import type { ExtractionSummary, LogEntry } from "../../../types/log";

vi.mock("../../../features/capture/saveCapture", async (orig) => ({
  ...(await orig<typeof import("../../../features/capture/saveCapture")>()),
  saveCapture: vi.fn(),
}));

const HOST = { id: "h1", name: "DC01", ip: "10.10.1.5" } as Host;
const ENTRY = { id: "l1", engagementId: "e1" } as LogEntry;
const SUMMARY: ExtractionSummary = { wins: [], counts: ["2 services updated on DC01"], ticks: [] };
const args = { engagementId: "e1", host: HOST, hosts: [HOST], title: "t", command: "nmap 10.10.1.5", ranOn: "Kali (VM)" };

beforeEach(() => useSaveSummaryStore.getState().close());

describe("logCommand", () => {
  it("a partial save that stored an extraction still shows its summary, then rethrows", async () => {
    const err = new PartialSaveError(ENTRY, new Error("locked"), "Saved the entry, but the checklist didn't update.", undefined, SUMMARY);
    vi.mocked(saveCapture).mockRejectedValue(err);
    await expect(logCommand(new QueryClient(), args)).rejects.toBe(err);
    expect(useSaveSummaryStore.getState().current).toEqual({ entryId: "l1", summary: SUMMARY });
  });

  it("a partial save with nothing stored shows no summary", async () => {
    vi.mocked(saveCapture).mockRejectedValue(new PartialSaveError(ENTRY, new Error("locked")));
    await expect(logCommand(new QueryClient(), args)).rejects.toBeInstanceOf(PartialSaveError);
    expect(useSaveSummaryStore.getState().current).toBeNull();
  });
});
