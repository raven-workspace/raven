pub mod backup;
pub mod commands;
pub mod engagements;
pub mod error;
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
            commands::engagements_list,
            commands::engagement_get,
            commands::engagement_create,
            commands::engagement_update,
            commands::engagement_set_status,
            commands::engagement_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
