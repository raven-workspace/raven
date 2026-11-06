import {
  commandContext,
  fillCommand,
  filterForKind,
  type FillInput,
} from "../../engines/checklist";
import { resolveTemplate } from "../../engines/checklist/template";
import { getLibrary } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import type { Engagement } from "../../types/engagement";
import { MASK } from "../credentials/MaskedSecret";
import type { FilledCommand } from "./CommandList";

/** One library command filled for this host: masked for display, real values (shell-escaped for Kali) for copy. */
export function fillLibraryCommand(c: LibraryCommand, input: FillInput, msfMarker: boolean): FilledCommand {
  const ctx = commandContext(input);
  const filled = fillCommand(c.template, input, { secretMask: MASK });
  // Copy: real values, shell-escaped when the command runs in the Kali shell (see FillOptions.shellSafe).
  const real = fillCommand(c.template, input, { shellSafe: c.runFrom === "attacker" });
  const tokens = resolveTemplate(c.template, ctx)
    .ranges.filter((r) => !r.resolved && r.canonical !== "interface")
    .map((r) => c.template.slice(r.start, r.end))
    .filter((t) => filled.text.includes(t));
  const out: FilledCommand = {
    id: c.id, title: c.title, text: filled.text, copyText: real.text, unresolved: filled.unresolved,
    msfMarker, tokens: [...new Set(tokens)],
  };
  if (c.cardId) out.cardId = c.cardId;
  if (filled.viaTunnel) out.viaTunnel = { viaHostName: filled.viaTunnel.viaHostName, down: filled.viaTunnel.down };
  return out;
}

/** The library commands for a goal, filled for this host and filtered by the engagement's exam rules. */
export function goalCommands(goalId: string, input: FillInput, eng: Engagement): { commands: FilledCommand[]; hadAny: boolean } {
  const all = getLibrary().filter((c) => c.goals.includes(goalId));
  const { shown, msfMarker } = filterForKind(all, eng.kind, { hostId: input.host.id, msfHostId: eng.msfHostId });
  const commands = shown.map((c) => fillLibraryCommand(c, input, msfMarker.has(c.id)));
  return { commands, hadAny: all.length > 0 };
}
