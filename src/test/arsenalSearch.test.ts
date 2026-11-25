import { describe, expect, it } from "vitest";
import { examScope } from "../engines/exam";
import { searchArsenal } from "../engines/library/arsenalSearch";
import type { CardMeta } from "../engines/library/types";
import type { LibraryCommand } from "../engines/library/types";

const cmd = (id: string, over: Partial<LibraryCommand> = {}): LibraryCommand =>
  ({ id, title: id, tool: "tool", template: id, os: "any", runFrom: "attacker", goals: [], source: "raven", category: "Enumeration", ...over }) as LibraryCommand;
const card = (id: string, over: Partial<CardMeta> = {}): CardMeta => ({ id, title: id, stage: "x", category: "Enumeration", os: "any", file: `${id}.md`, ...over });

const FIND_CREDS = cmd("find-creds", { title: "Find credentials", template: "grep -r smb ." });
const PSEXEC = cmd("psexec", { title: "PsExec over SMB", template: "psexec.py" });
const KERBRUTE = cmd("kerbrute", { title: "Kerbrute users", tags: ["kerberos"], category: "Active-Directory" });
const KERB_CARD = card("kerb", { title: "Kerberos attacks", category: "Active-Directory" });
const PIVOT_COMMANDS = [cmd("ligolo", { title: "Ligolo agent", category: "Pivoting" }), cmd("chisel", { title: "Chisel client", category: "Pivoting" })];
const BANNED = cmd("autopwn", { title: "Autopwn", category: "Exploitation", exam: "banned" });

describe("searchArsenal", () => {
  it("title matches outrank template matches (smb)", () => {
    const hits = searchArsenal("smb", { library: [FIND_CREDS, PSEXEC], cards: [], generators: [] }).flatMap((g) => g.hits);
    expect(hits[0]!.id).toBe(PSEXEC.id);
    expect(hits.map((h) => h.id)).toContain(FIND_CREDS.id);
  });
  it("at equal weight a title that starts with the typed words comes first", () => {
    const other = cmd("other", { title: "Aaa transfer all files", category: "Shells-and-Transfers" });
    const t = { id: "transfer", title: "Transfer a file", category: "Shells-and-Transfers" };
    expect(searchArsenal("transfer a file", { library: [other], cards: [], generators: [t] })[0]!.hits.map((h) => h.id)).toEqual(["transfer", "other"]);
  });
  it("cards and commands share a category group", () => {
    const g = searchArsenal("kerberos", { library: [KERBRUTE], cards: [KERB_CARD], generators: [] });
    expect(g).toHaveLength(1);
    expect(g[0]!.hits.map((h) => h.type).sort()).toEqual(["card", "command"]);
  });
  it("kerb matches the command by title prefix", () => {
    expect(searchArsenal("kerb", { library: [KERBRUTE], cards: [], generators: [] })[0]!.hits[0]!.id).toBe("kerbrute");
  });
  it("lateral movement finds Pivoting via alias", () => {
    const g = searchArsenal("lateral movement", { library: [...PIVOT_COMMANDS, FIND_CREDS], cards: [], generators: [] });
    expect(g.map((x) => x.category)).toEqual(["Pivoting"]);
  });
  it("exam-banned category is dropped", () => {
    const g = searchArsenal("", { library: [BANNED, FIND_CREDS], cards: [], generators: [], exam: examScope({ kind: "exam-sim", msfHostId: null }, "h") });
    expect(g.find((x) => x.category === "Exploitation")).toBeUndefined();
    expect(g.map((x) => x.category)).toEqual(["Enumeration"]);
  });
  it("pending exam rules list no command that needs a verdict", () => {
    const g = searchArsenal("", { library: [BANNED, FIND_CREDS], cards: [], generators: [], exam: examScope(undefined, "h") });
    expect(g.flatMap((x) => x.hits.map((h) => h.id))).toEqual([FIND_CREDS.id]);
  });
  it("empty query lists everything, groups by label and hits by title", () => {
    const g = searchArsenal("", { library: [PSEXEC, FIND_CREDS, ...PIVOT_COMMANDS], cards: [], generators: [{ id: "transfer", title: "Transfer a file", category: "Shells-and-Transfers" }] });
    expect(g.map((x) => x.label)).toEqual(["Enumeration", "Pivoting", "Shells & transfers"]);
    expect(g[0]!.hits.map((h) => h.title)).toEqual(["Find credentials", "PsExec over SMB"]);
  });
  it("generators are found by title and category alias", () => {
    const ctx = { library: [], cards: [], generators: [{ id: "transfer", title: "Transfer a file", category: "Shells-and-Transfers" }] };
    expect(searchArsenal("file transfer", ctx)[0]!.hits[0]!.type).toBe("generator");
  });
  it("no host input exists: results never depend on a host", () => {
    // @ts-expect-error os is not an input
    searchArsenal("x", { library: [], cards: [], generators: [], os: "windows" });
  });
});
