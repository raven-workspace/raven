import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { hopsKey, tunnelsKey } from "../checklist/queries";
import { accessGrantsKey, credAttemptsKey, credentialsKey } from "../credentials/queries";
import { cleanupCountsKey, cleanupKey } from "../cleanup/queries";
import { findingsKey } from "../findings/queries";
import { resyncBoards } from "../checklist/ticks";
import { dropPendingNotes } from "../notes/useNotesStore";
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
      onSuccess: (_r, id) => {
        onSuccess();
        // Log entries lose the deleted host's link.
        void qc.invalidateQueries({ queryKey: ["log", engagementId] });
        // Attempts on it keep their record but lose the host.
        void qc.invalidateQueries({ queryKey: ["failedAttempts", engagementId] });
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
        void qc.invalidateQueries({ queryKey: ["engagement", engagementId] });
        void qc.invalidateQueries({ queryKey: ["engagements"] });
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
