/**
 * Block sources: where a block on a page came from, saved on the block as a string (its `source` attr) so Refresh,
 * the checks and removal can follow it back. This file is the only place that knows how those strings are written.
 * Every page in the vault holds them, so the strings never change: build them here, read them with `parseSource`.
 */

/** The parts of a log entry a block can show. */
export type EntryPartName = "title" | "observations" | "request" | "response" | "note" | "proof" | "value";

/** Which part of an entry a block shows: a command or its output (by run), a named part, or a part this version no
 *  longer writes (the block still follows its entry). */
export type EntryPart = { run: number; side: "command" | "output" } | { name: EntryPartName } | { unknown: string };

/** The parts of a finding a block can show. */
export type FindingPart = "explanation" | "fix" | "severity" | "affected" | "exploit";

/** The report-level sub-section headings a guide note belongs to: Introduction and Scope (section 1), Recommendations
 *  (the summary), House Cleaning (methodologies). */
export type HeadingName = "introduction" | "scope" | "recommendations" | "house-cleaning";

/** A machine's blocks, one source per machine. */
export type HostSourceKind = "facts" | "result" | "ports" | "tested" | "phase-steps";

export type BlockSource =
  /** A log entry, whole (a figure) or one part of it. */
  | { kind: "entry"; entryId: string; part: EntryPart | null }
  /** A finding, whole (its Additional findings bullet) or one part. `unknown` is a part this version no longer writes. */
  | { kind: "finding"; findingId: string; part: FindingPart | "unknown" | null }
  /** A finding's exploit file. */
  | { kind: "file"; fileId: string }
  /** A machine's heading (`facts`), result line, port table, Also tested bullets, or "Steps to reproduce:" label. */
  | { kind: HostSourceKind; hostId: string }
  /** A phase heading of a machine, a finding's own when `findingId` is set. */
  | { kind: "phase"; hostId: string; phase: string; findingId: string | null }
  /** A report-level table. */
  | { kind: "table"; table: string }
  /** A drafted sub-section heading of a report-level page, so it keeps its guide note through a rename. */
  | { kind: "heading"; name: HeadingName }
  /** The Metasploit line, and the AD set's attack path. */
  | { kind: "msf" }
  | { kind: "attack-path" };

const ENTRY_PARTS: readonly string[] = ["title", "observations", "request", "response", "note", "proof", "value"];
const FINDING_PARTS: readonly string[] = ["explanation", "fix", "severity", "affected", "exploit"];
const HOST_KINDS: readonly string[] = ["facts", "result", "ports", "tested", "phase-steps"];
const HEADING_NAMES: readonly string[] = ["introduction", "scope", "recommendations", "house-cleaning"];

/** The source strings, built. */
export const source = {
  /** A whole entry (a figure), or one named part of it. */
  entry: (entryId: string, part?: EntryPartName) => (part ? `entry:${entryId}:${part}` : `entry:${entryId}`),
  /** One command of an entry, or its output: `run` is the index of the entry's command block it starts at. */
  entryRun: (entryId: string, run: number, side: "command" | "output") => `entry:${entryId}:${run}:${side}`,
  finding: (findingId: string, part?: FindingPart) => (part ? `finding:${findingId}:${part}` : `finding:${findingId}`),
  file: (fileId: string) => `file:${fileId}`,
  host: (kind: HostSourceKind, hostId: string) => `${kind}:${hostId}`,
  facts: (hostId: string) => `facts:${hostId}`,
  result: (hostId: string) => `result:${hostId}`,
  ports: (hostId: string) => `ports:${hostId}`,
  tested: (hostId: string) => `tested:${hostId}`,
  phaseSteps: (hostId: string) => `phase-steps:${hostId}`,
  phase: (hostId: string, phase: string, findingId?: string | null) => `phase:${hostId}:${phase}${findingId ? `:${findingId}` : ""}`,
  table: (table: string) => `table:${table}`,
  heading: (name: HeadingName) => `heading:${name}`,
  msf: "msf",
  attackPath: "attack-path",
} as const;

/** The string a parsed source is saved as. A part this version no longer writes is written back as it was. */
export function sourceString(s: BlockSource): string {
  switch (s.kind) {
    case "entry": {
      const p = s.part;
      if (!p) return source.entry(s.entryId);
      if ("run" in p) return source.entryRun(s.entryId, p.run, p.side);
      if ("name" in p) return source.entry(s.entryId, p.name);
      return `entry:${s.entryId}:${p.unknown}`;
    }
    case "finding":
      return s.part && s.part !== "unknown" ? source.finding(s.findingId, s.part) : source.finding(s.findingId);
    case "file":
      return source.file(s.fileId);
    case "phase":
      return source.phase(s.hostId, s.phase, s.findingId);
    case "table":
      return source.table(s.table);
    case "heading":
      return source.heading(s.name);
    case "msf":
      return source.msf;
    case "attack-path":
      return source.attackPath;
    default:
      return source.host(s.kind, s.hostId);
  }
}

/**
 * A source string, read. Strict about the kind and lenient about the part: `entry:<id>:<a part no longer written>`
 * still names its entry (`{ unknown }`), and so does `finding:<id>:<…>`. Anything that is no known kind, or a known
 * kind without its ids, is null.
 */
export function parseSource(raw: string | null | undefined): BlockSource | null {
  if (typeof raw !== "string" || raw === "") return null;
  if (raw === "msf") return { kind: "msf" };
  if (raw === "attack-path") return { kind: "attack-path" };
  const colon = raw.indexOf(":");
  if (colon === -1) return null;
  const kind = raw.slice(0, colon);
  const rest = raw.slice(colon + 1);
  const parts = rest.split(":");
  const [id] = parts;
  switch (kind) {
    case "entry": {
      if (!id) return null;
      const tail = parts.slice(1);
      if (tail.length === 0) return { kind, entryId: id, part: null };
      if (tail.length === 2 && /^\d+$/.test(tail[0]!) && (tail[1] === "command" || tail[1] === "output"))
        return { kind, entryId: id, part: { run: Number(tail[0]), side: tail[1] } };
      if (tail.length === 1 && ENTRY_PARTS.includes(tail[0]!)) return { kind, entryId: id, part: { name: tail[0] as EntryPartName } };
      return { kind, entryId: id, part: { unknown: tail.join(":") } };
    }
    case "finding": {
      if (!id) return null;
      if (parts.length === 1) return { kind, findingId: id, part: null };
      return { kind, findingId: id, part: parts.length === 2 && FINDING_PARTS.includes(parts[1]!) ? (parts[1] as FindingPart) : "unknown" };
    }
    case "file":
      return rest ? { kind, fileId: rest } : null;
    case "phase":
      if (!id || !parts[1] || parts.length > 3) return null;
      return { kind, hostId: id, phase: parts[1], findingId: parts[2] || null };
    case "table":
      return rest && parts.length === 1 ? { kind, table: rest } : null;
    case "heading":
      return HEADING_NAMES.includes(rest) ? { kind, name: rest as HeadingName } : null;
    default:
      if (!HOST_KINDS.includes(kind) || !id || parts.length !== 1) return null;
      return { kind: kind as HostSourceKind, hostId: id };
  }
}
