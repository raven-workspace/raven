import { Fragment, type ReactNode } from "react";
import { parseInlineWith, parseMarkdown, type Block, type Inline } from "../../../../engines/manual/markdown";

/** Finding text is Markdown; a printed page keeps an external link's URL. */
const OPTS = { urls: true };

/** Inline Markdown as the page prints it: code, bold, italic; a link reads as its label (with its URL when external). */
export function InlineProse({ parts }: { parts: Inline[] }): ReactNode {
  return parts.map((p, i) => {
    if ("text" in p) return <Fragment key={i}>{p.text}</Fragment>;
    if ("code" in p) return <code key={i}>{p.code}</code>;
    if ("strong" in p) return <strong key={i}><InlineProse parts={p.strong} /></strong>;
    if ("em" in p) return <em key={i}><InlineProse parts={p.em} /></em>;
    return <Fragment key={i}>{p.link.label}</Fragment>;
  });
}

/** One line of finding text with its inline Markdown (a fix step). */
export function InlineText({ text }: { text: string }) {
  return <InlineProse parts={parseInlineWith(text, OPTS)} />;
}

function BlockProse({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return (
        <p>
          <InlineProse parts={block.inline} />
        </p>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <InlineProse parts={item} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "code":
      return <pre className="report-code report-pre">{block.text}</pre>;
    case "table":
      return (
        <table className="report-table">
          <thead>
            <tr>
              {block.head.map((c, i) => (
                <th key={i}>
                  <InlineProse parts={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>
                    <InlineProse parts={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

/**
 * A labelled piece of finding text ("Vulnerability Explanation:"), its Markdown rendered: the label leads the first
 * paragraph; a text that opens with a list, code or a table puts the label on its own line above it. Empty text reads
 * `missing`.
 */
export function FindingProse({ label, text, missing }: { label: string; text: string; missing: ReactNode }) {
  const blocks = text.trim() === "" ? [] : parseMarkdown(text, OPTS);
  const [first, ...rest] = blocks;
  if (!first) {
    return (
      <p>
        <strong>{label}</strong> {missing}
      </p>
    );
  }
  const leads = first.kind === "paragraph" || first.kind === "heading";
  return (
    <>
      {leads ? (
        <p>
          <strong>{label}</strong> <InlineProse parts={first.inline} />
        </p>
      ) : (
        <p>
          <strong>{label}</strong>
        </p>
      )}
      {(leads ? rest : blocks).map((b, i) => (
        <BlockProse key={i} block={b} />
      ))}
    </>
  );
}
