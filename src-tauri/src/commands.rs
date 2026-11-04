//! Tauri command layer: thin wrappers over testable `*_inner` functions.
//!
//! `vault_create` returns nothing on success and leaves the vault
//! unlocked (no daily backup: a brand-new vault has nothing to back up).

use crate::attempts::{self, CredAttempt, CredAttemptInput};
use crate::backup::{self, BackupInfo};
use crate::credentials::{
    self, AccessGrant, AccessGrantInput, Credential, CredentialInput, Username, UsernameInput,
};
use crate::checklist::{self, ChecklistItem, ChecklistItemInput};
use crate::engagements::{self, Engagement, EngagementInput, Progress};
use crate::network::{self, Hop, HopInput, Tunnel, TunnelInput};
use crate::notes::{self, Note, RuledOut, RuledOutInput};
use crate::log::{self, Attachment, LogEntry, LogEntryInput};
use std::collections::HashMap;
use crate::hosts::{self, Host, HostInput};
use crate::services::{self, ConfirmInput, ScanPort, Service, ServiceInput};
use crate::error::{AppError, AppResult};
use crate::settings::{self, Settings, SettingsPatch};
use crate::vault::Vault;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub type VaultState = Mutex<Vault>;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VaultStatus {
    pub exists: bool,
    pub unlocked: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockResult {
    pub migrated_from: u32,
    pub migrated_to: u32,
    pub daily_backup: Option<BackupInfo>,
    pub daily_backup_error: Option<String>,
}

pub fn vault_status_inner(v: &Vault) -> VaultStatus {
    VaultStatus { exists: v.exists(), unlocked: v.is_unlocked() }
}

pub fn vault_unlock_inner(v: &mut Vault, password: &str) -> AppResult<UnlockResult> {
    let o = v.unlock_with_daily(password)?;
    Ok(UnlockResult {
        migrated_from: o.migration.from,
        migrated_to: o.migration.to,
        daily_backup: o.daily_backup,
        daily_backup_error: o.daily_backup_error,
    })
}

pub fn backups_list_inner(v: &Vault) -> AppResult<Vec<BackupInfo>> {
    backup::list(v.paths())
}

pub fn settings_get_inner(v: &Vault) -> AppResult<Settings> {
    settings::get(v.conn()?)
}

pub fn engagements_list_inner(v: &Vault) -> AppResult<Vec<Engagement>> {
    engagements::list(v.conn()?)
}

fn guard(s: &VaultState) -> std::sync::MutexGuard<'_, Vault> {
    s.lock().unwrap_or_else(|e| e.into_inner())
}

/// Run blocking work on Tauri's blocking thread pool, never on the macOS main (UI) thread,
/// so Argon2, migrations and backups can't freeze the window.
async fn off_main<T, F>(f: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io(format!("background task failed: {e}")))?
}

/// `f` gets the vault behind the shared mutex. The guard lives only inside the blocking
/// closure, so it is never held across an `.await`.
async fn with_vault<T, F>(app: AppHandle, f: F) -> AppResult<T>
where
    F: FnOnce(&mut Vault) -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    off_main(move || {
        let state = app.state::<VaultState>();
        let mut v = guard(&state);
        f(&mut v)
    })
    .await
}

#[tauri::command]
pub async fn vault_status(app: AppHandle) -> AppResult<VaultStatus> {
    with_vault(app, |v| Ok(vault_status_inner(v))).await
}

#[tauri::command]
pub async fn vault_create(app: AppHandle, password: String) -> AppResult<()> {
    with_vault(app, move |v| v.create(&password).map(|_| ())).await
}

#[tauri::command]
pub async fn vault_unlock(app: AppHandle, password: String) -> AppResult<UnlockResult> {
    with_vault(app, move |v| vault_unlock_inner(v, &password)).await
}

