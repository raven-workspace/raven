import { useCallback, useEffect, useRef, useState } from "react";
import type { FilledCommand } from "../checklist/CommandList";

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

/** These come from the credential chip, not from a fill field (USER and DOMAIN are fields when the credential does not supply them). */
const CRED_TOKENS = new Set(["PASS", "HASH", "CRED"]);
const CONFIRM_MS = 2500;

/**
 * The shared copy path. `attempt` runs `doCopy` unless the command still has an unresolved token and this is the first
 * try; then it focuses the field (or the credential chip) and shows `hint`. After a copy, `confirm` names the host and
 * how many placeholders were left, and clears itself. `forKey` is the `copyKey` of the command both texts belong to.
 */
export function useCopyGuard({ focusToken, focusCred, hostName }: {
  focusToken: (token: string) => void; focusCred: () => void; hostName: string | null;
}) {
  const armed = useRef<Armed | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [state, setState] = useState<{ key: string; hint: string | null; confirm: string | null } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const attempt = useCallback(
    async (cmd: FilledCommand, doCopy: () => Promise<void>): Promise<"copied" | "guarded"> => {
      const key = copyKey(cmd);
      const r = guardCopy(cmd, armed.current);
      clearTimeout(timer.current);
      if (r.action === "focus") {
        armed.current = { id: cmd.id, key };
        setState({ key, hint: `{${r.token}} not filled · ↵ again to copy anyway`, confirm: null });
        if (CRED_TOKENS.has(r.token)) focusCred();
        else focusToken(r.token);
        return "guarded";
      }
      armed.current = null;
      await doCopy();
      const n = cmd.unresolved.length;
      const left = n > 0 ? ` · ${n} placeholder${n === 1 ? "" : "s"} left` : "";
      setState({ key, hint: null, confirm: `${hostName ? `Copied for ${hostName}` : "Copied"}${left}` });
      timer.current = setTimeout(() => setState(null), CONFIRM_MS);
      return "copied";
    },
    [focusToken, focusCred, hostName],
  );

  /** Drops the arm and the notes: the command in view changed, so a held-back copy no longer applies. */
  const reset = useCallback(() => {
    armed.current = null;
    clearTimeout(timer.current);
    setState(null);
  }, []);

  return { attempt, reset, hint: state?.hint ?? null, confirm: state?.confirm ?? null, forKey: state?.key ?? null };
}
