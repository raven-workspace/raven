import { describe, expect, it } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { buildPlainTarget, keptFromReport, targetNumbers, type ReportNode } from "../engines/report";
import { inline, pageTypst, printedDate, reportTypst, typstString, withoutEmptySections, type ExportFront } from "../engines/report/typst";

const text = (t: string, marks: { type: string; attrs?: Record<string, unknown> }[] = []): ReportNode => ({ type: "text", text: t, ...(marks.length ? { marks } : {}) });
const para = (...content: ReportNode[]): ReportNode => ({ type: "paragraph", content });
const heading = (level: number, t: string): ReportNode => ({ type: "heading", attrs: { level }, content: [text(t)] });
const code = (t: string): ReportNode => ({ type: "codeBlock", attrs: { language: "" }, content: [text(t)] });
const item = (kind: "ordered" | "bullet", ...content: ReportNode[]): ReportNode => ({ type: "list", attrs: { kind }, content });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
const front: ExportFront = { title: "OSCP Exam Report", candidate: "Sam Rivera", osid: "OS-48213", email: "sam@example.com", date: "6 November 2026" };
const image = (id: string) => `img/${id}`;

describe("the owner's text reaches Typst as strings, never as markup", () => {
  it("escapes quotes, backslashes and newlines", () => {
    expect(typstString('a "b" \\ c\nd\te')).toBe('"a \\"b\\" \\\\ c\\nd\\te"');
  });

  it("text that looks like Typst stays text", () => {
    const hostile = '#import "/etc/passwd" #read("/etc/shadow") ] [ *bold* $x$ <label> @ref = heading';
    const out = inline([text(hostile)]);
    expect(out).toBe(`#${typstString(hostile)}`);
    // The only markup is the string call itself: nothing of the owner's text sits outside the quotes.
    expect(out.startsWith('#"')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
  });

  it("marks wrap the string: bold, italic, code innermost, links print their address", () => {
    expect(inline([text("x", [{ type: "bold" }, { type: "code" }])])).toBe('#strong[#rv-inline-code[#"x"]]');
    expect(inline([text("site", [{ type: "link", attrs: { href: "https://a.b/" } }])])).toBe('#link("https://a.b/")[#"site"]');
    expect(inline([text("a"), { type: "hardBreak" }, text("b")])).toBe('#"a"#linebreak()#"b"');
  });
});

describe("pageTypst", () => {
  it("prints code as a string and consecutive list items of one kind as one list, numbered from 1", () => {
    const out = pageTypst(doc(item("ordered", para(text("one")), code("id")), item("ordered", para(text("two"))), item("bullet", para(text("dot")))), { image });
    expect(out).toBe('#rv-enum([#"one"\n\n#rv-code("id")\n], [#"two"\n])\n\n#rv-list([#"dot"\n])\n');
  });

  it("gives headings their printed number and sits a page's level-1 headings under its chapter", () => {
    const out = pageTypst(doc(heading(1, "web01"), heading(2, "Service enumeration")), { image, headingNumbers: new Map([[0, "4.1"]]), headingBase: 1 });
    expect(out).toContain('#heading(level: 2)[#rv-number("4.1")#"web01"]');
    expect(out).toContain('#heading(level: 3)[#"Service enumeration"]');
  });

  it("prints a table with its header row, and a figure with its caption", () => {
    const table: ReportNode = {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeaderCell", content: [para(text("Port"))] }, { type: "tableHeaderCell", content: [para(text("Service"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [para(text("22/tcp"))] }, { type: "tableCell", content: [para()] }] },
      ],
    };
    const fig: ReportNode = { type: "figure", attrs: { attachmentId: "a1", entryId: "e1" }, content: [text("local.txt")] };
    const out = pageTypst(doc(table, fig), { image });
    expect(out).toContain('#rv-table(columns: 2, header: ([#"Port"], [#"Service"]), rows: (([#"22/tcp"], []),))');
    expect(out).toContain('#rv-figure("img/a1", [#"local.txt"])');
  });
});

