import { useState } from "react";
import type { LogEntry } from "../../types/log";
import { cx } from "../../lib/cx";
import { Button, CommandBlock } from "../../ui";
import { AttachmentImage } from "./AttachmentImage";
import { ExtractedLine } from "./ExtractedLine";

const FOLD_LINES = 40;
/** Output and HTTP text. The 8px inset lines it up with the command text inside its box above. */
const pre = "m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words px-2 text-code text-muted-2";

/**
 * Output over 40 lines starts folded to its first 40. `attached` joins it under its command's box: same border, no
 * top edge, so a command and what it printed read as one unit.
 */
function Output({ text, attached }: { text: string; attached?: boolean }) {
  const [all, setAll] = useState(false);
  if (text === "") return null;
  const lines = text.split("\n");
  const folded = !all && lines.length > FOLD_LINES;
  return (
    <>
      <pre className={cx(pre, attached && "rounded-b-sm border border-t-0 border-line py-2")}>
        {folded ? lines.slice(0, FOLD_LINES).join("\n") : text}
      </pre>
      {folded && (
        <Button size="sm" className={cx("justify-self-start", attached && "mt-2")} onClick={() => setAll(true)}>
          {`Show all ${lines.length} lines`}
        </Button>
      )}
    </>
  );
}

export function LogEntryBody({ entry }: { entry: LogEntry }) {
  const c = entry.content;
  const [showResponse, setShowResponse] = useState(false);
  return (
    <div className="grid gap-3">
      {c.kind === "command" && (
        // Each command is one unit: the shared command box (it copies like any other) with its output joined below.
        // Several commands are numbered in a gutter and spaced apart, so where one ends and the next starts is plain.
        <ol className="m-0 grid list-none gap-4 p-0">
          {c.blocks.map((b, i) => {
            const multi = c.blocks.length > 1;
            return (
              <li key={i} className={cx("grid min-w-0 items-start gap-2", multi && "grid-cols-[16px_minmax(0,1fr)]")}>
                {multi && <span aria-hidden className="pt-2 text-right font-mono text-code tabular-nums text-muted">{i + 1}</span>}
                <div className="grid min-w-0">
                  <CommandBlock text={b.command} name={multi ? `${entry.title}, ${i + 1}` : entry.title} attached={b.output !== ""} />
                  <Output text={b.output} attached />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {c.kind === "http" && (
        <>
          <pre className={pre}>{c.request}</pre>
          {c.response &&
            (showResponse ? (
              <pre className={pre}>{c.response}</pre>
            ) : (
              <Button size="sm" className="justify-self-start" onClick={() => setShowResponse(true)}>
                Show response
              </Button>
            ))}
        </>
      )}
      {c.kind === "note" && <p className="m-0 whitespace-pre-wrap text-meta text-fg-2">{c.text}</p>}
      {c.kind === "screenshot" && (
        <>
          <AttachmentImage id={c.attachmentId} alt={c.caption || c.fileName || entry.title} />
          {/* A capture's title is its caption's first line, so a caption that only repeats the title is not shown again. */}
          {c.caption && c.caption.trim() !== entry.title.trim() && <p className="m-0 text-meta text-fg-2">{c.caption}</p>}
          {c.fileName && <span className="text-code text-muted">{c.fileName}</span>}
        </>
      )}
      {c.kind === "flag" && (
        <>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
            <span className="text-code text-muted">{c.flagKind === "local" ? "local.txt" : "proof.txt"}</span>
            <span className="text-code text-fg break-all">{c.value}</span>
          </div>
          {c.proof && <Output text={c.proof} />}
          {c.attachmentId && <AttachmentImage id={c.attachmentId} alt={`${entry.title} screenshot`} />}
        </>
      )}
      <ExtractedLine entry={entry} />
      {entry.observations && (
        <div className="grid gap-1 border-t border-line pt-2">
          <span className="text-meta text-muted-2">Observations</span>
          <p className="m-0 whitespace-pre-wrap text-meta text-fg-2">{entry.observations}</p>
        </div>
      )}
    </div>
  );
}
