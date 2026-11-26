import { describe, expect, it } from "vitest";
import {
  BANNED, examDisplay, examList, examReading, examScope, examVerdict, examWarning, type ExamScope, type ExamVerdict,
} from "../../../engines/exam";
import { BUILTIN_LIBRARY } from "../../../engines/library/data";
import type { LibraryCommand } from "../../../engines/library/types";
import { lookupRows, parseNote } from "../../../engines/manual";
import { lookupCommands, manualCommand } from "../../../engines/manual/commands";
import { parseMarkdown } from "../../../engines/manual/markdown";

const cmd = (id: string, exam?: LibraryCommand["exam"]): LibraryCommand =>
  ({ id, title: id, tool: "t", template: id, os: "any", runFrom: "attacker", goals: [], source: "raven", ...(exam ? { exam } : {}) });
const plain = cmd("plain");
const banned = cmd("banned", "banned");
const msf = cmd("msf", "metasploit");
const all = [plain, banned, msf];

const exam = (hostId: string | null, msfHostId: string | null): ExamScope => examScope({ kind: "exam-sim", msfHostId }, hostId);
const pending = examScope(undefined, "h1");
const hostName = (id: string) => (id === "h2" ? "zzdc01" : id);

describe("examScope", () => {
  it("is pending until the engagement is known", () => {
    expect(pending.kind).toBe("pending");
  });
  it("carries the kind, the host in view and the Metasploit lock", () => {
    expect(examScope({ kind: "lab", msfHostId: "h2" }, "h1")).toEqual({ kind: "lab", hostId: "h1", msfHostId: "h2" });
    expect(examScope({ kind: "exam-sim", msfHostId: null }, null)).toEqual({ kind: "exam-sim", hostId: null, msfHostId: null });
  });
  it("reads an empty lock as no lock", () => {
    expect(examScope({ kind: "exam-sim", msfHostId: "" }, "h1").msfHostId).toBeNull();
  });
});

describe("examVerdict", () => {
  it("allows every command outside an exam sim, whatever the lock", () => {
    for (const kind of ["lab", "client"] as const) {
      for (const lock of [null, "h1", "h2"]) {
        const scope = examScope({ kind, msfHostId: lock }, "h1");
        expect(all.map((c) => examVerdict(c, scope))).toEqual(["allowed", "allowed", "allowed"]);
      }
    }
  });

  it("bans a banned command in an exam sim, on any host or none", () => {
    for (const scope of [exam("h1", null), exam("h1", "h1"), exam(null, "h2")]) expect(examVerdict(banned, scope)).toBe("banned");
  });

  it("allows an unclassified command in an exam sim", () => {
    expect(examVerdict(plain, exam("h1", "h2"))).toBe("allowed");
  });

  it("a Metasploit command: unlocked, on the locked host, or locked to another", () => {
    expect(examVerdict(msf, exam("h1", null))).toBe("metasploit-unlocked");
    expect(examVerdict(msf, exam(null, null))).toBe("metasploit-unlocked");
    expect(examVerdict(msf, exam("h1", "h1"))).toBe("allowed");
    expect(examVerdict(msf, exam("h1", "h2"))).toBe("metasploit-elsewhere");
    // No host in view is never the locked host.
    expect(examVerdict(msf, exam(null, "h2"))).toBe("metasploit-elsewhere");
  });

  it("is Metasploit only by the command's exam classification, never by its text", () => {
    const looksLikeMsf = { ...cmd("x"), template: "msfconsole -q -x 'use exploit/windows/smb/ms17_010_eternalblue'" };
    expect(examVerdict(looksLikeMsf, exam("h1", "h2"))).toBe("allowed");
  });

  it("is pending for a classified command until the kind is known; an unclassified one needs no kind", () => {
    expect(all.map((c) => examVerdict(c, pending))).toEqual(["allowed", "pending", "pending"]);
  });
});

describe("examDisplay", () => {
  const verdicts: ExamVerdict[] = ["allowed", "banned", "metasploit-elsewhere", "metasploit-unlocked", "pending"];

  it("a list hides banned, locked-elsewhere and pending commands, and holds nothing back", () => {
    expect(verdicts.map((v) => examDisplay(v, "list"))).toEqual([
      { shown: true, holdBack: false },
      { shown: false, holdBack: false },
      { shown: false, holdBack: false },
      { shown: true, holdBack: false },
      { shown: false, holdBack: false },
    ]);
  });

  it("a reader shows every command and holds back the first copy of banned, locked-elsewhere and pending ones", () => {
    expect(verdicts.map((v) => examDisplay(v, "reader"))).toEqual([
      { shown: true, holdBack: false },
      { shown: true, holdBack: true },
      { shown: true, holdBack: true },
      { shown: true, holdBack: false },
      { shown: true, holdBack: true },
    ]);
  });
});

describe("examWarning", () => {
  it("names the rule a verdict breaks, or the lock it would take", () => {
    expect(examWarning("allowed", exam("h1", null), hostName)).toBeNull();
    expect(examWarning("banned", exam("h1", null), hostName)).toEqual({ text: BANNED, breach: true });
    expect(examWarning("metasploit-elsewhere", exam("h1", "h2"), hostName)).toEqual({ text: "Metasploit is locked to zzdc01", breach: true });
    expect(examWarning("metasploit-unlocked", exam("h1", null), hostName)).toEqual({
      text: "Using Metasploit here makes this your Metasploit machine", breach: false,
    });
  });
});

