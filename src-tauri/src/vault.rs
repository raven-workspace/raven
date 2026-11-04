use crate::error::{AppError, AppResult};
use crate::paths::DataPaths;
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use rusqlite::{Connection, ErrorCode, OpenFlags};
use serde::{Deserialize, Serialize};
use std::io::Write;
use zeroize::Zeroizing;

const MIN_PASSWORD_CHARS: usize = 12;
const SALT_LEN: usize = 16;
const KEY_LEN: usize = 32;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultMeta {
    pub version: u32,
    pub kdf: String,
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
    pub salt_hex: String,
}

impl VaultMeta {
    /// Production parameters with a fresh random salt.
    fn new_production() -> VaultMeta {
        VaultMeta::with_params(65536, 3, 1)
    }

    fn with_params(m_kib: u32, t: u32, p: u32) -> VaultMeta {
        let mut salt = [0u8; SALT_LEN];
        rand::rngs::OsRng.fill_bytes(&mut salt);
        VaultMeta { version: 1, kdf: "argon2id".into(), m_kib, t, p, salt_hex: to_hex(&salt) }
    }

    /// Weak, fast parameters. Tests only.
    #[cfg(test)]
    pub fn for_test() -> VaultMeta {
        VaultMeta::with_params(8, 1, 1)
    }

    fn derive_key(&self, password: &str) -> AppResult<Zeroizing<[u8; KEY_LEN]>> {
        if self.version != 1 || self.kdf != "argon2id" {
            return Err(AppError::Io("unsupported vault.json version or kdf".into()));
        }
        let salt = from_hex(&self.salt_hex)
            .filter(|s| s.len() == SALT_LEN)
            .ok_or_else(|| AppError::Io("invalid salt in vault.json".into()))?;
        let params = Params::new(self.m_kib, self.t, self.p, Some(KEY_LEN))
            .map_err(|e| AppError::Io(format!("invalid argon2 params in vault.json: {e}")))?;
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        argon
            .hash_password_into(password.as_bytes(), &salt, key.as_mut())
            .map_err(|e| AppError::Io(format!("key derivation failed: {e}")))?;
        Ok(key)
    }
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) || !s.is_ascii() {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

fn pragma_for(key: &[u8; KEY_LEN]) -> Zeroizing<String> {
    let hex = Zeroizing::new(to_hex(key));
    Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", hex.as_str()))
}

pub struct Vault {
    paths: DataPaths,
    conn: Option<Connection>,
    key: Option<Zeroizing<[u8; KEY_LEN]>>,
}

impl Vault {
    pub fn new(paths: DataPaths) -> Vault {
        Vault { paths, conn: None, key: None }
    }

    pub fn exists(&self) -> bool {
        self.paths.db.exists() && self.paths.vault_meta.exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.conn.is_some()
    }

    pub fn create(&mut self, password: &str) -> AppResult<()> {
        self.create_with_meta(password, VaultMeta::new_production())
    }

    /// Create with weak KDF params so tests stay fast.
    #[cfg(test)]
    pub fn create_for_test(&mut self, password: &str) -> AppResult<()> {
        self.create_with_meta(password, VaultMeta::for_test())
    }

    fn create_with_meta(&mut self, password: &str, meta: VaultMeta) -> AppResult<()> {
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
        let key = meta.derive_key(password)?;
        match self.create_files(&meta, &key) {
            Ok(conn) => {
                self.conn = Some(conn);
                self.key = Some(key);
                Ok(())
            }
            Err(e) => {
                self.cleanup_created();
                Err(e)
            }
        }
    }

    fn create_files(&self, meta: &VaultMeta, key: &[u8; KEY_LEN]) -> AppResult<Connection> {
        self.write_meta_atomic(meta)?;
        let conn = Connection::open(&self.paths.db)?;
        conn.execute_batch(&pragma_for(key))?;
        // Force the encrypted file to be written now.
        conn.execute_batch("CREATE TABLE _raven_init (x INTEGER); DROP TABLE _raven_init;")?;
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
        Ok(conn)
    }

    fn write_meta_atomic(&self, meta: &VaultMeta) -> AppResult<()> {
        let json = serde_json::to_vec_pretty(meta).map_err(|e| AppError::Io(e.to_string()))?;
        let tmp = self.paths.vault_meta.with_extension("json.tmp");
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let result = (|| -> std::io::Result<()> {
            let mut f = opts.open(&tmp)?;
            f.write_all(&json)?;
            f.sync_all()?;
            std::fs::rename(&tmp, &self.paths.vault_meta)
        })();
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

    pub fn unlock(&mut self, password: &str) -> AppResult<()> {
        if !self.exists() {
            return Err(AppError::NoVault);
        }
        let bytes = std::fs::read(&self.paths.vault_meta)?;
        let meta: VaultMeta = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::Io(format!("invalid vault.json: {e}")))?;
        let key = meta.derive_key(password)?;
        // READ_WRITE without CREATE: a missing db must never be created here.
        let conn = Connection::open_with_flags(
            &self.paths.db,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.execute_batch(&pragma_for(&key))?;
        match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == ErrorCode::NotADatabase => {
                return Err(AppError::WrongPassword);
            }
            Err(e) => return Err(e.into()),
        }
        self.conn = Some(conn);
        self.key = Some(key);
        Ok(())
    }

    pub fn lock(&mut self) {
        self.conn = None;
        self.key = None; // Zeroizing wipes on drop
    }

    pub fn conn(&self) -> AppResult<&Connection> {
        self.conn.as_ref().ok_or(AppError::Locked)
    }

    /// `PRAGMA key = "x'<hex>'"` statement for the current key (used to open backups).
    pub fn key_pragma(&self) -> AppResult<String> {
        let key = self.key.as_ref().ok_or(AppError::Locked)?;
        Ok(pragma_for(key).to_string())
    }
}

#[cfg(test)]
mod tests {
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
