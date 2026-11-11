import { ArrowRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { NetworkPath, PathNode } from "../../engines/network/path";
import { cx } from "../../lib/cx";
import type { Host } from "../../types/host";
import type { Hop, Tunnel } from "../../types/network";
import { BrandIcon, Button, Chip, ChipSet, Tooltip } from "../../ui";
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

/** The node's box: one hairline card, fixed padding. Dashed when the host is not reached. */
const BOX =
  "grid gap-1 rounded border bg-bg px-3 py-2 outline-offset-2 outline-accent " +
  "transition-[outline-color] duration-150 motion-reduce:transition-none data-focused:outline-2 data-focused:outline-solid";

/** A tunnel through this host: kind, subnets and up/down in one badge that edits it. Down is warn. */
function TunnelChip({ tunnel, onEdit }: { tunnel: Tunnel; onEdit: () => void }) {
  const kind = tunnelKindLabel(tunnel.kind);
  const subnets = tunnel.subnets.join(", ");
  return (
    <Tooltip
      content={
        <span className="grid">
          <span>Edit tunnel</span>
          {tunnel.callbackIp && <span className="text-muted">Callback {tunnel.callbackIp}</span>}
        </span>
      }
    >
      <button
        type="button"
        aria-label={`${kind} tunnel to ${subnets || "no subnets"}, ${tunnel.status}`}
        onClick={onEdit}
        className="group grid min-h-7 cursor-default items-center rounded-full border-0 bg-transparent p-0"
      >
        <Chip variant={tunnel.status === "down" ? "warn" : "default"} className="gap-2 group-hover:bg-surface-hi">
          <span>{kind}</span>
          {subnets && <span aria-hidden className="h-3 w-px bg-line-strong" />}
          {subnets && <span className="font-mono">{subnets}</span>}
          <span aria-hidden className="h-3 w-px bg-line-strong" />
          <span>{tunnel.status}</span>
        </Chip>
      </button>
    </Tooltip>
  );
}

/** A host on the path (or in the Not reached tray): glyph, name to its page, IP, and its tunnels or the need for one. */
export function HostNode({ host, ctx, dim = false }: { host: Host; ctx: NodeContext; dim?: boolean }) {
  const tunnels = ctx.tunnelsVia(host.id);
  const needsTunnel = host.dualHomed && tunnels.length === 0;
  return (
    <div
      data-host-node={host.id}
      data-focused={ctx.focusedId === host.id ? "" : undefined}
      className={cx(BOX, dim ? "border-dashed border-line-2" : "w-max min-w-36 border-line-2")}
    >
      <div className="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-2">
        <HostGlyph column={host.boardColumn} />
        <Link
          to={`/e/${ctx.engagementId}/h/${host.id}`}
          title={host.name}
          className={cx("block max-w-[24ch] truncate rounded-sm font-mono text-code no-underline underline-offset-4 hover:underline", dim ? "text-muted-2" : "text-fg")}
        >
          {host.name}
        </Link>
      </div>
      {host.ip && <span className="pl-6 text-meta text-muted tabular-nums">{host.ip}</span>}
      {(tunnels.length > 0 || needsTunnel) && (
        <ChipSet className="pl-6">
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

/** The root: Kali, with the attacker IP from Settings when it is set. */
function KaliNode({ attackerIp }: { attackerIp: string }) {
  return (
    <div className={cx(BOX, "w-max min-w-36 border-line-2")}>
      <div className="grid grid-cols-[16px_minmax(0,1fr)] items-center gap-2">
        <BrandIcon brand="kali" />
        <span className="text-body font-semibold text-fg">Kali</span>
      </div>
      {attackerIp && <span className="pl-6 text-meta text-muted tabular-nums">{attackerIp}</span>}
    </div>
  );
}

/** Longest `via` shown whole on an edge; a longer one truncates and reads in full in the tooltip. */
const VIA_CH = 20;

/** How a node was reached: the hop's `via` as a button that edits the hop, or `not recorded`. Other ways in are in its tooltip. */
function EdgeLabel({ node, ctx }: { node: PathNode; ctx: NodeContext }) {
  if (!node.hop) return <span className="px-2 text-meta text-muted">not recorded</span>;
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
      <Button size="sm" onClick={() => ctx.onEditHop(hop)} className="max-w-full">
        <span className="max-w-[20ch] truncate">{hop.via}</span>
      </Button>
    </Tooltip>
  );
}

/** A connector line: solid for a recorded hop, dashed when the way in is not recorded. */
const line = (recorded: boolean) => (recorded ? "h-px bg-line-strong" : "border-t border-dashed border-line-strong");

/**
 * One subtree, left to right: `[node] [children]`. The children stack has a 16px lead-in from the node, a spine on its
 * left from the first child's middle to the last child's middle (each child draws its own piece of it), and each child
 * a stub carrying its edge label.
 */
function Branch({ head, kids, ctx }: { head: ReactNode; kids: PathNode[]; ctx: NodeContext }) {
  if (kids.length === 0) return <>{head}</>;
  return (
    <div className="grid grid-cols-[max-content_max-content] items-center">
      {head}
      <ul className="relative m-0 grid list-none p-0 pl-4 before:absolute before:left-0 before:top-1/2 before:h-px before:w-4 before:bg-line-strong">
        {kids.map((k) => (
          <li
            key={k.host.id}
            className={cx(
              "relative grid grid-cols-[max-content_max-content] items-center py-2",
              "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-line-strong first:before:top-1/2 last:before:bottom-1/2",
            )}
          >
            <div className="grid grid-cols-[16px_max-content_16px] items-center">
              <span aria-hidden className={line(k.recorded)} />
              <EdgeLabel node={k} ctx={ctx} />
              <span aria-hidden className={line(k.recorded)} />
            </div>
            <Branch head={<HostNode host={k.host} ctx={ctx} />} kids={k.children} ctx={ctx} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The narrow form: the same recursion as an indented list, the edge inline before the name ("via creds → WEB01"). */
function ListLevel({ kids, ctx }: { kids: PathNode[]; ctx: NodeContext }) {
  return (
    <ol className="m-0 grid list-none gap-2 p-0 pl-6">
      {kids.map((k) => (
        <li key={k.host.id} className="grid gap-2">
          <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-2">
            <span className="grid grid-cols-[max-content_max-content_16px] items-center gap-2">
              {k.hop && <span className="text-meta text-muted">via</span>}
              <EdgeLabel node={k} ctx={ctx} />
              <ArrowRight size={16} className="text-muted" role="img" aria-label="to" />
            </span>
            <HostNode host={k.host} ctx={ctx} />
          </div>
          {k.children.length > 0 && <ListLevel kids={k.children} ctx={ctx} />}
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
  const kali = <KaliNode attackerIp={attackerIp} />;
  return (
    <ol aria-label="Attack path" data-variant={variant} className="m-0 grid list-none justify-start p-0">
      <li className="grid gap-2">
        {variant === "tree" ? (
          <Branch head={kali} kids={path.roots} ctx={ctx} />
        ) : (
          <>
            {kali}
            {path.roots.length > 0 && <ListLevel kids={path.roots} ctx={ctx} />}
          </>
        )}
      </li>
    </ol>
  );
}