#[tauri::command]
pub async fn vault_lock(app: AppHandle) -> AppResult<()> {
    with_vault(app, |v| {
        v.lock();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn settings_get(app: AppHandle) -> AppResult<Settings> {
    with_vault(app, |v| settings_get_inner(v)).await
}

#[tauri::command]
pub async fn settings_update(app: AppHandle, patch: SettingsPatch) -> AppResult<Settings> {
    with_vault(app, move |v| settings::update(v.conn()?, patch)).await
}

#[tauri::command]
pub async fn backup_now(app: AppHandle) -> AppResult<BackupInfo> {
    with_vault(app, |v| backup::take(v, "manual")).await
}

#[tauri::command]
pub async fn backups_list(app: AppHandle) -> AppResult<Vec<BackupInfo>> {
    with_vault(app, |v| backups_list_inner(v)).await
}

/// Restore a backup while locked (the live database is damaged). Leaves the vault locked.
#[tauri::command]
pub async fn backup_restore_locked(app: AppHandle, file: String, password: String) -> AppResult<()> {
    let password = zeroize::Zeroizing::new(password);
    with_vault(app, move |v| backup::restore_locked(v, &file, &password)).await
}

#[tauri::command]
pub async fn backup_restore(app: AppHandle, file: String) -> AppResult<()> {
    with_vault(app, move |v| backup::restore(v, &file)).await
}

#[tauri::command]
pub async fn engagements_list(app: AppHandle) -> AppResult<Vec<Engagement>> {
    with_vault(app, |v| engagements_list_inner(v)).await
}

#[tauri::command]
pub async fn engagement_get(app: AppHandle, id: String) -> AppResult<Engagement> {
    with_vault(app, move |v| engagements::get(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn engagement_create(app: AppHandle, input: EngagementInput) -> AppResult<Engagement> {
    with_vault(app, move |v| engagements::create(v.conn()?, input)).await
}

#[tauri::command]
pub async fn engagement_update(app: AppHandle, id: String, input: EngagementInput) -> AppResult<Engagement> {
    with_vault(app, move |v| engagements::update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn engagement_set_status(app: AppHandle, id: String, status: String) -> AppResult<Engagement> {
    with_vault(app, move |v| engagements::set_status(v.conn()?, &id, &status)).await
}

#[tauri::command]
pub async fn engagement_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| engagements::delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn engagement_set_msf_host(app: AppHandle, engagement_id: String, host_id: Option<String>) -> AppResult<Engagement> {
    with_vault(app, move |v| engagements::set_msf_host(v.conn()?, &engagement_id, host_id.as_deref())).await
}

#[tauri::command]
pub async fn hosts_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<Host>> {
    with_vault(app, move |v| hosts::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn host_create(app: AppHandle, engagement_id: String, input: HostInput) -> AppResult<Host> {
    with_vault(app, move |v| hosts::create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn host_update(app: AppHandle, id: String, input: HostInput) -> AppResult<Host> {
    with_vault(app, move |v| hosts::update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn host_move(app: AppHandle, id: String, column: String) -> AppResult<Host> {
    with_vault(app, move |v| hosts::move_to(v.conn()?, &id, &column)).await
}

#[tauri::command]
pub async fn host_sync_board(app: AppHandle, host_id: String, derived: String) -> AppResult<Host> {
    with_vault(app, move |v| hosts::sync_board(v.conn()?, &host_id, &derived)).await
}

#[tauri::command]
pub async fn host_mark_access_reviewed(app: AppHandle, host_id: String) -> AppResult<Host> {
    with_vault(app, move |v| hosts::mark_access_reviewed(v.conn()?, &host_id)).await
}

#[tauri::command]
pub async fn host_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| hosts::delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn services_list(app: AppHandle, host_id: String) -> AppResult<Vec<Service>> {
    with_vault(app, move |v| services::list(v.conn()?, &host_id)).await
}

#[tauri::command]
pub async fn services_list_engagement(app: AppHandle, engagement_id: String) -> AppResult<Vec<Service>> {
    with_vault(app, move |v| services::list_engagement(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn services_upsert_scan(app: AppHandle, host_id: String, ports: Vec<ScanPort>) -> AppResult<Vec<Service>> {
    with_vault(app, move |v| services::upsert_scan(v.conn()?, &host_id, &ports)).await
}

#[tauri::command]
pub async fn service_create(app: AppHandle, host_id: String, input: ServiceInput) -> AppResult<Service> {
    with_vault(app, move |v| services::create(v.conn()?, &host_id, input)).await
}

#[tauri::command]
pub async fn service_update(app: AppHandle, id: String, input: ServiceInput) -> AppResult<Service> {
    with_vault(app, move |v| services::update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn service_confirm(app: AppHandle, id: String, input: ConfirmInput) -> AppResult<Service> {
    with_vault(app, move |v| services::confirm(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn service_unconfirm(app: AppHandle, id: String) -> AppResult<Service> {
    with_vault(app, move |v| services::unconfirm(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn service_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| services::delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn log_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<LogEntry>> {
    with_vault(app, move |v| log::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn log_create(app: AppHandle, engagement_id: String, input: LogEntryInput) -> AppResult<LogEntry> {
    with_vault(app, move |v| log::create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn log_update(app: AppHandle, id: String, input: LogEntryInput) -> AppResult<LogEntry> {
    with_vault(app, move |v| log::update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn log_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| log::delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn checklist_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<ChecklistItem>> {
    with_vault(app, move |v| checklist::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn checklist_put(
    app: AppHandle,
    engagement_id: String,
    items: Vec<ChecklistItemInput>,
) -> AppResult<Vec<ChecklistItem>> {
    with_vault(app, move |v| checklist::put(v.conn()?, &engagement_id, &items)).await
}

#[tauri::command]
pub async fn notes_get(app: AppHandle, engagement_id: String, host_id: Option<String>) -> AppResult<Note> {
    with_vault(app, move |v| notes::get(v.conn()?, &engagement_id, host_id.as_deref())).await
}

#[tauri::command]
pub async fn notes_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<Note>> {
    with_vault(app, move |v| notes::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn note_save(app: AppHandle, engagement_id: String, host_id: Option<String>, body: String, private: bool) -> AppResult<Note> {
    with_vault(app, move |v| notes::save(v.conn()?, &engagement_id, host_id.as_deref(), &body, private)).await
}

#[tauri::command]
pub async fn ruled_out_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<RuledOut>> {
    with_vault(app, move |v| notes::ruled_out_list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn ruled_out_create(app: AppHandle, input: RuledOutInput) -> AppResult<RuledOut> {
    with_vault(app, move |v| notes::ruled_out_create(v.conn()?, input)).await
}

#[tauri::command]
pub async fn ruled_out_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| notes::ruled_out_delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn tunnels_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<Tunnel>> {
    with_vault(app, move |v| network::tunnels_list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn tunnel_create(app: AppHandle, engagement_id: String, input: TunnelInput) -> AppResult<Tunnel> {
    with_vault(app, move |v| network::tunnel_create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn tunnel_update(app: AppHandle, id: String, input: TunnelInput) -> AppResult<Tunnel> {
    with_vault(app, move |v| network::tunnel_update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn tunnel_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| network::tunnel_delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn hops_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<Hop>> {
    with_vault(app, move |v| network::hops_list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn hop_create(app: AppHandle, engagement_id: String, input: HopInput) -> AppResult<Hop> {
    with_vault(app, move |v| network::hop_create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn hop_update(app: AppHandle, id: String, input: HopInput) -> AppResult<Hop> {
    with_vault(app, move |v| network::hop_update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn hop_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| network::hop_delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn credentials_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<Credential>> {
    with_vault(app, move |v| credentials::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn credential_create(app: AppHandle, engagement_id: String, input: CredentialInput) -> AppResult<Credential> {
    with_vault(app, move |v| credentials::create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn credential_update(app: AppHandle, id: String, input: CredentialInput) -> AppResult<Credential> {
    with_vault(app, move |v| credentials::update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn credential_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| credentials::delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn credential_crack(app: AppHandle, hash_id: String, plaintext: String) -> AppResult<Credential> {
    with_vault(app, move |v| credentials::crack(v.conn()?, &hash_id, &plaintext)).await
}

#[tauri::command]
pub async fn credential_set_crack_status(app: AppHandle, id: String, status: String) -> AppResult<Credential> {
    with_vault(app, move |v| credentials::set_crack_status(v.conn()?, &id, &status)).await
}

#[tauri::command]
pub async fn credential_convert_to_access(app: AppHandle, cred_id: String, grant: AccessGrantInput) -> AppResult<Username> {
    with_vault(app, move |v| credentials::convert_to_access(v.conn()?, &cred_id, grant)).await
}

#[tauri::command]
pub async fn usernames_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<Username>> {
    with_vault(app, move |v| credentials::usernames_list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn username_create(app: AppHandle, engagement_id: String, input: UsernameInput) -> AppResult<Username> {
    with_vault(app, move |v| credentials::username_create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn username_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| credentials::username_delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn cred_attempts_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<CredAttempt>> {
    with_vault(app, move |v| attempts::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn cred_attempts_upsert(
    app: AppHandle,
    engagement_id: String,
    inputs: Vec<CredAttemptInput>,
) -> AppResult<Vec<CredAttempt>> {
    with_vault(app, move |v| attempts::upsert(v.conn()?, &engagement_id, &inputs)).await
}

#[tauri::command]
pub async fn cred_attempt_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| attempts::delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn cred_attempts_rekey(
    app: AppHandle,
    username_id: String,
    secret_cred_ids: Vec<String>,
    cred_id: String,
    host_id: Option<String>,
) -> AppResult<Vec<CredAttempt>> {
    with_vault(app, move |v| {
        attempts::rekey_username_attempts(v.conn()?, &username_id, &secret_cred_ids, &cred_id, host_id.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn access_grants_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<AccessGrant>> {
    with_vault(app, move |v| credentials::grants_list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn access_grant_create(app: AppHandle, engagement_id: String, input: AccessGrantInput) -> AppResult<AccessGrant> {
    with_vault(app, move |v| credentials::grant_create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn access_grant_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| credentials::grant_delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn attachment_get(app: AppHandle, id: String) -> AppResult<Attachment> {
    with_vault(app, move |v| log::attachment_get(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn engagements_progress(app: AppHandle) -> AppResult<HashMap<String, Progress>> {
    with_vault(app, move |v| engagements::progress_all(v.conn()?)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::DataPaths;
    use crate::vault::Vault;

    #[test]
    fn commands_error_when_locked() {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        assert_eq!(engagements_list_inner(&v), Err(AppError::Locked));
        assert_eq!(settings_get_inner(&v), Err(AppError::Locked));
        v.create_for_test("correct horse battery").unwrap();
        assert_eq!(engagements_list_inner(&v).unwrap(), vec![]);
        assert_eq!(vault_status_inner(&v), VaultStatus { exists: true, unlocked: true });
        v.lock();
        assert_eq!(engagements_list_inner(&v), Err(AppError::Locked));
        assert!(vault_status_inner(&v).exists);
    }

    #[test]
    fn off_main_runs_on_another_thread_and_returns_result() {
        let caller = std::thread::current().id();
        let worker = tauri::async_runtime::block_on(off_main(|| Ok(std::thread::current().id()))).unwrap();
        assert_ne!(worker, caller);
        let err: AppResult<()> = tauri::async_runtime::block_on(off_main(|| Err(AppError::Locked)));
        assert_eq!(err, Err(AppError::Locked));
    }

    #[test]
    fn unlock_outcome_is_camel_case() {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        v.lock();
        let j = serde_json::to_value(vault_unlock_inner(&mut v, "correct horse battery").unwrap()).unwrap();
        assert!(j.get("migratedFrom").is_some() && j.get("migratedTo").is_some());
        assert!(j.get("dailyBackup").is_some() && j.get("dailyBackupError").is_some());
        if let Some(b) = j["dailyBackup"].as_object() {
            assert!(b.contains_key("createdAt") && b.contains_key("sizeBytes"));
        }
    }
}
