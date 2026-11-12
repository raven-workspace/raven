import { useQuery } from "@tanstack/react-query";
import type { ReactNodeViewProps } from "prosekit/react";
import { applyKeep, type EvidenceAttrs } from "../../../../engines/report";
import { api } from "../../../../lib/api";
import type { CommandBlock, LogEntry } from "../../../../types/log";
import { AttachmentImage } from "../../../log/AttachmentImage";
import { useAppendixRef, usePageLayout, useReportData } from "../ReportDataContext";
import { AppendixRef, Block, Gone, lineCount } from "./parts";

const NO_MACHINES: string[] = [];

/** `kali$` for the attacker's machines, else the machine the command ran on (`DC01$`). */
function promptFor(ranOn: string | null, machines: string[]): string {
  if (!ranOn) return "$";
  if (machines.includes(ranOn) || /kali/i.test(ranOn)) return "kali$";
  return `${ranOn}$`;
}

/**
 * The command blocks of a placement. `keep` and `emphasis` index the placement's output: one block's, or with
 * `block: null` every block's output end to end (as the appendix engine counts it).
 */
function CommandBody({ blocks, attrs, prompt }: { blocks: CommandBlock[]; attrs: EvidenceAttrs; prompt: string }) {
  const chosen = attrs.block === null ? blocks : blocks.slice(attrs.block, attrs.block + 1);
  const emphasis = new Set(attrs.emphasis);
  let offset = 0;
  return chosen.map((b, i) => {
    const output = b.output ?? "";
    const start = offset;
    offset += lineCount(output);
    const keep = attrs.keep === null ? null : attrs.keep.map(([a, z]): [number, number] => [a - start, z - start]);
    return (
      <div className="report-code" key={i}>
        <div className="report-cmd">
          <span className="report-prompt">{prompt}</span> {b.command}
        </div>
        {output !== "" &&
          applyKeep(output, keep).map((item, k) =>
            item.kind === "line" ? (
              <div className="report-line" key={k} data-emphasis={emphasis.has(item.n + start) || undefined}>
                {item.text}
              </div>
            ) : (
              <div className="report-omitted" key={k}>
                {`… ${item.count} ${item.count === 1 ? "line" : "lines"} omitted`}
              </div>
            ),
          )}
      </div>
    );
  });
}

function Figure({ attachmentId, caption, n }: { attachmentId: string; caption: string; n: number | null }) {
  return (
    <figure className="report-figure">
      <AttachmentImage id={attachmentId} alt={caption} />
      <figcaption>{n === null ? caption : `Figure ${n}. ${caption}`}</figcaption>
    </figure>
  );
}

/** "GET http://10.0.0.5/login" from a raw request's first line and Host header. */
function requestLine(request: string): string {
  const [first = "", ...headers] = request.split(/\r?\n/);
  const [method = "", target = ""] = first.trim().split(/\s+/);
  const host = headers.find((h) => /^host:/i.test(h))?.replace(/^host:\s*/i, "").trim();
  const url = /^https?:\/\//i.test(target) || !host ? target : `http://${host}${target}`;
  return `${method} ${url}`.trim();
}

function EntryBody({ entry, attrs, figure, prompt }: { entry: LogEntry; attrs: EvidenceAttrs; figure: number | null; prompt: string }) {
  const c = entry.content;
  switch (c.kind) {
    case "command":
      if (attrs.block !== null && !c.blocks[attrs.block]) return <Gone text="This command was removed from its entry" />;
      return <CommandBody blocks={c.blocks} attrs={attrs} prompt={prompt} />;
    case "screenshot":
      return <Figure attachmentId={c.attachmentId} caption={c.caption || entry.title} n={figure} />;
    case "flag":
      return (
        <div className="report-flag">
          <p>
            <strong>{c.flagKind === "local" ? "local.txt" : "proof.txt"}:</strong> <code>{c.value}</code>
          </p>
          {c.proof && <pre className="report-code report-pre">{c.proof}</pre>}
          {c.attachmentId && <Figure attachmentId={c.attachmentId} caption={entry.title} n={figure} />}
        </div>
      );
    case "http":
      return (
        <div className="report-http">
          <p className="report-http-line">{requestLine(c.request)}</p>
          <pre className="report-code report-pre">{c.request}</pre>
          {c.response && <pre className="report-code report-pre">{c.response}</pre>}
        </div>
      );
    case "note":
      return <p>{c.text}</p>;
  }
}

/** A log entry on the page, rendered from the live row; a deleted or private entry leaves only a placeholder. */
export function EvidenceView({ node, selected }: ReactNodeViewProps) {
  const { data } = useReportData();
  const { figureOf } = usePageLayout();
  const ref = useAppendixRef(node);
  const machines = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet }).data?.machines ?? NO_MACHINES;
  const attrs = node.attrs as EvidenceAttrs;
  const entry = data.log.find((e) => e.id === attrs.entryId);

  let body;
  if (!entry) body = <Gone text="This entry was deleted" />;
  else if (entry.private) body = <Gone text="This entry is now private" />;
  else if (attrs.appendix === "moved") body = <AppendixRef label="Full output" refText={ref} />;
  else {
    body = <EntryBody entry={entry} attrs={attrs} figure={figureOf(node)} prompt={promptFor(entry.ranOn, machines)} />;
    if (attrs.appendix === "split")
      body = (
        <>
          {body}
          <AppendixRef label="Full output" refText={ref} />
        </>
      );
  }
  return (
    <Block selected={selected} kind="evidence">
      {body}
    </Block>
  );
}
