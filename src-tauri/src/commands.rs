//! Tauri command layer: thin wrappers over testable `*_inner` functions.
//!
//! `vault_create` returns nothing on success and leaves the vault
//! unlocked (no daily backup: a brand-new vault has nothing to back up).

use crate::backup::{self, BackupInfo};
use crate::engagements::{self, Engagement, EngagementInput, Progress};
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
pub async fn host_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| hosts::delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn services_list(app: AppHandle, host_id: String) -> AppResult<Vec<Service>> {
    with_vault(app, move |v| services::list(v.conn()?, &host_id)).await
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
