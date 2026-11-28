import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import type { Note } from "../../types/notes";
import type { Service } from "../../types/service";
import { sortServices } from "../facts/services";

/**
 * One row of the Explorer's Notes or Logs group (design §1.4): the engagement's own item first, then one per host that
 * has something to show, in the hosts' order. `hostId` null is the engagement's.
 */
export interface ScopeRow {
  hostId: string | null;
  label: string;
}

const ENGAGEMENT_ROW: ScopeRow = { hostId: null, label: "Engagement" };

/** What a row calls its host: the name as the caller shows it (the Explorer shortens it), else the IP, else the id. */
export type HostNamer = (host: Host) => string;
const plainName: HostNamer = (h) => h.name;

function scopeRows(hosts: Host[], has: (hostId: string) => boolean, nameOf: HostNamer): ScopeRow[] {
  return [ENGAGEMENT_ROW, ...hosts.filter((h) => has(h.id)).map((h) => ({ hostId: h.id, label: nameOf(h) || h.ip || h.id }))];
}

/** Notes: "Engagement", then each host whose field note has text. A host with none is added from "Add note". */
export function noteRows(hosts: Host[], notes: Note[], nameOf: HostNamer = plainName): ScopeRow[] {
  const written = new Set(notes.filter((n) => n.hostId && n.body.trim() !== "").map((n) => n.hostId));
  return scopeRows(hosts, (id) => written.has(id), nameOf);
}

/** Logs: "Engagement" (the whole log), then each host with at least one entry. */
export function logRows(hosts: Host[], entries: LogEntry[], nameOf: HostNamer = plainName): ScopeRow[] {
  const logged = new Set(entries.flatMap((e) => e.hostIds));
  return scopeRows(hosts, (id) => logged.has(id), nameOf);
}

/** One service under an open host: its port, then the service name; a filtered port is muted. */
export interface ServiceRow {
  id: string;
  port: number;
  label: string;
  filtered: boolean;
}

/** A host's services in port order (tcp before udp on one number), each named as the Explorer shows it. */
export function serviceRows(services: Service[]): ServiceRow[] {
  return sortServices(services).map((s) => {
    const filtered = s.state.includes("filtered");
    const parts = [s.nmapService?.trim() || "unknown"];
    if (s.protocol === "udp") parts.push("udp");
    if (filtered) parts.push("filtered");
    return { id: s.id, port: s.port, label: parts.join(", "), filtered };
  });
}
