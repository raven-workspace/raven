import { CaretDown, CaretRight } from "@phosphor-icons/react";
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
  const Caret = open ? CaretDown : CaretRight;
  return (
    <section aria-label={title} className="grid gap-1 border-t border-line pt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManual(!open)}
        className="grid min-h-7 w-full cursor-default grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-sm text-left text-body font-semibold text-fg hover:bg-surface-hi"
      >
        <Caret size={16} className="text-muted" aria-hidden />
        <span className="truncate">{title}</span>
      </button>
      <p className="m-0 pl-6 text-meta text-muted">Opens when {opensWhen}</p>
      {open && <ul className="m-0 list-none p-0">{children}</ul>}
    </section>
  );
}
