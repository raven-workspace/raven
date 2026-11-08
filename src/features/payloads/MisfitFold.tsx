import { useState } from "react";
import type { PayloadDef } from "../../engines/payloads/types";

/** "N don't fit here: show", folded by default; open, each misfit with its reason. Never hidden altogether. */
export function MisfitFold({ misfits }: { misfits: { def: PayloadDef; reason: string }[] }) {
  const [open, setOpen] = useState(false);
  if (misfits.length === 0) return null;
  return (
    <div className="grid gap-1 text-xs text-muted">
      <p className="m-0">
        {misfits.length} don't fit here:{" "}
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="cursor-default text-fg-2 underline-offset-2 hover:underline">
          {open ? "hide" : "show"}
        </button>
      </p>
      {open && (
        <ul aria-label="Don't fit here" className="m-0 grid list-none gap-0.5 p-0">
          {misfits.map(({ def, reason }) => (
            <li key={def.id} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-3">
              <span className="truncate text-fg-2">{def.title}</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
