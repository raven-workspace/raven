import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resyncBoards } from "../features/checklist/ticks";
import { useHostMutations } from "../features/hosts/queries";
import { useLogMutations } from "../features/log/queries";
import { useNotesStore } from "../features/notes/useNotesStore";
import { useServiceMutations } from "../features/services/queries";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry, LogEntryInput } from "../types/log";
import type { Service } from "../types/service";

vi.mock("../lib/api");
vi.mock("../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../features/checklist/ticks")>()),
  resyncBoards: vi.fn(),
}));
const m = vi.mocked(api, true);

function setup() {
  const qc = makeQueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const keys = () => spy.mock.calls.map((c) => c[0]?.queryKey);
  return { wrapper, keys };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resyncBoards).mockResolvedValue(undefined);
  m.engagementGet.mockResolvedValue({ id: "e1", kind: "lab", domain: null, msfHostId: null } as Engagement);
  m.hostsList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
});

describe("cache invalidation (M4)", () => {
  it("log delete invalidates services", async () => {
    m.logDelete.mockResolvedValue(null);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useLogMutations("e1"), { wrapper });
    await act(() => result.current.remove.mutateAsync("l1"));
    expect(keys()).toContainEqual(["services"]);
    expect(keys()).toContainEqual(["log", "e1"]);
    // The ["services"] prefix also covers the engagement-wide list (["services", "engagement", "e1"]).
    expect(keys()).toContainEqual(["checklist", "e1"]);
    expect(keys()).toContainEqual(["hosts", "e1"]);
    // Attempts and grants that cited the entry lose their proof link.
    expect(keys()).toContainEqual(["credAttempts", "e1"]);
    expect(keys()).toContainEqual(["accessGrants", "e1"]);
  });

  it("log update invalidates services", async () => {
    m.logUpdate.mockResolvedValue({ id: "l1", content: { kind: "note", text: "x" }, hostIds: [] } as unknown as LogEntry);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useLogMutations("e1"), { wrapper });
    await act(() => result.current.update.mutateAsync({ id: "l1", input: {} as LogEntryInput }));
    expect(keys()).toContainEqual(["services"]);
  });

  it("log update whose checklist write fails still refreshes the log", async () => {
    m.logUpdate.mockResolvedValue({ id: "l1", content: { kind: "note", text: "x" }, hostIds: [] } as unknown as LogEntry);
    m.checklistList.mockRejectedValue(new Error("db busy"));
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useLogMutations("e1"), { wrapper });
    await act(() => result.current.update.mutateAsync({ id: "l1", input: {} as LogEntryInput }).catch(() => {}));
    expect(keys()).toContainEqual(["log", "e1"]);
    expect(keys()).toContainEqual(["checklist", "e1"]);
  });

  it("service changes invalidate the engagement-wide services list", async () => {
    m.serviceDelete.mockResolvedValue(null);
    m.serviceCreate.mockResolvedValue({} as Service);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useServiceMutations("e1", "h1"), { wrapper });
    await act(() => result.current.remove.mutateAsync("s1"));
    expect(keys()).toContainEqual(["services", "h1"]);
    expect(keys()).toContainEqual(["services", "engagement"]);
  });

  it("host delete invalidates the engagement log", async () => {
    m.hostDelete.mockResolvedValue(null);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useHostMutations("e1"), { wrapper });
    await act(() => result.current.remove.mutateAsync("h1"));
    expect(keys()).toContainEqual(["log", "e1"]);
    expect(keys()).toContainEqual(["hosts", "e1"]);
    expect(keys()).toContainEqual(["checklist", "e1"]);
    expect(keys()).toContainEqual(["services"]);
    // Thread counts; the Metasploit lock the store cleared; tunnels and hops through the host.
    expect(keys()).toContainEqual(["notes", "e1"]);
    expect(keys()).toContainEqual(["engagement", "e1"]);
    expect(keys()).toContainEqual(["tunnels", "e1"]);
    expect(keys()).toContainEqual(["hops", "e1"]);
    // Its test results and grants cascade; credentials and findings lose their link to it.
    expect(keys()).toContainEqual(["credAttempts", "e1"]);
    expect(keys()).toContainEqual(["accessGrants", "e1"]);
    expect(keys()).toContainEqual(["credentials", "e1"]);
    expect(keys()).toContainEqual(["findings", "e1"]);
    // A deleted DC changes which hosts are AD hosts: the board re-syncs.
    await vi.waitFor(() => expect(resyncBoards).toHaveBeenCalledWith("e1"));
  });

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

  it("host create and update invalidate the checklist and services", async () => {
    m.hostCreate.mockResolvedValue({} as Host);
    m.hostUpdate.mockResolvedValue({} as Host);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useHostMutations("e1"), { wrapper });
    await act(() => result.current.create.mutateAsync({ name: "x" }));
    expect(keys()).toContainEqual(["checklist", "e1"]);
    expect(keys()).toContainEqual(["services"]);
    await act(() => result.current.update.mutateAsync({ id: "h1", input: { name: "x" } }));
    // Once for each save, and once more after each resync (it may have written cover rows).
    await vi.waitFor(() => expect(keys().filter((k) => JSON.stringify(k) === JSON.stringify(["checklist", "e1"]))).toHaveLength(4));
  });

  it("changing a host's OS re-syncs the board", async () => {
    m.hostUpdate.mockResolvedValue({} as Host);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useHostMutations("e1"), { wrapper });
    await act(() => result.current.update.mutateAsync({ id: "h1", input: { name: "x", os: "linux" } }));
    await vi.waitFor(() => expect(resyncBoards).toHaveBeenCalledWith("e1"));
    await vi.waitFor(() => expect(keys()).toContainEqual(["hosts", "e1"]));
  });
});
