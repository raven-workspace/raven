import { create } from "zustand";
import { defaultCredFor, defaultDomainCred } from "../../engines/checklist";
import { credLabel } from "../../engines/credentials/labels";
import { newCredSince } from "../../engines/credentials/state";
import type { CredAttempt, Credential } from "../../types/credentials";
import type { Host } from "../../types/host";
import { useCredAttempts, useCredentials } from "../credentials/queries";

interface CredPickState {
  /** Per host: the picked credential id, or null for "none". A host with no entry uses the default. */
  picks: Record<string, string | null>;
  set: (hostId: string, credId: string | null) => void;
  reset: () => void;
}

/** The picker choice per host for this session. Cleared on lock (see VaultGate). */
export const useCredPickStore = create<CredPickState>()((set) => ({
  picks: {},
  set: (hostId, credId) => set((s) => ({ picks: { ...s.picks, [hostId]: credId } })),
  reset: () => set({ picks: {} }),
}));

export interface CredFill {
  credentials: Credential[];
  attempts: CredAttempt[];
  /** The credential commands are filled with: the pick, else the host's default. */
  cred: Credential | null;
  pick: (credId: string | null) => void;
}

/**
 * `owner` is a host, or the engagement itself for engagement goals (then pass `scope: "engagement"`: the default
 * is the newest working domain credential anywhere in the engagement).
 */
export function useCredFill(engagementId: string, owner: Pick<Host, "id">, scope: "host" | "engagement" = "host"): CredFill {
  const credentials = useCredentials(engagementId).data ?? [];
  const attempts = useCredAttempts(engagementId).data ?? [];
  const picked = useCredPickStore((s) => s.picks[owner.id]);
  const set = useCredPickStore((s) => s.set);
  const chosen = picked ? credentials.find((c) => c.id === picked) : undefined;
  // A picked credential that was deleted falls back to the default.
  const cred = picked === null ? null : (chosen ?? (scope === "host" ? defaultCredFor(owner, credentials, attempts) : defaultDomainCred(credentials, attempts)));
  return { credentials, attempts, cred, pick: (credId) => set(owner.id, credId) };
}

/** Labels of domain credentials created after the goal was completed; `credentials` are this engagement's. */
export const newCredLabels = (completedAt: number | undefined, credentials: Credential[]): string[] =>
  newCredSince(completedAt, credentials).map(credLabel);