describe("withoutEmptySections", () => {
  it("leaves out a heading with nothing printed under it, and a heading its sub-headings leave bare", () => {
    const hint: ReportNode = { type: "paragraph", attrs: { hint: "Say what you did" } };
    const out = withoutEmptySections(
      doc(heading(2, "Written"), para(text("words")), heading(2, "Unwritten"), hint, heading(2, "Parent"), heading(3, "Child"), hint, heading(2, "Last"), code("x")),
    );
    expect(out.content!.map((n) => (n.type === "heading" ? n.content![0].text : n.type))).toEqual(["Written", "paragraph", "Last", "codeBlock"]);
  });
});

describe("reportTypst", () => {
  it("writes the front page, the contents, then each page under its title, numbered after empty sections go", () => {
    const methods = doc(heading(2, "Information Gathering"), { type: "paragraph", attrs: { hint: "…" } }, heading(2, "Penetration"), para(text("Metasploit was not used.")));
    const { source } = reportTypst(front, [
      { doc: methods, title: { number: "3", text: "Methodologies" }, nested: false, numbering: (d) => new Map((d.content ?? []).flatMap((n, i) => (n.type === "heading" ? [[i, `3.${i + 1}`] as [number, string]] : []))) },
    ]);
    expect(source).toContain('#set page(paper: "us-letter"');
    expect(source).toContain('[#"Sam Rivera"]');
    expect(source).toContain('#outline(title: none, indent: 1.2em, depth: 2)');
    expect(source).toContain('#heading(level: 1)[#rv-number("3")#"Methodologies"]');
    expect(source).not.toContain("Information Gathering");
    // Penetration is now the page's first heading: 3.1, not 3.3.
    expect(source).toContain('#heading(level: 2)[#rv-number("3.1")#"Penetration"]');
  });

  it("leaves out a page with nothing written on it, title and all", () => {
    const { source } = reportTypst(front, [
      { doc: doc({ type: "paragraph", attrs: { hint: "…" } }), title: { number: null, text: "Testing Considerations" }, nested: false },
      { doc: doc(para(text("Thanks."))), title: { number: null, text: "Further Information" }, nested: false },
    ]);
    expect(source).not.toContain("Testing Considerations");
    expect(source).toContain('#"Further Information"');
  });

  it("never prints a figure of an entry kept from the report, and lists each screenshot once", () => {
    const g = garnetFixtures(1_700_000_000_000);
    const target = { key: GARNET_HOST, kind: "standalone" as const, hostIds: [GARNET_HOST] };
    const page = buildPlainTarget(g, target, {});
    const kept = g.log.find((e) => e.id === "l-garnet-local-shot")!;
    const printable = (id: string) => id !== kept.id && !keptFromReport(g, g.log.find((e) => e.id === id)!);
    const { source, attachmentIds } = reportTypst(front, [{ doc: page, title: { number: "4", text: "Independent Challenges" }, nested: true, numbering: (d) => targetNumbers(d, target, "4.1") }], printable);
    expect(attachmentIds).toEqual(["a-garnet-proof"]);
    expect(source).not.toContain("a-garnet-local");
    expect(source).toContain('#heading(level: 2)[#rv-number("4.1")#"garnet (10.10.30.31)"]');
    expect(new Set(attachmentIds).size).toBe(attachmentIds.length);
  });

  it("leaves out a detail the owner hasn't given, and prints the footer without an OSID", () => {
    const { source } = reportTypst({ ...front, osid: "", email: "" }, []);
    expect(source).not.toContain('"Email"');
    expect(source).toContain('#let rv-footer = [#"Exam Report"]');
  });
});

describe("printedDate", () => {
  it("prints an ISO date in words and anything else as written", () => {
    expect(printedDate("2026-11-06")).toBe("6 November 2026");
    expect(printedDate("next Tuesday")).toBe("next Tuesday");
    expect(printedDate(undefined)).toBe("");
  });
});
