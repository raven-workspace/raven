import { useEffect, useMemo, type ReactNode } from "react";
import { garnetFixtures, GARNET_HOST } from "../audit/examFixtures";
import { AUDIT_NOW } from "../audit/fixtures";
import { buildPlainTarget, type AppendixIndex, type ReportTarget } from "../engines/report";
import { parseMarkdown, type Block, type Inline } from "../engines/manual/markdown";
import { ReportDataContext, type ReportDataValue } from "../features/report/editor/ReportDataContext";
import { ReportEditor } from "../features/report/editor/ReportEditor";
import "../features/report/page.css";
import "./reportCompare.css";
import sample from "../../docs/Mock exam A — model report.md?raw";

/** The sample's §4.1, from its heading up to §4.2's. */
const SECTION = sample.slice(sample.indexOf("### 4.1 "), sample.indexOf("### 4.2 "));
const TARGET: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };
const NO_APPENDIX: AppendixIndex = { entries: [], refFor: () => null };

function inline(parts: Inline[]): ReactNode[] {
  return parts.map((p, i) => {
    if ("text" in p) return p.text;
    if ("code" in p) return <code key={i}>{p.code}</code>;
    if ("strong" in p) return <strong key={i}>{inline(p.strong)}</strong>;
    if ("em" in p) return <em key={i}>{inline(p.em)}</em>;
    return p.link.label;
  });
}

/** The sample's Markdown in the page's house style: `###` as the machine heading (h1 on the page), `####` as its
 *  sub-sections (h2), numbered lists numbered on across the code blocks between their items, "From your notes" quotes
 *  as quotes. */
function SampleSection({ markdown }: { markdown: string }) {
  // Quote lines are the sample's study notes: kept, drawn as a quote.
  const chunks: { quote: boolean; text: string }[] = [];
  for (const line of markdown.split("\n")) {
    const quote = /^\s*>/.test(line);
    const last = chunks[chunks.length - 1];
    if (last && last.quote === quote) last.text += `\n${line}`;
    else chunks.push({ quote, text: line });
  }
  let n = 0;
  const render = (b: Block, key: string): ReactNode => {
    switch (b.kind) {
      case "heading":
        n = 0;
        return b.level <= 3 ? <h1 key={key}>{inline(b.inline)}</h1> : <h2 key={key}>{inline(b.inline)}</h2>;
      case "paragraph":
        return <p key={key}>{inline(b.inline)}</p>;
      case "list":
        if (!b.ordered) return <ul key={key}>{b.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</ul>;
        n += b.items.length;
        return (
          <ol key={key} start={n - b.items.length + 1}>
            {b.items.map((it, i) => <li key={i}>{inline(it)}</li>)}
          </ol>
        );
      case "table":
        return (
          <div key={key} className="tableWrapper">
            <table>
              <thead>
                <tr>{b.head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "code":
        return (
          <div key={key} className="report-codeblock" data-language={b.lang || undefined}>
            <pre className="report-code report-pre">
              <code>{b.text}</code>
            </pre>
          </div>
        );
    }
  };
  return (
    <>
      {chunks.map((c, i) => {
        const blocks = parseMarkdown(c.quote ? c.text.replace(/^\s*>\s?/gm, "") : c.text, { urls: true });
        const nodes = blocks.map((b, j) => render(b, `${i}-${j}`));
        return c.quote ? <blockquote key={i}>{nodes}</blockquote> : nodes;
      })}
    </>
  );
}

/**
 * Audit mode only (`/__compare/garnet`): the owner's sample §4.1 beside Raven's plain draft of garnet, a machine logged
 * the way the sample's was worked. Same width, same house style; the right side is the real, editable report editor.
 * The window scrolls as a whole so both columns screenshot in one go.
 */
export default function ReportCompare() {
  const data = useMemo(() => garnetFixtures(AUDIT_NOW), []);
  const doc = useMemo(() => buildPlainTarget(data, TARGET, {}, "4.1"), [data]);
  const value = useMemo(
    (): ReportDataValue => ({ data, appendix: NO_APPENDIX, sectionMeta: {}, onRemoveEvidence: () => {}, target: TARGET, reportMeta: {} }),
    [data],
  );
  // The app's window never scrolls (global.css); this page does, so a full-page screenshot holds both columns.
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById("root")].filter((e): e is HTMLElement => e !== null);
    const before = els.map((e) => [e.style.overflow, e.style.height] as const);
    for (const e of els) {
      e.style.overflow = "visible";
      e.style.height = "auto";
    }
    document.documentElement.style.overflow = "auto";
    return () => els.forEach((e, i) => ([e.style.overflow, e.style.height] = before[i]));
  }, []);

  return (
    <div className="report-compare" data-testid="report-compare">
      <section aria-label="Sample report, section 4.1">
        <p className="report-compare-label">Sample: Mock exam A — model report, §4.1</p>
        <div className="report-page" data-page="target">
          <div className="report-page-doc">
            <div className="ProseMirror">
              <SampleSection markdown={SECTION} />
            </div>
          </div>
        </div>
      </section>
      <section aria-label="Raven's draft of garnet">
        <p className="report-compare-label">Raven: plain draft of garnet (editable)</p>
        <ReportDataContext.Provider value={value}>
          <ReportEditor sectionId="compare-garnet" plain doc={doc} onChange={() => {}} onReady={() => {}} />
        </ReportDataContext.Provider>
      </section>
    </div>
  );
}
