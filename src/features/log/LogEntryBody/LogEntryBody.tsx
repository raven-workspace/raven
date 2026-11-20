import { useState } from "react";
import type { LogEntry } from "../../../types/log";
import { cx } from "../../../lib/cx";
import { Button, CommandBlock } from "../../../ui/index";
import { AttachmentImage } from "../AttachmentImage/AttachmentImage";
import { ExtractedLine } from "../ExtractedLine/ExtractedLine";
import "./LogEntryBody.scss";

const FOLD_LINES = 40;
/** Output and HTTP text (LogEntryBody.scss). */
const pre = "log-entry-body__pre";

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
      <pre className={cx(pre, attached && "log-entry-body__pre--attached")}>
        {folded ? lines.slice(0, FOLD_LINES).join("\n") : text}
      </pre>
      {folded && (
        <Button size="sm" className={cx("log-entry-body__more", attached && "log-entry-body__more--attached")} onClick={() => setAll(true)}>
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
    <div className="log-entry-body">
      {c.kind === "command" && (
        // Each command is one unit: the shared command box (it copies like any other) with its output joined below.
        // Several commands are numbered in a gutter and spaced apart, so where one ends and the next starts is plain.
        <ol className="log-entry-body__commands">
          {c.blocks.map((b, i) => {
            const multi = c.blocks.length > 1;
            return (
              <li key={i} className={cx("log-entry-body__command", multi && "log-entry-body__command--numbered")}>
                {multi && <span aria-hidden className="log-entry-body__number">{i + 1}</span>}
                <div className="log-entry-body__unit">
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
              <Button size="sm" className="log-entry-body__more" onClick={() => setShowResponse(true)}>
                Show response
              </Button>
            ))}
        </>
      )}
      {c.kind === "note" && <p className="log-entry-body__text log-entry-body__text--pre">{c.text}</p>}
      {c.kind === "screenshot" && (
        <>
          <AttachmentImage id={c.attachmentId} alt={c.caption || c.fileName || entry.title} />
          {/* A capture's title is its caption's first line, so a caption that only repeats the title is not shown again. */}
          {c.caption && c.caption.trim() !== entry.title.trim() && <p className="log-entry-body__text">{c.caption}</p>}
          {c.fileName && <span className="log-entry-body__quiet">{c.fileName}</span>}
        </>
      )}
      {c.kind === "flag" && (
        <>
          <div className="log-entry-body__flag">
            <span className="log-entry-body__quiet">{c.flagKind === "local" ? "local.txt" : "proof.txt"}</span>
            <span className="log-entry-body__flag-value">{c.value}</span>
          </div>
          {c.proof && <Output text={c.proof} />}
          {c.attachmentId && <AttachmentImage id={c.attachmentId} alt={`${entry.title} screenshot`} />}
        </>
      )}
      <ExtractedLine entry={entry} />
      {entry.observations && (
        <div className="log-entry-body__observations">
          <span className="log-entry-body__observations-label">Observations</span>
          <p className="log-entry-body__text log-entry-body__text--pre">{entry.observations}</p>
        </div>
      )}
    </div>
  );
}
