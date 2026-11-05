import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { FailedAttemptInput, FindingFileInput, FindingInput } from "../../types/findings";

export const findingsKey = (eid: string) => ["findings", eid] as const;

export function useFindings(eid: string) {
  return useQuery({ queryKey: findingsKey(eid), queryFn: () => api.findingsList(eid) });
}

export function useFindingMutations(eid: string) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: findingsKey(eid) });
  return {
    create: useMutation({ mutationFn: (input: FindingInput) => api.findingCreate(eid, input), onSuccess: done }),
    update: useMutation({
      mutationFn: (v: { id: string; input: FindingInput }) => api.findingUpdate(v.id, v.input),
      onSuccess: done,
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
