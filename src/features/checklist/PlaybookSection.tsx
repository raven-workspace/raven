import { useState, type ReactNode } from "react";

/** A collapsible group of goals with a heading and its trigger text. */
export function PlaybookSection({
  title,
  opensWhen,
  defaultOpen,
  note,
  children,
}: {
  title: string;
  opensWhen: string;
  /** Open because its trigger has fired; a hand toggle overrides it. */
  defaultOpen: boolean;
  /** Shown while the trigger has not fired. */
  note?: string;
  children: ReactNode;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? defaultOpen;
  return (
    <section aria-label={title} className="flex flex-col gap-1 border-t border-line pt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManual(!open)}
        className="flex w-full cursor-default items-center gap-2 text-left text-[13px] font-semibold text-fg"
      >
        <span className="w-4 text-xs text-muted" aria-hidden>{open ? "▾" : "▸"}</span>
        {title}
      </button>
      <p className="m-0 pl-6 text-xs text-muted">Opens when {opensWhen}</p>
      {!defaultOpen && note && <p className="m-0 pl-6 text-xs text-muted">{note}</p>}
      {open && <ul className="m-0 list-none p-0">{children}</ul>}
    </section>
  );
}
