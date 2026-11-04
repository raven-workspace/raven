//! App settings stored as key/value text in the `settings` table.

use crate::backup::{read_retention, RETENTION_KEY};
use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const AUTO_LOCK_KEY: &str = "auto_lock_minutes";
const DEFAULT_AUTO_LOCK: u32 = 30;
const AUTO_LOCK_RANGE: std::ops::RangeInclusive<u32> = 1..=240;
const MACHINES_KEY: &str = "machines";
const DEFAULT_MACHINES: [&str; 3] = ["Kali (VM)", "Docker build", "Mac"];
const MAX_MACHINES: usize = 20;
const MAX_MACHINE_LEN: usize = 40;
const RETENTION_RANGE: std::ops::RangeInclusive<u32> = 1..=200;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub auto_lock_minutes: u32,
    pub backup_retention: u32,
    pub machines: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub auto_lock_minutes: Option<u32>,
    pub backup_retention: Option<u32>,
    pub machines: Option<Vec<String>>,
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
    let machines = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [MACHINES_KEY], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
        .and_then(|v| clean_machines(v).ok())
        .unwrap_or_else(|| DEFAULT_MACHINES.iter().map(|s| s.to_string()).collect());
    Ok(Settings { auto_lock_minutes, backup_retention, machines })
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

/// Trims each label, drops case-insensitive duplicates (first wins), enforces 1-20 labels of 1-40 chars.
fn clean_machines(list: Vec<String>) -> AppResult<Vec<String>> {
    let bad = |m: &str| AppError::Validation { field: "machines".into(), message: m.into() };
    let mut out: Vec<String> = Vec::new();
    for m in list {
        let m = m.trim().to_string();
        if m.is_empty() || m.chars().count() > MAX_MACHINE_LEN {
            return Err(bad("each machine name must be 1-40 characters"));
        }
        if !out.iter().any(|x| x.to_lowercase() == m.to_lowercase()) {
            out.push(m);
        }
    }
    if out.is_empty() || out.len() > MAX_MACHINES {
        return Err(bad("keep between 1 and 20 machines"));
    }
    Ok(out)
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
    let machines = patch.machines.map(clean_machines).transpose()?;
    if let Some(n) = patch.auto_lock_minutes {
        put(conn, AUTO_LOCK_KEY, n)?;
    }
    if let Some(n) = patch.backup_retention {
        put(conn, RETENTION_KEY, n)?;
    }
    if let Some(m) = machines {
        let json = serde_json::to_string(&m).map_err(|e| AppError::Db(e.to_string()))?;
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![MACHINES_KEY, json],
        )?;
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
        let bad = SettingsPatch { auto_lock_minutes: Some(0), ..Default::default() };
        match update(c, bad) {
            Err(AppError::Validation { field, .. }) => assert_eq!(field, "autoLockMinutes"),
            o => panic!("{o:?}"),
        }
        let bad = SettingsPatch { backup_retention: Some(201), ..Default::default() };
        match update(c, bad) {
            Err(AppError::Validation { field, .. }) => assert_eq!(field, "backupRetention"),
            o => panic!("{o:?}"),
        }
        let s = update(c, SettingsPatch { auto_lock_minutes: Some(240), backup_retention: Some(3), ..Default::default() }).unwrap();
        assert_eq!((s.auto_lock_minutes, s.backup_retention), (240, 3));
        assert_eq!(crate::backup::read_retention(c), 3);
        assert_eq!(get(c).unwrap(), s);
    }

    fn machines_err(patch: Vec<&str>) -> String {
        let p = SettingsPatch { machines: Some(patch.into_iter().map(str::to_string).collect()), ..Default::default() };
        match update(unlocked().1.conn().unwrap(), p) {
            Err(AppError::Validation { field, .. }) => field,
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn machines_setting_default_and_validation() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        assert_eq!(get(c).unwrap().machines, ["Kali (VM)", "Docker build", "Mac"]);
        let j = serde_json::to_value(get(c).unwrap()).unwrap();
        assert_eq!(j["machines"][0], "Kali (VM)");
        // trimmed, duplicates (case-insensitive) removed, order kept
        let s = update(c, SettingsPatch { machines: Some(vec![" Kali (VM) ".into(), "kali (vm)".into(), "Pi".into()]), ..Default::default() }).unwrap();
        assert_eq!(s.machines, ["Kali (VM)", "Pi"]);
        assert_eq!(get(c).unwrap().machines, ["Kali (VM)", "Pi"]);
        // other settings untouched by a machines-only patch
        assert_eq!(s.auto_lock_minutes, 30);
        // invalid: empty list, blank entry, too long, too many
        assert_eq!(machines_err(vec![]), "machines");
        assert_eq!(machines_err(vec!["ok", "   "]), "machines");
        assert_eq!(machines_err(vec![&"a".repeat(41)]), "machines");
        let many: Vec<String> = (0..21).map(|i| format!("m{i}")).collect();
        let many: Vec<&str> = many.iter().map(String::as_str).collect();
        assert_eq!(machines_err(many), "machines");
        let ok: Vec<String> = (0..20).map(|i| format!("m{i}")).collect();
        update(c, SettingsPatch { machines: Some(ok), ..Default::default() }).unwrap();
        update(c, SettingsPatch { machines: Some(vec!["a".repeat(40)]), ..Default::default() }).unwrap();
        // corrupt stored value falls back to the default
        c.execute("INSERT INTO settings(key,value) VALUES('machines','not json') ON CONFLICT(key) DO UPDATE SET value=excluded.value", []).unwrap();
        assert_eq!(get(c).unwrap().machines, ["Kali (VM)", "Docker build", "Mac"]);
    }
}
