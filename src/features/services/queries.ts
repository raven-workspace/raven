import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../lib/api";
import { registerReads, storeChanged } from "../../lib/storeChange";
import { reportError } from "../../lib/lockSignal";
import { syncChecklist } from "../checklist/sync";
import { servicesByHostOf } from "../checklist/state";
import type { ServiceVerdict } from "../../types/hostFacts";
import type { ConfirmInput, Service, ServiceInput } from "../../types/service";

const NO_SERVICES: Service[] = [];

export const engagementServicesKey = (engagementId: string) => ["services", "engagement", engagementId] as const;
const hostServicesKey = (hostId: string) => ["services", hostId] as const;

// Covers both the engagement-wide list and each host's.
registerReads(["services"], ["service"]);

/** Every service in the engagement, grouped by host (`servicesByHost` for applicability and ticks). */
export function useEngagementServices(engagementId: string, enabled = true) {
  const query = useQuery({
    queryKey: engagementServicesKey(engagementId),
    queryFn: () => api.servicesListEngagement(engagementId),
    enabled,
  });
  const services = query.data ?? NO_SERVICES;
  const servicesByHost = useMemo(() => servicesByHostOf(services), [services]);
  return { servicesByHost, services, query };
}

export function useServices(hostId: string) {
  return useQuery({ queryKey: hostServicesKey(hostId), queryFn: () => api.servicesList(hostId) });
}

export function useServiceMutations(engagementId: string, hostId: string) {
  const qc = useQueryClient();
  const changed = (id: string, change: "created" | "updated" | "deleted") => {
    void storeChanged(qc, { entity: "service", id, change });
    // A service (above all a confirmed identity) changes which goals apply, so the derived column can move.
    // Not fatal: a failure goes to the shared error path (a locked vault reaches the gate).
    void syncChecklist({ engagementId, change: { entity: "service", id, change }, qc }).catch(reportError);
  };
  return {
    create: useMutation({ mutationFn: (input: ServiceInput) => api.serviceCreate(hostId, input), onSuccess: (s) => changed(s.id, "created") }),
    update: useMutation({
      mutationFn: (v: { id: string; input: ServiceInput }) => api.serviceUpdate(v.id, v.input),
      onSuccess: (_s, v) => changed(v.id, "updated"),
    }),
    confirm: useMutation({
      mutationFn: (v: { id: string; input: ConfirmInput }) => api.serviceConfirm(v.id, v.input),
      onSuccess: (_s, v) => changed(v.id, "updated"),
    }),
    unconfirm: useMutation({ mutationFn: (id: string) => api.serviceUnconfirm(id), onSuccess: (_s, id) => changed(id, "updated") }),
    // Deleting a service also removes the ruled-out item its dead-end verdict made.
    remove: useMutation({ mutationFn: (id: string) => api.serviceDelete(id), onSuccess: (_r, id) => changed(id, "deleted") }),
    /** A verdict changes no goal: no checklist sync. A dead end writes a ruled-out item; the staleness map knows. */
    setVerdict: useMutation({
      mutationFn: (v: { id: string; verdict: ServiceVerdict | null; reason?: string }) => api.serviceSetVerdict(v.id, v.verdict, v.reason),
      onSuccess: (_s, v) => void storeChanged(qc, { entity: "service", id: v.id, change: "updated" }),
    }),
  };
}
