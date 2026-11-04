import { invoke } from "@tauri-apps/api/core";
import type { BackupInfo } from "../types/backup";
import type { ConfirmInput, ScanPort, Service, ServiceInput } from "../types/service";
import type { ChecklistItem, ChecklistItemInput } from "../types/checklist";
import type { Attachment, LogEntry, LogEntryInput, Progress } from "../types/log";
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

/** One function per Tauri command. Args are camelCase, as Tauri expects. */
export const api = {
  vaultStatus: () => call<VaultStatus>("vault_status"),
  vaultCreate: (password: string) => call<null>("vault_create", { password }),
  vaultUnlock: (password: string) => call<UnlockResult>("vault_unlock", { password }),
  vaultLock: () => call<null>("vault_lock"),

  settingsGet: () => call<Settings>("settings_get"),
  settingsUpdate: (patch: SettingsPatch) => call<Settings>("settings_update", { patch }),

  backupNow: () => call<BackupInfo>("backup_now"),
  backupsList: () => call<BackupInfo[]>("backups_list"),
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
  engagementDelete: (id: string) => call<null>("engagement_delete", { id }),

  hostsList: (engagementId: string) => call<Host[]>("hosts_list", { engagementId }),
  hostCreate: (engagementId: string, input: HostInput) =>
    call<Host>("host_create", { engagementId, input }),
  hostUpdate: (id: string, input: HostInput) => call<Host>("host_update", { id, input }),
  hostMove: (id: string, column: BoardColumn) => call<Host>("host_move", { id, column }),
  hostDelete: (id: string) => call<null>("host_delete", { id }),

  servicesList: (hostId: string) => call<Service[]>("services_list", { hostId }),
  servicesUpsertScan: (hostId: string, ports: ScanPort[]) =>
    call<Service[]>("services_upsert_scan", { hostId, ports }),
  serviceCreate: (hostId: string, input: ServiceInput) =>
    call<Service>("service_create", { hostId, input }),
  serviceUpdate: (id: string, input: ServiceInput) => call<Service>("service_update", { id, input }),
  serviceConfirm: (id: string, input: ConfirmInput) =>
    call<Service>("service_confirm", { id, input }),
  serviceUnconfirm: (id: string) => call<Service>("service_unconfirm", { id }),
  serviceDelete: (id: string) => call<null>("service_delete", { id }),

  logList: (engagementId: string) => call<LogEntry[]>("log_list", { engagementId }),
  logCreate: (engagementId: string, input: LogEntryInput) =>
    call<LogEntry>("log_create", { engagementId, input }),
  logUpdate: (id: string, input: LogEntryInput) => call<LogEntry>("log_update", { id, input }),
  logDelete: (id: string) => call<null>("log_delete", { id }),
  checklistList: (engagementId: string) => call<ChecklistItem[]>("checklist_list", { engagementId }),
  checklistPut: (engagementId: string, items: ChecklistItemInput[]) =>
    call<ChecklistItem[]>("checklist_put", { engagementId, items }),
  attachmentGet: (id: string) => call<Attachment>("attachment_get", { id }),
  engagementsProgress: () => call<Record<string, Progress>>("engagements_progress"),
};

export type Api = typeof api;
