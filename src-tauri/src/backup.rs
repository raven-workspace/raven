//! Encrypted backups: take, list, retention, daily, restore.
//!
//! A backup is `raven-<yyyyMMdd-HHmmss>-<reason>[-N].db` (UTC) plus a companion
//! `raven-<...>.vault.json` copy of the KDF salt/params, in `backups/`. Files are written
//! under a temporary name and linked into place without clobbering, so a crash never
//! leaves a half-written file under a real backup name and two backups in the same second
//! never overwrite each other (the second gets a `-2` suffix, and so on).

use crate::error::{AppError, AppResult};
use crate::paths::DataPaths;
use crate::vault::{is_unreadable, normalize_password, open_keyed, pragma_for, write_private_file, BackupHook, Vault, VaultMeta};
use rusqlite::{Connection, ErrorCode, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const DEFAULT_RETENTION: i64 = 14;
pub(crate) const RETENTION_KEY: &str = "backup_retention";
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const PREFIX: &str = "raven-";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file: String,
    pub reason: String,
    pub created_at: i64,
    pub size_bytes: u64,
}

pub fn system_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `backup_retention` from the `settings` table (integer text); default 14, minimum 1.
pub fn read_retention(conn: &Connection) -> i64 {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [RETENTION_KEY], |r| {
        r.get::<_, String>(0)
    })
    .ok()
    .and_then(|v| v.trim().parse::<i64>().ok())
    .map(|n| n.max(1))
    .unwrap_or(DEFAULT_RETENTION)
}

// ---- date helpers (UTC, proleptic Gregorian) ----

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn format_stamp(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let (y, mo, d) = civil_from_days(secs.div_euclid(86_400));
    let t = secs.rem_euclid(86_400);
    format!("{y:04}{mo:02}{d:02}-{:02}{:02}{:02}", t / 3600, (t % 3600) / 60, t % 60)
}

fn parse_stamp(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 15 || b[8] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<i64> {
        let part = &s[r];
        if part.bytes().all(|c| c.is_ascii_digit()) { part.parse().ok() } else { None }
    };
    let (y, mo, d) = (digits(0..4)?, digits(4..6)?, digits(6..8)?);
    let (h, mi, se) = (digits(9..11)?, digits(11..13)?, digits(13..15)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    Some((days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se) * 1000)
}

// ---- file name parsing ----

struct Parsed {
    reason: String,
    created_at: i64,
    seq: u32,
}

fn parse_name(file: &str) -> Option<Parsed> {
    let rest = file.strip_prefix(PREFIX)?.strip_suffix(".db")?;
    if rest.len() < 17 || !rest.is_char_boundary(15) {
        return None;
    }
    let created_at = parse_stamp(&rest[..15])?;
    let tail = rest[15..].strip_prefix('-')?;
    let (reason, seq) = match tail.rsplit_once('-') {
        Some((r, n)) if !r.is_empty() && !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()) => {
            (r, n.parse().ok()?)
        }
        _ => (tail, 1),
    };
    if reason.is_empty() {
        return None;
    }
    Some(Parsed { reason: reason.to_string(), created_at, seq })
}

fn valid_reason(reason: &str) -> bool {
    !reason.is_empty()
        && !reason.starts_with('-')
        && !reason.ends_with('-')
        && reason.bytes().all(|c| c.is_ascii_lowercase() || c == b'-')
}

fn companion_name(db_file: &str) -> String {
    format!("{}.vault.json", db_file.strip_suffix(".db").unwrap_or(db_file))
}

// ---- list ----

/// Newest first. Parsed from file names and metadata, so it works while locked.
pub fn list(paths: &DataPaths) -> AppResult<Vec<BackupInfo>> {
    Ok(list_sorted(paths)?.into_iter().map(|(_, _, i)| i).collect())
}

fn list_sorted(paths: &DataPaths) -> AppResult<Vec<(i64, u32, BackupInfo)>> {
    let rd = match std::fs::read_dir(&paths.backups) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in rd {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        let Some(p) = parse_name(&name) else { continue };
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        out.push((
            p.created_at,
            p.seq,
            BackupInfo { file: name, reason: p.reason, created_at: p.created_at, size_bytes: meta.len() },
        ));
    }
    out.sort_by(|a, b| (b.0, b.1, &b.2.file).cmp(&(a.0, a.1, &a.2.file)));
    Ok(out)
}

// ---- writing ----

