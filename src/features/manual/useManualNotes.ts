import { useMemo } from "react";
import type { ManualFolder, ManualNote } from "../../engines/manual";
import { useFieldManual } from "../fieldManual/queries";

/**
 * - `loading`: the snapshot is still being read.
 * - `never-imported`: no Field Manual import yet.
 * - `old-import`: the last import predates the Manual (its snapshot has no notes): import again.
 * - `empty`: imported with the Manual, but the vault has no Tools, Foundations or Reporting notes.
 */
export type ManualStatus = "loading" | "ready" | "empty" | "never-imported" | "old-import";

/** The rail's group order. */
export const MANUAL_GROUPS: { folder: ManualFolder; label: string }[] = [
  { folder: "foundations", label: "Foundations" },
  { folder: "tools", label: "Tools" },
  { folder: "reporting", label: "Reporting" },
];

const ORDER: Record<ManualFolder, number> = { foundations: 0, tools: 1, reporting: 2 };

/** The Manual's notes from the last import, grouped Foundations, Tools, Reporting and alphabetical within each group. */
export function useManualNotes(): { notes: ManualNote[]; status: ManualStatus } {
  const q = useFieldManual();
  const raw = q.data?.notes;
  const notes = useMemo(
    () => [...(raw ?? [])].sort((a, b) => ORDER[a.folder] - ORDER[b.folder] || a.title.localeCompare(b.title, undefined, { sensitivity: "base" })),
    [raw],
  );
  let status: ManualStatus;
  if (q.isPending) status = "loading";
  else if (!q.data) status = "never-imported";
  else if (!raw) status = "old-import";
  else status = notes.length ? "ready" : "empty";
  return { notes, status };
}

/** Where the Manual opens when nothing better is known: the first Foundations note (else the first note). */
export const firstNote = (notes: ManualNote[]): ManualNote | undefined => notes.find((n) => n.folder === "foundations") ?? notes[0];
