import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logCommand } from "../features/capture/logCommand";
import { saveCapture } from "../features/capture/saveCapture";
import { syncChecklist, type SyncChange } from "../features/checklist/sync";
import { useCleanup } from "../features/cleanup/queries";
import { useAccessGrantMutations, useAccessGrants, useCredentialMutations, useTriedPairs } from "../features/credentials/queries";
import { useEngagements } from "../features/engagements/queries";
import { useFailedAttempts, useFindings } from "../features/findings/queries";
import { useHostIdentity, useHostMutations, useHosts, useProgress } from "../features/hosts/queries";
import { undoExtraction, useExtractions } from "../features/log/extractions";
import { useLog, useLogMutations } from "../features/log/queries";
import { useNotesStore } from "../features/notes/useNotesStore";
// Loaded for their registrations: a feature's keys are known once its queries module is.
import "../features/checklist/queries";
import "../features/network/queries";
import "../features/services/queries";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import { staleKeys } from "../lib/storeChange";
import type { AccessGrant, CreatedCredential } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Extraction, LogEntry, LogEntryInput } from "../types/log";

vi.mock("../lib/api");
vi.mock("../features/checklist/sync", async (orig) => ({
  ...(await orig<typeof import("../features/checklist/sync")>()),
  syncChecklist: vi.fn(),
}));
vi.mock("../features/capture/saveCapture", async (orig) => ({
  ...(await orig<typeof import("../features/capture/saveCapture")>()),
  saveCapture: vi.fn(),
}));
const m = vi.mocked(api, true);

/** Whether the checklist sync ran for this store change in engagement e1. */
const synced = (change: SyncChange) =>
  vi.mocked(syncChecklist).mock.calls.some(([a]) => a.engagementId === "e1" && JSON.stringify(a.change) === JSON.stringify(change));

function setup() {
  const qc = makeQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(syncChecklist).mockResolvedValue({ rebuilt: 0 });
  m.engagementGet.mockResolvedValue({ id: "e1", kind: "lab", domain: null, msfHostId: null } as Engagement);
  m.engagementsList.mockResolvedValue([]);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.extractionsList.mockResolvedValue([]);
  m.findingsList.mockResolvedValue([]);
  m.failedAttemptsList.mockResolvedValue([]);
  m.accessGrantsList.mockResolvedValue([]);
  m.cleanupList.mockResolvedValue([]);
  m.triedPairsList.mockResolvedValue([]);
  m.hostIdentityGet.mockResolvedValue(null);
});

describe("every feature registers what its queries read", () => {
  it("a host delete reaches keys of eight features, none of them named by the host mutation", () => {
    const keys = staleKeys({ entity: "host", id: "h1", change: "deleted" }).map((k) => k[0]);
    for (const k of ["hosts", "progress", "services", "log", "checklist", "credentials", "credAttempts", "accessGrants", "findings", "failedAttempts", "notes", "engagement", "engagements", "tunnels", "hops", "cleanup", "cleanupCounts"]) {
      expect(keys).toContain(k);
    }
  });
});

