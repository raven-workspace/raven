import { describe, expect, it } from "vitest";
import { inferContext, inferSituation, rankPayloads, type PayloadSituation } from "../../../engines/payloads/fit";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";
import type { PayloadDef } from "../../../engines/payloads/types";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";
import type { Service } from "../../../types/service";

const host = (over: Partial<Host> = {}): Host => ({
  id: "h1", engagementId: "e1", name: "TARGET-A", ip: "198.51.100.5", os: null, boardColumn: "initial-foothold",
  boardManual: false, access: "none", createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null,
  accessReviewedAt: null, adSet: null, adSetEffective: false, ...over,
});
const svc = (port: number, name: string, version: string | null, over: Partial<Service> = {}): Service => ({
  id: `s${port}`, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: name, nmapVersion: version,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 0, updatedAt: 0, ...over,
});
const at1402 = new Date(2026, 10, 7, 14, 2).getTime();
const cmdEntry = (command: string, output: string, at = at1402, kind: "command" | "http" = "command"): LogEntry => ({
  id: `l${at}`, engagementId: "e1", kind, title: "t", titleEdited: false, ranOn: null, hostIds: ["h1"],
  observations: null, returnedNothing: false, private: false, at, createdAt: at, updatedAt: at,
  content: kind === "command" ? { kind: "command", blocks: [{ command, output }] } : { kind: "http", request: command, response: output },
});
const base: PayloadSituation = {
  os: null, services: [], prompt: null, webShellUrl: null, tools: { present: [], absent: [] },
  failedPayloadIds: [], exam: false, dbEngine: null,
};
const ids = (defs: PayloadDef[]) => defs.map((d) => d.id);

