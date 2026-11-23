import type { ReportNode } from "./types";

/**
 * A report page as Typst markup, for the PDF export (RAV-28, docs/adr/0002). Only the page's own nodes print: the
 * editor's hints and decorations never reach the page JSON. Every piece of the owner's text is written as a Typst
 * string (`#"…"`), so nothing they typed is ever read as markup. Styling is the template's (`exportTemplate`): this
 * writes structure only, through the functions the template defines:
 *
 *  - `#heading(level: n, numbering: …)[…]` for headings, with the page's number when it has one;
 *  - `#rv-code("…")` for a code block;
 *  - `#rv-figure("<image path>", caption)` for a screenshot;
 *  - `#rv-table(columns: n, header: (…), rows: (…))` for a table;
 *  - Typst lists for the page's flat lists: consecutive items of one kind form one list, numbered from 1.
 */

/** A string as a Typst string literal. */
export const typstString = (value: string): string =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "").replace(/\t/g, "\\t")}"`;

const MARKS: Record<string, (inner: string) => string> = {
  bold: (inner) => `#strong[${inner}]`,
  italic: (inner) => `#emph[${inner}]`,
  code: (inner) => `#rv-inline-code[${inner}]`,
  strike: (inner) => `#strike[${inner}]`,
  underline: (inner) => `#underline[${inner}]`,
};

/** Inline content (text with its marks, hard breaks) as Typst markup. A link prints its text and its address. */
export function inline(nodes: ReportNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "#linebreak()";
      if (n.type !== "text" || !n.text) return "";
      let out = `#${typstString(n.text)}`;
      const marks = n.marks ?? [];
      // Code goes innermost: bold code is bold mono.
      const ordered = [...marks].sort((a, b) => Number(b.type === "code") - Number(a.type === "code"));
      for (const m of ordered) {
        if (m.type === "link" && typeof m.attrs?.href === "string") out = `#link(${typstString(m.attrs.href)})[${out}]`;
        else if (MARKS[m.type]) out = MARKS[m.type](out);
      }
      return out;
    })
    .join("");
}

const textOf = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textOf).join("");

/** What a block's figures point at: the image file the export writes for an attachment. */
export type ImagePath = (attachmentId: string) => string | null;

export interface TypstOptions {
  /** The image file for a figure's attachment; null leaves the figure out (a missing image never prints a gap). */
  image: ImagePath;
  /** The printed number of a heading by its top-level index ("4.1"), when it has one. */
  headingNumbers?: ReadonlyMap<number, string>;
  /** The level a level-1 heading of this page takes in the whole report (a target page's machine heading sits under
   *  its chapter). */
  headingBase?: number;
}

function block(n: ReportNode, opts: TypstOptions, index: number | null): string {
  switch (n.type) {
    case "paragraph": {
      const body = inline(n.content);
      return body === "" ? "" : `${body}\n`;
    }
    case "heading": {
      // Level 1 is the report's chapters: a page's own headings sit below them.
      const level = Math.min(6, Math.max(2, Number(n.attrs?.level ?? 1) + (opts.headingBase ?? 0)));
      const number = index !== null ? opts.headingNumbers?.get(index) : undefined;
      const head = number ? `#rv-number(${typstString(number)})` : "";
      return `#heading(level: ${level})[${head}${inline(n.content)}]\n`;
    }
    case "codeBlock":
      return `#rv-code(${typstString(textOf(n))})\n`;
    case "figure": {
      const path = typeof n.attrs?.attachmentId === "string" ? opts.image(n.attrs.attachmentId) : null;
      if (!path) return "";
      const caption = inline(n.content);
      return `#rv-figure(${typstString(path)}, [${caption}])\n`;
    }
    case "table": {
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => `[${(c.content ?? []).map((p) => inline(p.content)).join("#linebreak()")}]`));
      if (rows.length === 0) return "";
      const head = (n.content?.[0]?.content ?? []).every((c) => c.type === "tableHeaderCell");
      const columns = Math.max(...rows.map((r) => r.length));
      const fmt = (r: string[]) => `(${r.join(", ")}${r.length === 1 ? "," : ""})`;
      const header = head ? fmt(rows[0]) : "()";
      const body = (head ? rows.slice(1) : rows).map(fmt).join(", ");
      return `#rv-table(columns: ${columns}, header: ${header}, rows: (${body}${rows.length - (head ? 1 : 0) === 1 ? "," : ""}))\n`;
    }
    default:
      return "";
  }
}

/** One list item: its blocks, the first one beside the marker. */
const itemBody = (n: ReportNode, opts: TypstOptions) =>
  (n.content ?? [])
    .map((b) => block(b, opts, null))
    .filter((s) => s !== "")
    .join("\n");

