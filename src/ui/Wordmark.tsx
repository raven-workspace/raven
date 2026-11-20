import wordmarkUrl from "../assets/raven-wordmark.svg";
import { cx } from "../lib/cx";
import "./media.scss";

/** The Raven wordmark, wherever the name "Raven" is shown. Height comes from `className`; width follows the art. */
export function Wordmark({ className }: { className?: string }) {
  return <img src={wordmarkUrl} alt="Raven" draggable={false} className={cx("wordmark", className)} />;
}
