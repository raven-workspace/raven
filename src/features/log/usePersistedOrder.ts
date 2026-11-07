import { useState } from "react";
import type { LogEntry } from "../../types/log";

export type LogOrder = "newest" | "oldest";

/** A list's sort order, remembered across launches (a view preference, not engagement data). */
export function usePersistedOrder(key: string, fallback: LogOrder, legacyKey?: string): [LogOrder, (o: LogOrder) => void] {
  const [order, setOrder] = useState<LogOrder>(() => {
    // `legacyKey` is read once, when nothing is stored under `key` yet (a renamed preference).
    const v = localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
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
