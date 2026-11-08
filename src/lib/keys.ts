import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

/** True when the key went to a text field, select or editable element. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // isContentEditable, or the attribute itself where the DOM doesn't implement it (jsdom).
  if (target.isContentEditable || target.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(type);
  }
  // Radix Select trigger and open listbox.
  return target.closest('[role="combobox"], [role="listbox"]') !== null;
}

/** True while any modal dialog (Radix) is open. */
export function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/** True when a plain app shortcut (no ⌘/Ctrl/Alt) may handle this key. */
export function isFreeKey(e: KeyboardEvent): boolean {
  return !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target) && !isDialogOpen();
}

/** Global keydown listener whose handler always sees the latest props. */
export function useKeydown(handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

/**
 * Esc navigates to `path`, unless a dialog is open (Radix closes it first) or
 * focus is in a text field (Esc then just leaves the field).
 */
export function useEscapeTo(path: string) {
  const navigate = useNavigate();
  useKeydown((e) => {
    if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen()) return;
    if (isTypingTarget(e.target)) {
      (e.target as HTMLElement).blur();
      return;
    }
    e.preventDefault();
    void navigate(path);
  });
}

/** The current time, refreshed every `everyMs`. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