/** A page's blocks as Typst markup: consecutive flat-list items of one kind as one list. */
export function pageTypst(doc: ReportNode, opts: TypstOptions): string {
  const out: string[] = [];
  const content = doc.content ?? [];
  for (let i = 0; i < content.length; i++) {
    const n = content[i];
    if (n.type !== "list") {
      const b = block(n, opts, i);
      if (b !== "") out.push(b);
      continue;
    }
    const kind = n.attrs?.kind === "ordered" ? "ordered" : "bullet";
    const items: string[] = [];
    while (i < content.length && content[i].type === "list" && (content[i].attrs?.kind === "ordered" ? "ordered" : "bullet") === kind) {
      items.push(`[${itemBody(content[i], opts)}]`);
      i++;
    }
    i--;
    out.push(`#${kind === "ordered" ? "rv-enum" : "rv-list"}(${items.join(", ")})\n`);
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ The whole report */

/**
 * The page style the owner chose in the page-style round (2026-11-23, docs/adr/0002): style A, the house style on
 * paper, on US Letter. Ink on white; code on a warm grey panel with no ligatures (`->` stays two characters, so every
 * command copies as typed); figures with a hairline and a numbered caption, never split from it; the OSID and the page
 * count in the footer. Fonts are the house fonts the app bundles.
 */
export const EXPORT_TEMPLATE = `
#let ink = rgb("#16161a")
#let muted = rgb("#66655f")
#let rule = rgb("#d6d3cb")
#let code-bg = rgb("#efede7")
#set page(paper: "us-letter", margin: (x: 22mm, top: 22mm, bottom: 24mm),
  footer: context {
    if counter(page).get().first() > 1 {
      set text(size: 8pt, fill: muted)
      grid(columns: (1fr, auto), rv-footer, [#counter(page).display() of #counter(page).final().first()])
    }
  })
#set text(font: "Instrument Sans", size: 10pt, fill: ink, lang: "en", hyphenate: false)
#set par(leading: 0.62em, spacing: 0.9em, justify: false)
#show raw: set text(font: "JetBrains Mono", size: 8pt, ligatures: false, features: ("calt": 0))
#show heading: set text(weight: 600)
#show heading: set block(sticky: true)
#show heading.where(level: 1): it => { pagebreak(weak: true); set text(size: 20pt); block(above: 0pt, below: 14pt, sticky: true, it) }
#show heading.where(level: 2): set text(size: 15pt)
#show heading.where(level: 2): set block(above: 20pt, below: 10pt)
#show heading.where(level: 3): set text(size: 11.5pt)
#show heading.where(level: 3): set block(above: 16pt, below: 8pt)
#show heading.where(level: 4): set text(size: 10.5pt)
#show link: set text(fill: ink)
#show link: underline
#let rv-number(n) = text(fill: muted, weight: 500)[#n#h(0.6em)]
#let rv-inline-code(body) = box(fill: code-bg, inset: (x: 2pt), outset: (y: 2pt), radius: 2pt, text(font: "JetBrains Mono", size: 8.5pt, ligatures: false, features: ("calt": 0), body))
// A run with no space longer than the panel holds (a base64 payload, a URL) breaks at the panel's edge rather than
// running off the page: every PDF reader copies a wrapped line as two lines anyway, so nothing is lost but the clip.
#let rv-wrap(s, per) = s.split("\n").map(line => line.split(" ").map(word => {
  let c = word.clusters()
  if c.len() <= per { word } else { range(0, c.len(), step: per).map(i => c.slice(i, calc.min(i + per, c.len())).join()).join("\n") }
}).join(" ")).join("\n")
#let rv-code(s) = block(width: 100%, fill: code-bg, inset: (x: 8pt, y: 7pt), radius: 3pt, breakable: true,
  layout(size => raw(rv-wrap(s, calc.max(8, int(size.width / (8pt * 0.6)) - 1)), block: true)))
#let rv-figure(path, caption) = figure(image(path, width: 100%), caption: if caption == [] { none } else { caption }, supplement: "Figure", gap: 6pt)
#show figure: set block(breakable: false, above: 12pt, below: 12pt)
#show figure.caption: set text(size: 8.5pt, fill: muted)
#show figure: it => block(breakable: false)[#block(stroke: 0.5pt + rule, it.body)#it.caption]
#let rv-table(columns: 1, header: (), rows: ()) = table(columns: columns, stroke: (x, y) => (bottom: 0.5pt + rule), inset: (x: 4pt, y: 5pt),
  align: left, table.header(..header.map(c => text(weight: 600, c))), ..rows.flatten())
#let rv-enum(..items) = enum(..items, spacing: 1.1em, body-indent: 0.7em)
#let rv-list(..items) = list(..items, spacing: 0.9em)
`;

/** One page of the report as it prints, in outline order. */
export interface ExportPage {
  doc: ReportNode;
  /** The chapter title at the top of the page ("3 Methodologies"), or null for a page that has none (a target after
   *  the first). An appendix page's title is its own ("Appendix C – <title>"). */
  title: { number: string | null; text: string } | null;
  /** The printed numbers of the page's headings, by top-level index ("4.1", "3.2"), worked out on the page as it
   *  prints (its empty sections left out), so the numbers it prints run without a gap. */
  numbering?: (doc: ReportNode) => ReadonlyMap<number, string>;
  /** Whether the page's level-1 headings sit under its chapter (a target page's machines, an owner page's headings);
   *  a front-matter page's sub-sections (level 2) are the chapter's own sections. */
  nested: boolean;
}

export interface ExportFront {
  /** The report's title on the front page. */
  title: string;
  candidate: string;
  osid: string;
  email: string;
  /** As printed ("6 November 2026"); empty leaves the line out. */
  date: string;
}

export interface ExportSource {
  /** The Typst source of the whole report: template, front page, contents, then every page. */
  source: string;
  /** The attachments its figures print, in order, once each: the export writes each as `img/<id>`. */
  attachmentIds: string[];
}

/** A report date as the front page prints it: "2026-11-06" → "6 November 2026"; anything else as written. */
export function printedDate(value: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? "");
  if (!m) return value?.trim() ?? "";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : value!.trim();
}

/**
 * The whole report as one Typst source: the house template, the front page (title and the candidate's details), the
 * contents (chapters and their sections, with page numbers), then each page under its chapter title. Figures print
 * only when `printable` says their entry may reach the report: never a private entry's, never one kept from it.
 */
export function reportTypst(front: ExportFront, pages: ExportPage[], printable: (entryId: string) => boolean = () => true): ExportSource {
  const ids: string[] = [];
  const image: ImagePath = (id) => {
    if (!ids.includes(id)) ids.push(id);
    return `img/${id}`;
  };
  const details = [
    ["Candidate", front.candidate],
    ["OSID", front.osid],
    ["Email", front.email],
    ["Date", front.date],
  ].filter(([, v]) => v.trim() !== "");
  const footer = front.osid.trim() ? `OSCP-${front.osid.trim()} Exam Report` : "Exam Report";
  const parts: string[] = [
    `#set document(title: ${typstString(front.title.trim() || "Exam Report")}, author: ${typstString(front.candidate.trim())})`,
    `#let rv-footer = [#${typstString(footer)}]`,
    EXPORT_TEMPLATE,
    // The front page: no footer, the title over a rule, the candidate's details.
    `#page(footer: none)[
  #v(60mm)
  #text(size: 26pt, weight: 600)[#${typstString(front.title.trim() || "Exam Report")}]
  #v(10pt)
  #line(length: 100%, stroke: 0.5pt + rule)
  #v(8pt)
  #grid(columns: (34mm, 1fr), row-gutter: 7pt,
${details.map(([k, v]) => `    text(fill: muted)[#${typstString(k)}], [#${typstString(v)}],`).join("\n")}
  )
]`,
    `#heading(level: 1, outlined: false)[Contents]\n#outline(title: none, indent: 1.2em, depth: 2)`,
  ];
  for (const p of pages) {
    const doc = withoutEmptySections(withoutUnprintable(p.doc, printable));
    // A page with nothing written on it (Testing considerations, Further information left as drafted) is left out.
    if (!(doc.content ?? []).some(prints)) continue;
    if (p.title) parts.push(`#heading(level: 1)[${p.title.number ? `#rv-number(${typstString(p.title.number)})` : ""}#${typstString(p.title.text)}]`);
    parts.push(pageTypst(doc, { image, headingNumbers: p.numbering?.(doc), headingBase: p.nested ? 1 : 0 }));
  }
  return { source: parts.join("\n\n"), attachmentIds: ids };
}

const textIn = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textIn).join("");

