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
pub const MIGRATIONS: &[(u32, &str)] = &[
    (1, include_str!("../../migrations/0001_init.sql")),
    (2, include_str!("../../migrations/0002_hosts_log.sql")),
    (3, include_str!("../../migrations/0003_checklist_notes.sql")),
    (4, include_str!("../../migrations/0004_credentials_findings.sql")),
];

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
        if *v == 2 {
            backfill_hosts(&tx)?;
        }
        tx.execute_batch(&format!("PRAGMA user_version = {v}"))?;
    }
    tx.commit()?;
    Ok(MigrationOutcome { from, to: latest })
}

/// Data step of 0002: engagements that predate the hosts table get a host for each
/// single-IP scope entry. Runs inside the migration transaction; add-only, so re-running is safe.
///
/// Frozen at 0002's schema; never call live host code from a migration.
fn backfill_hosts(conn: &Connection) -> AppResult<()> {
    let has_hosts: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='hosts')",
        [],
        |r| r.get(0),
    )?;
    if !has_hosts {
        return Ok(());
    }
    let rows = conn
        .prepare("SELECT id, scope_cidrs FROM engagements")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, scope) in rows {
        let scope: Vec<String> = serde_json::from_str(&scope).unwrap_or_default();
        for entry in &scope {
            let Some(ip) = single_ip_0002(entry.trim()) else { continue };
            let taken: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM hosts WHERE engagement_id = ?1 AND ip = ?2)",
                rusqlite::params![id, ip],
                |r| r.get(0),
            )?;
            if taken {
                continue;
            }
            let now = crate::backup::system_now_ms();
            conn.execute(
                "INSERT INTO hosts (id, engagement_id, name, ip, created_at, updated_at) VALUES (?1,?2,?3,?3,?4,?4)",
                rusqlite::params![uuid::Uuid::new_v4().to_string(), id, ip, now],
            )?;
        }
    }
    Ok(())
}

/// 0002's own copy of the single-IP check: a bare IPv4 address or `/32`.
fn single_ip_0002(s: &str) -> Option<String> {
    let bare = s.strip_suffix("/32").unwrap_or(s);
    bare.parse::<std::net::Ipv4Addr>().ok().map(|_| bare.to_string())
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
        migrate_with(&mut c, &MIGRATIONS[..1], &mut |_, _| panic!("hook on fresh db")).unwrap();
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

    #[test]
    fn migration_0002_applies_on_a_v1_db() {
        let (_d, _p, mut c) = v1_with_row();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)",
            [],
        )
        .unwrap();
        let mut hook_calls = 0;
        let out = migrate(&mut c, &mut |f, t| {
            assert_eq!((f, t), (1, 4));
            hook_calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(hook_calls, 1);
        assert_eq!(out, MigrationOutcome { from: 1, to: 4 });
        assert_eq!(version(&c), 4);
        for t in ["hosts", "services", "log_entries", "log_entry_hosts", "attachments"] {
            let n: i64 = c
                .query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [t], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "{t}");
        }
        // existing data survives and the new column is present and empty
        let ran_on: Option<String> =
            c.query_row("SELECT last_ran_on FROM engagements WHERE id='e1'", [], |r| r.get(0)).unwrap();
        assert_eq!(ran_on, None);
        let kept: i64 = c.query_row("SELECT count(*) FROM settings", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 1);
    }

    #[test]
    fn migration_0004_from_v3_keeps_data() {
        let (_d, _p, mut c) = file_db();
        migrate_with(&mut c, &MIGRATIONS[..3], &mut |_, _| panic!("hook on fresh db")).unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h1','e1','dc01','10.0.0.5',1,1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO checklist_items (owner_id,engagement_id,goal_id,status,updated_at) VALUES ('h1','e1','g','done',1)",
            [],
        )
        .unwrap();
        let mut hook_calls = 0;
        let out = migrate(&mut c, &mut |f, t| {
            assert_eq!((f, t), (3, 4));
            hook_calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(hook_calls, 1);
        assert_eq!(out, MigrationOutcome { from: 3, to: 4 });
        assert_eq!(version(&c), 4);
        for t in [
            "credentials", "usernames", "access_grants", "cred_attempts", "findings",
            "finding_hosts", "finding_services", "finding_steps", "finding_files", "failed_attempts",
        ] {
            let n: i64 = c
                .query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [t], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "{t}");
        }
        let reviewed: Option<i64> =
            c.query_row("SELECT access_reviewed_at FROM hosts WHERE id='h1'", [], |r| r.get(0)).unwrap();
        assert_eq!(reviewed, None);
        let name: String = c.query_row("SELECT name FROM hosts WHERE id='h1'", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "dc01");
        let items: i64 = c.query_row("SELECT count(*) FROM checklist_items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 1);
    }

    #[test]
    fn migration_0002_backfills_hosts_from_existing_scope() {
        let (_d, _p, mut c) = v1_with_row();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) \
             VALUES ('e1','x','lab','[\"10.0.0.0/24\",\"10.0.0.5\",\"10.0.0.6/32\"]','active',1,1)",
            [],
        )
        .unwrap();
        migrate(&mut c, &mut |_, _| Ok(())).unwrap();
        let names = |c: &Connection| -> Vec<String> {
            c.prepare("SELECT name FROM hosts WHERE engagement_id='e1' ORDER BY name")
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(names(&c), ["10.0.0.5", "10.0.0.6"]);
        migrate(&mut c, &mut |_, _| Ok(())).unwrap();
        assert_eq!(names(&c), ["10.0.0.5", "10.0.0.6"]);
        // add-only even if sync runs again
        backfill_hosts(&c).unwrap();
        assert_eq!(names(&c).len(), 2);
    }

    #[test]
    fn migration_0002_backfill_is_frozen() {
        let (_d, _p, mut c) = v1_with_row();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) \
             VALUES ('e1','x','lab','[\"10.10.10.5\",\"10.10.10.0/24\"]','active',1,1)",
            [],
        )
        .unwrap();
        migrate(&mut c, &mut |_, _| Ok(())).unwrap();
        let rows: Vec<String> = c
            .prepare("SELECT ip FROM hosts WHERE engagement_id='e1'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(rows, ["10.10.10.5"]);
        let dual: i64 = c.query_row("SELECT dual_homed FROM hosts WHERE engagement_id='e1'", [], |r| r.get(0)).unwrap();
        assert_eq!(dual, 0);
    }
}
