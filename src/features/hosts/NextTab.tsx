import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { Host } from "../../types/host";
import { HostChecklist } from "../checklist/HostChecklist";

/** "Full checklist ▸": swaps the Next tab between the current stage's open steps and every stage. Sits in the tab row. */
export function FullChecklistToggle({ full, onChange }: { full: boolean; onChange: (full: boolean) => void }) {
  const Caret = full ? CaretDown : CaretRight;
  return (
    <button
      type="button"
      aria-expanded={full}
      onClick={() => onChange(!full)}
      className="inline-flex cursor-default items-center gap-1 text-xs text-fg-2 hover:text-fg"
    >
      Full checklist <Caret size={12} weight="light" aria-hidden />
    </button>
  );
}

/**
 * The host's next steps: the current stage's open steps with their filled, ready-to-copy commands. With `full`,
 * every stage (today's checklist) in place, done steps included.
 */
export function NextTab({ engagementId, host, full, onShowFull, onOpenEntry, focusGoal }: {
  engagementId: string;
  host: Host;
  full: boolean;
  /** Opens the full checklist (from the "done steps have new creds" line). */
  onShowFull: () => void;
  onOpenEntry: (entryId: string) => void;
  focusGoal?: { id: string; n: number };
}) {
  return (
    <HostChecklist
      engagementId={engagementId}
      host={host}
      scope={full ? "all" : "next"}
      onShowFull={onShowFull}
      focusGoal={focusGoal}
      onOpenEntry={onOpenEntry}
    />
  );
}
