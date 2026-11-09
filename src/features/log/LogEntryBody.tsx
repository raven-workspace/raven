import { useState } from "react";
import type { LogEntry } from "../../types/log";
import { Button } from "../../ui";
import { AttachmentImage } from "./AttachmentImage";
import { ExtractedLine } from "./ExtractedLine";

const FOLD_LINES = 40;
const pre = "m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-code text-muted-2";

/** Output over 40 lines starts folded to its first 40. */
function Output({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  if (text === "") return null;
  const lines = text.split("\n");
  const folded = !all && lines.length > FOLD_LINES;
  return (
    <>
      <pre className={pre}>{folded ? lines.slice(0, FOLD_LINES).join("\n") : text}</pre>
      {folded && (
        <Button size="sm" className="justify-self-start" onClick={() => setAll(true)}>
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
      {c.kind === "command" &&
        c.blocks.map((b, i) => (
          <div key={i} className="grid gap-1">
            <div className="overflow-x-auto text-code text-fg whitespace-pre-wrap">{`$ ${b.command}`}</div>
            <Output text={b.output} />
          </div>
        ))}
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
