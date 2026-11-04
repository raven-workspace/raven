use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, PartialEq)]
pub struct DataPaths {
    pub root: PathBuf,
    pub db: PathBuf,
    pub vault_meta: PathBuf,
    pub backups: PathBuf,
}

impl DataPaths {
    pub fn for_root(root: PathBuf) -> DataPaths {
        DataPaths {
            db: root.join("raven.db"),
            vault_meta: root.join("vault.json"),
            backups: root.join("backups"),
            root,
        }
    }

    pub fn resolve(app: &AppHandle) -> AppResult<DataPaths> {
        let base = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Io(e.to_string()))?;
        let dir = if cfg!(debug_assertions) { "raven-dev" } else { "raven" };
        let paths = DataPaths::for_root(base.join(dir));
        std::fs::create_dir_all(&paths.root)?;
        std::fs::create_dir_all(&paths.backups)?;
        Ok(paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_for_root_layout() {
        let p = DataPaths::for_root("/x".into());
        assert_eq!(p.db, PathBuf::from("/x/raven.db"));
        assert_eq!(p.vault_meta, PathBuf::from("/x/vault.json"));
        assert_eq!(p.backups, PathBuf::from("/x/backups"));
        assert_eq!(p.root, PathBuf::from("/x"));
    }
}