fn ensure_backups_dir(paths: &DataPaths) -> AppResult<()> {
    let mut b = std::fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(&paths.backups)?;
    Ok(())
}

fn tmp_path(paths: &DataPaths) -> PathBuf {
    paths.backups.join(format!(".raven-tmp-{}.part", uuid::Uuid::new_v4()))
}

fn restrict(p: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = p;
}

fn sync_file(p: &Path) -> AppResult<()> {
    std::fs::File::open(p)?.sync_all()?;
    Ok(())
}

/// Link `tmp` to `dest` without overwriting; `Ok(false)` if `dest` already exists.
fn link_no_clobber(tmp: &Path, dest: &Path) -> AppResult<bool> {
    match std::fs::hard_link(tmp, dest) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// Publish a finished temp db (and a copy of vault.json) under the next free name.
fn publish(paths: &DataPaths, tmp_db: &Path, reason: &str, now_ms: i64) -> AppResult<BackupInfo> {
    let stamp = format_stamp(now_ms);
    let mut seq = 1u32;
    let file = loop {
        let file = if seq == 1 {
            format!("{PREFIX}{stamp}-{reason}.db")
        } else {
            format!("{PREFIX}{stamp}-{reason}-{seq}.db")
        };
        if link_no_clobber(tmp_db, &paths.backups.join(&file))? {
            break file;
        }
        seq += 1;
        if seq > 10_000 {
            return Err(AppError::Io("too many backups in the same second".into()));
        }
    };
    let _ = std::fs::remove_file(tmp_db);
    // Companion vault.json (same stem). Best-effort for a vault.json that is missing.
    if paths.vault_meta.exists() {
        let tmp_meta = tmp_path(paths);
        let res = (|| -> AppResult<()> {
            std::fs::copy(&paths.vault_meta, &tmp_meta)?;
            restrict(&tmp_meta);
            sync_file(&tmp_meta)?;
            link_no_clobber(&tmp_meta, &paths.backups.join(companion_name(&file)))?;
            Ok(())
        })();
        let _ = std::fs::remove_file(&tmp_meta);
        res?;
    }
    let size_bytes = std::fs::metadata(paths.backups.join(&file))?.len();
    Ok(BackupInfo { file, reason: reason.to_string(), created_at: now_ms.div_euclid(1000) * 1000, size_bytes })
}

fn prune(paths: &DataPaths, retention: i64, keep: &str) {
    let Ok(all) = list_sorted(paths) else { return };
    for (idx, (_, _, info)) in all.iter().enumerate() {
        if (idx as i64) < retention || info.file == keep {
            continue;
        }
        let _ = std::fs::remove_file(paths.backups.join(&info.file));
        let _ = std::fs::remove_file(paths.backups.join(companion_name(&info.file)));
    }
}

fn open_with_pragma(path: &Path, pragma: &str) -> Result<Connection, rusqlite::Error> {
    let c = open_keyed(path, pragma, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    c.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
    Ok(c)
}

/// Encrypted copy of the live database (same key). Prunes to the retention count afterwards.
pub fn take(vault: &Vault, reason: &str) -> AppResult<BackupInfo> {
    take_at(vault, reason, system_now_ms())
}

pub fn take_at(vault: &Vault, reason: &str, now_ms: i64) -> AppResult<BackupInfo> {
    if !valid_reason(reason) {
        return Err(AppError::Validation { field: "reason".into(), message: "invalid backup reason".into() });
    }
    let conn = vault.conn()?;
    let pragma = vault.key_pragma()?;
    let paths = vault.paths();
    ensure_backups_dir(paths)?;
    let tmp = tmp_path(paths);
    let res = (|| -> AppResult<BackupInfo> {
        let tmp_str = tmp.to_str().ok_or_else(|| AppError::Io("non-UTF-8 backup path".into()))?;
        // VACUUM INTO keeps the source's encryption key and user_version.
        conn.execute("VACUUM INTO ?1", [tmp_str])?;
        restrict(&tmp);
        // Verify before it gets a real name: opens with the key and matches the schema version.
        let src_v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let check = open_with_pragma(&tmp, &pragma)
            .and_then(|c| c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)));
        if check.ok() != Some(src_v) {
            return Err(AppError::Io("backup verification failed".into()));
        }
        sync_file(&tmp)?;
        publish(paths, &tmp, reason, now_ms)
    })();
    let _ = std::fs::remove_file(&tmp);
    let info = res?;
    prune(paths, read_retention(conn), &info.file);
    Ok(info)
}