describe("examList", () => {
  const ids = (r: { shown: LibraryCommand[] }) => r.shown.map((c) => c.id);

  it("outside an exam sim keeps every command and marks none", () => {
    const r = examList(all, examScope({ kind: "lab", msfHostId: "h2" }, "h1"));
    expect(ids(r)).toEqual(["plain", "banned", "msf"]);
    expect(r.msfMarker.size).toBe(0);
  });

  it("in an exam sim drops banned commands and marks an unlocked Metasploit command", () => {
    const r = examList(all, exam("h1", null));
    expect(ids(r)).toEqual(["plain", "msf"]);
    expect([...r.msfMarker]).toEqual(["msf"]);
  });

  it("keeps a Metasploit command on the locked host and drops it on another", () => {
    expect(ids(examList(all, exam("h1", "h1")))).toEqual(["plain", "msf"]);
    const other = examList(all, exam("h1", "h2"));
    expect(ids(other)).toEqual(["plain"]);
    expect(other.msfMarker.size).toBe(0);
  });

  it("while pending shows only commands that need no verdict", () => {
    expect(ids(examList(all, pending))).toEqual(["plain"]);
  });

  it("keeps Responder commands in an exam sim (only poisoning and spoofing are banned)", () => {
    const responder = BUILTIN_LIBRARY.filter((c) => /responder/i.test(c.tool) && !(c.tags ?? []).some((t) => t === "poisoning" || t === "spoofing"));
    expect(responder.length).toBeGreaterThan(0);
    expect(examList(responder, exam("h1", null)).shown).toHaveLength(responder.filter((c) => c.exam !== "banned").length);
  });
});

describe("Manual code as a library command", () => {
  const note = parseNote("04-Foundations/Zz-Exam.md", [
    "# Zz Exam",
    "## Shares",
    "```bash",
    "msfconsole -q -x 'use exploit/windows/smb/zz_module'",
    "```",
    "```text",
    "sqlmap output here",
    "```",
    "**Table 1 — Zz errors**",
    "| Error | Means | Do this |",
    "| - | - | - |",
    "| `ZZ_ERR` | Broken. | `sqlmap -u {URL}` or `zzcurl {URL}` or `sqlmap -u {URL}` |",
  ].join("\n"))!;
  const blocks = parseMarkdown(note.body).filter((b) => b.kind === "code");

  it("classifies a code block by the exam rules, never an output block", () => {
    const run = manualCommand({ kind: "block", note, block: blocks[0]!, n: 0, section: "Shares" });
    expect(run).toMatchObject({ id: `manual:${note.id}:0`, title: "Zz Exam: Shares", exam: "metasploit", runFrom: "attacker" });
    const out = manualCommand({ kind: "block", note, block: blocks[1]!, n: 1, section: "Shares" });
    expect(out.exam).toBeUndefined();
  });

  it("an inline span is classified and keyed by its code", () => {
    const c = manualCommand({ kind: "inline", note, code: "sqlmap -u {URL}", section: "" });
    expect(c).toMatchObject({ id: `manual:${note.id}:inline:sqlmap -u {URL}`, title: "Zz Exam", exam: "banned" });
  });

  it("a lookup row's commands: one id per place in the cell, the row as title, the same objects every time", () => {
    const row = lookupRows(note)[0]!;
    const cmds = lookupCommands(row);
    expect(cmds.map((c) => c.id)).toEqual([0, 1, 2].map((i) => `manual:${note.id}:lookup:table-1:0:${i}`));
    expect(cmds.map((c) => c.exam)).toEqual(["banned", undefined, "banned"]);
    expect(cmds[0]!.title).toBe("Zz errors: ZZ_ERR");
    expect(lookupCommands(row)[1]).toBe(cmds[1]);
    expect(manualCommand({ kind: "lookup", row, i: 2 })).toBe(cmds[2]);
  });

  it("one verdict for a lookup row's command: ⌘K's list hides it, the answer card holds it back", () => {
    const banned = lookupCommands(lookupRows(note)[0]!)[0]!;
    const scope = exam("h1", null);
    expect(examList([banned], scope).shown).toEqual([]);
    expect(examReading(banned, scope, hostName).holdBack).toEqual({ warn: BANNED, warnKey: "banned" });
  });
});

describe("examReading", () => {
  it("an allowed command has no line and copies at once", () => {
    expect(examReading(plain, exam("h1", "h2"), hostName)).toEqual({ verdict: "allowed", line: null });
  });

  it("a banned command shows the rule and holds back its first copy", () => {
    expect(examReading(banned, exam("h1", null), hostName)).toEqual({
      verdict: "banned", line: { text: BANNED, breach: true }, holdBack: { warn: BANNED, warnKey: "banned" },
    });
  });

  it("a Metasploit command locked to another host shows the lock and holds back its first copy", () => {
    expect(examReading(msf, exam("h1", "h2"), hostName)).toEqual({
      verdict: "metasploit-elsewhere",
      line: { text: "Metasploit is locked to zzdc01", breach: true },
      holdBack: { warn: "Metasploit is locked to zzdc01", warnKey: "metasploit-elsewhere" },
    });
  });

  it("a Metasploit command with no lock yet says it would take it, and copies at once", () => {
    expect(examReading(msf, exam("h1", null), hostName)).toEqual({
      verdict: "metasploit-unlocked", line: { text: "Using Metasploit here makes this your Metasploit machine", breach: false },
    });
  });

  it("while pending shows no line and holds back the first copy of every command that needs a verdict", () => {
    for (const c of [banned, msf]) {
      const r = examReading(c, pending, hostName);
      expect(r.line).toBeNull();
      expect(r.holdBack?.warnKey).toBe("pending");
    }
    expect(examReading(plain, pending, hostName).holdBack).toBeUndefined();
  });
});
