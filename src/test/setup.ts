import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library can't register its own cleanup.
afterEach(() => cleanup());

// jsdom gaps that Radix Select relies on.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

// jsdom has no canvas: the lock screen's ciphertext field draws nothing in tests.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

// jsdom gap that shadcn's Sidebar (useIsMobile) relies on: no media query ever matches.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

// jsdom gaps that react-resizable-panels trips on. Every rect is 0x0 at the origin, so each pointerdown lands on a
// separator's hit area and the library swallows it (no mousedown, so Radix tabs never switch): its own nodes report a
// box far off-screen instead. And with no layout every size is 0, so the library can't size a group: each panel
// reports 400px, enough for its pixel constraints, collapse and expand. Nothing else changes.
const isResizable = (el: Element) => el.hasAttribute("data-panel") || el.hasAttribute("data-separator") || el.hasAttribute("data-group");
const rect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function (this: Element) {
  return isResizable(this) ? new DOMRect(-10000, -10000, 0, 0) : rect.call(this);
};
for (const prop of ["offsetHeight", "offsetWidth"] as const) {
  const base = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)!;
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-panel") ? 400 : base.get!.call(this);
    },
  });
}
