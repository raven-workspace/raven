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
//!   SQLite 12-step table rebuild of a referenced table) starts its SQL with the marker line
//!   `-- raven:foreign-keys-off`. If any pending migration has it, the runner sets the pragma
//!   OFF before opening the shared transaction, runs `PRAGMA foreign_key_check` before commit
//!   (more rows than before the migrations ran is an `AppError::Db` and rolls everything back;
//!   orphans that already existed are tolerated), and restores `foreign_keys = ON`
//!   on every exit path.
//! - Append new entries to `MIGRATIONS` with a strictly greater version; never edit a shipped one.

use crate::error::{AppError, AppResult};
use rusqlite::Connection;

/// (version, SQL). Versions are strictly increasing.
pub const MIGRATIONS: &[(u32, &str)] = &[
    (1, include_str!("../../migrations/0001_init.sql")),
    (2, include_str!("../../migrations/0002_hosts_log.sql")),
    (3, include_str!("../../migrations/0003_checklist_notes.sql")),
    (4, include_str!("../../migrations/0004_credentials_findings.sql")),
    (5, include_str!("../../migrations/0005_ad_set.sql")),
    (6, include_str!("../../migrations/0006_checklist_status_manual.sql")),
    (7, include_str!("../../migrations/0007_cleanup.sql")),
    (8, include_str!("../../migrations/0008_pen200_columns.sql")),
    (9, include_str!("../../migrations/0009_field_manual.sql")),
    (10, include_str!("../../migrations/0010_host_facts.sql")),
    (11, include_str!("../../migrations/0011_tried_pairs_extractions.sql")),
    (12, include_str!("../../migrations/0012_log_payload.sql")),
    (13, include_str!("../../migrations/0013_payload_builds.sql")),
    (14, include_str!("../../migrations/0014_interface_dismissals.sql")),
    (15, include_str!("../../migrations/0015_reports.sql")),
    (16, include_str!("../../migrations/0016_timebox_pause.sql")),
];

const FK_OFF_MARKER: &str = "-- raven:foreign-keys-off";

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
    let fk_off = pending.iter().any(|(_, sql)| sql.trim_start().starts_with(FK_OFF_MARKER));
    if fk_off {
        conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    }
    let result = run_pending(conn, &pending, fk_off);
    if fk_off {
        // Restore on every exit path; the transaction is already committed or rolled back.
        let restore = conn.execute_batch("PRAGMA foreign_keys = ON").map_err(AppError::from);
        result?;
        restore?;
    } else {
        result?;
    }
    Ok(MigrationOutcome { from, to: latest })
}

