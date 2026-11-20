import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveSummary } from "../../../features/capture/SaveSummary";
import { useSaveSummaryStore } from "../../../features/capture/useSaveSummaryStore";
import { afterEntrySaved } from "../../../features/checklist/ticks";
import { ExtractedLine } from "../../../features/log/ExtractedLine";
import { extractionsKey, invalidateAfterSave } from "../../../features/log/extractions";
import { triedPairsKey } from "../../../features/credentials/queries";
import { api } from "../../../lib/api";
import type { Extraction, ExtractionSummary, LogEntry } from "../../../types/log";

vi.mock("../../../lib/api");
vi.mock("../../../features/checklist/ticks", () => ({ afterEntrySaved: vi.fn() }));
const m = vi.mocked(api, true);

const SUMMARY: ExtractionSummary = { wins: ["2 hashes dumped"], counts: ["+3 services"], ticks: ["Ticked 'Dump hashes' on DC01"] };
const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  logEntryId: "l1", engagementId: "e1", summary: SUMMARY, createdAt: 1, undoneAt: null,
  record: {
    createdHostIds: [], createdServiceIds: [], servicesBefore: [], hostOsBefore: [], identityBefore: [], createdCredentialIds: [],
    credentialsBefore: [], createdUsernameIds: [], createdAttemptIds: [], attemptsBefore: [], createdTriedPairIds: [], createdVectorIds: [], outputTicks: [],
    reprovedCredentialIds: [], reprovedUsernameIds: [],
  },
  ...over,
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const show = () => act(() => useSaveSummaryStore.getState().show("l1", SUMMARY));

beforeEach(() => {
  vi.useFakeTimers();
  useSaveSummaryStore.getState().close();
  m.extractionUndo.mockResolvedValue(extraction({ undoneAt: 2 }));
  m.extractionsList.mockResolvedValue([]);
  vi.mocked(afterEntrySaved).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("save summary toast", () => {
  it("closes after 5000ms", () => {
    wrap(<SaveSummary />);
    show();
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(4999));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hover pauses the timer", () => {
    wrap(<SaveSummary />);
    show();
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => void vi.advanceTimersByTime(20000));
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaving with the mouse while focus is inside keeps the timer held; blur then resumes it", () => {
    wrap(<SaveSummary />);
    show();
    const toast = screen.getByRole("status");
    const undo = screen.getByRole("button", { name: "Undo" });
    fireEvent.mouseEnter(toast);
    fireEvent.focus(undo);
    fireEvent.mouseLeave(toast);
    act(() => void vi.advanceTimersByTime(20000));
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.blur(undo);
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("X closes at once", () => {
    wrap(<SaveSummary />);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Close summary" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("wins render with the accent class before counts", () => {
    wrap(<SaveSummary />);
    show();
    const win = screen.getByText("2 hashes dumped");
    const count = screen.getByText("+3 services");
    expect(win).toHaveClass("save-summary__win");
    expect(count).not.toHaveClass("save-summary__win");
    expect(win.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Ticked 'Dump hashes' on DC01")).not.toHaveClass("save-summary__win");
  });

  it("Undo calls extractionUndo then afterEntrySaved", async () => {
    wrap(<SaveSummary />);
    show();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    expect(m.extractionUndo).toHaveBeenCalledWith("l1");
    expect(afterEntrySaved).toHaveBeenCalledWith("e1", null, "l1");
    expect(m.extractionUndo.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(afterEntrySaved).mock.invocationCallOrder[0]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("no summary means no toast", () => {
    wrap(<SaveSummary />);
    act(() => useSaveSummaryStore.getState().show("l1", null));
    act(() => useSaveSummaryStore.getState().show("l1", { wins: [], counts: [], ticks: [] }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("ExtractedLine", () => {
  const entry = { id: "l1", engagementId: "e1" } as LogEntry;

  it("collapses to the first win with the rest counted, and expands", async () => {
    vi.useRealTimers();
    m.extractionsList.mockResolvedValue([extraction()]);
    wrap(<ExtractedLine entry={entry} />);
    expect(await screen.findByText("2 hashes dumped")).toHaveClass("extracted-line__win");
    expect(screen.getByText(", +2 more", { exact: false })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("+3 services")).toBeInTheDocument();
    // And collapses again.
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("+3 services")).toBeNull();
    expect(screen.getByText(", +2 more", { exact: false })).toBeInTheDocument();
  });

  it("shows undone state", async () => {
    vi.useRealTimers();
    m.extractionsList.mockResolvedValue([extraction({ undoneAt: 5 })]);
    wrap(<ExtractedLine entry={entry} />);
    expect(await screen.findByText("Extracted (undone)")).toHaveClass("extracted-line__undone");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("invalidateAfterSave", () => {
  it("invalidates the extractions and tried-pairs keys with the rest", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    invalidateAfterSave(qc, "e1");
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(extractionsKey("e1"));
    expect(keys).toContainEqual(triedPairsKey("e1"));
    expect(keys).toContainEqual(["log", "e1"]);
  });
});
