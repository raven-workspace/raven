import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads, storeChanged } from "../../lib/storeChange";
import { resyncAndRefresh } from "../checklist/resync";
import { dropPendingNotes } from "../notes/useNotesStore";
import type { BoardColumn, HostInput } from "../../types/host";
import type { HostIdentity, VectorInput, VectorStatus } from "../../types/hostFacts";

export const hostsKey = (engagementId: string) => ["hosts", engagementId] as const;
const progressKey = ["progress"] as const;
export const hostIdentityKey = (hostId: string) => ["hostIdentity", hostId] as const;
export const vectorsKey = (hostId: string) => ["vectors", hostId] as const;

// The store decides AD set membership from a host's services.
registerReads(["hosts"], ["host", "service"]);
// Hosts rooted and flags found: hosts, their flag entries, and services (an exam's AD set counts once).
registerReads(progressKey, ["engagement", "host", "logEntry", "service"]);
registerReads(["hostIdentity"], ["hostIdentity"]);
registerReads(["vectors"], ["vector"]);

export function useHosts(engagementId: string, enabled = true) {
  return useQuery({ queryKey: hostsKey(engagementId), queryFn: () => api.hostsList(engagementId), enabled });
}

/** Per-engagement host and flag counts, keyed by engagement id. */
export function useProgress() {
  return useQuery({ queryKey: progressKey, queryFn: api.engagementsProgress });
}

export function useHostMutations(engagementId: string) {
  const qc = useQueryClient();
  // OS and dual-homed change which goals apply, so the derived column can move. Not fatal: failures go to the
  // shared error path (a locked vault reaches the gate).
  const resync = () => void resyncAndRefresh(qc, engagementId);
  return {
    create: useMutation({
      mutationFn: (input: HostInput) => api.hostCreate(engagementId, input),
      onSuccess: (host) => {
        void storeChanged(qc, { entity: "host", id: host.id, change: "created" });
        resync();
      },
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: HostInput }) => api.hostUpdate(v.id, v.input),
      onSuccess: (_h, v) => {
        void storeChanged(qc, { entity: "host", id: v.id, change: "updated" });
        resync();
      },
    }),
    move: useMutation({
      mutationFn: (v: { id: string; column: BoardColumn }) => api.hostMove(v.id, v.column),
      onSuccess: (_h, v) => void storeChanged(qc, { entity: "host", id: v.id, change: "updated" }),
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.hostDelete(id),
      onSuccess: (_r, id) => {
        // Its note goes with it: unsaved text for it can never be saved.
        dropPendingNotes(engagementId, id);
        void storeChanged(qc, { entity: "host", id, change: "deleted" });
        // A deleted DC changes which hosts are AD hosts, and so other hosts' columns.
        resync();
      },
    }),
  };
}

/** Who the user is on the host: the latest identity, or null before any is known. */
export function useHostIdentity(hostId: string) {
  return useQuery({ queryKey: hostIdentityKey(hostId), queryFn: () => api.hostIdentityGet(hostId) });
}

export function useVectors(hostId: string) {
  return useQuery({ queryKey: vectorsKey(hostId), queryFn: () => api.vectorsList(hostId) });
}

/**
 * Identity and privesc vectors of one host. Ruling a vector out (or reopening it, or re-adding it by hand) writes or
 * removes its ruled-out item; the staleness map knows.
 */
export function useHostFactsMutations(hostId: string) {
  const qc = useQueryClient();
  const vector = (id: string, change: "created" | "updated" | "deleted") => void storeChanged(qc, { entity: "vector", id, change });
  return {
    setIdentity: useMutation({
      mutationFn: (input: Omit<HostIdentity, "updatedAt">) => api.hostIdentitySet(input),
      onSuccess: () => void storeChanged(qc, { entity: "hostIdentity", id: hostId, change: "updated" }),
    }),
    upsertVector: useMutation({
      mutationFn: (input: VectorInput) => api.vectorUpsert(hostId, input),
      onSuccess: (v) => vector(v.id, "created"),
    }),
    setVectorStatus: useMutation({
      mutationFn: (v: { id: string; status: VectorStatus; reason?: string }) => api.vectorSetStatus(v.id, v.status, v.reason),
      onSuccess: (_r, v) => vector(v.id, "updated"),
    }),
    removeVector: useMutation({
      mutationFn: (id: string) => api.vectorDelete(id),
      onSuccess: (_r, id) => vector(id, "deleted"),
    }),
  };
}