describe("views refetch after a write", () => {
  it("log delete refetches the extractions (the entry's extraction cascades)", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => {
      useExtractions("e1");
      return useLogMutations("e1");
    }, { wrapper });
    await waitFor(() => expect(m.extractionsList).toHaveBeenCalledTimes(1));
    await act(() => result.current.remove.mutateAsync("l1"));
    await waitFor(() => expect(m.extractionsList).toHaveBeenCalledTimes(2));
  });

  it("log update whose checklist follow-up fails still refreshes the log", async () => {
    m.logUpdate.mockResolvedValue({ id: "l1", content: { kind: "note", text: "x" }, hostIds: [] } as unknown as LogEntry);
    vi.mocked(syncChecklist).mockRejectedValue(new Error("db busy"));
    const { wrapper } = setup();
    const { result } = renderHook(() => {
      useLog("e1");
      return useLogMutations("e1");
    }, { wrapper });
    await waitFor(() => expect(m.logList).toHaveBeenCalledTimes(1));
    await act(() => result.current.update.mutateAsync({ id: "l1", input: {} as LogEntryInput }).catch(() => {}));
    await waitFor(() => expect(m.logList).toHaveBeenCalledTimes(2));
  });

  it("undoing a save refetches findings, failed attempts, access grants and cleanup (a filed host's delete cascades)", async () => {
    m.extractionUndo.mockResolvedValue({ engagementId: "e1" } as Extraction);
    const { qc, wrapper } = setup();
    renderHook(() => {
      useFindings("e1");
      useFailedAttempts("e1");
      useAccessGrants("e1");
      useCleanup("e1");
    }, { wrapper });
    const lists = [m.findingsList, m.failedAttemptsList, m.accessGrantsList, m.cleanupList];
    await waitFor(() => lists.forEach((l) => expect(l).toHaveBeenCalledTimes(1)));
    await act(() => undoExtraction(qc, "l1"));
    await waitFor(() => lists.forEach((l) => expect(l).toHaveBeenCalledTimes(2)));
  });

  it("a capture save refetches what it filed: tried pairs, extractions, identity", async () => {
    vi.mocked(saveCapture).mockResolvedValue({ entry: { id: "l1" } as LogEntry, summary: null } as Awaited<ReturnType<typeof saveCapture>>);
    const { qc, wrapper } = setup();
    renderHook(() => {
      useTriedPairs("e1");
      useExtractions("e1");
      useHostIdentity("h1");
    }, { wrapper });
    const lists = [m.triedPairsList, m.extractionsList, m.hostIdentityGet];
    await waitFor(() => lists.forEach((l) => expect(l).toHaveBeenCalledTimes(1)));
    const host = { id: "h1", name: "DC01" } as Host;
    await act(() => logCommand(qc, { engagementId: "e1", host, hosts: [host], title: "t", command: "id", ranOn: "" }).then(() => undefined));
    await waitFor(() => lists.forEach((l) => expect(l).toHaveBeenCalledTimes(2)));
  });

  it("a credential write refetches the tried pairs", async () => {
    m.credentialCreate.mockResolvedValue({ credential: { id: "c1" }, existed: false } as CreatedCredential);
    const { wrapper } = setup();
    const { result } = renderHook(() => {
      useTriedPairs("e1");
      return useCredentialMutations("e1");
    }, { wrapper });
    await waitFor(() => expect(m.triedPairsList).toHaveBeenCalledTimes(1));
    await act(() => result.current.create.mutateAsync({ type: "password", username: "jay", secret: "x" } as Parameters<typeof result.current.create.mutateAsync>[0]).then(() => undefined));
    await waitFor(() => expect(m.triedPairsList).toHaveBeenCalledTimes(2));
  });

  it("host delete refetches the dashboard's engagements and progress, and the engagement's log", async () => {
    m.hostDelete.mockResolvedValue(null);
    const { wrapper } = setup();
    const { result } = renderHook(() => {
      useEngagements();
      useProgress();
      useLog("e1");
      return useHostMutations("e1");
    }, { wrapper });
    const lists = [m.engagementsList, m.engagementsProgress, m.logList];
    await waitFor(() => lists.forEach((l) => expect(l).toHaveBeenCalledTimes(1)));
    await act(() => result.current.remove.mutateAsync("h1"));
    // At least once more: a host delete leaves the hosts (and so progress) stale.
    await waitFor(() => lists.forEach((l) => expect(l.mock.calls.length).toBeGreaterThanOrEqual(2)));
    // A deleted DC changes which hosts are AD hosts: the board re-syncs.
    await waitFor(() => expect(synced({ entity: "host", id: "h1", change: "deleted" })).toBe(true));
  });
});

describe("writes run the checklist sync", () => {
  it("host delete drops that host's unsaved note text only", async () => {
    m.hostDelete.mockResolvedValue(null);
    useNotesStore.setState({
      pending: {
        "e1:h1": { engagementId: "e1", hostId: "h1", body: "? gone", private: false },
        "e1:h2": { engagementId: "e1", hostId: "h2", body: "? kept", private: false },
        "e1:": { engagementId: "e1", hostId: null, body: "? kept too", private: false },
      },
      errors: { "e1:h1": "not found" },
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useHostMutations("e1"), { wrapper });
    await act(() => result.current.remove.mutateAsync("h1"));
    expect(Object.keys(useNotesStore.getState().pending).sort()).toEqual(["e1:", "e1:h2"]);
    expect(useNotesStore.getState().errors).toEqual({});
    useNotesStore.setState({ pending: {}, errors: {} });
  });

  it("access grant create and delete re-sync the board, which reports its writes to the same query client", async () => {
    m.accessGrantCreate.mockResolvedValue({ id: "g1" } as AccessGrant);
    m.accessGrantDelete.mockResolvedValue(null);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => {
      useHosts("e1");
      return useAccessGrantMutations("e1");
    }, { wrapper });
    await waitFor(() => expect(m.hostsList).toHaveBeenCalledTimes(1));
    await act(() => result.current.create.mutateAsync({ usernameId: "u1", grant: { hostId: "h1", level: "admin", via: "winrm" } }).then(() => undefined));
    await waitFor(() => expect(synced({ entity: "accessGrant", id: "g1", change: "created" })).toBe(true));
    expect(vi.mocked(syncChecklist).mock.calls.every(([a]) => a.qc === qc)).toBe(true);

    await act(() => result.current.remove.mutateAsync("g1"));
    await waitFor(() => expect(synced({ entity: "accessGrant", id: "g1", change: "deleted" })).toBe(true));
  });

  it("changing a host's OS re-syncs the board", async () => {
    m.hostUpdate.mockResolvedValue({} as Host);
    const { wrapper } = setup();
    const { result } = renderHook(() => useHostMutations("e1"), { wrapper });
    await act(() => result.current.update.mutateAsync({ id: "h1", input: { name: "x", os: "linux" } }).then(() => undefined));
    await waitFor(() => expect(synced({ entity: "host", id: "h1", change: "updated" })).toBe(true));
  });
});
