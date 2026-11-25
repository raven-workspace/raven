import {
  defaultHashType,
  usernameKey,
  type CredentialIntakePlan,
  type PlannedAttempt,
  type PlannedCredential,
} from "../../engines/credentials";
import { api } from "../../lib/api";
import type { CredAttempt, CredAttemptInput, Credential, CredentialInput, Username } from "../../types/credentials";

export interface IntakeContext {
  /** The saved entry: the proof of every recorded result. */
  logEntryId: string;
  /** The entry's time: every recorded result's time. */
  at: number;
  /** Keys of the pending credentials the operator accepted. */
  acceptKeys: string[];
  /** Told each row the store returns as it files it, so a caller can record exactly what was filed. */
  onFiled?: {
    credential?: (c: Credential) => void;
    /** Told the id of a stored credential an accepted pair or hash matched instead of adding (it may have been made earlier in this same save). */
    reused?: (id: string) => void;
    /** Told each username the store returns, a stored one included: the store decides whether it was listed. */
    username?: (u: Username) => void;
    attempts?: (rows: CredAttempt[]) => void;
  };
}

/** A stored credential as a full update input that changes nothing but what the caller overrides. */
function inputOf(c: Credential): CredentialInput {
  return {
    type: c.type, username: c.username, domain: c.domain, secret: c.secret, hashType: c.hashType, scope: c.scope,
    localHostId: c.localHostId, sourceHostId: c.sourceHostId, source: c.source, notes: c.notes,
    crackStatus: c.crackStatus, crackedFrom: c.crackedFrom, fromSecretId: c.fromSecretId,
  };
}

/** The plan names its engagement on every record; the api takes it as an argument. */
function withoutEngagement<T extends { engagementId: string }>(o: T): Omit<T, "engagementId"> {
  const copy: Partial<T> = { ...o };
  delete copy.engagementId;
  return copy as Omit<T, "engagementId">;
}

/**
 * Records a credential intake plan, with the saved entry as proof (spec: nxc intake). In order:
 *  1. the new usernames (their ids replace the plan's `usernameKey`s);
 *  2. the accepted pending credentials, reusing the stored one the store says is the same (and filling its empty
 *     `fromSecretId`);
 *  3. the plan's attempts;
 *  4. each accepted credential's own attempts, then the re-key of its username-spray results onto it; a declined
 *     one's `ifDeclined` attempts instead;
 *  5. the roast hashes (the store returns one it already holds);
 *  6. the plan's links, only where `fromSecretId` is empty.
 * Every write is idempotent (dedupe on create, no-downgrade upserts), so the same output saved twice adds nothing.
 */
export async function applyIntake(engagementId: string, plan: CredentialIntakePlan, ctx: IntakeContext): Promise<void> {
  const accepted = new Set(ctx.acceptKeys);
  // The panel's list may be stale: the links in step 6 read the store's.
  const credentials = await api.credentialsList(engagementId);

  // 1. Usernames. usernameCreate returns the stored row when the store holds the same username.
  const usernameIds = new Map<string, string>();
  for (const u of plan.newUsernames) {
    const created = await api.usernameCreate(engagementId, withoutEngagement(u));
    ctx.onFiled?.username?.(created);
    usernameIds.set(usernameKey({ ...u, domain: u.domain ?? null }), created.id);
    usernameIds.set(usernameKey(created), created.id);
  }
  const usernameIdOf = (ref: { usernameId?: string | null; usernameKey?: string }): string | undefined =>
    ref.usernameId ?? (ref.usernameKey ? usernameIds.get(ref.usernameKey) : undefined);

  const toInput = (a: PlannedAttempt): CredAttemptInput | null => {
    const usernameId = usernameIdOf(a);
    // Its username was not added: nothing to attach the result to.
    if (a.usernameKey && !usernameId) return null;
    return {
      credId: a.credId, usernameId: usernameId ?? null, hostId: a.hostId, service: a.service, port: a.port ?? null,
      result: a.result, authMode: a.authMode ?? "domain", detail: a.detail ?? null, logEntryId: ctx.logEntryId, at: ctx.at,
    };
  };
  const upsert = async (attempts: PlannedAttempt[]) => {
    const inputs = attempts.map(toInput).filter((i): i is CredAttemptInput => i !== null);
    if (inputs.length) ctx.onFiled?.attempts?.((await api.credAttemptsUpsert(engagementId, inputs)) ?? []);
  };

  /** Keeps the local list in step with what the store returned. */
  const remember = (c: Credential) => {
    const at = credentials.findIndex((x) => x.id === c.id);
    if (at === -1) credentials.push(c);
    else credentials[at] = c;
  };

  const addCredential = async (planned: PlannedCredential): Promise<string> => {
    const input: CredentialInput = withoutEngagement(planned);
    if (input.type === "hash" && !input.hashType) {
      const hashType = defaultHashType(input.secret ?? "");
      if (hashType) input.hashType = hashType;
    }
    // The store decides whether this is a credential it holds already.
    const { credential: stored, existed } = await api.credentialCreate(engagementId, input);
    if (!existed) {
      ctx.onFiled?.credential?.(stored);
      remember(stored);
      return stored.id;
    }
    ctx.onFiled?.reused?.(stored.id);
    remember(stored);
    // Reused for a spray hit: remember the owner-less secret it came from, never replacing a link.
    if (planned.fromSecretId && !stored.fromSecretId && planned.fromSecretId !== stored.id) {
      const updated = await api.credentialUpdate(stored.id, { ...inputOf(stored), fromSecretId: planned.fromSecretId });
      ctx.onFiled?.credential?.(updated);
      remember(updated);
    }
    return stored.id;
  };

  // 2. Accepted credentials.
  const credIds = new Map<string, string>();
  for (const p of plan.newCredentials) {
    if (accepted.has(p.key)) credIds.set(p.key, await addCredential(p.input));
  }

  // 3. The plan's attempts.
  await upsert(plan.attempts);

  // 4. Each pending credential's results: on the credential when accepted, username-subject when declined.
  for (const p of plan.newCredentials) {
    const credId = credIds.get(p.key);
    if (!credId) {
      await upsert(p.ifDeclined ?? []);
      continue;
    }
    await upsert(p.attempts.map((a) => ({ ...a, credId })));
    const from = p.fromUsername;
    const fromId = from && usernameIdOf(from);
    if (from && fromId) ctx.onFiled?.attempts?.((await api.credAttemptsRekey(fromId, from.secretCredIds, credId, from.hostId)) ?? []);
  }

  // 5. Roast hashes.
  for (const h of plan.newHashes) await addCredential(h);

  // 6. Links from owner-less secrets to stored credentials.
  for (const l of plan.links ?? []) {
    const c = credentials.find((x) => x.id === l.credId);
    if (!c || c.fromSecretId || l.fromSecretId === c.id) continue;
    const updated = await api.credentialUpdate(c.id, { ...inputOf(c), fromSecretId: l.fromSecretId });
    ctx.onFiled?.credential?.(updated);
    credentials[credentials.indexOf(c)] = updated;
  }
}
