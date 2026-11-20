import { XIcon } from "@phosphor-icons/react";
import type { Editor } from "prosekit/core";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  entryPhase,
  entryIdsIn,
  isPortScan,
  machinesInOrder,
  targetCredentials,
  type Phase,
  type ReportData,
  type ReportMeta,
  type ReportNode,
  type ReportTarget,
} from "../../engines/report";
import { openThreads } from "../../engines/notes/threads";
import { detectAndParseScan } from "../../engines/parse/scan";
import { cx } from "../../lib/cx";
import { isDialogOpen, isTypingTarget } from "../../lib/keys";
import type { Credential } from "../../types/credentials";
import type { LogEntry } from "../../types/log";
import { BELOW_TITLE_BAR, Button, IconButton, labelClass, Tooltip, useDrawerPresence } from "../../ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/shadcn/tabs";
import { KIND_LABELS } from "../log/kindLabels";
import { insertEntry } from "./editor/pageActions";
import { hasPageCursor } from "./editor/ReportEditor";
import { clockTime } from "../engagements/format";

type RailTab = "unused" | "notes" | "creds";


/** An entry the report keeps to the operator: a failed attempt logged with an operator-only reason (or kept private). */
const operatorOnly = (data: ReportData, e: LogEntry) => data.attempts.some((a) => a.logEntryId === e.id && (a.private || a.reasonKind === "operator"));

/** Host-linked, non-private entries (any host of the target) with no block on the page sourced from them
 *  (`entryIdsIn`), in time order. An entry behind an operator-reason attempt never shows. */
