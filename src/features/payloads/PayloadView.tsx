import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { LISTENERS } from "../../engines/payloads/listeners";
import type { BuiltPayload, ListenerId, PayloadDef, PayloadPart } from "../../engines/payloads/types";
import { cx } from "../../lib/cx";
import { CommandBlock, Disclosure, Kbd, labelClass } from "../../ui";
import { ChipPicker } from "../arsenal/ChipPicker";
import "./PayloadView.scss";

type CopyResult = Promise<"copied" | "guarded">;

/** A copy guard note under one block; `warn` says whether it is a hold-back (amber) or a confirmation (muted). */
const Note = ({ text, warn }: { text?: string | null; warn?: boolean }) =>
  text ? <p role="status" className={cx("payload-block__note", warn && "payload-block__note--warn")}>{text}</p> : null;

/**
 * One built payload: the Kali-side prepare step for a served file, the listener, the payload to paste (or, for an
 * uploaded file, the file to save or make on Kali), the trigger that fires an uploaded file, a note from the copy guard
 * under the block it belongs to, what each part does, and the def's notes. Every block is a CommandBlock with its own
 * Copy button; the payload's, the prepare step's, the trigger's and the listener's go through the copy guard, as ↵ does.
 * A baked payload whose build is out of date (`stale`) shows its build step first, under an amber "Rebuild first" line.
 * Shared by every generator that builds a payload.
 */
