import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { registerReads, storeChanged, type StoreChange } from "../../lib/storeChange";
import { resyncAndRefresh } from "../checklist/resync";
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
export const triedPairsKey = (eid: string) => ["triedPairs", eid] as const;
export const credAttemptsKey = (eid: string) => ["credAttempts", eid] as const;

registerReads(["credentials"], ["credential"]);
registerReads(["usernames"], ["username"]);
registerReads(["accessGrants"], ["accessGrant"]);
registerReads(["triedPairs"], ["triedPair"]);
registerReads(["credAttempts"], ["credAttempt"]);

/**
 * Reports the write, then re-derives what attempts and grants decide: an admin result on the DC covers privesc and
 * loot on domain-joined hosts (and its removal uncovers them), and an elevated grant moves its host to
 * Post-exploitation, which can move boards. Not fatal: a failure goes to the shared error path.
 */
function useChangedAndResync(eid: string) {
  const qc = useQueryClient();
  return (change: StoreChange) => {
    void storeChanged(qc, change);
    void resyncAndRefresh(qc, eid);
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
export function useCredAttempts(eid: string, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: credAttemptsKey(eid), queryFn: () => api.credAttemptsList(eid), enabled: opts.enabled });
}

export function useTriedPairs(eid: string) {
  return useQuery({ queryKey: triedPairsKey(eid), queryFn: () => api.triedPairsList(eid) });
}

/** Forgets one tried row: every tried pair for that username and secret, one delete each. */
export function useForgetTried() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.triedPairDelete(id);
    },
    // Settled: a failure part-way still shows what is left.
    onSettled: (_r, _e, ids) => void storeChanged(qc, ...ids.map((id) => ({ entity: "triedPair" as const, id, change: "deleted" as const }))),
  });
}

export function useCredentialMutations(eid: string) {
  const qc = useQueryClient();
  const changed = (id: string, change: StoreChange["change"]) => void storeChanged(qc, { entity: "credential", id, change });
  const changedAndResync = useChangedAndResync(eid);
  return {
    create: useMutation({
      mutationFn: (input: CredentialInput) => api.credentialCreate(eid, input),
      onSuccess: (r) => changed(r.credential.id, "created"),
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: CredentialInput }) => api.credentialUpdate(v.id, v.input),
      onSuccess: (_c, v) => changed(v.id, "updated"),
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.credentialDelete(id),
      onSuccess: (_r, id) => changedAndResync({ entity: "credential", id, change: "deleted" }),
    }),
    crack: useMutation({
      mutationFn: (v: { hashId: string; plaintext: string }) => api.credentialCrack(v.hashId, v.plaintext),
      onSuccess: (_pw, v) => changedAndResync({ entity: "credential", id: v.hashId, change: "cracked" }),
    }),
    setCrackStatus: useMutation({
      mutationFn: (v: { id: string; status: CrackStatus }) => api.credentialSetCrackStatus(v.id, v.status),
      onSuccess: (_c, v) => changed(v.id, "updated"),
    }),
    convert: useMutation({
      mutationFn: (v: { credId: string; grant: AccessGrantInput }) => api.credentialConvertToAccess(v.credId, v.grant),
      onSuccess: (_u, v) => changedAndResync({ entity: "credential", id: v.credId, change: "converted" }),
    }),
  };
}

export function useUsernameMutations(eid: string) {
  const qc = useQueryClient();
  const changedAndResync = useChangedAndResync(eid);
  return {
    create: useMutation({
      mutationFn: (input: UsernameInput) => api.usernameCreate(eid, input),
      onSuccess: (u) => void storeChanged(qc, { entity: "username", id: u.id, change: "created" }),
    }),
    // A username's grants and attempts go with it.
    remove: useMutation({
      mutationFn: (id: string) => api.usernameDelete(id),
      onSuccess: (_r, id) => changedAndResync({ entity: "username", id, change: "deleted" }),
    }),
  };
}

/** An elevated grant moves its host to Post-exploitation (and removing it lets the host fall back), so each change re-syncs the board. */
export function useAccessGrantMutations(eid: string) {
  const changedAndResync = useChangedAndResync(eid);
  return {
    create: useMutation({
      mutationFn: (v: { usernameId: string; grant: AccessGrantInput }) =>
        api.accessGrantCreate(eid, { ...v.grant, usernameId: v.usernameId }),
      onSuccess: (g) => changedAndResync({ entity: "accessGrant", id: g.id, change: "created" }),
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.accessGrantDelete(id),
      onSuccess: (_r, id) => changedAndResync({ entity: "accessGrant", id, change: "deleted" }),
    }),
  };
}

/** Hand-set cell results: the attempts drive every cell and state chip. */
export function useCredAttemptMutations(eid: string) {
  const changedAndResync = useChangedAndResync(eid);
  return {
    upsert: useMutation({
      mutationFn: (input: CredAttemptInput) => api.credAttemptsUpsert(eid, [input]),
      onSuccess: (saved) => changedAndResync({ entity: "credAttempt", id: saved[0]?.id ?? "", change: "updated" }),
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.credAttemptDelete(id),
      onSuccess: (_r, id) => changedAndResync({ entity: "credAttempt", id, change: "deleted" }),
    }),
  };
}
