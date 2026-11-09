import { useState, type KeyboardEvent, type ReactNode } from "react";
import { LISTENERS } from "../../engines/payloads/listeners";
import type { BuiltPayload, ListenerId, PayloadDef } from "../../engines/payloads/types";
import { cx } from "../../lib/cx";
import { CommandBlock, Disclosure, labelClass } from "../../ui";
import { ChipPicker } from "../arsenal/ChipPicker";

type CopyResult = Promise<"copied" | "guarded">;

/** A copy guard note under one block; `warn` says whether it is a hold-back (amber) or a confirmation (muted). */
const Note = ({ text, warn }: { text?: string | null; warn?: boolean }) =>
  text ? <p role="status" className={`m-0 text-meta ${warn ? "text-warn" : "text-muted"}`}>{text}</p> : null;

/**
 * One built payload: the Kali-side prepare step for a served file, the listener, the payload to paste (or, for an
 * uploaded file, the file to save or make on Kali), the trigger that fires an uploaded file, a note from the copy guard
 * under the block it belongs to, what each part does, and the def's notes. Every block is a CommandBlock with its own
 * Copy button; the payload's, the prepare step's and the trigger's go through the copy guard, as ↵ does.
 * A baked payload whose build is out of date (`stale`) shows its build step first, under an amber "Rebuild first" line.
 * Shared by every generator that builds a payload.
 */
