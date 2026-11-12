import { ArrowsOutLineHorizontal, Highlighter, PencilSimpleLine, Scissors, Trash } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { TextSelection } from "prosekit/pm/state";
import type { ReactNodeViewProps } from "prosekit/react";
import { ResizableHandle, ResizableRoot } from "prosekit/react/resizable";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { applyKeep, captionOf, lineCount, type EvidenceAttrs, type ReportNode } from "../../../../engines/report";
import { api } from "../../../../lib/api";
import type { CommandBlock, LogEntry } from "../../../../types/log";
import { Button, HintLine, IconButton, Toolbar, type Hint } from "../../../../ui";
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

/** Whether a pasted `user@host` prompt's host is one of the attacker's machines (Settings), as "Kali (VM)" names "kali". */
const isAttacker = (host: string, machines: string[]) =>
  machines.some((m) => {
    const name = m.toLowerCase();
    return name === host.toLowerCase() || name.split(/[\s(]/)[0] === host.toLowerCase();
  });

/** Whether a block with no prompt captured shows a root shell: `id` printing uid 0, or a `whoami` in it printing
 *  exactly root or SYSTEM. A line that merely says "root" (a file listing, a group) is not enough. */
function showsRoot(block: Pick<CommandBlock, "command" | "output">): boolean {
  const output = block.output ?? "";
  if (/(?:^|\s)uid=0\(/m.test(output)) return true;
  if (!/\bwhoami\b/i.test(block.command ?? "")) return false;
  return output.split(/\r?\n/).some((l) => /^\s*(?:root|nt authority\\system)\s*$/i.test(l));
}

/**
 * A pasted block's own shell, when the paste recorded one, else the entry's prompt: `*Evil-WinRM* PS>`, `PS>`, `C:\>`
 * for cmd (the paste keeps no folder), `user@host$` (`#` for root), and the attacker's own shell as `kali$` like the
 * entry prompt beside it. A root shell ends in `#`: a bare `#` prompt (`root`), or, with no prompt captured, output
 * that shows root (`showsRoot`).
 */
function blockPrompt(block: Pick<CommandBlock, "shell" | "root" | "output" | "command"> | undefined, entryPrompt: string, machines: string[]): string {
  const shell = block?.shell;
  const asRoot = (p: string) => p.replace(/\$$/, "#");
  if (!shell || shell === "sh") {
    const root = block?.root === true || (!shell && block != null && showsRoot(block));
    return root ? asRoot(entryPrompt) : entryPrompt;
  }
  if (shell === "evil-winrm") return "*Evil-WinRM* PS>";
  if (shell === "powershell") return "PS>";
  if (shell === "cmd") return "C:\\>";
  const [user, host = ""] = shell.split("@");
  const end = user === "root" ? "#" : "$";
  return isAttacker(host, machines) ? `kali${end}` : `${shell}${end}`;
}

/** Each block's prompt: its own shell when the paste recorded one, else the entry's. */
type Prompt = (block?: Pick<CommandBlock, "shell" | "root" | "output" | "command">) => string;
const promptsFor = (ranOn: string | null, machines: string[]): Prompt => {
  const entry = promptFor(ranOn, machines);
  return (block) => blockPrompt(block, entry, machines);
};

/** How the owner is picking lines on a selected command block, if at all. */
type PickMode = "trim" | "emphasis" | null;

/** Trimming's view of the lines: the run picked (inclusive, null when none) and the line cursor, with the pointer
 *  handlers on the line numbers. */
interface TrimLines {
  from: number | null;
  to: number | null;
  cursor: number | null;
  onDown(n: number, shift: boolean): void;
  onEnter(n: number): void;
}

/**
 * The command blocks of a placement. `keep` and `emphasis` index the placement's output: one block's, or with
 * `block: null` every block's output end to end (as the appendix engine counts it). While trimming, every line shows
 * with its number, the cut ones struck through; while emphasising, the kept lines show with a number to emphasise them.
 */
function CommandBody({
  blocks,
  attrs,
  prompt,
  mode = null,
  onLine,
  trim,
}: {
  blocks: CommandBlock[];
  attrs: EvidenceAttrs;
  prompt: Prompt;
  mode?: PickMode;
  onLine?(n: number, shift: boolean): void;
  trim?: TrimLines;
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
          <span className="report-prompt">{prompt(b)}</span> {b.command}
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
            const isKept = kept === null || kept.has(n);
            const text = (
              <div className="report-line" key={k} data-emphasis={emphasis.has(n) || undefined} data-dropped={(mode === "trim" && !isKept) || undefined}>
                {item.text}
              </div>
            );
            if (mode === "trim" && trim) {
              const picked = trim.from !== null && trim.to !== null && n >= trim.from && n <= trim.to;
              return (
                <div className="report-pick" key={k} data-picked={picked || undefined} data-cursor={trim.cursor === n || undefined}>
                  {/* Pointer only: the trim bar above takes the keys (↑↓ ⇧↑↓ Space ⌫). */}
                  <button
                    type="button"
                    tabIndex={-1}
                    className="report-ln"
                    aria-label={`${isKept ? "Cut" : "Keep"} line ${n + 1}`}
                    aria-pressed={isKept}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      trim.onDown(n, e.shiftKey);
                    }}
                    onPointerEnter={() => trim.onEnter(n)}
                  >
                    {n + 1}
                  </button>
                  {text}
                </div>
              );
            }
            if (!mode || !onLine) return text;
            const on = emphasis.has(n);
            return (
              <div className="report-pick" key={k}>
                <button
                  type="button"
                  className="report-ln"
                  aria-label={`Emphasise line ${n + 1}`}
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

/** A figure's caption and width as the page sets them: the caption typed on the page, the width it was resized to. */
interface FigureEdit {
  caption: string;
  width: number | null;
  onCaption(caption: string): void;
  onWidth(width: number): void;
  /** Leaves the caption for the page (Enter or Esc in it). */
  onDone(): void;
}

/** The caption, typed in place on the paper. It is the node's own (the log keeps its caption); empty shows the prompt. */
function CaptionField({ value, n, onChange, onDone }: { value: string; n: number | null; onChange(v: string): void; onDone(): void }) {
  const [text, setText] = useState(value);
  const [was, setWas] = useState(value);
  const [focused, setFocused] = useState(false);
  // An undo or another change from outside the field shows here, but never while the owner is typing in it.
  if (was !== value) {
    setWas(value);
    if (!focused) setText(value);
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      onDone();
    }
  };
  return (
    <figcaption className="report-caption">
      {n !== null && <span>{`Figure ${n}. `}</span>}
      <input
        className="report-caption-input"
        aria-label={n === null ? "Caption" : `Figure ${n} caption`}
        placeholder="Write a caption"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(value);
        }}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        onKeyDown={onKey}
      />
    </figcaption>
  );
}

