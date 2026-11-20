//! Tauri command layer: each command takes the vault lock off the main thread (`with_vault`) and calls
//! into the module that owns the data.
//!
//! `vault_create` returns nothing on success and leaves the vault
//! unlocked (no daily backup: a brand-new vault has nothing to back up).

use crate::attempts::{self, CredAttempt, CredAttemptInput};
use crate::payload_builds::{self, PayloadBuild};
use crate::reports::{self, Report, ReportDefaults, ReportPatch, ReportSection, SectionInput};
use crate::tried_pairs::{self, TriedPair, TriedPairInput};
use crate::extractions::{self, Extraction, ExtractionRecord, ExtractionSummary};
use crate::backup::{self, BackupInfo};
use crate::cleanup::{self, CleanupInput, CleanupItem};
use crate::findings::{
    self, FailedAttempt, FailedAttemptInput, Finding, FindingFile, FindingFileInput, FindingInput,
};
use crate::credentials::{
    self, AccessGrant, AccessGrantInput, Credential, CredentialInput, Username, UsernameInput,
};
use crate::checklist::{self, ChecklistItem, ChecklistItemInput, GoalRef};
use crate::engagements::{self, Engagement, EngagementInput, Progress};
use crate::network::{self, Hop, HopInput, InterfaceDismissal, Tunnel, TunnelInput};
use crate::notes::{self, Note, RuledOut, RuledOutInput};
use crate::nvd::{self, NvdRecord};
use crate::log::{self, Attachment, LogEntry, LogEntryInput};
use std::collections::HashMap;
use crate::hosts::{self, Host, HostInput};
use crate::field_manual::{self, FieldManualSnapshot, VaultFile};
use crate::import::{self, ImportPlanInput, ImportSummary};
use crate::host_facts::{self, HostIdentity, PrivescVector, VectorInput};
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

pub fn vault_unlock_inner(v: &mut Vault, password: &str) -> AppResult<UnlockResult> {
    let o = v.unlock_with_daily(password)?;
    Ok(UnlockResult {
        migrated_from: o.migration.from,
        migrated_to: o.migration.to,
        daily_backup: o.daily_backup,
        daily_backup_error: o.daily_backup_error,
    })
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
    with_vault(app, |v| Ok(VaultStatus { exists: v.exists(), unlocked: v.is_unlocked() })).await
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
    with_vault(app, |v| settings::get(v.conn()?)).await
}

#[tauri::command]
pub async fn settings_update(app: AppHandle, patch: SettingsPatch) -> AppResult<Settings> {
    with_vault(app, move |v| settings::update(v.conn()?, patch)).await
}

/// The NVD lookup: the cache check and the key read happen under the vault lock; the HTTP request
/// (10s timeout) runs without it, so a slow network never stalls other commands. The key stays in Rust.
#[tauri::command]
pub async fn nvd_lookup(app: AppHandle, cve_id: String) -> AppResult<NvdRecord> {
    let (step, key) = with_vault(app.clone(), move |v| {
        let c = v.conn()?;
        // Zeroized when dropped, after the request.
        let key = zeroize::Zeroizing::new(settings::nvd_api_key(c));
        Ok((nvd::begin(c, &key, &cve_id)?, key))
    })
    .await?;
    let cve = match step {
        nvd::Step::Cached(rec) => return Ok(rec),
        nvd::Step::Fetch { cve } => cve,
    };
    let fetch_cve = cve.clone();
    let raw = off_main(move || nvd::fetch(&key, &fetch_cve)).await?;
    let rec = nvd::read_answer(&raw)?;
    // Caching is best effort: the vault may have locked while the request ran.
    let _ = with_vault(app, move |v| nvd::store(v.conn()?, &cve, &raw)).await;
    Ok(rec)
}

#[tauri::command]
pub async fn backup_now(app: AppHandle) -> AppResult<BackupInfo> {
    with_vault(app, |v| backup::take(v, "manual")).await
}

#[tauri::command]
pub async fn backups_list(app: AppHandle) -> AppResult<Vec<BackupInfo>> {
    with_vault(app, |v| backup::list(v.paths())).await
}

