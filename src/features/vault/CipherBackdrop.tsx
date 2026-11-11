import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { cx } from "../../lib/cx";
import { CipherField, type PulseKind } from "./cipherField";

export interface CipherHandle {
  pulse: (kind: PulseKind) => void;
  /** Clears the field from the password field outward; resolves when the app is fully revealed. */
  sweep: () => Promise<void>;
}

/** Marks the element the field keeps clear of (the unlock form). */
export const CIPHER_CLEAR = { "data-cipher-clear": "" } as const;
/** Marks the element rings start from (the password field). With several, the focused one wins. */
export const CIPHER_ORIGIN = { "data-cipher-origin": "" } as const;

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * The lock screen's ciphertext field. Fills its positioned parent; the parent also holds the form marked with
 * CIPHER_CLEAR and CIPHER_ORIGIN. `front` lifts it over the app for the unlock sweep.
 */
export function CipherBackdrop({ ref, front }: { ref?: Ref<CipherHandle>; front: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<CipherField | null>(null);

  /** The marked elements' boxes, in canvas coordinates. */
  const measure = () => {
    const canvas = canvasRef.current;
    const scope = canvas?.parentElement;
    if (!canvas || !scope) return null;
    const c = canvas.getBoundingClientRect();
    const rel = (r: DOMRect) => new DOMRect(r.left - c.left, r.top - c.top, r.width, r.height);
    const clearEl = scope.querySelector("[data-cipher-clear]");
    const originEl = scope.querySelector("[data-cipher-origin]:focus") ?? scope.querySelector("[data-cipher-origin]");
    const clear = clearEl ? rel(clearEl.getBoundingClientRect()) : null;
    const o = originEl ? rel(originEl.getBoundingClientRect()) : clear;
    const origin = o ? { x: o.left + o.width / 2, y: o.top + o.height / 2 } : { x: c.width / 2, y: c.height / 2 };
    return { clear, origin };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const field = new CipherField(canvas, reducedMotion());
    fieldRef.current = field;
    let live = true;
    let laidOut = false;
    const layout = (intro: boolean) => {
      const m = measure();
      if (m) field.layout(m.clear, m.origin, intro);
      laidOut = true;
    };
    // The glyphs are JetBrains Mono: wait for it, or the intro starts in the fallback face.
    const fonts = document.fonts?.load(field.fontSpec).catch(() => undefined) ?? Promise.resolve();
    void fonts.then(() => live && layout(true));
    const ro = new ResizeObserver(() => laidOut && layout(false));
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    const onVis = () => field.setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      field.destroy();
      fieldRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      pulse: (kind) => {
        const m = measure();
        if (m) fieldRef.current?.setOrigin(m.origin);
        fieldRef.current?.pulse(kind);
      },
      sweep: () => {
        const m = measure();
        if (m) fieldRef.current?.setOrigin(m.origin);
        return fieldRef.current?.sweep() ?? Promise.resolve();
      },
    }),
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cx("pointer-events-none absolute inset-0 size-full", front && "z-10")}
    />
  );
}
