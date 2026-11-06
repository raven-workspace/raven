import {
  commandContext,
  fillCommand,
  filterForKind,
  type FillInput,
} from "../../engines/checklist";
import { resolveTemplate } from "../../engines/checklist/template";
import { getLibrary } from "../../engines/library/store";
import type { Engagement } from "../../types/engagement";
import { MASK } from "../credentials/MaskedSecret";
import type { FilledCommand } from "./CommandList";

/** The library commands for a goal, filled for this host and filtered by the engagement's exam rules. */
export function goalCommands(goalId: string, input: FillInput, eng: Engagement): { commands: FilledCommand[]; hadAny: boolean } {
  const all = getLibrary().filter((c) => c.goals.includes(goalId));
  const { shown, msfMarker } = filterForKind(all, eng.kind, { hostId: input.host.id, msfHostId: eng.msfHostId });
  const ctx = commandContext(input);
  const commands = shown.map((c) => {
    const filled = fillCommand(c.template, input, { secretMask: MASK });
    // Copy: real values, shell-escaped when the command runs in the Kali shell (see FillOptions.shellSafe).
    const real = fillCommand(c.template, input, { shellSafe: c.runFrom === "attacker" });
    const tokens = resolveTemplate(c.template, ctx)
      .ranges.filter((r) => !r.resolved && r.canonical !== "interface")
      .map((r) => c.template.slice(r.start, r.end))
      .filter((t) => filled.text.includes(t));
    const out: FilledCommand = {
      id: c.id, title: c.title, text: filled.text, copyText: real.text, unresolved: filled.unresolved,
      msfMarker: msfMarker.has(c.id), tokens: [...new Set(tokens)],
    };
    if (filled.viaTunnel) out.viaTunnel = { viaHostName: filled.viaTunnel.viaHostName, down: filled.viaTunnel.down };
    return out;
  });
  return { commands, hadAny: all.length > 0 };
}
