use crate::backup::{self, BackupInfo};
use crate::error::{AppError, AppResult};
use crate::migrations::{self, MigrationOutcome};
use crate::paths::DataPaths;
use argon2::{Algorithm, Argon2, Params, Version};
use blake2::Blake2bMac;
use blake2::digest::consts::U32;
use blake2::digest::{KeyInit, Mac};
use rand::RngCore;
use rusqlite::{Connection, ErrorCode, OpenFlags};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;
use zeroize::{Zeroize, Zeroizing};

const MIN_PASSWORD_CHARS: usize = 12;
const SALT_LEN: usize = 16;
const KEY_LEN: usize = 32;
const PRAGMA_PREFIX: &str = "PRAGMA key = \"x'";
const VERIFIER_MESSAGE: &[u8] = b"raven vault verifier v1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultMeta {
    pub version: u32,
    pub kdf: String,
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
    pub salt_hex: String,
    /// Lowercase hex Blake2b-256 MAC of `VERIFIER_MESSAGE`, keyed with the DB key. Lets
    /// unlock tell a wrong password from a damaged database without opening it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verifier: Option<String>,
}

impl VaultMeta {
    /// Production parameters with a fresh random salt.
    fn new_production() -> VaultMeta {
        VaultMeta::with_params(65536, 3, 1)
    }

    fn with_params(m_kib: u32, t: u32, p: u32) -> VaultMeta {
        let mut salt = [0u8; SALT_LEN];
        rand::rngs::OsRng.fill_bytes(&mut salt);
        VaultMeta { version: 1, kdf: "argon2id".into(), m_kib, t, p, salt_hex: to_hex(&salt), verifier: None }
    }

    /// Weak, fast parameters. Tests only.
    #[cfg(test)]
    pub fn for_test() -> VaultMeta {
        VaultMeta::with_params(8, 1, 1)
    }

    /// `password` must already be NFC-normalized (`normalize_password`).
    pub(crate) fn derive_key(&self, password: &str) -> AppResult<Zeroizing<[u8; KEY_LEN]>> {
        if self.version != 1 || self.kdf != "argon2id" {
            return Err(AppError::Io("unsupported vault.json version or kdf".into()));
        }
        let salt = from_hex(&self.salt_hex)
            .filter(|s| s.len() == SALT_LEN)
            .ok_or_else(|| AppError::Io("invalid salt in vault.json".into()))?;
        let params = Params::new(self.m_kib, self.t, self.p, Some(KEY_LEN))
            .map_err(|e| AppError::Io(format!("invalid argon2 params in vault.json: {e}")))?;
        let params_blocks = params.block_count();
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        // Own the Argon2 working memory so it can be wiped before it is freed.
        let mut blocks = vec![argon2::Block::default(); params_blocks];
        let res = argon.hash_password_into_with_memory(
            password.as_bytes(),
            &salt,
            key.as_mut(),
            &mut blocks,
        );
        for b in blocks.iter_mut() {
            b.zeroize();
        }
        res.map_err(|e| AppError::Io(format!("key derivation failed: {e}")))?;
        Ok(key)
    }

    /// `None` when there is no usable verifier (absent, or not exactly 64 hex characters):
    /// callers then fall back to opening the database. Otherwise whether `key` matches it,
    /// compared in constant time; a well-formed but wrong tag is a mismatch.
    pub(crate) fn verifier_matches(&self, key: &[u8; KEY_LEN]) -> Option<bool> {
        let v = self.verifier.as_deref()?;
        if v.len() != KEY_LEN * 2 || !v.bytes().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let tag = from_hex(v)?;
        Some(verifier_mac(key).verify_slice(&tag).is_ok())
    }

    pub(crate) fn read(path: &Path) -> AppResult<VaultMeta> {
        let bytes = std::fs::read(path)?;
        serde_json::from_slice(&bytes).map_err(|e| AppError::Io(format!("invalid vault.json: {e}")))
    }
}

fn verifier_mac(key: &[u8; KEY_LEN]) -> Blake2bMac<U32> {
    let mut mac = <Blake2bMac<U32> as KeyInit>::new_from_slice(key).expect("32-byte key is a valid Blake2b key");
    mac.update(VERIFIER_MESSAGE);
    mac
}

/// The `verifier` value for `key`.
pub(crate) fn verifier_hex(key: &[u8; KEY_LEN]) -> String {
    to_hex(&verifier_mac(key).finalize().into_bytes())
}

