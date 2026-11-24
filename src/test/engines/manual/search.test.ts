import { describe, expect, it } from "vitest";
import { parseNote } from "../../../engines/manual";
import { matchRanges, searchLookups, searchManual } from "../../../engines/manual/search";
import { AUDIT_NOTE_SOURCES } from "../../../audit/fixtures";

// Synthetic note text only (RFC 5737 addresses, invented names).
const ERRORS = parseNote("04-Foundations/Zz-Errors.md", [
  "# Zz Errors",
  "## Core Concept",
  "An error says how far the **attempt** got.",
  "**Table 1 — Zz status codes**",
  "| Error | Means |",
  "| --- | --- |",
  "| `STATUS_ACCESS_DENIED` | Authenticated, not allowed |",
].join("\n"))!;
const TOOL = parseNote("03-Tools/Zz Tool.md", [
  "# Zz Tool",
  "## Usage",
  "```bash",
  "zzscan --zz-flagonly -t {TARGET_IP}",
  "```",
].join("\n"))!;
const DENIED = parseNote("04-Foundations/Access Denied Basics.md", "# Access Denied Basics\nNothing else here.\n")!;

describe("searchManual", () => {
  it("a title hit ranks before a body hit", () => {
    const hits = searchManual("access denied", [ERRORS, TOOL, DENIED]);
    expect(hits.map((h) => [h.noteId, h.inTitle])).toEqual([[DENIED.id, true], [ERRORS.id, false]]);
  });

  it("`access denied` finds STATUS_ACCESS_DENIED in a table row, under the table's anchor, markers stripped", () => {
    const [hit] = searchManual("access denied", [ERRORS]);
    expect(hit).toMatchObject({ noteId: ERRORS.id, title: "Zz Errors", anchor: "table-1", inTitle: false });
    expect(hit.line).toContain("STATUS_ACCESS_DENIED");
    expect(hit.line).not.toMatch(/[|`]/);
  });

  it("matches case-insensitively after trimming", () => {
    expect(searchManual("  ATTEMPT got ", [ERRORS])[0]).toMatchObject({ anchor: "core-concept", line: "An error says how far the attempt got." });
  });

  it("Manual line has no middle dots: table cells are joined with two spaces", () => {
    const [hit] = searchManual("access denied", [ERRORS]);
    expect(hit!.line).not.toContain(" · ");
    expect(hit!.line).toBe("STATUS_ACCESS_DENIED  Authenticated, not allowed");
  });

  it("a code-block line matches, under its heading", () => {
    expect(searchManual("--zz-flagonly", [ERRORS, TOOL])).toEqual([
      { noteId: TOOL.id, title: "Zz Tool", anchor: "usage", line: "zzscan --zz-flagonly -t {TARGET_IP}", inTitle: false },
    ]);
  });

  it("one hit per note, and at most max", () => {
    const many = Array.from({ length: 12 }, (_, i) => parseNote(`04-Foundations/Zz${i}.md`, `# Zz ${i}\nzzword one\nzzword two\n`)!);
    expect(searchManual("zzword", many)).toHaveLength(8);
    expect(searchManual("zzword", many, 3).map((h) => h.noteId)).toEqual([many[0].id, many[1].id, many[2].id]);
  });

  it("a long line is cut to about 120 characters around the match", () => {
    const long = parseNote("04-Foundations/Zz Long.md", `# Zz Long\n${"a".repeat(200)} zzneedle ${"b".repeat(200)}\n`)!;
    const [hit] = searchManual("zzneedle", [long]);
    expect(hit.line.length).toBeLessThanOrEqual(122);
    expect(hit.line).toContain("zzneedle");
  });

  it("no match, or an empty query, gives nothing", () => {
    expect(searchManual("zz-nowhere-at-all", [ERRORS, TOOL])).toEqual([]);
    expect(searchManual("   ", [ERRORS, TOOL])).toEqual([]);
  });
});

describe("searchManual: captions with trailing text", () => {
  it("a caption with text after its bold name starts its table's section", () => {
    const n = parseNote("04-Foundations/Zz Caps.md", [
      "# Zz Caps",
      "## Intro",
      "**Table 1 — Zz codes** (zztool, zzother)",
      "| Code | Means |",
      "| --- | --- |",
      "| `ZZ_DENIED` | no |",
      "**Table 2 — Zz `more`** — notes",
      "zzneedle here",
    ].join("\n"))!;
    expect(searchManual("zz denied", [n])[0]).toMatchObject({ anchor: "table-1" });
    expect(searchManual("zzneedle", [n])[0]).toMatchObject({ anchor: "table-2" });
  });
});

describe("searchManual: links", () => {
  it("a wikilink reads as the label the note shows (alias, else target without its heading)", () => {
    const n = parseNote("04-Foundations/Zz Links.md", "# Zz Links\nSee [[Zz Kerberoast#Steps]] and [[Zz-Other|zz delegation abuse]].\n")!;
    expect(searchManual("zz kerberoast", [n])[0]!.line).toBe("See Zz Kerberoast and zz delegation abuse.");
    expect(searchManual("kerberoast steps", [n])).toEqual([]);
    expect(searchManual("zz-other", [n])).toEqual([]);
  });
});

describe("searchManual: emphasis around code", () => {
  it("a line with bold and italics around code reads as the note shows it", () => {
    const n = parseNote("04-Foundations/Zz Privs.md", "# Zz Privs\nturns **`ZzOnePriv`** or _`zztwo`_ into **ZZ AUTHORITY\\ZZSYS** by *`zzthree`*.\n")!;
    expect(searchManual("zztwo", [n])[0]!.line).toBe("turns ZzOnePriv or zztwo into ZZ AUTHORITY\\ZZSYS by zzthree.");
  });
});

describe("searchManual: the snippet reads as the note renders the line (RAV-20)", () => {
  const note = (lines: string[]) => parseNote("04-Foundations/Zz Render.md", ["# Zz Render", "## Lines", ...lines].join("\n"))!;
  const snippet = (line: string, query: string) => searchManual(query, [note([line])])[0]?.line;

  it.each([
    ["use __bold__ here", "use", "use bold here"],
    ["a ___x___ word", "word", "a x word"],
    ["stray ** marker", "marker", "stray ** marker"],
    ["escaped \\*star\\* text", "text", "escaped *star* text"],
    ["see [[Aa Other|zz alias]] now", "zz alias", "see zz alias now"],
    ["| `ZZ_CODE` | **Bad** _input_ |", "bad input", "ZZ_CODE  Bad input"],
    ["- a `*` or `_` in code", "in code", "a * or _ in code"],
    ["> [!note] zz quoted *line*", "quoted", "zz quoted line"],
  ])("%s", (line, query, shown) => {
    expect(snippet(line, query)).toBe(shown);
  });

  it("a phrase split by bold is found, and reads without the markers", () => {
    expect(snippet("the zzgate said access **denied** twice", "access denied")).toBe("the zzgate said access denied twice");
  });
});

describe("searchManual: placeholders never match (RAV-20)", () => {
  const n = parseNote("03-Tools/Zz Fill.md", [
    "# Zz Fill",
    "## Run",
    "```bash",
    "zzfill --zzport -t {ZZRHOST}",
    "```",
    "Then run `zzother {ZZLHOST}` and read {ZZNOTE} here.",
  ].join("\n"))!;

  it("a query only a placeholder's name matches finds nothing, in a fence or out", () => {
    expect(searchManual("zzrhost", [n])).toEqual([]);
    expect(searchManual("zzlhost", [n])).toEqual([]);
    expect(searchManual("zznote", [n])).toEqual([]);
  });

  it("the text around a placeholder still matches, and the snippet keeps the line whole", () => {
    expect(searchManual("zzport", [n])[0]).toMatchObject({ anchor: "run", line: "zzfill --zzport -t {ZZRHOST}" });
    expect(searchManual("zzother", [n])[0]?.line).toBe("Then run zzother {ZZLHOST} and read {ZZNOTE} here.");
  });

  it("a match never runs from text into an inline command, as the note marks each apart", () => {
    expect(searchManual("then run zzother", [n])).toEqual([]);
  });
});

describe("matchRanges", () => {
  it("treats `_` and spaces alike, case-insensitively", () => {
    expect(matchRanges("STATUS_ACCESS_DENIED and access denied", "access denied")).toEqual([[7, 20], [25, 38]]);
    expect(matchRanges("anything", " ")).toEqual([]);
  });
});

describe("searchLookups", () => {
  const LOOKUP = AUDIT_NOTE_SOURCES.flatMap(([p, t]) => (p.includes("Zz-Error-Lookup") ? [parseNote(p, t)!] : []))[0]!;
  // Key matches rank before means matches, whatever the note order.
  const ORDERED = parseNote("04-Foundations/Zz-Order.md", [
    "# Zz Order",
    "**Table 1 — Zz order**",
    "| Error | Means | Do this |",
    "| - | - | - |",
    "| `ZZ_FIRST` | The zzneedle is in the means. | `zzone {TARGET_IP}` |",
    "| `ZZ_ZZNEEDLE` | Nothing to see. | `zztwo {TARGET_IP}` |",
  ].join("\n"))!;

  it("finds a row by its key, `_` and spaces alike", () => {
    expect(searchLookups("skew", [LOOKUP]).map((r) => r.key)).toEqual(["STATUS_ZZ_SKEW"]);
    expect(searchLookups("zz skew", [LOOKUP]).map((r) => r.key)).toEqual(["STATUS_ZZ_SKEW"]);
  });

  it("finds a row by its means", () => {
    expect(searchLookups("has expired", [LOOKUP]).map((r) => r.key)).toEqual(["STATUS_ZZ_EXPIRED"]);
  });

  it("lookup row without commands is not a Lookup hit", () => {
    expect(searchLookups("STATUS_ZZ_LOCKED", [LOOKUP])).toEqual([]);
  });

  it("at most `max` rows, 2 by default", () => {
    expect(searchLookups("STATUS_ZZ", [LOOKUP])).toHaveLength(2);
    expect(searchLookups("STATUS_ZZ", [LOOKUP], 5)).toHaveLength(5);
  });

  it("key matches come before means matches", () => {
    expect(searchLookups("zzneedle", [ORDERED]).map((r) => r.key)).toEqual(["ZZ_ZZNEEDLE", "ZZ_FIRST"]);
  });

  it("an empty query finds nothing", () => {
    expect(searchLookups("  ", [LOOKUP])).toEqual([]);
  });

  it("a row `keep` drops does not count toward `max`", () => {
    const all = searchLookups("STATUS_ZZ", [LOOKUP], 10);
    const dropped = new Set(all.slice(0, 2).map((r) => r.key));
    expect(searchLookups("STATUS_ZZ", [LOOKUP], 2, (r) => !dropped.has(r.key)).map((r) => r.key)).toEqual(all.slice(2, 4).map((r) => r.key));
  });
});
