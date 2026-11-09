pub mod attempts;
pub mod cleanup;
pub mod findings;
pub mod backup;
pub mod checklist;
pub mod commands;
pub mod credentials;
pub mod engagements;
pub mod error;
pub mod extractions;
pub mod host_facts;
pub mod hosts;
pub mod field_manual;
pub mod import;
pub mod log;
pub mod network;
pub mod notes;
pub mod nvd;
pub mod migrations;
pub mod paths;
pub mod services;
pub mod payload_builds;
pub mod tried_pairs;
pub mod settings;
pub mod vault;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = paths::DataPaths::resolve(app.handle())?;
            app.manage(Mutex::new(vault::Vault::new(paths)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::vault_create,
            commands::vault_unlock,
            commands::vault_lock,
            commands::settings_get,
            commands::settings_update,
            commands::nvd_lookup,
            commands::backup_now,
            commands::backups_list,
            commands::backup_restore,
            commands::backup_restore_locked,
            commands::import_apply,
            commands::field_manual_scan,
            commands::field_manual_latest_mtime,
            commands::field_manual_save,
            commands::field_manual_load,
            commands::engagements_list,
            commands::engagement_get,
            commands::engagement_create,
            commands::engagement_update,
            commands::engagement_set_status,
            commands::engagement_delete,
            commands::engagement_set_msf_host,
            commands::hosts_list,
            commands::host_create,
            commands::host_update,
            commands::host_move,
            commands::host_mark_access_reviewed,
            commands::host_delete,
            commands::host_sync_board,
            commands::services_list,
            commands::services_list_engagement,
            commands::services_upsert_scan,
            commands::service_create,
            commands::service_update,
            commands::service_confirm,
            commands::service_unconfirm,
            commands::service_delete,
            commands::service_set_verdict,
            commands::host_identity_get,
            commands::host_identity_set,
            commands::vectors_list,
            commands::vector_upsert,
            commands::vector_set_status,
            commands::vector_delete,
            commands::log_list,
            commands::log_create,
            commands::log_update,
            commands::log_delete,
            commands::checklist_list,
            commands::checklist_put,
            commands::checklist_apply_cover,
            commands::checklist_apply_facts,
            commands::notes_get,
            commands::notes_list,
            commands::note_save,
            commands::ruled_out_list,
            commands::ruled_out_create,
            commands::ruled_out_delete,
            commands::tunnels_list,
            commands::tunnel_create,
            commands::tunnel_update,
            commands::tunnel_delete,
            commands::hops_list,
            commands::hop_create,
            commands::hop_update,
            commands::hop_delete,
            commands::credentials_list,
            commands::credential_create,
            commands::credential_update,
            commands::credential_delete,
            commands::credential_crack,
            commands::credential_set_crack_status,
            commands::credential_convert_to_access,
            commands::usernames_list,
            commands::username_create,
            commands::username_delete,
            commands::cred_attempts_list,
            commands::cred_attempts_upsert,
            commands::cred_attempt_delete,
            commands::cred_attempts_rekey,
            commands::payload_builds_list,
            commands::payload_build_record,
            commands::tried_pairs_list,
            commands::tried_pairs_upsert,
            commands::tried_pair_delete,
            commands::tried_pair_promote,
            commands::extraction_save,
            commands::extraction_get,
            commands::extractions_list,
            commands::extraction_undo,
            commands::findings_list,
            commands::finding_create,
            commands::finding_update,
            commands::finding_delete,
            commands::finding_files_list,
            commands::finding_file_create,
            commands::finding_file_update,
            commands::finding_file_delete,
            commands::failed_attempts_list,
            commands::failed_attempt_create,
            commands::failed_attempt_update,
            commands::failed_attempt_delete,
            commands::access_grants_list,
            commands::access_grant_create,
            commands::access_grant_delete,
            commands::attachment_get,
            commands::engagements_progress,
            commands::cleanup_list,
            commands::cleanup_create,
            commands::cleanup_update,
            commands::cleanup_set_removed,
            commands::cleanup_dismiss,
            commands::cleanup_delete,
            commands::cleanup_counts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn csp_is_locked_down() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let security = &conf["app"]["security"];
        for key in ["csp", "devCsp"] {
            let Some(csp) = security[key].as_str() else { continue };
            for d in ["default-src 'self'", "base-uri 'self'", "form-action 'none'", "object-src 'none'"] {
                assert!(csp.contains(d), "{key} is missing {d}: {csp}");
            }
        }
        assert!(security["csp"].is_string());
    }
}