/// File-level backup of the encrypted `raven.db` (no connection or key needed). Only valid
/// while nothing is writing to the db, e.g. before the first migration write on unlock.
/// Never prunes: the user's retention setting can't be read here (the db may be pre-migration),
/// so the next normal `take` prunes with the real setting.
pub fn take_file_level(paths: &DataPaths, reason: &str, now_ms: i64) -> AppResult<BackupInfo> {
    if !valid_reason(reason) {
        return Err(AppError::Validation { field: "reason".into(), message: "invalid backup reason".into() });
    }
    ensure_backups_dir(paths)?;
    let tmp = tmp_path(paths);
    let res = (|| -> AppResult<BackupInfo> {
        std::fs::copy(&paths.db, &tmp)?;
        restrict(&tmp);
        sync_file(&tmp)?;
        publish(paths, &tmp, reason, now_ms)
    })();
    let _ = std::fs::remove_file(&tmp);
    res
}

/// The Vault's default pre-migration hook: file-level copy with reason `pre-migration`.
pub fn pre_migration_hook(paths: DataPaths) -> BackupHook {
    Box::new(move |_from, _to| take_file_level(&paths, "pre-migration", system_now_ms()).map(|_| ()))
}

/// Take a `daily` backup if the newest backup (any reason) is older than 24h, or none exists.
pub fn take_daily_if_due(vault: &Vault) -> AppResult<Option<BackupInfo>> {
    take_daily_if_due_at(vault, system_now_ms())
}

pub fn take_daily_if_due_at(vault: &Vault, now_ms: i64) -> AppResult<Option<BackupInfo>> {
    vault.conn()?;
    let newest = list(vault.paths())?.first().map(|b| b.created_at);
    match newest {
        Some(t) if now_ms - t <= DAY_MS => Ok(None),
        _ => take_at(vault, "daily", now_ms).map(Some),
    }
}

// ---- restore ----

pub fn restore(vault: &mut Vault, file: &str) -> AppResult<()> {
    restore_at(vault, file, system_now_ms())
}

fn validate_backup_name(file: &str) -> AppResult<()> {
    if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") || file.contains('\0') {
        return Err(AppError::Validation { field: "file".into(), message: "invalid backup file name".into() });
    }
    if parse_name(file).is_none() {
        return Err(AppError::Validation { field: "file".into(), message: "not a Raven backup file".into() });
    }
    Ok(())
}

/// Remove `-journal`/`-wal`/`-shm` files left for `raven.db`: they belong to the replaced database.
fn remove_stale_journals(paths: &DataPaths) {
    let db = paths.db.to_string_lossy().into_owned();
    for suffix in ["-journal", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{db}{suffix}"));
    }
}

pub fn restore_at(vault: &mut Vault, file: &str, now_ms: i64) -> AppResult<()> {
    validate_backup_name(file)?;
    vault.conn()?; // must be unlocked
    let pragma = vault.key_pragma()?;
    let paths = vault.paths().clone();
    let src = paths.backups.join(file);
    if !src.is_file() {
        return Err(AppError::NotFound);
    }
    // Stage a private copy next to raven.db first: the pre-restore backup's retention pruning
    // can then never remove the file being restored. Nothing live is touched yet.
    let staged = paths.root.join(format!("raven.db.restore-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> AppResult<()> {
        std::fs::copy(&src, &staged)?;
        restrict(&staged);
        sync_file(&staged)?;
        match open_with_pragma(&staged, &pragma) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == ErrorCode::NotADatabase => {
                return Err(AppError::Validation {
                    field: "file".into(),
                    message: "This backup was made with a different password".into(),
                });
            }
            Err(e) => return Err(e.into()),
        }
        take_at(vault, "pre-restore", now_ms)?;
        vault.lock();
        std::fs::rename(&staged, &paths.db)?;
        remove_stale_journals(&paths);
        Ok(())
    })();
    let _ = std::fs::remove_file(&staged);
    result
}

/// Restore a backup while locked, for a database Raven can't read (`AppError::Damaged`).
///
/// The key comes from the backup's companion `vault.json` (the live one when it has none)
/// and `password`. A wrong password changes nothing. The live `raven.db` is renamed to
/// `raven.db.damaged-<ms>` and kept; no pre-restore backup is taken because it can't be
/// read. The companion meta then replaces `vault.json`. The vault is left locked.
pub fn restore_locked(vault: &mut Vault, file: &str, password: &str) -> AppResult<()> {
    restore_locked_at(vault, file, password, system_now_ms())
}