/// Unicode NFC form of the password, so the same visible password typed with composed or
/// decomposed characters (e.g. different keyboards/IMEs) derives the same key. ASCII is
/// unchanged by NFC, so existing ASCII-password vaults keep their keys.
pub(crate) fn normalize_password(password: &str) -> Zeroizing<String> {
    if password.is_ascii() {
        return Zeroizing::new(password.to_owned());
    }
    Zeroizing::new(password.nfc().collect())
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 15) as usize] as char);
    }
    out
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) || !s.is_ascii() {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

pub(crate) fn pragma_for(key: &[u8; KEY_LEN]) -> Zeroizing<String> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    // Exact capacity so the String never reallocates (and leaves unwiped copies).
    let mut out = Zeroizing::new(String::with_capacity(PRAGMA_PREFIX.len() + KEY_LEN * 2 + 3));
    out.push_str(PRAGMA_PREFIX);
    for b in key {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 15) as usize] as char);
    }
    out.push_str("'\";");
    out
}

/// Open `path` with `flags`, apply the key, then per-connection hardening. Every keyed
/// connection (create, unlock, backup verify, restore check) goes through here.
///
/// - `cipher_memory_security = ON`: SQLCipher wipes and locks its memory. Set right after the
///   key, before the first database access.
/// - `foreign_keys = ON`: explicit, so `ON DELETE CASCADE` etc. work even if the bundled
///   SQLite's compile-time default (currently ON in libsqlite3-sys) ever changes.
///
/// Does not read the database, so a wrong key surfaces on the caller's first query.
pub(crate) fn open_keyed(path: &Path, key_pragma: &str, flags: OpenFlags) -> rusqlite::Result<Connection> {
    let c = Connection::open_with_flags(path, flags)?;
    c.execute_batch(key_pragma)?;
    c.execute_batch("PRAGMA cipher_memory_security = ON; PRAGMA foreign_keys = ON;")?;
    Ok(c)
}

/// The file isn't a readable SQLCipher database: wrong key, or damaged bytes.
pub(crate) fn is_unreadable(e: &rusqlite::Error) -> bool {
    matches!(
        e,
        rusqlite::Error::SqliteFailure(f, _)
            if f.code == ErrorCode::NotADatabase || f.code == ErrorCode::DatabaseCorrupt
    )
}

/// Map a failure reading `sqlite_master` on unlock. With a matching verifier the key is
/// right, so an unreadable file is `Damaged`. Without one, `NotADatabase` is taken as a
/// wrong password. Anything else (busy, locked, I/O) is an ordinary db error.
fn classify_read_failure(e: rusqlite::Error, verified: bool) -> AppError {
    if verified && is_unreadable(&e) {
        return AppError::Damaged;
    }
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if !verified && f.code == ErrorCode::NotADatabase => {
            AppError::WrongPassword
        }
        _ => e.into(),
    }
}

