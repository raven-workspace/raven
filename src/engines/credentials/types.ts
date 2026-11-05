import type { AttemptResult, AttemptService, AuthMode } from "../../types/credentials";

/** The services nxc can test a credential against. A subset of the stored `AttemptService`. */
export type SprayService = Extract<
  AttemptService,
  "smb" | "winrm" | "rdp" | "mssql" | "ssh" | "ftp" | "ldap" | "wmi" | "vnc" | "nfs"
>;

/** Alias kept for UI code that names the matrix columns. */
export type CredService = SprayService;

export type CredAuthMode = AuthMode;
export type CredAttemptResult = AttemptResult;