fn run_pending(conn: &mut Connection, pending: &[&(u32, &str)], check_fks: bool) -> AppResult<()> {
    let tx = conn.transaction()?;
    // Old databases may already hold orphans; only violations a migration adds are fatal.
    let before: i64 = if check_fks {
        tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?
    } else {
        0
    };
    for (v, sql) in pending {
        tx.execute_batch(sql)?;
        if *v == 2 {
            backfill_hosts(&tx)?;
        }
        tx.execute_batch(&format!("PRAGMA user_version = {v}"))?;
    }
    if check_fks {
        let violations: i64 =
            tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
        if violations > before {
            let tables = tx
                .prepare("SELECT DISTINCT \"table\" FROM pragma_foreign_key_check")?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            return Err(AppError::Db(format!(
                "migration added {} foreign key violation(s) in: {}",
                violations - before,
                tables.join(", ")
            )));
        }
    }
    tx.commit()?;
    Ok(())
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
            let now = crate::db::now_ms();
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
            assert_eq!((f, t), (1, 16));
            hook_calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(hook_calls, 1);
        assert_eq!(out, MigrationOutcome { from: 1, to: 16 });
        assert_eq!(version(&c), 16);
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
        let out = migrate_with(&mut c, &MIGRATIONS[..4], &mut |f, t| {
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
    fn migration_0005_from_v4_keeps_data() {
        let (_d, _p, mut c) = file_db();
        migrate_with(&mut c, &MIGRATIONS[..4], &mut |_, _| panic!("hook on fresh db")).unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','exam-sim','[]','active',1,1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h1','e1','dc01','10.0.0.5',1,1)",
            [],
        )
        .unwrap();
        let mut hook_calls = 0;
        let out = migrate_with(&mut c, &MIGRATIONS[..5], &mut |f, t| {
            assert_eq!((f, t), (4, 5));
            hook_calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(hook_calls, 1);
        assert_eq!(out, MigrationOutcome { from: 4, to: 5 });
        assert_eq!(version(&c), 5);
        let ad: Option<i64> = c.query_row("SELECT ad_set FROM hosts WHERE id='h1'", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, None);
        let name: String = c.query_row("SELECT name FROM hosts WHERE id='h1'", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "dc01");
        c.execute("UPDATE hosts SET ad_set = 1 WHERE id='h1'", []).unwrap();
        assert!(c.execute("UPDATE hosts SET ad_set = 2 WHERE id='h1'", []).is_err());
    }

    #[test]
    fn migration_0006_from_v5_defaults_status_manual_to_zero() {
        let (_d, _p, mut c) = v1_with_row();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        migrate_with(&mut c, &MIGRATIONS[..5], &mut |_, _| Ok(())).unwrap();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO checklist_items (owner_id,engagement_id,goal_id,status,updated_at) VALUES ('e1','e1','g','na',1)",
            [],
        )
        .unwrap();
        let out = migrate_with(&mut c, &MIGRATIONS[..6], &mut |f, t| {
            assert_eq!((f, t), (5, 6));
            Ok(())
        })
        .unwrap();
        assert_eq!(out, MigrationOutcome { from: 5, to: 6 });
        let m: i64 = c.query_row("SELECT status_manual FROM checklist_items WHERE goal_id='g'", [], |r| r.get(0)).unwrap();
        assert_eq!(m, 0);
        assert!(c.execute("UPDATE checklist_items SET status_manual = 2", []).is_err());
    }

    #[test]
    fn migration_0007_from_v6_adds_cleanup_items() {
        let (_d, _p, mut c) = file_db();
        migrate_with(&mut c, &MIGRATIONS[..6], &mut |_, _| panic!("hook on fresh db")).unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)",
            [],
        )
        .unwrap();
        let out = migrate_with(&mut c, &MIGRATIONS[..7], &mut |f, t| {
            assert_eq!((f, t), (6, 7));
            Ok(())
        })
        .unwrap();
        assert_eq!(out, MigrationOutcome { from: 6, to: 7 });
        assert_eq!(version(&c), 7);
        let ins = |status: &str, key: Option<&str>| {
            c.execute(
                "INSERT INTO cleanup_items (id,engagement_id,kind,target,suggestion_key,status,created_at,updated_at) \
                 VALUES (lower(hex(randomblob(4))),'e1','file','t',?1,?2,1,1)",
                rusqlite::params![key, status],
            )
        };
        ins("open", Some("k")).unwrap();
        assert!(ins("open", Some("k")).is_err());
        assert!(ins("bogus", None).is_err());
        ins("open", None).unwrap();
        ins("open", None).unwrap();
        let kept: i64 = c.query_row("SELECT count(*) FROM engagements", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 1);
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

    fn count(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn v7_hosts_rebuild_maps_columns_and_keeps_children() {
        let (_d, _p, mut c) = file_db();
        migrate_with(&mut c, &MIGRATIONS[..7], &mut |_, _| panic!("hook on fresh db")).unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)",
            [],
        )
        .unwrap();
        for (i, (col, manual)) in
            [("enumerate", 0), ("foothold", 1), ("privesc", 0), ("loot", 0), ("done", 0)].iter().enumerate()
        {
            c.execute(
                "INSERT INTO hosts (id,engagement_id,name,ip,board_column,board_manual,board_derived,created_at,updated_at) \
                 VALUES (?1,'e1',?1,?2,?3,?4,?3,1,1)",
                rusqlite::params![format!("h{i}"), format!("10.0.0.{i}"), col, manual],
            )
            .unwrap();
        }
        c.execute_batch(
            "INSERT INTO log_entries (id,engagement_id,kind,title,content,at,created_at,updated_at) VALUES ('l1','e1','note','t','c',1,1,1);
             INSERT INTO services (id,host_id,port,created_at,updated_at) VALUES ('s1','h0',80,1,1);
             INSERT INTO log_entry_hosts (entry_id,host_id) VALUES ('l1','h0');
             INSERT INTO tunnels (id,engagement_id,kind,via_host_id,status,created_at,updated_at) VALUES ('t1','e1','ssh','h1','up',1,1);
             INSERT INTO hops (id,engagement_id,from_host_id,to_host_id,via,at,updated_at) VALUES ('p1','e1','h1','h2','ssh',1,1);
             INSERT INTO checklist_items (owner_id,engagement_id,goal_id,status,updated_at) VALUES ('h2','e1','g','todo',1);
             INSERT INTO credentials (id,engagement_id,type,source_host_id,created_at,updated_at) VALUES ('c1','e1','password','h3',1,1);
             INSERT INTO cleanup_items (id,engagement_id,host_id,kind,target,status,created_at,updated_at) VALUES ('u1','e1','h3','file','t','open',1,1);
             UPDATE engagements SET msf_host_id='h4' WHERE id='e1';",
        )
        .unwrap();
        let child_counts = |c: &Connection| -> Vec<i64> {
            [
                "services", "log_entry_hosts", "tunnels", "hops", "checklist_items", "credentials", "cleanup_items",
            ]
            .iter()
            .map(|t| count(c, &format!("SELECT count(*) FROM {t}")))
            .collect()
        };
        let before = child_counts(&c);
        assert_eq!(before, vec![1; 7]);

        migrate(&mut c, &mut |_, _| Ok(())).unwrap();

        let cols: Vec<(String, i64)> = c
            .prepare("SELECT board_column, board_manual FROM hosts ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            cols,
            [
                ("information-gathering".to_string(), 0),
                ("vulnerability-detection".to_string(), 1),
                ("privilege-escalation".to_string(), 0),
                ("post-exploitation".to_string(), 0),
                ("reporting".to_string(), 0),
            ]
        );
        assert_eq!(count(&c, "SELECT count(*) FROM hosts WHERE board_derived IS NOT NULL"), 0);
        assert_eq!(child_counts(&c), before);
        assert_eq!(count(&c, "SELECT count(*) FROM engagements WHERE msf_host_id='h4'"), 1);
        assert_eq!(count(&c, "SELECT count(*) FROM pragma_foreign_key_check"), 0);
        assert_eq!(count(&c, "PRAGMA foreign_keys"), 1);
        assert!(c
            .execute(
                "INSERT INTO hosts (id,engagement_id,name,ip,board_column,created_at,updated_at) VALUES ('x','e1','x','10.9.9.9','enumerate',1,1)",
                [],
            )
            .is_err());
        c.execute(
            "INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('d','e1','d','10.9.9.8',1,1)",
            [],
        )
        .unwrap();
        let def: String = c.query_row("SELECT board_column FROM hosts WHERE id='d'", [], |r| r.get(0)).unwrap();
        assert_eq!(def, "information-gathering");
        c.execute("DELETE FROM hosts WHERE id='h0'", []).unwrap();
        assert_eq!(count(&c, "SELECT count(*) FROM services"), 0);
    }

    #[test]
    fn fk_off_migration_failure_rolls_back() {
        let (_d, _p, mut c) = v1_with_row();
        let list: &[(u32, &str)] = &[
            MIGRATIONS[0],
            (2, "-- raven:foreign-keys-off\nCREATE TABLE half (x INTEGER); THIS IS NOT SQL;"),
        ];
        let r = migrate_with(&mut c, list, &mut |_, _| Ok(()));
        assert!(matches!(r, Err(AppError::Db(_))));
        assert_eq!(version(&c), 1);
        assert_eq!(count(&c, "SELECT count(*) FROM settings"), 1);
        assert_eq!(count(&c, "SELECT count(*) FROM sqlite_master WHERE name='half'"), 0);
        assert_eq!(count(&c, "PRAGMA foreign_keys"), 1);
    }

    fn v2_db() -> Connection {
        let (_d, _p, mut c) = file_db();
        std::mem::forget(_d);
        migrate_with(&mut c, &MIGRATIONS[..2], &mut |_, _| panic!("hook on fresh db")).unwrap();
        c
    }

    const ORPHAN: &str = "INSERT INTO services (id,host_id,port,created_at,updated_at) VALUES ('s9','nope',22,1,1)";

    #[test]
    fn fk_off_migration_rejects_new_violation() {
        let mut c = v2_db();
        c.execute("INSERT INTO settings(key,value) VALUES('k','v')", []).unwrap();
        let sql = format!("-- raven:foreign-keys-off\n{ORPHAN};");
        let list: &[(u32, &str)] = &[MIGRATIONS[0], MIGRATIONS[1], (3, &sql)];
        let r = migrate_with(&mut c, list, &mut |_, _| Ok(()));
        match r {
            Err(AppError::Db(m)) => assert!(m.contains("services"), "{m}"),
            other => panic!("expected Db error, got {other:?}"),
        }
        assert_eq!(version(&c), 2);
        assert_eq!(count(&c, "SELECT count(*) FROM services"), 0);
        assert_eq!(count(&c, "SELECT count(*) FROM settings"), 1);
        assert_eq!(count(&c, "PRAGMA foreign_keys"), 1);
    }

    #[test]
    fn fk_off_migration_tolerates_preexisting_orphan() {
        let mut c = v2_db();
        c.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        c.execute(ORPHAN, []).unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        let list: &[(u32, &str)] =
            &[MIGRATIONS[0], MIGRATIONS[1], (3, "-- raven:foreign-keys-off\nCREATE TABLE marker (x INTEGER);")];
        let out = migrate_with(&mut c, list, &mut |_, _| Ok(())).unwrap();
        assert_eq!(out, MigrationOutcome { from: 2, to: 3 });
        assert_eq!(version(&c), 3);
        assert_eq!(count(&c, "SELECT count(*) FROM services"), 1);
        assert_eq!(count(&c, "PRAGMA foreign_keys"), 1);
    }

    #[test]
    fn migration_0009_from_v8_adds_field_manual_and_keeps_data() {
        let (_d, _p, mut c) = file_db();
        migrate_with(&mut c, &MIGRATIONS[..8], &mut |_, _| panic!("hook on fresh db")).unwrap();
        c.execute("INSERT INTO settings (key, value) VALUES ('k', 'v')", []).unwrap();
        let mut hook_calls = 0;
        let out = migrate(&mut c, &mut |f, t| {
            assert_eq!((f, t), (8, 16));
            hook_calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(hook_calls, 1);
        assert_eq!(out, MigrationOutcome { from: 8, to: 16 });
        let kept: i64 = c.query_row("SELECT count(*) FROM settings WHERE key='k'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 1);
        c.execute("INSERT INTO field_manual (id, imported_at, snapshot) VALUES (1, 1, '{}')", []).unwrap();
        assert!(c.execute("INSERT INTO field_manual (id, imported_at, snapshot) VALUES (2, 1, '{}')", []).is_err());
    }

    #[test]
    fn migration_0016_from_v15_adds_running_timebox_pause_state() {
        let (_d, _p, mut c) = file_db();
        migrate_with(&mut c, &MIGRATIONS[..15], &mut |_, _| panic!("hook on fresh db")).unwrap();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,timebox_start,timebox_minutes,status,created_at,updated_at) \
             VALUES ('e1','x','exam-sim','[]',5,1425,'active',1,1)",
            [],
        )
        .unwrap();
        let mut hook_calls = 0;
        let out = migrate(&mut c, &mut |f, t| {
            assert_eq!((f, t), (15, 16));
            hook_calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!((hook_calls, out), (1, MigrationOutcome { from: 15, to: 16 }));
        let (ms, at, start): (i64, Option<i64>, i64) = c
            .query_row("SELECT timebox_paused_ms, timebox_paused_at, timebox_start FROM engagements WHERE id='e1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((ms, at, start), (0, None, 5));
    }
}
