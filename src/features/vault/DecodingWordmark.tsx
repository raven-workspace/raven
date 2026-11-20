import { useLayoutEffect, useRef } from "react";
import raw from "../../assets/raven-wordmark.svg?raw";
import { prefersReducedMotion } from "../../ui/motion";

/** The wordmark's own art: one source of truth for the letter shapes. */
const VIEWBOX = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? "0 0 1 1";
const LETTERS = [...raw.matchAll(/<path id="(\w+)" fill="([^"]+)" d="([^"]+)"/g)].map((m) => ({
  id: m[1]!,
  accent: m[2]!.toLowerCase() !== "#ffffff",
  d: m[3]!,
}));
/** Each letter's centre in the art's coordinates (from the path bounds), R A V E N. */
const CENTRES_X = [433.9, 880.8, 1278.7, 1709.7, 2113.3];
const CENTRE_Y = 142.65;
const SCRAMBLE = "0123456789abcdef#%&<>/";
const TICK_MS = 45;

const pick = () => SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]!;

/**
 * The Raven wordmark, decoding: each letter cycles through cipher glyphs, then snaps to its shape, left to right,
 * in under a second. Shown settled under reduced motion; the letters are visible by default, so nothing depends on
 * the script running.
 */
export function DecodingWordmark({ className }: { className?: string }) {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const glyphs = useRef<(SVGTextElement | null)[]>([]);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    const show = (i: number, letter: boolean) => {
      const p = paths.current[i];
      const g = glyphs.current[i];
      if (p) p.style.opacity = letter ? "" : "0";
      if (g) g.style.display = letter ? "none" : "";
    };
    LETTERS.forEach((_, i) => {
      show(i, false);
      const g = glyphs.current[i];
      if (g) g.style.opacity = "0";
    });
    const t0 = performance.now();
    const timer = setInterval(() => {
      const t = performance.now() - t0;
      let pending = 0;
      LETTERS.forEach((_, i) => {
        const g = glyphs.current[i];
        if (t > 420 + i * 110) return show(i, true);
        pending++;
        if (!g) return;
        g.style.opacity = t < 120 + i * 30 ? "0" : "";
        g.textContent = pick();
      });
      if (!pending) clearInterval(timer);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      LETTERS.forEach((_, i) => show(i, true));
    };
  }, []);

  return (
    <svg viewBox={VIEWBOX} role="img" aria-label="Raven" className={className}>
      {LETTERS.map((l, i) => (
        <path
          key={l.id}
          ref={(el) => {
            paths.current[i] = el;
          }}
          d={l.d}
          className={l.accent ? "fill-accent" : "fill-fg"}
        />
      ))}
      {CENTRES_X.map((x, i) => (
        <text
          key={x}
          ref={(el) => {
            glyphs.current[i] = el;
          }}
          x={x}
          y={CENTRE_Y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={190}
          aria-hidden="true"
          className="fill-faint font-mono"
          style={{ display: "none" }}
        />
      ))}
    </svg>
  );
}
