import type { ChecklistState } from "../../types/checklist";
import type { CredAttempt, Credential, Username } from "../../types/credentials";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import type { Tunnel } from "../../types/network";
import { applicableGoals, adHosts } from "../checklist";
import type { LibraryCommand } from "../library/types";
import { hasFoothold, hasLegalCommand } from "./shared";
import { ROUTINE_STEPS, accessFlags, cellFor, hostSprayServices, isSprayable, routineStepApplies } from "../credentials";

export interface StuckLine {
  area: "foothold" | "credentials" | "privesc" | "lateral";
  /** What the line is about (a host or credential name), shown as its own element; null for engagement-wide lines. */
  subject: string | null;
  /** The state, without the subject. */
  text: string;
  /** Null for engagement-level lines. */
  hostId: string | null;
  goalId?: string;
}

const AREA_ORDER: StuckLine["area"][] = ["foothold", "credentials", "privesc", "lateral"];
/** The proof goal closes the privesc stage: once done the host is rooted, and it is an outcome, never a step to try. */
const PROOF_GOAL = "h-pe-proof";
const SPRAY_USERS_ITEM = ROUTINE_STEPS.find((s) => s.id === "spray-users")!.itemId;
const ASREP_GOALS = ["e-ad-user-asrep", "e-ad-nocreds-asrep"];

const nameOf = (h: Host) => h.name || h.ip || h.id;

/**
 * Where to look next, sorted by area (spec §6.7): hosts with no foothold and enumeration still to do, untested
 * credential cells, credentials never sprayed, usernames not AS-REP-checked, open access flags and dual-homed
 * hosts without a tunnel. Derived on every call.
 */
export function engagementStuck(input: {
  engagement: Engagement;
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  byOwner: Map<string, ChecklistState>;
  credentials: Credential[];
  attempts: CredAttempt[];
  usernames: Username[];
  tunnels: Tunnel[];
  /** Defaults to the built-in library. */
  library?: LibraryCommand[];
}): StuckLine[] {
  const { engagement, hosts, servicesByHost, byOwner } = input;
  const credentials = input.credentials.filter((c) => c.engagementId === engagement.id);
  const usernames = input.usernames.filter((u) => u.engagementId === engagement.id);
  const attempts = input.attempts.filter((a) => a.engagementId === engagement.id);
  const statusOf = (ownerId: string, goalId: string) => byOwner.get(ownerId)?.[goalId]?.status ?? "todo";
  const out: StuckLine[] = [];

  // foothold: no shell yet and enumeration steps still open; privesc: shell, privesc steps still open
  for (const host of hosts) {
    const stages = applicableGoals(host, engagement, hosts, servicesByHost);
    const open = (...stageIds: string[]) =>
      stages.filter((s) => stageIds.includes(s.stage.id)).flatMap((s) => s.goals).filter(
        (g) => g.id !== PROOF_GOAL && statusOf(host.id, g.id) === "todo" && hasLegalCommand(g.id, engagement, host.id, input.library),
      );
    if (hasFoothold(host, byOwner.get(host.id))) {
      if (statusOf(host.id, PROOF_GOAL) === "done") continue;
      const left = open("privilege-escalation");
      if (left.length > 0) {
        out.push({
          area: "privesc",
          subject: nameOf(host),
          text: `${left.length} privesc step${left.length === 1 ? "" : "s"} still to do`,
          hostId: host.id,
          goalId: left[0]!.id,
        });
      }
      continue;
    }
    const todo = open("information-gathering", "vulnerability-detection");
    if (todo.length === 0) continue;
    out.push({
      area: "foothold",
      subject: nameOf(host),
      text: `no foothold; ${todo.length} enumeration step${todo.length === 1 ? "" : "s"} still to do`,
      hostId: host.id,
      goalId: todo[0]!.id,
    });
  }

  // credentials: untested cells, never sprayed
  for (const cred of credentials.filter((c) => c.username && isSprayable(c))) {
    let cells = 0;
    let firstHost: Host | undefined;
    for (const host of hosts) {
      const services = servicesByHost.get(host.id) ?? [];
      for (const service of hostSprayServices(host, services)) {
        if (cellFor(cred, host, services, service, attempts).state !== "untested") continue;
        cells += 1;
        firstHost ??= host;
      }
    }
    if (cells > 0 && firstHost) {
      out.push({
        area: "credentials",
        subject: cred.username,
        text: `${cells} host/service cell${cells === 1 ? "" : "s"} untested`,
        hostId: firstHost.id,
      });
    }
  }
  if (statusOf(engagement.id, SPRAY_USERS_ITEM) !== "done") {
    for (const cred of credentials) {
      if (!routineStepApplies("spray-users", cred, hosts, servicesByHost, usernames)) continue;
      out.push({
        area: "credentials",
        subject: cred.username || "secret with no owner",
        text: "never sprayed at the usernames",
        hostId: null,
        goalId: SPRAY_USERS_ITEM,
      });
    }
  }
  if (usernames.length > 0 && adHosts(hosts, servicesByHost).length > 0 && !ASREP_GOALS.some((id) => statusOf(engagement.id, id) === "done")) {
    const id = ASREP_GOALS.find((g) => byOwner.get(engagement.id)?.[g]) ?? ASREP_GOALS[0]!;
    out.push({
      area: "credentials",
      subject: null,
      text: `${usernames.length} username${usernames.length === 1 ? "" : "s"} not yet AS-REP-checked`,
      hostId: null,
      goalId: id,
    });
  }

  // lateral: access not reviewed, dual-homed without a tunnel
  const byId = new Map(hosts.map((h) => [h.id, h]));
  for (const flag of accessFlags({ hosts, attempts, credentials })) {
    const host = byId.get(flag.hostId);
    if (!host) continue;
    const who =
      credentials.find((c) => c.id === flag.credId)?.username ||
      usernames.find((u) => u.id === flag.usernameId)?.username ||
      "a credential";
    out.push({
      area: "lateral",
      subject: nameOf(host),
      text: `${who} has ${flag.service} ${flag.result} access you have not reviewed`,
      hostId: host.id,
    });
  }
  const tunnelled = new Set(input.tunnels.filter((t) => t.engagementId === engagement.id).map((t) => t.viaHostId));
  for (const host of hosts) {
    if (host.dualHomed !== true || tunnelled.has(host.id)) continue;
    out.push({
      area: "lateral",
      subject: nameOf(host),
      text: "dual-homed, no tunnel recorded",
      hostId: host.id,
      goalId: "h-pivot-tunnel",
    });
  }

  return out.sort((a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area));
}