pub fn restore_locked_at(vault: &mut Vault, file: &str, password: &str, now_ms: i64) -> AppResult<()> {
    validate_backup_name(file)?;
    // While unlocked, `restore` is the path: it takes a pre-restore backup first.
    if vault.is_unlocked() {
        return Err(AppError::Validation {
            field: "file".into(),
            message: "Lock Raven before restoring this way".into(),
        });
    }
    let paths = vault.paths().clone();
    let src = paths.backups.join(file);
    if !src.is_file() {
        return Err(AppError::NotFound);
    }
    let companion = paths.backups.join(companion_name(file));
    let companion = companion.is_file().then_some(companion);
    let meta = VaultMeta::read(companion.as_deref().unwrap_or(&paths.vault_meta))?;
    let wrong_password =
        || AppError::Validation { field: "password".into(), message: "Wrong password for this backup".into() };
    let key = meta.derive_key(&normalize_password(password))?;
    let verified = match meta.verifier_matches(&key) {
        Some(false) => return Err(wrong_password()),
        Some(true) => true,
        None => false,
    };
    let pragma = pragma_for(&key);
    drop(key);

    let staged = paths.root.join(format!("raven.db.restore-{}.tmp", uuid::Uuid::new_v4()));
    let staged_meta = paths.vault_meta.with_extension("json.restore.tmp");
    let result = (|| -> AppResult<()> {
        std::fs::copy(&src, &staged)?;
        restrict(&staged);
        sync_file(&staged)?;
        match open_with_pragma(&staged, &pragma) {
            Ok(_) => {}
            // The verifier proved the password, so the backup file itself is unreadable.
            Err(e) if verified && is_unreadable(&e) => {
                return Err(AppError::Validation { field: "file".into(), message: "This backup is damaged".into() });
            }
            Err(rusqlite::Error::SqliteFailure(e, _)) if !verified && e.code == ErrorCode::NotADatabase => {
                return Err(wrong_password());
            }
            Err(e) => return Err(e.into()),
        }
        // Prepare the new vault.json before touching anything live, so the swap below is
        // only renames.
        if let Some(c) = &companion {
            write_private_file(&staged_meta, &std::fs::read(c)?)?;
        }
        vault.lock();
        let damaged = paths.root.join(format!("raven.db.damaged-{now_ms}"));
        if paths.db.exists() {
            std::fs::rename(&paths.db, &damaged)?;
        }
        if let Err(e) = std::fs::rename(&staged, &paths.db) {
            let _ = std::fs::rename(&damaged, &paths.db);
            return Err(e.into());
        }
        remove_stale_journals(&paths);
        if companion.is_some() {
            std::fs::rename(&staged_meta, &paths.vault_meta)?;
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(&staged);
    let _ = std::fs::remove_file(&staged_meta);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const PW: &str = "correct horse battery";
    const H: i64 = 3_600_000;
    const T0: i64 = 1_800_000_000_000;

    fn setup() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test(PW).unwrap();
        (dir, v)
    }

    fn add_engagement(v: &Vault, id: &str) {
        v.conn()
            .unwrap()
            .execute(
                "INSERT INTO engagements(id,name,kind,created_at,updated_at) VALUES(?1,?1,'lab',1,1)",
                [id],
            )
            .unwrap();
    }

    fn ids(v: &Vault) -> Vec<String> {
        let c = v.conn().unwrap();
        let mut s = c.prepare("SELECT id FROM engagements ORDER BY id").unwrap();
        s.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    fn db_files(v: &Vault) -> Vec<String> {
        list(v.paths()).unwrap().into_iter().map(|b| b.file).collect()
    }

    #[test]
    fn stamp_roundtrip_and_name_parse() {
        assert_eq!(format_stamp(0), "19700101-000000");
        assert_eq!(parse_stamp("20261103-123456"), Some(1_793_709_296_000));
        assert_eq!(format_stamp(1_793_709_296_000), "20261103-123456");
        let p = parse_name("raven-20261103-123456-pre-migration-3.db").unwrap();
        assert_eq!((p.reason.as_str(), p.seq), ("pre-migration", 3));
        let p = parse_name("raven-20261103-123456-manual.db").unwrap();
        assert_eq!((p.reason.as_str(), p.seq), ("manual", 1));
        assert!(parse_name("raven-20261103-123456-manual.vault.json").is_none());
        assert!(parse_name("notes.db").is_none());
    }

    #[test]
    fn backup_is_encrypted_and_opens_with_key() {
        let (_d, v) = setup();
        add_engagement(&v, "A");
        let info = take_at(&v, "manual", T0).unwrap();
        let path = v.paths().backups.join(&info.file);
        let bytes = std::fs::read(&path).unwrap();
        assert_ne!(&bytes[..16], b"SQLite format 3\0");
        assert!(info.size_bytes > 0 && info.reason == "manual");
        let c = open_with_pragma(&path, &v.key_pragma().unwrap()).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM engagements WHERE id='A'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let wrong = "PRAGMA key = \"x'00000000000000000000000000000000000000000000000000000000000000aa'\";";
        assert!(open_with_pragma(&path, wrong).is_err());
        // Companion vault.json with the same stem.
        let comp = v.paths().backups.join(companion_name(&info.file));
        assert_eq!(std::fs::read(comp).unwrap(), std::fs::read(&v.paths().vault_meta).unwrap());
        // No temp files left behind.
        let leftovers = std::fs::read_dir(&v.paths().backups)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().starts_with(".raven-tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn same_second_backups_do_not_overwrite() {
        let (_d, v) = setup();
        let a = take_at(&v, "manual", T0).unwrap();
        let b = take_at(&v, "manual", T0).unwrap();
        assert_ne!(a.file, b.file);
        assert!(b.file.ends_with("-manual-2.db"));
        let l = list(v.paths()).unwrap();
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].file, b.file); // newest first
    }

    #[test]
    fn retention_never_prunes_backup_from_current_operation() {
        let (_d, v) = setup();
        for i in 1..=3 {
            take_at(&v, "manual", T0 + i * 1000).unwrap();
        }
        v.conn().unwrap().execute("INSERT INTO settings(key,value) VALUES('backup_retention','1')", []).unwrap();
        let info = take_at(&v, "manual", T0 + 10_000).unwrap();
        assert_eq!(db_files(&v), vec![info.file.clone()]);
        // Companions were pruned with their db files.
        let json_count = std::fs::read_dir(&v.paths().backups)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".vault.json"))
            .count();
        assert_eq!(json_count, 1);
        // Even a backup stamped older than the rest survives its own operation.
        let old = take_at(&v, "manual", T0).unwrap();
        assert!(db_files(&v).contains(&old.file));
    }

    #[test]
    fn daily_backup_only_when_due() {
        let (_d, v) = setup();
        take_at(&v, "manual", T0).unwrap();
        assert_eq!(take_daily_if_due_at(&v, T0 + H).unwrap(), None);
        let due = take_daily_if_due_at(&v, T0 + 25 * H).unwrap().unwrap();
        assert_eq!(due.reason, "daily");
        assert_eq!(take_daily_if_due_at(&v, T0 + 26 * H).unwrap(), None);
    }

    #[test]
    fn daily_backup_when_none_exists() {
        let (_d, v) = setup();
        assert!(take_daily_if_due_at(&v, T0).unwrap().is_some());
    }

    #[test]
    fn restore_replaces_db_and_locks() {
        let (_d, mut v) = setup();
        add_engagement(&v, "A");
        let b = take(&v, "manual").unwrap();
        add_engagement(&v, "B");
        assert_eq!(ids(&v), vec!["A", "B"]);
        restore(&mut v, &b.file).unwrap();
        assert!(!v.is_unlocked());
        v.unlock(PW).unwrap();
        assert_eq!(ids(&v), vec!["A"]);
        let l = list(v.paths()).unwrap();
        assert!(l.iter().any(|x| x.reason == "pre-restore"));
        // The pre-restore backup holds row B (nothing lost).
        let pre = l.iter().find(|x| x.reason == "pre-restore").unwrap();
        let c = open_with_pragma(&v.paths().backups.join(&pre.file), &v.key_pragma().unwrap()).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM engagements", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        // No staged temp left in the data dir.
        assert!(std::fs::read_dir(&v.paths().root).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains(".tmp")));
    }

    #[test]
    fn restore_with_retention_one_keeps_the_restore_source_usable() {
        let (_d, mut v) = setup();
        add_engagement(&v, "A");
        let b = take_at(&v, "manual", T0).unwrap();
        v.conn().unwrap().execute("INSERT INTO settings(key,value) VALUES('backup_retention','1')", []).unwrap();
        add_engagement(&v, "B");
        restore_at(&mut v, &b.file, T0 + H).unwrap();
        v.unlock(PW).unwrap();
        assert_eq!(ids(&v), vec!["A"]);
    }

    #[test]
    fn restore_rejects_path_traversal() {
        let (_d, mut v) = setup();
        for bad in ["../x.db", "a/b.db", "..\\x.db", "", "raven-..db"] {
            match restore(&mut v, bad) {
                Err(AppError::Validation { field, .. }) => assert_eq!(field, "file"),
                other => panic!("{bad}: {other:?}"),
            }
        }
        assert!(v.is_unlocked());
    }

    #[test]
    fn restore_requires_unlocked_and_existing_file() {
        let (_d, mut v) = setup();
        let b = take_at(&v, "manual", T0).unwrap();
        assert_eq!(restore(&mut v, "raven-20200101-000000-manual.db"), Err(AppError::NotFound));
        assert!(v.is_unlocked());
        v.lock();
        assert_eq!(restore(&mut v, &b.file), Err(AppError::Locked));
    }

    #[test]
    fn restore_refuses_backup_from_a_different_password_and_changes_nothing() {
        let (_da, mut a) = setup();
        add_engagement(&a, "A");
        let ba = take_at(&a, "manual", T0).unwrap();
        let (_db, mut b) = setup();
        add_engagement(&b, "B");
        std::fs::create_dir_all(&b.paths().backups).unwrap();
        std::fs::copy(a.paths().backups.join(&ba.file), b.paths().backups.join(&ba.file)).unwrap();
        let db_before = std::fs::read(&b.paths().db).unwrap();
        let meta_before = std::fs::read(&b.paths().vault_meta).unwrap();
        match restore(&mut b, &ba.file) {
            Err(AppError::Validation { field, message }) => {
                assert_eq!(field, "file");
                assert_eq!(message, "This backup was made with a different password");
            }
            other => panic!("{other:?}"),
        }
        assert!(b.is_unlocked());
        assert_eq!(ids(&b), vec!["B"]);
        assert_eq!(std::fs::read(&b.paths().db).unwrap(), db_before);
        assert_eq!(std::fs::read(&b.paths().vault_meta).unwrap(), meta_before);
        assert_eq!(db_files(&b), vec![ba.file.clone()]); // no pre-restore backup
        a.lock();
    }

    #[test]
    fn pre_migration_backup_is_file_level_and_restorable() {
        let (_d, mut v) = setup();
        add_engagement(&v, "A");
        // Make the db look older so unlock migrates it.
        v.conn().unwrap().execute_batch("PRAGMA user_version = 0; DROP TABLE report_sections; DROP TABLE reports; DROP TABLE interface_dismissals; DROP TABLE payload_builds; DROP TABLE extractions; DROP TABLE tried_pairs; DROP TABLE nvd_cache; DROP TABLE privesc_vectors; DROP TABLE host_identity; DROP TABLE field_manual; DROP TABLE cleanup_items; DROP TABLE failed_attempts; DROP TABLE finding_files; DROP TABLE finding_steps; DROP TABLE finding_services; DROP TABLE finding_hosts; DROP TABLE findings; DROP TABLE cred_attempts; DROP TABLE access_grants; DROP TABLE usernames; DROP TABLE credentials; DROP TABLE hops; DROP TABLE tunnels; DROP TABLE ruled_out; DROP TABLE notes; DROP TABLE checklist_items; DROP TABLE attachments; DROP TABLE log_entry_hosts; DROP TABLE services; DROP TABLE log_entries; DROP TABLE hosts; DROP TABLE settings; DROP TABLE engagements; CREATE TABLE old (x INTEGER);").unwrap();
        v.lock();
        assert!(db_files(&v).is_empty());
        let db_before = std::fs::read(&v.paths().db).unwrap();
        v.unlock(PW).unwrap(); // default hook is the real pre-migration backup
        let l = list(v.paths()).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].reason, "pre-migration");
        // Byte-identical copy of the encrypted file as it was before migrating, plus vault.json.
        assert_eq!(std::fs::read(v.paths().backups.join(&l[0].file)).unwrap(), db_before);
        assert!(v.paths().backups.join(companion_name(&l[0].file)).exists());
    }

    #[test]
    fn pre_migration_backup_does_not_prune_with_default_retention() {
        let (_d, v) = setup();
        v.conn().unwrap().execute("INSERT INTO settings(key,value) VALUES('backup_retention','50')", []).unwrap();
        for i in 0..20 {
            take_at(&v, "manual", T0 + i * 1000).unwrap();
        }
        assert_eq!(db_files(&v).len(), 20);
        take_file_level(v.paths(), "pre-migration", T0 + H).unwrap();
        assert_eq!(db_files(&v).len(), 21);
    }

    use crate::vault::tests::corrupt_db;

    fn root_names(v: &Vault) -> Vec<String> {
        let mut n: Vec<String> = std::fs::read_dir(&v.paths().root)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        n.sort();
        n
    }

    fn wrong_backup_password(r: AppResult<()>) {
        match r {
            Err(AppError::Validation { field, message }) => {
                assert_eq!(field, "password");
                assert_eq!(message, "Wrong password for this backup");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn backups_list_works_while_locked() {
        let (_d, mut v) = setup();
        let b = take_at(&v, "manual", T0).unwrap();
        v.lock();
        let l = crate::commands::backups_list_inner(&v).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].file, b.file);
    }

    #[test]
    fn restore_locked_replaces_damaged_db_and_keeps_damaged_copy() {
        let (_d, mut v) = setup();
        add_engagement(&v, "A");
        let b = take_at(&v, "manual", T0).unwrap();
        add_engagement(&v, "B");
        v.lock();
        corrupt_db(v.paths());
        let damaged = std::fs::read(&v.paths().db).unwrap();
        assert_eq!(v.unlock(PW), Err(AppError::Damaged));
        restore_locked(&mut v, &b.file, PW).unwrap();
        assert!(!v.is_unlocked());
        // The damaged file is kept, byte for byte, next to the new raven.db.
        let kept: Vec<String> =
            root_names(&v).into_iter().filter(|n| n.starts_with("raven.db.damaged-")).collect();
        assert_eq!(kept.len(), 1, "{:?}", root_names(&v));
        let ms = kept[0].strip_prefix("raven.db.damaged-").unwrap();
        assert!(!ms.is_empty() && ms.bytes().all(|c| c.is_ascii_digit()), "{}", kept[0]);
        assert_eq!(std::fs::read(v.paths().root.join(&kept[0])).unwrap(), damaged);
        // No staged temp left, and no pre-restore backup was taken.
        assert!(root_names(&v).iter().all(|n| !n.contains(".tmp")), "{:?}", root_names(&v));
        assert_eq!(db_files(&v), vec![b.file.clone()]);
        v.unlock(PW).unwrap();
        assert_eq!(ids(&v), vec!["A"]);
    }

    #[test]
    fn restore_locked_uses_the_backup_companion_meta() {
        // A backup made under another password (different salt) restores with that password.
        let (_da, mut a) = setup();
        add_engagement(&a, "A");
        let ba = take_at(&a, "manual", T0).unwrap();
        a.lock();
        let (_db, mut b) = setup();
        b.lock();
        std::fs::create_dir_all(&b.paths().backups).unwrap();
        for f in [ba.file.clone(), companion_name(&ba.file)] {
            std::fs::copy(a.paths().backups.join(&f), b.paths().backups.join(&f)).unwrap();
        }
        corrupt_db(b.paths());
        restore_locked(&mut b, &ba.file, PW).unwrap();
        assert_eq!(
            std::fs::read(&b.paths().vault_meta).unwrap(),
            std::fs::read(a.paths().backups.join(companion_name(&ba.file))).unwrap()
        );
        b.unlock(PW).unwrap();
        assert_eq!(ids(&b), vec!["A"]);
    }

    #[test]
    fn restore_locked_falls_back_to_live_meta_without_companion() {
        let (_d, mut v) = setup();
        add_engagement(&v, "A");
        let b = take_at(&v, "manual", T0).unwrap();
        std::fs::remove_file(v.paths().backups.join(companion_name(&b.file))).unwrap();
        v.lock();
        corrupt_db(v.paths());
        restore_locked(&mut v, &b.file, PW).unwrap();
        v.unlock(PW).unwrap();
        assert_eq!(ids(&v), vec!["A"]);
    }

    #[test]
    fn restore_locked_wrong_password_changes_nothing() {
        let (_d, mut v) = setup();
        let b = take_at(&v, "manual", T0).unwrap();
        v.lock();
        corrupt_db(v.paths());
        let db_before = std::fs::read(&v.paths().db).unwrap();
        let meta_before = std::fs::read(&v.paths().vault_meta).unwrap();
        let names_before = root_names(&v);
        wrong_backup_password(restore_locked(&mut v, &b.file, "wrong password here"));
        // A companion without a verifier falls back to opening the backup: still refused.
        let comp = v.paths().backups.join(companion_name(&b.file));
        let mut meta: serde_json::Value = serde_json::from_slice(&std::fs::read(&comp).unwrap()).unwrap();
        meta.as_object_mut().unwrap().remove("verifier");
        std::fs::write(&comp, serde_json::to_vec(&meta).unwrap()).unwrap();
        wrong_backup_password(restore_locked(&mut v, &b.file, "wrong password here"));
        assert!(!v.is_unlocked());
        assert_eq!(std::fs::read(&v.paths().db).unwrap(), db_before);
        assert_eq!(std::fs::read(&v.paths().vault_meta).unwrap(), meta_before);
        assert_eq!(root_names(&v), names_before);
    }

    #[test]
    fn restore_locked_refused_while_unlocked() {
        let (_d, mut v) = setup();
        add_engagement(&v, "A");
        let b = take_at(&v, "manual", T0).unwrap();
        let db_before = std::fs::read(&v.paths().db).unwrap();
        let names_before = root_names(&v);
        match restore_locked(&mut v, &b.file, PW) {
            Err(AppError::Validation { field, message }) => {
                assert_eq!(field, "file");
                assert_eq!(message, "Lock Raven before restoring this way");
            }
            other => panic!("{other:?}"),
        }
        assert!(v.is_unlocked());
        assert_eq!(ids(&v), vec!["A"]);
        assert_eq!(std::fs::read(&v.paths().db).unwrap(), db_before);
        assert_eq!(root_names(&v), names_before);
    }

    #[test]
    fn restore_locked_damaged_backup_with_matching_verifier_says_damaged() {
        let (_d, mut v) = setup();
        let b = take_at(&v, "manual", T0).unwrap();
        v.lock();
        corrupt_db(v.paths());
        let db_before = std::fs::read(&v.paths().db).unwrap();
        // Damage the backup file itself (first page zeroed).
        let bpath = v.paths().backups.join(&b.file);
        let mut bytes = std::fs::read(&bpath).unwrap();
        bytes[..4096].fill(0);
        std::fs::write(&bpath, &bytes).unwrap();
        let names_before = root_names(&v);
        match restore_locked(&mut v, &b.file, PW) {
            Err(AppError::Validation { field, message }) => {
                assert_eq!(field, "file");
                assert_eq!(message, "This backup is damaged");
            }
            other => panic!("{other:?}"),
        }
        // A wrong password on the same backup is still a wrong password.
        wrong_backup_password(restore_locked(&mut v, &b.file, "wrong password here"));
        assert_eq!(std::fs::read(&v.paths().db).unwrap(), db_before);
        assert_eq!(root_names(&v), names_before);
    }

    #[test]
    fn restore_locked_validates_file_name() {
        let (_d, mut v) = setup();
        v.lock();
        for bad in ["../x.db", "a/b.db", "..\\x.db", "", "raven-..db", "notes.db"] {
            match restore_locked(&mut v, bad, PW) {
                Err(AppError::Validation { field, .. }) => assert_eq!(field, "file"),
                other => panic!("{bad}: {other:?}"),
            }
        }
        assert_eq!(restore_locked(&mut v, "raven-20200101-000000-manual.db", PW), Err(AppError::NotFound));
    }

    #[test]
    fn unlock_with_daily_reports_backup_and_does_not_fail_unlock() {
        let (_d, mut v) = setup();
        v.lock();
        let out = v.unlock_with_daily(PW).unwrap();
        assert!(v.is_unlocked());
        assert_eq!(out.daily_backup.as_ref().map(|b| b.reason.as_str()), Some("daily"));
        assert!(out.daily_backup_error.is_none());
        v.lock();
        let out = v.unlock_with_daily(PW).unwrap();
        assert!(out.daily_backup.is_none() && out.daily_backup_error.is_none());
        // A broken backups dir must not lock the user out.
        v.lock();
        std::fs::remove_dir_all(&v.paths().backups).unwrap();
        std::fs::write(&v.paths().backups, b"not a dir").unwrap();
        let out = v.unlock_with_daily(PW).unwrap();
        assert!(v.is_unlocked());
        assert!(out.daily_backup.is_none() && out.daily_backup_error.is_some());
    }
}
