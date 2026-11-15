import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePayloadFit } from "../../../features/payloads/usePayloadFit";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";

vi.mock("../../../lib/api");
const fillBase = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../../features/palette/fillData", () => ({ useFillBase: () => fillBase.current }));
const m = vi.mocked(api, true);

// Synthetic fixtures only (RFC 5737 addresses, invented names).
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "exam-sim", client: null, subLabel: null, scopeCidrs: ["192.0.2.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const H: Host = {
  id: "h1", engagementId: "e1", name: "zzlin01", ip: "192.0.2.20", os: "linux", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const base = (examReady: boolean) => ({
  d: { hosts: [H], services: [], log: [], settings: undefined, engagement: examReady ? E1 : undefined },
  host: H, engagement: examReady ? E1 : { ...E1, id: "", kind: "lab" }, examReady,
});

function hook() {
  const qc = makeQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => usePayloadFit("e1", "h1"), { wrapper });
}

describe("usePayloadFit fails closed", () => {
  beforeEach(() => m.payloadBuildsList.mockResolvedValue([]));

  it("ranks no payloads until the engagement (so its kind) is known", () => {
    fillBase.current = base(false);
    const { result } = hook();
    expect(result.current.ranked.shell).toBeNull();
    expect(result.current.ranked.msfvenom).toBeNull();
  });

  it("ranks once it is known", () => {
    fillBase.current = base(true);
    const { result } = hook();
    expect(result.current.ranked.shell?.fits.length).toBeGreaterThan(0);
    expect(result.current.ranked.msfvenom?.fits.length).toBeGreaterThan(0);
  });
});
