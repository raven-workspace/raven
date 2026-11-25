import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCredFor, defaultDomainCred, fillCommand, resolveCred } from "../engines/checklist";
import { useCredFill, useCredPickStore } from "../features/checklist/credPick";
import { useFillBase } from "../features/commands/fillData";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { CredAttempt, Credential } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const H: Host = {
  id: "h", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const cred = (o: Partial<Credential> & { id: string }): Credential => ({
  engagementId: "e1", type: "password", username: "", domain: null, secret: "", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...o,
});
const att = (c: Credential, hostId: string, at: number, authMode: CredAttempt["authMode"] = "domain"): CredAttempt => ({
  id: `${c.id}-${hostId}-${at}`, engagementId: "e1", credId: c.id, usernameId: null, hostId, service: "smb", port: null,
  result: "valid", authMode, detail: null, logEntryId: null, at,
});

const HASH_ADMIN = cred({ id: "ha", type: "hash", username: "admin", secret: "8846f7eaee8fb117ad06bdd830b7586c", hashType: "NTLM" });
const PW_SVC = cred({ id: "pw", username: "svc", secret: "Winter2024!" });
const H1 = cred({ id: "h1", type: "hash", username: "a", secret: "aa" });
const H2 = cred({ id: "h2", type: "hash", username: "b", secret: "bb" });

describe("credential defaults", () => {
  it("prefers a valid password over a newer valid hash on the host", () => {
    expect(defaultCredFor({ id: "h" }, [HASH_ADMIN, PW_SVC], [att(HASH_ADMIN, "h", 20), att(PW_SVC, "h", 10)])!.id).toBe(PW_SVC.id);
  });
  it("falls back to the newest when none has a password", () => {
    expect(defaultCredFor({ id: "h" }, [H1, H2], [att(H1, "h", 1), att(H2, "h", 2)])!.id).toBe(H2.id);
  });
  it("domain default prefers a password too", () => {
    expect(defaultDomainCred([HASH_ADMIN, PW_SVC], [att(HASH_ADMIN, "h", 20), att(PW_SVC, "x", 10)])!.id).toBe(PW_SVC.id);
  });
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function setupApi() {
  useCredPickStore.getState().reset();
  m.settingsGet.mockResolvedValue({ attackerIp: "10.0.0.1", kaliUser: "kali", listenerPort: "4444" } as never);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsList.mockResolvedValue([E1]);
  m.hostsList.mockResolvedValue([H]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([HASH_ADMIN, PW_SVC]);
  m.credAttemptsList.mockResolvedValue([att(HASH_ADMIN, "h", 20), att(PW_SVC, "h", 10)]);
  m.logList.mockResolvedValue([]);
}

describe("useFillBase credential", () => {
  beforeEach(setupApi);

  it("a deleted pick falls back to the default", async () => {
    useCredPickStore.setState({ picks: { h: "gone" } });
    const { result } = renderHook(() => useFillBase("e1", "h"), { wrapper });
    await waitFor(() => expect(result.current.cred?.id).toBe("pw"));
    expect(result.current.credOwnerId).toBe("h");
  });

  it("no host: cred is the engagement's domain default and fills USER", async () => {
    const { result } = renderHook(() => useFillBase("e1", null), { wrapper });
    await waitFor(() => expect(result.current.cred?.id).toBe("pw"));
    expect(result.current.credOwnerId).toBe("e1");
    expect(fillCommand("{USER}", result.current.makeInput({})).text).toBe("svc");
  });

  it("no host: a pick keyed by the engagement wins", async () => {
    useCredPickStore.setState({ picks: { e1: "ha" } });
    const { result } = renderHook(() => useFillBase("e1", null), { wrapper });
    await waitFor(() => expect(result.current.cred?.id).toBe("ha"));
  });
});

describe("host with no attempts falls back to the domain default", () => {
  beforeEach(setupApi);

  it("resolveCred", () => {
    const other = att(PW_SVC, "elsewhere", 5);
    expect(resolveCred(undefined, [PW_SVC], [other], { id: "fs01" })!.id).toBe("pw");
    expect(resolveCred(null, [PW_SVC], [other], { id: "fs01" })).toBeNull();
    expect(resolveCred("gone", [PW_SVC], [other], { id: "fs01" })!.id).toBe("pw");
  });

  it("useCredFill (host scope)", async () => {
    m.credentialsList.mockResolvedValue([PW_SVC]);
    m.credAttemptsList.mockResolvedValue([att(PW_SVC, "elsewhere", 5)]);
    const { result } = renderHook(() => useCredFill("e1", { id: "fs01" }), { wrapper });
    await waitFor(() => expect(result.current.cred?.id).toBe("pw"));
  });

  it("useFillBase (host with no attempts)", async () => {
    m.credentialsList.mockResolvedValue([PW_SVC]);
    m.credAttemptsList.mockResolvedValue([att(PW_SVC, "elsewhere", 5)]);
    const { result } = renderHook(() => useFillBase("e1", "h"), { wrapper });
    await waitFor(() => expect(result.current.cred?.id).toBe("pw"));
  });
});
