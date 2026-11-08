import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { api, resetAuditState, scenarioFromSearch, setAuditScenario } from "../../audit/fakeApi";
import { RavenError } from "../../types/errors";
import { AUDIT_PNGS } from "../../audit/images";
import { makeQueryClient } from "../../lib/queryClient";

vi.mock("../../lib/api", () => import("../../audit/fakeApi"));

afterEach(() => resetAuditState());

describe("audit fake api", () => {
  it("implements every Api command", async () => {
    const real = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
    expect(Object.keys(api).sort()).toEqual(Object.keys(real.api).sort());
  });

  it("serves verdicts, identity and vectors, and links dead ends to ruled-out items", async () => {
    const web = await api.servicesList("h-web");
    expect(web.filter((s) => s.verdict !== null).map((s) => s.verdict).sort()).toEqual(["candidate", "dead_end", "untested"]);
    const dead = web.find((s) => s.verdict === "dead_end")!;
    expect((await api.ruledOutList("e-lab")).some((r) => r.sourceKind === "service" && r.sourceId === dead.id)).toBe(true);
    await expect(api.serviceSetVerdict(dead.id, "dead_end", " ")).rejects.toBeInstanceOf(RavenError);
    await api.serviceSetVerdict(dead.id, "candidate");
    const left = await api.ruledOutList("e-lab");
    expect(left.some((r) => r.sourceId === dead.id)).toBe(false);
    expect(left.some((r) => r.id === "r-1")).toBe(true);

    const id = await api.hostIdentityGet("h-exam-ms01");
    expect(id?.username).toBe("ms01\\iis_apppool");
    expect(id?.privileges).toContain("SeImpersonatePrivilege");
    expect(await api.hostIdentityGet("h-web")).toBeNull();
    expect(await api.vectorsList("h-exam-ms01")).toHaveLength(2);
  });

  it("round-trips a logged payload's id and values, and serves the failed nc.exe entry", async () => {
    const created = await api.logCreate("e-pay", {
      title: "PowerShell base64 (-e) · 198.51.100.20", hostIds: ["h-pay-iis"], ranOn: "Kali (VM)",
      observations: null, returnedNothing: false, private: false,
      content: { kind: "command", blocks: [{ command: "powershell -nop -w hidden -e AAAA", output: "" }] },
      payloadId: "ps-b64", payloadValues: { LHOST: "192.0.2.10", LPORT: "443" },
    });
    expect(created).toMatchObject({ payloadId: "ps-b64", payloadValues: { LHOST: "192.0.2.10", LPORT: "443" } });
    const listed = (await api.logList("e-pay")).find((e) => e.id === created.id)!;
    expect(listed).toMatchObject({ payloadId: "ps-b64", payloadValues: { LHOST: "192.0.2.10", LPORT: "443" } });
    // An update that leaves them out keeps them.
    const { ranOn, hostIds, observations, returnedNothing, content } = listed;
    const updated = await api.logUpdate(created.id, { title: "renamed", ranOn, hostIds, observations, returnedNothing, private: false, content });
    expect(updated).toMatchObject({ title: "renamed", payloadId: "ps-b64" });

    const failed = (await api.logList("e-pay")).find((e) => e.payloadId === "nc-exe")!;
    expect(failed.hostIds).toEqual(["h-pay-iis"]);
    expect(failed.content.kind === "command" && failed.content.blocks[0]!.output).toMatch(/not recognized/);
  });

  it("stresses layouts", async () => {
    expect((await api.engagementGet("e-lab")).name.length).toBeGreaterThanOrEqual(70);
    expect(await api.credentialsList("e-lab")).toHaveLength(12);

    const web = await api.servicesList("h-web");
    expect(web.length).toBeGreaterThanOrEqual(20);
    expect(web.filter((s) => s.protocol === "udp" && s.state === "open|filtered").length).toBeGreaterThanOrEqual(3);

    const hosts = await api.hostsList("e-lab");
    expect(hosts).toHaveLength(6);
    expect(hosts.some((h) => h.name === "dc01" && h.os === "windows" && h.adSet === true)).toBe(true);
    expect(hosts.find((h) => h.id === "h-web")!.name.length).toBeGreaterThanOrEqual(40);
    expect(hosts.some((h) => h.dualHomed)).toBe(true);

    const exam = await api.engagementGet("e-exam");
    expect(exam.kind).toBe("exam-sim");
    expect(exam.msfHostId).toBe("h-exam-ms01");
    expect(await api.hostsList("e-exam")).toHaveLength(5);

    const entries = await api.logList("e-lab");
    expect(entries.length).toBeGreaterThanOrEqual(25);
    const shots = entries.filter((e) => e.kind === "screenshot");
    expect(shots).toHaveLength(4);
    const declared = Object.values(AUDIT_PNGS).map((p) => `${p.width}x${p.height}`).sort();
    const actual: string[] = [];
    for (const s of shots) {
      if (s.content.kind !== "screenshot") throw new Error("not a screenshot");
      const att = await api.attachmentGet(s.content.attachmentId);
      expect(att.mime).toBe("image/png");
      const bytes = Uint8Array.from(atob(att.dataBase64), (c) => c.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      actual.push(`${view.getUint32(16)}x${view.getUint32(20)}`);
    }
    expect(actual.sort()).toEqual(declared);

    const commands = entries.flatMap((e) => (e.content.kind === "command" ? e.content.blocks.map((b) => b.command) : []));
    expect(commands.some((c) => /[A-Za-z0-9+/]{200,}={0,2}/.test(c))).toBe(true);
    expect(commands.some((c) => /C:\\Program Files \(x86\)\\/.test(c))).toBe(true);
    expect(commands.some((c) => c.length < 40 && c.includes("--") && c.includes("="))).toBe(true);
  });

  it("makes the done-goal notice show 12 new credentials", async () => {
    const goal = (await api.checklistList("e-lab")).find((i) => i.status === "done" && i.completedAt != null)!;
    const creds = await api.credentialsList("e-lab");
    expect(creds.every((c) => c.scope === "domain" && c.createdAt > goal.completedAt!)).toBe(true);
    expect(new Set(creds.map((c) => `${c.domain}\\${c.username}${c.type === "hash" ? " (hash)" : ""}`)).size).toBe(12);
  });

  it("covers the archived engagement, rejects the inert commands", async () => {
    expect((await api.engagementGet("e-old")).status).toBe("archived");
    expect(await api.vaultStatus()).toEqual({ exists: true, unlocked: true });
    expect(await api.fieldManualLoad()).toBeNull();
    await expect(api.backupNow()).rejects.toMatchObject({ code: "unsupported" });
    await expect(api.fieldManualScan()).rejects.toMatchObject({ code: "unsupported" });
  });

  it("mutations persist until reload", async () => {
    await api.hostMove("h-web", "reporting");
    expect((await api.hostsList("e-lab")).find((h) => h.id === "h-web")!.boardColumn).toBe("reporting");
    resetAuditState();
    expect((await api.hostsList("e-lab")).find((h) => h.id === "h-web")!.boardColumn).toBe("vulnerability-detection");
  });

  it("boots the app past the vault", async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect((await screen.findAllByText(/Acme Corp — internal segment B/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/unlock/i)).not.toBeInTheDocument();
  });
});

describe("audit scenarios", () => {
  afterEach(() => setAuditScenario("full"));

  it("parses ?audit=", () => {
    expect(scenarioFromSearch("?audit=empty")).toBe("empty");
    expect(scenarioFromSearch("")).toBe("full");
    expect(scenarioFromSearch("?audit=bogus")).toBe("full");
  });

  it("empty: lists are empty but the engagement resolves", async () => {
    setAuditScenario("empty");
    expect(await api.credentialsList("e-lab")).toEqual([]);
    expect((await api.engagementGet("e-lab")).id).toBe("e-lab");
    expect((await api.engagementsList()).map((e) => e.id)).toEqual(["e-lab"]);
  });

  it("error: data commands reject, the shell commands do not", async () => {
    setAuditScenario("error");
    await expect(api.hostsList("e-lab")).rejects.toBeInstanceOf(RavenError);
    expect(await api.vaultStatus()).toEqual({ exists: true, unlocked: true });
  });

  it("loading: data commands never settle", async () => {
    setAuditScenario("loading");
    const result = await Promise.race([api.hostsList("e-lab"), new Promise((r) => setTimeout(() => r("pending"), 50))]);
    expect(result).toBe("pending");
    expect((await api.engagementGet("e-lab")).id).toBe("e-lab");
  });
});
