import { describe, expect, it } from "vitest";
import { logRows, noteRows, serviceRows } from "../../../engines/explorer/index";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";
import type { Note } from "../../../types/notes";
import type { Service } from "../../../types/service";

const host = (id: string, name: string, ip: string | null = null) => ({ id, name, ip }) as Host;
const note = (hostId: string | null, body: string) => ({ ownerId: hostId ?? "e1", engagementId: "e1", hostId, body }) as Note;
const entry = (hostIds: string[]) => ({ hostIds }) as LogEntry;
const service = (id: string, port: number, over: Partial<Service> = {}) =>
  ({ id, port, protocol: "tcp", state: "open", nmapService: "http", ...over }) as Service;

const short = (h: Host) => h.name.split(".")[0] ?? h.name;
const HOSTS = [host("h1", "forge.lab.local"), host("h2", "web02"), host("h3", "", "192.0.2.9")];

describe("Explorer rows (design §1.4)", () => {
  it("notes: the engagement first, then each host whose note has text, in host order, by short name", () => {
    const rows = noteRows(HOSTS, [note("h2", "creds?"), note(null, "scope"), note("h1", "admin panel"), note("h3", "  ")], short);
    expect(rows).toEqual([
      { hostId: null, label: "Engagement" },
      { hostId: "h1", label: "forge" },
      { hostId: "h2", label: "web02" },
    ]);
  });

  it("logs: the engagement first, then each host with an entry; a host with no name goes by its IP", () => {
    const rows = logRows(HOSTS, [entry(["h3"]), entry([]), entry(["h3", "h2"]), entry(["h1"])]);
    expect(rows).toEqual([
      { hostId: null, label: "Engagement" },
      { hostId: "h1", label: "forge.lab.local" },
      { hostId: "h2", label: "web02" },
      { hostId: "h3", label: "192.0.2.9" },
    ]);
  });

  it("the engagement row stays with nothing written or logged", () => {
    expect(noteRows(HOSTS, [])).toEqual([{ hostId: null, label: "Engagement" }]);
    expect(logRows([], [])).toEqual([{ hostId: null, label: "Engagement" }]);
  });

  it("services: port order, tcp before udp; a filtered port is muted and says so", () => {
    const rows = serviceRows([
      service("s3", 80),
      service("s2", 53, { protocol: "udp", nmapService: "domain", state: "open|filtered" }),
      service("s1", 21, { nmapService: "ftp", state: "filtered" }),
      service("s4", 53, { nmapService: "domain" }),
      service("s5", 8443, { nmapService: null }),
    ]);
    expect(rows).toEqual([
      { id: "s1", port: 21, label: "ftp, filtered", filtered: true },
      { id: "s4", port: 53, label: "domain", filtered: false },
      { id: "s2", port: 53, label: "domain, udp, filtered", filtered: true },
      { id: "s3", port: 80, label: "http", filtered: false },
      { id: "s5", port: 8443, label: "unknown", filtered: false },
    ]);
  });
});
