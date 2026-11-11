import { describe, it, expect } from "vitest";
import type { Host } from "../../../types/host";
import type { Hop } from "../../../types/network";
import { buildPath } from "../../../engines/network/path";

const host = (id: string, p: Partial<Host> = {}): Host => ({
  id, engagementId: "e1", name: id, ip: "10.10.10.5", os: "linux", boardColumn: "information-gathering", boardManual: false,
  access: "none", createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
});
const hop = (id: string, from: string | null, to: string, at: number): Hop => ({
  id, engagementId: "e1", fromHostId: from, toHostId: to, via: "ssh", logEntryId: null, at, updatedAt: at,
});

describe("buildPath", () => {
  it("returns every host as unreached when there are no hops", () => {
    const hosts = [host("B"), host("A")];
    expect(buildPath(hosts, [])).toEqual({ roots: [], unreached: [hosts[1], hosts[0]], columns: 0 });
  });

  it("nests a pivot under the host it was reached from", () => {
    const hosts = [host("A"), host("B")];
    const p = buildPath(hosts, [hop("h1", null, "A", 1), hop("h2", "A", "B", 2)]);
    expect(p.columns).toBe(2);
    expect(p.unreached).toEqual([]);
    expect(p.roots).toHaveLength(1);
    expect(p.roots[0].host.id).toBe("A");
    expect(p.roots[0].recorded).toBe(true);
    expect(p.roots[0].children.map((c) => c.host.id)).toEqual(["B"]);
    expect(p.roots[0].children[0].hop?.id).toBe("h2");
  });

  it("places an unrecorded root when only a pivot hop exists", () => {
    const hosts = [host("A"), host("B"), host("C")];
    const p = buildPath(hosts, [hop("h1", "A", "B", 1)]);
    expect(p.roots).toHaveLength(1);
    expect(p.roots[0].host.id).toBe("A");
    expect(p.roots[0].recorded).toBe(false);
    expect(p.roots[0].hop).toBeNull();
    expect(p.roots[0].children[0].host.id).toBe("B");
    expect(p.roots[0].children[0].recorded).toBe(true);
    expect(p.unreached.map((h) => h.id)).toEqual(["C"]);
    expect(p.columns).toBe(2);
  });

  it("places a host once and keeps a back-edge in alsoVia", () => {
    const hosts = [host("A"), host("B")];
    const p = buildPath(hosts, [hop("h1", null, "A", 1), hop("h2", "A", "B", 2), hop("h3", "B", "A", 3)]);
    expect(p.roots.map((r) => r.host.id)).toEqual(["A"]);
    expect(p.roots[0].children.map((c) => c.host.id)).toEqual(["B"]);
    expect(p.roots[0].children[0].children).toEqual([]);
    expect(p.roots[0].alsoVia.map((h) => h.id)).toEqual(["h3"]);
  });

  it("uses the earliest hop as parent and lists the other in alsoVia", () => {
    const hosts = [host("A"), host("B")];
    const p = buildPath(hosts, [hop("h1", null, "A", 1), hop("h2", "A", "B", 2), hop("h3", null, "B", 3)]);
    expect(p.roots.map((r) => r.host.id)).toEqual(["A"]);
    const b = p.roots[0].children[0];
    expect(b.hop?.id).toBe("h2");
    expect(b.alsoVia.map((h) => h.id)).toEqual(["h3"]);

    const q = buildPath(hosts, [hop("h1", null, "A", 1), hop("h2", null, "B", 2), hop("h3", "A", "B", 3)]);
    expect(q.roots.map((r) => r.host.id)).toEqual(["A", "B"]);
    expect(q.roots[1].alsoVia.map((h) => h.id)).toEqual(["h3"]);
  });

  it("ignores hops that touch a deleted host", () => {
    const hosts = [host("A")];
    const p = buildPath(hosts, [hop("h1", null, "A", 1), hop("h2", "A", "GONE", 2), hop("h3", "GONE", "A", 3)]);
    expect(p.roots).toHaveLength(1);
    expect(p.roots[0].children).toEqual([]);
    expect(p.roots[0].alsoVia).toEqual([]);
    expect(p.columns).toBe(1);
  });
});
