// Gathers an old container's log the way old Raven would show it: its own entries, entries left on its lab
// boxes (old utils/logRehome.ts), and legacy `commandOutputs` / `rawScanOutput` folded in exactly as old
// utils/engagementLogMigration.ts migrateLegacyLogs does. Raw old shapes come back; plan.ts maps them.
import type { OldMachine } from "./types";
import { isObj, hasText, arr } from "./values";

export type RawLog = Record<string, unknown>;

export interface GatheredLogs {
  entries: RawLog[];
  /** Non-object entries, or entries without an id. */
  bad: number;
  /** A second entry with an id already in the log. */
  duplicate: number;
}

const idsOf = (v: unknown): Set<string> => new Set(arr(v).filter((x): x is string => typeof x === "string"));

/** Old updatedAtMs: the machine's updatedAt, else now. */
const updatedAtMs = (m: OldMachine, now: number): number => {
  const ms = typeof m.updatedAt === "string" ? Date.parse(m.updatedAt) : NaN;
  return Number.isFinite(ms) ? ms : now;
};

/**
 * `boxes` are the lab's boxes (empty for a standalone). Tombstoned ids (`deletedLogEntryIds` on the container,
 * or on the box an entry sits on) are left out. The first entry with an id wins.
 */
export function gatherLogs(container: OldMachine, boxes: OldMachine[], now: number = Date.now()): GatheredLogs {
  const out: RawLog[] = [];
  const held = new Set<string>();
  const dead = idsOf(container.deletedLogEntryIds);
  let bad = 0;
  let duplicate = 0;

  const own = (m: OldMachine, forceHost: string | null) => {
    const boxDead = forceHost ? idsOf(m.deletedLogEntryIds) : dead;
    for (const e of arr(m.logEntries)) {
      if (!isObj(e) || !hasText(e.id)) {
        bad++;
        continue;
      }
      if (dead.has(e.id) || boxDead.has(e.id)) continue;
      if (held.has(e.id)) {
        duplicate++;
        continue;
      }
      held.add(e.id);
      out.push(forceHost ? { ...e, hostIds: [forceHost] } : e);
    }
  };

  // Legacy entries never count as duplicates: an id already present means it was folded before.
  const legacy = (e: RawLog) => {
    const id = e.id as string;
    if (dead.has(id) || held.has(id)) return;
    held.add(id);
    out.push(e);
  };

  const fold = (m: OldMachine) => {
    const hostIds = m === container ? [] : [m.id];
    arr(m.commandOutputs).forEach((o, i) => {
      if (!isObj(o)) {
        bad++;
        return;
      }
      const at = typeof o.createdAt === "number" && Number.isFinite(o.createdAt) ? o.createdAt : updatedAtMs(m, now);
      legacy({
        id: typeof o.id === "string" && o.id ? o.id : `cmd-import-${m.id}-${i}`,
        title: typeof o.title === "string" ? o.title : "",
        tool: typeof o.tool === "string" ? o.tool : "",
        at,
        hostIds: [...hostIds],
        blocks: [{ command: "", output: typeof o.content === "string" ? o.content : String(o.content ?? "") }],
      });
    });
    if (m.legacyLogsMigrated !== true && hasText(m.rawScanOutput)) {
      legacy({
        id: `scan-import-${m.id}`,
        title: hasText(m.scanSummary) ? m.scanSummary : "Imported scan",
        tool: "nmap",
        at: updatedAtMs(m, now),
        hostIds: [...hostIds],
        blocks: [{ command: "", output: m.rawScanOutput }],
      });
    }
  };

  own(container, null);
  for (const b of boxes) own(b, b.id);
  fold(container);
  for (const b of boxes) fold(b);
  return { entries: out, bad, duplicate };
}
