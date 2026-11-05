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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRef {
    pub owner_id: String,
    pub goal_id: String,
}

/// The domain admin cover, as conditional writes so a status set by hand is never overwritten (F-R1). `cover` goals
/// become `na` with `auto` set, only where there is no row or the row is an untouched `todo` (not auto, not set by
/// hand); notes and evidence stay. `revert` goals go back to `todo`, only where the row is cover-marked (`na`, auto,
/// not set by hand). One transaction; returns the engagement's items.
pub fn apply_cover(
    conn: &Connection,
    engagement_id: &str,
    cover: &[GoalRef],
    revert: &[GoalRef],
) -> AppResult<Vec<ChecklistItem>> {
    if cover.len() + revert.len() > MAX_ITEMS * 4 {
        return Err(invalid("cover", "too many items"));
    }
    let exists: bool =
        conn.query_row("SELECT EXISTS(SELECT 1 FROM engagements WHERE id = ?1)", [engagement_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::NotFound);
    }
    let tx = conn.unchecked_transaction()?;
    let now = system_now_ms();
    for g in cover.iter().chain(revert.iter()) {
        let owned: bool = g.owner_id == engagement_id
            || tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM hosts WHERE id = ?1 AND engagement_id = ?2)",
                params![g.owner_id, engagement_id],
                |r| r.get(0),
            )?;
        if !owned || g.goal_id.trim().is_empty() {
            return Err(invalid("ownerId", "owner is not part of this engagement"));
        }
    }
    for g in revert {
        tx.execute(
            "UPDATE checklist_items SET status='todo', auto=0, auto_from=NULL, completed_at=NULL, updated_at=?3 \
             WHERE owner_id=?1 AND goal_id=?2 AND status='na' AND auto=1 AND status_manual=0",
            params![g.owner_id, g.goal_id, now],
        )?;
    }
    for g in cover {
        tx.execute(
            "INSERT INTO checklist_items \
               (owner_id, engagement_id, goal_id, status, notes, completed_at, auto, auto_from, evidence, updated_at, status_manual) \
             VALUES (?1,?2,?3,'na',NULL,NULL,1,NULL,'[]',?4,0) \
             ON CONFLICT(owner_id, goal_id) DO UPDATE SET status='na', auto=1, auto_from=NULL, completed_at=NULL, updated_at=excluded.updated_at \
             WHERE checklist_items.status='todo' AND checklist_items.auto=0 AND checklist_items.status_manual=0",
            params![g.owner_id, engagement_id, g.goal_id, now],
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

    fn gref(o: &str, g: &str) -> GoalRef {
        GoalRef { owner_id: o.into(), goal_id: g.into() }
    }

    fn row<'a>(items: &'a [ChecklistItem], o: &str, g: &str) -> Option<&'a ChecklistItem> {
        items.iter().find(|i| i.owner_id == o && i.goal_id == g)
    }

    #[test]
    fn cover_inserts_missing_rows_and_skips_hand_and_worked_rows() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let mut manual = item(&h, "manual", "todo");
        manual.status_manual = Some(true);
        let mut noted = item(&h, "noted", "todo");
        noted.notes = Some("keep".into());
        noted.evidence = vec![Evidence { entry_id: "x1".into(), command_id: None }];
        let mut auto_prog = item(&h, "autoprog", "in_progress");
        auto_prog.auto = true;
        put(c, &e, &[manual, noted, item(&h, "prog", "in_progress"), item(&h, "done", "done"), auto_prog]).unwrap();
        let goals: Vec<GoalRef> = ["missing", "manual", "noted", "prog", "done", "autoprog"].iter().map(|g| gref(&h, g)).collect();
        let out = apply_cover(c, &e, &goals, &[]).unwrap();
        let m = row(&out, &h, "missing").unwrap();
        assert_eq!((m.status.as_str(), m.auto), ("na", true));
        let n = row(&out, &h, "noted").unwrap();
        assert_eq!((n.status.as_str(), n.auto), ("na", true));
        assert_eq!(n.notes.as_deref(), Some("keep"));
        assert_eq!(n.evidence.len(), 1);
        for g in ["manual", "prog", "done", "autoprog"] {
            assert_ne!(row(&out, &h, g).unwrap().status, "na", "{g}");
        }
        assert!(!row(&out, &h, "manual").unwrap().auto);
    }

    #[test]
    fn revert_only_touches_cover_marked_rows() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let mut hand_na = item(&h, "handna", "na");
        hand_na.status_manual = Some(true);
        let mut hand_na_auto = item(&h, "handnaauto", "na");
        hand_na_auto.auto = true;
        hand_na_auto.status_manual = Some(true);
        put(c, &e, &[hand_na, hand_na_auto, item(&h, "plainna", "na"), item(&h, "done", "done")]).unwrap();
        apply_cover(c, &e, &[gref(&h, "covered")], &[]).unwrap();
        let goals: Vec<GoalRef> = ["covered", "handna", "handnaauto", "plainna", "done", "none"].iter().map(|g| gref(&h, g)).collect();
        let out = apply_cover(c, &e, &[], &goals).unwrap();
        let cov = row(&out, &h, "covered").unwrap();
        assert_eq!((cov.status.as_str(), cov.auto, cov.auto_from.clone(), cov.completed_at), ("todo", false, None, None));
        assert_eq!(row(&out, &h, "handna").unwrap().status, "na");
        assert_eq!(row(&out, &h, "handnaauto").unwrap().status, "na");
        assert_eq!(row(&out, &h, "plainna").unwrap().status, "na");
        assert_eq!(row(&out, &h, "done").unwrap().status, "done");
        assert!(row(&out, &h, "none").is_none());
    }

    #[test]
    fn a_row_turned_manual_before_the_cover_write_is_untouched() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        put(c, &e, &[item(&h, "g", "todo")]).unwrap();
        // The cover was computed on the todo row; then the user sets Done by hand.
        let mut hand = item(&h, "g", "done");
        hand.status_manual = Some(true);
        put(c, &e, &[hand]).unwrap();
        let out = apply_cover(c, &e, &[gref(&h, "g")], &[]).unwrap();
        let r = row(&out, &h, "g").unwrap();
        assert_eq!((r.status.as_str(), r.auto, r.status_manual), ("done", false, true));
        // A cover-marked row the user then sets by hand is not reverted either.
        apply_cover(c, &e, &[gref(&h, "k")], &[]).unwrap();
        let mut hand = item(&h, "k", "na");
        hand.status_manual = Some(true);
        hand.auto = true;
        put(c, &e, &[hand]).unwrap();
        let out = apply_cover(c, &e, &[], &[gref(&h, "k")]).unwrap();
        assert_eq!(row(&out, &h, "k").unwrap().status, "na");
    }

    #[test]
    fn cover_rejects_a_foreign_owner() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        assert!(apply_cover(c, &e, &[gref("nope", "g")], &[]).is_err());
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
