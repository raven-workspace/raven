import type { AttemptService, AuthMode } from "../../types/credentials";

/** The services nxc can test a credential against. A subset of the stored `AttemptService`. */
export type SprayService = Extract<
  AttemptService,
  "smb" | "winrm" | "rdp" | "mssql" | "ssh" | "ftp" | "ldap" | "wmi" | "vnc" | "nfs"
>;

export type CredAuthMode = AuthMode;
