import type { ReactNode } from "react";
import { Link } from "react-router";
import type { NetworkPath, PathNode } from "../../engines/network/path";
import { cx } from "../../lib/cx";
import type { Host } from "../../types/host";
import type { Hop, Tunnel } from "../../types/network";
import { BrandIcon, Chip, ChipSet, Tooltip } from "../../ui";
import { HostGlyph } from "../hosts/HostGlyph";
import { tunnelKindLabel } from "./TunnelForm";
import "./PathTree.scss";

/** What every node needs: where links go, the tunnels it pivots, which node is focused, and what its controls open. */
export interface NodeContext {
  engagementId: string;
  tunnelsVia: (hostId: string) => Tunnel[];
  focusedId?: string;
  onEditHop: (hop: Hop) => void;
  onEditTunnel: (tunnel: Tunnel) => void;
  onNeedsTunnel: (host: Host) => void;
}

/** The narrowest a tree node gets (13rem). Every node in a tree shares one width, so hop depths line up as columns. */
export const NODE_PX = 208;
/** The widest a tree node gets when the pane has room to spare (16rem): long names and subnets show whole. */
export const NODE_MAX_PX = 256;
/** The connector between a node and its children: a 16px stub into the spine, then a 24px stub into the child. */
export const CONNECTOR_PX = 40;


/** A tunnel through this host: kind, subnets and up/down in one badge that edits it. Down is warn. The first subnet shows, then `+N` for the rest; all are in the tooltip. */
function TunnelChip({ tunnel, onEdit }: { tunnel: Tunnel; onEdit: () => void }) {
  const kind = tunnelKindLabel(tunnel.kind);
  const subnets = tunnel.subnets.join(", ");
  // The first subnet shows whole; the rest are a count, listed in the tooltip.
  const [first, ...rest] = tunnel.subnets;
  const more = rest.length;
  return (
    <Tooltip
      content={
        <span className="path-node__tip">
          <span>Edit tunnel</span>
          {tunnel.subnets.length > 1 && <span className="path-node__tip-detail path-node__tip-detail--mono">{subnets}</span>}
          {tunnel.callbackIp && <span className="path-node__tip-detail">Callback {tunnel.callbackIp}</span>}
        </span>
      }
    >
      <button
        type="button"
        aria-label={`${kind} tunnel to ${subnets || "no subnets"}, ${tunnel.status}`}
        onClick={onEdit}
        className="path-node__chip-button path-node__chip-button--tunnel"
      >
        <Chip variant={tunnel.status === "down" ? "warn" : "default"} className="path-node__chip path-node__tunnel-chip">
          <span>{kind}</span>
          {first && <span aria-hidden className="path-node__tunnel-rule" />}
          {first && <span className="path-node__tunnel-subnet">{first}</span>}
          {more > 0 && <span className="path-node__tunnel-more">+{more}</span>}
          <span aria-hidden className="path-node__tunnel-rule" />
          <span>{tunnel.status}</span>
        </Chip>
      </button>
    </Tooltip>
  );
}

/** Longest `via` sure to show whole in a node's two lines; a longer one may clamp, so the tooltip repeats it. */
const VIA_CH = 40;

/** How the host was reached, under its IP: `via {how}` as a text button that edits the hop, or `not recorded`. */
function ViaLine({ node, ctx }: { node: PathNode; ctx: NodeContext }) {
  if (!node.hop) return <span className="path-node__no-hop">not recorded</span>;
  const hop = node.hop;
  const also = node.alsoVia.map((h) => h.via).join(", ");
  return (
    <Tooltip
      content={
        <span className="path-node__tip">
          <span>Edit hop</span>
          {hop.via.length > VIA_CH && <span className="path-node__tip-detail">{hop.via}</span>}
          {also && <span className="path-node__tip-detail">Also via: {also}</span>}
        </span>
      }
    >
      <button
        type="button"
        onClick={() => ctx.onEditHop(hop)}
        className="path-node__via"
      >
        <span className="path-node__via-text">via {hop.via}</span>
      </button>
    </Tooltip>
  );
}

/**
 * A host on the path (or in the Not reached tray): glyph and name to its page, IP, how it was reached (`node`, on the
 * path only), and its tunnels or the need for one.
 */
