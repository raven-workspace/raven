import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { FieldManualSnapshot } from "../engines/fieldManual/merge";
import type { VaultFile } from "../types/fieldManual";
import type { BackupInfo } from "../types/backup";
import type { ImportPlan } from "../engines/import/plan";
import type { ImportSummary } from "../types/import";
import type { ConfirmInput, ScanPort, Service, ServiceInput } from "../types/service";
import type { GoalRef } from "../engines/checklist";
import type { ChecklistItem, ChecklistItemInput } from "../types/checklist";
import type { Attachment, LogEntry, LogEntryInput, Progress } from "../types/log";
import type {
  FailedAttempt,
  FailedAttemptInput,
  Finding,
  FindingFile,
  FindingFileInput,
  FindingInput,
  NvdRecord,
} from "../types/findings";
import type { CleanupInput, CleanupItem } from "../types/cleanup";
import type { HostIdentity, PrivescVector, ServiceVerdict, VectorInput, VectorStatus } from "../types/hostFacts";
import type { Note, RuledOut, RuledOutInput } from "../types/notes";
import type {
  AccessGrant,
  AccessGrantInput,
  Credential,
  CredAttempt,
  CredAttemptInput,
  CredentialInput,
  CrackStatus,
  Username,
  UsernameInput,
} from "../types/credentials";
import type { Hop, HopInput, Tunnel, TunnelInput } from "../types/network";
import type { Host, HostInput, BoardColumn } from "../types/host";
import type { Engagement, EngagementInput, EngagementStatus } from "../types/engagement";
import { RavenError } from "../types/errors";
import type { Settings, SettingsPatch } from "../types/settings";
import type { UnlockResult, VaultStatus } from "../types/vault";

