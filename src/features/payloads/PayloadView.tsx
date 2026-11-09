import { useState, type KeyboardEvent, type ReactNode } from "react";
import { LISTENERS } from "../../engines/payloads/listeners";
import type { BuiltPayload, ListenerId, PayloadDef } from "../../engines/payloads/types";
import { cx } from "../../lib/cx";
import { CommandBlock, Disclosure, labelClass } from "../../ui";
import { ChipPicker } from "../arsenal/ChipPicker";

type CopyResult = Promise<"copied" | "guarded">;

/**
 * One built payload: the Kali-side prepare step for a served file, the listener, an amber stale line when a baked file
 * is out of date, the payload to paste, a note from the copy guard, what each part does, and the def's notes. Every
 * block is a CommandBlock with its own Copy button; the payload's goes through the copy guard (`onCopy`), as ↵ does.
 * Shared by every generator that builds a payload.
 */
export function PayloadBlock({ built, pasteLabel, stale, note, noteWarn, fields, numbered, onCopy, onCopyListener, onPickListener }: {
  built: BuiltPayload; pasteLabel: string;
  /** `Built at … with …; rebuild it`, for a baked payload whose LHOST or LPORT has changed since. */
  stale?: string | null;
  /** The copy guard's hint or confirmation. */
  note?: string | null; noteWarn?: boolean;
  /** Fill fields (LHOST and the payload's other placeholders), above the copy blocks. */
  fields?: ReactNode;
  /** Number the copy blocks as steps ("1. Listener on Kali", "2. Paste into …"), as the Workbench does. */
  numbered?: boolean;
  /** The payload's Copy (the copy guard); the listener's Copy (⌥L). */
  onCopy: () => CopyResult; onCopyListener: () => void;
  /** Picks another of the def's listeners (session memory, per payload); a picker shows when it has more than one. */
  onPickListener?: (id: ListenerId) => void;
}) {
  let step = 0;
  const heading = (label: string) => (numbered ? `${++step}. ${label}` : label);
  const prepareHeading = built.prepare ? heading("Prepare on Kali") : "";
  const listenerHeading = built.listener
    ? heading(numbered && built.listenerHeading === "Listener" ? "Listener on Kali" : built.listenerHeading)
    : "";
  const listeners = built.def.listeners;
  const listenerPicker = onPickListener && listeners.length > 1 && built.listenerId && (
    <ChipPicker
      options={listeners.map((l) => ({ id: l, name: LISTENERS[l].label }))} value={built.listenerId}
      onPick={(id) => id && onPickListener(id as ListenerId)}
      label={`Listener: ${LISTENERS[built.listenerId].label}`} listLabel="Listener" title="Pick the listener for this payload (this session)"
      prefix="Listener" shown={LISTENERS[built.listenerId].label}
    />
  );
  const pasteHeading = heading(pasteLabel);
  return (
    <div className="grid gap-4">
      {fields}
      {built.prepare && (
        <section className="grid gap-2">
          <h3 className={`${labelClass} m-0`}>{prepareHeading}</h3>
          <CommandBlock text={built.prepare} name="Prepare on Kali" copyLabel="Copy prepare on Kali" placeholders />
        </section>
      )}
      {built.listener && (
        <section className="grid gap-2">
          {/* The heading, with the listener picker on its right when the payload has more than one. */}
          <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3">
            <h3 className={`${labelClass} m-0`}>{listenerHeading}</h3>
            {listenerPicker}
          </div>
          <CommandBlock text={built.listener} name="Listener" copyLabel="Copy listener" onCopyAction={onCopyListener} placeholders />
        </section>
      )}
      <section className="grid gap-2">
        {stale && <p className="m-0 text-meta text-warn">{stale}</p>}
        <h3 className={`${labelClass} m-0`}>{pasteHeading}</h3>
        <CommandBlock text={built.text} name="Payload" copyLabel="Copy payload" onCopyAction={onCopy} placeholders />
        {note && <p role="status" className={`m-0 text-meta ${noteWarn ? "text-warn" : "text-muted"}`}>{note}</p>}
      </section>
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
