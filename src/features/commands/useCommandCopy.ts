import { QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { copyPlain, copySecret } from "../../lib/clipboard";
import { shortHostName } from "../../lib/hostName";
import type { Host } from "../../types/host";
import { logCommand } from "../capture/logCommand";
import { CONFIRM_MS, copyKey, createCommandCopy, type Clipboard, type CopyOptions, type LogTarget } from "./copyCommand";
import type { EngagementFillData } from "./fillData";
import type { FilledCommand } from "./filledCommand";

const CLIPBOARD: Clipboard = { secret: copySecret, plain: copyPlain };
const NOWHERE: CopyTo = { host: null, engagement: null };

/** Where a copy from a surface can be logged: the engagement and its hosts, the host in view, and your machines. */
export interface CopyTo {
  /** The host in view: "Copied for <host>", and the host a logged command is filed against. */
  host: Host | null;
  /** Null while the engagement is unknown or there is none: copies are never logged. */
  engagement: { id: string; hosts: Host[]; machines: string[] } | null;
}

/** The copy target of a surface's fill data: its host, and its engagement once loaded. */
export function copyTo({ d, host }: { d: EngagementFillData; host: Host | null | undefined }): CopyTo {
  return {
    host: host ?? null,
    engagement: d.engagement ? { id: d.engagement.id, hosts: d.hosts, machines: d.settings?.machines ?? [] } : null,
  };
}

/**
 * The React side of command copying: one copier per surface, with its note state. `copy` holds back, copies and logs
 * through `createCommandCopy`; a held-back copy sends focus to `focusToken` (or `focusCred` for a secret token) and
 * shows `hint`; a copy shows `confirm` for `CONFIRM_MS`. `forKey` is the `copyKey` both notes belong to. `onNote` is
 * also told each note (a hold-back "warn", a clean copy "ok") for a surface that shows it elsewhere.
 */
export function useCommandCopy({ to = NOWHERE, hostName: named, focusToken, focusCred, repeatKey = "↵", onNote }: {
  /** Where a copy can be logged; without it, copies are never logged. */
  to?: CopyTo;
  /** The name "Copied for <host>" uses, where it is not `to`'s host (a list given only the name). */
  hostName?: string | null;
  focusToken?: (token: string) => void;
  focusCred?: () => void;
  /** What the hint tells the user to press for the second try ("⌘↵ or Copy" where two controls copy). */
  repeatKey?: string;
  onNote?: (text: string, tone: "ok" | "warn") => void;
}) {
  // Read, not required: a list that never logs (the checklist) renders with no query client.
  const qc = useContext(QueryClientContext);
  const copier = useRef<ReturnType<typeof createCommandCopy>>(null);
  copier.current ??= createCommandCopy(CLIPBOARD);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [state, setState] = useState<{ key: string; hint: string | null; confirm: string | null } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const { host, engagement } = to;
  const hostName = named !== undefined ? named : host ? shortHostName(host.name) : null;

  /** Whether a copy asked to log is logged: only with a host in view and its engagement loaded. */
  const canLog = qc !== undefined && host !== null && engagement !== null;

  const copy = useCallback(
    async (
      cmd: FilledCommand,
      opts: Pick<CopyOptions, "warning" | "logAs" | "afterCopy" | "guardAs"> & { log?: boolean } = {},
    ): Promise<"copied" | "guarded"> => {
      const { log: wantsLog, ...rest } = opts;
      const logTarget: LogTarget | null = wantsLog && qc && host && engagement
        ? {
          hostName: host.name, attacker: engagement.machines[0] ?? "",
          write: async (entry) => {
            await logCommand(qc, { engagementId: engagement.id, host, hosts: engagement.hosts, ...entry });
          },
        }
        : null;
      clearTimeout(timer.current);
      const r = await copier.current!.copy(cmd, {
        ...rest, hostName, repeatKey, log: logTarget,
        onCopied: ({ key, confirm, tone }) => {
          setState({ key, hint: null, confirm });
          onNote?.(confirm, tone);
          timer.current = setTimeout(() => setState(null), CONFIRM_MS);
        },
      });
      if (r.outcome === "copied") return "copied";
      setState({ key: r.key, hint: r.hint, confirm: null });
      onNote?.(r.hint, "warn");
      if (r.focus?.cred) focusCred?.();
      else if (r.focus) focusToken?.(r.focus.token);
      return "guarded";
    },
    [qc, host, engagement, hostName, repeatKey, onNote, focusToken, focusCred],
  );

  /** Drops the arm and the notes: the command in view changed, so a held-back copy no longer applies. */
  const reset = useCallback(() => {
    copier.current?.reset();
    clearTimeout(timer.current);
    setState(null);
  }, []);

  const forKey = state?.key ?? null;
  const hint = state?.hint ?? null;
  const confirm = state?.confirm ?? null;
  /** The note (hint, else confirm) when it belongs to this command, else null. */
  const noteFor = (cmd: Pick<FilledCommand, "id" | "unresolved"> | null) => (cmd && forKey === copyKey(cmd) ? (hint ?? confirm) : null);

  return { copy, reset, canLog, hint, confirm, forKey, noteFor };
}

export type CommandCopy = ReturnType<typeof useCommandCopy>;
