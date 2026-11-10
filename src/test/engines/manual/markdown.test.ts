import { describe, expect, it } from "vitest";
import { parseNote } from "../../../engines/manual";
import { parseInline, parseMarkdown, type Block } from "../../../engines/manual/markdown";

// Synthetic note text only (RFC 5737 addresses, invented names).
const BODY = [
  "# Zz Errors",
  "",
  "An error tells you **how far** the attempt got.",
  "Second line of the *same* paragraph.",
  "",
  "## Core Concept",
  "",
  "- first item with `code`",
  "- second **bold *nested em* bold**",
  "",
  "1. one",
  "2. two",
  "",
  "**Table 1 — Zz status codes**",
  "",
  "| Error | Means |",
  "| --- | --- |",
  "| `ZZ_ACCESS_DENIED` | **Authenticated**, not allowed |",
  "| a \\| b | `x \\| y` |",
  "",
  "```bash title:\"Kali\"",
  "zzscan {TARGET_IP}",
  "# not a heading",
  "```",
  "",
  "#### Small heading",
  "plain ZZ_SNAKE_CASE stays text",
].join("\n");

const kinds = (b: Block[]) => b.map((x) => x.kind);

describe("parseMarkdown", () => {
  const blocks = parseMarkdown(BODY);

  it("reads every block kind in order", () => {
    expect(kinds(blocks)).toEqual(["heading", "paragraph", "heading", "list", "list", "paragraph", "table", "code", "heading", "paragraph"]);
  });

  it("joins paragraph lines and parses strong and em", () => {
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      inline: [{ text: "An error tells you " }, { strong: [{ text: "how far" }] }, { text: " the attempt got. Second line of the " }, { em: [{ text: "same" }] }, { text: " paragraph." }],
    });
  });

  it("gives headings slug ids and levels", () => {
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1, id: "h1-zz-errors" });
    expect(blocks[2]).toEqual({ kind: "heading", level: 2, id: "core-concept", inline: [{ text: "Core Concept" }] });
    expect(blocks[8]).toMatchObject({ kind: "heading", level: 4, id: "h4-small-heading" });
  });

  it("parses lists, inline code and nested emphasis", () => {
    expect(blocks[3]).toEqual({
      kind: "list", ordered: false,
      items: [
        [{ text: "first item with " }, { code: "code" }],
        [{ text: "second " }, { strong: [{ text: "bold " }, { em: [{ text: "nested em" }] }, { text: " bold" }] }],
      ],
    });
    expect(blocks[4]).toEqual({ kind: "list", ordered: true, items: [[{ text: "one" }], [{ text: "two" }]] });
  });

  it("anchors a table caption line", () => {
    expect(blocks[5]).toEqual({ kind: "paragraph", anchor: "table-1", inline: [{ strong: [{ text: "Table 1 — Zz status codes" }] }] });
  });

  it("parses a pipe table with inline code, bold and escaped pipes", () => {
    expect(blocks[6]).toEqual({
      kind: "table",
      head: [[{ text: "Error" }], [{ text: "Means" }]],
      rows: [
        [[{ code: "ZZ_ACCESS_DENIED" }], [{ strong: [{ text: "Authenticated" }] }, { text: ", not allowed" }]],
        [[{ text: "a | b" }], [{ code: "x | y" }]],
      ],
    });
  });

  it("reads a fence's language and title, keeping its text verbatim", () => {
    expect(blocks[7]).toEqual({ kind: "code", lang: "bash", title: "Kali", text: "zzscan {TARGET_IP}\n# not a heading" });
  });

  it("does not read snake_case as emphasis", () => {
    expect(blocks[9]).toEqual({ kind: "paragraph", inline: [{ text: "plain ZZ_SNAKE_CASE stays text" }] });
  });

  it("parses wikilinks with heading and alias", () => {
    const [p] = parseMarkdown("See [[Zz-Errors#Core Concept|the concept]] and [[Zz-Card]].");
    expect(p).toEqual({
      kind: "paragraph",
      inline: [
        { text: "See " }, { link: { target: "Zz-Errors", heading: "Core Concept", label: "the concept" } },
        { text: " and " }, { link: { target: "Zz-Card", label: "Zz-Card" } }, { text: "." },
      ],
    });
  });

  it("keeps raw HTML as text, never markup", () => {
    const [p] = parseMarkdown("<script>zz()</script> <b>x</b>");
    expect(p).toEqual({ kind: "paragraph", inline: [{ text: "<script>zz()</script> <b>x</b>" }] });
  });

  it("matches the outline ids with duplicate headings, symbol-only headings and duplicate captions", () => {
    const body = [
      "## Usage", "### Usage", "## !!!", "**Table 1 — A**", "**Table 1 — A again**", "## Table 1", "```", "## Usage", "```", "## Usage",
    ].join("\n");
    const note = parseNote("04-Foundations/Zz.md", body)!;
    const ids = parseMarkdown(body).flatMap((b) => (b.kind === "heading" ? [b.id] : b.kind === "paragraph" && b.anchor ? [b.anchor] : []));
    expect(note.outline.map((o) => o.id)).toEqual(["usage", "usage-2", "section", "table-1", "table-1-2", "table-1-3", "usage-3"]);
    expect(ids).toEqual(note.outline.map((o) => o.id));
  });

  it("a caption with trailing text keeps its anchor; the trail is its own inline run, and no table swallows the line", () => {
    const body = "**Table 1 — Zz `codes`** (zztool; prefixes `NT_`)\n| A | B |\n| - | - |\n| x | y |\n**Table 2 — Zz more** see below";
    const blocks = parseMarkdown(body);
    expect(blocks[0]).toEqual({
      kind: "paragraph", anchor: "table-1", inline: [{ strong: [{ text: "Table 1 — Zz " }, { code: "codes" }] }],
      trail: [{ text: "(zztool; prefixes " }, { code: "NT_" }, { text: ")" }],
    });
    expect(blocks[1].kind).toBe("table");
    expect(blocks[1].kind === "table" && blocks[1].rows).toHaveLength(1);
    expect(blocks[2]).toMatchObject({ kind: "paragraph", anchor: "table-2", trail: [{ text: "see below" }] });
    const note = parseNote("04-Foundations/Zz.md", body)!;
    expect(note.outline.map((o) => o.id)).toEqual(["table-1", "table-2"]);
  });

  it("never gives an h1 or h4 an outline id", () => {
    const ids = parseMarkdown("# Usage\n## Usage\n#### Usage\n#### Usage").map((b) => (b.kind === "heading" ? b.id : ""));
    expect(ids).toEqual(["h1-usage", "usage", "h4-usage", "h4-usage-2"]);
  });

  it("strips the opening fence's indent from its lines", () => {
    const [list, code] = parseMarkdown(["- step one", "  ```bash", "  zz {TARGET_IP}", "    --flag", " x", "  ```"].join("\n"));
    expect(list.kind).toBe("list");
    expect(code).toEqual({ kind: "code", lang: "bash", text: "zz {TARGET_IP}\n  --flag\nx" });
  });
});

