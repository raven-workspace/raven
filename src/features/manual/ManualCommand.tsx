import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, type KeyboardEvent } from "react";
import { fillCommand } from "../../engines/checklist";
import { METERPRETER } from "../../engines/fieldManual/classifyExam";
import type { LibraryCommand } from "../../engines/library/types";
import { msfLockLine } from "../../engines/payloads/msfLock";
import { copyPlain, copySecret } from "../../lib/clipboard";
import { shortHostName } from "../../lib/hostName";
import { reportError } from "../../lib/lockSignal";
import { CommandBlock } from "../../ui";
import { copyKey, useCopyGuard } from "../arsenal/copyGuard";
import { logCommand } from "../capture/logCommand";
import type { FilledCommand } from "../checklist/CommandList";
import { fillLibraryCommand } from "../checklist/goalCommands";
import type { useFillBase } from "../palette/fillData";

export type FillBase = ReturnType<typeof useFillBase>;

const BANNED = "Not allowed in the exam";
const noop = () => {};

/**
 * One code block of a Manual note as a command. With `fill`, its `{PLACEHOLDERS}` fill for the host in view exactly as
 * an Arsenal card's do (`fillLibraryCommand`); without, the text copies as written. Copy goes through the copy guard
 * (an unfilled token holds the first copy back). With focus on the block, ↵ copies and ⌘↵ copies and logs it.
 *
 * In an exam sim (or until the engagement's rules are known) the text is never hidden: a banned command says so in
 * amber and its first copy is held back, and a Meterpreter command shows the Metasploit lock line.
 */
export function ManualCommand({ command, label, caption, fill, base }: {
  command: LibraryCommand;
  /** Names the block and its Copy button for screen readers. */
  label: string;
  /** The fence's `title:"…"`, shown over the block. */
  caption?: string;
  fill: boolean;
  base: FillBase;
}) {
  const { d, host, makeInput, examReady } = base;
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const hostName = host ? shortHostName(host.name) : null;
  const guard = useCopyGuard({ focusToken: noop, focusCred: noop, hostName });
  const input = useMemo(() => makeInput({}), [makeInput]);

  const cmd: FilledCommand = useMemo(
    () => (fill ? fillLibraryCommand(command, input, false) : { id: command.id, title: command.title, text: command.template, unresolved: [], msfMarker: false }),
    [fill, command, input],
  );

  // Fail closed: until the engagement's kind is known, a copy is held back as in an exam (the lines show once it is known).
  const exam = !examReady || d.engagement?.kind === "exam-sim";
  const known = examReady && d.engagement?.kind === "exam-sim";
  const banned = exam && command.exam === "banned";
  const msf = exam && !banned && command.template.split("\n").some((l) => METERPRETER.test(l))
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
      if ((await copy()) !== "copied" || !host || !d.engagement) return;
      // The real values, as typed at the shell (not shell-escaped, not masked).
      const typed = fill ? fillCommand(command.template, input, { commandOs: command.os }).text : command.template;
      await logCommand(qc, {
        engagementId: d.engagement.id, host, hosts: d.hosts, command: typed, title: command.title,
        ranOn: command.runFrom === "attacker" ? (d.settings?.machines[0] ?? "") : host.name,
      });
    } catch (e) {
      reportError(e);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.altKey || e.shiftKey || e.nativeEvent.isComposing || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      void copyAndLog();
    } else if (e.target === root.current) {
      e.preventDefault();
      // The Copy button's own path, so its done check shows.
      root.current?.querySelector<HTMLElement>('button[aria-label^="Copy command"]')?.click();
    }
  };

  const status = guard.forKey === copyKey(cmd) ? (guard.hint ?? guard.confirm) : null;
  return (
    <div
      ref={root} role="group" aria-label={`Note command: ${label}`} tabIndex={0} onKeyDown={onKeyDown}
      className="grid gap-1 rounded-sm outline-accent outline-offset-4 outline-none focus:outline-1 focus:outline-solid"
    >
      <div className="grid min-h-[18px] grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
        <span className="truncate text-meta text-muted-2">{caption}</span>
        {status && (
          <span role="status" className={`text-meta ${guard.hint || cmd.unresolved.length > 0 ? "text-warn" : "text-accent"}`}>{status}</span>
        )}
      </div>
      <CommandBlock
        text={cmd.text}
        {...(cmd.copyText !== undefined ? { copyText: cmd.copyText } : {})}
        tokens={cmd.tokens ?? []}
        name={label}
        copyLabel={`Copy command: ${label}`}
        onCopyAction={(button) =>
          copy().then((r) => {
            // Held back with nothing else to take focus: the Copy button keeps it, so ↵ is the second press.
            if (r === "guarded" && (document.activeElement === document.body || document.activeElement === button)) button.focus();
            return r;
          })}
      />
      {known && banned && <p className="m-0 text-meta text-warn">{BANNED}</p>}
      {known && msf && <p className={`m-0 text-meta ${msf.breach ? "text-warn" : "text-muted"}`}>{msf.text}</p>}
    </div>
  );
}
