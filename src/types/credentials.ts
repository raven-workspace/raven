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

export type AttemptResult = "admin" | "valid" | "failed" | "errored";
export type AuthMode = "domain" | "local";
export type AttemptService =
  | "smb" | "winrm" | "rdp" | "mssql" | "ssh" | "ftp" | "ldap" | "wmi" | "vnc" | "nfs" | "http" | "kerberos" | "other";

/** Mirrors the Rust `CredAttempt`. `usernameId` is set when a bare username was tried with `credId`'s secret. */
export interface CredAttempt {
  id: string;
  engagementId: string;
  credId: string;
  usernameId: string | null;
  hostId: string;
  service: AttemptService;
  port: number | null;
  result: AttemptResult;
  authMode: AuthMode;
  detail: string | null;
  logEntryId: string | null;
  at: number;
}

/** Mirrors the Rust `CredAttemptInput`. Upserts never downgrade a recorded result. */
export interface CredAttemptInput {
  credId: string;
  usernameId?: string | null;
  hostId: string;
  service: AttemptService;
  port?: number | null;
  result: AttemptResult;
  /** Absent means domain. */
  authMode?: AuthMode;
  detail?: string | null;
  logEntryId?: string | null;
  /** Absent means now. */
  at?: number;
}

/** Mirrors the Rust `TriedPair`: a failed username + secret on a host/service. Never a credential. */
export interface TriedPair {
  id: string;
  engagementId: string;
  username: string;
  domain: string | null;
  secret: string;
  secretKind: 'password' | 'hash';
  hostId: string;
  service: string;
  authMode: AuthMode;
  logEntryId: string | null;
  at: number;
}

/** Mirrors the Rust `TriedPairInput`. Upserts are idempotent on the pair key (user and domain ignore case). */
export interface TriedPairInput {
  username: string;
  domain?: string | null;
  secret: string;
  secretKind: 'password' | 'hash';
  hostId: string;
  service: string;
  /** Absent means domain. */
  authMode?: AuthMode;
  logEntryId?: string | null;
  /** Absent means now. */
  at?: number;
}