describe("parseInline: emphasis around inline code", () => {
  it("bold around code: each group is its own strong, the text between stays plain", () => {
    expect(parseInline("a **`X_Y`** or **`Z`** b")).toEqual([
      { text: "a " }, { strong: [{ code: "X_Y" }] }, { text: " or " }, { strong: [{ code: "Z" }] }, { text: " b" },
    ]);
  });

  it("italics around code, with * and with _", () => {
    expect(parseInline("*`p`*")).toEqual([{ em: [{ code: "p" }] }]);
    expect(parseInline("_`p`_")).toEqual([{ em: [{ code: "p" }] }]);
    expect(parseInline("x *`p`* and _`q`_, y")).toEqual([
      { text: "x " }, { em: [{ code: "p" }] }, { text: " and " }, { em: [{ code: "q" }] }, { text: ", y" },
    ]);
  });

  it("bold text with a backslash stays bold", () => {
    expect(parseInline("into **NT AUTHORITY\\SYSTEM** by")).toEqual([
      { text: "into " }, { strong: [{ text: "NT AUTHORITY\\SYSTEM" }] }, { text: " by" },
    ]);
  });

  it("bold next to code", () => {
    expect(parseInline("**bold** and `code`")).toEqual([{ strong: [{ text: "bold" }] }, { text: " and " }, { code: "code" }]);
  });

  it("intraword _ and unmatched markers stay text", () => {
    expect(parseInline("zz_a_b and x_`y`_z")).toEqual([{ text: "zz_a_b and x_" }, { code: "y" }, { text: "_z" }]);
    expect(parseInline("a ** b * c")).toEqual([{ text: "a ** b * c" }]);
  });

  it("triple markers read as em around strong", () => {
    expect(parseInline("***zz***")).toEqual([{ em: [{ strong: [{ text: "zz" }] }] }]);
  });
});
