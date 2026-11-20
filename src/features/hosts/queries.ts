import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { hopsKey, tunnelsKey } from "../checklist/queries";
import { accessGrantsKey, credAttemptsKey, credentialsKey } from "../credentials/queries";
import { cleanupCountsKey, cleanupKey } from "../cleanup/queries";
import { failedAttemptsKey, findingsKey } from "../findings/queries";
import { resyncAndRefresh } from "../checklist/resync";
import { dropPendingNotes } from "../notes/useNotesStore";
import { invalidateRuledOut } from "../services/queries";
import type { BoardColumn, HostInput } from "../../types/host";
import type { HostIdentity, VectorInput, VectorStatus } from "../../types/hostFacts";
import { engagementKey, engagementsKey } from "../engagements/queries";
import { logKey } from "../log/queries";

export const hostsKey = (engagementId: string) => ["hosts", engagementId] as const;

export function useHosts(engagementId: string, enabled = true) {
  return useQuery({ queryKey: hostsKey(engagementId), queryFn: () => api.hostsList(engagementId), enabled });
}

/** Per-engagement host and flag counts, keyed by engagement id. */
export function useProgress() {
  return useQuery({ queryKey: ["progress"], queryFn: api.engagementsProgress });
}

export function useHostMutations(engagementId: string) {
  const qc = useQueryClient();
  const onSuccess = () => {
    void qc.invalidateQueries({ queryKey: hostsKey(engagementId) });
    void qc.invalidateQueries({ queryKey: ["progress"] });
    // Host facts (OS, IP) change applicability; a deleted host takes its checklist rows and services with it.
    void qc.invalidateQueries({ queryKey: ["checklist", engagementId] });
    void qc.invalidateQueries({ queryKey: ["services"] });
  };
  // OS and dual-homed change which goals apply, so the derived column can move. Not fatal: failures go to the
  // shared error path (a locked vault reaches the gate).
  const resync = () => {
    // Refetches the checklist and hosts again: the resync may have covered items or moved a derived column.
    void resyncAndRefresh(qc, engagementId);
  };
  return {
    create: useMutation({
      mutationFn: (input: HostInput) => api.hostCreate(engagementId, input),
      onSuccess: () => {
        onSuccess();
        resync();
      },
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: HostInput }) => api.hostUpdate(v.id, v.input),
      onSuccess: () => {
        onSuccess();
        resync();
      },
    }),
    move: useMutation({
      mutationFn: (v: { id: string; column: BoardColumn }) => api.hostMove(v.id, v.column),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.hostDelete(id),
      onSuccess: (_r, id) => {
        onSuccess();
        // Log entries lose the deleted host's link.
        void qc.invalidateQueries({ queryKey: logKey(engagementId) });
        // Attempts on it keep their record but lose the host.
        void qc.invalidateQueries({ queryKey: failedAttemptsKey(engagementId) });
        // Its credential test results and access grants go; credentials lose it as local or source host;
        // findings lose their link to it.
        void qc.invalidateQueries({ queryKey: credAttemptsKey(engagementId) });
        void qc.invalidateQueries({ queryKey: accessGrantsKey(engagementId) });
        void qc.invalidateQueries({ queryKey: credentialsKey(engagementId) });
        void qc.invalidateQueries({ queryKey: findingsKey(engagementId) });
        // Its note (thread counts) goes with it; unsaved text for it can never be saved.
        dropPendingNotes(engagementId, id);
        void qc.invalidateQueries({ queryKey: ["notes", engagementId] });
        // The Metasploit lock on it is cleared by the store; tunnels and hops through it go too.
        void qc.invalidateQueries({ queryKey: engagementKey(engagementId) });
        void qc.invalidateQueries({ queryKey: engagementsKey });
        void qc.invalidateQueries({ queryKey: tunnelsKey(engagementId) });
        void qc.invalidateQueries({ queryKey: hopsKey(engagementId) });
        // Its cleanup items lose the host.
        void qc.invalidateQueries({ queryKey: cleanupKey(engagementId) });
        void qc.invalidateQueries({ queryKey: cleanupCountsKey });
        // A deleted DC changes which hosts are AD hosts, and so other hosts' columns.
        resync();
      },
    }),
  };
}

export const hostIdentityKey = (hostId: string) => ["hostIdentity", hostId] as const;
export const vectorsKey = (hostId: string) => ["vectors", hostId] as const;

/** Who the user is on the host: the latest identity, or null before any is known. */
export function useHostIdentity(hostId: string) {
  return useQuery({ queryKey: hostIdentityKey(hostId), queryFn: () => api.hostIdentityGet(hostId) });
}

export function useVectors(hostId: string) {
  return useQuery({ queryKey: vectorsKey(hostId), queryFn: () => api.vectorsList(hostId) });
}

/** Identity and privesc vectors of one host. Ruling a vector out (or reopening it) writes or removes a ruled-out item. */
export function useHostFactsMutations(engagementId: string, hostId: string) {
  const qc = useQueryClient();
  const vectorsChanged = () => void qc.invalidateQueries({ queryKey: vectorsKey(hostId) });
  return {
    setIdentity: useMutation({
      mutationFn: (input: Omit<HostIdentity, "updatedAt">) => api.hostIdentitySet(input),
      onSuccess: () => void qc.invalidateQueries({ queryKey: hostIdentityKey(hostId) }),
    }),
    upsertVector: useMutation({
      mutationFn: (input: VectorInput) => api.vectorUpsert(hostId, input),
      onSuccess: () => {
        vectorsChanged();
        // Re-adding a ruled-out vector by hand reopens it, which removes its ruled-out item.
        invalidateRuledOut(qc, engagementId);
      },
    }),
    setVectorStatus: useMutation({
      mutationFn: (v: { id: string; status: VectorStatus; reason?: string }) => api.vectorSetStatus(v.id, v.status, v.reason),
      onSuccess: () => {
        vectorsChanged();
        invalidateRuledOut(qc, engagementId);
      },
    }),
    removeVector: useMutation({
      mutationFn: (id: string) => api.vectorDelete(id),
      onSuccess: () => {
        vectorsChanged();
        invalidateRuledOut(qc, engagementId);
      },
    }),
  };
}
