use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
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
        DataPaths::prepare(base.join(dir))
    }

    /// Create (or tighten) the data dir and `backups/` as owner-only (0700), and tighten an
    /// existing `raven.db`, `vault.json` and backup files to 0600.
    pub fn prepare(root: PathBuf) -> AppResult<DataPaths> {
        let paths = DataPaths::for_root(root);
        private_dir(&paths.root)?;
        private_dir(&paths.backups)?;
        for f in [&paths.db, &paths.vault_meta] {
            if f.is_file() {
                set_mode(f, 0o600)?;
            }
        }
        for entry in std::fs::read_dir(&paths.backups)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                set_mode(&entry.path(), 0o600)?;
            }
        }
        Ok(paths)
    }
}

fn private_dir(p: &Path) -> AppResult<()> {
    let mut b = std::fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(p)?;
    // DirBuilder's mode only applies to newly created dirs; tighten an existing one too.
    set_mode(p, 0o700)
}

fn set_mode(p: &Path, mode: u32) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = (p, mode);
    Ok(())
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

    #[cfg(unix)]
    fn mode(p: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(p).unwrap().permissions().mode() & 0o777
    }

    #[cfg(unix)]
    #[test]
    fn prepare_creates_private_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let p = DataPaths::prepare(dir.path().join("app").join("raven-dev")).unwrap();
        assert_eq!(mode(&p.root), 0o700);
        assert_eq!(mode(&p.backups), 0o700);
    }

    #[cfg(unix)]
    #[test]
    fn prepare_tightens_existing_dirs_and_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("raven-dev");
        let backups = root.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        let open = |p: &std::path::Path, m: u32| {
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(m)).unwrap()
        };
        open(&root, 0o755);
        open(&backups, 0o755);
        let db = root.join("raven.db");
        let bk = backups.join("raven-20261103-120000-manual.db");
        std::fs::write(&db, b"x").unwrap();
        std::fs::write(&bk, b"x").unwrap();
        open(&db, 0o644);
        open(&bk, 0o644);
        let p = DataPaths::prepare(root).unwrap();
        assert_eq!(mode(&p.root), 0o700);
        assert_eq!(mode(&p.backups), 0o700);
        assert_eq!(mode(&p.db), 0o600);
        assert_eq!(mode(&bk), 0o600);
    }
}
