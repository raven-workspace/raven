import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { FailedAttemptInput, FindingFileInput, FindingInput } from "../../types/findings";
import { useFindingDraftStore } from "./useFindingDraftStore";

export const findingsKey = (eid: string) => ["findings", eid] as const;

export function useFindings(eid: string) {
  return useQuery({ queryKey: findingsKey(eid), queryFn: () => api.findingsList(eid) });
}

/**
 * `draftKey` names the kept draft a create saves. It is dropped here, on the mutation itself, so it goes even when the
 * split unmounted mid-save (H, navigating away): `mutate`'s own callbacks never fire after an unmount, and a kept
 * `…:new` draft would let the next F + Save create the finding twice. An update drops every draft of its finding.
 */
export function useFindingMutations(eid: string, opts: { draftKey?: string } = {}) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: findingsKey(eid) });
  const { draftKey } = opts;
  // `mutate`'s own onError never fires once the form is gone, so a save that fails then is recorded here; a form still
  // mounted shows the error itself and clears this (`takeSaveError`).
  const failed = (e: Error) => {
    if (draftKey) useFindingDraftStore.getState().setSaveError(draftKey, e.message);
  };
  return {
    create: useMutation({
      mutationFn: (input: FindingInput) => api.findingCreate(eid, input),
      onError: failed,
      onSuccess: () => {
        if (draftKey) useFindingDraftStore.getState().drop(draftKey);
        done();
      },
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: FindingInput }) => api.findingUpdate(v.id, v.input),
      onError: failed,
      onSuccess: (_f, v) => {
        useFindingDraftStore.getState().dropFinding(v.id);
        done();
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.findingDelete(id),
      onSuccess: () => {
        done();
        // Attempts that named the deleted finding lose the link.
        void qc.invalidateQueries({ queryKey: failedAttemptsKey(eid) });
      },
    }),
  };
}

export const findingFilesKey = (findingId: string) => ["finding-files", findingId] as const;

export function useFindingFiles(findingId: string) {
  return useQuery({ queryKey: findingFilesKey(findingId), queryFn: () => api.findingFilesList(findingId) });
}

export function useFindingFileMutations(findingId: string) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: findingFilesKey(findingId) });
  return {
    create: useMutation({ mutationFn: (input: FindingFileInput) => api.findingFileCreate(findingId, input), onSuccess: done }),
    update: useMutation({
      mutationFn: (v: { id: string; input: FindingFileInput }) => api.findingFileUpdate(v.id, v.input),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.findingFileDelete(id), onSuccess: done }),
  };
}

export const failedAttemptsKey = (eid: string) => ["failedAttempts", eid] as const;

export function useFailedAttempts(eid: string) {
  return useQuery({ queryKey: failedAttemptsKey(eid), queryFn: () => api.failedAttemptsList(eid) });
}

export function useFailedAttemptMutations(eid: string) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: failedAttemptsKey(eid) });
  return {
    create: useMutation({ mutationFn: (input: FailedAttemptInput) => api.failedAttemptCreate(eid, input), onSuccess: done }),
    update: useMutation({
      mutationFn: (v: { id: string; input: FailedAttemptInput }) => api.failedAttemptUpdate(v.id, v.input),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.failedAttemptDelete(id), onSuccess: done }),
  };
}
