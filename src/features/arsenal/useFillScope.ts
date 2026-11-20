import { useEffect } from "react";
import { useMatch } from "react-router";
import { create } from "zustand";
import { useEngagements } from "../engagements/queries";

interface LastEngagement {
  /** The engagement last open in the route, so full-screen Arsenal can keep filling for it. */
  engagementId: string | null;
  hostId: string | null;
}

export const useLastEngagementStore = create<LastEngagement>()(() => ({ engagementId: null, hostId: null }));

export interface FillScope {
  /** "" when nothing applies (the dashboard, settings). */
  engagementId: string;
  hostId: string | null;
  /** True on /arsenal, /payloads and /manual: the engagement is the remembered one, not the route's, so the chip names it. */
  remembered: boolean;
  /** True while the engagement is still being decided (on /arsenal, /payloads or /manual, until the engagement list has loaded). */
  pending?: boolean;
}

/**
 * Which engagement and host the palette, drawers, browse and Workbench fill for. In an engagement: the route's. On the
 * full-screen views (`/arsenal`, `/payloads`, `/manual`):
 * the engagement (and host) you came from, else the most recently active one. Elsewhere: none.
 */
export function useFillScope(): FillScope {
  const hostMatch = useMatch("/e/:id/h/:hostId");
  const engMatch = useMatch("/e/:id/*");
  const onArsenal = useMatch("/arsenal") !== null;
  const onManual = useMatch("/manual/*") !== null;
  const onFull = useMatch("/payloads") !== null || onManual || onArsenal;
  const routeEngagement = hostMatch?.params.id ?? engMatch?.params.id ?? "";
  const routeHost = hostMatch?.params.hostId ?? null;
  const last = useLastEngagementStore();

  useEffect(() => {
    if (routeEngagement) useLastEngagementStore.setState({ engagementId: routeEngagement, hostId: routeHost });
  }, [routeEngagement, routeHost]);

  const engagements = useEngagements(onFull);

  if (routeEngagement) return { engagementId: routeEngagement, hostId: routeHost, remembered: false };
  if (!onFull) return { engagementId: "", hostId: null, remembered: false };
  // Wait for the list, so a remembered engagement that is gone (deleted, or replaced by a restore) is never queried.
  if (!engagements.data) return { engagementId: "", hostId: null, remembered: true, pending: true };
  if (last.engagementId && engagements.data.some((e) => e.id === last.engagementId)) {
    return { engagementId: last.engagementId, hostId: last.hostId, remembered: true };
  }
  const active = engagements.data
    .filter((e) => e.status === "active")
    .sort((a, b) => (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt))[0];
  return { engagementId: active?.id ?? "", hostId: null, remembered: true };
}
