import {
  commandContext,
  fillCommand,
  filterForKind,
  portChoices,
  HOST_GOALS,
  ENGAGEMENT_SETUP,
  AD_PLAYBOOKS,
  LATERAL_MOVEMENT_GOALS,
  nextFreePort,
  type ChecklistGoal,
  type FillInput,
} from "../../engines/checklist";
import { canonicalToken, findPlaceholders, resolveTemplate } from "../../engines/checklist/template";
import { getLibrary } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import type { Engagement } from "../../types/engagement";
import { MASK } from "../credentials/MaskedSecret/MaskedSecret";
import type { FilledCommand } from "./CommandList/CommandList";
import { filePickFor, pickOverrides } from "./filePick";
import { portPickKey, usePortPickStore } from "./portPick";

const GOAL_BY_ID = new Map<string, ChecklistGoal>(
  [...HOST_GOALS, ...ENGAGEMENT_SETUP, ...LATERAL_MOVEMENT_GOALS, ...AD_PLAYBOOKS.flatMap((p) => p.goals)].map((g) => [g.id, g]),
);

/** One library command filled for this host: masked for display, real values (shell-escaped for Kali) for copy. */
export function fillLibraryCommand(c: LibraryCommand, input: FillInput, msfMarker: boolean): FilledCommand {
  const commandOs = c.os;
  const ctx = commandContext(input, { commandOs });
  const filled = fillCommand(c.template, input, { secretMask: MASK, commandOs });
  // Copy: real values, shell-escaped when the command runs in the Kali shell (see FillOptions.shellSafe).
  const real = fillCommand(c.template, input, { shellSafe: c.runFrom === "attacker", commandOs });
  const tokens = resolveTemplate(c.template, ctx)
    .ranges.filter((r) => !r.resolved && r.canonical !== "interface")
    .map((r) => c.template.slice(r.start, r.end))
    .filter((t) => filled.text.includes(t));
  const out: FilledCommand = {
    id: c.id, title: c.title, text: filled.text, copyText: real.text, unresolved: filled.unresolved,
    msfMarker, tokens: [...new Set(tokens)],
  };
  if (c.cardId) out.cardId = c.cardId;
  const names = findPlaceholders(c.template).map((p) => canonicalToken(p.raw));
  const fileTok = names.find((n): n is "FILE" | "SCRIPT" => n === "FILE" || n === "SCRIPT");
  if (fileTok) out.fileToken = { hostId: input.host.id, os: input.host.os === "windows" || input.host.os === "linux" ? input.host.os : null, token: fileTok };
  if (filled.dcByName) out.dcByName = true;
  if (filled.viaTunnel) out.viaTunnel = { viaHostId: filled.viaTunnel.tunnel.viaHostId, viaHostName: filled.viaTunnel.viaHostName, down: filled.viaTunnel.down };
  // A reverse shell back to {LPORT} clashes with a listener already in the log: name the next free port.
  if (input.listenerPorts?.size && names.includes("LPORT")) {
    const port = Number(input.listenerPort.trim());
    if (Number.isInteger(port) && input.listenerPorts.has(port)) {
      out.portClash = { port, suggested: nextFreePort(port, input.listenerPorts) };
    }
  }
  return out;
}

/** The library commands for a goal, filled for this host and filtered by the engagement's exam rules. */
export function goalCommands(goalId: string, input: FillInput, eng: Engagement): { commands: FilledCommand[]; hadAny: boolean } {
  const all = getLibrary().filter((c) => c.goals.includes(goalId));
  // The step's {FILE} chip (per host) fills FILE and SCRIPT; without a pick the input is untouched.
  const pick = pickOverrides(filePickFor(input.host.id));
  if (Object.keys(pick).length > 0) input = { ...input, overrides: { ...pick, ...input.overrides } };
  // {PORT}: the host's open ports matching the step's `applies`, the picked one (default the lowest) first.
  const choices = portChoices(input, GOAL_BY_ID.get(goalId));
  const key = portPickKey(input.host.id, goalId);
  const pickedPort = usePortPickStore.getState().picks[key];
  const picked = pickedPort !== undefined && choices.includes(pickedPort) ? pickedPort : choices[0];
  if (choices.length > 0) input = { ...input, portHint: [picked, ...choices.filter((p) => p !== picked)] };
  const { shown, msfMarker } = filterForKind(all, eng.kind, { hostId: input.host.id, msfHostId: eng.msfHostId });
  const commands = shown.map((c) => {
    const f = fillLibraryCommand(c, input, msfMarker.has(c.id));
    if (choices.length > 1 && findPlaceholders(c.template).some((p) => canonicalToken(p.raw) === "PORT")) f.portToken = { key, choices, picked };
    return f;
  });
  return { commands, hadAny: all.length > 0 };
}
