export type CredentialType = "password" | "hash" | "ticket" | "key" | "token" | "other";
export type CredentialScope = "domain" | "local" | "app";
export type CrackStatus = "uncracked" | "cracked" | "uncrackable";
export type AccessLevel = "user" | "admin" | "system";

/** Mirrors the Rust `Credential`. Timestamps are Unix milliseconds. */
export interface Credential {
  id: string;
  engagementId: string;
  type: CredentialType;
  username: string;
  domain: string | null;
  secret: string;
  hashType: string | null;
  scope: CredentialScope;
  /** Set iff scope is "local". */
  localHostId: string | null;
  sourceHostId: string | null;
  source: string | null;
  notes: string | null;
  crackStatus: CrackStatus | null;
  crackedFrom: string | null;
  fromSecretId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `CredentialInput` (create and full update). */
export interface CredentialInput {
  type: CredentialType;
  username?: string;
  domain?: string | null;
  secret?: string;
  /** Derived for hashes when absent (32 hex = NTLM, LM:NT = pwdump). */
  hashType?: string | null;
  /** Absent means "domain". */
  scope?: CredentialScope;
  /** Required iff scope is "local". */
  localHostId?: string | null;
  sourceHostId?: string | null;
  source?: string | null;
  notes?: string | null;
  /** Absent keeps the current value on update; a new hash starts "uncracked". */
  crackStatus?: CrackStatus | null;
  /** Absent keeps the current value on update. */
  crackedFrom?: string | null;
  /** Absent keeps the current value on update. */
  fromSecretId?: string | null;
}

/** Mirrors the Rust `Username`. */
export interface Username {
  id: string;
  engagementId: string;
  username: string;
  domain: string | null;
  sourceHostId: string | null;
  source: string | null;
  createdAt: number;
}

/** Mirrors the Rust `UsernameInput`. */
export interface UsernameInput {
  username: string;
  domain?: string | null;
  sourceHostId?: string | null;
  source?: string | null;
}

/** Mirrors the Rust `AccessGrant`. `logEntryId` is null when the proof entry was deleted. */
export interface AccessGrant {
  id: string;
  engagementId: string;
  usernameId: string;
  hostId: string;
  level: AccessLevel;
  via: string;
  logEntryId: string | null;
  at: number;
}

/** Mirrors the Rust `AccessGrantInput`. */
export interface AccessGrantInput {
  /** Ignored by credentialConvertToAccess, which derives the username from the credential. */
  usernameId?: string;
  hostId: string;
  level: AccessLevel;
  via: string;
  logEntryId?: string | null;
  /** Absent means now. */
  at?: number;
}
