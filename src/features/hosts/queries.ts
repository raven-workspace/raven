import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { resyncBoards } from "../checklist/ticks";
import type { BoardColumn, HostInput } from "../../types/host";

export function useHosts(engagementId: string) {
  return useQuery({ queryKey: ["hosts", engagementId], queryFn: () => api.hostsList(engagementId) });
}

/** Per-engagement host and flag counts, keyed by engagement id. */
export function useProgress() {
  return useQuery({ queryKey: ["progress"], queryFn: api.engagementsProgress });
}

export function useHostMutations(engagementId: string) {
  const qc = useQueryClient();
  const onSuccess = () => {
    void qc.invalidateQueries({ queryKey: ["hosts", engagementId] });
    void qc.invalidateQueries({ queryKey: ["progress"] });
    // Host facts (OS, IP) change applicability; a deleted host takes its checklist rows and services with it.
    void qc.invalidateQueries({ queryKey: ["checklist", engagementId] });
    void qc.invalidateQueries({ queryKey: ["services"] });
  };
  // OS and dual-homed change which goals apply, so the derived column can move. Not fatal: failures go to the
  // shared error path (a locked vault reaches the gate).
  const resync = () => {
    void resyncBoards(engagementId).then(
      // Refetch again: the resync may have moved a host's derived column after the first invalidation.
      () => qc.invalidateQueries({ queryKey: ["hosts", engagementId] }),
      reportError,
    );
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
      onSuccess: () => {
        onSuccess();
        // Log entries lose the deleted host's link.
        void qc.invalidateQueries({ queryKey: ["log", engagementId] });
      },
    }),
  };
}