/// Restore a backup while locked (the live database is damaged). Leaves the vault locked.
#[tauri::command]
pub async fn backup_restore_locked(app: AppHandle, file: String, password: String) -> AppResult<()> {
    let password = zeroize::Zeroizing::new(password);
    with_vault(app, move |v| backup::restore_locked(v, &file, &password)).await
}

/// Applies an import plan: a `pre-import` backup first, then one add-only transaction.
#[tauri::command]
pub async fn import_apply(app: AppHandle, plan: ImportPlanInput) -> AppResult<ImportSummary> {
    with_vault(app, move |v| import::apply(v, &plan)).await
}

/// Reads the Field-Manual vault's cards, playbooks and Toolkit. Read-only.
#[tauri::command]
pub async fn field_manual_scan(path: String) -> AppResult<Vec<VaultFile>> {
    // No vault guard: an iCloud read can stall and must not block other commands.
    off_main(move || field_manual::scan(&path)).await
}

#[tauri::command]
pub async fn field_manual_latest_mtime(path: String) -> AppResult<Option<i64>> {
    off_main(move || field_manual::latest_mtime(&path)).await
}

#[tauri::command]
pub async fn field_manual_save(app: AppHandle, snapshot: FieldManualSnapshot) -> AppResult<()> {
    with_vault(app, move |v| field_manual::save(v.conn()?, &snapshot)).await
}

#[tauri::command]
pub async fn field_manual_load(app: AppHandle) -> AppResult<Option<FieldManualSnapshot>> {
    with_vault(app, |v| field_manual::load(v.conn()?)).await
}

#[tauri::command]
pub async fn backup_restore(app: AppHandle, file: String) -> AppResult<()> {
    with_vault(app, move |v| backup::restore(v, &file)).await
}

