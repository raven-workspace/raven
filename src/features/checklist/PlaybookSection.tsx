import { useState, type ReactNode } from "react";

/** A collapsible group of goals with a heading and its trigger text. */
export function PlaybookSection({
  title,
  opensWhen,
  defaultOpen,
  openRequest,
  children,
}: {
  title: string;
  opensWhen: string;
  /** Open because its trigger has fired; a hand toggle overrides it. */
  defaultOpen: boolean;
  /** Changes each time something asks for the section open; it overrides a hand collapse. */
  openRequest?: number;
  children: ReactNode;
}) {
  const [manual, setManual] = useState<boolean | null>(openRequest !== undefined ? true : null);
  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (openRequest !== seenRequest) {
    setSeenRequest(openRequest);
    if (openRequest !== undefined) setManual(true);
  }
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
      {open && <ul className="m-0 list-none p-0">{children}</ul>}
    </section>
  );
}
