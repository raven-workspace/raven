import { describe, expect, it } from "vitest";
import { parseNote } from "../../../engines/manual";
import { matchRanges, searchManual } from "../../../engines/manual/search";

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

describe("matchRanges", () => {
  it("treats `_` and spaces alike, case-insensitively", () => {
    expect(matchRanges("STATUS_ACCESS_DENIED and access denied", "access denied")).toEqual([[7, 20], [25, 38]]);
    expect(matchRanges("anything", " ")).toEqual([]);
  });
});