export function PayloadBlock({
  built, pasteLabel, stale, buildStep, lock, note, prepareNote, triggerNote, noteWarn, fields, numbered,
  onCopy, onCopyPrepare, onCopyTrigger, onCopyListener, onPickListener,
}: {
  built: BuiltPayload; pasteLabel: string;
  /** `Rebuild first: built with …, now …`, for a baked payload whose LHOST or LPORT has changed since its last build. */
  stale?: string | null;
  /** Which block builds a baked payload: its prepare step, or the payload itself (msfvenom, a file made on Kali). */
  buildStep?: "prepare" | "payload" | null;
  /** The exam's Metasploit lock line above the payload: amber when it is a breach, muted otherwise. */
  lock?: { text: string; breach: boolean } | null;
  /** The copy guard's hint or confirmation, under the payload, the prepare step or the trigger. */
  note?: string | null; prepareNote?: string | null; triggerNote?: string | null; noteWarn?: boolean;
  /** Fill fields (LHOST and the payload's other placeholders), above the copy blocks. */
  fields?: ReactNode;
  /** Number the copy blocks as steps ("1. Listener on Kali", "2. Paste into …"), as the Workbench does. */
  numbered?: boolean;
  /** The payload's Copy (the copy guard); the prepare step's and the trigger's; the listener's Copy (⌥L). */
  onCopy: () => CopyResult; onCopyPrepare?: () => CopyResult; onCopyTrigger?: () => CopyResult; onCopyListener: () => void;
  /** Picks another of the def's listeners (session memory, per payload); a picker shows when it has more than one. */
  onPickListener?: (id: ListenerId) => void;
}) {
  type Step = "prepare" | "listener" | "payload" | "trigger";
  const present: Step[] = [
    ...(built.prepare ? ["prepare" as const] : []), ...(built.listener ? ["listener" as const] : []),
    "payload", ...(built.trigger ? ["trigger" as const] : []),
  ];
  // Out of date: the build step goes first, so you rebuild before anything else.
  const first = stale && buildStep && present.includes(buildStep) ? buildStep : null;
  const order = first ? [first, ...present.filter((p) => p !== first)] : present;
  const heading = (step: Step, label: string) => (numbered ? `${order.indexOf(step) + 1}. ${label}` : label);
  const staleLine = (step: Step) => first === step && <p className="m-0 text-meta text-warn">{stale}</p>;

  const listeners = built.def.listeners;
  const listenerPicker = onPickListener && listeners.length > 1 && built.listenerId && (
    <ChipPicker
      options={listeners.map((l) => ({ id: l, name: LISTENERS[l].label }))} value={built.listenerId}
      onPick={(id) => id && onPickListener(id as ListenerId)}
      label={`Listener: ${LISTENERS[built.listenerId].label}`} listLabel="Listener" title="Pick the listener for this payload (this session)"
      prefix="Listener" shown={LISTENERS[built.listenerId].label}
    />
  );
  const blocks: Record<Step, () => ReactNode> = {
    prepare: () => (
      <section key="prepare" className="grid gap-2">
        {staleLine("prepare")}
        <h3 className={`${labelClass} m-0`}>{heading("prepare", "Prepare on Kali")}</h3>
        <CommandBlock text={built.prepare!} name="Prepare on Kali" copyLabel="Copy prepare on Kali" onCopyAction={onCopyPrepare} placeholders />
        <Note text={prepareNote} warn={noteWarn} />
      </section>
    ),
    listener: () => (
      <section key="listener" className="grid gap-2">
        {/* The heading, with the listener picker on its right when the payload has more than one. */}
        <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3">
          <h3 className={`${labelClass} m-0`}>
            {heading("listener", numbered && built.listenerHeading === "Listener" ? "Listener on Kali" : built.listenerHeading)}
          </h3>
          {listenerPicker}
        </div>
        <CommandBlock text={built.listener!} name="Listener" copyLabel="Copy listener" onCopyAction={onCopyListener} placeholders />
      </section>
    ),
    payload: () => (
      <section key="payload" className="grid gap-2">
        {staleLine("payload")}
        {lock && <p className={`m-0 text-meta ${lock.breach ? "text-warn" : "text-muted"}`}>{lock.text}</p>}
        <h3 className={`${labelClass} m-0`}>{heading("payload", pasteLabel)}</h3>
        <CommandBlock text={built.text} name="Payload" copyLabel="Copy payload" onCopyAction={onCopy} placeholders />
        <Note text={note} warn={noteWarn} />
      </section>
    ),
    trigger: () => (
      <section key="trigger" className="grid gap-2">
        <h3 className={`${labelClass} m-0`}>{heading("trigger", "Trigger it")}</h3>
        <CommandBlock text={built.trigger!.text} name="Trigger" copyLabel="Copy trigger" onCopyAction={onCopyTrigger} placeholders />
        <Note text={triggerNote} warn={noteWarn} />
      </section>
    ),
  };
  return (
    <div className="grid gap-4">
      {fields}
      {order.map((step) => blocks[step]())}
      {built.parts.length > 0 && (
        <section className="grid gap-2">
          <h3 className={`${labelClass} m-0`}>What each part does</h3>
          <dl className="m-0 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-meta">
            {built.parts.map((p) => (
              <div key={p.token} className="contents">
                <dt className="break-all font-mono text-code text-fg">{p.token}</dt>
                <dd className="m-0 text-muted">{p.explain}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {built.notes.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0 text-meta text-muted">
          {built.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

/** What each `requires` entry means for a fit, as the row's reason. */
const REQUIRE_REASON: Record<PayloadDef["requires"][number], string> = {
  nc: "uses nc",
  "nc-e": "needs nc with -e",
  python3: "uses python3",
  powershell: "uses PowerShell",
  bash: "uses bash",
  php: "uses PHP",
  perl: "uses perl",
  socat: "uses socat",
  curl: "uses curl",
  wget: "uses wget",
  awk: "uses awk",
  busybox: "uses busybox",
  "served-file": "serves a file from Kali",
};

const SHAPE_REASON: Record<NonNullable<PayloadDef["shape"]>, string> = { bind: "bind", webshell: "web shell" };

/**
 * One row of the fit list: why this payload fits, each reason its own span; "Best fit" on the first of a ranked list.
 * Marks (why it sorted down) come first, in amber; then a bind or web shell says so; then what it requires.
 */
function FitRow({ def, best, marks, selected, onSelect, id }: {
  def: PayloadDef; best: boolean; marks: string[]; selected: boolean; onSelect: () => void; id: string;
}) {
  const reasons = [...(def.shape ? [SHAPE_REASON[def.shape]] : []), ...def.requires.map((r) => REQUIRE_REASON[r])];
  const all = [...marks, ...reasons];
  return (
    <div
      id={id} role="option" aria-selected={selected} onClick={onSelect} title={def.title}
      className={cx(
        "grid min-h-9 cursor-default grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-center gap-4 border-t border-line px-3 py-2 first:border-t-0",
        selected ? "bg-surface-hi shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-hi",
      )}
    >
      <span data-fit-name="" className={cx("min-w-0 truncate text-body", selected ? "font-medium text-accent" : "text-fg")}>{def.title}</span>
      <span className="min-w-0 truncate text-right text-meta text-muted" title={all.join(", ")}>
        {best && <span className="text-fg-2">Best fit</span>}
        {all.map((r, i) => <span key={r} className={cx((best || i > 0) && "ml-3", i < marks.length && "text-warn")}>{r}</span>)}
      </span>
    </div>
  );
}

/**
 * The shared body of the drawer and the Workbench. At the top, the fits as a list of selectable rows (best fit first,
 * each with why it fits), with "Don't fit here (N)" as its last row, a Disclosure that opens the misfits and their
 * reasons. A click, ↑↓ in the list or ⇥ on the body picks the fit; hover only highlights. Then the picked payload.
 * `ordered` lists steps in order instead of by fit.
 */
export function PayloadView({ fits, misfits, marks = {}, index, onIndex, ordered, built, fitsLine, ...block }: {
  fits: PayloadDef[]; misfits: { def: PayloadDef; reason: string }[];
  /** Why a fit sorted down, by def id (amber in its row); it stays selectable. */
  marks?: Record<string, string[]>;
  index: number; onIndex: (i: number) => void; ordered?: boolean;
  /** The payload at `index`, built for the current values. */
  built: BuiltPayload | null;
  /** Why they fit, e.g. "Fits: Windows, Web shell ?cmd=". */
  fitsLine?: string | null;
} & Omit<Parameters<typeof PayloadBlock>[0], "built">) {
  const [misfitsOpen, setMisfitsOpen] = useState(false);
  const current = fits[index];
  const listId = ordered ? "payload-steps" : "payload-fits";
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const to = e.key === "ArrowDown" ? index + 1 : e.key === "ArrowUp" ? index - 1 : e.key === "Home" ? 0 : e.key === "End" ? fits.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    onIndex(Math.max(0, Math.min(fits.length - 1, to)));
  };
  return (
    <div className="grid content-start gap-4">
      <div className="grid gap-2">
        {fitsLine && <p className="m-0 text-meta text-muted">{fitsLine}</p>}
        <div className="grid overflow-hidden rounded-md border border-line-2">
          {fits.length > 0 ? (
            <div
              role="listbox" aria-label={ordered ? "Steps" : "Fits"} tabIndex={0} onKeyDown={onListKey}
              aria-activedescendant={`${listId}-${index}`}
              className="grid focus-visible:outline-offset-[-2px]"
            >
              {fits.map((d, i) => (
                <FitRow key={d.id} id={`${listId}-${i}`} def={d} best={!ordered && i === 0} marks={marks[d.id] ?? []} selected={i === index} onSelect={() => onIndex(i)} />
              ))}
            </div>
          ) : (
            <p className="m-0 px-3 py-2 text-meta text-muted">Nothing fits what is known about this host. Check the reasons below, or change OS or paste context above.</p>
          )}
          {misfits.length > 0 && (
            // pl-1 + the Disclosure's own 4px: the caret's stroke (6px into its 16px box) lands on the fit names' 12px edge.
            <div className="border-t border-line py-1 pr-2 pl-1">
              <Disclosure label="Don't fit here" count={misfits.length} open={misfitsOpen} onOpenChange={setMisfitsOpen}>
                <ul aria-label="Don't fit here" className="m-0 grid list-none gap-1 p-0 pt-1 pb-2">
                  {misfits.map(({ def, reason }) => (
                    <li key={def.id} className="grid grid-cols-[16px_minmax(0,14rem)_minmax(0,1fr)] items-start gap-2 px-1 text-meta">
                      <span />
                      <span className="truncate text-fg-2" title={def.title}>{def.title}</span>
                      <span className="text-muted">{reason}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </div>
          )}
        </div>
      </div>
      {current && built && (
        <>
          {/* The fit list already shows the picked name; the heading stays for the outline and screen readers. */}
          <h2 className="sr-only">{current.title}</h2>
          <PayloadBlock built={built} {...block} />
        </>
      )}
    </div>
  );
}
