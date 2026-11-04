import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { FindingInput } from "../../types/findings";

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
    remove: useMutation({ mutationFn: (id: string) => api.findingDelete(id), onSuccess: done }),
  };
}
