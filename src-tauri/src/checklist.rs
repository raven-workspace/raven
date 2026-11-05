//! Checklist item storage. The engine (TS) decides what the items mean; this module only
//! persists them, keyed by (owner_id, goal_id) where owner_id is a host id or the engagement id.

use crate::backup::system_now_ms;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const MAX_ITEMS: usize = 500;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub entry_id: String,
    #[serde(default)]
    pub command_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub owner_id: String,
    pub goal_id: String,
    pub status: String,
    pub notes: Option<String>,
    pub completed_at: Option<i64>,
    pub auto: bool,
    pub auto_from: Option<String>,
    pub status_manual: bool,
    pub evidence: Vec<Evidence>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItemInput {
    pub owner_id: String,
    pub goal_id: String,
    pub status: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub auto: bool,
    #[serde(default)]
    pub auto_from: Option<String>,
    /// Left out, the stored value stays (auto-tick writes never clear a hand-set status).
    #[serde(default)]
    pub status_manual: Option<bool>,
    #[serde(default)]
    pub evidence: Vec<Evidence>,
}

fn invalid(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<ChecklistItem>> {
    let mut st = conn.prepare(
        "SELECT owner_id, goal_id, status, notes, completed_at, auto, auto_from, evidence, updated_at, status_manual \
         FROM checklist_items WHERE engagement_id = ?1 ORDER BY owner_id, goal_id",
    )?;
    let rows = st.query_map([engagement_id], |r| {
        let json: String = r.get(7)?;
        let evidence = serde_json::from_str(&json)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(e)))?;
        Ok(ChecklistItem {
            owner_id: r.get(0)?,
            goal_id: r.get(1)?,
            status: r.get(2)?,
            notes: r.get(3)?,
            completed_at: r.get(4)?,
            auto: r.get(5)?,
            auto_from: r.get(6)?,
            evidence,
            updated_at: r.get(8)?,
            status_manual: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Upserts every item in one transaction (all or nothing) and returns the engagement's full list.
pub fn put(conn: &Connection, engagement_id: &str, items: &[ChecklistItemInput]) -> AppResult<Vec<ChecklistItem>> {
    if items.len() > MAX_ITEMS {
        return Err(invalid("items", "too many items (max 500)"));
    }
    let exists: bool =
        conn.query_row("SELECT EXISTS(SELECT 1 FROM engagements WHERE id = ?1)", [engagement_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::NotFound);
    }
    let tx = conn.unchecked_transaction()?;
    let now = system_now_ms();
    for it in items {
        if it.goal_id.trim().is_empty() {
            return Err(invalid("goalId", "goal id is required"));
        }
        if !matches!(it.status.as_str(), "todo" | "in_progress" | "done" | "na") {
            return Err(invalid("status", "status must be todo, in_progress, done or na"));
        }
        if let Some(a) = &it.auto_from
            && !matches!(a.as_str(), "na" | "in_progress") {
                return Err(invalid("autoFrom", "autoFrom must be na or in_progress"));
            }
        let owned: bool = it.owner_id == engagement_id
            || tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM hosts WHERE id = ?1 AND engagement_id = ?2)",
                params![it.owner_id, engagement_id],
                |r| r.get(0),
            )?;
        if !owned {
            return Err(invalid("ownerId", "owner is not part of this engagement"));
        }
        let evidence = serde_json::to_string(&it.evidence).map_err(|e| AppError::Db(e.to_string()))?;
        tx.execute(
            "INSERT INTO checklist_items \
               (owner_id, engagement_id, goal_id, status, notes, completed_at, auto, auto_from, evidence, updated_at, status_manual) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,COALESCE(?11, 0)) \
             ON CONFLICT(owner_id, goal_id) DO UPDATE SET \
               status=excluded.status, notes=excluded.notes, completed_at=excluded.completed_at, \
               auto=excluded.auto, auto_from=excluded.auto_from, evidence=excluded.evidence, \
               updated_at=excluded.updated_at, status_manual=COALESCE(?11, status_manual)",
            params![
                it.owner_id, engagement_id, it.goal_id, it.status, it.notes, it.completed_at,
                it.auto, it.auto_from, evidence, now, it.status_manual
            ],
        )?;
    }
    tx.commit()?;
    list(conn, engagement_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engagements::{self, EngagementInput};
    use crate::hosts::{self, HostInput};
    use crate::migrations;
    use crate::paths::DataPaths;
    use crate::vault::Vault;

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    fn eng(c: &Connection) -> String {
        engagements::create(
            c,
            EngagementInput {
                name: "lab".into(),
                kind: "lab".into(),
                client: None,
                sub_label: None,
                scope_cidrs: vec![],
                domain: None,
                starts_at: None,
                ends_at: None,
                timebox_start: None,
                timebox_minutes: None,
            },
        )
        .unwrap()
        .id
    }

    fn host(c: &Connection, e: &str, ip: &str) -> String {
        hosts::create(c, e, HostInput { name: ip.into(), ip: Some(ip.into()), os: None, access: None, dual_homed: None, ad_set: None }).unwrap().id
    }

    fn item(owner: &str, goal: &str, status: &str) -> ChecklistItemInput {
        ChecklistItemInput {
            owner_id: owner.into(),
            goal_id: goal.into(),
            status: status.into(),
            notes: None,
            completed_at: None,
            auto: false,
            auto_from: None,
            status_manual: None,
            evidence: vec![],
        }
    }

    #[test]
    fn put_then_list_round_trips_items_and_evidence() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let mut a = item(&h, "enum.nmap", "done");
        a.notes = Some("all ports".into());
        a.completed_at = Some(42);
        a.auto = true;
        a.auto_from = Some("na".into());
        a.evidence = vec![
            Evidence { entry_id: "x1".into(), command_id: Some("c1".into()) },
            Evidence { entry_id: "x2".into(), command_id: None },
        ];
        let out = put(c, &e, &[a.clone(), item(&e, "eng.scope", "todo")]).unwrap();
        assert_eq!(out.len(), 2);
        let got = list(c, &e).unwrap().into_iter().find(|i| i.owner_id == h).unwrap();
        assert_eq!(got.goal_id, "enum.nmap");
        assert_eq!(got.status, "done");
        assert_eq!(got.notes.as_deref(), Some("all ports"));
        assert_eq!(got.completed_at, Some(42));
        assert!(got.auto);
        assert_eq!(got.auto_from.as_deref(), Some("na"));
        assert_eq!(got.evidence, a.evidence);
        assert!(got.updated_at > 0);
    }

    #[test]
    fn status_manual_round_trips_and_an_omitted_value_keeps_it() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let mut a = item(&h, "g", "todo");
        a.status_manual = Some(true);
        let out = put(c, &e, &[a]).unwrap();
        assert!(out[0].status_manual);
        // An auto-tick style write leaves it out: the flag stays.
        let mut tick = item(&h, "g", "done");
        tick.auto = true;
        let out = put(c, &e, &[tick]).unwrap();
        assert_eq!(out[0].status, "done");
        assert!(out[0].status_manual);
        let mut clear = item(&h, "g", "todo");
        clear.status_manual = Some(false);
        assert!(!put(c, &e, &[clear]).unwrap()[0].status_manual);
        assert!(!put(c, &e, &[item(&e, "other", "todo")]).unwrap().iter().any(|i| i.goal_id == "other" && i.status_manual));
    }

    #[test]
    fn put_upserts_on_owner_and_goal() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        put(c, &e, &[item(&h, "g", "todo")]).unwrap();
        let mut second = item(&h, "g", "done");
        second.notes = Some("n".into());
        let out = put(c, &e, &[second]).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].status, "done");
        assert_eq!(out[0].notes.as_deref(), Some("n"));
    }

    #[test]
    fn put_rejects_owner_from_other_engagement() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e1 = eng(c);
        let e2 = eng(c);
        let h2 = host(c, &e2, "10.0.0.9");
        assert!(matches!(put(c, &e1, &[item(&h2, "g", "todo")]), Err(AppError::Validation { .. })));
        assert!(matches!(put(c, &e1, &[item(&e2, "g", "todo")]), Err(AppError::Validation { .. })));
        assert!(matches!(put(c, &e1, &[item("nope", "g", "todo")]), Err(AppError::Validation { .. })));
        assert!(list(c, &e1).unwrap().is_empty());
    }

    #[test]
    fn put_rejects_bad_status_and_auto_from() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        assert!(matches!(put(c, &e, &[item(&e, "g", "finished")]), Err(AppError::Validation { .. })));
        let mut bad = item(&e, "g", "todo");
        bad.auto_from = Some("done".into());
        assert!(matches!(put(c, &e, &[bad]), Err(AppError::Validation { .. })));
        let many: Vec<_> = (0..501).map(|i| item(&e, &format!("g{i}"), "todo")).collect();
        assert!(matches!(put(c, &e, &many), Err(AppError::Validation { .. })));
        assert!(list(c, &e).unwrap().is_empty());
    }

    #[test]
    fn put_is_atomic() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let r = put(c, &e, &[item(&e, "a", "done"), item(&e, "b", "bogus")]);
        assert!(r.is_err());
        assert!(list(c, &e).unwrap().is_empty());
    }

    #[test]
    fn deleting_host_cascades_its_items() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        put(c, &e, &[item(&h, "g", "done"), item(&e, "g", "done")]).unwrap();
        hosts::delete(c, &h).unwrap();
        let left = list(c, &e).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].owner_id, e);
    }

    #[test]
    fn migration_0003_from_v2_keeps_data() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..2], &mut |_, _| Ok(())).unwrap();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h1','e1','a','10.0.0.5',1,1)", []).unwrap();
        c.execute(
            "INSERT INTO log_entries (id,engagement_id,kind,title,content,at,created_at,updated_at) VALUES ('l1','e1','note','t','{}',1,1,1)",
            [],
        )
        .unwrap();
        let mut hook_calls = 0;
        let out = migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..3], &mut |f, t| {
            assert_eq!((f, t), (2, 3));
            hook_calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(hook_calls, 1);
        assert_eq!(out.to, 3);
        let (dual, derived): (i64, Option<String>) =
            c.query_row("SELECT dual_homed, board_derived FROM hosts WHERE id='h1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((dual, derived), (0, None));
        let msf: Option<String> = c.query_row("SELECT msf_host_id FROM engagements WHERE id='e1'", [], |r| r.get(0)).unwrap();
        assert_eq!(msf, None);
        let logs: i64 = c.query_row("SELECT count(*) FROM log_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(logs, 1);
        for t in ["checklist_items", "notes", "ruled_out", "tunnels", "hops"] {
            let n: i64 = c.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [t], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "{t}");
        }
    }
}
