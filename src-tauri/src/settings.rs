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
const KALI_USER_KEY: &str = "kali_user";
const WINDOWS_TOOLS_KEY: &str = "windows_tools_dir";
const LINUX_TOOLS_KEY: &str = "linux_tools_dir";
const FIELD_MANUAL_KEY: &str = "field_manual_path";
const DEFAULT_KALI_USER: &str = "kali";
const DEFAULT_WINDOWS_TOOLS: &str = "~/tools/windows";
const DEFAULT_LINUX_TOOLS: &str = "~/tools/linux";
const DEFAULT_FIELD_MANUAL: &str = "~/Documents/Field Manual";
const MAX_PATH_LEN: usize = 500;
/// The NIST NVD API key. Stored in the encrypted vault; never sent to the frontend.
const NVD_KEY_KEY: &str = "nvd_api_key";
const MAX_NVD_KEY_LEN: usize = 128;
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
    /// Fills `{KALI_USER}`; defaults to `kali`.
    pub kali_user: String,
    /// Where Windows / Linux tools live on Kali. Used only by the "Transfer a file" generator: its Kali serve
    /// command's leading `cd ~/tools/windows` (or `~/tools/linux`) becomes this folder. No other command is rewritten.
    pub windows_tools_dir: String,
    pub linux_tools_dir: String,
    /// The Field-Manual vault Raven reads its library from.
    pub field_manual_path: String,
    /// Whether an NVD API key is stored. The key itself is never returned.
    pub nvd_key_set: bool,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsPatch {
    pub auto_lock_minutes: Option<u32>,
    pub backup_retention: Option<u32>,
    pub machines: Option<Vec<String>>,
    pub attacker_ip: Option<String>,
    pub listener_port: Option<String>,
    pub kali_user: Option<String>,
    pub windows_tools_dir: Option<String>,
    pub linux_tools_dir: Option<String>,
    pub field_manual_path: Option<String>,
    /// Sets the NVD API key; an empty string clears it.
    pub nvd_api_key: Option<String>,
}

/// Debug output never shows the NVD API key, only whether the patch sets one.
impl std::fmt::Debug for SettingsPatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SettingsPatch")
            .field("auto_lock_minutes", &self.auto_lock_minutes)
            .field("backup_retention", &self.backup_retention)
            .field("machines", &self.machines)
            .field("attacker_ip", &self.attacker_ip)
            .field("listener_port", &self.listener_port)
            .field("kali_user", &self.kali_user)
            .field("windows_tools_dir", &self.windows_tools_dir)
            .field("linux_tools_dir", &self.linux_tools_dir)
            .field("field_manual_path", &self.field_manual_path)
            .field("nvd_api_key", &self.nvd_api_key.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

/// The stored NVD API key, or "" when none is set. For the NVD lookup only.
pub fn nvd_api_key(conn: &Connection) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [NVD_KEY_KEY], |r| r.get::<_, String>(0))
        .unwrap_or_default()
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
    let kali_user = clean_kali_user(&text(KALI_USER_KEY)).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| DEFAULT_KALI_USER.into());
    let path_or = |key: &str, field: &str, default: &str| {
        clean_path(field, &text(key)).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
    };
    let windows_tools_dir = path_or(WINDOWS_TOOLS_KEY, "windowsToolsDir", DEFAULT_WINDOWS_TOOLS);
    let linux_tools_dir = path_or(LINUX_TOOLS_KEY, "linuxToolsDir", DEFAULT_LINUX_TOOLS);
    let field_manual_path = path_or(FIELD_MANUAL_KEY, "fieldManualPath", DEFAULT_FIELD_MANUAL);
    Ok(Settings {
        auto_lock_minutes,
        backup_retention,
        machines,
        attacker_ip,
        listener_port,
        kali_user,
        windows_tools_dir,
        linux_tools_dir,
        field_manual_path,
        nvd_key_set: !zeroize::Zeroizing::new(nvd_api_key(conn)).is_empty(),
    })
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