#[tauri::command]
pub async fn engagements_list(app: AppHandle) -> AppResult<Vec<Engagement>> {
    with_vault(app, |v| engagements::list(v.conn()?)).await
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
pub async fn engagement_set_timebox_paused(app: AppHandle, id: String, paused: bool) -> AppResult<Engagement> {
    with_vault(app, move |v| engagements::set_timebox_paused(v.conn()?, &id, paused)).await
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
pub async fn service_set_verdict(
    app: AppHandle,
    id: String,
    verdict: Option<String>,
    reason: Option<String>,
) -> AppResult<Service> {
    with_vault(app, move |v| services::set_verdict(v.conn()?, &id, verdict.as_deref(), reason.as_deref())).await
}

#[tauri::command]
pub async fn host_identity_get(app: AppHandle, host_id: String) -> AppResult<Option<HostIdentity>> {
    with_vault(app, move |v| host_facts::identity_get(v.conn()?, &host_id)).await
}

#[tauri::command]
pub async fn host_identity_set(app: AppHandle, input: HostIdentity) -> AppResult<HostIdentity> {
    with_vault(app, move |v| host_facts::identity_set(v.conn()?, input)).await
}

#[tauri::command]
pub async fn vectors_list(app: AppHandle, host_id: String) -> AppResult<Vec<PrivescVector>> {
    with_vault(app, move |v| host_facts::vectors_list(v.conn()?, &host_id)).await
}

#[tauri::command]
pub async fn vector_upsert(app: AppHandle, host_id: String, input: VectorInput) -> AppResult<PrivescVector> {
    with_vault(app, move |v| host_facts::vector_upsert(v.conn()?, &host_id, input)).await
}

#[tauri::command]
pub async fn vector_set_status(
    app: AppHandle,
    id: String,
    status: String,
    reason: Option<String>,
) -> AppResult<PrivescVector> {
    with_vault(app, move |v| host_facts::vector_set_status(v.conn()?, &id, &status, reason.as_deref())).await
}

#[tauri::command]
pub async fn vector_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| host_facts::vector_delete(v.conn()?, &id)).await
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
pub async fn checklist_apply_cover(
    app: AppHandle,
    engagement_id: String,
    cover: Vec<GoalRef>,
    revert: Vec<GoalRef>,
) -> AppResult<Vec<ChecklistItem>> {
    with_vault(app, move |v| checklist::apply_cover(v.conn()?, &engagement_id, &cover, &revert)).await
}

#[tauri::command]
pub async fn checklist_apply_facts(
    app: AppHandle,
    engagement_id: String,
    done: Vec<GoalRef>,
    revert: Vec<GoalRef>,
) -> AppResult<Vec<ChecklistItem>> {
    with_vault(app, move |v| checklist::apply_facts(v.conn()?, &engagement_id, &done, &revert)).await
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
pub async fn interface_dismissals_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<InterfaceDismissal>> {
    with_vault(app, move |v| network::interface_dismissals_list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn interface_dismiss(app: AppHandle, engagement_id: String, host_id: String, subnet: String) -> AppResult<()> {
    with_vault(app, move |v| network::interface_dismiss(v.conn()?, &engagement_id, &host_id, &subnet)).await
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

#[tauri::command]
pub async fn cleanup_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<CleanupItem>> {
    with_vault(app, move |v| cleanup::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn cleanup_create(app: AppHandle, engagement_id: String, input: CleanupInput) -> AppResult<CleanupItem> {
    with_vault(app, move |v| cleanup::create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn cleanup_update(app: AppHandle, id: String, input: CleanupInput) -> AppResult<CleanupItem> {
    with_vault(app, move |v| cleanup::update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn cleanup_set_removed(app: AppHandle, id: String, removed: bool) -> AppResult<CleanupItem> {
    with_vault(app, move |v| cleanup::set_removed(v.conn()?, &id, removed)).await
}

#[tauri::command]
pub async fn cleanup_dismiss(app: AppHandle, engagement_id: String, suggestion_key: String) -> AppResult<()> {
    with_vault(app, move |v| cleanup::dismiss(v.conn()?, &engagement_id, &suggestion_key)).await
}

#[tauri::command]
pub async fn cleanup_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| cleanup::delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn cleanup_counts(app: AppHandle) -> AppResult<HashMap<String, i64>> {
    with_vault(app, move |v| cleanup::counts(v.conn()?)).await
}

#[tauri::command]
pub async fn findings_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<Finding>> {
    with_vault(app, move |v| findings::findings_list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn finding_create(app: AppHandle, engagement_id: String, input: FindingInput) -> AppResult<Finding> {
    with_vault(app, move |v| findings::finding_create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn finding_update(app: AppHandle, id: String, input: FindingInput) -> AppResult<Finding> {
    with_vault(app, move |v| findings::finding_update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn finding_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| findings::finding_delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn finding_files_list(app: AppHandle, finding_id: String) -> AppResult<Vec<FindingFile>> {
    with_vault(app, move |v| findings::files_list(v.conn()?, &finding_id)).await
}

#[tauri::command]
pub async fn finding_file_create(app: AppHandle, finding_id: String, input: FindingFileInput) -> AppResult<FindingFile> {
    with_vault(app, move |v| findings::file_create(v.conn()?, &finding_id, input)).await
}

#[tauri::command]
pub async fn finding_file_update(app: AppHandle, id: String, input: FindingFileInput) -> AppResult<FindingFile> {
    with_vault(app, move |v| findings::file_update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn finding_file_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| findings::file_delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn failed_attempts_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<FailedAttempt>> {
    with_vault(app, move |v| findings::attempts_list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn failed_attempt_create(
    app: AppHandle,
    engagement_id: String,
    input: FailedAttemptInput,
) -> AppResult<FailedAttempt> {
    with_vault(app, move |v| findings::attempt_create(v.conn()?, &engagement_id, input)).await
}

#[tauri::command]
pub async fn failed_attempt_update(app: AppHandle, id: String, input: FailedAttemptInput) -> AppResult<FailedAttempt> {
    with_vault(app, move |v| findings::attempt_update(v.conn()?, &id, input)).await
}

#[tauri::command]
pub async fn payload_builds_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<PayloadBuild>> {
    with_vault(app, move |v| payload_builds::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn payload_build_record(app: AppHandle, input: PayloadBuild) -> AppResult<PayloadBuild> {
    with_vault(app, move |v| payload_builds::record(v.conn()?, input)).await
}

#[tauri::command]
pub async fn failed_attempt_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| findings::attempt_delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn tried_pairs_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<TriedPair>> {
    with_vault(app, move |v| tried_pairs::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn tried_pairs_upsert(
    app: AppHandle,
    engagement_id: String,
    inputs: Vec<TriedPairInput>,
) -> AppResult<Vec<TriedPair>> {
    with_vault(app, move |v| tried_pairs::upsert(v.conn()?, &engagement_id, &inputs)).await
}

#[tauri::command]
pub async fn tried_pair_delete(app: AppHandle, id: String) -> AppResult<()> {
    with_vault(app, move |v| tried_pairs::delete(v.conn()?, &id)).await
}

#[tauri::command]
pub async fn tried_pair_promote(
    app: AppHandle,
    engagement_id: String,
    username: String,
    domain: Option<String>,
    secret: String,
) -> AppResult<usize> {
    with_vault(app, move |v| {
        tried_pairs::promote(v.conn()?, &engagement_id, &username, domain.as_deref(), &secret)
    })
    .await
}

#[tauri::command]
pub async fn extraction_save(
    app: AppHandle,
    log_entry_id: String,
    engagement_id: String,
    summary: ExtractionSummary,
    record: ExtractionRecord,
) -> AppResult<Extraction> {
    with_vault(app, move |v| extractions::save(v.conn()?, &log_entry_id, &engagement_id, &summary, &record)).await
}

#[tauri::command]
pub async fn extraction_get(app: AppHandle, log_entry_id: String) -> AppResult<Option<Extraction>> {
    with_vault(app, move |v| extractions::get(v.conn()?, &log_entry_id)).await
}

#[tauri::command]
pub async fn extractions_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<Extraction>> {
    with_vault(app, move |v| extractions::list(v.conn()?, &engagement_id)).await
}

#[tauri::command]
pub async fn extraction_undo(app: AppHandle, log_entry_id: String) -> AppResult<Extraction> {
    with_vault(app, move |v| extractions::undo(v.conn()?, &log_entry_id)).await
}

#[tauri::command]
pub async fn report_get_or_create(app: AppHandle, engagement_id: String) -> AppResult<Report> {
    with_vault(app, move |v| {
        let s = settings::get(v.conn()?)?;
        let defaults = ReportDefaults { candidate_name: s.report_name, email: s.report_email, osid: s.report_osid };
        reports::get_or_create(v.conn()?, &engagement_id, &defaults)
    })
    .await
}

#[tauri::command]
pub async fn report_update(app: AppHandle, id: String, patch: ReportPatch) -> AppResult<Report> {
    with_vault(app, move |v| reports::update(v.conn()?, &id, patch)).await
}

#[tauri::command]
pub async fn report_sections_list(app: AppHandle, report_id: String) -> AppResult<Vec<ReportSection>> {
    with_vault(app, move |v| reports::sections_list(v.conn()?, &report_id)).await
}

#[tauri::command]
pub async fn report_section_upsert(app: AppHandle, report_id: String, input: SectionInput) -> AppResult<ReportSection> {
    with_vault(app, move |v| reports::section_upsert(v.conn()?, &report_id, input)).await
}

#[tauri::command]
pub async fn report_section_save(app: AppHandle, id: String, doc: serde_json::Value, meta: serde_json::Value) -> AppResult<ReportSection> {
    with_vault(app, move |v| reports::section_save(v.conn()?, &id, doc, meta)).await
}

#[tauri::command]
pub async fn report_section_delete(app: AppHandle, report_id: String, id: String) -> AppResult<()> {
    with_vault(app, move |v| reports::section_delete(v.conn()?, &report_id, &id)).await
}

#[tauri::command]
pub async fn report_sections_reorder(app: AppHandle, report_id: String, ids: Vec<String>) -> AppResult<()> {
    with_vault(app, move |v| reports::sections_reorder(v.conn()?, &report_id, ids)).await
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
        let list = |v: &Vault| v.conn().and_then(engagements::list);
        assert_eq!(list(&v), Err(AppError::Locked));
        assert_eq!(v.conn().and_then(settings::get), Err(AppError::Locked));
        v.create_for_test("correct horse battery").unwrap();
        assert_eq!(list(&v).unwrap(), vec![]);
        assert!(v.exists() && v.is_unlocked());
        v.lock();
        assert_eq!(list(&v), Err(AppError::Locked));
        assert!(v.exists());
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
