import {
  portChoices,
  HOST_GOALS,
  ENGAGEMENT_SETUP,
  AD_PLAYBOOKS,
  LATERAL_MOVEMENT_GOALS,
  type ChecklistGoal,
  type FillInput,
} from "../../engines/checklist";
import { canonicalToken, findPlaceholders } from "../../engines/checklist/template";
import { examList, examScope } from "../../engines/exam";
import type { LibraryCommand } from "../../engines/library/types";
import type { Engagement } from "../../types/engagement";
import { fillLibraryCommand, type FilledCommand } from "../commands/filledCommand";
import { filePickFor, pickOverrides } from "./filePick";
import { portPickKey, usePortPickStore } from "./portPick";

const GOAL_BY_ID = new Map<string, ChecklistGoal>(
  [...HOST_GOALS, ...ENGAGEMENT_SETUP, ...LATERAL_MOVEMENT_GOALS, ...AD_PLAYBOOKS.flatMap((p) => p.goals)].map((g) => [g.id, g]),
);

/** The `library` commands for a goal, filled for this host and filtered by the engagement's exam rules. */
export function goalCommands(goalId: string, input: FillInput, eng: Engagement, library: LibraryCommand[]): { commands: FilledCommand[]; hadAny: boolean } {
  const all = library.filter((c) => c.goals.includes(goalId));
  // The step's {FILE} chip (per host) fills FILE and SCRIPT; without a pick the input is untouched.
  const pick = pickOverrides(filePickFor(input.host.id));
  if (Object.keys(pick).length > 0) input = { ...input, overrides: { ...pick, ...input.overrides } };
  // {PORT}: the host's open ports matching the step's `applies`, the picked one (default the lowest) first.
  const choices = portChoices(input, GOAL_BY_ID.get(goalId));
  const key = portPickKey(input.host.id, goalId);
  const pickedPort = usePortPickStore.getState().picks[key];
  const picked = pickedPort !== undefined && choices.includes(pickedPort) ? pickedPort : choices[0];
  if (choices.length > 0) input = { ...input, portHint: [picked, ...choices.filter((p) => p !== picked)] };
  const { shown, msfMarker } = examList(all, examScope(eng, input.host.id));
  const commands = shown.map((c) => {
    const f = fillLibraryCommand(c, input, msfMarker.has(c.id));
    if (choices.length > 1 && findPlaceholders(c.template).some((p) => canonicalToken(p.raw) === "PORT")) f.portToken = { key, choices, picked };
    return f;
  });
  return { commands, hadAny: all.length > 0 };
}