/// Blank (restores the default), or a unix-style account name of at most 32 characters.
fn clean_kali_user(s: &str) -> AppResult<String> {
    let s = s.trim();
    let ok = s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')) && s.chars().count() <= 32;
    if ok {
        Ok(s.to_string())
    } else {
        Err(bad("kaliUser", "use letters, digits, _ - . only (max 32)"))
    }
}

/// Blank (restores the default), or a single-line path of at most 500 characters.
fn clean_path(field: &str, s: &str) -> AppResult<String> {
    let s = s.trim();
    if s.chars().count() > MAX_PATH_LEN || s.chars().any(char::is_control) {
        Err(bad(field, "must be a single-line path of at most 500 characters"))
    } else {
        Ok(s.to_string())
    }
}

/// A `clean_path` that is also a folder on Kali: a Windows drive path or a backslash is rejected on the way in.
/// Reads stay lenient, so an already-stored bad value still loads and can be fixed.
fn clean_tools_dir(field: &str, s: &str) -> AppResult<String> {
    let s = clean_path(field, s)?;
    let b = s.as_bytes();
    let drive = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'\\' | b'/');
    if drive || s.contains('\\') {
        Err(bad(field, "must be a folder on Kali, like ~/tools/windows"))
    } else {
        Ok(s)
    }
}

