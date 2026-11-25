import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { fillCommand } from "../../engines/checklist";
import type { LibraryCommand } from "../../engines/library/types";
import { msfLockLine } from "../../engines/payloads/msfLock";
import { copyPlain, copySecret } from "../../lib/clipboard";
import { shortHostName } from "../../lib/hostName";
import { reportError } from "../../lib/lockSignal";
import { useCopyGuard } from "../arsenal/copyGuard";
import { logCommand } from "../capture/logCommand";
import type { FilledCommand } from "../checklist/CommandList/CommandList";
import { fillLibraryCommand } from "../checklist/goalCommands";
import type { useFillBase } from "../palette/fillData";
import { useManualStatus } from "./useManualStatus";

export type FillBase = ReturnType<typeof useFillBase>;

export const BANNED = "Not allowed in the exam";
const noop = () => {};
const note = (text: string, tone: "ok" | "warn") => useManualStatus.getState().set(text, tone);

/**
 * A Manual command's fill, exam rules, copy guard and log, shared by a code block and an inline command. With `fill`,
 * its `{PLACEHOLDERS}` fill for the host in view exactly as an Arsenal card's do (`fillLibraryCommand`); without, the
 * text copies as written. Copy goes through the copy guard (an unfilled token holds the first copy back). Every
 * outcome is written to the Manual's one status line.
 *
 * In an exam sim (or until the engagement's rules are known) the text is never hidden: a banned command is held back
 * on its first copy, and a Metasploit command (by its exam rule, as in the Arsenal: a module other than multi/handler,
 * or a Meterpreter payload) carries the Metasploit lock line.
 */
export function useNoteCommand(command: LibraryCommand, { fill, output, base }: { fill: boolean; output: boolean; base: FillBase }): {
  cmd: FilledCommand;
  copy(): Promise<"copied" | "guarded">;
  copyAndLog(): Promise<void>;
  banned: boolean;
  msf: { text: string; breach: boolean } | null;
  known: boolean;
} {
  const { d, host, makeInput, examReady } = base;
  const qc = useQueryClient();
  const hostName = host ? shortHostName(host.name) : null;
  const guard = useCopyGuard({ focusToken: noop, focusCred: noop, hostName, onNote: note });
  const input = useMemo(() => makeInput({}), [makeInput]);

  const cmd: FilledCommand = useMemo(
    () => (fill ? fillLibraryCommand(command, input, false) : { id: command.id, title: command.title, text: command.template, unresolved: [], msfMarker: false }),
    [fill, command, input],
  );

  // Fail closed: until the engagement's kind is known, a copy is held back as in an exam (the lines show once it is known).
  const exam = !output && (!examReady || d.engagement?.kind === "exam-sim");
  const known = examReady && d.engagement?.kind === "exam-sim";
  const banned = exam && command.exam === "banned";
  const msf = exam && command.exam === "metasploit"
    ? msfLockLine({
      exam, def: { meterpreter: true }, hostId: host?.id ?? null, msfHostId: d.engagement?.msfHostId ?? null,
      hostName: (id) => shortHostName(d.hosts.find((h) => h.id === id)?.name ?? id),
    })
    : null;
  const warn = banned ? { warn: BANNED, warnKey: "exam" } : msf?.breach ? { warn: msf.text, warnKey: "msf" } : undefined;

  const copy = (): Promise<"copied" | "guarded"> => {
    const text = cmd.copyText ?? cmd.text;
    return guard.attempt(cmd, () => (text !== cmd.text ? copySecret : copyPlain)(text), warn);
  };

  const copyAndLog = async () => {
    try {
      if ((await copy()) !== "copied" || output || !host || !d.engagement) return;
      // The real values, as typed at the shell (not shell-escaped, not masked).
      const typed = fill ? fillCommand(command.template, input, { commandOs: command.os }).text : command.template;
      await logCommand(qc, {
        engagementId: d.engagement.id, host, hosts: d.hosts, command: typed, title: command.title,
        ranOn: command.runFrom === "attacker" ? (d.settings?.machines[0] ?? "") : host.name,
      });
      note(`Copied and logged to ${hostName ?? host.name}`, cmd.unresolved.length > 0 ? "warn" : "ok");
    } catch (e) {
      reportError(e);
    }
  };

  return { cmd, copy, copyAndLog, banned, msf, known };
}
