import type { InputHTMLAttributes, ReactNode, Ref } from "react";

/**
 * The palette's and the drawer's search field: one rounded field with a leading search glyph and the host scope
 * (`trailing`, usually a `HostPicker`) built in at its right edge.
 */
export function SearchBar({ label, trailing, inputRef, ...input }: InputHTMLAttributes<HTMLInputElement> & {
  /** The field's accessible name; also names the search region. */
  label: string;
  trailing?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-line-2 bg-bg pl-3 pr-1.5 hover:border-line-strong focus-within:border-line-strong"
    >
      <span aria-hidden="true" className="shrink-0 text-[13px] leading-none text-muted">⌕</span>
      <input
        ref={inputRef}
        type="text"
        aria-label={label}
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
        {...input}
      />
      {trailing ?? <span className="shrink-0 px-1.5 text-xs whitespace-nowrap text-muted">for no host</span>}
    </div>
  );
}
