import type { ReactNode } from "react";

/** The amber block that stands where a referenced row used to be. */
export function Gone({ text }: { text: string }) {
  return <div className="report-gone">{text}</div>;
}

/** Every report block sits in one frame, outlined while selected. */
export function Block({ selected, kind, children }: { selected: boolean; kind: string; children: ReactNode }) {
  return (
    <div className="report-block" data-block={kind} data-selected={selected || undefined}>
      {children}
    </div>
  );
}

/** The one-line pointer a moved block leaves behind: "Full output: Appendix E.2, title". */
export function AppendixRef({ label, refText }: { label: string; refText: string | null }) {
  return <p className="report-ref">{refText ? `${label}: Appendix ${refText}` : `${label}: moved to the appendices`}</p>;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
