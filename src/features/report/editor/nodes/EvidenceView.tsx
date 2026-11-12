import { Highlighter, Scissors, Trash } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNodeViewProps } from "prosekit/react";
import { useRef, useState } from "react";
import { applyKeep, lineCount, type EvidenceAttrs } from "../../../../engines/report";
import { api } from "../../../../lib/api";
import type { CommandBlock, LogEntry } from "../../../../types/log";
import { Button, IconButton } from "../../../../ui";
import { AttachmentImage } from "../../../log/AttachmentImage";
import { useAppendixRef, usePageLayout, useReportData } from "../ReportDataContext";
import { AppendixRef, Block, BlockTools, Gone, MoveButton } from "./parts";

const NO_MACHINES: string[] = [];

/** What a moved block's one-line reference calls the content it points at. */
const REF_LABEL: Record<LogEntry["content"]["kind"], string> = {
  command: "Full output",
  screenshot: "Screenshot",
  flag: "Screenshot",
  http: "Full request",
  note: "Full note",
};

/** `kali$` for the attacker's machines (Settings), else the machine the command ran on (`DC01$`). */
function promptFor(ranOn: string | null, machines: string[]): string {
  if (!ranOn) return "$";
  if (machines.includes(ranOn)) return "kali$";
  return `${ranOn}$`;
}

/** How the owner is picking lines on a selected command block, if at all. */
type PickMode = "trim" | "emphasis" | null;

/**
 * The command blocks of a placement. `keep` and `emphasis` index the placement's output: one block's, or with
 * `block: null` every block's output end to end (as the appendix engine counts it). While trimming, every line shows
 * with a number to keep it; while emphasising, the kept lines show with a number to emphasise them.
 */
function CommandBody({
  blocks,
  attrs,
  prompt,
  mode = null,
  onLine,
}: {
  blocks: CommandBlock[];
  attrs: EvidenceAttrs;
  prompt: string;
  mode?: PickMode;
  onLine?(n: number, shift: boolean): void;
}) {
  const chosen = attrs.block === null ? blocks : blocks.slice(attrs.block, attrs.block + 1);
  const emphasis = new Set(attrs.emphasis);
  const kept = attrs.keep === null ? null : new Set(expandRanges(attrs.keep));
  let offset = 0;
  return chosen.map((b, i) => {
    const output = b.output ?? "";
    const start = offset;
    offset += lineCount(output);
    const keep =
      mode === "trim" || attrs.keep === null ? null : attrs.keep.map(([a, z]): [number, number] => [a - start, z - start]);
    return (
      <div className="report-code" key={i}>
        <div className="report-cmd">
          <span className="report-prompt">{prompt}</span> {b.command}
        </div>
        {output !== "" &&
          applyKeep(output, keep).map((item, k) => {
            if (item.kind === "omitted")
              return (
                <div className="report-omitted" key={k}>
                  {`… ${item.count} ${item.count === 1 ? "line" : "lines"} omitted`}
                </div>
              );
            const n = item.n + start;
            const text = (
              <div className="report-line" key={k} data-emphasis={emphasis.has(n) || undefined} data-dropped={(mode === "trim" && kept !== null && !kept.has(n)) || undefined}>
                {item.text}
              </div>
            );
            if (!mode || !onLine) return text;
            // With nothing trimmed yet, no line reads as picked: the first click keeps one line.
            const on = mode === "trim" ? kept !== null && kept.has(n) : emphasis.has(n);
            return (
              <div className="report-pick" key={k}>
                <button
                  type="button"
                  className="report-ln"
                  aria-label={mode === "trim" ? `Keep line ${n + 1}` : `Emphasise line ${n + 1}`}
                  aria-pressed={on}
                  onClick={(e) => onLine(n, e.shiftKey)}
                >
                  {n + 1}
                </button>
                {text}
              </div>
            );
          })}
      </div>
    );
  });
}

/** Every line number inside inclusive ranges, in order. */
function expandRanges(ranges: [number, number][]): number[] {
  const out = new Set<number>();
  for (const [a, b] of ranges) for (let n = a; n <= b; n++) out.add(n);
  return [...out].sort((x, y) => x - y);
}

/** Sorted line numbers as merged inclusive ranges. */
function toRanges(lines: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of [...lines].sort((a, b) => a - b)) {
    const top = out[out.length - 1];
    if (top && n <= top[1] + 1) top[1] = Math.max(top[1], n);
    else out.push([n, n]);
  }
  return out;
}

/** A click toggles one line; a shift-click adds every line from the last one clicked. */
function pickLines(current: number[], n: number, shiftFrom: number | null): number[] {
  const set = new Set(current);
  if (shiftFrom !== null) for (let i = Math.min(shiftFrom, n); i <= Math.max(shiftFrom, n); i++) set.add(i);
  else if (set.has(n)) set.delete(n);
  else set.add(n);
  return [...set].sort((a, b) => a - b);
}

