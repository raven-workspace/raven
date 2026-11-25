import { useCallback, useEffect, useRef, useState } from "react";
import { SECRET_TOKENS } from "../../engines/checklist/template";
import type { FilledCommand } from "../checklist/CommandList/CommandList";

export type GuardResult = { action: "copy" } | { action: "focus"; token: string };

type Armed = { id: string; key: string };

/** Identifies a command in its current fill state: the arm and the on-screen hint belong to one key. */
export const copyKey = (cmd: { id: string; unresolved: string[] }): string => `${cmd.id}|${cmd.unresolved.join(",")}`;

/**
 * A copy of a command that still has unresolved tokens is held back once (focus goes to the first one); the same
 * command with the same tokens unresolved copies on the next try.
 */
export function guardCopy(cmd: { id: string; unresolved: string[] }, armed: Armed | null): GuardResult {
  const first = cmd.unresolved[0];
  if (first === undefined) return { action: "copy" };
  if (armed && armed.id === cmd.id && armed.key === copyKey(cmd)) return { action: "copy" };
  return { action: "focus", token: first };
}

/** How long a copy's confirm line stays (the Manual's status line clears after the same wait). */
export const CONFIRM_MS = 2500;

/**
 * The shared copy path. `attempt` runs `doCopy` unless the command still has an unresolved token and this is the first
 * try; then it focuses the field (or the credential chip) and shows `hint`. After a copy, `confirm` names the host and
 * how many placeholders were left, and clears itself. `forKey` is the `copyKey` of the command both texts belong to.
 */
export function useCopyGuard({ focusToken, focusCred, hostName, repeatKey = "↵", onNote }: {
  focusToken: (token: string) => void; focusCred: () => void; hostName: string | null;
  /** What the hint tells the user to press for the second try ("⌘↵ or Copy" where two controls copy). */
  repeatKey?: string;
  /** Also told each note as it is shown (a hold-back is "warn", a clean copy "ok"), for a surface that shows it elsewhere. */
  onNote?: (text: string, tone: "ok" | "warn") => void;
}) {
  const armed = useRef<Armed | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [state, setState] = useState<{ key: string; hint: string | null; confirm: string | null } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const attempt = useCallback(
    async (
      cmd: FilledCommand, doCopy: () => Promise<void>, opts?: { warn?: string; warnKey?: string },
    ): Promise<"copied" | "guarded"> => {
      const key = copyKey(cmd);
      // A warning arm (`key|warnKey`) also means the unresolved step was already passed.
      const a = armed.current;
      const r = guardCopy(cmd, a && a.key.startsWith(`${key}|`) ? { id: a.id, key } : a);
      clearTimeout(timer.current);
      if (r.action === "focus") {
        armed.current = { id: cmd.id, key };
        const hint = `{${r.token}} not filled. Press ${repeatKey} again to copy anyway`;
        setState({ key, hint, confirm: null });
        onNote?.(hint, "warn");
        // Secret tokens come from the credential chip, not a fill field (USER and DOMAIN are fields when the credential does not supply them).
        if (SECRET_TOKENS.has(r.token)) focusCred();
        else focusToken(r.token);
        return "guarded";
      }
      // Unresolved tokens are settled; a warning is a second, separate hold-back, armed on its own key.
      if (opts?.warn) {
        const warnArm = `${key}|${opts.warnKey ?? opts.warn}`;
        if (!(armed.current && armed.current.id === cmd.id && armed.current.key === warnArm)) {
          armed.current = { id: cmd.id, key: warnArm };
          const hint = `${opts.warn}. Press ${repeatKey} again to copy anyway`;
          setState({ key, hint, confirm: null });
          onNote?.(hint, "warn");
          return "guarded";
        }
      }
      armed.current = null;
      await doCopy();
      const n = cmd.unresolved.length;
      const left = n > 0 ? `. ${n} placeholder${n === 1 ? "" : "s"} left` : "";
      const confirm = `${hostName ? `Copied for ${hostName}` : "Copied"}${left}`;
      setState({ key, hint: null, confirm });
      onNote?.(confirm, n > 0 ? "warn" : "ok");
      timer.current = setTimeout(() => setState(null), CONFIRM_MS);
      return "copied";
    },
    [focusToken, focusCred, hostName, repeatKey, onNote],
  );

  /** Drops the arm and the notes: the command in view changed, so a held-back copy no longer applies. */
  const reset = useCallback(() => {
    armed.current = null;
    clearTimeout(timer.current);
    setState(null);
  }, []);

  return { attempt, reset, hint: state?.hint ?? null, confirm: state?.confirm ?? null, forKey: state?.key ?? null };
}
