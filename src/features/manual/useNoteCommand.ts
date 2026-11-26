import { useMemo } from "react";
import type { LibraryCommand } from "../../engines/library/types";
import { examReading } from "../../engines/exam";
import { shortHostName } from "../../lib/hostName";
import { reportError } from "../../lib/lockSignal";
import type { FillBase } from "../commands/fillData";
import { commandText, fillLibraryCommand, type FilledCommand } from "../commands/filledCommand";
import { copyTo, useCommandCopy } from "../commands/useCommandCopy";
import { useManualStatus } from "./useManualStatus";

export type { FillBase };

const note = (text: string, tone: "ok" | "warn") => useManualStatus.getState().set(text, tone);

/**
 * A Manual command, copied through the command-copying module. With `fill`, its `{PLACEHOLDERS}` fill for the host in
 * view exactly as an Arsenal card's do; without, the text copies as written. What stays here is the Manual's own: every
 * outcome is written to its one status line, and nothing takes focus.
 *
 * The exam rules read it as a reading surface (`examReading`): the text is never hidden, `examLine` is its exam
 * verdict's line, and a banned command, a Metasploit command locked to another host, or one whose verdict waits on the
 * engagement's kind is held back on its first copy with the verdict's warning.
 */
export function useNoteCommand(command: LibraryCommand, { fill, output, base }: { fill: boolean; output: boolean; base: FillBase }): {
  cmd: FilledCommand;
  copy(): Promise<"copied" | "guarded">;
  copyAndLog(): Promise<void>;
  examLine: { text: string; breach: boolean } | null;
} {
  const { d, host, makeInput, exam } = base;
  const copier = useCommandCopy({ to: copyTo({ d, host }), onNote: note });
  const input = useMemo(() => makeInput({}), [makeInput]);

  const cmd = useMemo(
    () => (fill ? fillLibraryCommand(command, input) : commandText({ id: command.id, title: command.title, text: command.template, runFrom: command.runFrom })),
    [fill, command, input],
  );

  const reading = examReading(command, exam, (id) => shortHostName(d.hosts.find((h) => h.id === id)?.name ?? id));
  const warning = reading.holdBack;

  const copy = () => copier.copy(cmd, { warning });

  const copyAndLog = async () => {
    try {
      // Output to read is copied, never logged.
      const log = !output && copier.canLog;
      if ((await copier.copy(cmd, { warning, log })) !== "copied" || !log || !host) return;
      note(`Copied and logged to ${shortHostName(host.name)}`, cmd.unresolved.length > 0 ? "warn" : "ok");
    } catch (e) {
      reportError(e);
    }
  };

  return { cmd, copy, copyAndLog, examLine: reading.line };
}