function Figure({ entryId, attachmentId, caption, n }: { entryId: string; attachmentId: string; caption: string; n: number | null }) {
  const { onImageWidth } = useReportData();
  return (
    <figure className="report-figure">
      <AttachmentImage id={attachmentId} alt={caption} onWidth={onImageWidth ? (w) => onImageWidth(entryId, w) : undefined} />
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

function EntryBody({
  entry,
  attrs,
  figure,
  prompt,
  mode,
  onLine,
}: {
  entry: LogEntry;
  attrs: EvidenceAttrs;
  figure: number | null;
  prompt: string;
  mode?: PickMode;
  onLine?(n: number, shift: boolean): void;
}) {
  const c = entry.content;
  switch (c.kind) {
    case "command":
      if (attrs.block !== null && !c.blocks[attrs.block]) return <Gone text="This command was removed from its entry" />;
      return <CommandBody blocks={c.blocks} attrs={attrs} prompt={prompt} mode={mode} onLine={onLine} />;
    case "screenshot":
      return <Figure entryId={entry.id} attachmentId={c.attachmentId} caption={c.caption || entry.title} n={figure} />;
    case "flag":
      return (
        <div className="report-flag">
          <p>
            <strong>{c.flagKind === "local" ? "local.txt" : "proof.txt"}:</strong> <code>{c.value}</code>
          </p>
          {c.proof && <pre className="report-code report-pre">{c.proof}</pre>}
          {c.attachmentId && <Figure entryId={entry.id} attachmentId={c.attachmentId} caption={entry.title} n={figure} />}
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

/** An evidence block in full, as the appendix prints it: every line of its output, no figure number. */
export function FullEvidence({ attrs }: { attrs: EvidenceAttrs }) {
  const { data } = useReportData();
  const machines = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet }).data?.machines ?? NO_MACHINES;
  const entry = data.log.find((e) => e.id === attrs.entryId);
  if (!entry) return <Gone text="This entry was deleted" />;
  if (entry.private) return <Gone text="This entry is now private" />;
  return <EntryBody entry={entry} attrs={{ ...attrs, keep: null }} figure={null} prompt={promptFor(entry.ranOn, machines)} />;
}

/**
 * A log entry on the page, rendered from the live row; a deleted or private entry leaves only a placeholder. Selected,
 * it shows its tools: Trim and Emphasise lines (command output), Move to appendix, Remove.
 */
export function EvidenceView({ node, selected, setAttrs, view, getPos }: ReactNodeViewProps) {
  const { data, onRemoveEvidence, canMove = false } = useReportData();
  const { figureOf, touched } = usePageLayout();
  const ref = useAppendixRef(node);
  const machines = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet }).data?.machines ?? NO_MACHINES;
  const tools = selected && touched;
  const [picking, setPicking] = useState<PickMode>(null);
  // Picking ends when the block's tools hide (deselected), so it doesn't come back on the next selection.
  const [hadTools, setHadTools] = useState(tools);
  if (hadTools !== tools) {
    setHadTools(tools);
    if (!tools) setPicking(null);
  }
  const lastLine = useRef<number | null>(null);
  const attrs = node.attrs as EvidenceAttrs;
  const entry = data.log.find((e) => e.id === attrs.entryId);
  const shown = entry && !entry.private ? entry : undefined;
  const isCommand = shown?.content.kind === "command";
  // Picking lines only while the block is selected and its output is on the page.
  const mode: PickMode = tools && isCommand && attrs.appendix !== "moved" ? picking : null;

  const pickMode = (next: PickMode) => {
    lastLine.current = null;
    setPicking(picking === next ? null : next);
  };
  const onLine = (n: number, shift: boolean) => {
    const from = shift ? lastLine.current : null;
    lastLine.current = n;
    if (mode === "trim") {
      // Picking starts from nothing kept: the first click keeps one line rather than dropping one.
      const lines = pickLines(attrs.keep === null ? [] : expandRanges(attrs.keep), n, from);
      setAttrs({ keep: lines.length === 0 ? null : toRanges(lines) });
    } else if (mode === "emphasis") {
      setAttrs({ emphasis: pickLines(attrs.emphasis, n, from) });
    }
  };
  const remove = () => {
    const pos = getPos();
    if (pos === undefined) return;
    onRemoveEvidence(attrs.entryId);
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
    view.focus();
  };

  const refLabel = REF_LABEL[shown?.content.kind ?? "command"];
  let body;
  if (!entry) body = <Gone text="This entry was deleted" />;
  else if (entry.private) body = <Gone text="This entry is now private" />;
  else if (attrs.appendix === "moved") body = <AppendixRef label={refLabel} refText={ref} />;
  else {
    body = (
      <EntryBody entry={entry} attrs={attrs} figure={figureOf(node)} prompt={promptFor(entry.ranOn, machines)} mode={mode} onLine={onLine} />
    );
    if (attrs.appendix === "split")
      body = (
        <>
          {body}
          <AppendixRef label={refLabel} refText={ref} />
        </>
      );
  }
  return (
    <Block selected={selected} kind="evidence">
      {tools && (
        <BlockTools>
          {mode === "trim" &&
            (attrs.keep === null ? (
              <span className="px-2 text-meta text-muted-2">Pick the lines to keep</span>
            ) : (
              <Button size="sm" onClick={() => setAttrs({ keep: null })}>
                Keep all
              </Button>
            ))}
          {isCommand && (
            <>
              <IconButton icon={Scissors} label="Trim" active={mode === "trim"} disabled={attrs.appendix === "moved"} onClick={() => pickMode("trim")} />
              <IconButton
                icon={Highlighter}
                label="Emphasise lines"
                active={mode === "emphasis"}
                disabled={attrs.appendix === "moved"}
                onClick={() => pickMode("emphasis")}
              />
            </>
          )}
          {shown && canMove && <MoveButton place={attrs.appendix} canSplit={isCommand} onMove={(next) => setAttrs({ appendix: next })} />}
          <IconButton icon={Trash} label="Remove" shortcut="⌫" tone="destructive" onClick={remove} />
        </BlockTools>
      )}
      {body}
    </Block>
  );
}
