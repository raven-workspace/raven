import { useState } from "react";
import type { LogEntry } from "../../types/log";
import { Button, labelClass } from "../../ui";
import { AttachmentImage } from "./AttachmentImage";

const FOLD_LINES = 40;
const pre = "m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.5] text-muted-2";

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
        <Button size="sm" className="self-start" onClick={() => setAll(true)}>
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
    <div className="flex flex-col gap-2.5">
      {c.kind === "command" &&
        c.blocks.map((b, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="font-mono text-[12.5px] text-fg break-all whitespace-pre-wrap">{`$ ${b.command}`}</div>
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
              <Button size="sm" className="self-start" onClick={() => setShowResponse(true)}>
                Show response
              </Button>
            ))}
        </>
      )}
      {c.kind === "note" && <p className="m-0 whitespace-pre-wrap text-[13px] text-fg-2">{c.text}</p>}
      {c.kind === "screenshot" && (
        <>
          <AttachmentImage id={c.attachmentId} alt={c.caption || c.fileName || entry.title} />
          {c.caption && <p className="m-0 text-[13px] text-fg-2">{c.caption}</p>}
          {c.fileName && <span className="font-mono text-xs text-muted">{c.fileName}</span>}
        </>
      )}
      {c.kind === "flag" && (
        <>
          <div className="flex items-baseline gap-2">
            <span className={labelClass}>{c.flagKind === "local" ? "local.txt" : "proof.txt"}</span>
            <span className="font-mono text-[12.5px] text-fg break-all">{c.value}</span>
          </div>
          {c.proof && <Output text={c.proof} />}
          {c.attachmentId && <AttachmentImage id={c.attachmentId} alt={`${entry.title} screenshot`} />}
        </>
      )}
      {entry.observations && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <span className={labelClass}>Observations</span>
          <p className="m-0 whitespace-pre-wrap text-[13px] text-fg-2">{entry.observations}</p>
        </div>
      )}
    </div>
  );
}
