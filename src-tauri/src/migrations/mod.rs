//! Versioned schema migrations. `PRAGMA user_version` holds the applied version.
//!
//! Safety rules: an existing database is backed up (via the hook) BEFORE any change,
//! and all pending migrations plus the version bump commit or roll back as one transaction.
//!
//! Writing a migration:
//! - All pending migrations run inside ONE shared transaction. A migration's SQL must not
//!   contain `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`/`RELEASE`, or `VACUUM`.
//! - Connections run with `PRAGMA foreign_keys = ON` (see `vault::open_keyed`). That pragma
//!   is a no-op inside a transaction, so a migration that needs `foreign_keys = OFF` (e.g. the
//!   SQLite 12-step table rebuild of a referenced table) cannot run in the shared transaction;
//!   it needs its own runner step outside it.
//! - Append new entries to `MIGRATIONS` with a strictly greater version; never edit a shipped one.

use crate::error::{AppError, AppResult};
use rusqlite::Connection;

/// (version, SQL). Versions are strictly increasing.
pub const MIGRATIONS: &[(u32, &str)] = &[(1, include_str!("../../migrations/0001_init.sql"))];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MigrationOutcome {
    pub from: u32,
    pub to: u32,
}

pub fn migrate(
    conn: &mut Connection,
    hook: &mut dyn FnMut(u32, u32) -> AppResult<()>,
) -> AppResult<MigrationOutcome> {
    migrate_with(conn, MIGRATIONS, hook)
}

pub fn migrate_with(
    conn: &mut Connection,
    list: &[(u32, &str)],
    hook: &mut dyn FnMut(u32, u32) -> AppResult<()>,
) -> AppResult<MigrationOutcome> {
    let from: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let latest = list.iter().map(|(v, _)| *v).max().unwrap_or(0);
    if from > latest {
        return Err(AppError::Db(format!(
            "database schema version {from} is newer than this app supports ({latest})"
        )));
    }
    if from == latest {
        return Ok(MigrationOutcome { from, to: from });
    }
    let has_tables: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%')",
        [],
        |r| r.get(0),
    )?;
    if has_tables {
        // Backup first, while the old data is intact. An error aborts before any change.
        hook(from, latest)?;
    }
    let mut pending: Vec<&(u32, &str)> = list.iter().filter(|(v, _)| *v > from).collect();
    pending.sort_by_key(|(v, _)| *v);
    let tx = conn.transaction()?;
    for (v, sql) in pending {
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {v}"))?;
    }
    tx.commit()?;
    Ok(MigrationOutcome { from, to: latest })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_db() -> (tempfile::TempDir, std::path::PathBuf, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.db");
        let c = Connection::open(&p).unwrap();
        (dir, p, c)
    }

    fn version(c: &Connection) -> u32 {
        c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap()
    }

    fn v1_with_row() -> (tempfile::TempDir, std::path::PathBuf, Connection) {
        let (d, p, mut c) = file_db();
        migrate(&mut c, &mut |_, _| panic!("hook on fresh db")).unwrap();
        c.execute("INSERT INTO settings(key,value) VALUES('k','v')", []).unwrap();
        (d, p, c)
    }

    #[test]
    fn fresh_db_migrates_to_latest_without_backup() {
        let (_d, _p, mut c) = file_db();
        let mut calls = 0;
        let out = migrate(&mut c, &mut |_, _| {
            calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(calls, 0);
        assert_eq!(version(&c), MIGRATIONS.last().unwrap().0);
        assert_eq!(out, MigrationOutcome { from: 0, to: MIGRATIONS.last().unwrap().0 });
    }

    #[test]
    fn existing_db_calls_backup_hook_before_change() {
        let (_d, p, mut c) = v1_with_row();
        let list: &[(u32, &str)] = &[MIGRATIONS[0], (2, "CREATE TABLE extra (x INTEGER);")];
        let mut seen = vec![];
        let out = migrate_with(&mut c, list, &mut |f, t| {
            let other = Connection::open(&p).unwrap();
            let has_extra: i64 = other
                .query_row("SELECT count(*) FROM sqlite_master WHERE name='extra'", [], |r| r.get(0))
                .unwrap();
            seen.push((f, t, version(&other), has_extra));
            Ok(())
        })
        .unwrap();
        assert_eq!(seen, vec![(1, 2, 1, 0)]);
        assert_eq!(out, MigrationOutcome { from: 1, to: 2 });
        assert_eq!(version(&c), 2);
    }

    #[test]
    fn failed_migration_rolls_back_and_keeps_backup() {
        let (_d, _p, mut c) = v1_with_row();
        let list: &[(u32, &str)] =
            &[MIGRATIONS[0], (2, "CREATE TABLE half (x INTEGER); THIS IS NOT SQL;")];
        let mut calls = 0;
        let r = migrate_with(&mut c, list, &mut |_, _| {
            calls += 1;
            Ok(())
        });
        assert!(matches!(r, Err(AppError::Db(_))));
        assert_eq!(calls, 1);
        assert_eq!(version(&c), 1);
        let rows: i64 = c.query_row("SELECT count(*) FROM settings", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);
        let half: i64 = c
            .query_row("SELECT count(*) FROM sqlite_master WHERE name='half'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(half, 0);
    }

    #[test]
    fn hook_error_aborts_before_any_change() {
        let (_d, _p, mut c) = v1_with_row();
        let list: &[(u32, &str)] = &[MIGRATIONS[0], (2, "CREATE TABLE extra (x INTEGER);")];
        let r = migrate_with(&mut c, list, &mut |_, _| Err(AppError::Io("backup failed".into())));
        assert_eq!(r, Err(AppError::Io("backup failed".into())));
        assert_eq!(version(&c), 1);
    }

    #[test]
    fn newer_db_is_refused() {
        let (_d, _p, mut c) = file_db();
        c.execute_batch("PRAGMA user_version = 99").unwrap();
        assert!(matches!(migrate(&mut c, &mut |_, _| Ok(())), Err(AppError::Db(_))));
        assert_eq!(version(&c), 99);
    }

    #[test]
    fn migration_versions_strictly_increase() {
        assert!(!MIGRATIONS.is_empty());
        assert!(MIGRATIONS[0].0 >= 1);
        for w in MIGRATIONS.windows(2) {
            assert!(w[0].0 < w[1].0, "versions {} then {}", w[0].0, w[1].0);
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let (_d, _p, mut c) = file_db();
        migrate(&mut c, &mut |_, _| Ok(())).unwrap();
        let mut calls = 0;
        let out = migrate(&mut c, &mut |_, _| {
            calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(calls, 0);
        assert_eq!(out.from, out.to);
    }
}