/// Blank (clears it), or 1-128 printable ASCII characters with no spaces: it is sent as an HTTP header.
fn clean_nvd_key(s: &str) -> AppResult<String> {
    let s = s.trim();
    if s.len() <= MAX_NVD_KEY_LEN && s.bytes().all(|b| b.is_ascii_graphic()) {
        Ok(s.to_string())
    } else {
        Err(bad("nvdApiKey", "paste the key exactly as NVD sent it"))
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
    let kali_user = patch.kali_user.as_deref().map(clean_kali_user).transpose()?;
    let windows_tools = patch.windows_tools_dir.as_deref().map(|v| clean_tools_dir("windowsToolsDir", v)).transpose()?;
    let linux_tools = patch.linux_tools_dir.as_deref().map(|v| clean_tools_dir("linuxToolsDir", v)).transpose()?;
    let field_manual = patch.field_manual_path.as_deref().map(|v| clean_path("fieldManualPath", v)).transpose()?;
    let nvd_key = patch.nvd_api_key.as_deref().map(clean_nvd_key).transpose()?;
    for (key, v) in [
        (KALI_USER_KEY, kali_user),
        (WINDOWS_TOOLS_KEY, windows_tools),
        (LINUX_TOOLS_KEY, linux_tools),
        (FIELD_MANUAL_KEY, field_manual),
    ] {
        if let Some(v) = v {
            put_text(conn, key, &v)?;
        }
    }
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
    match nvd_key.as_deref() {
        Some("") => {
            conn.execute("DELETE FROM settings WHERE key = ?1", [NVD_KEY_KEY])?;
        }
        Some(k) => put_text(conn, NVD_KEY_KEY, k)?,
        None => {}
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
    fn tools_dir_rejects_windows_paths() {
        assert!(clean_tools_dir("windowsToolsDir", r"C:\Tools").is_err());
        assert!(clean_tools_dir("linuxToolsDir", "d:/tools").is_err());
        assert!(clean_tools_dir("windowsToolsDir", r"~/tools\win").is_err());
        assert!(clean_tools_dir("windowsToolsDir", "~/tools/windows").is_ok());
        assert!(clean_tools_dir("windowsToolsDir", "").is_ok());
        match clean_tools_dir("windowsToolsDir", r"C:\Tools") {
            Err(AppError::Validation { field, message }) => {
                assert_eq!(field, "windowsToolsDir");
                assert_eq!(message, "must be a folder on Kali, like ~/tools/windows");
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
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

    #[test]
    fn settings_kali_user_and_tool_dirs_round_trip() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let s = get(c).unwrap();
        assert_eq!((s.kali_user.as_str(), s.windows_tools_dir.as_str(), s.linux_tools_dir.as_str()), ("kali", "~/tools/windows", "~/tools/linux"));
        let p = SettingsPatch {
            kali_user: Some(" op ".into()),
            windows_tools_dir: Some("/opt/win".into()),
            linux_tools_dir: Some("/opt/lin".into()),
            ..Default::default()
        };
        let s = update(c, p).unwrap();
        assert_eq!((s.kali_user.as_str(), s.windows_tools_dir.as_str(), s.linux_tools_dir.as_str()), ("op", "/opt/win", "/opt/lin"));
        // a patch without the keys keeps them
        let s = update(c, SettingsPatch { auto_lock_minutes: Some(10), ..Default::default() }).unwrap();
        assert_eq!(s.kali_user, "op");
        // blank restores the default
        let s = update(c, SettingsPatch { kali_user: Some("  ".into()), linux_tools_dir: Some("".into()), ..Default::default() }).unwrap();
        assert_eq!((s.kali_user.as_str(), s.linux_tools_dir.as_str()), ("kali", "~/tools/linux"));
        for bad in ["a b", "x;y", &"a".repeat(33)] {
            match update(c, SettingsPatch { kali_user: Some(bad.into()), ..Default::default() }) {
                Err(AppError::Validation { field, .. }) => assert_eq!(field, "kaliUser", "{bad}"),
                o => panic!("{o:?}"),
            }
        }
        let j = serde_json::to_value(&s).unwrap();
        assert!(j.get("kaliUser").is_some() && j.get("windowsToolsDir").is_some() && j.get("linuxToolsDir").is_some());
    }

    #[test]
    fn field_manual_path_defaults() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let def = "~/Documents/Field Manual";
        assert_eq!(get(c).unwrap().field_manual_path, def);
        let s = update(c, SettingsPatch { field_manual_path: Some("/Volumes/x/FM".into()), ..Default::default() }).unwrap();
        assert_eq!(s.field_manual_path, "/Volumes/x/FM");
        let s = update(c, SettingsPatch { field_manual_path: Some(" ".into()), ..Default::default() }).unwrap();
        assert_eq!(s.field_manual_path, def);
        assert!(serde_json::to_value(&s).unwrap().get("fieldManualPath").is_some());
    }

    #[test]
    fn settings_nvd_key_is_stored_but_never_returned() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        assert!(!get(c).unwrap().nvd_key_set);
        assert_eq!(nvd_api_key(c), "");
        let key = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
        let s = update(c, SettingsPatch { nvd_api_key: Some(format!(" {key} ")), ..Default::default() }).unwrap();
        assert!(s.nvd_key_set);
        assert_eq!(nvd_api_key(c), key);
        let p = SettingsPatch { nvd_api_key: Some(key.into()), ..Default::default() };
        assert!(!format!("{p:?}").contains(key));
        // settings_get never carries the key, under any field name
        let j = serde_json::to_string(&crate::commands::settings_get_inner(&v).unwrap()).unwrap();
        assert!(!j.contains(key), "{j}");
        assert!(j.contains("\"nvdKeySet\":true"), "{j}");
        assert!(!j.contains("nvdApiKey"), "{j}");
        // a patch without the key keeps it
        let s = update(c, SettingsPatch { auto_lock_minutes: Some(10), ..Default::default() }).unwrap();
        assert!(s.nvd_key_set);
        // a key with whitespace or control characters inside is refused
        for bad in ["a b", "a\r\nX-Evil: 1", &"k".repeat(129)] {
            match update(c, SettingsPatch { nvd_api_key: Some(bad.into()), ..Default::default() }) {
                Err(AppError::Validation { field, .. }) => assert_eq!(field, "nvdApiKey", "{bad}"),
                o => panic!("{o:?}"),
            }
        }
        assert_eq!(nvd_api_key(c), key);
        // an empty string clears it
        let s = update(c, SettingsPatch { nvd_api_key: Some("  ".into()), ..Default::default() }).unwrap();
        assert!(!s.nvd_key_set);
        assert_eq!(nvd_api_key(c), "");
        let n: i64 = c.query_row("SELECT COUNT(*) FROM settings WHERE key='nvd_api_key'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
