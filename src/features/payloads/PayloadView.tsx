import type { ReactNode } from "react";
import type { BuiltPayload, PayloadDef } from "../../engines/payloads/types";
import { labelClass } from "../../ui";
import { MisfitFold } from "./MisfitFold";

const PRE = "m-0 max-h-48 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded-sm border border-line bg-bg px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg";

/**
 * One built payload: the listener, an amber stale line when a baked file is out of date, the payload to paste, a note
 * from the copy guard, what each part does, and the def's notes. Shared by every generator that builds a payload.
 */
export function PayloadBlock({ built, pasteLabel, stale, note, noteWarn, fields }: {
  built: BuiltPayload; pasteLabel: string;
  /** `Built at … with …; rebuild it`, for a baked payload whose LHOST or LPORT has changed since. */
  stale?: string | null;
  /** The copy guard's hint or confirmation. */
  note?: string | null; noteWarn?: boolean;
  /** Fill fields (LHOST and the payload's other placeholders), above the copy blocks. */
  fields?: ReactNode;
}) {
  return (
    <div className="grid gap-3">
      {fields}
      {built.listener && (
        <section className="grid gap-1">
          <h3 className={`${labelClass} m-0`}>Listener</h3>
          <pre aria-label="Listener" className={PRE}>{built.listener}</pre>
        </section>
      )}
      <section className="grid gap-1">
        {stale && <p className="m-0 text-xs text-warn">{stale}</p>}
        <h3 className={`${labelClass} m-0`}>{pasteLabel}</h3>
        <pre aria-label="Payload" className={PRE}>{built.text}</pre>
        {note && <p role="status" className={`m-0 text-xs ${noteWarn ? "text-warn" : "text-muted"}`}>{note}</p>}
      </section>
      {built.parts.length > 0 && (
        <section className="grid gap-1">
          <h3 className={`${labelClass} m-0`}>What each part does</h3>
          <dl className="m-0 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {built.parts.map((p) => (
              <div key={p.token} className="contents">
                <dt className="break-all font-mono text-fg">{p.token}</dt>
                <dd className="m-0 text-muted">{p.explain}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {built.notes.length > 0 && (
        <ul className="m-0 grid list-none gap-0.5 p-0 text-xs text-muted">
          {built.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * The shared body of the drawer and the Workbench: the payload in view (best fit first), its block, the other fits one
 * ⇥ away, and the misfits folded with their reasons. `ordered` lists steps in order instead of by fit.
 */
export function PayloadView({ fits, misfits, index, onIndex, ordered, built, fitsLine, pasteLabel, stale, note, noteWarn, fields }: {
  fits: PayloadDef[]; misfits: { def: PayloadDef; reason: string }[];
  index: number; onIndex: (i: number) => void; ordered?: boolean;
  /** The payload at `index`, built for the current values. */
  built: BuiltPayload | null;
  /** Why it fits, e.g. "Fits: Windows, Web shell ?cmd=". */
  fitsLine?: string | null;
} & Omit<Parameters<typeof PayloadBlock>[0], "built">) {
  const current = fits[index];
  const others = fits.map((d, i) => ({ d, i })).filter(({ i }) => i !== index);
  return (
    <div className="grid content-start gap-3">
      {current && built ? (
        <>
          <header className="grid gap-0.5">
            <span className={labelClass}>{ordered ? `Step ${index + 1} of ${fits.length}` : index === 0 ? "Best fit" : `Fit ${index + 1} of ${fits.length}`}</span>
            <h2 className="m-0 text-[17px] font-semibold text-fg">{current.title}</h2>
            {fitsLine && <span className="text-xs text-accent">{fitsLine}</span>}
          </header>
          <PayloadBlock built={built} pasteLabel={pasteLabel} stale={stale} note={note} noteWarn={noteWarn} fields={fields} />
        </>
      ) : (
        <p className="m-0 text-xs text-muted">Nothing fits what is known about this host. Check the reasons below, or change OS or paste context above.</p>
      )}
      {others.length > 0 && (
        <p className="m-0 text-xs text-muted">
          {ordered ? "Other steps: " : "Also fits: "}
          {others.map(({ d, i }, n) => (
            <span key={d.id}>
              {n > 0 && " · "}
              <button type="button" onClick={() => onIndex(i)} className="cursor-default text-fg-2 underline-offset-2 hover:underline">{d.title}</button>
            </span>
          ))}
        </p>
      )}
      <MisfitFold misfits={misfits} />
    </div>
  );
}
