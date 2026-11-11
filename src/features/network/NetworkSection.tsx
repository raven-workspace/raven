import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { buildPath, type NetworkPath } from "../../engines/network/path";
import { api } from "../../lib/api";
import { useWidth } from "../../lib/useWidth";
import type { Host } from "../../types/host";
import type { Hop, Tunnel } from "../../types/network";
import { Button, labelClass, queryState } from "../../ui";
import { useHops, useTunnels } from "../checklist/queries";
import { useHosts } from "../hosts/queries";
import { HopForm } from "./HopForm";
import { HostNode, PathTree, type NodeContext } from "./PathTree";
import { TunnelForm } from "./TunnelForm";

/** Room one hop depth needs in the tree (node plus edge). Narrower than (columns + Kali) of these: the indented list. */
const COLUMN_PX = 240;
/** How long an arrival's node keeps its accent outline. */
const FOCUS_MS = 2000;

type Dialog =
  | { kind: "hop"; hop?: Hop }
  | { kind: "tunnel"; tunnel?: Tunnel; viaHostId?: string };

/**
 * The attack path: Kali, then hosts by hop depth, the hops as labelled edges and tunnels as badges on their pivots,
 * with the hosts not yet reached in a tray below. Under 1000px (or whenever the tree is wider than the pane) the same
 * path reads as an indented list.
 */
export function NetworkSection() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const hostsQ = useHosts(id);
  const { tunnels, query: tunnelsQ } = useTunnels(id);
  const { hops, query: hopsQ } = useHops(id);
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
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
  // remembered for this path, so the pane must grow past it before the tree is tried again (no flip-flopping).
  const pathRef = useRef<HTMLDivElement>(null);
  const [overflowAt, setOverflowAt] = useState<{ width: number; path: NetworkPath }>();
  const fits = width === undefined || width >= ((path?.columns ?? 0) + 1) * COLUMN_PX;
  const overflowed = !!overflowAt && overflowAt.path === path && width !== undefined && width <= overflowAt.width;
  const variant = fits && !overflowed ? "tree" : "list";
  useLayoutEffect(() => {
    const el = pathRef.current;
    if (variant !== "tree" || !el || width === undefined || !path) return;
    if (el.scrollWidth > el.clientWidth + 1) setOverflowAt({ width, path });
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
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
        <h3 className={`m-0 ${labelClass}`}>Network</h3>
        <Button onClick={() => setDialog({ kind: "hop" })}>Add hop</Button>
        <Button onClick={() => setDialog({ kind: "tunnel" })}>Add tunnel</Button>
      </div>

      <div ref={pathRef} className="grid gap-3 overflow-x-auto">
        <PathTree path={path} attackerIp={settings.data!.attackerIp.trim()} variant={variant} ctx={ctx} />
        {path.roots.length === 0 && <p className="m-0 text-meta text-muted-2">Your first foothold records your first hop.</p>}
      </div>

      {path.unreached.length > 0 && (
        <section aria-label="Not reached" className="grid gap-3">
          <h4 className={`m-0 ${labelClass}`}>Not reached</h4>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3 p-0">
            {path.unreached.map((h) => (
              <li key={h.id} className="grid">
                <HostNode host={h} ctx={ctx} dim />
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