export function PayloadBlock({
  built, pasteLabel, pasteFile, stale, buildStep, lock, note, prepareNote, triggerNote, listenerNote, noteWarn, fields, numbered,
  onCopy, onCopyPrepare, onCopyTrigger, onCopyListener, onPickListener,
}: {
  built: BuiltPayload; pasteLabel: string;
  /** The uploaded file's name inside `pasteLabel`: shown as typed (a Linux name is case-sensitive), not in the label's capitals. */
  pasteFile?: string | null;
  /** `Rebuild first: built with …, now …`, for a baked payload whose LHOST or LPORT has changed since its last build. */
  stale?: string | null;
  /** Which block builds a baked payload: its prepare step, or the payload itself (msfvenom, a file made on Kali). */
  buildStep?: "prepare" | "payload" | null;
  /** The exam's Metasploit lock line above the payload: amber when it is a breach, muted otherwise. */
  lock?: { text: string; breach: boolean } | null;
  /** The copy guard's hint or confirmation, under the payload, the prepare step, the trigger or the listener. */
  note?: string | null; prepareNote?: string | null; triggerNote?: string | null; listenerNote?: string | null; noteWarn?: boolean;
  /** Fill fields (LHOST and the payload's other placeholders), above the copy blocks. */
  fields?: ReactNode;
  /** Number the copy blocks as steps ("1. Listener on Kali", "2. Paste into …"), as the Workbench does. */
  numbered?: boolean;
  /** The payload's Copy (the copy guard); the prepare step's and the trigger's; the listener's Copy (⌥L). */
  onCopy: () => CopyResult; onCopyPrepare?: () => CopyResult; onCopyTrigger?: () => CopyResult; onCopyListener: () => CopyResult;
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
  /** The paste heading; an uploaded file's name keeps its case (the label style capitalises everything else). */
  const payloadHeading = () => {
    const at = pasteFile ? pasteLabel.indexOf(pasteFile) : -1;
    if (!pasteFile || at < 0) return heading("payload", pasteLabel);
    const head = heading("payload", pasteLabel.slice(0, at));
    return <>{head}<code data-upload-file="" className="payload-block__file">{pasteFile}</code>{pasteLabel.slice(at + pasteFile.length)}</>;
  };
  const staleLine = (step: Step) => first === step && <p className="payload-block__stale">{stale}</p>;

  const listeners = built.def.listeners;
  // A bind shell's "listener" is the client you connect with, so its chip says so under "Connect from Kali".
  const pickName = built.listenerHeading === "Connect from Kali" ? "Connect with" : "Listener";
  const listenerPicker = onPickListener && listeners.length > 1 && built.listenerId && (
    <ChipPicker
      options={listeners.map((l) => ({ id: l, name: LISTENERS[l].label }))} value={built.listenerId}
      onPick={(id) => id && onPickListener(id as ListenerId)}
      label={`${pickName}: ${LISTENERS[built.listenerId].label}`} listLabel={pickName}
      title={pickName === "Listener" ? "Pick the listener for this payload (this session)" : "Pick what you connect with from Kali (this session)"}
      prefix={pickName} shown={LISTENERS[built.listenerId].label}
    />
  );
  const blocks: Record<Step, () => ReactNode> = {
    prepare: () => (
      <section key="prepare" className="payload-block__step">
        {staleLine("prepare")}
        <h3 className={labelClass}>{heading("prepare", "Prepare on Kali")}</h3>
        <CommandBlock text={built.prepare!} name="Prepare on Kali" copyLabel="Copy prepare on Kali" onCopyAction={onCopyPrepare} placeholders />
        <Note text={prepareNote} warn={noteWarn} />
      </section>
    ),
    listener: () => (
      <section key="listener" className="payload-block__step">
        {/* The heading, with the listener picker on its right when the payload has more than one. */}
        <div className="payload-block__step-head">
          <h3 className={labelClass}>
            {heading("listener", numbered && built.listenerHeading === "Listener" ? "Listener on Kali" : built.listenerHeading)}
          </h3>
          {listenerPicker}
        </div>
        <CommandBlock text={built.listener!} name="Listener" copyLabel="Copy listener" onCopyAction={onCopyListener} placeholders />
        <Note text={listenerNote} warn={noteWarn} />
      </section>
    ),
    payload: () => (
      <section key="payload" className="payload-block__step">
        {staleLine("payload")}
        {lock && <p className={cx("payload-block__lock", lock.breach && "payload-block__lock--breach")}>{lock.text}</p>}
        <h3 className={labelClass}>{payloadHeading()}</h3>
        {/* A key to press (Ctrl-Z) is shown as a key, with no Copy. */}
        {built.def.keypress
          ? <p><Kbd className="payload-block__key">{built.text}</Kbd></p>
          : <CommandBlock text={built.text} name="Payload" copyLabel="Copy payload" onCopyAction={onCopy} placeholders />}
        <Note text={note} warn={noteWarn} />
      </section>
    ),
    trigger: () => (
      <section key="trigger" className="payload-block__step">
        <h3 className={labelClass}>{heading("trigger", "Trigger it")}</h3>
        <CommandBlock text={built.trigger!.text} name="Trigger" copyLabel="Copy trigger" onCopyAction={onCopyTrigger} placeholders />
        <Note text={triggerNote} warn={noteWarn} />
      </section>
    ),
  };
  return (
    <div className="payload-block">
      {fields}
      {order.map((step) => blocks[step]())}
      <PartsList title="What each part does" parts={built.parts.filter((p) => !p.decoded)} />
      <PartsList title="Inside the base64 script" parts={built.parts.filter((p) => p.decoded)} />
      {built.notes.length > 0 && (
        <ul className="payload-block__notes">
          {built.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

/** A "what each part does" list; decoded parts (inside an encoded blob) get their own list. Nothing when empty. */
function PartsList({ title, parts }: { title: string; parts: PayloadPart[] }) {
  const id = useId();
  if (parts.length === 0) return null;
  return (
    <section aria-labelledby={id} className="payload-parts">
      <h3 id={id} className={labelClass}>{title}</h3>
      <dl className="payload-parts__list">
        {parts.map((p) => (
          <div key={p.token} className="payload-parts__item">
            <dt className="payload-parts__token">{p.token}</dt>
            <dd className="payload-parts__explain">{p.explain}</dd>
          </div>
        ))}
      </dl>
    </section>
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
      className="fit-row"
    >
      <span data-fit-name="" className="fit-row__name">{def.title}</span>
      <span className="fit-row__reasons" title={all.join(", ")}>
        {best && <span className="fit-row__best">Best fit</span>}
        {all.map((r, i) => <span key={r} className={cx("fit-row__reason", (best || i > 0) && "fit-row__reason--spaced", i < marks.length && "fit-row__reason--mark")}>{r}</span>)}
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
    // Positioned, so the sr-only heading below stays inside whichever pane scrolls this view.
    <div className="payload-view">
      <div className="payload-view__fits">
        {fitsLine && <p className="payload-view__line">{fitsLine}</p>}
        <div className="payload-view__box">
          {fits.length > 0 ? (
            <div
              role="listbox" aria-label={ordered ? "Steps" : "Fits"} tabIndex={0} onKeyDown={onListKey}
              aria-activedescendant={`${listId}-${index}`}
              className="payload-view__list"
            >
              {fits.map((d, i) => (
                <FitRow key={d.id} id={`${listId}-${i}`} def={d} best={!ordered && i === 0} marks={marks[d.id] ?? []} selected={i === index} onSelect={() => onIndex(i)} />
              ))}
            </div>
          ) : (
            <p className="payload-view__none">Nothing fits what is known about this host. Check the reasons below, or change OS or paste context above.</p>
          )}
          {misfits.length > 0 && (
            // 4px of left padding + the Disclosure's own 4px: the caret's stroke (6px into its 16px box) lands on the fit names' 12px edge.
            <div className="payload-view__misfits">
              <Disclosure label="Don't fit here" count={misfits.length} open={misfitsOpen} onOpenChange={setMisfitsOpen}>
                <ul aria-label="Don't fit here" className="payload-view__misfit-list">
                  {misfits.map(({ def, reason }) => (
                    <li key={def.id} className="payload-view__misfit">
                      <span />
                      <span className="payload-view__misfit-name" title={def.title}>{def.title}</span>
                      <span className="payload-view__misfit-reason">{reason}</span>
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
          <h2 className="payload-view__heading">{current.title}</h2>
          <PayloadBlock built={built} {...block} />
        </>
      )}
    </div>
  );
}
