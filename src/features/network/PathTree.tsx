import type { ReactNode } from "react";
import { Link } from "react-router";
import type { NetworkPath, PathNode } from "../../engines/network/path";
import { cx } from "../../lib/cx";
import type { Host } from "../../types/host";
import type { Hop, Tunnel } from "../../types/network";
import { BrandIcon, Chip, ChipSet, Tooltip } from "../../ui";
import { HostGlyph } from "../hosts/HostGlyph";
import { tunnelKindLabel } from "./TunnelForm";

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

/** The tree's shared node width, set on the section; 13rem when nothing sets it. */
const NODE_W = "w-[var(--node-w,13rem)]";
/**
 * The node's box: one hairline card. In the tree every node is the section's `--node-w` wide; in the list a node
 * fills its row, so right edges line up. Dashed when the host is not reached.
 */
const BOX =
  "grid min-w-0 gap-1 rounded border bg-bg px-3 py-2 outline-offset-2 outline-accent " +
  "transition-[outline-color] duration-150 motion-reduce:transition-none data-focused:outline-2 data-focused:outline-solid";

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
        <span className="grid">
          <span>Edit tunnel</span>
          {tunnel.subnets.length > 1 && <span className="font-mono text-muted">{subnets}</span>}
          {tunnel.callbackIp && <span className="text-muted">Callback {tunnel.callbackIp}</span>}
        </span>
      }
    >
      <button
        type="button"
        aria-label={`${kind} tunnel to ${subnets || "no subnets"}, ${tunnel.status}`}
        onClick={onEdit}
        className="group grid min-h-7 min-w-0 max-w-full cursor-default grid-cols-[minmax(0,1fr)] items-center justify-items-start rounded-full border-0 bg-transparent p-0"
      >
        <Chip variant={tunnel.status === "down" ? "warn" : "default"} className="max-w-full group-hover:bg-surface-hi">
          <span>{kind}</span>
          {first && <span aria-hidden className="h-3 w-px shrink-0 bg-line-strong" />}
          {first && <span className="min-w-0 truncate font-mono">{first}</span>}
          {more > 0 && <span className="shrink-0">+{more}</span>}
          <span aria-hidden className="h-3 w-px shrink-0 bg-line-strong" />
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
  if (!node.hop) return <span className="truncate pl-6 text-meta text-muted">not recorded</span>;
  const hop = node.hop;
  const also = node.alsoVia.map((h) => h.via).join(", ");
  return (
    <Tooltip
      content={
        <span className="grid">
          <span>Edit hop</span>
          {hop.via.length > VIA_CH && <span className="text-muted">{hop.via}</span>}
          {also && <span className="text-muted">Also via: {also}</span>}
        </span>
      }
    >
      <button
        type="button"
        onClick={() => ctx.onEditHop(hop)}
        className="ml-6 block min-w-0 cursor-default rounded-sm border-0 bg-transparent p-0 text-left text-meta text-muted hover:text-fg"
      >
        <span className="line-clamp-2">via {hop.via}</span>
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
      className={cx(BOX, wide ? "w-full" : NODE_W, "border-line-2", dim && "border-dashed")}
    >
      <div className={cx("grid items-center gap-2", wide ? "grid-cols-[16px_minmax(0,1fr)_auto]" : "grid-cols-[16px_minmax(0,1fr)]")}>
        <HostGlyph column={host.boardColumn} />
        <Link
          to={`/e/${ctx.engagementId}/h/${host.id}`}
          title={host.name}
          className={cx("block truncate rounded-sm font-mono text-code no-underline underline-offset-4 hover:underline", dim ? "text-muted-2" : "text-fg")}
        >
          {host.name}
        </Link>
        {wide && host.ip && <IpText ip={host.ip} />}
      </div>
      {!wide && host.ip && <IpText ip={host.ip} className="pl-6" />}
      {node && <ViaLine node={node} ctx={ctx} />}
      {(tunnels.length > 0 || needsTunnel) && (
        <ChipSet className="min-w-0">
          {tunnels.map((t) => <TunnelChip key={t.id} tunnel={t} onEdit={() => ctx.onEditTunnel(t)} />)}
          {needsTunnel && (
            <Tooltip content="Add a tunnel through this host">
              <button
                type="button"
                aria-label={`Needs tunnel: add one via ${host.name}`}
                onClick={() => ctx.onNeedsTunnel(host)}
                className="group grid min-h-7 cursor-default items-center rounded-full border-0 bg-transparent p-0"
              >
                <Chip variant="warn" className="group-hover:bg-surface-hi">Needs tunnel</Chip>
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
  return <span className={cx("text-meta text-muted tabular-nums", className)}>{ip}</span>;
}

/** The root: Kali, with the attacker IP from Settings when it is set. */
function KaliNode({ attackerIp, wide }: { attackerIp: string; wide: boolean }) {
  return (
    <div className={cx(BOX, wide ? "w-full" : NODE_W, "border-line-2")}>
      <div className={cx("grid items-center gap-2", wide ? "grid-cols-[16px_minmax(0,1fr)_auto]" : "grid-cols-[16px_minmax(0,1fr)]")}>
        <BrandIcon brand="kali" />
        <span className="text-body font-semibold text-fg">Kali</span>
        {wide && attackerIp && <IpText ip={attackerIp} />}
      </div>
      {!wide && attackerIp && <IpText ip={attackerIp} className="pl-6" />}
    </div>
  );
}

/*
 * Connectors are hairlines at one height: the middle of a node's first line (8px padding + half its 20px line = 18px
 * from the node's top). Every node is top-aligned with its first child, so the lines run straight across.
 */
/** Stub from the parent's right edge into the children stack. */
const LEAD_IN = "before:absolute before:left-0 before:top-[18px] before:h-px before:w-4 before:bg-line-strong";
/** Each child's piece of the spine (first child's middle to last child's middle) and its stub into the child. */
const CHILD =
  "relative grid grid-cols-[max-content] pl-6 pb-3 last:pb-0 " +
  "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px before:bg-line-strong " +
  "first:before:top-[18px] last:before:bottom-auto last:before:h-[18px] only:before:hidden " +
  "after:absolute after:left-0 after:top-[18px] after:w-6";
const STUB_SOLID = "after:h-px after:bg-line-strong";
const STUB_DASHED = "after:h-0 after:border-t after:border-dashed after:border-line-strong";

/**
 * One subtree, left to right: `[node] [children stack]`. The first child sits on the node's row; the rest stack below it
 * in the same column, so depth d is always column d.
 */
function Branch({ head, id, kids, ctx }: { head: ReactNode; id: string; kids: PathNode[]; ctx: NodeContext }) {
  if (kids.length === 0) return <>{head}</>;
  return (
    <div className="grid grid-cols-[max-content_max-content] items-start">
      {head}
      <ul data-children-of={id} className={cx("relative m-0 grid list-none p-0 pl-4", LEAD_IN)}>
        {kids.map((k) => (
          <li key={k.host.id} className={cx(CHILD, k.recorded ? STUB_SOLID : STUB_DASHED)}>
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
    <ol data-children-of={id} className="m-0 ml-4 grid list-none gap-2 border-l border-line-2 p-0 pl-4">
      {kids.map((k) => (
        <li key={k.host.id} className="grid gap-2">
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
    <ol aria-label="Attack path" data-variant={variant} className={cx("m-0 grid list-none p-0", variant === "tree" ? "justify-start" : "max-w-144")}>
      <li className={cx("grid gap-2", variant === "tree" && "justify-items-start")}>
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
