import { useState } from "react";
import type { LogEntry } from "../../types/log";

export type LogOrder = "newest" | "oldest";

const KEY = "raven.log.order";
/** Where the order was stored before the Story view became the log. */
const LEGACY_KEY = "raven.story.order";

/**
 * The log's sort order, remembered across launches (a view preference, not engagement data). `readLegacy` also reads
 * the pre-rename key while nothing is stored under the current one.
 */
export function useLogOrder(fallback: LogOrder, readLegacy = false): [LogOrder, (o: LogOrder) => void] {
  const [order, setOrder] = useState<LogOrder>(() => {
    const v = localStorage.getItem(KEY) ?? (readLegacy ? localStorage.getItem(LEGACY_KEY) : null);
    return v === "newest" || v === "oldest" ? v : fallback;
  });
  return [
    order,
    (o) => {
      localStorage.setItem(KEY, o);
      setOrder(o);
    },
  ];
}

export const byOrder = (order: LogOrder) => (a: LogEntry, b: LogEntry) => (order === "newest" ? b.at - a.at : a.at - b.at);
