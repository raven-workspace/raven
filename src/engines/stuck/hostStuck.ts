import type { ChecklistState } from "../../types/checklist";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import type { Service } from "../../types/service";
import { applicableGoals, isCoverMarked } from "../checklist";
import { openThreads, type Thread } from "../notes/threads";

export type StuckPhase = "before-foothold" | "after-foothold";

export interface UnidentifiedService {
  service: Service;
  reason: "guess" | "no-version";
  nudges: { label: string; command: string }[];
}

export interface HostStuck {
  phase: StuckPhase;
  skipped: { goalId: string; title: string; status: "na" }[];
  unidentified: UnidentifiedService[];
  untouched: Service[];
  threads: Thread[];
  /** Applicable goals still to do in privesc, loot and pivot (after a foothold). The UI fills their commands. */
  commands: { goalId: string; title: string }[];
  notes: string;
  hints: string[];
}

const FOOTHOLD_GOALS = ["h-foot-shell", "h-foot-creds", "h-foot-arrived"];
const AFTER_STAGES = ["privesc", "loot", "pivot"];

const statusOf = (state: ChecklistState, goalId: string) => state[goalId]?.status ?? "todo";

const isOpen = (s: Service) => {
  const st = (s.state ?? "").toLowerCase();
  return !st.startsWith("closed") && !st.startsWith("filtered");
};

/** The port as a whole number token: not inside a longer number or an IP's octets (`8080` and `10.0.0.80` do not mention 80). */
function mentions(line: string, port: number): boolean {
  return new RegExp(`(?<![\\d.])${port}(?!\\d|\\.\\d)`).test(line);
}

export function hostStuck(input: {
  host: Host;
  engagement: Pick<Engagement, "kind">;
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  state: ChecklistState;
  entries: LogEntry[];
  hostNote: string;
}): HostStuck {
  const { host, state } = input;
  const services = (input.servicesByHost.get(host.id) ?? []).filter(isOpen);
  const stages = applicableGoals(host, input.engagement, input.hosts, input.servicesByHost);
  const hasFoothold = host.access !== "none" || FOOTHOLD_GOALS.some((id) => statusOf(state, id) === "done");
  const threads = openThreads(input.hostNote);

  const out: HostStuck = {
    phase: hasFoothold ? "after-foothold" : "before-foothold",
    skipped: [],
    unidentified: [],
    untouched: [],
    threads,
    commands: [],
    notes: "",
    hints: [],
  };

  if (hasFoothold) {
    out.notes = input.hostNote;
    for (const { stage, goals } of stages) {
      if (!AFTER_STAGES.includes(stage.id)) continue;
      for (const g of goals) {
        const item = state[g.id];
        if (statusOf(state, g.id) === "todo" && !isCoverMarked(item)) out.commands.push({ goalId: g.id, title: g.title });
      }
    }
  } else {
    for (const { goals } of stages) {
      for (const g of goals) {
        if (statusOf(state, g.id) === "na" && !isCoverMarked(state[g.id])) out.skipped.push({ goalId: g.id, title: g.title, status: "na" });
      }
    }
    const unknown = services.filter((s) => {
      if (s.confirmedProduct) return false;
      return (s.nmapService ?? "").endsWith("?") || !s.nmapVersion;
    });
    const ports = unknown.map((s) => s.port).join(",");
    const target = host.ip || host.name;
    out.unidentified = unknown.map((s) => ({
      service: s,
      reason: (s.nmapService ?? "").endsWith("?") ? "guess" : "no-version",
      nudges: [
        { label: "Talk to it", command: `nc -nv ${target} ${s.port}  # then type help` },
        { label: "Rescan just these ports", command: `nmap -sV --version-all -p ${ports} ${target}` },
        { label: "Grab the banner", command: `echo | nc -nv -w 3 ${target} ${s.port}` },
      ],
    }));
    const lines = input.entries
      .filter((e) => e.kind === "command" && e.hostIds.includes(host.id) && e.content.kind === "command")
      .flatMap((e) => (e.content.kind === "command" ? e.content.blocks.flatMap((b) => b.command.split("\n")) : []));
    out.untouched = services.filter((s) => !lines.some((l) => mentions(l, s.port)));
  }

  if (services.length === 0) out.hints.push("Import a scan to see service steps");
  if (host.os === null) out.hints.push("Set the OS to see privesc steps");
  const empty =
    out.skipped.length + out.unidentified.length + out.untouched.length + out.threads.length + out.commands.length === 0;
  if (empty && out.hints.length === 0) out.hints.push("Nothing obvious left on this host");
  return out;
}
