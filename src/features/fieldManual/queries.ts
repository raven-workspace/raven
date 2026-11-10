import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AD_PLAYBOOKS, ENGAGEMENT_SETUP, HOST_GOALS, LATERAL_MOVEMENT_GOALS } from "../../engines/checklist";
import { computeDrift } from "../../engines/fieldManual/drift";
import { applyOverlay, mergeImport, normalizeSnapshot, type FieldManualSnapshot } from "../../engines/fieldManual/merge";
import { parseCard, type ParsedCard } from "../../engines/fieldManual/parseCard";
import { parsePlaybook, type PlaybookItem } from "../../engines/fieldManual/parsePlaybook";
import { parseToolkit, type ToolkitEntry } from "../../engines/fieldManual/parseToolkit";
import { parseNote } from "../../engines/manual";
import type { ManualNote } from "../../engines/manual";
import { BUILTIN_LIBRARY } from "../../engines/library/data";
import { setImported } from "../../engines/library/store";
import { api } from "../../lib/api";

export const FIELD_MANUAL_KEY = ["fieldManual"] as const;

/** The stored snapshot of the last import, or null. */
export function useFieldManual(enabled = true) {
  return useQuery({
    enabled,
    queryKey: FIELD_MANUAL_KEY,
    queryFn: async () => (await api.fieldManualLoad()) ?? null,
  });
}

/** Applies a stored snapshot to the runtime library. */
export function applySnapshot(s: FieldManualSnapshot): void {
  setImported({
    commands: applyOverlay(BUILTIN_LIBRARY, normalizeSnapshot(s, BUILTIN_LIBRARY)),
    cards: s.cards,
    toolkit: s.toolkit,
  });
}

/**
 * Scan, parse, merge, save, then (only once everything succeeded) update the library. A failure at any step
 * leaves the library and the stored snapshot as they were. A scan that yields no cards is a failure.
 */
export async function runImport(path: string, previous: FieldManualSnapshot | null): Promise<FieldManualSnapshot> {
  const files = await api.fieldManualScan(path);
  const cards: ParsedCard[] = [];
  const playbook: PlaybookItem[] = [];
  const notes: ManualNote[] = [];
  let toolkit: ToolkitEntry[] = [];
  for (const f of files) {
    if (f.relPath === "00-Home/Toolkit.md") toolkit = parseToolkit(f.text);
    else if (f.relPath.startsWith("01-Playbook/")) playbook.push(...parsePlaybook(f.relPath, f.text));
    else if (f.relPath.startsWith("02-Cards/")) {
      const c = parseCard(f.relPath, f.text);
      if (c && c.meta.id) cards.push(c);
    } else {
      const n = parseNote(f.relPath, f.text);
      if (n) notes.push(n);
    }
  }
  // A wrong folder or an iCloud-evicted vault parses to nothing: never save that over a good import.
  if (cards.length === 0) {
    throw new Error(`No cards found in ${path}. Check the folder, and that iCloud has downloaded the vault.`);
  }
  const { commands, overlay, added, report } = mergeImport(BUILTIN_LIBRARY, cards, previous ?? undefined);
  const goals = [...HOST_GOALS, ...ENGAGEMENT_SETUP, ...LATERAL_MOVEMENT_GOALS, ...AD_PLAYBOOKS.flatMap((p) => p.goals)];
  report.drift = computeDrift(goals, playbook, commands, cards, toolkit);
  const snapshot: FieldManualSnapshot = {
    importedAt: Date.now(),
    cards: cards.map((c) => c.meta),
    overlay,
    added,
    playbook,
    toolkit,
    notes,
    report,
  };
  await api.fieldManualSave(snapshot);
  applySnapshot(snapshot);
  return snapshot;
}

export function useImportFieldManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => runImport(path, qc.getQueryData<FieldManualSnapshot | null>(FIELD_MANUAL_KEY) ?? null),
    onSuccess: (s) => qc.setQueryData(FIELD_MANUAL_KEY, s),
  });
}

/** True when a vault file changed after the last import. Re-checked on window focus. */
export function useVaultNewer(enabled: boolean): boolean {
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet, enabled });
  const snap = useFieldManual(enabled);
  const path = settings.data?.fieldManualPath;
  const mtime = useQuery({
    queryKey: ["fieldManualMtime", path],
    queryFn: async () => {
      try {
        return (await api.fieldManualLatestMtime(path as string)) ?? null;
      } catch {
        return null; // a missing folder is not "newer"; the Import button reports it
      }
    },
    enabled: enabled && !!path,
    refetchOnWindowFocus: true,
  });
  if (!enabled || mtime.data == null || snap.isPending) return false;
  return mtime.data > (snap.data?.importedAt ?? 0);
}
