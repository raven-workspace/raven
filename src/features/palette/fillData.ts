import { useCallback, useMemo } from "react";
import { portChoices, resolveCred, type FillInput } from "../../engines/checklist";
import { examScope } from "../../engines/exam";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import { useCredPickStore } from "../checklist/credPick";
import { useTunnels } from "../network/queries";
import { useEngagementServices } from "../services/queries";
import { useCredAttempts, useCredentials } from "../credentials/queries";
import { useFillScope } from "../arsenal/useFillScope";
import { useSettings, settingsFill } from "../settings/queries";
import { useEngagement } from "../engagements/queries";
import { useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { blankHost } from "../hosts/blankHost";
import { servicesByHostOf } from "../checklist/state";

const NO_HOSTS: Host[] = [];
const DASHBOARD_ENGAGEMENT: Engagement = {
  id: "", name: "", kind: "lab", client: null, subLabel: null, scopeCidrs: [], domain: null, startsAt: null, endsAt: null,
  timeboxStart: null, timeboxMinutes: null, status: "active", createdAt: 0, updatedAt: 0, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};

export function useEngagementFillData(engagementId: string) {
  const enabled = engagementId !== "";
  const settings = useSettings();
  const engagement = useEngagement(engagementId, enabled);
  const hosts = useHosts(engagementId, enabled);
  const services = useEngagementServices(engagementId, enabled).query;
  const tunnels = useTunnels(engagementId, enabled).query;
  const credentials = useCredentials(engagementId, { enabled });
  const attempts = useCredAttempts(engagementId, { enabled });
  const log = useLog(engagementId, enabled);
  // A failed hosts load is not "no hosts": host pickers say so and offer this retry.
  const hostsError: HostsError | null = hosts.isError ? { retry: () => void hosts.refetch() } : null;
  return { settings: settings.data, engagement: engagement.data, hosts: hosts.data ?? NO_HOSTS, hostsError, services: services.data, tunnels: tunnels.data, credentials: credentials.data, attempts: attempts.data, log: log.data };
}

/** The engagement's hosts failed to load; `retry` refetches them. */
export interface HostsError {
  retry: () => void;
}

/**
 * What filling a command for the host in view needs, shared by the palette, the Arsenal drawer and browse.
 * No host (the dashboard) fills nothing about a host: its tokens stay unresolved.
 */
export function useFillBase(engagementId: string, hostId: string | null) {
  const d = useEngagementFillData(engagementId);
  const scopePending = useFillScope().pending === true;
  // The pick is keyed by the host, or by the engagement when there is no host (shared with the engagement checklist).
  const credOwnerId = hostId ?? engagementId;
  const picked = useCredPickStore((s) => s.picks[credOwnerId]);
  const host = hostId ? d.hosts.find((h) => h.id === hostId) : undefined;
  const engagement = d.engagement ?? DASHBOARD_ENGAGEMENT;

  const cred = useMemo(() => {
    if (!d.credentials || (!host && !engagementId)) return null;
    return resolveCred(picked, d.credentials, d.attempts ?? [], host ?? null);
  }, [host, engagementId, d.credentials, d.attempts, picked]);

  const makeInput = useCallback(
    (overrides: Record<string, string>): FillInput => {
      const servicesByHost = servicesByHostOf(d.services ?? []);
      const input: FillInput = {
        host: host ?? blankHost(engagementId), engagement, hosts: d.hosts, servicesByHost, tunnels: d.tunnels ?? [],
        ...settingsFill(d.settings),
        cred,
        overrides,
      };
      const portHint = host ? portChoices(input) : [];
      if (portHint.length) input.portHint = portHint;
      return input;
    },
    [host, engagementId, engagement, d.hosts, d.services, d.tunnels, d.settings, cred],
  );

  // Exam rules fail closed: until the engagement (so its kind) is known, nothing that could be banned is shown.
  const examReady = !scopePending && (engagementId === "" || d.engagement !== undefined);
  // The one exam scope every surface judges commands in (pending until the engagement's kind is known).
  const hostKey = host?.id ?? null;
  const exam = useMemo(
    () => examScope(examReady ? engagement : undefined, hostKey),
    [examReady, engagement, hostKey],
  );
  return { d, host, engagement, cred, credOwnerId, loaded: d.engagement !== undefined, examReady, exam, makeInput };
}
