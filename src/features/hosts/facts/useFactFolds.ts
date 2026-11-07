import { useState } from "react";

export type FactGroupId = "coverage" | "services" | "credentials" | "identity" | "vectors" | "accounts";

type Folds = Partial<Record<FactGroupId, boolean>>;

const storageKey = (hostId: string) => `raven.facts.${hostId}`;

/** Only the groups the user opened or folded by hand; no host data. */
function read(hostId: string): Folds {
  try {
    const raw = localStorage.getItem(storageKey(hostId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Folds) : {};
  } catch {
    return {};
  }
}

/**
 * Which fact groups are open on one host. A group the user never toggled follows `defaultOpen` (the current
 * phase's groups); one they opened or folded stays that way for this host, across visits.
 */
export function useFactFolds(
  hostId: string,
  defaultOpen: (group: FactGroupId) => boolean = () => false,
): { isOpen(group: FactGroupId): boolean; toggle(group: FactGroupId): void } {
  const [state, setState] = useState(() => ({ hostId, folds: read(hostId) }));
  // Another host: its own stored folds.
  const folds = state.hostId === hostId ? state.folds : read(hostId);
  if (state.hostId !== hostId) setState({ hostId, folds });

  const isOpen = (group: FactGroupId) => folds[group] ?? defaultOpen(group);
  const toggle = (group: FactGroupId) => {
    const next = { ...folds, [group]: !isOpen(group) };
    try {
      localStorage.setItem(storageKey(hostId), JSON.stringify(next));
    } catch {
      // Storage full or blocked: the fold still applies for this visit.
    }
    setState({ hostId, folds: next });
  };
  return { isOpen, toggle };
}
