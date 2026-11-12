import { XIcon } from "@phosphor-icons/react";
import type { Editor } from "prosekit/core";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { endOfPhase, evidenceIdsIn, evidenceNodes, targetCredentials, type ReportData, type ReportNode, type ReportTarget } from "../../engines/report";
import { openThreads } from "../../engines/notes/threads";
import { cx } from "../../lib/cx";
import { isDialogOpen, useKeydown } from "../../lib/keys";
import type { Credential } from "../../types/credentials";
import type { LogEntry } from "../../types/log";
import { BELOW_TITLE_BAR, Button, IconButton, labelClass, useDrawerPresence } from "../../ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/shadcn/tabs";
import { KIND_LABELS } from "../log/kindLabels";
import { OrderButton } from "../log/OrderButton";
import type { LogOrder } from "../log/usePersistedOrder";
import { hasPageCursor, insertNodesAt, insertNodesAtCursor } from "./editor/ReportEditor";

type RailTab = "unused" | "notes" | "creds";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Host-linked, non-private entries (any host of the target) with no evidence block on the page, in time order. */
export function unusedEntries(data: ReportData, target: ReportTarget, doc: ReportNode): LogEntry[] {
  const onPage = evidenceIdsIn(doc);
  return data.log
    .filter((e) => !e.private && !onPage.has(e.id) && e.hostIds.some((h) => target.hostIds.includes(h)))
    .sort((a, b) => a.at - b.at || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** What an entry's row says besides its title: the first command of a command entry. */
const commandOf = (e: LogEntry) => (e.content.kind === "command" ? e.content.blocks[0]?.command : undefined);

function UnusedRow({ entry, onInsert }: { entry: LogEntry; onInsert(entry: LogEntry, from: HTMLElement | null): void }) {
  const command = commandOf(entry);
  const onKey = (ev: KeyboardEvent<HTMLLIElement>) => {
    const li = ev.currentTarget;
    if (ev.target !== li) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      onInsert(entry, li);
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const next = ev.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling;
      (next as HTMLElement | null)?.focus();
    }
  };
  return (
    <li
      tabIndex={0}
      aria-label={`${entry.title}, ${KIND_LABELS[entry.kind]} at ${clock(entry.at)}`}
      onKeyDown={onKey}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 py-2 outline-none hover:bg-surface-hi focus-visible:bg-surface-hi focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span className="grid justify-items-start gap-1">
        <time dateTime={new Date(entry.at).toISOString()} className="text-code text-muted tabular-nums">
          {clock(entry.at)}
        </time>
        <span className="text-meta text-muted-2">{KIND_LABELS[entry.kind]}</span>
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="truncate text-body text-fg" title={entry.title}>
          {entry.title}
        </span>
        {command && (
          <span className="truncate text-code text-muted" title={command}>
            {command}
          </span>
        )}
      </span>
      <Button size="sm" aria-label={`Insert ${entry.title}`} onClick={(e) => onInsert(entry, e.currentTarget.closest("li"))}>
        Insert
      </Button>
    </li>
  );
}

function UnusedTab({
  data,
  target,
  unused,
  editor,
  onInserted,
}: {
  data: ReportData;
  target: ReportTarget;
  unused: LogEntry[];
  editor: Editor | null;
  onInserted(entryId: string): void;
}) {
  const [order, setOrder] = useState<LogOrder>("oldest");
  const shown = order === "oldest" ? unused : [...unused].reverse();

  const insert = (entry: LogEntry, row: HTMLElement | null) => {
    if (!editor) return;
    // Keyboard focus stays in the list: the row is about to leave it.
    if (row && row === document.activeElement) ((row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null)?.focus();
    if (hasPageCursor(editor)) insertNodesAtCursor(editor, evidenceNodes(entry));
    else {
      const { at, nodes } = endOfPhase(editor.getDocJSON() as ReportNode, data, target, entry);
      insertNodesAt(editor, at, nodes);
    }
    onInserted(entry.id);
  };

  if (unused.length === 0) return <p className="m-0 text-meta text-muted-2">Everything logged on this target is on the page.</p>;
  return (
    <div className="grid gap-2">
      <div className="grid justify-items-end">
        <OrderButton order={order} onChange={setOrder} />
      </div>
      <ul aria-label="Unused log entries" className="m-0 grid list-none gap-1 p-0">
        {shown.map((e) => (
          <UnusedRow key={e.id} entry={e} onInsert={insert} />
        ))}
      </ul>
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
 * The evidence rail: Unused entries to insert, the notes, and the target's credentials. Without a target (a front-matter
 * page) only the notes are shown.
 */
export function EvidenceRail({
  target,
  data,
  doc,
  editor,
  didWell = false,
  onInserted,
}: {
  target?: ReportTarget;
  data: ReportData;
  doc: ReportNode;
  editor: Editor | null;
  /** The Summary is open: list the controls that blocked attempts under "What the targets did well". */
  didWell?: boolean;
  onInserted(entryId: string): void;
}) {
  const [tab, setTab] = useState<RailTab>("unused");
  const unused = useMemo(() => (target ? unusedEntries(data, target, doc) : []), [data, target, doc]);
  const active: RailTab = target ? tab : "notes";
  return (
    <Tabs value={active} onValueChange={(v) => setTab(v as RailTab)} className="content-start">
      <TabsList aria-label="Evidence">
        {target && <TabsTrigger value="unused">{`Unused (${unused.length})`}</TabsTrigger>}
        <TabsTrigger value="notes">Notes</TabsTrigger>
        {target && <TabsTrigger value="creds">Creds</TabsTrigger>}
      </TabsList>
      {target && (
        <TabsContent value="unused">
          <UnusedTab data={data} target={target} unused={unused} editor={editor} onInserted={onInserted} />
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
  useKeydown((e) => {
    if (open && e.key === "Escape" && !e.defaultPrevented && !isDialogOpen()) {
      e.preventDefault();
      onClose();
    }
  });
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
