//! Host facts the user or a parser records: who the user is on the host (`host_identity`) and
//! the privilege-escalation vectors worth trying (`privesc_vectors`).

use crate::db::{blank_to_none, in_engagement, now_ms};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostIdentity {
    pub host_id: String,
    pub username: String,
    pub privileges: Vec<String>,
    pub groups: Vec<String>,
    pub entry_id: Option<String>,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivescVector {
    pub id: String,
    pub host_id: String,
    pub title: String,
    pub status: String,
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorInput {
    pub title: String,
    pub status: String,
    pub source: String,
}

fn host_engagement(conn: &Connection, host_id: &str) -> AppResult<String> {
    conn.query_row("SELECT engagement_id FROM hosts WHERE id = ?1", [host_id], |r| r.get(0)).optional()?.ok_or(AppError::NotFound)
}

fn clean_list(items: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for i in items.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if !out.iter().any(|o| o == i) {
            out.push(i.to_string());
        }
    }
    out
}

fn identity_from_row(r: &Row) -> rusqlite::Result<HostIdentity> {
    let parse = |s: String| serde_json::from_str::<Vec<String>>(&s).unwrap_or_default();
    Ok(HostIdentity {
        host_id: r.get(0)?,
        username: r.get(1)?,
        privileges: parse(r.get(2)?),
        groups: parse(r.get(3)?),
        entry_id: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn identity_get(conn: &Connection, host_id: &str) -> AppResult<Option<HostIdentity>> {
    Ok(conn.query_row(
        "SELECT host_id, username, privileges, groups, entry_id, updated_at FROM host_identity WHERE host_id = ?1",
        [host_id],
        identity_from_row,
    ).optional()?)
}

/// One identity per host; a new one replaces the old. `entry_id`, when given, must be a log
/// entry in the host's engagement.
pub fn identity_set(conn: &Connection, input: HostIdentity) -> AppResult<HostIdentity> {
    let username = input.username.trim().to_string();
    if username.is_empty() || username.chars().count() > 200 {
        return Err(AppError::validation("username", "username must be 1-200 characters"));
    }
    let engagement_id = host_engagement(conn, &input.host_id)?;
    let entry_id = blank_to_none(input.entry_id.as_deref());
    if let Some(e) = &entry_id
        && !in_engagement(conn, "log_entries", &engagement_id, e)? {
            return Err(AppError::validation("entryId", "entry must belong to this engagement"));
        }
    let privileges = serde_json::to_string(&clean_list(&input.privileges))?;
    let groups = serde_json::to_string(&clean_list(&input.groups))?;
    conn.execute(
        "INSERT INTO host_identity (host_id, username, privileges, groups, entry_id, updated_at) VALUES (?1,?2,?3,?4,?5,?6) \
         ON CONFLICT (host_id) DO UPDATE SET username = excluded.username, privileges = excluded.privileges, \
           groups = excluded.groups, entry_id = excluded.entry_id, updated_at = excluded.updated_at",
        params![input.host_id, username, privileges, groups, entry_id, now_ms()],
    )?;
    identity_get(conn, &input.host_id)?.ok_or(AppError::NotFound)
}

const VEC_COLS: &str = "id, host_id, title, status, source, created_at, updated_at";

fn vector_from_row(r: &Row) -> rusqlite::Result<PrivescVector> {
    Ok(PrivescVector {
        id: r.get(0)?,
        host_id: r.get(1)?,
        title: r.get(2)?,
        status: r.get(3)?,
        source: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

pub fn vector_get(conn: &Connection, id: &str) -> AppResult<PrivescVector> {
    conn.query_row(&format!("SELECT {VEC_COLS} FROM privesc_vectors WHERE id = ?1"), [id], vector_from_row).optional()?.ok_or(AppError::NotFound)
}

pub fn vectors_list(conn: &Connection, host_id: &str) -> AppResult<Vec<PrivescVector>> {
    let mut st = conn.prepare(&format!("SELECT {VEC_COLS} FROM privesc_vectors WHERE host_id = ?1 ORDER BY created_at, rowid"))?;
    let rows = st.query_map([host_id], vector_from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn check_status(status: &str) -> AppResult<()> {
    if matches!(status, "try" | "untested" | "ruled_out") {
        Ok(())
    } else {
        Err(AppError::validation("status", "status must be try, untested or ruled_out"))
    }
}

/// Upsert on `(host_id, title)`. An `auto` upsert (a parser re-reading output) never changes
/// a vector the user set by hand: an existing `ruled_out` stays, and a `manual` row keeps its
/// status. A `manual` upsert always applies. Creating as `ruled_out` is not allowed here
/// (use `vector_set_status`, which needs a reason).
pub fn vector_upsert(conn: &Connection, host_id: &str, input: VectorInput) -> AppResult<PrivescVector> {
    let title = input.title.trim().to_string();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(AppError::validation("title", "title must be 1-200 characters"));
    }
    check_status(&input.status)?;
    if !matches!(input.source.as_str(), "auto" | "manual") {
        return Err(AppError::validation("source", "source must be auto or manual"));
    }
    if input.status == "ruled_out" {
        return Err(AppError::validation("status", "rule a vector out with a reason"));
    }
    host_engagement(conn, host_id)?;
    let now = now_ms();
    let existing: Option<PrivescVector> = vectors_list(conn, host_id)?.into_iter().find(|v| v.title == title);
    match existing {
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO privesc_vectors (id, host_id, title, status, source, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)",
                params![id, host_id, title, input.status, input.source, now],
            )?;
            vector_get(conn, &id)
        }
        Some(v) if input.source == "auto" && (v.status == "ruled_out" || v.source == "manual") => Ok(v),
        Some(v) => {
            if v.status == "ruled_out" {
                // A manual re-add after a ruling-out reopens it; drop the linked ruled-out item.
                let tx = conn.unchecked_transaction()?;
                crate::notes::unlink_ruled_out(&tx, "vector", &v.id)?;
                tx.execute(
                    "UPDATE privesc_vectors SET status=?2, source=?3, updated_at=?4 WHERE id=?1",
                    params![v.id, input.status, input.source, now],
                )?;
                tx.commit()?;
            } else {
                conn.execute(
                    "UPDATE privesc_vectors SET status=?2, source=?3, updated_at=?4 WHERE id=?1",
                    params![v.id, input.status, input.source, now],
                )?;
            }
            vector_get(conn, &v.id)
        }
    }
}

/// Like `services::set_verdict`: `ruled_out` needs a reason and creates a linked ruled-out item;
/// leaving `ruled_out` removes only that item. One transaction.
pub fn vector_set_status(conn: &Connection, id: &str, status: &str, reason: Option<&str>) -> AppResult<PrivescVector> {
    check_status(status)?;
    let reason = reason.map(str::trim).filter(|s| !s.is_empty());
    if status == "ruled_out" && reason.is_none() {
        return Err(AppError::validation("reason", "a ruled-out vector needs a reason"));
    }
    let v = vector_get(conn, id)?;
    let engagement_id = host_engagement(conn, &v.host_id)?;
    let tx = conn.unchecked_transaction()?;
    crate::notes::unlink_ruled_out(&tx, "vector", id)?;
    if let (true, Some(reason)) = (status == "ruled_out", reason) {
        crate::notes::link_ruled_out(&tx, &engagement_id, &v.host_id, "vector", id, &v.title, reason)?;
    }
    // Hand-set status marks the row manual, so a later parser run cannot undo it.
    tx.execute(
        "UPDATE privesc_vectors SET status = ?2, source = 'manual', updated_at = ?3 WHERE id = ?1",
        params![id, status, now_ms()],
    )?;
    tx.commit()?;
    vector_get(conn, id)
}

/// Deleting a vector also removes the ruled-out item its ruling-out created.
pub fn vector_delete(conn: &Connection, id: &str) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    if tx.execute("DELETE FROM privesc_vectors WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    crate::notes::unlink_ruled_out(&tx, "vector", id)?;
    tx.commit()?;
    Ok(())
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

    fn setup(c: &Connection) -> (String, String) {
        let e = engagements::create(
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
        .id;
        let h = hosts::create(c, &e, HostInput { name: "ms01".into(), ip: None, os: None, access: None, dual_homed: None, ad_set: None }).unwrap().id;
        (e, h)
    }

    fn vin(title: &str, status: &str, source: &str) -> VectorInput {
        VectorInput { title: title.into(), status: status.into(), source: source.into() }
    }

    fn ident(h: &str, user: &str, privs: &[&str]) -> HostIdentity {
        HostIdentity {
            host_id: h.into(),
            username: user.into(),
            privileges: privs.iter().map(|s| s.to_string()).collect(),
            groups: vec![],
            entry_id: None,
            updated_at: 0,
        }
    }

    #[test]
    fn migrates_9_to_10_keeps_rows() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..9], &mut |_, _| Ok(())).unwrap();
        c.execute("INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)", []).unwrap();
        c.execute("INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h1','e1','a','10.0.0.5',1,1)", []).unwrap();
        c.execute("INSERT INTO services (id,host_id,port,protocol,state,created_at,updated_at) VALUES ('s1','h1',80,'tcp','open',1,1)", []).unwrap();
        c.execute("INSERT INTO ruled_out (id,engagement_id,host_id,text,reason,private,created_at) VALUES ('r1','e1','h1','t','r',0,1)", []).unwrap();
        let mut calls = 0;
        let out = migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..10], &mut |f, t| {
            assert_eq!((f, t), (9, 10));
            calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!((calls, out.to), (1, 10));
        let v: Option<String> = c.query_row("SELECT verdict FROM services WHERE id='s1'", [], |r| r.get(0)).unwrap();
        assert_eq!(v, None);
        let (k, i): (Option<String>, Option<String>) =
            c.query_row("SELECT source_kind, source_id FROM ruled_out WHERE id='r1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((k, i), (None, None));
        for t in ["host_identity", "privesc_vectors", "nvd_cache"] {
            let n: i64 = c.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [t], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "{t}");
        }
        assert!(c.execute("UPDATE services SET verdict='bogus' WHERE id='s1'", []).is_err());
    }

    #[test]
    fn identity_set_replaces_previous() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (_e, h) = setup(c);
        assert_eq!(identity_get(c, &h).unwrap(), None);
        let a = identity_set(c, ident(&h, " ms01\\iis_apppool ", &["SeImpersonatePrivilege", "SeImpersonatePrivilege", " "])).unwrap();
        assert_eq!((a.username.as_str(), a.privileges.len()), ("ms01\\iis_apppool", 1));
        let b = identity_set(c, ident(&h, "ms01\\svc", &[])).unwrap();
        assert_eq!((b.username.as_str(), b.privileges.len()), ("ms01\\svc", 0));
        let n: i64 = c.query_row("SELECT count(*) FROM host_identity", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        assert_eq!(identity_get(c, &h).unwrap().unwrap(), b);
        assert!(matches!(identity_set(c, ident(&h, "  ", &[])), Err(AppError::Validation { .. })));
        assert_eq!(identity_set(c, ident("nope", "u", &[])), Err(AppError::NotFound));
        let mut bad = ident(&h, "u", &[]);
        bad.entry_id = Some("missing".into());
        assert!(matches!(identity_set(c, bad), Err(AppError::Validation { field, .. }) if field == "entryId"));
    }

    #[test]
    fn vector_auto_upsert_does_not_downgrade_manual_ruled_out() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        let a = vector_upsert(c, &h, vin("SeImpersonate", "try", "auto")).unwrap();
        assert_eq!(vector_upsert(c, &h, vin(" SeImpersonate ", "untested", "auto")).unwrap().id, a.id);
        assert_eq!(vectors_list(c, &h).unwrap().len(), 1);
        assert_eq!(vector_set_status(c, &a.id, "ruled_out", None).map(|_| ()), Err(AppError::Validation { field: "reason".into(), message: "a ruled-out vector needs a reason".into() }));
        vector_set_status(c, &a.id, "ruled_out", Some("patched")).unwrap();
        let again = vector_upsert(c, &h, vin("SeImpersonate", "try", "auto")).unwrap();
        assert_eq!((again.status.as_str(), again.source.as_str()), ("ruled_out", "manual"));
        let r = crate::notes::ruled_out_list(c, &e).unwrap();
        assert_eq!((r.len(), r[0].text.as_str(), r[0].source_kind.as_deref()), (1, "SeImpersonate", Some("vector")));
        // Leaving ruled_out removes only the linked item.
        let back = vector_set_status(c, &a.id, "try", None).unwrap();
        assert_eq!(back.status, "try");
        assert!(crate::notes::ruled_out_list(c, &e).unwrap().is_empty());
        // A manual upsert applies.
        assert_eq!(vector_upsert(c, &h, vin("SeImpersonate", "untested", "manual")).unwrap().status, "untested");
        assert!(matches!(vector_upsert(c, &h, vin("x", "bogus", "auto")), Err(AppError::Validation { .. })));
        vector_delete(c, &a.id).unwrap();
        assert_eq!(vector_delete(c, &a.id), Err(AppError::NotFound));
    }

    #[test]
    fn deleting_a_ruled_out_vector_removes_its_ruled_out_item() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        let a = vector_upsert(c, &h, vin("PrintNightmare", "try", "manual")).unwrap();
        vector_set_status(c, &a.id, "ruled_out", Some("patched")).unwrap();
        assert_eq!(crate::notes::ruled_out_list(c, &e).unwrap().len(), 1);
        vector_delete(c, &a.id).unwrap();
        assert!(crate::notes::ruled_out_list(c, &e).unwrap().is_empty());
    }

    #[test]
    fn creating_a_vector_as_ruled_out_is_refused() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (_e, h) = setup(c);
        assert!(matches!(vector_upsert(c, &h, vin("x", "ruled_out", "manual")), Err(AppError::Validation { field, .. }) if field == "status"));
    }

    #[test]
    fn manual_upsert_over_ruled_out_reopens_and_unlinks() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        let a = vector_upsert(c, &h, vin("UAC bypass", "try", "manual")).unwrap();
        vector_set_status(c, &a.id, "ruled_out", Some("no GUI")).unwrap();
        let back = vector_upsert(c, &h, vin("UAC bypass", "try", "manual")).unwrap();
        assert_eq!(back.status, "try");
        assert!(crate::notes::ruled_out_list(c, &e).unwrap().is_empty());
    }

    #[test]
    fn identity_set_stamps_updated_at_whatever_the_caller_sends() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (_e, h) = setup(c);
        let got = identity_set(c, ident(&h, "u", &[])).unwrap();
        assert!(got.updated_at > 0);
    }

    #[test]
    fn deleting_a_host_removes_identity_vectors_and_linked_ruled_out() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        identity_set(c, ident(&h, "u", &["SeImpersonatePrivilege"])).unwrap();
        let a = vector_upsert(c, &h, vin("v", "try", "manual")).unwrap();
        vector_set_status(c, &a.id, "ruled_out", Some("r")).unwrap();
        hosts::delete(c, &h).unwrap();
        for t in ["host_identity", "privesc_vectors"] {
            let n: i64 = c.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{t}");
        }
        assert!(crate::notes::ruled_out_list(c, &e).unwrap().is_empty());
    }
}
