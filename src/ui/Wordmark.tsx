import wordmarkUrl from "../assets/raven-wordmark.svg";

/** The Raven wordmark, wherever the name "Raven" is shown. Height comes from `className`; width follows the art. */
export function Wordmark({ className }: { className?: string }) {
  return <img src={wordmarkUrl} alt="Raven" draggable={false} className={`block w-auto select-none ${className ?? ""}`} />;
}
