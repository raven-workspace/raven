import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads, storeChanged } from "../../lib/storeChange";
import type { FailedAttemptInput, FindingFileInput, FindingInput } from "../../types/findings";
import { useFindingDraftStore } from "./useFindingDraftStore";

export const findingsKey = (eid: string) => ["findings", eid] as const;
export const findingFilesKey = (findingId: string) => ["finding-files", findingId] as const;
export const failedAttemptsKey = (eid: string) => ["failedAttempts", eid] as const;

registerReads(["findings"], ["finding"]);
registerReads(["finding-files"], ["findingFile"]);
registerReads(["failedAttempts"], ["failedAttempt"]);

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
  const done = (id: string, change: "created" | "updated" | "deleted") => void storeChanged(qc, { entity: "finding", id, change });
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
      onSuccess: (f) => {
        if (draftKey) useFindingDraftStore.getState().drop(draftKey);
        done(f.id, "created");
      },
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: FindingInput }) => api.findingUpdate(v.id, v.input),
      onError: failed,
      onSuccess: (_f, v) => {
        useFindingDraftStore.getState().dropFinding(v.id);
        done(v.id, "updated");
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.findingDelete(id),
      // Attempts that named the deleted finding lose the link; its files go.
      onSuccess: (_r, id) => done(id, "deleted"),
    }),
  };
}

/** One finding's files, as query options (the report reads every finding's). */
export const findingFilesQuery = (findingId: string) => ({ queryKey: findingFilesKey(findingId), queryFn: () => api.findingFilesList(findingId) });

export function useFindingFiles(findingId: string) {
  return useQuery(findingFilesQuery(findingId));
}

export function useFindingFileMutations(findingId: string) {
  const qc = useQueryClient();
  const done = (id: string, change: "created" | "updated" | "deleted") => void storeChanged(qc, { entity: "findingFile", id, change });
  return {
    create: useMutation({ mutationFn: (input: FindingFileInput) => api.findingFileCreate(findingId, input), onSuccess: (f) => done(f.id, "created") }),
    update: useMutation({
      mutationFn: (v: { id: string; input: FindingFileInput }) => api.findingFileUpdate(v.id, v.input),
      onSuccess: (_f, v) => done(v.id, "updated"),
    }),
    remove: useMutation({ mutationFn: (id: string) => api.findingFileDelete(id), onSuccess: (_r, id) => done(id, "deleted") }),
  };
}

export function useFailedAttempts(eid: string) {
  return useQuery({ queryKey: failedAttemptsKey(eid), queryFn: () => api.failedAttemptsList(eid) });
}

export function useFailedAttemptMutations(eid: string) {
  const qc = useQueryClient();
  const done = (id: string, change: "created" | "updated" | "deleted") => void storeChanged(qc, { entity: "failedAttempt", id, change });
  return {
    create: useMutation({ mutationFn: (input: FailedAttemptInput) => api.failedAttemptCreate(eid, input), onSuccess: (a) => done(a.id, "created") }),
    update: useMutation({
      mutationFn: (v: { id: string; input: FailedAttemptInput }) => api.failedAttemptUpdate(v.id, v.input),
      onSuccess: (_a, v) => done(v.id, "updated"),
    }),
    remove: useMutation({ mutationFn: (id: string) => api.failedAttemptDelete(id), onSuccess: (_r, id) => done(id, "deleted") }),
  };
}
