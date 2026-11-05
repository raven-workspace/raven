import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { reportError } from "../../lib/lockSignal";
import { checklistKey } from "../checklist/queries";
import { resyncBoards } from "../checklist/ticks";
import type {
  AccessGrantInput,
  CredAttemptInput,
  CrackStatus,
  CredentialInput,
  UsernameInput,
} from "../../types/credentials";

export const credentialsKey = (eid: string) => ["credentials", eid] as const;
export const usernamesKey = (eid: string) => ["usernames", eid] as const;
export const accessGrantsKey = (eid: string) => ["accessGrants", eid] as const;
export const credAttemptsKey = (eid: string) => ["credAttempts", eid] as const;

/**
 * Invalidates the attempts, then re-derives what they decide: an admin result on the DC covers privesc and loot on
 * domain-joined hosts (and its removal uncovers them), which can move boards. Not fatal: a failure goes to the shared
 * error path.
 */
function useAttemptsChanged(eid: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: credAttemptsKey(eid) });
    void resyncBoards(eid).then(() => {
      void qc.invalidateQueries({ queryKey: checklistKey(eid) });
      void qc.invalidateQueries({ queryKey: ["hosts", eid] });
    }, reportError);
  };
}

/** `enabled: false` reads nothing until the caller needs the list. */
export function useCredentials(eid: string, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: credentialsKey(eid), queryFn: () => api.credentialsList(eid), enabled: opts.enabled });
}
export function useUsernames(eid: string, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: usernamesKey(eid), queryFn: () => api.usernamesList(eid), enabled: opts.enabled });
}
export function useAccessGrants(eid: string) {
  return useQuery({ queryKey: accessGrantsKey(eid), queryFn: () => api.accessGrantsList(eid) });
}
export function useCredAttempts(eid: string) {
  return useQuery({ queryKey: credAttemptsKey(eid), queryFn: () => api.credAttemptsList(eid) });
}

/** Every mutation invalidates its own key, plus attempts when they may change. */
export function useCredentialMutations(eid: string) {
  const qc = useQueryClient();
  const inv = (...keys: (readonly unknown[])[]) => () => {
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  };
  const creds = credentialsKey(eid);
  const attemptsChanged = useAttemptsChanged(eid);
  const withAttempts = (...keys: (readonly unknown[])[]) => () => {
    inv(...keys)();
    attemptsChanged();
  };
  return {
    create: useMutation({ mutationFn: (input: CredentialInput) => api.credentialCreate(eid, input), onSuccess: inv(creds) }),
    update: useMutation({
      mutationFn: (v: { id: string; input: CredentialInput }) => api.credentialUpdate(v.id, v.input),
      onSuccess: inv(creds),
    }),
    remove: useMutation({ mutationFn: (id: string) => api.credentialDelete(id), onSuccess: withAttempts(creds) }),
    crack: useMutation({
      mutationFn: (v: { hashId: string; plaintext: string }) => api.credentialCrack(v.hashId, v.plaintext),
      onSuccess: withAttempts(creds),
    }),
    setCrackStatus: useMutation({
      mutationFn: (v: { id: string; status: CrackStatus }) => api.credentialSetCrackStatus(v.id, v.status),
      onSuccess: inv(creds),
    }),
    convert: useMutation({
      mutationFn: (v: { credId: string; grant: AccessGrantInput }) => api.credentialConvertToAccess(v.credId, v.grant),
      onSuccess: withAttempts(creds, usernamesKey(eid), accessGrantsKey(eid)),
    }),
  };
}

export function useUsernameMutations(eid: string) {
  const qc = useQueryClient();
  const attemptsChanged = useAttemptsChanged(eid);
  const inv = (...keys: (readonly unknown[])[]) => () => {
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  };
  return {
    create: useMutation({ mutationFn: (input: UsernameInput) => api.usernameCreate(eid, input), onSuccess: inv(usernamesKey(eid)) }),
    // A username's grants and attempts go with it.
    remove: useMutation({
      mutationFn: (id: string) => api.usernameDelete(id),
      onSuccess: () => {
        inv(usernamesKey(eid), accessGrantsKey(eid))();
        attemptsChanged();
      },
    }),
  };
}

export function useAccessGrantMutations(eid: string) {
  const qc = useQueryClient();
  const onSuccess = () => void qc.invalidateQueries({ queryKey: accessGrantsKey(eid) });
  return {
    create: useMutation({
      mutationFn: (v: { usernameId: string; grant: AccessGrantInput }) =>
        api.accessGrantCreate(eid, { ...v.grant, usernameId: v.usernameId }),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.accessGrantDelete(id), onSuccess }),
  };
}

/** Hand-set cell results. Both invalidate the attempts, which drive every cell and state chip. */
export function useCredAttemptMutations(eid: string) {
  const onSuccess = useAttemptsChanged(eid);
  return {
    upsert: useMutation({ mutationFn: (input: CredAttemptInput) => api.credAttemptsUpsert(eid, [input]), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api.credAttemptDelete(id), onSuccess }),
  };
}
