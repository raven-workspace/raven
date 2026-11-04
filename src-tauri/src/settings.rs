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
const ATTACKER_IP_KEY: &str = "attacker_ip";
const LISTENER_PORT_KEY: &str = "listener_port";
const RETENTION_RANGE: std::ops::RangeInclusive<u32> = 1..=200;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub auto_lock_minutes: u32,
    pub backup_retention: u32,
    pub machines: Vec<String>,
    /// Blank or a single IPv4 address; fills `{LHOST}` in command templates.
    pub attacker_ip: String,
    /// Blank or 1-65535; fills `{LPORT}`.
    pub listener_port: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub auto_lock_minutes: Option<u32>,
    pub backup_retention: Option<u32>,
    pub machines: Option<Vec<String>>,
    pub attacker_ip: Option<String>,
    pub listener_port: Option<String>,
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
    let text = |key: &str| {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get::<_, String>(0)).unwrap_or_default()
    };
    let attacker_ip = clean_ip(&text(ATTACKER_IP_KEY)).unwrap_or_default();
    let listener_port = clean_port(&text(LISTENER_PORT_KEY)).unwrap_or_default();
    Ok(Settings { auto_lock_minutes, backup_retention, machines, attacker_ip, listener_port })
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

fn bad(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

/// Blank, or a single IPv4 address (no prefix).
fn clean_ip(s: &str) -> AppResult<String> {
    let s = s.trim();
    if s.is_empty() || (!s.contains('/') && crate::engagements::valid_cidr(s)) {
        Ok(s.to_string())
    } else {
        Err(bad("attackerIp", "must be blank or a single IPv4 address"))
    }
}

/// Blank, or a port 1-65535 (stored without leading zeros).
fn clean_port(s: &str) -> AppResult<String> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(String::new());
    }
    match s.parse::<u16>() {
        Ok(n) if n >= 1 && s.bytes().all(|b| b.is_ascii_digit()) => Ok(n.to_string()),
        _ => Err(bad("listenerPort", "must be blank or a port from 1 to 65535")),
    }
}

fn put(conn: &Connection, key: &str, v: u32) -> AppResult<()> {
    put_text(conn, key, &v.to_string())
}

fn put_text(conn: &Connection, key: &str, v: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, v],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, patch: SettingsPatch) -> AppResult<Settings> {
    check("autoLockMinutes", patch.auto_lock_minutes, &AUTO_LOCK_RANGE)?;
    check("backupRetention", patch.backup_retention, &RETENTION_RANGE)?;
    let machines = patch.machines.map(clean_machines).transpose()?;
    let attacker_ip = patch.attacker_ip.as_deref().map(clean_ip).transpose()?;
    let listener_port = patch.listener_port.as_deref().map(clean_port).transpose()?;
    if let Some(v) = attacker_ip {
        put_text(conn, ATTACKER_IP_KEY, &v)?;
    }
    if let Some(v) = listener_port {
        put_text(conn, LISTENER_PORT_KEY, &v)?;
    }
    if let Some(n) = patch.auto_lock_minutes {
        put(conn, AUTO_LOCK_KEY, n)?;
    }
    if let Some(n) = patch.backup_retention {
        put(conn, RETENTION_KEY, n)?;
    }
    if let Some(m) = machines {
        let json = serde_json::to_string(&m).map_err(|e| AppError::Db(e.to_string()))?;
        put_text(conn, MACHINES_KEY, &json)?;
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

    #[test]
    fn settings_attacker_ip_and_port_validated() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let s = get(c).unwrap();
        assert_eq!((s.attacker_ip.as_str(), s.listener_port.as_str()), ("", ""));
        for bad in ["10.0.0", "10.0.0.0/24", "300.1.1.1", "kali.local", "10.0.0.1/32"] {
            let p = SettingsPatch { attacker_ip: Some(bad.into()), ..Default::default() };
            match update(c, p) {
                Err(AppError::Validation { field, .. }) => assert_eq!(field, "attackerIp", "{bad}"),
                o => panic!("{o:?}"),
            }
        }
        for bad in ["0", "65536", "http", "-1", "80.5"] {
            let p = SettingsPatch { listener_port: Some(bad.into()), ..Default::default() };
            match update(c, p) {
                Err(AppError::Validation { field, .. }) => assert_eq!(field, "listenerPort", "{bad}"),
                o => panic!("{o:?}"),
            }
        }
        let s = update(c, SettingsPatch { attacker_ip: Some(" 10.10.14.3 ".into()), listener_port: Some("4444".into()), ..Default::default() }).unwrap();
        assert_eq!((s.attacker_ip.as_str(), s.listener_port.as_str()), ("10.10.14.3", "4444"));
        // other settings untouched; a patch without the keys keeps them
        assert_eq!(s.auto_lock_minutes, 30);
        let s = update(c, SettingsPatch { auto_lock_minutes: Some(10), ..Default::default() }).unwrap();
        assert_eq!((s.attacker_ip.as_str(), s.listener_port.as_str()), ("10.10.14.3", "4444"));
        // blank clears
        let s = update(c, SettingsPatch { attacker_ip: Some("  ".into()), listener_port: Some("".into()), ..Default::default() }).unwrap();
        assert_eq!((s.attacker_ip.as_str(), s.listener_port.as_str()), ("", ""));
        assert!(serde_json::to_value(&s).unwrap().get("attackerIp").is_some());
    }
}
