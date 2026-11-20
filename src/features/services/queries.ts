import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../lib/api";
import { resyncAndRefresh } from "../checklist/resync";
import { servicesByHostOf } from "../checklist/state";
import type { ServiceVerdict } from "../../types/hostFacts";
import type { ConfirmInput, Service, ServiceInput } from "../../types/service";

const NO_SERVICES: Service[] = [];

export const engagementServicesKey = (engagementId: string) => ["services", "engagement", engagementId] as const;

/** Ruled-out items and the notes that list them; a dead-end verdict or a ruled-out vector writes one. */
export function invalidateRuledOut(qc: QueryClient, engagementId: string) {
  void qc.invalidateQueries({ queryKey: ["ruledOut", engagementId] });
  void qc.invalidateQueries({ queryKey: ["notes", engagementId] });
  void qc.invalidateQueries({ queryKey: ["note", engagementId] });
}

/** Every service in the engagement, grouped by host (`servicesByHost` for applicability and ticks). */
export function useEngagementServices(engagementId: string) {
  const query = useQuery({
    queryKey: engagementServicesKey(engagementId),
    queryFn: () => api.servicesListEngagement(engagementId),
  });
  const services = query.data ?? NO_SERVICES;
  const servicesByHost = useMemo(() => servicesByHostOf(services), [services]);
  return { servicesByHost, services, query };
}

export function useServices(hostId: string) {
  return useQuery({ queryKey: ["services", hostId], queryFn: () => api.servicesList(hostId) });
}

export function useServiceMutations(engagementId: string, hostId: string) {
  const qc = useQueryClient();
  const onSuccess = () => {
    void qc.invalidateQueries({ queryKey: ["services", hostId] });
    // The engagement-wide list (`useEngagementServices`) holds this host's services too.
    void qc.invalidateQueries({ queryKey: ["services", "engagement"] });
    // Open 88 and 389 make a host part of the AD set, which changes exam-sim progress.
    void qc.invalidateQueries({ queryKey: ["progress"] });
    // A service (above all a confirmed identity) changes which goals apply, so the derived column can move.
    // Not fatal: a failure goes to the shared error path (a locked vault reaches the gate).
    void resyncAndRefresh(qc, engagementId);
  };
  return {
    create: useMutation({ mutationFn: (input: ServiceInput) => api.serviceCreate(hostId, input), onSuccess }),
    update: useMutation({
      mutationFn: (v: { id: string; input: ServiceInput }) => api.serviceUpdate(v.id, v.input),
      onSuccess,
    }),
    confirm: useMutation({
      mutationFn: (v: { id: string; input: ConfirmInput }) => api.serviceConfirm(v.id, v.input),
      onSuccess,
    }),
    unconfirm: useMutation({ mutationFn: (id: string) => api.serviceUnconfirm(id), onSuccess }),
    // Deleting a service also removes the ruled-out item its dead-end verdict made.
    remove: useMutation({
      mutationFn: (id: string) => api.serviceDelete(id),
      onSuccess: () => {
        onSuccess();
        invalidateRuledOut(qc, engagementId);
      },
    }),
    /** A verdict changes no goal: only the services and the ruled-out items (dead end creates one) refresh. */
    setVerdict: useMutation({
      mutationFn: (v: { id: string; verdict: ServiceVerdict | null; reason?: string }) => api.serviceSetVerdict(v.id, v.verdict, v.reason),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ["services", hostId] });
        void qc.invalidateQueries({ queryKey: ["services", "engagement"] });
        invalidateRuledOut(qc, engagementId);
      },
    }),
  };
}
