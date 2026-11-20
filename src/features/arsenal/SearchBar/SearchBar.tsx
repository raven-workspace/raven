import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import "./SearchBar.scss";
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
      className="search-bar"
    >
      <span aria-hidden="true" className="search-bar__icon"><MagnifyingGlassIcon size={13} weight="light" /></span>
      <input
        ref={inputRef}
        type="text"
        aria-label={label}
        autoComplete="off"
        className="search-bar__input"
        {...input}
      />
      {trailing === undefined ? <span className="search-bar__scope">for no host</span> : trailing}
    </div>
  );
}
