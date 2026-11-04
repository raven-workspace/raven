//! App settings stored as key/value text in the `settings` table.

use crate::backup::read_retention;
use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const AUTO_LOCK_KEY: &str = "auto_lock_minutes";
const RETENTION_KEY: &str = "backup_retention";
const DEFAULT_AUTO_LOCK: u32 = 30;
const AUTO_LOCK_RANGE: std::ops::RangeInclusive<u32> = 1..=240;
const RETENTION_RANGE: std::ops::RangeInclusive<u32> = 1..=200;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub auto_lock_minutes: u32,
    pub backup_retention: u32,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub auto_lock_minutes: Option<u32>,
    pub backup_retention: Option<u32>,
}

pub fn get(conn: &Connection) -> AppResult<Settings> {
    let auto: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [AUTO_LOCK_KEY], |r| r.get(0))
        .ok();
    let auto_lock_minutes = auto
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|n| AUTO_LOCK_RANGE.contains(n))
        .unwrap_or(DEFAULT_AUTO_LOCK);
    // Shared with backup.rs so both always agree on the stored value and default.
    let backup_retention = (read_retention(conn).clamp(1, 200) as u32).max(1);
    Ok(Settings { auto_lock_minutes, backup_retention })
}

fn check(field: &str, v: Option<u32>, range: &std::ops::RangeInclusive<u32>) -> AppResult<()> {
    match v {
        Some(n) if !range.contains(&n) => Err(AppError::Validation {
            field: field.into(),
            message: format!("must be between {} and {}", range.start(), range.end()),
        }),
        _ => Ok(()),
    }
}

fn put(conn: &Connection, key: &str, v: u32) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, v.to_string()],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, patch: SettingsPatch) -> AppResult<Settings> {
    check("autoLockMinutes", patch.auto_lock_minutes, &AUTO_LOCK_RANGE)?;
    check("backupRetention", patch.backup_retention, &RETENTION_RANGE)?;
    if let Some(n) = patch.auto_lock_minutes {
        put(conn, AUTO_LOCK_KEY, n)?;
    }
    if let Some(n) = patch.backup_retention {
        put(conn, RETENTION_KEY, n)?;
    }
    get(conn)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::paths::DataPaths;
    use crate::vault::Vault;

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    #[test]
    fn settings_defaults_and_bounds() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let s = get(c).unwrap();
        assert_eq!((s.auto_lock_minutes, s.backup_retention), (30, 14));
        let bad = SettingsPatch { auto_lock_minutes: Some(0), backup_retention: None };
        match update(c, bad) {
            Err(AppError::Validation { field, .. }) => assert_eq!(field, "autoLockMinutes"),
            o => panic!("{o:?}"),
        }
        let bad = SettingsPatch { auto_lock_minutes: None, backup_retention: Some(201) };
        match update(c, bad) {
            Err(AppError::Validation { field, .. }) => assert_eq!(field, "backupRetention"),
            o => panic!("{o:?}"),
        }
        let s = update(c, SettingsPatch { auto_lock_minutes: Some(240), backup_retention: Some(3) }).unwrap();
        assert_eq!((s.auto_lock_minutes, s.backup_retention), (240, 3));
        assert_eq!(crate::backup::read_retention(c), 3);
        assert_eq!(get(c).unwrap(), s);
    }
}
