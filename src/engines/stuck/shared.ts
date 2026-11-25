import type { ChecklistState } from "../../types/checklist";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import { examList, examScope } from "../exam";
import { getLibrary } from "../library/store";
import type { LibraryCommand } from "../library/types";

const FOOTHOLD_GOALS = ["h-foot-shell", "h-foot-creds", "h-foot-arrived"];

/** One foothold rule for both stuck views: the host's access is set, or a foothold goal is done (spec 5.3). */
export function hasFoothold(host: Pick<Host, "access">, state: ChecklistState | undefined): boolean {
  return host.access !== "none" || FOOTHOLD_GOALS.some((id) => state?.[id]?.status === "done");
}

/** In exam sim a goal whose library commands are all banned has nothing legal to run, so it is not "to do". */
export function hasLegalCommand(
  goalId: string,
  engagement: Pick<Engagement, "kind"> & { msfHostId?: string | null },
  hostId: string,
  library: LibraryCommand[] = getLibrary(),
): boolean {
  const cmds = library.filter((c) => c.goals.includes(goalId));
  if (cmds.length === 0) return true;
  return examList(cmds, examScope({ kind: engagement.kind, msfHostId: engagement.msfHostId ?? null }, hostId)).shown.length > 0;
}
