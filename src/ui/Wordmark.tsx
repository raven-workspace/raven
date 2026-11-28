import wordmarkUrl from "../assets/raven-wordmark.svg";
import { cx } from "../lib/cx";
import "./media.scss";

/** The Raven wordmark, wherever the name "Raven" is shown. Height comes from `className`; width follows the art. */
export function Wordmark({ className }: { className?: string }) {
  return <img src={wordmarkUrl} alt="Raven" draggable={false} className={cx("wordmark", className)} />;
}

/** The wordmark's R (`#r` in raven-wordmark.svg, on the art's own viewBox), drawn in the current colour: the rail's mark. */
const R_PATH =
  "M290.03 36 L507.88 36 A61.73 61.73 0 0 1 507.88 159.45 L495.26 159.45 L577.72 249.3 L529.66 249.3 L447.2 159.45 L342.4 159.45 L342.4 249.3 L305.4 249.3 L305.4 125.85 L502.27 125.85 A28.13 28.13 0 0 0 502.27 69.6 L318.24 69.6Z";

/** The R alone, 20 × 15 (design §1.2). Decoration: the link around it carries the name. */
export function RavenMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" width="20" height="15" viewBox="290 36 287.7 213.3" className={className}>
      <path fill="currentColor" d={R_PATH} />
    </svg>
  );
}