/** Calls a Tauri command; any rejection becomes a `RavenError`. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (raw) {
    throw RavenError.from(raw);
  }
}

/** `obsidian://open` for a vault file: the vault is named by the last part of its folder, the file has no `.md`. */
export function obsidianUrl(vaultPath: string, file: string): string {
  const vault = vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file.replace(/\.md$/, ""))}`;
}

/** One function per Tauri command. Args are camelCase, as Tauri expects. */
export const api = {
  vaultStatus: () => call<VaultStatus>("vault_status"),
  vaultCreate: (password: string) => call<null>("vault_create", { password }),
  vaultUnlock: (password: string) => call<UnlockResult>("vault_unlock", { password }),
  vaultLock: () => call<null>("vault_lock"),

  settingsGet: () => call<Settings>("settings_get"),
  settingsUpdate: (patch: SettingsPatch) => call<Settings>("settings_update", { patch }),
  /** NIST NVD lookup, the one network call (runs in Rust; the key never reaches the webview).
   *  Rejects with `no_key`, `offline`, `key_rejected`, `not_found` or `validation`. */
  nvdLookup: (cveId: string) => call<NvdRecord>("nvd_lookup", { cveId }),

  backupNow: () => call<BackupInfo>("backup_now"),
  backupsList: () => call<BackupInfo[]>("backups_list"),
  /** Takes a `pre-import` backup, then adds the plan's records in one transaction. Existing rows are never
   *  changed; a dangling reference fails the whole import (validation) and nothing is written. */
  importApply: (plan: ImportPlan) => call<ImportSummary>("import_apply", { plan }),
  /** Reads the vault's Toolkit, playbooks and cards. Read-only; a missing folder is `not_found`. */
  fieldManualScan: (path: string) => call<VaultFile[]>("field_manual_scan", { path }),
  /** Newest modified time (ms) among the files a scan reads, or null when there are none. */
  fieldManualLatestMtime: (path: string) => call<number | null>("field_manual_latest_mtime", { path }),
  /** Replaces the stored snapshot of the last import. */
  fieldManualSave: (snapshot: FieldManualSnapshot) => call<null>("field_manual_save", { snapshot }),
  /** Opens a Field-Manual file in Obsidian; the opener plugin allows only `obsidian://` URLs. */
  openObsidian: async (file: string): Promise<void> => {
    const settings = await call<Settings>("settings_get");
    try {
      await openUrl(obsidianUrl(settings.fieldManualPath, file));
    } catch (raw) {
      throw RavenError.from(raw);
    }
  },
  fieldManualLoad: () => call<FieldManualSnapshot | null>("field_manual_load"),
  /** Restores a backup. The vault is left locked afterwards. */
  backupRestore: (file: string) => call<null>("backup_restore", { file }),
  /** Restores a backup while locked (the database is damaged). The vault stays locked. */
  backupRestoreLocked: (file: string, password: string) =>
    call<null>("backup_restore_locked", { file, password }),

  engagementsList: () => call<Engagement[]>("engagements_list"),
  engagementGet: (id: string) => call<Engagement>("engagement_get", { id }),
  engagementCreate: (input: EngagementInput) => call<Engagement>("engagement_create", { input }),
  engagementUpdate: (id: string, input: EngagementInput) =>
    call<Engagement>("engagement_update", { id, input }),
  engagementSetStatus: (id: string, status: EngagementStatus) =>
    call<Engagement>("engagement_set_status", { id, status }),
  engagementSetMsfHost: (engagementId: string, hostId: string | null) =>
    call<Engagement>("engagement_set_msf_host", { engagementId, hostId }),
  engagementDelete: (id: string) => call<null>("engagement_delete", { id }),

  hostsList: (engagementId: string) => call<Host[]>("hosts_list", { engagementId }),
  hostCreate: (engagementId: string, input: HostInput) =>
    call<Host>("host_create", { engagementId, input }),
  hostUpdate: (id: string, input: HostInput) => call<Host>("host_update", { id, input }),
  hostMove: (id: string, column: BoardColumn) => call<Host>("host_move", { id, column }),
  hostSyncBoard: (hostId: string, derived: BoardColumn) =>
    call<Host>("host_sync_board", { hostId, derived }),
  hostDelete: (id: string) => call<null>("host_delete", { id }),

  servicesList: (hostId: string) => call<Service[]>("services_list", { hostId }),
  servicesListEngagement: (engagementId: string) =>
    call<Service[]>("services_list_engagement", { engagementId }),
  servicesUpsertScan: (hostId: string, ports: ScanPort[]) =>
    call<Service[]>("services_upsert_scan", { hostId, ports }),
  serviceCreate: (hostId: string, input: ServiceInput) =>
    call<Service>("service_create", { hostId, input }),
  serviceUpdate: (id: string, input: ServiceInput) => call<Service>("service_update", { id, input }),
  serviceConfirm: (id: string, input: ConfirmInput) =>
    call<Service>("service_confirm", { id, input }),
  serviceUnconfirm: (id: string) => call<Service>("service_unconfirm", { id }),
  serviceDelete: (id: string) => call<null>("service_delete", { id }),
  /** `dead_end` needs a non-empty `reason` and adds a linked ruled-out item; leaving it removes that item. */
  serviceSetVerdict: (id: string, verdict: ServiceVerdict | null, reason?: string) =>
    call<Service>("service_set_verdict", { id, verdict, reason: reason ?? null }),
  hostIdentityGet: (hostId: string) => call<HostIdentity | null>("host_identity_get", { hostId }),
  hostIdentitySet: (input: Omit<HostIdentity, "updatedAt">) =>
    call<HostIdentity>("host_identity_set", { input: { ...input, updatedAt: 0 } }),
  vectorsList: (hostId: string) => call<PrivescVector[]>("vectors_list", { hostId }),
  /** An `auto` upsert never changes a vector the user set by hand. */
  vectorUpsert: (hostId: string, input: VectorInput) => call<PrivescVector>("vector_upsert", { hostId, input }),
  vectorSetStatus: (id: string, status: VectorStatus, reason?: string) =>
    call<PrivescVector>("vector_set_status", { id, status, reason: reason ?? null }),
  vectorDelete: (id: string) => call<null>("vector_delete", { id }),

  logList: (engagementId: string) => call<LogEntry[]>("log_list", { engagementId }),
  logCreate: (engagementId: string, input: LogEntryInput) =>
    call<LogEntry>("log_create", { engagementId, input }),
  logUpdate: (id: string, input: LogEntryInput) => call<LogEntry>("log_update", { id, input }),
  logDelete: (id: string) => call<null>("log_delete", { id }),
  checklistList: (engagementId: string) => call<ChecklistItem[]>("checklist_list", { engagementId }),
  checklistPut: (engagementId: string, items: ChecklistItemInput[]) =>
    call<ChecklistItem[]>("checklist_put", { engagementId, items }),
  /** The domain admin cover as conditional writes: a status set by hand is never overwritten. */
  checklistApplyCover: (engagementId: string, cover: GoalRef[], revert: GoalRef[]) =>
    call<ChecklistItem[]>("checklist_apply_cover", { engagementId, cover, revert }),
  /** Ticks driven by the host's own data (identified ports, OS) as conditional writes. */
  checklistApplyFacts: (engagementId: string, done: GoalRef[], revert: GoalRef[]) =>
    call<ChecklistItem[]>("checklist_apply_facts", { engagementId, done, revert }),
  notesGet: (engagementId: string, hostId: string | null) =>
    call<Note>("notes_get", { engagementId, hostId }),
  notesList: (engagementId: string) => call<Note[]>("notes_list", { engagementId }),
  noteSave: (engagementId: string, hostId: string | null, body: string, isPrivate: boolean) =>
    call<Note>("note_save", { engagementId, hostId, body, private: isPrivate }),
  ruledOutList: (engagementId: string) => call<RuledOut[]>("ruled_out_list", { engagementId }),
  ruledOutCreate: (input: RuledOutInput) => call<RuledOut>("ruled_out_create", { input }),
  ruledOutDelete: (id: string) => call<null>("ruled_out_delete", { id }),
  tunnelsList: (engagementId: string) => call<Tunnel[]>("tunnels_list", { engagementId }),
  tunnelCreate: (engagementId: string, input: TunnelInput) =>
    call<Tunnel>("tunnel_create", { engagementId, input }),
  tunnelUpdate: (id: string, input: TunnelInput) => call<Tunnel>("tunnel_update", { id, input }),
  tunnelDelete: (id: string) => call<null>("tunnel_delete", { id }),
  hopsList: (engagementId: string) => call<Hop[]>("hops_list", { engagementId }),
  hopCreate: (engagementId: string, input: HopInput) =>
    call<Hop>("hop_create", { engagementId, input }),
  hopUpdate: (id: string, input: HopInput) => call<Hop>("hop_update", { id, input }),
  hopDelete: (id: string) => call<null>("hop_delete", { id }),
  hostMarkAccessReviewed: (hostId: string) => call<Host>("host_mark_access_reviewed", { hostId }),
  credentialsList: (engagementId: string) => call<Credential[]>("credentials_list", { engagementId }),
  credentialCreate: (engagementId: string, input: CredentialInput) =>
    call<Credential>("credential_create", { engagementId, input }),
  credentialUpdate: (id: string, input: CredentialInput) =>
    call<Credential>("credential_update", { id, input }),
  credentialDelete: (id: string) => call<null>("credential_delete", { id }),
  credentialCrack: (hashId: string, plaintext: string) =>
    call<Credential>("credential_crack", { hashId, plaintext }),
  credentialSetCrackStatus: (id: string, status: CrackStatus) =>
    call<Credential>("credential_set_crack_status", { id, status }),
  credentialConvertToAccess: (credId: string, grant: AccessGrantInput) =>
    call<Username>("credential_convert_to_access", { credId, grant }),
  usernamesList: (engagementId: string) => call<Username[]>("usernames_list", { engagementId }),
  usernameCreate: (engagementId: string, input: UsernameInput) =>
    call<Username>("username_create", { engagementId, input }),
  usernameDelete: (id: string) => call<null>("username_delete", { id }),
  credAttemptsList: (engagementId: string) => call<CredAttempt[]>("cred_attempts_list", { engagementId }),
  credAttemptsUpsert: (engagementId: string, inputs: CredAttemptInput[]) =>
    call<CredAttempt[]>("cred_attempts_upsert", { engagementId, inputs }),
  credAttemptDelete: (id: string) => call<null>("cred_attempt_delete", { id }),
  credAttemptsRekey: (usernameId: string, secretCredIds: string[], credId: string, hostId?: string | null) =>
    call<CredAttempt[]>("cred_attempts_rekey", { usernameId, secretCredIds, credId, hostId: hostId ?? null }),
  accessGrantsList: (engagementId: string) => call<AccessGrant[]>("access_grants_list", { engagementId }),
  accessGrantCreate: (engagementId: string, input: AccessGrantInput) =>
    call<AccessGrant>("access_grant_create", { engagementId, input }),
  accessGrantDelete: (id: string) => call<null>("access_grant_delete", { id }),
  findingsList: (engagementId: string) => call<Finding[]>("findings_list", { engagementId }),
  findingCreate: (engagementId: string, input: FindingInput) =>
    call<Finding>("finding_create", { engagementId, input }),
  findingUpdate: (id: string, input: FindingInput) => call<Finding>("finding_update", { id, input }),
  findingDelete: (id: string) => call<null>("finding_delete", { id }),
  findingFilesList: (findingId: string) => call<FindingFile[]>("finding_files_list", { findingId }),
  findingFileCreate: (findingId: string, input: FindingFileInput) =>
    call<FindingFile>("finding_file_create", { findingId, input }),
  findingFileUpdate: (id: string, input: FindingFileInput) =>
    call<FindingFile>("finding_file_update", { id, input }),
  findingFileDelete: (id: string) => call<null>("finding_file_delete", { id }),
  failedAttemptsList: (engagementId: string) =>
    call<FailedAttempt[]>("failed_attempts_list", { engagementId }),
  failedAttemptCreate: (engagementId: string, input: FailedAttemptInput) =>
    call<FailedAttempt>("failed_attempt_create", { engagementId, input }),
  failedAttemptUpdate: (id: string, input: FailedAttemptInput) =>
    call<FailedAttempt>("failed_attempt_update", { id, input }),
  failedAttemptDelete: (id: string) => call<null>("failed_attempt_delete", { id }),
  attachmentGet: (id: string) => call<Attachment>("attachment_get", { id }),
  cleanupList: (engagementId: string) => call<CleanupItem[]>("cleanup_list", { engagementId }),
  cleanupCreate: (engagementId: string, input: CleanupInput) =>
    call<CleanupItem>("cleanup_create", { engagementId, input }),
  cleanupUpdate: (id: string, input: CleanupInput) => call<CleanupItem>("cleanup_update", { id, input }),
  cleanupSetRemoved: (id: string, removed: boolean) =>
    call<CleanupItem>("cleanup_set_removed", { id, removed }),
  cleanupDismiss: (engagementId: string, suggestionKey: string) =>
    call<null>("cleanup_dismiss", { engagementId, suggestionKey }),
  cleanupDelete: (id: string) => call<null>("cleanup_delete", { id }),
  cleanupCounts: () => call<Record<string, number>>("cleanup_counts"),
  engagementsProgress: () => call<Record<string, Progress>>("engagements_progress"),
};

export type Api = typeof api;