/** Whether a block puts anything on paper: text, code, a figure, a table with a cell written, a list item that does. */
function prints(n: ReportNode): boolean {
  switch (n.type) {
    case "heading":
      return false;
    case "figure":
      return typeof n.attrs?.attachmentId === "string" && n.attrs.attachmentId !== "";
    case "list":
      return (n.content ?? []).some(prints);
    default:
      return textIn(n).trim() !== "";
  }
}

/**
 * A page without what prints nothing: blocks with nothing on them (an empty or hint-only paragraph), and a heading with
 * nothing printed under it before the next heading of its level or above (a drafted sub-section the owner never
 * wrote). Read from the end, so a heading left bare by its sub-headings going goes too.
 */
export function withoutEmptySections(doc: ReportNode): ReportNode {
  const level = (n: ReportNode) => Number(n.attrs?.level ?? 1);
  const out: ReportNode[] = [];
  const content = doc.content ?? [];
  for (let i = content.length - 1; i >= 0; i--) {
    const n = content[i];
    if (n.type === "heading") {
      const end = out.findIndex((b) => b.type === "heading" && level(b) <= level(n));
      const under = end === -1 ? out : out.slice(0, end);
      if (!under.some(prints)) continue;
    } else if (!prints(n)) continue;
    out.unshift(n);
  }
  return { ...doc, content: out };
}

/** A page without the figures of entries that may not reach the report, at any depth. */
function withoutUnprintable(doc: ReportNode, printable: (entryId: string) => boolean): ReportNode {
  const keep = (n: ReportNode): ReportNode | null => {
    if (n.type === "figure" && typeof n.attrs?.entryId === "string" && n.attrs.entryId !== "" && !printable(n.attrs.entryId)) return null;
    if (!n.content) return n;
    return { ...n, content: n.content.map(keep).filter((c): c is ReportNode => c !== null) };
  };
  return keep(doc) ?? { type: "doc", content: [] };
}