function Figure({ entryId, attachmentId, caption, n, edit }: { entryId: string; attachmentId: string; caption: string; n: number | null; edit?: FigureEdit }) {
  const { onImageWidth } = useReportData();
  const image = <AttachmentImage id={attachmentId} alt={caption} onWidth={onImageWidth ? (w) => onImageWidth(entryId, w) : undefined} />;
  if (!edit) {
    return (
      <figure className="report-figure">
        {image}
        <figcaption>{n === null ? caption : `Figure ${n}. ${caption}`}</figcaption>
      </figure>
    );
  }
  return (
    <figure className="report-figure">
      {/* Drag the corner to size the screenshot on the page; the width is the node's, in px at the page's measure. */}
      <ResizableRoot
        className="report-resizable"
        width={edit.width ?? undefined}
        onResizeEnd={(e) => edit.onWidth(Math.round(e.detail.width))}
      >
        {image}
        <ResizableHandle position="bottom-right" className="report-resize-handle" aria-label="Resize the screenshot" />
      </ResizableRoot>
      <CaptionField value={edit.caption} n={n} onChange={edit.onCaption} onDone={edit.onDone} />
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
  edit,
  trim,
  stepTitle,
}: {
  entry: LogEntry;
  attrs: EvidenceAttrs;
  figure: number | null;
  prompt: Prompt;
  /** For an uncaptioned screenshot: the title of the step it tags along with, its caption's fallback. */
  stepTitle?: string | null;
  mode?: PickMode;
  onLine?(n: number, shift: boolean): void;
  /** On the page (not the appendix): the screenshot's caption and size are edited in place. */
  edit?: Omit<FigureEdit, "caption" | "width">;
  trim?: TrimLines;
}) {
  const c = entry.content;
  switch (c.kind) {
    case "command":
      if (attrs.block !== null && !c.blocks[attrs.block]) return <Gone text="This command was removed from its entry" />;
      return <CommandBody blocks={c.blocks} attrs={attrs} prompt={prompt} mode={mode} onLine={onLine} trim={trim} />;
    case "screenshot":
      return (
        <Figure
          entryId={entry.id}
          attachmentId={c.attachmentId}
          caption={captionOf(attrs as unknown as Record<string, unknown>, entry, stepTitle)}
          n={figure}
          edit={edit && { ...edit, caption: captionOf(attrs as unknown as Record<string, unknown>, entry, stepTitle), width: attrs.width ?? null }}
        />
      );
    case "flag":
      return (
        <div className="report-flag">
          <p>
            <strong>{c.flagKind === "local" ? "Local.txt value:" : "Proof.txt value:"}</strong> <code>{c.value}</code>
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

/** The language a command block's prompt suggests: PowerShell for `PS>` shells, Bash for Unix ones, else plain. */
function shellLanguage(prompt: string): string {
  if (/PS>$/.test(prompt)) return "powershell";
  if (/[$#]$/.test(prompt)) return "bash";
  return "";
}

/**
 * A command or HTTP evidence block as a code block the owner edits on the page: the text as the page shows it now
 * (prompt and command, the kept output with its omitted counts; or the request, then the response), the language set,
 * and the entry kept as provenance (`fromEntry`). It no longer follows the log. Null for other kinds.
 */
export function detachedBlock(entry: LogEntry, attrs: EvidenceAttrs, prompt: Prompt): ReportNode | null {
  const c = entry.content;
  let text: string;
  let language: string;
  if (c.kind === "command") {
    const chosen = attrs.block === null ? c.blocks : c.blocks.slice(attrs.block, attrs.block + 1);
    let offset = 0;
    text = chosen
      .map((b) => {
        const output = b.output ?? "";
        const start = offset;
        offset += lineCount(output);
        const keep = attrs.keep === null ? null : attrs.keep.map(([a, z]): [number, number] => [a - start, z - start]);
        const lines =
          output === ""
            ? []
            : applyKeep(output, keep).map((item) =>
                item.kind === "omitted" ? `… ${item.count} ${item.count === 1 ? "line" : "lines"} omitted` : item.text,
              );
        return [`${prompt(b)} ${b.command}`, ...lines].join("\n");
      })
      .join("\n\n");
    language = shellLanguage(prompt(chosen[0]));
  } else if (c.kind === "http") {
    text = c.response ? `${c.request}\n\n${c.response}` : c.request;
    language = "http";
  } else return null;
  return { type: "codeBlock", attrs: { language, fromEntry: entry.id }, ...(text ? { content: [{ type: "text", text }] } : {}) };
}

/** An evidence block in full, as the appendix prints it: every line of its output, no figure number. */
export function FullEvidence({ attrs }: { attrs: EvidenceAttrs }) {
  const { data } = useReportData();
  const machines = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet }).data?.machines ?? NO_MACHINES;
  const entry = data.log.find((e) => e.id === attrs.entryId);
  if (!entry) return <Gone text="This entry was deleted" />;
  if (entry.private) return <Gone text="This entry is now private" />;
  return <EntryBody entry={entry} attrs={{ ...attrs, keep: null }} figure={null} prompt={promptsFor(entry.ranOn, machines)} />;
}

/** The output lines a placement shows: one block's, or every block's end to end. */
function placementLines(entry: LogEntry | undefined, attrs: EvidenceAttrs): number {
  if (entry?.content.kind !== "command") return 0;
  const blocks = entry.content.blocks;
  const chosen = attrs.block === null ? blocks : blocks.slice(attrs.block, attrs.block + 1);
  return chosen.reduce((n, b) => n + lineCount(b.output ?? ""), 0);
}

const span = (a: number, b: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i);

/**
 * Trimming a command's output. Every line starts kept. A click on a line number cuts it (or keeps it again); dragging
 * down the numbers does the same to the whole run, the way the first line went; a shift-click does it from the last
 * line clicked. From the keyboard, on the trim bar: ↑↓ move a line cursor, ⇧↑↓ extend the run, Space flips the run,
 * ⌫ cuts it, Esc leaves. The page keeps the same merged `keep` ranges (null when every line is kept).
 */
function useTrim(attrs: EvidenceAttrs, total: number, setAttrs: (a: Partial<EvidenceAttrs>) => void) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  // The drag under way: where it started, whether it keeps or cuts, and the lines kept before it.
  const drag = useRef<{ start: number; keep: boolean; base: Set<number> } | null>(null);
  const last = useRef<number | null>(null);

  const keptSet = () => new Set(attrs.keep === null ? span(0, total - 1) : expandRanges(attrs.keep));
  const write = (kept: Set<number>) => setAttrs({ keep: kept.size >= total ? null : toRanges([...kept]) });
  const apply = (lines: number[], keep: boolean, base = keptSet()) => {
    const next = new Set(base);
    for (const n of lines) if (keep) next.add(n);
    else next.delete(n);
    write(next);
  };
  const pick = (a: number, b: number) => {
    setAnchor(a);
    setCursor(b);
  };

  useEffect(() => {
    const up = () => (drag.current = null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const from = anchor === null || cursor === null ? null : Math.min(anchor, cursor);
  const to = anchor === null || cursor === null ? null : Math.max(anchor, cursor);
  const run = from === null || to === null ? [] : span(from, to);

  const lines: TrimLines = {
    from,
    to,
    cursor,
    onDown: (n, shift) => {
      const base = keptSet();
      if (shift && last.current !== null) {
        // The range takes the state the last click left its line in.
        apply(span(last.current, n), base.has(last.current), base);
        pick(last.current, n);
        return;
      }
      const keep = !base.has(n);
      drag.current = { start: n, keep, base };
      last.current = n;
      apply([n], keep, base);
      pick(n, n);
    },
    onEnter: (n) => {
      const d = drag.current;
      if (!d) return;
      apply(span(d.start, n), d.keep, d.base);
      pick(d.start, n);
    },
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, leave: () => void) => {
    if (total === 0) return;
    const at = cursor ?? -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(0, Math.min(total - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
      if (e.shiftKey) pick(anchor ?? Math.max(0, at), next);
      else pick(next, next);
      last.current = next;
    } else if (e.key === " " && run.length > 0) {
      e.preventDefault();
      apply(run, !keptSet().has(cursor!));
    } else if ((e.key === "Backspace" || e.key === "Delete") && run.length > 0) {
      e.preventDefault();
      apply(run, false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      leave();
    }
  };

  const keptCount = attrs.keep === null ? total : expandRanges(attrs.keep).filter((n) => n < total).length;
  return {
    lines,
    run,
    keptCount,
    onKey,
    cutRun: () => apply(run, false),
    keepOnlyRun: () => write(new Set(run)),
    keepAll: () => setAttrs({ keep: null }),
  };
}

const TRIM_KEYS: Hint[] = [
  { keys: "↑ ↓", label: "move", priority: 1 },
  { keys: "⇧↑ ⇧↓", label: "extend", priority: 2 },
  { keys: "Space", label: "cut or keep", priority: 3 },
  { keys: "⌫", label: "cut", priority: 4 },
  { keys: "Esc", label: "done", priority: 5 },
];

/**
 * The bar over the output while trimming (Ink chrome on the paper): how many lines are kept, the run's actions, and
 * the keys. It takes the keys itself, so it has focus while trimming.
 */
function TrimBar({ trim, total, onLeave }: { trim: ReturnType<typeof useTrim>; total: number; onLeave(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      ref={ref}
      contentEditable={false}
      tabIndex={0}
      data-trim=""
      role="toolbar"
      aria-label="Trim the output"
      onKeyDown={(e) => trim.onKey(e, onLeave)}
      className="grid gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 font-sans outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4">
        <span aria-live="polite" className="text-body text-fg tabular-nums">{`${trim.keptCount} of ${total} lines kept`}</span>
        <span className="truncate text-meta text-muted-2">{trim.run.length === 0 ? "Drag down the line numbers to cut a run" : ""}</span>
        <Toolbar>
          {trim.run.length > 0 && (
            <>
              <Button size="sm" onClick={trim.cutRun}>
                Cut selection
              </Button>
              <Button size="sm" onClick={trim.keepOnlyRun}>
                Keep only selection
              </Button>
            </>
          )}
          {trim.keptCount < total && (
            <Button size="sm" onClick={trim.keepAll}>
              Keep all
            </Button>
          )}
        </Toolbar>
      </div>
      <HintLine hints={TRIM_KEYS} ariaLabel="Trim keys" />
    </div>
  );
}

/**
 * A log entry on the page, rendered from the live row; a deleted or private entry leaves only a placeholder. Selected,
 * it shows its tools: Trim and Emphasise lines (command output), Move to appendix, Remove.
 */
export function EvidenceView({ node, selected, setAttrs, view, getPos }: ReactNodeViewProps) {
  const { data, onRemoveEvidence, canMove = false } = useReportData();
  const { figureOf, stepTitleOf, touched } = usePageLayout();
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
    if (mode === "emphasis") setAttrs({ emphasis: pickLines(attrs.emphasis, n, from) });
  };
  const total = placementLines(shown, attrs);
  const trim = useTrim(attrs, total, setAttrs);
  const leaveTrim = () => {
    setPicking(null);
    view.focus();
  };
  const detach = () => {
    const pos = getPos();
    if (pos === undefined || !shown) return;
    const made = detachedBlock(shown, attrs, promptsFor(shown.ranOn, machines));
    if (!made) return;
    const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, view.state.schema.nodeFromJSON(made));
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView());
    view.focus();
  };
  const isShot = shown?.content.kind === "screenshot";
  const backToPage = () => {
    view.focus();
  };
  const remove = () => {
    const pos = getPos();
    if (pos === undefined) return;
    onRemoveEvidence(attrs.entryId);
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
    view.focus();
  };

  // An uncaptioned screenshot's caption falls back to the step it tags along with (the block above it on the page).
  const stepTitle = shown?.content.kind === "screenshot" ? stepTitleOf(node) : null;
  const refLabel = REF_LABEL[shown?.content.kind ?? "command"];
  let body;
  if (!entry) body = <Gone text="This entry was deleted" />;
  else if (entry.private) body = <Gone text="This entry is now private" />;
  else if (attrs.appendix === "moved") body = <AppendixRef label={refLabel} refText={ref} />;
  else {
    body = (
      <EntryBody
        entry={entry}
        attrs={attrs}
        figure={figureOf(node)}
        prompt={promptsFor(entry.ranOn, machines)}
        mode={mode}
        onLine={onLine}
        trim={trim.lines}
        stepTitle={stepTitle}
        edit={{ onCaption: (caption) => setAttrs({ caption }), onWidth: (width) => setAttrs({ width }), onDone: backToPage }}
      />
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
          {/* Inline only: a split block's full copy lives in the appendix, which a code block on the page can't feed. */}
          {(isCommand || shown?.content.kind === "http") && attrs.appendix === "inline" && (
            <IconButton icon={PencilSimpleLine} label="Edit on page (stops following the log entry)" onClick={detach} />
          )}
          {isShot && attrs.width != null && (
            <IconButton icon={ArrowsOutLineHorizontal} label="Full width" onClick={() => setAttrs({ width: null })} />
          )}
          {shown && canMove && <MoveButton place={attrs.appendix} canSplit={isCommand} onMove={(next) => setAttrs({ appendix: next })} />}
          <IconButton icon={Trash} label="Remove" shortcut="⌫" tone="destructive" onClick={remove} />
        </BlockTools>
      )}
      {/* Trimming: the count and the run's actions, on the paper above the output (the gutter holds only icons). */}
      {mode === "trim" && <TrimBar trim={trim} total={total} onLeave={leaveTrim} />}
      {body}
    </Block>
  );
}
