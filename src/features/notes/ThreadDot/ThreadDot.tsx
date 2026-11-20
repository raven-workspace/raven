import { openThreadsLabel } from "../useThreadCounts";
import "./ThreadDot.scss";

/** Small neutral dot: this host has open threads. Not the accent (a thread is a question, not a held fact). */
export function ThreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span role="img" aria-label={openThreadsLabel(count)} className="thread-dot" />;
}
