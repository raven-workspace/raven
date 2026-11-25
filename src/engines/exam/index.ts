import type { Engagement, EngagementKind } from "../../types/engagement";
import type { LibraryCommand } from "../library/types";

/**
 * The exam rules for commands (foundation spec §6.4 and §6.5), in one place. Each command gets one exam verdict in a
 * scope, and each kind of surface shows that verdict by its own declared rule: a list hides what the exam forbids, a
 * reading surface shows it with the warning and holds back its first copy.
 *
 * Whether a command is banned or uses Metasploit comes only from its exam classification (`command.exam`, set by
 * `classifyExam` or a built-in's own rule), never from its text here.
 */

/**
 * What the exam rules are judged against: the engagement's kind ("pending" until it is known), the host in view (null
 * for none) and the host Metasploit is locked to (null while unlocked).
 */
export interface ExamScope {
  kind: EngagementKind | "pending";
  hostId: string | null;
  msfHostId: string | null;
}

/** The one exam verdict for a command in a scope. "pending": it has an exam classification but the kind is not known yet. */
export type ExamVerdict = "allowed" | "banned" | "metasploit-elsewhere" | "metasploit-unlocked" | "pending";

/** How a surface shows commands: a list (Arsenal, ⌘K, the checklist, Transfer) or a reading surface (Manual notes, the answer card). */
export type ExamSurface = "list" | "reader";

/** The rule line for a banned command. */
export const BANNED = "Not allowed in the exam";
const PENDING = "The exam rules aren't loaded yet";

/** The scope for an engagement (undefined while it is not known yet: pending) and the host in view. */
export function examScope(engagement: Pick<Engagement, "kind" | "msfHostId"> | undefined, hostId: string | null): ExamScope {
  if (!engagement) return { kind: "pending", hostId, msfHostId: null };
  return { kind: engagement.kind, hostId, msfHostId: engagement.msfHostId || null };
}

/**
 * The exam verdict for one command in a scope. An unclassified command is allowed whatever the kind. In an exam sim a
 * banned command is banned, and a Metasploit command is allowed on the locked host, locked elsewhere on any other (or
 * with no host in view), and unlocked while no host holds the lock. Other kinds allow everything.
 */
export function examVerdict(command: Pick<LibraryCommand, "exam">, scope: ExamScope): ExamVerdict {
  if (!command.exam) return "allowed";
  if (scope.kind === "pending") return "pending";
  if (scope.kind !== "exam-sim") return "allowed";
  if (command.exam === "banned") return "banned";
  if (scope.msfHostId === null) return "metasploit-unlocked";
  return scope.msfHostId === scope.hostId ? "allowed" : "metasploit-elsewhere";
}

/**
 * How a kind of surface shows a verdict. A list hides banned, locked-elsewhere and pending commands; a reader shows
 * every command and holds back the first copy of those.
 */
export function examDisplay(verdict: ExamVerdict, surface: ExamSurface): { shown: boolean; holdBack: boolean } {
  const forbidden = verdict === "banned" || verdict === "metasploit-elsewhere" || verdict === "pending";
  return surface === "list" ? { shown: !forbidden, holdBack: false } : { shown: true, holdBack: forbidden };
}

/**
 * The warning a verdict carries: the rule it breaks (`breach`), or the information that copying it would take the
 * Metasploit lock. Null for an allowed command and while pending. The only place this wording is built.
 */
export function examWarning(verdict: ExamVerdict, scope: ExamScope, hostName: (id: string) => string): { text: string; breach: boolean } | null {
  switch (verdict) {
    case "banned":
      return { text: BANNED, breach: true };
    case "metasploit-elsewhere":
      return { text: `Metasploit is locked to ${hostName(scope.msfHostId ?? "")}`, breach: true };
    case "metasploit-unlocked":
      return { text: "Using Metasploit here makes this your Metasploit machine", breach: false };
    default:
      return null;
  }
}

/**
 * A list surface's commands: those its rule shows, and the ids of the shown ones that would take the Metasploit lock
 * (marked "uses your one Metasploit host").
 */
export function examList(commands: LibraryCommand[], scope: ExamScope): { shown: LibraryCommand[]; msfMarker: Set<string> } {
  const shown: LibraryCommand[] = [];
  const msfMarker = new Set<string>();
  for (const c of commands) {
    const verdict = examVerdict(c, scope);
    if (!examDisplay(verdict, "list").shown) continue;
    if (verdict === "metasploit-unlocked") msfMarker.add(c.id);
    shown.push(c);
  }
  return { shown, msfMarker };
}

/**
 * A reading surface's view of one command: the rule line shown under it (none while pending) and, when its first copy
 * is held back, the warning for the copy guard (`warnKey` arms it apart from an unfilled-token hold-back).
 */
export function examReading(command: Pick<LibraryCommand, "exam">, scope: ExamScope, hostName: (id: string) => string): {
  verdict: ExamVerdict;
  line: { text: string; breach: boolean } | null;
  holdBack?: { warn: string; warnKey: string };
} {
  const verdict = examVerdict(command, scope);
  const line = examWarning(verdict, scope, hostName);
  if (!examDisplay(verdict, "reader").holdBack) return { verdict, line };
  return { verdict, line, holdBack: { warn: line?.text ?? PENDING, warnKey: verdict } };
}
