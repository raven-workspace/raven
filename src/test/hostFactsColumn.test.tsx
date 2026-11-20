import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FactsColumn } from "../features/hosts/facts/FactsColumn/FactsColumn";
import { hostCredentialCounts } from "../features/hosts/facts/HostCredentialsFacts/HostCredentialsFacts";
import { useServiceMutations } from "../features/services/queries";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { AccessGrant, CredAttempt } from "../types/credentials";
import type { Host } from "../types/host";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "vulnerability-detection",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
  access: "none", createdAt: 1, updatedAt: 1,
};

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  m.servicesList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.usernamesList.mockResolvedValue([]);
  m.accessGrantsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.hostsList.mockResolvedValue([H1]);
});

const mountColumn = (variant: "column" | "stacked") =>
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <FactsColumn engagementId="e1" host={H1} variant={variant} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("FactsColumn variants", () => {
  it("column opens the current phase's groups; the others stay folded", async () => {
    mountColumn("column");
    const services = await screen.findByRole("button", { name: /Services/ });
    expect(services).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Who am I/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("stacked folds every group", async () => {
    mountColumn("stacked");
    await screen.findByRole("button", { name: /Services/ });
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });
});

describe("hostCredentialCounts", () => {
  const at = (id: string, usernameId: string | null, result: CredAttempt["result"]): CredAttempt => ({
    id, engagementId: "e1", credId: `c-${id}`, usernameId, hostId: "h1", service: "smb", port: 445, result, authMode: "domain",
    detail: null, logEntryId: null, at: 1,
  });
  const grant = (id: string, usernameId: string, hostId = "h1"): AccessGrant => ({
    id, engagementId: "e1", usernameId, hostId, level: "user", via: "ssh key", logEntryId: null, at: 1,
  });

  it("a grant for a username that already has a working result here counts once", () => {
    const got = hostCredentialCounts(H1, [], [], [at("a", "u1", "valid")], [grant("g1", "u1")]);
    expect(got.works).toBe(1);
  });
  it("a grant for another username, or on another host, still counts", () => {
    const got = hostCredentialCounts(H1, [], [], [at("a", "u1", "admin")], [grant("g1", "u2"), grant("g2", "u1", "h2")]);
    expect(got.works).toBe(2);
  });
  it("failed and errored results do not work", () => {
    expect(hostCredentialCounts(H1, [], [], [at("a", "u1", "failed"), at("b", "u2", "errored")], [grant("g1", "u1")]).works).toBe(1);
  });
});

describe("service delete refreshes ruled-out items", () => {
  it("invalidates the ruled-out and notes queries", async () => {
    m.serviceDelete.mockResolvedValue(null);
    const qc: QueryClient = makeQueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useServiceMutations("e1", "h1"), { wrapper });
    result.current.remove.mutate("s1");
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["ruledOut", "e1"] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["notes", "e1"] });
  });
});