/// Write `bytes` to a new or truncated owner-only (0600) file at `path` and fsync it.
pub(crate) fn write_private_file(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let result = (|| -> std::io::Result<()> {
        let mut f = opts.open(path)?;
        f.write_all(bytes)?;
        f.sync_all()
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(path);
    }
    result.map_err(Into::into)
}

/// Called as `(from, to)` before migrating an existing database, while its data is intact.
/// Task 4 supplies the real pre-migration backup here. An `Err` aborts the migration.
pub type BackupHook = Box<dyn FnMut(u32, u32) -> AppResult<()> + Send>;

#[derive(Debug, Clone, PartialEq)]
pub struct UnlockOutcome {
    pub migration: MigrationOutcome,
    pub daily_backup: Option<BackupInfo>,
    pub daily_backup_error: Option<String>,
}

pub struct Vault {
    paths: DataPaths,
    backup_hook: Option<BackupHook>,
    conn: Option<Connection>,
    key: Option<Zeroizing<[u8; KEY_LEN]>>,
}

impl Vault {
    pub fn new(paths: DataPaths) -> Vault {
        let hook = backup::pre_migration_hook(paths.clone());
        Vault { paths, backup_hook: Some(hook), conn: None, key: None }
    }

    pub fn paths(&self) -> &DataPaths {
        &self.paths
    }

    /// Replace the pre-migration backup hook (default: `backup::pre_migration_hook`).
    #[cfg(test)]
    pub fn set_backup_hook(&mut self, hook: BackupHook) {
        self.backup_hook = Some(hook);
    }

    /// Run pending migrations on a freshly opened connection, calling the backup hook first
    /// when the database already has tables.
    fn migrate_on_open(&mut self, conn: &mut Connection) -> AppResult<MigrationOutcome> {
        let mut noop = |_: u32, _: u32| Ok(());
        match self.backup_hook.as_mut() {
            Some(h) => migrations::migrate(conn, &mut **h),
            None => migrations::migrate(conn, &mut noop),
        }
    }

    pub fn exists(&self) -> bool {
        self.paths.db.exists() && self.paths.vault_meta.exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.conn.is_some()
    }

    pub fn create(&mut self, password: &str) -> AppResult<MigrationOutcome> {
        self.create_with_meta(password, VaultMeta::new_production())
    }

    /// Create with weak KDF params so tests stay fast.
    #[cfg(test)]
    pub fn create_for_test(&mut self, password: &str) -> AppResult<MigrationOutcome> {
        self.create_with_meta(password, VaultMeta::for_test())
    }

    fn create_with_meta(&mut self, password: &str, mut meta: VaultMeta) -> AppResult<MigrationOutcome> {
        let password = normalize_password(password);
        // Counts Unicode scalar values of the NFC form.
        if password.chars().count() < MIN_PASSWORD_CHARS {
            return Err(AppError::Validation {
                field: "password".into(),
                message: format!("password must be at least {MIN_PASSWORD_CHARS} characters"),
            });
        }
        if self.exists() {
            return Err(AppError::VaultExists);
        }
        // A lone db or vault.json is a damaged vault; never overwrite or delete it.
        if self.paths.db.exists() || self.paths.vault_meta.exists() {
            return Err(AppError::Io(
                "incomplete vault files found (only one of raven.db / vault.json); refusing to overwrite".into(),
            ));
        }
        let key = meta.derive_key(&password)?;
        meta.verifier = Some(verifier_hex(&key));
        match self.create_files(&meta, &key) {
            Ok((conn, outcome)) => {
                self.conn = Some(conn);
                self.key = Some(key);
                Ok(outcome)
            }
            Err(e) => {
                self.cleanup_created();
                Err(e)
            }
        }
    }

    fn create_files(
        &mut self,
        meta: &VaultMeta,
        key: &[u8; KEY_LEN],
    ) -> AppResult<(Connection, MigrationOutcome)> {
        self.write_meta_atomic(meta)?;
        // Pre-create raven.db as owner-only; SQLite treats the empty file as a new database
        // and gives its journal files the same mode.
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        opts.open(&self.paths.db)?;
        let mut conn = open_keyed(&self.paths.db, &pragma_for(key), OpenFlags::default())?;
        // The first migration writes the encrypted file to disk; a fresh db never triggers the hook.
        let outcome = self.migrate_on_open(&mut conn)?;
        Ok((conn, outcome))
    }

    fn write_meta_atomic(&self, meta: &VaultMeta) -> AppResult<()> {
        let json = serde_json::to_vec_pretty(meta).map_err(|e| AppError::Io(e.to_string()))?;
        let tmp = self.paths.vault_meta.with_extension("json.tmp");
        write_private_file(&tmp, &json)?;
        let result = std::fs::rename(&tmp, &self.paths.vault_meta);
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        result.map_err(Into::into)
    }

    /// Remove files a failed create may have left. Only called when none existed beforehand.
    fn cleanup_created(&self) {
        let db = self.paths.db.to_string_lossy().into_owned();
        for p in [
            self.paths.vault_meta.clone(),
            self.paths.vault_meta.with_extension("json.tmp"),
            self.paths.db.clone(),
            format!("{db}-journal").into(),
            format!("{db}-wal").into(),
            format!("{db}-shm").into(),
        ] {
            let _ = std::fs::remove_file(p);
        }
    }

    /// Unlock decision:
    /// - verifier present, key doesn't match: `WrongPassword`, the db is never opened;
    /// - verifier present and matches, db unreadable: `Damaged`;
    /// - no verifier (older vault), `NotADatabase`: `WrongPassword`. A successful unlock
    ///   then adds the verifier (best-effort: a failed write doesn't fail the unlock).
    ///   A malformed verifier is treated as absent.
    pub fn unlock(&mut self, password: &str) -> AppResult<MigrationOutcome> {
        if !self.exists() {
            return Err(AppError::NoVault);
        }
        let mut meta = VaultMeta::read(&self.paths.vault_meta)?;
        let key = meta.derive_key(&normalize_password(password))?;
        let verified = match meta.verifier_matches(&key) {
            Some(false) => return Err(AppError::WrongPassword),
            Some(true) => true,
            None => false,
        };
        // READ_WRITE without CREATE: a missing db must never be created here.
        let mut conn = open_keyed(
            &self.paths.db,
            &pragma_for(&key),
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        if let Err(e) = conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)) {
            return Err(classify_read_failure(e, verified));
        }
        // Absent or malformed verifier: store a fresh one now the key is known good.
        if !verified {
            meta.verifier = Some(verifier_hex(&key));
            let _ = self.write_meta_atomic(&meta);
        }
        // On any migration/backup error the vault stays locked and nothing is stored.
        let outcome = self.migrate_on_open(&mut conn)?;
        self.conn = Some(conn);
        self.key = Some(key);
        Ok(outcome)
    }

    /// Unlock, then take the daily backup if due. This is what the unlock command should call.
    /// A daily-backup failure never fails the unlock: it is reported in `daily_backup_error`.
    pub fn unlock_with_daily(&mut self, password: &str) -> AppResult<UnlockOutcome> {
        let migration = self.unlock(password)?;
        let (daily_backup, daily_backup_error) = match backup::take_daily_if_due(self) {
            Ok(b) => (b, None),
            Err(e) => (None, Some(e.to_string())),
        };
        Ok(UnlockOutcome { migration, daily_backup, daily_backup_error })
    }

    pub fn lock(&mut self) {
        self.conn = None;
        self.key = None; // Zeroizing wipes on drop
    }

    pub fn conn(&self) -> AppResult<&Connection> {
        self.conn.as_ref().ok_or(AppError::Locked)
    }

    /// `PRAGMA key = "x'<hex>'"` statement for the current key (used to open backups).
    pub fn key_pragma(&self) -> AppResult<Zeroizing<String>> {
        let key = self.key.as_ref().ok_or(AppError::Locked)?;
        Ok(pragma_for(key))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    const PW: &str = "correct horse battery";

    fn setup() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        (dir, v)
    }

    #[test]
    fn create_then_unlock_roundtrip() {
        let (_d, mut v) = setup();
        assert!(!v.exists());
        v.create_for_test(PW).unwrap();
        assert!(v.exists() && v.is_unlocked());
        v.lock();
        assert!(!v.is_unlocked());
        v.unlock(PW).unwrap();
        assert!(v.is_unlocked());
        assert!(v.conn().is_ok());
        assert!(v.key_pragma().unwrap().starts_with("PRAGMA key = \"x'"));
    }

    #[test]
    fn create_rejects_short_password() {
        let (_d, mut v) = setup();
        match v.create_for_test("short") {
            Err(AppError::Validation { field, .. }) => assert_eq!(field, "password"),
            other => panic!("unexpected {other:?}"),
        }
        assert!(!v.exists());
    }

    #[test]
    fn create_twice_errors() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        assert_eq!(v.create_for_test(PW), Err(AppError::VaultExists));
    }

    #[test]
    fn unlock_wrong_password_leaves_files_untouched() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        v.lock();
        let db_before = std::fs::read(&v.paths.db).unwrap();
        let meta_before = std::fs::read(&v.paths.vault_meta).unwrap();
        assert_eq!(v.unlock("wrong password here"), Err(AppError::WrongPassword));
        assert!(!v.is_unlocked());
        assert_eq!(std::fs::read(&v.paths.db).unwrap(), db_before);
        assert_eq!(std::fs::read(&v.paths.vault_meta).unwrap(), meta_before);
    }

    #[test]
    fn db_file_is_not_plain_sqlite() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        let bytes = std::fs::read(&v.paths.db).unwrap();
        assert!(bytes.len() >= 16);
        assert_ne!(&bytes[..16], b"SQLite format 3\0");
    }

    #[test]
    fn locked_conn_errors() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        v.lock();
        assert!(matches!(v.conn(), Err(AppError::Locked)));
        assert_eq!(v.key_pragma(), Err(AppError::Locked));
    }

    #[test]
    fn unlock_without_vault_errors() {
        let (_d, mut v) = setup();
        assert_eq!(v.unlock(PW), Err(AppError::NoVault));
    }

    #[test]
    fn vault_json_shape_and_params() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        let meta: VaultMeta =
            serde_json::from_slice(&std::fs::read(&v.paths.vault_meta).unwrap()).unwrap();
        assert_eq!((meta.version, meta.kdf.as_str(), meta.m_kib, meta.t, meta.p), (1, "argon2id", 8, 1, 1));
        assert_eq!(meta.salt_hex.len(), 32);
        assert!(!v.paths.vault_meta.with_extension("json.tmp").exists());
        let prod = VaultMeta::new_production();
        assert_eq!((prod.m_kib, prod.t, prod.p), (65536, 3, 1));
    }

    #[test]
    fn lone_db_blocks_create_without_deleting_it() {
        let (_d, mut v) = setup();
        std::fs::write(&v.paths.db, b"precious").unwrap();
        assert!(matches!(v.create_for_test(PW), Err(AppError::Io(_))));
        assert_eq!(std::fs::read(&v.paths.db).unwrap(), b"precious");
    }

    #[test]
    fn create_reports_latest_and_creates_schema() {
        let (_d, mut v) = setup();
        let latest = migrations::MIGRATIONS.last().unwrap().0;
        assert_eq!(v.create_for_test(PW).unwrap(), MigrationOutcome { from: 0, to: latest });
        let n: i64 = v
            .conn()
            .unwrap()
            .query_row("SELECT count(*) FROM sqlite_master WHERE name='engagements'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn unlock_runs_hook_only_when_behind_and_failure_keeps_locked() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        // Simulate an older db: drop the version so tables exist but user_version is behind.
        v.conn().unwrap().execute_batch("DROP TABLE report_sections; DROP TABLE reports; DROP TABLE interface_dismissals; DROP TABLE payload_builds; DROP TABLE extractions; DROP TABLE tried_pairs; DROP TABLE nvd_cache; DROP TABLE privesc_vectors; DROP TABLE host_identity; DROP TABLE field_manual; DROP TABLE cleanup_items; DROP TABLE failed_attempts; DROP TABLE finding_files; DROP TABLE finding_steps; DROP TABLE finding_services; DROP TABLE finding_hosts; DROP TABLE findings; DROP TABLE cred_attempts; DROP TABLE access_grants; DROP TABLE usernames; DROP TABLE credentials; DROP TABLE hops; DROP TABLE tunnels; DROP TABLE ruled_out; DROP TABLE notes; DROP TABLE checklist_items; DROP TABLE attachments; DROP TABLE log_entry_hosts; DROP TABLE services; DROP TABLE log_entries; DROP TABLE hosts; DROP TABLE settings; DROP TABLE engagements; PRAGMA user_version = 0; CREATE TABLE old (x INTEGER);").unwrap();
        v.lock();
        v.set_backup_hook(Box::new(|_, _| Err(AppError::Io("backup failed".into()))));
        assert_eq!(v.unlock(PW), Err(AppError::Io("backup failed".into())));
        assert!(!v.is_unlocked());
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
        let c2 = calls.clone();
        v.set_backup_hook(Box::new(move |f, t| {
            assert_eq!(f, 0);
            assert!(t >= 1);
            c2.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }));
        v.unlock(PW).unwrap();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        v.lock();
        v.unlock(PW).unwrap();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    fn pragma_i64(v: &Vault, name: &str) -> i64 {
        v.conn().unwrap().query_row(&format!("PRAGMA {name}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn foreign_keys_on_after_create_and_unlock() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        assert_eq!(pragma_i64(&v, "foreign_keys"), 1);
        v.lock();
        v.unlock(PW).unwrap();
        assert_eq!(pragma_i64(&v, "foreign_keys"), 1);
        let mem: String =
            v.conn().unwrap().query_row("PRAGMA cipher_memory_security", [], |r| r.get(0)).unwrap();
        assert_eq!(mem, "1");
    }

    // "crème brûlée pâte" in composed (NFC) and decomposed (NFD) form.
    const PW_NFC: &str = "cr\u{e8}me br\u{fb}l\u{e9}e p\u{e2}te";
    const PW_NFD: &str = "cre\u{300}me bru\u{302}le\u{301}e pa\u{302}te";

    #[test]
    fn nfc_and_nfd_passwords_open_the_same_vault() {
        assert_ne!(PW_NFC, PW_NFD);
        let (_d, mut v) = setup();
        v.create_for_test(PW_NFD).unwrap();
        v.lock();
        v.unlock(PW_NFC).unwrap();
        v.lock();
        v.unlock(PW_NFD).unwrap();
        let (_d2, mut w) = setup();
        w.create_for_test(PW_NFC).unwrap();
        w.lock();
        w.unlock(PW_NFD).unwrap();
    }

    #[test]
    fn password_length_counts_chars_after_nfc() {
        // 11 characters once composed, 14 code points decomposed: too short.
        let short_nfd = "cre\u{300}me bru\u{302}le\u{301}";
        assert_eq!(short_nfd.chars().count(), 14);
        let (_d, mut v) = setup();
        assert!(matches!(v.create_for_test(short_nfd), Err(AppError::Validation { .. })));
    }

    #[test]
    fn ascii_password_key_is_unchanged() {
        let meta = VaultMeta {
            version: 1,
            kdf: "argon2id".into(),
            m_kib: 8,
            t: 1,
            p: 1,
            salt_hex: "000102030405060708090a0b0c0d0e0f".into(),
            verifier: None,
        };
        let key = meta.derive_key(PW).unwrap();
        assert_eq!(to_hex(key.as_ref()), PINNED_ASCII_KEY);
    }
    // Derived by the pre-NFC code (commit 811b187): NFC must not change ASCII keys.
    const PINNED_ASCII_KEY: &str = "0dfe509cfb319e6f63967799aad3c4d9ce06d7e9abef9f74dcc45d30eda9d60c";

    #[cfg(unix)]
    #[test]
    fn created_db_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        let mode = std::fs::metadata(&v.paths.db).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    fn read_meta(v: &Vault) -> VaultMeta {
        serde_json::from_slice(&std::fs::read(&v.paths.vault_meta).unwrap()).unwrap()
    }

    /// Overwrite the first 4096 bytes of raven.db with zeros.
    pub(crate) fn corrupt_db(paths: &DataPaths) {
        use std::io::{Seek, SeekFrom};
        let mut f = std::fs::OpenOptions::new().write(true).open(&paths.db).unwrap();
        f.seek(SeekFrom::Start(0)).unwrap();
        f.write_all(&[0u8; 4096]).unwrap();
        f.sync_all().unwrap();
    }

    #[test]
    fn create_writes_verifier() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        let meta = read_meta(&v);
        let verifier = meta.verifier.clone().unwrap();
        assert_eq!(verifier.len(), 64);
        assert!(verifier.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)));
        let key = meta.derive_key(PW).unwrap();
        assert_eq!(verifier, verifier_hex(&key));
    }

    #[test]
    fn verifier_is_blake2b_mac_of_fixed_message() {
        let key = [7u8; KEY_LEN];
        let mut mac = <Blake2bMac<U32> as KeyInit>::new_from_slice(&key).unwrap();
        mac.update(b"raven vault verifier v1");
        assert_eq!(verifier_hex(&key), to_hex(&mac.finalize().into_bytes()));
    }

    #[test]
    fn unlock_wrong_password_with_verifier_never_opens_db() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        v.lock();
        // Opening a directory as a database fails with a non-password error, so
        // `WrongPassword` here proves the verifier answered before any open.
        std::fs::remove_file(&v.paths.db).unwrap();
        std::fs::create_dir(&v.paths.db).unwrap();
        assert_eq!(v.unlock("wrong password here"), Err(AppError::WrongPassword));
        assert!(!v.is_unlocked());
    }

    #[test]
    fn unlock_corrupt_db_with_verifier_is_damaged() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        v.lock();
        corrupt_db(&v.paths);
        assert_eq!(v.unlock(PW), Err(AppError::Damaged));
        assert!(!v.is_unlocked());
        // A wrong password on the same damaged file is still just a wrong password.
        assert_eq!(v.unlock("wrong password here"), Err(AppError::WrongPassword));
    }

    #[test]
    fn old_vault_without_verifier_keeps_wrong_password_behaviour() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        v.lock();
        let mut meta = read_meta(&v);
        meta.verifier = None;
        v.write_meta_atomic(&meta).unwrap();
        corrupt_db(&v.paths);
        assert_eq!(v.unlock(PW), Err(AppError::WrongPassword));
        assert_eq!(read_meta(&v).verifier, None);
    }

    #[test]
    fn old_vault_gains_verifier_on_unlock() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        v.lock();
        let mut meta = read_meta(&v);
        let expected = meta.verifier.take().unwrap();
        v.write_meta_atomic(&meta).unwrap();
        let raw = String::from_utf8(std::fs::read(&v.paths.vault_meta).unwrap()).unwrap();
        assert!(!raw.contains("verifier"));
        // A wrong password adds nothing.
        assert_eq!(v.unlock("wrong password here"), Err(AppError::WrongPassword));
        assert_eq!(read_meta(&v).verifier, None);
        v.unlock(PW).unwrap();
        assert_eq!(read_meta(&v).verifier, Some(expected));
        assert!(!v.paths.vault_meta.with_extension("json.tmp").exists());
        v.lock();
        v.unlock(PW).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn verifier_write_failure_does_not_fail_unlock() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        v.lock();
        let mut meta = read_meta(&v);
        meta.verifier = None;
        v.write_meta_atomic(&meta).unwrap();
        // A directory where the temp file would go makes the atomic write fail.
        std::fs::create_dir(v.paths.vault_meta.with_extension("json.tmp")).unwrap();
        v.unlock(PW).unwrap();
        assert!(v.is_unlocked());
        assert_eq!(read_meta(&v).verifier, None);
        let mode = std::fs::metadata(&v.paths.vault_meta).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn malformed_verifier_is_treated_as_absent_and_rewritten() {
        for bad in ["", "zz", "abcd", &"g".repeat(64), &"a".repeat(63), &"a".repeat(66)] {
            let (_d, mut v) = setup();
            v.create_for_test(PW).unwrap();
            v.lock();
            let mut meta = read_meta(&v);
            let good = meta.verifier.replace(bad.to_string()).unwrap();
            v.write_meta_atomic(&meta).unwrap();
            // Falls back to opening the db: a wrong password is still refused...
            assert_eq!(v.unlock("wrong password here"), Err(AppError::WrongPassword), "{bad:?}");
            // ...and the right one unlocks and stores a fresh verifier.
            v.unlock(PW).unwrap();
            assert_eq!(read_meta(&v).verifier, Some(good), "{bad:?}");
        }
    }

    #[test]
    fn uppercase_verifier_is_accepted_and_wrong_tag_is_a_mismatch() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        v.lock();
        let mut meta = read_meta(&v);
        meta.verifier = meta.verifier.map(|s| s.to_uppercase());
        v.write_meta_atomic(&meta).unwrap();
        v.unlock(PW).unwrap();
        v.lock();
        // Well-formed but wrong: mismatch, the db is never opened.
        meta.verifier = Some("0".repeat(64));
        v.write_meta_atomic(&meta).unwrap();
        assert_eq!(v.unlock(PW), Err(AppError::WrongPassword));
    }

    fn sqlite_err(code: std::os::raw::c_int) -> rusqlite::Error {
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(code), None)
    }

    #[test]
    fn read_failure_classification() {
        use rusqlite::ffi;
        assert_eq!(classify_read_failure(sqlite_err(ffi::SQLITE_NOTADB), true), AppError::Damaged);
        assert_eq!(classify_read_failure(sqlite_err(ffi::SQLITE_CORRUPT), true), AppError::Damaged);
        assert_eq!(classify_read_failure(sqlite_err(ffi::SQLITE_NOTADB), false), AppError::WrongPassword);
        assert_eq!(classify_read_failure(sqlite_err(ffi::SQLITE_CORRUPT), false).code(), "db");
        for code in [ffi::SQLITE_BUSY, ffi::SQLITE_LOCKED, ffi::SQLITE_IOERR, ffi::SQLITE_CANTOPEN] {
            for verified in [true, false] {
                assert_eq!(classify_read_failure(sqlite_err(code), verified).code(), "db", "{code} {verified}");
            }
        }
    }

    #[test]
    fn cleanup_makes_retry_possible() {
        let (_d, mut v) = setup();
        v.create_for_test(PW).unwrap();
        v.lock();
        v.cleanup_created();
        assert!(!v.exists());
        v.create_for_test(PW).unwrap();
        assert!(v.exists());
    }
}
