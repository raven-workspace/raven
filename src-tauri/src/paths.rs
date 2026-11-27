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
        let override_dir = std::env::var(DATA_DIR_ENV).ok();
        let dir = data_dir_name(cfg!(debug_assertions), override_dir.as_deref())?;
        DataPaths::prepare(base.join(dir))
    }

    /// Create (or tighten) the data dir and `backups/` as owner-only (0700), and tighten an
    /// existing `raven.db`, `vault.json` and backup files to 0600.
    pub fn prepare(root: PathBuf) -> AppResult<DataPaths> {
        let paths = DataPaths::for_root(root);
        private_dir(&paths.root)?;
        private_dir(&paths.backups)?;
        tighten_existing(&paths, set_mode);
        Ok(paths)
    }
}

/// Debug builds only: the data folder to use instead of `raven-dev`, so a run of in-progress work
/// (`npm run tauri:overhaul`) never migrates the vault a plain `tauri dev` opens. Release builds ignore it.
pub const DATA_DIR_ENV: &str = "RAVEN_DATA_DIR";

/// The data folder's name under the app data dir. Release: `raven`. Debug: `raven-dev`, or the
/// `RAVEN_DATA_DIR` override. The override is a folder name, not a path, and must start with `raven-`
/// (lowercase letters, digits and `-`), so it can't point at the release vault or outside the app data dir.
/// A bad override is an error, not a fallback: a typo must never quietly open the `raven-dev` vault.
fn data_dir_name(debug: bool, override_dir: Option<&str>) -> AppResult<String> {
    if !debug {
        return Ok("raven".into());
    }
    let Some(name) = override_dir.filter(|n| !n.is_empty()) else {
        return Ok("raven-dev".into());
    };
    let rest = name.strip_prefix("raven-").unwrap_or("");
    let valid = !rest.is_empty() && rest.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid {
        return Err(AppError::Validation {
            field: DATA_DIR_ENV.into(),
            message: format!(
                "{DATA_DIR_ENV} must be a folder name like raven-overhaul (raven- then lowercase letters, digits or -), got {name:?}"
            ),
        });
    }
    Ok(name.into())
}

/// Best-effort 0600 on existing files (db, vault.json, backups). A file we can't chmod
/// (e.g. owned by another user) is logged and skipped; it must not stop Raven from starting.
fn tighten_existing(paths: &DataPaths, setter: impl Fn(&Path, u32) -> AppResult<()>) {
    let try_set = |f: &Path| {
        if let Err(e) = setter(f, 0o600) {
            eprintln!("raven: could not tighten permissions on {}: {e}", f.display());
        }
    };
    for f in [&paths.db, &paths.vault_meta] {
        if f.is_file() {
            try_set(f);
        }
    }
    match std::fs::read_dir(&paths.backups) {
        Ok(rd) => {
            for entry in rd.flatten() {
                if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    try_set(&entry.path());
                }
            }
        }
        Err(e) => eprintln!("raven: could not list backups: {e}"),
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

    #[test]
    fn release_always_uses_raven_and_ignores_the_override() {
        assert_eq!(data_dir_name(false, None).unwrap(), "raven");
        assert_eq!(data_dir_name(false, Some("raven-overhaul")).unwrap(), "raven");
        assert_eq!(data_dir_name(false, Some("../elsewhere")).unwrap(), "raven");
    }

    #[test]
    fn debug_uses_raven_dev_without_an_override() {
        assert_eq!(data_dir_name(true, None).unwrap(), "raven-dev");
        assert_eq!(data_dir_name(true, Some("")).unwrap(), "raven-dev");
    }

    #[test]
    fn debug_override_picks_its_own_folder() {
        assert_eq!(data_dir_name(true, Some("raven-overhaul")).unwrap(), "raven-overhaul");
        assert_eq!(data_dir_name(true, Some("raven-rav-71")).unwrap(), "raven-rav-71");
    }

    #[test]
    fn debug_override_rejects_anything_but_a_raven_folder_name() {
        for bad in ["raven", "raven-", "overhaul", "Raven-overhaul", "raven-Overhaul", "raven-a/b", "raven-../x", "/tmp/raven-x", "raven- x"] {
            assert!(
                matches!(data_dir_name(true, Some(bad)), Err(AppError::Validation { .. })),
                "{bad:?} should be rejected"
            );
        }
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

    #[test]
    fn prepare_tolerates_unchmoddable_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("raven-dev");
        std::fs::create_dir_all(root.join("backups")).unwrap();
        std::fs::write(root.join("raven.db"), b"x").unwrap();
        std::fs::write(root.join("vault.json"), b"x").unwrap();
        let paths = DataPaths::for_root(root);
        let seen = std::cell::RefCell::new(Vec::new());
        tighten_existing(&paths, |p, _| {
            seen.borrow_mut().push(p.to_path_buf());
            if p.ends_with("raven.db") {
                Err(AppError::Io("denied".into()))
            } else {
                Ok(())
            }
        });
        // The failing file did not stop the next one.
        assert_eq!(seen.borrow().len(), 2);
        assert!(DataPaths::prepare(paths.root.clone()).is_ok());
    }

    #[test]
    fn prepare_still_fails_when_root_cannot_be_created() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("file");
        std::fs::write(&blocker, b"x").unwrap();
        assert!(DataPaths::prepare(blocker.join("raven-dev")).is_err());
    }
}