describe("fit engine", () => {
  it("IIS + logged ?cmd= URL infers windows + webshell-param, best fit ps-b64", () => {
    const { situation, evidence } = inferSituation({
      host: host(), services: [svc(80, "http", "Microsoft IIS httpd 10.0")],
      entries: [cmdEntry("curl 'http://198.51.100.5/shell.aspx?cmd=whoami'", "")], examKind: false,
    });
    expect(situation.os).toBe("windows");
    expect(evidence.os).toBe("from nmap (Microsoft IIS httpd 10.0 on 80)");
    expect(situation.webShellUrl).toBe("http://198.51.100.5/shell.aspx?cmd=");
    expect(evidence.webShellUrl).toBe("from your 14:02 log entry");
    const ctx = inferContext(situation);
    expect(ctx).toBe("webshell-param");
    expect(rankPayloads(REVERSE_SHELLS, situation, ctx).fits[0].id).toBe("ps-b64");
  });

  it("a logged nc.exe payload marked failed folds nc-exe with 'Failed here before'", () => {
    // Task 6 adds LogEntry.payloadId; inferSituation will fill failedPayloadIds then.
    const s = { ...base, os: "windows" as const, failedPayloadIds: ["nc-exe"] };
    const r = rankPayloads(REVERSE_SHELLS, s, null);
    expect(ids(r.fits)).not.toContain("nc-exe");
    expect(r.misfits.find((m) => m.def.id === "nc-exe")?.reason).toBe("Failed here before");
  });

  it("absent python3 folds python3", () => {
    const { situation } = inferSituation({
      host: host({ os: "linux" }), services: [],
      entries: [cmdEntry("which python3 python", "")], examKind: false,
    });
    expect(situation.tools.absent).toEqual(expect.arrayContaining(["python3", "python"]));
    const r = rankPayloads(REVERSE_SHELLS, situation, null);
    expect(r.misfits.find((m) => m.def.id === "python3")?.reason).toBe("Needs python3, which isn't on this box");
  });

  it("os null lists both OSes as fits and context null, nothing empty", () => {
    const { situation } = inferSituation({ host: host(), services: [], entries: [], examKind: false });
    expect(situation.os).toBeNull();
    expect(inferContext(situation)).toBeNull();
    const r = rankPayloads(REVERSE_SHELLS, situation, null);
    expect(r.misfits).toEqual([]);
    expect(ids(r.fits)).toEqual(ids(REVERSE_SHELLS));
  });

  it("prompt 'PS C:\\>' in the latest output infers powershell", () => {
    const { situation, evidence } = inferSituation({
      host: host({ os: "windows" }), services: [],
      entries: [
        cmdEntry("old", "C:\\Users\\a>", at1402 - 60000),
        cmdEntry("whoami", "example\\svc\nPS C:\\Users\\svc> ", at1402),
      ], examKind: false,
    });
    expect(situation.prompt).toBe("ps");
    expect(evidence.prompt).toBe("from your 14:02 log entry");
    expect(inferContext(situation)).toBe("powershell");
  });

  it("detects cmd and sh prompts", () => {
    const f = (out: string) => inferSituation({ host: host(), services: [], entries: [cmdEntry("x", out)], examKind: false }).situation.prompt;
    expect(f("C:\\inetpub>")).toBe("cmd");
    expect(f("www-data@web01:/var/www$ ")).toBe("sh");
    expect(f("root@web01:/# ")).toBe("sh");
    expect(f("just output")).toBeNull();
  });

  it("reads tools from linPEAS Useful software and which output only", () => {
    const peas = "╔══════════╣ Useful software\n/usr/bin/nc\n/usr/bin/python3\n/usr/bin/gcc\n╔══════════╣ Other\n/usr/bin/curl";
    const { situation } = inferSituation({
      host: host({ os: "linux" }), services: [],
      entries: [cmdEntry("./linpeas.sh", peas), cmdEntry("which php", ""), cmdEntry("which perl", "/usr/bin/perl")], examKind: false,
    });
    expect(situation.tools.present).toEqual(expect.arrayContaining(["nc", "python3", "gcc", "perl"]));
    expect(situation.tools.present).not.toContain("curl");
    expect(situation.tools.absent).toEqual(["php"]);
    const none = inferSituation({ host: host(), services: [], entries: [cmdEntry("echo php nc", "")], examKind: false });
    expect(none.situation.tools).toEqual({ present: [], absent: [] });
  });

  it("infers db engine and linux from services", () => {
    const { situation, evidence } = inferSituation({
      host: host(), services: [svc(22, "ssh", "OpenSSH 8.2p1 Ubuntu 4ubuntu0.5"), svc(3306, "mysql", "MySQL 8.0")],
      entries: [], examKind: true,
    });
    expect(situation.os).toBe("linux");
    expect(situation.dbEngine).toBe("mysql");
    expect(evidence.dbEngine).toBe("from nmap (mysql on 3306)");
    expect(situation.exam).toBe(true);
  });

  it("host OS 'other' maps to null", () => {
    expect(inferSituation({ host: host({ os: "other" }), services: [], entries: [], examKind: false }).situation.os).toBeNull();
  });

  it("misfit reasons in precedence order; wrong OS first", () => {
    const s = { ...base, os: "linux" as const, failedPayloadIds: ["nc-exe"], tools: { present: [], absent: ["nc.exe"] } };
    const r = rankPayloads(REVERSE_SHELLS, s, "bash-prompt");
    const reason = (id: string) => r.misfits.find((m) => m.def.id === id)?.reason;
    expect(reason("nc-exe")).toBe("Wrong OS (linux)");
    expect(reason("ps-b64")).toBe("Wrong OS (linux)");
    const w = rankPayloads(REVERSE_SHELLS, { ...base, os: "windows" }, "bash-prompt");
    expect(w.misfits.find((m) => m.def.id === "nc-exe")?.reason).toBe("Doesn't work in Bash prompt");
    const nc = rankPayloads(REVERSE_SHELLS, { ...base, os: "windows", tools: { present: [], absent: ["nc.exe"] } }, null);
    expect(nc.misfits.find((m) => m.def.id === "nc-exe")?.reason).toBe("Needs nc with -e, which isn't on this box");
  });

  it("orders fits: context match, then no absent tools, then catalogue", () => {
    const s = { ...base, os: "linux" as const, tools: { present: [], absent: ["nc"] } };
    const r = rankPayloads(REVERSE_SHELLS, s, "bash-prompt");
    expect(ids(r.fits).slice(0, 3)).toEqual(["bash-tcp", "python3", "php-exec"]);
  });

  it("exam folds meterpreter or staged defs", () => {
    const meter: PayloadDef = { ...REVERSE_SHELLS[0], id: "meter", title: "Meterpreter reverse_tcp" };
    const staged: PayloadDef = { ...REVERSE_SHELLS[0], id: "staged", template: "msfvenom -p windows/x64/shell/reverse_tcp" };
    const stageless: PayloadDef = { ...REVERSE_SHELLS[0], id: "stageless", template: "msfvenom -p windows/x64/shell_reverse_tcp" };
    const r = rankPayloads([meter, staged, stageless], { ...base, exam: true }, null);
    expect(ids(r.fits)).toEqual(["stageless"]);
    expect(r.misfits.map((m) => m.reason)).toEqual(["Not allowed in the exam", "Not allowed in the exam"]);
    expect(ids(rankPayloads([meter], base, null).fits)).toEqual(["meter"]);
  });
});