export function unusedEntries(data: ReportData, target: ReportTarget, doc: ReportNode): LogEntry[] {
  const onPage = entryIdsIn(doc);
  return data.log
    .filter((e) => !e.private && !onPage.has(e.id) && e.hostIds.some((h) => target.hostIds.includes(h)) && !operatorOnly(data, e))
    .sort((a, b) => a.at - b.at || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** One row of the log column: the entry, one line of what it showed, and why it may already be covered. */
export interface RailRow {
  entry: LogEntry;
  line: string;
  /** A port scan whose open ports are all in the port table; a failed attempt, listed in Also tested. */
  note?: "in-ports" | "in-tested";
}

/** One phase of a machine's log that is not in the report. */
export interface RailGroup {
  hostId: string;
  phase: Phase;
  label: string;
  rows: RailRow[];
}

const PHASE_LABELS: Partial<Record<Phase, string>> = {
  enum: "Service enumeration",
  foothold: "Initial access",
  lateral: "Lateral movement",
  privesc: "Privilege escalation",
  domain: "Domain compromise",
  post: "Post-exploitation",
};
const GROUP_ORDER: Phase[] = ["enum", "foothold", "lateral", "privesc", "domain", "post"];

const outputsOf = (e: LogEntry) => (e.content.kind === "command" ? e.content.blocks.map((b) => b.output ?? "") : []);
const firstLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== "");

/** The scan's open ports, all already in the host's services (the port table lists them). */
function scanInPortTable(data: ReportData, hostId: string, e: LogEntry): boolean {
  if (!isPortScan(e)) return false;
  const open = outputsOf(e).flatMap((o) => detectAndParseScan(o)?.ports.filter((p) => p.state === "open").map((p) => p.port) ?? []);
  const known = new Set(data.services.filter((s) => s.hostId === hostId).map((s) => s.port));
  return open.length > 0 && open.every((p) => known.has(p));
}

function railRow(data: ReportData, hostId: string, e: LogEntry): RailRow {
  const outputs = outputsOf(e);
  const line = outputs.map(firstLine).find((l) => l != null) ?? firstLine(e.observations ?? "") ?? "no output";
  const tested = data.attempts.some((a) => a.logEntryId === e.id && !a.private && a.reasonKind !== "operator");
  const note = scanInPortTable(data, hostId, e) ? "in-ports" : tested ? "in-tested" : undefined;
  return { entry: e, line, ...(note ? { note } : {}) };
}

interface Placed {
  hostId: string;
  phase: Phase;
  row: RailRow;
}
const rowCache = new WeakMap<ReportData, WeakMap<ReportTarget, Map<string, Placed>>>();

/**
 * The log column (§10.1): the target's log that is not in the report, per machine (in page order) and phase (the phase
 * `phaseInsertAt` would place it in), time order inside each group. Private entries and operator-reason attempts never
 * show.
 */
export function railGroups(data: ReportData, target: ReportTarget, doc: ReportNode): RailGroup[] {
  // An entry's phase and row depend on the data alone: worked out once per load, not on every keystroke.
  const byTarget = rowCache.get(data) ?? new WeakMap<ReportTarget, Map<string, Placed>>();
  rowCache.set(data, byTarget);
  const known = byTarget.get(target) ?? new Map<string, Placed>();
  byTarget.set(target, known);
  const placed = unusedEntries(data, target, doc).map((e) => {
    let p = known.get(e.id);
    if (!p) {
      const { hostId, phase } = entryPhase(data, target, e);
      p = { hostId, phase, row: railRow(data, hostId, e) };
      known.set(e.id, p);
    }
    return p;
  });
  return machinesInOrder(data, target).flatMap((hostId) =>
    GROUP_ORDER.flatMap((phase) => {
      const rows = placed.filter((p) => p.hostId === hostId && p.phase === phase).map((p) => p.row);
      return rows.length > 0 ? [{ hostId, phase, label: PHASE_LABELS[phase]!, rows }] : [];
    }),
  );
}

const NOTE_TEXT: Record<NonNullable<RailRow["note"]>, string> = {
  "in-ports": "in the port table already",
  "in-tested": "in Also tested",
};

/** What an entry's row leads with: the first command of a command entry, else its title. */
const commandOf = (e: LogEntry) => (e.content.kind === "command" ? e.content.blocks[0]?.command?.split("\n")[0] : undefined) || e.title;

function RailItem({ row, onAct }: { row: RailRow; onAct(row: RailRow, from: HTMLElement | null): void }) {
  const { entry, line, note } = row;
  const lead = commandOf(entry);
  const onKey = (ev: KeyboardEvent<HTMLLIElement>) => {
    const li = ev.currentTarget;
    if (ev.target !== li) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      onAct(row, li);
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const rows = [...(li.closest("[data-rail-log]")?.querySelectorAll<HTMLElement>("li[data-rail-row]") ?? [])];
      rows[rows.indexOf(li) + (ev.key === "ArrowDown" ? 1 : -1)]?.focus();
    }
  };
  return (
    <li
      tabIndex={0}
      data-rail-row=""
      aria-label={`${entry.title}, ${KIND_LABELS[entry.kind]} at ${clockTime(entry.at)}`}
      onKeyDown={onKey}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-sm border-l-2 border-line-2 py-1 pr-1 pl-3 outline-none hover:bg-surface-hi focus-visible:bg-surface-hi focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span className="grid min-w-0 gap-1">
        <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-code text-muted" title={lead}>
          <time dateTime={new Date(entry.at).toISOString()} className="tabular-nums">
            {clockTime(entry.at)}
          </time>{" "}
          <span className="truncate">{lead}</span>
        </span>
        <span className="truncate text-meta text-fg-2" title={line}>
          {line}
        </span>
        {note && <span className="text-meta text-muted-2">{NOTE_TEXT[note]}</span>}
      </span>
      <Tooltip
        content={
          <>
            <span>Add to the step you're on, else the end of its phase</span>
            <span className="ml-2 font-mono text-muted">⌘↵</span>
          </>
        }
      >
        <Button size="sm" aria-label={`Add ${entry.title}`} onClick={(e) => onAct(row, e.currentTarget.closest("li"))}>
          + add
        </Button>
      </Tooltip>
    </li>
  );
}

function LogTab({
  data,
  target,
  meta,
  groups,
  editor,
  onInserted,
}: {
  data: ReportData;
  target: ReportTarget;
  meta: ReportMeta;
  groups: RailGroup[];
  editor: Editor | null;
  onInserted(entryId: string): void;
}) {
  const act = (row: RailRow, li: HTMLElement | null) => {
    if (!editor) return;
    // Keyboard focus stays in the column: the row is about to leave it.
    if (li && li === document.activeElement) {
      const rows = [...(li.closest("[data-rail-log]")?.querySelectorAll<HTMLElement>("li[data-rail-row]") ?? [])];
      const i = rows.indexOf(li);
      (rows[i + 1] ?? rows[i - 1])?.focus();
    }
    insertEntry(editor, data, target, row.entry, hasPageCursor(editor), meta);
    onInserted(row.entry.id);
  };

  if (groups.length === 0) return <p className="m-0 text-meta text-muted-2">Everything logged on this target is in the report.</p>;
  const name = (id: string) => data.hosts.find((h) => h.id === id)?.name ?? "Host";
  const hosts = [...new Set(groups.map((g) => g.hostId))];
  return (
    <div role="group" aria-label="Unused log entries" data-rail-log="" className="grid gap-4">
      {hosts.map((hostId) => (
        <section key={hostId} aria-label={`${name(hostId)} log`} className="grid gap-3">
          <h3 className={cx(labelClass, "m-0 grid grid-flow-col justify-start gap-2")}>
            <span>{`${name(hostId)} log`}</span>{" "}
            <span className="text-muted-2">not in the report</span>
          </h3>
          {groups
            .filter((g) => g.hostId === hostId)
            .map((g) => (
              <section key={g.phase} className="grid gap-2">
                <h4 className="m-0 text-body font-semibold text-fg">{g.label}</h4>
                <ul aria-label={hosts.length > 1 ? `${name(hostId)} ${g.label}` : g.label} className="m-0 grid list-none gap-2 p-0">
                  {g.rows.map((r) => (
                    <RailItem key={r.entry.id} row={r} onAct={act} />
                  ))}
                </ul>
              </section>
            ))}
        </section>
      ))}
    </div>
  );
}

