import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type {
  AccessGrantInput,
  CrackStatus,
  CredentialInput,
  UsernameInput,
} from "../../types/credentials";

export const credentialsKey = (eid: string) => ["credentials", eid] as const;
export const usernamesKey = (eid: string) => ["usernames", eid] as const;
export const accessGrantsKey = (eid: string) => ["accessGrants", eid] as const;
export const credAttemptsKey = (eid: string) => ["credAttempts", eid] as const;

export function useCredentials(eid: string) {
  return useQuery({ queryKey: credentialsKey(eid), queryFn: () => api.credentialsList(eid) });
}
export function useUsernames(eid: string) {
  return useQuery({ queryKey: usernamesKey(eid), queryFn: () => api.usernamesList(eid) });
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
  const attempts = credAttemptsKey(eid);
  return {
    create: useMutation({ mutationFn: (input: CredentialInput) => api.credentialCreate(eid, input), onSuccess: inv(creds) }),
    update: useMutation({
      mutationFn: (v: { id: string; input: CredentialInput }) => api.credentialUpdate(v.id, v.input),
      onSuccess: inv(creds),
    }),
    remove: useMutation({ mutationFn: (id: string) => api.credentialDelete(id), onSuccess: inv(creds, attempts) }),
    crack: useMutation({
      mutationFn: (v: { hashId: string; plaintext: string }) => api.credentialCrack(v.hashId, v.plaintext),
      onSuccess: inv(creds, attempts),
    }),
    setCrackStatus: useMutation({
      mutationFn: (v: { id: string; status: CrackStatus }) => api.credentialSetCrackStatus(v.id, v.status),
      onSuccess: inv(creds),
    }),
    convert: useMutation({
      mutationFn: (v: { credId: string; grant: AccessGrantInput }) => api.credentialConvertToAccess(v.credId, v.grant),
      onSuccess: inv(creds, usernamesKey(eid), accessGrantsKey(eid), attempts),
    }),
  };
}

export function useUsernameMutations(eid: string) {
  const qc = useQueryClient();
  const inv = (...keys: (readonly unknown[])[]) => () => {
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
  };
  return {
    create: useMutation({ mutationFn: (input: UsernameInput) => api.usernameCreate(eid, input), onSuccess: inv(usernamesKey(eid)) }),
    // A username's grants and attempts go with it.
    remove: useMutation({
      mutationFn: (id: string) => api.usernameDelete(id),
      onSuccess: inv(usernamesKey(eid), accessGrantsKey(eid), credAttemptsKey(eid)),
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
