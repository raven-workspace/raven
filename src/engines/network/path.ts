import type { Host } from "../../types/host";
import type { Hop } from "../../types/network";

export interface PathNode {
  host: Host;
  /** The inbound hop used as tree parent; null only when `recorded` is false. */
  hop: Hop | null;
  recorded: boolean;
  children: PathNode[];
  /** Other hops into this host that the tree does not draw. */
  alsoVia: Hop[];
}

export interface NetworkPath {
  /** Kali's children. */
  roots: PathNode[];
  unreached: Host[];
  /** Deepest level + 1 (Kali excluded); 0 when there are no roots. */
  columns: number;
}

/**
 * Turn recorded hops into a tree rooted at Kali (`fromHostId` null).
 * The earliest hop that can reach a host is its parent; later ones go to `alsoVia`.
 * A host with an outbound hop but no recorded way in is placed under Kali as unrecorded.
 */
export function buildPath(hosts: Host[], hops: Hop[]): NetworkPath {
  const byId = new Map(hosts.map((h) => [h.id, h]));
  const valid = hops
    .filter((h) => byId.has(h.toHostId) && (h.fromHostId === null || byId.has(h.fromHostId)))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const nodes = new Map<string, PathNode>();
  const parentOf = new Map<string, string | null>();
  /** Ordering key among siblings: the parent hop's time, or the first outbound hop for unrecorded nodes. */
  const sortAt = new Map<string, number>();
  const roots: PathNode[] = [];

  const place = (hostId: string, hop: Hop | null, parentId: string | null, at: number) => {
    const node: PathNode = { host: byId.get(hostId)!, hop, recorded: hop !== null, children: [], alsoVia: [] };
    nodes.set(hostId, node);
    parentOf.set(hostId, parentId);
    sortAt.set(hostId, at);
    (parentId === null ? roots : nodes.get(parentId)!.children).push(node);
  };

  for (;;) {
    const next = valid.find(
      (h) => !nodes.has(h.toHostId) && (h.fromHostId === null || nodes.has(h.fromHostId)),
    );
    if (next) {
      place(next.toHostId, next, next.fromHostId, next.at);
      continue;
    }
    const orphan = valid.find((h) => h.fromHostId !== null && !nodes.has(h.fromHostId));
    if (!orphan) break;
    place(orphan.fromHostId!, null, null, orphan.at);
  }

  for (const hop of valid) {
    const node = nodes.get(hop.toHostId);
    if (node && node.hop?.id !== hop.id) node.alsoVia.push(hop);
  }

  const byTime = (a: PathNode, b: PathNode) => sortAt.get(a.host.id)! - sortAt.get(b.host.id)!;
  roots.sort(byTime);
  for (const n of nodes.values()) n.children.sort(byTime);

  const depth = (n: PathNode): number => 1 + Math.max(0, ...n.children.map(depth));
  return {
    roots,
    unreached: hosts.filter((h) => !nodes.has(h.id)).sort((a, b) => a.name.localeCompare(b.name)),
    columns: Math.max(0, ...roots.map(depth)),
  };
}
