import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
/**
 * The palette's and the drawer's search field: one rounded field with a leading search glyph and the host scope
 * (`trailing`, usually a `HostChip`) built in at its right edge.
 */
export function SearchBar({ label, trailing, inputRef, ...input }: InputHTMLAttributes<HTMLInputElement> & {
  /** The field's accessible name; also names the search region. */
  label: string;
  /** Undefined shows "for no host"; null shows nothing (the host chips sit outside the field). */
  trailing?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      // The field draws the box, so the focus ring is the box's: the same 1px accent outline every other input gets,
      // only while the text field itself is focused (not the host chip inside the bar).
      className="grid h-9 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-sm border border-line-2 bg-bg pl-3 pr-2 text-body text-fg hover:border-line-strong focus-within:border-line-strong has-[input:focus-visible]:outline has-[input:focus-visible]:outline-1 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent"
    >
      <span aria-hidden="true" className="text-body leading-none text-muted"><MagnifyingGlassIcon size={13} weight="light" /></span>
      <input
        ref={inputRef}
        type="text"
        aria-label={label}
        autoComplete="off"
        className="h-full min-w-0 bg-transparent text-body text-fg outline-none placeholder:text-muted"
        {...input}
      />
      {trailing === undefined ? <span className="px-2 text-meta whitespace-nowrap text-muted">for no host</span> : trailing}
    </div>
  );
}
