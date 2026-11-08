import {
  defaultHashType,
  findDuplicateCredential,
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

/** A planned credential as a stored one, so `findDuplicateCredential` (the one dedupe rule) applies to it. */
function asCredential(i: PlannedCredential): Credential {
  return {
    id: "", engagementId: i.engagementId, type: i.type, username: i.username ?? "", domain: i.domain ?? null,
    secret: i.secret ?? "", hashType: i.hashType ?? null, scope: i.scope ?? "domain", localHostId: i.localHostId ?? null,
    sourceHostId: i.sourceHostId ?? null, source: i.source ?? null, notes: i.notes ?? null,
    crackStatus: i.crackStatus ?? null, crackedFrom: i.crackedFrom ?? null, fromSecretId: i.fromSecretId ?? null,
    createdAt: 0, updatedAt: 0,
  };
}

/**
 * Records a credential intake plan, with the saved entry as proof (spec: nxc intake). In order:
 *  1. the new usernames (their ids replace the plan's `usernameKey`s);
 *  2. the accepted pending credentials, reusing a stored duplicate (and filling its empty `fromSecretId`);
 *  3. the plan's attempts;
 *  4. each accepted credential's own attempts, then the re-key of its username-spray results onto it; a declined
 *     one's `ifDeclined` attempts instead;
 *  5. the new roast hashes (deduped against the current list);
 *  6. the plan's links, only where `fromSecretId` is empty.
 * Every write is idempotent (dedupe on create, no-downgrade upserts), so the same output saved twice adds nothing.
 */
export async function applyIntake(engagementId: string, plan: CredentialIntakePlan, ctx: IntakeContext): Promise<void> {
  const accepted = new Set(ctx.acceptKeys);
  // The panel's list may be stale; dedupe against the store's.
  const credentials = await api.credentialsList(engagementId);

  // 1. Usernames. usernameCreate returns the stored row on a case-insensitive duplicate.
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

  const addCredential = async (planned: PlannedCredential): Promise<string> => {
    const existing = findDuplicateCredential(credentials, asCredential(planned));
    if (existing) {
      ctx.onFiled?.reused?.(existing.id);
      // Reused for a spray hit: remember the owner-less secret it came from, never replacing a link.
      if (planned.fromSecretId && !existing.fromSecretId && planned.fromSecretId !== existing.id) {
        const updated = await api.credentialUpdate(existing.id, { ...inputOf(existing), fromSecretId: planned.fromSecretId });
        ctx.onFiled?.credential?.(updated);
        credentials[credentials.indexOf(existing)] = updated;
      }
      return existing.id;
    }
    const input: CredentialInput = withoutEngagement(planned);
    if (input.type === "hash" && !input.hashType) {
      const hashType = defaultHashType(input.secret ?? "");
      if (hashType) input.hashType = hashType;
    }
    const created = await api.credentialCreate(engagementId, input);
    ctx.onFiled?.credential?.(created);
    if (!credentials.some((c) => c.id === created.id)) credentials.push(created);
    return created.id;
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
