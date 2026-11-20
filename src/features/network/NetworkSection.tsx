import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { buildPath, type NetworkPath } from "../../engines/network/path";
import { cx } from "../../lib/cx";
import { useWidth } from "../../lib/useWidth";
import type { Host } from "../../types/host";
import type { Hop, Tunnel } from "../../types/network";
import { Button, labelClass, queryState } from "../../ui";
import { useHops, useTunnels } from "./queries";
import { useHosts } from "../hosts/queries";
import { HopForm } from "./HopForm";
import { CONNECTOR_PX, HostNode, NODE_MAX_PX, NODE_PX, PathTree, type NodeContext } from "./PathTree";
import { TunnelForm } from "./TunnelForm";
import { useSettings } from "../settings/queries";

/** How long an arrival's node keeps its accent outline. */
const FOCUS_MS = 2000;

type Dialog =
  | { kind: "hop"; hop?: Hop }
  | { kind: "tunnel"; tunnel?: Tunnel; viaHostId?: string };

/** The tree's narrowest width: one node per column (Kali plus each hop depth), a connector between columns. */
const treeWidth = (columns: number) => (columns + 1) * NODE_PX + columns * CONNECTOR_PX;

/** The shared node width: the pane's spare room goes to the nodes (up to NODE_MAX_PX), so fewer names and subnets truncate. */
const nodeWidth = (width: number | undefined, columns: number) =>
  width === undefined ? NODE_PX : Math.max(NODE_PX, Math.min(NODE_MAX_PX, Math.floor((width - columns * CONNECTOR_PX) / (columns + 1))));

/**
 * The attack path: Kali, then hosts by hop depth, each node saying how it was reached and carrying its tunnels, with
 * the hosts not yet reached in a tray below. When the section is narrower than the tree (`treeWidth`: four columns need
 * 952px), or the drawn tree still overflows it, the same path reads as an indented list.
 */
export function NetworkSection() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const hostsQ = useHosts(id);
  const { tunnels, query: tunnelsQ } = useTunnels(id);
  const { hops, query: hopsQ } = useHops(id);
  const settings = useSettings();
  const [dialog, setDialog] = useState<Dialog>();
  const [sectionRef, width] = useWidth();
  const rootRef = useRef<HTMLElement | null>(null);
  const setRoot = useCallback((el: HTMLElement | null) => {
    rootRef.current = el;
    return sectionRef(el);
  }, [sectionRef]);

  // A link in (a checklist chip, the stuck view) arrives with the host to focus. Each arrival is a fresh request; the
  // state is cleared so back/forward does not repeat it.
  const arrived = (location.state as { hostId?: string } | null)?.hostId;
  const [seenKey, setSeenKey] = useState<string>();
  const [focus, setFocus] = useState<{ hostId: string; n: number }>();
  if (arrived && location.key !== seenKey) {
    setSeenKey(location.key);
    setFocus({ hostId: arrived, n: (focus?.n ?? 0) + 1 });
  }
  useEffect(() => {
    if (arrived) void navigate(location.pathname, { replace: true, state: null });
  }, [arrived, location.pathname, navigate]);

  const hosts = hostsQ.data;
  const path = useMemo(() => (hosts ? buildPath(hosts, hops) : undefined), [hosts, hops]);
  const loaded = !!path && !!tunnelsQ.data && !!settings.data;

  // Tree when the estimate says it fits and, drawn, it really does; otherwise the list. The width it overflowed at is
  // remembered for this path and these tunnels, so the pane must grow past it before the tree is tried again (no flip-flopping).
  const pathRef = useRef<HTMLDivElement>(null);
  const [overflowAt, setOverflowAt] = useState<{ width: number; path: NetworkPath; tunnels: Tunnel[] }>();
  const fits = width === undefined || width >= treeWidth(path?.columns ?? 0);
  // Keyed on what is drawn: a new path or a changed tunnel list (a wide chip deleted) tries the tree again.
  const overflowed = !!overflowAt && overflowAt.path === path && overflowAt.tunnels === tunnels && width !== undefined && width <= overflowAt.width;
  const variant = fits && !overflowed ? "tree" : "list";
  useLayoutEffect(() => {
    const el = pathRef.current;
    if (variant !== "tree" || !el || width === undefined || !path) return;
    if (el.scrollWidth > el.clientWidth + 1) setOverflowAt({ width, path, tunnels });
  }, [variant, width, path, tunnels, settings.data]);

  useEffect(() => {
    if (!focus || !loaded) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-host-node="${CSS.escape(focus.hostId)}"]`);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    el?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    const t = setTimeout(() => setFocus(undefined), FOCUS_MS);
    return () => clearTimeout(t);
  }, [focus, loaded]);

  const state = queryState([hostsQ, tunnelsQ, hopsQ, settings], "the network");
  if (state || !loaded || !hosts) return state;

  const ctx: NodeContext = {
    engagementId: id,
    tunnelsVia: (hostId) => tunnels.filter((t) => t.viaHostId === hostId),
    focusedId: focus?.hostId,
    onEditHop: (hop) => setDialog({ kind: "hop", hop }),
    onEditTunnel: (tunnel) => setDialog({ kind: "tunnel", tunnel }),
    onNeedsTunnel: (host: Host) => setDialog({ kind: "tunnel", viaHostId: host.id }),
  };

  return (
    <section
      aria-label="Network"
      ref={setRoot}
      className="grid min-w-0 gap-6"
      style={{ "--node-w": `${nodeWidth(width, path.columns)}px` } as CSSProperties}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
        <h3 className={`m-0 ${labelClass}`}>Network</h3>
        <Button onClick={() => setDialog({ kind: "hop" })}>Add hop</Button>
        <Button onClick={() => setDialog({ kind: "tunnel" })}>Add tunnel</Button>
      </div>

      {/* 4px of room (padding, cancelled by the margin) so a focused node's outline is not clipped by the scroller. */}
      <div ref={pathRef} className="-m-1 grid gap-3 overflow-x-auto p-1">
        <PathTree path={path} attackerIp={settings.data!.attackerIp.trim()} variant={variant} ctx={ctx} />
        {path.roots.length === 0 && <p className="m-0 text-meta text-muted-2">Your first foothold records your first hop.</p>}
      </div>

      {path.unreached.length > 0 && (
        <section aria-label="Not reached" className="grid gap-3">
          <h4 className={`m-0 ${labelClass}`}>Not reached</h4>
          {/* Tree: the tree's node width. List: as wide as the list, so both end on the same edge. */}
          <ul className={cx("m-0 grid list-none gap-3 p-0", variant === "tree" ? "grid-cols-[repeat(auto-fill,var(--node-w))]" : "max-w-144 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]")}>
            {path.unreached.map((h) => (
              <li key={h.id} className="grid">
                <HostNode host={h} ctx={ctx} dim wide={variant === "list"} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog?.kind === "hop" && (
        <HopForm engagementId={id} hosts={hosts} hop={dialog.hop} onClose={() => setDialog(undefined)} />
      )}
      {dialog?.kind === "tunnel" && (
        <TunnelForm
          engagementId={id}
          hosts={hosts}
          tunnel={dialog.tunnel}
          initial={dialog.viaHostId ? { viaHostId: dialog.viaHostId } : undefined}
          onClose={() => setDialog(undefined)}
        />
      )}
    </section>
  );
}