/** A note's lines, read-only; an open thread (`? `) is marked with a dot. */
function NoteLines({ body }: { body: string }) {
  const threads = new Set(openThreads(body).map((t) => t.line));
  return (
    <div className="grid gap-1 text-body text-fg-2 select-text">
      {body.split("\n").map((line, i) => (
        <p key={i} className="m-0 grid grid-cols-[8px_minmax(0,1fr)] items-baseline gap-2 whitespace-pre-wrap break-words">
          <span aria-hidden className={cx("size-1.5 rounded-full", threads.has(i) && "bg-fg-2")} />
          <span>
            {threads.has(i) && <span className="sr-only">Open thread: </span>}
            {line}
          </span>
        </p>
      ))}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="grid gap-2">
      <h3 className={cx(labelClass, "m-0")}>{label}</h3>
      {children}
    </section>
  );
}

function NotesTab({ data, target, didWell }: { data: ReportData; target?: ReportTarget; didWell: boolean }) {
  const name = (id: string) => data.hosts.find((h) => h.id === id)?.name ?? "Host";
  const notes = data.notes
    .filter((n) => !n.private && n.body.trim() !== "" && (n.hostId === null || target?.hostIds.includes(n.hostId)))
    .sort((a, b) => (a.hostId === null ? 1 : 0) - (b.hostId === null ? 1 : 0) || name(a.hostId ?? "").localeCompare(name(b.hostId ?? "")));
  const ruledOut = target ? data.ruledOut.filter((r) => !r.private && r.hostId !== null && target.hostIds.includes(r.hostId)) : [];
  const controls = didWell ? data.attempts.filter((a) => !a.private && a.reasonKind === "control") : [];
  if (notes.length === 0 && ruledOut.length === 0 && controls.length === 0) {
    return <p className="m-0 text-meta text-muted-2">No notes for this page yet. Write them in the notes panel (N).</p>;
  }
  return (
    <div className="grid gap-4">
      {notes.map((n) => (
        <Block key={n.ownerId} label={n.hostId === null ? "Engagement note" : `${name(n.hostId)} note`}>
          <NoteLines body={n.body} />
        </Block>
      ))}
      {ruledOut.length > 0 && (
        <Block label="Ruled out">
          <ul className="m-0 grid list-none gap-2 p-0">
            {ruledOut.map((r) => (
              <li key={r.id} className="grid gap-1">
                <span className="text-body text-fg-2">{r.text}</span>
                {r.reason && <span className="text-meta text-muted-2">{r.reason}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {controls.length > 0 && (
        <Block label="What the targets did well">
          <ul className="m-0 grid list-none gap-2 p-0">
            {controls.map((a) => (
              <li key={a.id} className="grid gap-1">
                <span className="text-body text-fg-2">{a.title}</span>
                {a.reason && <span className="text-meta text-muted-2">{a.reason}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

const who = (c: Pick<Credential, "username" | "domain">) => (c.domain ? `${c.domain}\\${c.username}` : c.username);

function CredsTab({ data, target }: { data: ReportData; target: ReportTarget }) {
  const name = (id: string) => data.hosts.find((h) => h.id === id)?.name ?? "Host";
  // Found here, local here, tried here and it worked (nxc, hydra), or used in a login here; and the access gained.
  const { credentials: creds, access: grants } = useMemo(() => targetCredentials(data, target.hostIds), [data, target.hostIds]);
  if (creds.length === 0 && grants.length === 0) {
    return <p className="m-0 text-meta text-muted-2">No credential results or access recorded for this target.</p>;
  }
  return (
    <div className="grid gap-4">
      {creds.length > 0 && (
        <Block label="Credentials">
          <ul className="m-0 grid list-none gap-2 p-0">
            {creds.map((c) => (
              <li key={c.key} className="grid min-w-0 gap-1">
                <span className="truncate text-code text-fg" title={who(c)}>
                  {who(c)}
                </span>
                <span className="text-meta text-muted-2">
                  {c.type}, {c.ties.join("; ")}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      {grants.length > 0 && (
        <Block label="Access">
          <ul className="m-0 grid list-none gap-2 p-0">
            {grants.map(({ grant: g, user }) => (
              <li key={g.id} className="grid gap-1">
                <span className="text-body text-fg-2">
                  {user ? who(user) : "Unknown user"} on {name(g.hostId)}: {g.level}
                </span>
                {g.via && <span className="text-meta text-muted-2">{g.via}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

/**
 * The evidence rail: the log column (the target's log not in the report, by phase, `railGroups`), the notes, and the target's credentials. Without a target (a front-matter
 * page) only the notes are shown.
 */
export function EvidenceRail({
  target,
  data,
  doc,
  editor,
  didWell = false,
  meta = {},
  onInserted,
}: {
  target?: ReportTarget;
  data: ReportData;
  doc: ReportNode;
  editor: Editor | null;
  /** The report's meta, for the draft's placement of an entry. */
  meta?: ReportMeta;
  /** The Summary is open: list the controls that blocked attempts under "What the targets did well". */
  didWell?: boolean;
  onInserted(entryId: string): void;
}) {
  const [tab, setTab] = useState<RailTab>("unused");
  const groups = useMemo(() => (target ? railGroups(data, target, doc) : []), [data, target, doc]);
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  const active: RailTab = target ? tab : "notes";
  return (
    <Tabs value={active} onValueChange={(v) => setTab(v as RailTab)} className="content-start">
      <TabsList aria-label="Evidence">
        {target && <TabsTrigger value="unused">{`Unused (${count})`}</TabsTrigger>}
        <TabsTrigger value="notes">Notes</TabsTrigger>
        {target && <TabsTrigger value="creds">Creds</TabsTrigger>}
      </TabsList>
      {target && (
        <TabsContent value="unused">
          <LogTab data={data} target={target} meta={meta} groups={groups} editor={editor} onInserted={onInserted} />
        </TabsContent>
      )}
      <TabsContent value="notes">
        <NotesTab data={data} target={target} didWell={didWell} />
      </TabsContent>
      {target && (
        <TabsContent value="creds">
          <CredsTab data={data} target={target} />
        </TabsContent>
      )}
    </Tabs>
  );
}

/** Whether a menu, a list or a Radix popover is open: Esc closes that first. ProseKit keeps its closed menus and
 *  lists in the DOM, marked closed. */
const popupOpen = () =>
  document.querySelector(':is([role="menu"], [role="listbox"]):not([data-state="closed"], [hidden]), [data-radix-popper-content-wrapper]') !== null;

/** The rail as a drawer from the right edge (under 1200px): E or the strip button toggles it, Esc and the X close it. */
export function EvidenceDrawer({
  open,
  focusKey,
  onClose,
  children,
}: {
  open: boolean;
  /** Changing it while open moves focus to the tabs again (⌥3 on an open drawer). */
  focusKey: number;
  onClose(): void;
  children: React.ReactNode;
}) {
  const [present, ref] = useDrawerPresence<HTMLElement>(open);
  // Opening moves focus to the rail's tabs; closing gives it back to where it was.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, [open]);
  useEffect(() => {
    if (open && present) ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [open, present, focusKey, ref]);
  // Esc closes the drawer before anything else hears it: in the capture phase, so the engagement's own Esc (back to
  // the dashboard), registered before the drawer mounted, never runs first.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      // Esc meant for something else stays its: typing in a field or the page, an open menu, list or popover.
      if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen() || isTypingTarget(e.target) || popupOpen()) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  if (!present) return null;
  return (
    <aside
      ref={ref}
      aria-label="Evidence"
      className={`fixed ${BELOW_TITLE_BAR} right-0 z-30 grid w-80 max-w-[90vw] grid-rows-[auto_minmax(0,1fr)] border-l border-line-2 bg-surface`}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-2">
        <h2 className={cx(labelClass, "m-0")}>Evidence</h2>
        <IconButton icon={XIcon} label="Close" shortcut="Esc" onClick={onClose} />
      </header>
      <div className="min-h-0 overflow-y-auto px-4 py-4">{children}</div>
    </aside>
  );
}
