pub mod backup;
pub mod commands;
pub mod engagements;
pub mod error;
pub mod hosts;
pub mod migrations;
pub mod paths;
pub mod settings;
pub mod vault;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            commands::backup_now,
            commands::backups_list,
            commands::backup_restore,
            commands::backup_restore_locked,
            commands::engagements_list,
            commands::engagement_get,
            commands::engagement_create,
            commands::engagement_update,
            commands::engagement_set_status,
            commands::engagement_delete,
            commands::hosts_list,
            commands::host_create,
            commands::host_update,
            commands::host_move,
            commands::host_delete,
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