export function HostNode({ host, node, ctx, dim = false, wide = false }: {
  host: Host;
  node?: PathNode;
  ctx: NodeContext;
  dim?: boolean;
  /** The list's node: as wide as its row (the list is capped at 36rem), with the IP on the name's line. */
  wide?: boolean;
}) {
  const tunnels = ctx.tunnelsVia(host.id);
  const needsTunnel = host.dualHomed && tunnels.length === 0;
  return (
    <div
      data-host-node={host.id}
      data-focused={ctx.focusedId === host.id ? "" : undefined}
      className={cx("path-node", wide && "path-node--wide", dim && "path-node--dim")}
    >
      <div className={cx("path-node__head", wide && "path-node__head--wide")}>
        <HostGlyph column={host.boardColumn} />
        <Link
          to={`/e/${ctx.engagementId}/h/${host.id}`}
          title={host.name}
          className={cx("path-node__name", dim && "path-node__name--dim")}
        >
          {host.name}
        </Link>
        {wide && host.ip && <IpText ip={host.ip} />}
      </div>
      {!wide && host.ip && <IpText ip={host.ip} className="path-node__ip--under" />}
      {node && <ViaLine node={node} ctx={ctx} />}
      {(tunnels.length > 0 || needsTunnel) && (
        <ChipSet className="path-node__chips">
          {tunnels.map((t) => <TunnelChip key={t.id} tunnel={t} onEdit={() => ctx.onEditTunnel(t)} />)}
          {needsTunnel && (
            <Tooltip content="Add a tunnel through this host">
              <button
                type="button"
                aria-label={`Needs tunnel: add one via ${host.name}`}
                onClick={() => ctx.onNeedsTunnel(host)}
                className="path-node__chip-button"
              >
                <Chip variant="warn" className="path-node__chip">Needs tunnel</Chip>
              </button>
            </Tooltip>
          )}
        </ChipSet>
      )}
    </div>
  );
}

/** An IP under the name (tree) or at the end of the name's line (list). */
function IpText({ ip, className }: { ip: string; className?: string }) {
  return <span className={cx("path-node__ip", className)}>{ip}</span>;
}

/** The root: Kali, with the attacker IP from Settings when it is set. */
function KaliNode({ attackerIp, wide }: { attackerIp: string; wide: boolean }) {
  return (
    <div className={cx("path-node", wide && "path-node--wide")}>
      <div className={cx("path-node__head path-node__head--kali", wide && "path-node__head--wide")}>
        {/* Large: the dragon is unreadable at the 16px muted default. */}
        <BrandIcon brand="kali" large />
        <span className="path-node__kali">Kali</span>
        {wide && attackerIp && <IpText ip={attackerIp} />}
      </div>
      {!wide && attackerIp && <IpText ip={attackerIp} className="path-node__ip--under-kali" />}
    </div>
  );
}

/*
 * Connectors are hairlines at one height: the middle of a node's first line (8px padding + half its 20px line = 18px
 * from the node's top). Every node is top-aligned with its first child, so the lines run straight across.
 */
/* The parent's stub into its children stack, each child's piece of the spine, and its solid (recorded) or dashed stub
 * into the child are pseudo-elements in PathTree.scss. */

/**
 * One subtree, left to right: `[node] [children stack]`. The first child sits on the node's row; the rest stack below it
 * in the same column, so depth d is always column d.
 */
function Branch({ head, id, kids, ctx }: { head: ReactNode; id: string; kids: PathNode[]; ctx: NodeContext }) {
  if (kids.length === 0) return <>{head}</>;
  return (
    <div className="path-tree__branch">
      {head}
      <ul data-children-of={id} className="path-tree__children">
        {kids.map((k) => (
          <li key={k.host.id} className={cx("path-tree__child", k.recorded ? "path-tree__child--recorded" : "path-tree__child--unrecorded")}>
            <Branch head={<HostNode host={k.host} node={k} ctx={ctx} />} id={k.host.id} kids={k.children} ctx={ctx} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The narrow form: the same recursion as an indented list, one level of indent (with a hairline guide) per hop depth. */
function ListLevel({ id, kids, ctx }: { id: string; kids: PathNode[]; ctx: NodeContext }) {
  return (
    <ol data-children-of={id} className="path-tree__level">
      {kids.map((k) => (
        <li key={k.host.id} className="path-tree__level-item">
          <HostNode host={k.host} node={k} ctx={ctx} wide />
          {k.children.length > 0 && <ListLevel id={k.host.id} kids={k.children} ctx={ctx} />}
        </li>
      ))}
    </ol>
  );
}

/** The attack path from Kali. `tree` reads left to right by hop depth; `list` is the indented form for narrow panes. */
export function PathTree({ path, attackerIp, variant, ctx }: {
  path: NetworkPath;
  attackerIp: string;
  variant: "tree" | "list";
  ctx: NodeContext;
}) {
  const kali = <KaliNode attackerIp={attackerIp} wide={variant === "list"} />;
  return (
    <ol aria-label="Attack path" data-variant={variant} className={cx("path-tree", `path-tree--${variant}`)}>
      <li className="path-tree__root">
        {variant === "tree" ? (
          <Branch head={kali} id="kali" kids={path.roots} ctx={ctx} />
        ) : (
          <>
            {kali}
            {path.roots.length > 0 && <ListLevel id="kali" kids={path.roots} ctx={ctx} />}
          </>
        )}
      </li>
    </ol>
  );
}
