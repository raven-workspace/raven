import type { ChecklistState } from "../../types/checklist";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import type { Service } from "../../types/service";
import { applicableGoals, isCoverMarked } from "../checklist";
import type { LibraryCommand } from "../library/types";
import { openThreads, type Thread } from "../notes/threads";
import { shellEscape } from "../checklist/shellQuote";
import { hasFoothold, hasLegalCommand } from "./shared";

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
  /** Applicable goals still to do in privilege escalation, post-exploitation and lateral movement (after a foothold). The UI fills their commands. */
  commands: { goalId: string; title: string }[];
  notes: string;
  hints: string[];
}

const AFTER_STAGES = ["privilege-escalation", "post-exploitation", "lateral-movement"];

const statusOf = (state: ChecklistState, goalId: string) => state[goalId]?.status ?? "todo";

const isOpen = (s: Service) => {
  const st = (s.state ?? "").toLowerCase();
  return !st.startsWith("closed") && !st.startsWith("filtered");
};

/**
 * Whether a `-p` / `--ports` argument (`-p 1-1000`, `-p22,80-90`, `--ports=1-100`, `T:80,8000-`) covers the port.
 * `-p-` is every port; ranges only count here, so `sed -n 1-200p` or `10.0.0.1-254` do not touch anything.
 */
function inPortArgs(line: string, port: number): boolean {
  for (const m of line.matchAll(/(?:^|\s)(?:-p\s*|--ports(?:=|\s+))(\S+)/g)) {
    const spec = m[1];
    if (spec === "-") return true;
    for (const part of spec.split(",")) {
      const r = /^(?:[A-Za-z]+:)?(\d+)-(\d*)$/.exec(part);
      if (r && Number(r[1]) <= port && port <= (r[2] === "" ? 65535 : Number(r[2]))) return true;
    }
  }
  return false;
}

/**
 * The port as a whole number token: not inside a longer number or an IP's octets (`8080` and `10.0.0.80` do not
 * mention 80), or covered by a port argument (`inPortArgs`).
 */
function mentions(line: string, port: number): boolean {
  if (new RegExp(`(?<![\\d.])${port}(?!\\d|\\.\\d)`).test(line)) return true;
  return inPortArgs(line, port);
}

export function hostStuck(input: {
  host: Host;
  engagement: Pick<Engagement, "kind"> & { msfHostId?: string | null };
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  state: ChecklistState;
  entries: LogEntry[];
  hostNote: string;
  /** Defaults to the built-in library. */
  library?: LibraryCommand[];
}): HostStuck {
  const { host, state } = input;
  const services = (input.servicesByHost.get(host.id) ?? []).filter(isOpen);
  const stages = applicableGoals(host, input.engagement, input.hosts, input.servicesByHost);
  const foothold = hasFoothold(host, state);
  const threads = openThreads(input.hostNote);

  const out: HostStuck = {
    phase: foothold ? "after-foothold" : "before-foothold",
    skipped: [],
    unidentified: [],
    untouched: [],
    threads,
    commands: [],
    notes: "",
    hints: [],
  };

  if (foothold) {
    out.notes = input.hostNote;
    for (const { stage, goals } of stages) {
      if (!AFTER_STAGES.includes(stage.id)) continue;
      for (const g of goals) {
        const item = state[g.id];
        if (statusOf(state, g.id) === "todo" && !isCoverMarked(item) && hasLegalCommand(g.id, input.engagement, host.id, input.library)) out.commands.push({ goalId: g.id, title: g.title });
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
    const raw = host.ip || host.name;
    const target = raw ? shellEscape(raw, "bare") : "";
    out.unidentified = unknown.map((s) => ({
      service: s,
      reason: (s.nmapService ?? "").endsWith("?") ? "guess" : "no-version",
      nudges: !target ? [] : [
        { label: "Talk to it (then type help)", command: `nc -nv ${target} ${s.port}` },
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
