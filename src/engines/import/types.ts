// Minimal typed views of the old-Raven (pwndash) backup shapes the importer reads.
// Field names match the old types; everything the importer does not need is omitted.
import type { EngagementKind } from "../../types/engagement";

export type OldEngagementKind = "challenge-lab" | "exam-sim" | "real";

/** challenge-lab or unset -> lab, real -> client, exam-sim -> exam-sim. */
export function engagementKindFor(old: OldEngagementKind | string | undefined | null): EngagementKind {
  if (old === "real") return "client";
  if (old === "exam-sim") return "exam-sim";
  return "lab";
}

export interface OldLogBlock { command: string; output: string; shell?: string }

export interface OldLogEntry {
  id: string;
  title: string;
  tool: string;
  at: number;
  updatedAt: number;
  ranOn?: string;
  hostIds: string[];
  credIds: string[];
  blocks: OldLogBlock[];
  observations?: string;
  outOfScopeIps?: string[];
}

export interface OldLabFinding {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  cvssScore?: number;
  cweCve?: string;
  affectedService?: string;
  repro?: string;
  remediation?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OldService {
  port: number;
  protocol: "tcp" | "udp";
  state: string;
  service: string;
  version?: string;
  cveNotes?: string;
}

export interface OldMachine {
  id: string;
  name: string;
  ip: string;
  extraIps?: string[];
  os: string;
  platform: "HTB" | "THM" | "OffSec" | "Custom";
  difficulty?: string;
  status?: string;
  tags: string[];
  labId?: string;
  isCustom?: boolean;
  engagementKind?: OldEngagementKind;
  domain?: string;
  vhosts?: string[];
  scope?: string[];
  dcHostId?: string;
  msfHostId?: string;
  openPorts?: number[];
  services?: OldService[];
  logEntries?: OldLogEntry[];
  findings?: OldLabFinding[];
  quickNotes?: string;
  nextMove?: string;
  userFlag?: string;
  rootFlag?: string;
  userPwnedAt?: string;
  rootPwnedAt?: string;
  createdAt: string;
  updatedAt: string;
  [extra: string]: unknown;
}

export interface OldAccessGrant {
  id: string;
  hostId: string;
  level: "user" | "admin" | "system";
  via: string;
  at: string;
  logEntryId?: string;
}

export interface OldCredential {
  id: string;
  type: "password" | "hash" | "ticket" | "key" | "token" | "other";
  username: string;
  secret: string;
  createdAt: string;
  domain?: string;
  hashType?: string;
  sourceMachineId?: string;
  notes?: string;
  redacted?: true;
  engagementId?: string;
  scope?: "domain" | "local" | "app";
  localHostId?: string;
  source?: string;
  crackStatus?: "uncracked" | "cracked" | "uncrackable";
  crackedFrom?: string;
  fromSecretId?: string;
}

export interface OldCredAttempt {
  id: string;
  credId: string;
  machineId: string;
  service: string;
  port?: number;
  result: "admin" | "valid" | "failed" | "errored";
  at: string;
  authMode: "domain" | "local";
  usernameId?: string;
  logEntryId?: string;
  logContainerId?: string;
  detail?: string;
}

export interface OldUsername {
  id: string;
  username: string;
  createdAt: string;
  engagementId?: string;
  domain?: string;
  sourceMachineId?: string;
  source?: string;
  access?: OldAccessGrant[];
}

export interface OldImage { id: string; mime: string; data: string }

export interface OldBackup {
  version: "2.0.0" | "3.0.0" | string;
  exportedAt?: string;
  machines: OldMachine[];
  credentials?: OldCredential[];
  credAttempts?: OldCredAttempt[];
  usernames?: OldUsername[];
  lootItems?: unknown[];
  indexedDb?: { images?: OldImage[] };
  [extra: string]: unknown;
}

export interface ImportCandidate {
  id: string;
  name: string;
  kind: "lab" | "standalone";
  engagementKind: EngagementKind;
  hostCount: number;
  logCount: number;
  firstAt: number | null;
  lastAt: number | null;
  createdAt: number;
}
