import { SECRET_TOKENS } from "../../engines/checklist/template";
import type { FilledCommand } from "./filledCommand";

/**
 * Copying a filled command, with no React: the clipboard mode, the copy guard, and the log entry with its "ran on"
 * machine. The clipboard and the log are handed in, so a test can stand them in.
 */

/** Where copies go. A secret is copied as one, so Raven can wipe it when the vault locks. */
export interface Clipboard {
  secret(text: string): Promise<void>;
  plain(text: string): Promise<void>;
}

/** What one copied command logs. */
export interface CommandLogEntry {
  title: string;
  command: string;
  ranOn: string;
  payloadId?: string;
  payloadValues?: Record<string, string>;
}

/** Where a copy is logged: the host in view and your own machine (Settings' first). */
export interface LogTarget {
  /** The host's full name: a command run on the target ran on it. */
  hostName: string;
  /** Your machine: a command run from the attacker ran on it ("" when Settings names none). */
  attacker: string;
  write(entry: CommandLogEntry): Promise<void>;
}

/** A second hold-back after the unfilled tokens: an exam verdict's warning, or a surface's own ("Rebuild first"). */
export interface CopyWarning {
  warn: string;
  /** Arms the warning apart from others (a different key holds the copy back again). */
  warnKey?: string;
}

/** Identifies a command in its current fill state: the arm and the on-screen note belong to one key. */
export const copyKey = (cmd: Pick<FilledCommand, "id" | "unresolved">): string => `${cmd.id}|${cmd.unresolved.join(",")}`;

/** The clipboard mode: a command carrying a secret is copied as a secret, anything else as plain text. */
export const clipboardMode = (cmd: Pick<FilledCommand, "secret">): "secret" | "plain" => (cmd.secret ? "secret" : "plain");

/** The machine a command ran on: yours for a command run from the attacker, else the host in view. */
export const ranOn = (cmd: Pick<FilledCommand, "runFrom">, to: Pick<LogTarget, "hostName" | "attacker">): string =>
  cmd.runFrom === "attacker" ? to.attacker : to.hostName;

/** How long a copy's confirm line stays (the Manual's status line clears after the same wait). */
export const CONFIRM_MS = 2500;

type Armed = { id: string; key: string };

export type GuardResult = { action: "copy" } | { action: "focus"; token: string };

/**
 * A copy of a command that still has unresolved tokens is held back once (focus goes to the first one); the same
 * command with the same tokens unresolved copies on the next try.
 */
export function guardCopy(cmd: Pick<FilledCommand, "id" | "unresolved">, armed: Armed | null): GuardResult {
  const first = cmd.unresolved[0];
  if (first === undefined) return { action: "copy" };
  if (armed && armed.id === cmd.id && armed.key === copyKey(cmd)) return { action: "copy" };
  return { action: "focus", token: first };
}

export interface CopyOptions {
  /** The host in view's short name, for "Copied for <host>". */
  hostName: string | null;
  /** What the hint tells the user to press for the second try. */
  repeatKey?: string;
  warning?: CopyWarning | undefined;
  /** Log the command after the copy; null or absent copies only. */
  log?: LogTarget | null;
  /** The log entry's own title and payload fields, where they are not the command's. */
  logAs?: { title?: string; payloadId?: string; payloadValues?: Record<string, string> };
  /** Runs after the clipboard write and before the log (Payloads records the build). */
  afterCopy?: () => Promise<void>;
  /** Told as soon as the clipboard holds the text, before `afterCopy` and the log. */
  onCopied?: (copied: { key: string; confirm: string; tone: "ok" | "warn" }) => void;
  /** Guard the copy as this command (one arm shared by several blocks), copying `cmd`'s own text. */
  guardAs?: Pick<FilledCommand, "id" | "unresolved">;
}

export type CopyResult =
  | {
    outcome: "guarded"; key: string; hint: string;
    /** Where focus goes: an unfilled token's field, or the credential chip for a secret token; null for a warning. */
    focus: { token: string; cred: boolean } | null;
  }
  | { outcome: "copied"; key: string; confirm: string; tone: "ok" | "warn"; logged: boolean };

/**
 * One copier, holding the arm of its last held-back copy. `copy` runs the guard (unfilled tokens first, then the
 * warning; each holds the copy back once), writes the clipboard in its mode, then logs the typed text with its "ran on"
 * machine. A failed write or log rejects; the arm is already spent by then.
 */
export function createCommandCopy(clipboard: Clipboard) {
  let armed: Armed | null = null;

  const copy = async (cmd: FilledCommand, opts: CopyOptions): Promise<CopyResult> => {
    const as = opts.guardAs ?? cmd;
    const key = copyKey(as);
    const repeat = opts.repeatKey ?? "↵";
    // A warning arm (`key|warnKey`) also means the unresolved step was already passed.
    const a = armed;
    const r = guardCopy(as, a && a.key.startsWith(`${key}|`) ? { id: a.id, key } : a);
    if (r.action === "focus") {
      armed = { id: as.id, key };
      // Secret tokens come from the credential chip, not a fill field (USER and DOMAIN are fields when the credential does not supply them).
      return { outcome: "guarded", key, hint: `{${r.token}} not filled. Press ${repeat} again to copy anyway`, focus: { token: r.token, cred: SECRET_TOKENS.has(r.token) } };
    }
    // Unresolved tokens are settled; a warning is a second, separate hold-back, armed on its own key.
    const w = opts.warning;
    if (w) {
      const warnArm = `${key}|${w.warnKey ?? w.warn}`;
      if (!(armed && armed.id === as.id && armed.key === warnArm)) {
        armed = { id: as.id, key: warnArm };
        return { outcome: "guarded", key, hint: `${w.warn}. Press ${repeat} again to copy anyway`, focus: null };
      }
    }
    armed = null;
    await clipboard[clipboardMode(cmd)](cmd.copied);
    const n = as.unresolved.length;
    const left = n > 0 ? `. ${n} placeholder${n === 1 ? "" : "s"} left` : "";
    const copied = { key, confirm: `${opts.hostName ? `Copied for ${opts.hostName}` : "Copied"}${left}`, tone: n > 0 ? ("warn" as const) : ("ok" as const) };
    // The copy stands whatever follows: it is confirmed before the build record and the log.
    opts.onCopied?.(copied);
    await opts.afterCopy?.();
    const log = opts.log ?? null;
    if (log) {
      await log.write({
        title: opts.logAs?.title ?? cmd.title, command: cmd.typed, ranOn: ranOn(cmd, log),
        ...(opts.logAs?.payloadId !== undefined ? { payloadId: opts.logAs.payloadId } : {}),
        ...(opts.logAs?.payloadValues ? { payloadValues: opts.logAs.payloadValues } : {}),
      });
    }
    return { outcome: "copied", ...copied, logged: log !== null };
  };

  /** Drops the arm: the command in view changed, so a held-back copy no longer applies. */
  const reset = () => {
    armed = null;
  };

  return { copy, reset };
}
