import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHostMutations } from "../features/hosts/queries";
import { useLogMutations } from "../features/log/queries";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { LogEntry, LogEntryInput } from "../types/log";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

function setup() {
  const qc = makeQueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const keys = () => spy.mock.calls.map((c) => c[0]?.queryKey);
  return { wrapper, keys };
}

beforeEach(() => vi.resetAllMocks());

describe("cache invalidation (M4)", () => {
  it("log delete invalidates services", async () => {
    m.logDelete.mockResolvedValue(null);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useLogMutations("e1"), { wrapper });
    await act(() => result.current.remove.mutateAsync("l1"));
    expect(keys()).toContainEqual(["services"]);
    expect(keys()).toContainEqual(["log", "e1"]);
  });

  it("log update invalidates services", async () => {
    m.logUpdate.mockResolvedValue({} as LogEntry);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useLogMutations("e1"), { wrapper });
    await act(() => result.current.update.mutateAsync({ id: "l1", input: {} as LogEntryInput }));
    expect(keys()).toContainEqual(["services"]);
  });

  it("host delete invalidates the engagement log", async () => {
    m.hostDelete.mockResolvedValue(null);
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useHostMutations("e1"), { wrapper });
    await act(() => result.current.remove.mutateAsync("h1"));
    expect(keys()).toContainEqual(["log", "e1"]);
    expect(keys()).toContainEqual(["hosts", "e1"]);
  });
});
