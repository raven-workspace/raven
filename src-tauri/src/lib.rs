pub mod attempts;
pub mod cleanup;
pub mod findings;
pub mod backup;
pub mod checklist;
pub mod commands;
pub mod credentials;
mod db;
pub mod engagements;
pub mod error;
pub mod export;
pub mod extractions;
pub mod host_facts;
pub mod hosts;
pub mod field_manual;
pub mod log;
pub mod network;
pub mod notes;
pub mod nvd;
pub mod migrations;
pub mod paths;
mod platform;
pub mod services;
pub mod payload_builds;
pub mod reports;
pub mod tried_pairs;
pub mod tun0;
pub mod settings;
#[cfg(feature = "terminal")]
pub mod terminal;
pub mod terminal_history;
pub mod vault;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(platform::init())
        .setup(|app| {
            let paths = paths::DataPaths::resolve(app.handle())?;
            #[cfg(feature = "terminal")]
            let integration_dir = paths.root.join("shell-integration");
            app.manage(Mutex::new(vault::Vault::new(paths)));
            #[cfg(feature = "terminal")]
            {
                let sessions = terminal::ipc::manager(app.handle(), integration_dir);
                app.manage(sessions);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::vault_create,
            commands::vault_unlock,
            commands::vault_lock,
            commands::settings_get,
            commands::tun0_address,
            commands::settings_update,
            commands::nvd_lookup,
            commands::backup_now,
            commands::backups_list,
            commands::backup_restore,
            commands::backup_restore_locked,
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
            commands::engagement_set_timebox_paused,
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
            commands::checklist_apply_entry_ticks,
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
            commands::same_domains,
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
            commands::report_get_or_create,
            commands::report_update,
            commands::report_export,
            commands::report_sections_list,
            commands::report_section_upsert,
            commands::report_section_save,
            commands::report_sections_save,
            commands::report_sections_reorder,
            commands::report_section_delete,
            commands::payload_build_record,
            commands::tried_pairs_list,
            commands::tried_pairs_upsert,
            commands::tried_pair_delete,
            commands::tried_pair_promote,
            commands::extraction_save,
            commands::extraction_file,
            commands::extraction_finish,
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
            commands::interface_dismissals_list,
            commands::interface_dismiss,
            commands::cleanup_delete,
            commands::cleanup_counts,
            #[cfg(feature = "terminal")]
            terminal::ipc::terminal_spawn,
            #[cfg(feature = "terminal")]
            terminal::ipc::terminal_list,
            #[cfg(feature = "terminal")]
            terminal::ipc::terminal_attach,
            #[cfg(feature = "terminal")]
            terminal::ipc::terminal_write,
            #[cfg(feature = "terminal")]
            terminal::ipc::terminal_resize,
            #[cfg(feature = "terminal")]
            terminal::ipc::terminal_close,
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

    /// The quoted names between `start` and the next `end` in `text`.
    fn quoted(text: &str, start: &str, end: &str) -> Vec<String> {
        let from = text.find(start).unwrap_or_else(|| panic!("no {start}")) + start.len();
        let block = &text[from..from + text[from..].find(end).unwrap()];
        block.split('"').skip(1).step_by(2).map(str::to_owned).collect()
    }

    /// SR-1: with the app's ACL manifest (build.rs), a command the capability doesn't allow by name can't be called,
    /// and one the manifest doesn't list has no permission at all. Every registered command must be in both.
    #[test]
    fn every_command_is_in_the_acl_manifest_and_allowed_by_the_capability() {
        let lib = include_str!("lib.rs");
        let handlers = &lib[lib.find("generate_handler![").unwrap()..];
        let handlers = &handlers[..handlers.find("])").unwrap()];
        let registered: Vec<String> = handlers
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with('#') && line.ends_with(','))
            .map(|line| line.trim_end_matches(',').rsplit("::").next().unwrap().to_owned())
            .collect();
        assert!(registered.len() > 100, "parsed {} commands", registered.len());

        let build = include_str!("../build.rs");
        let app = quoted(build, "const APP_COMMANDS: &[&str] = &[", "];");
        let terminal = quoted(build, "const TERMINAL_COMMANDS: &[&str] = &[", "];");
        let manifest: Vec<String> = app.iter().chain(&terminal).cloned().collect();
        assert_eq!(manifest, registered, "build.rs must list generate_handler!'s commands, in order");
        assert_eq!(
            terminal,
            ["terminal_spawn", "terminal_list", "terminal_attach", "terminal_write", "terminal_resize", "terminal_close"]
        );

        let sets = include_str!("../permissions/app.toml");
        let allow = |names: &[String]| -> Vec<String> {
            names.iter().map(|name| format!("allow-{}", name.replace('_', "-"))).collect()
        };
        // After each set's identifier: its description, then its permissions.
        assert_eq!(quoted(sets, "identifier = \"app-commands\"", "]")[1..], allow(&app));
        assert_eq!(quoted(sets, "identifier = \"terminal-commands\"", "]")[1..], allow(&terminal));

        let capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let granted: Vec<&str> = capability["permissions"].as_array().unwrap().iter().filter_map(|p| p.as_str()).collect();
        assert!(granted.contains(&"app-commands") && granted.contains(&"terminal-commands"), "{granted:?}");
    }
}
