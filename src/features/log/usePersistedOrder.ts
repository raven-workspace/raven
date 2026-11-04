import { useState } from "react";
import type { LogEntry } from "../../types/log";

export type LogOrder = "newest" | "oldest";

/** A list's sort order, remembered across launches (a view preference, not engagement data). */
export function usePersistedOrder(key: string, fallback: LogOrder): [LogOrder, (o: LogOrder) => void] {
  const [order, setOrder] = useState<LogOrder>(() => {
    const v = localStorage.getItem(key);
    return v === "newest" || v === "oldest" ? v : fallback;
  });
  return [
    order,
    (o) => {
      localStorage.setItem(key, o);
      setOrder(o);
    },
  ];
}

export const byOrder = (order: LogOrder) => (a: LogEntry, b: LogEntry) => (order === "newest" ? b.at - a.at : a.at - b.at);
