//! Tauri command layer: thin wrappers over testable `*_inner` functions.
//!
//! `vault_create` returns nothing on success and leaves the vault
//! unlocked (no daily backup: a brand-new vault has nothing to back up).

use crate::backup::{self, BackupInfo};
use crate::engagements::{self, Engagement, EngagementInput};
use crate::error::AppResult;
use crate::settings::{self, Settings, SettingsPatch};
use crate::vault::Vault;
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

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

pub fn settings_get_inner(v: &Vault) -> AppResult<Settings> {
    settings::get(v.conn()?)
}

pub fn engagements_list_inner(v: &Vault) -> AppResult<Vec<Engagement>> {
    engagements::list(v.conn()?)
}

fn guard(s: &VaultState) -> std::sync::MutexGuard<'_, Vault> {
    s.lock().unwrap_or_else(|e| e.into_inner())
}

#[tauri::command]
pub fn vault_status(state: State<VaultState>) -> VaultStatus {
    vault_status_inner(&guard(&state))
}

#[tauri::command]
pub fn vault_create(state: State<VaultState>, password: String) -> AppResult<()> {
    guard(&state).create(&password).map(|_| ())
}

#[tauri::command]
pub fn vault_unlock(state: State<VaultState>, password: String) -> AppResult<UnlockResult> {
    vault_unlock_inner(&mut guard(&state), &password)
}

#[tauri::command]
pub fn vault_lock(state: State<VaultState>) {
    guard(&state).lock();
}

#[tauri::command]
pub fn settings_get(state: State<VaultState>) -> AppResult<Settings> {
    settings_get_inner(&guard(&state))
}

#[tauri::command]
pub fn settings_update(state: State<VaultState>, patch: SettingsPatch) -> AppResult<Settings> {
    settings::update(guard(&state).conn()?, patch)
}

#[tauri::command]
pub fn backup_now(state: State<VaultState>) -> AppResult<BackupInfo> {
    backup::take(&guard(&state), "manual")
}

#[tauri::command]
pub fn backups_list(state: State<VaultState>) -> AppResult<Vec<BackupInfo>> {
    backup::list(guard(&state).paths())
}

#[tauri::command]
pub fn backup_restore(state: State<VaultState>, file: String) -> AppResult<()> {
    backup::restore(&mut guard(&state), &file)
}

#[tauri::command]
pub fn engagements_list(state: State<VaultState>) -> AppResult<Vec<Engagement>> {
    engagements_list_inner(&guard(&state))
}

#[tauri::command]
pub fn engagement_get(state: State<VaultState>, id: String) -> AppResult<Engagement> {
    engagements::get(guard(&state).conn()?, &id)
}

#[tauri::command]
pub fn engagement_create(state: State<VaultState>, input: EngagementInput) -> AppResult<Engagement> {
    engagements::create(guard(&state).conn()?, input)
}

#[tauri::command]
pub fn engagement_update(state: State<VaultState>, id: String, input: EngagementInput) -> AppResult<Engagement> {
    engagements::update(guard(&state).conn()?, &id, input)
}

#[tauri::command]
pub fn engagement_set_status(state: State<VaultState>, id: String, status: String) -> AppResult<Engagement> {
    engagements::set_status(guard(&state).conn()?, &id, &status)
}

#[tauri::command]
pub fn engagement_delete(state: State<VaultState>, id: String) -> AppResult<()> {
    engagements::delete(guard(&state).conn()?, &id)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
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
