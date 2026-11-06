import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { defaultCredFor, portChoices, type FillInput } from "../../engines/checklist";
import { api } from "../../lib/api";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { useCredPickStore } from "../checklist/credPick";
import { engagementServicesKey, tunnelsKey } from "../checklist/queries";
import { credAttemptsKey, credentialsKey } from "../credentials/queries";

const NO_HOSTS: Host[] = [];
const DASHBOARD_ENGAGEMENT: Engagement = {
  id: "", name: "", kind: "lab", client: null, subLabel: null, scopeCidrs: [], domain: null, startsAt: null, endsAt: null,
  timeboxStart: null, timeboxMinutes: null, status: "active", createdAt: 0, updatedAt: 0, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const noHost = (engagementId: string): Host => ({
  id: "", engagementId, name: "", ip: null, os: null, boardColumn: "information-gathering", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 0, updatedAt: 0,
});

export function useEngagementFillData(engagementId: string) {
  const enabled = engagementId !== "";
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const engagement = useQuery({ queryKey: ["engagement", engagementId], queryFn: () => api.engagementGet(engagementId), enabled });
  const hosts = useQuery({ queryKey: ["hosts", engagementId], queryFn: () => api.hostsList(engagementId), enabled });
  const services = useQuery({ queryKey: engagementServicesKey(engagementId), queryFn: () => api.servicesListEngagement(engagementId), enabled });
  const tunnels = useQuery({ queryKey: tunnelsKey(engagementId), queryFn: () => api.tunnelsList(engagementId), enabled });
  const credentials = useQuery({ queryKey: credentialsKey(engagementId), queryFn: () => api.credentialsList(engagementId), enabled });
  const attempts = useQuery({ queryKey: credAttemptsKey(engagementId), queryFn: () => api.credAttemptsList(engagementId), enabled });
  const log = useQuery({ queryKey: ["log", engagementId], queryFn: () => api.logList(engagementId), enabled });
  return { settings: settings.data, engagement: engagement.data, hosts: hosts.data ?? NO_HOSTS, services: services.data, tunnels: tunnels.data, credentials: credentials.data, attempts: attempts.data, log: log.data };
}

/**
 * What filling a command for the host in view needs, shared by the palette, the Arsenal drawer and browse.
 * No host (the dashboard) fills nothing about a host: its tokens stay unresolved.
 */
export function useFillBase(engagementId: string, hostId: string | null) {
  const d = useEngagementFillData(engagementId);
  const picked = useCredPickStore((s) => (hostId ? s.picks[hostId] : undefined));
  const host = hostId ? d.hosts.find((h) => h.id === hostId) : undefined;
  const engagement = d.engagement ?? DASHBOARD_ENGAGEMENT;

  const cred = useMemo(() => {
    if (!host || !d.credentials) return null;
    if (picked === null) return null;
    return d.credentials.find((c) => c.id === picked) ?? defaultCredFor(host, d.credentials, d.attempts ?? []);
  }, [host, d.credentials, d.attempts, picked]);

  const makeInput = useCallback(
    (overrides: Record<string, string>): FillInput => {
      const servicesByHost = new Map<string, Service[]>();
      for (const s of d.services ?? []) servicesByHost.set(s.hostId, [...(servicesByHost.get(s.hostId) ?? []), s]);
      const input: FillInput = {
        host: host ?? noHost(engagementId), engagement, hosts: d.hosts, servicesByHost, tunnels: d.tunnels ?? [],
        attackerIp: d.settings?.attackerIp ?? "", kaliUser: d.settings?.kaliUser, listenerPort: d.settings?.listenerPort ?? "",
        cred: host ? cred : null,
        overrides,
      };
      const portHint = host ? portChoices(input) : [];
      if (portHint.length) input.portHint = portHint;
      return input;
    },
    [host, engagementId, engagement, d.hosts, d.services, d.tunnels, d.settings, cred],
  );

  return { d, host, engagement, loaded: d.engagement !== undefined, makeInput };
}
