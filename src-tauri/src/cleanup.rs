//! Cleanup list: artifacts left on targets (files, accounts, services), tracked per engagement.
//!
//! `dismissed` rows exist only to hide a suggestion (`suggestion_key`); they are never edited,
//! removed or deleted through the item commands.

use crate::backup::system_now_ms;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub id: String,
    pub engagement_id: String,
    pub host_id: Option<String>,
    pub kind: String,
    pub target: String,
    pub notes: Option<String>,
    pub source_entry_id: Option<String>,
    pub suggestion_key: Option<String>,
    pub status: String,
    pub removed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupInput {
    #[serde(default)]
    pub host_id: Option<String>,
    pub kind: String,
    pub target: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub source_entry_id: Option<String>,
    /// Only used on create; update never changes it.
    #[serde(default)]
    pub suggestion_key: Option<String>,
}

fn invalid(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

fn blank_to_none(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

const COLS: &str = "id, engagement_id, host_id, kind, target, notes, source_entry_id, suggestion_key, status, removed_at, created_at, updated_at";

fn row(r: &Row) -> rusqlite::Result<CleanupItem> {
    Ok(CleanupItem {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        host_id: r.get(2)?,
        kind: r.get(3)?,
        target: r.get(4)?,
        notes: r.get(5)?,
        source_entry_id: r.get(6)?,
        suggestion_key: r.get(7)?,
        status: r.get(8)?,
        removed_at: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> AppResult<CleanupItem> {
    match conn.query_row(&format!("SELECT {COLS} FROM cleanup_items WHERE id = ?1"), [id], row) {
        Ok(i) => Ok(i),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
}

/// An existing, non-dismissed item.
fn get_live(conn: &Connection, id: &str) -> AppResult<CleanupItem> {
    let item = get(conn, id)?;
    if item.status == "dismissed" {
        return Err(invalid("status", "a dismissed suggestion cannot be changed"));
    }
    Ok(item)
}

pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<CleanupItem>> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM cleanup_items WHERE engagement_id = ?1 ORDER BY created_at, id"
    ))?;
    Ok(st.query_map([engagement_id], row)?.collect::<Result<Vec<_>, _>>()?)
}

struct Clean {
    host_id: Option<String>,
    kind: String,
    target: String,
    notes: Option<String>,
    source_entry_id: Option<String>,
}

fn clean(conn: &Connection, engagement_id: &str, i: &CleanupInput) -> AppResult<Clean> {
    if !matches!(i.kind.as_str(), "file" | "account" | "service" | "other") {
        return Err(invalid("kind", "kind must be file, account, service or other"));
    }
    let target = i.target.trim().to_string();
    let n = target.chars().count();
    if n == 0 || n > 500 {
        return Err(invalid("target", "target must be 1-500 characters"));
    }
    let notes = blank_to_none(i.notes.as_deref());
    if notes.as_ref().is_some_and(|n| n.chars().count() > 2000) {
        return Err(invalid("notes", "notes must be at most 2000 characters"));
    }
    let host_id = blank_to_none(i.host_id.as_deref());
    if let Some(h) = &host_id {
        let ok: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM hosts WHERE id = ?1 AND engagement_id = ?2)",
            params![h, engagement_id],
            |r| r.get(0),
        )?;
        if !ok {
            return Err(invalid("hostId", "host is not part of this engagement"));
        }
    }
    let source_entry_id = blank_to_none(i.source_entry_id.as_deref());
    if let Some(s) = &source_entry_id {
        let ok: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM log_entries WHERE id = ?1 AND engagement_id = ?2)",
            params![s, engagement_id],
            |r| r.get(0),
        )?;
        if !ok {
            return Err(invalid("sourceEntryId", "log entry is not part of this engagement"));
        }
    }
    Ok(Clean { host_id, kind: i.kind.clone(), target, notes, source_entry_id })
}

fn engagement_exists(conn: &Connection, engagement_id: &str) -> AppResult<()> {
    let ok: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM engagements WHERE id = ?1)",
        [engagement_id],
        |r| r.get(0),
    )?;
    if ok { Ok(()) } else { Err(AppError::NotFound) }
}

fn key_taken(conn: &Connection, engagement_id: &str, key: &str) -> AppResult<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM cleanup_items WHERE engagement_id = ?1 AND suggestion_key = ?2)",
        params![engagement_id, key],
        |r| r.get(0),
    )?)
}

pub fn create(conn: &Connection, engagement_id: &str, input: CleanupInput) -> AppResult<CleanupItem> {
    engagement_exists(conn, engagement_id)?;
    let c = clean(conn, engagement_id, &input)?;
    let key = blank_to_none(input.suggestion_key.as_deref());
    if let Some(k) = &key
        && key_taken(conn, engagement_id, k)?
    {
        return Err(invalid("suggestionKey", "this suggestion is already on the list or dismissed"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = system_now_ms();
    conn.execute(
        "INSERT INTO cleanup_items (id, engagement_id, host_id, kind, target, notes, source_entry_id, \
         suggestion_key, status, removed_at, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'open',NULL,?9,?9)",
        params![id, engagement_id, c.host_id, c.kind, c.target, c.notes, c.source_entry_id, key, now],
    )?;
    get(conn, &id)
}

/// Updates host, kind, target, notes and source entry; never the suggestion key or status.
pub fn update(conn: &Connection, id: &str, input: CleanupInput) -> AppResult<CleanupItem> {
    let cur = get_live(conn, id)?;
    let c = clean(conn, &cur.engagement_id, &input)?;
    conn.execute(
        "UPDATE cleanup_items SET host_id=?2, kind=?3, target=?4, notes=?5, source_entry_id=?6, updated_at=?7 WHERE id=?1",
        params![id, c.host_id, c.kind, c.target, c.notes, c.source_entry_id, system_now_ms()],
    )?;
    get(conn, id)
}

pub fn set_removed(conn: &Connection, id: &str, removed: bool) -> AppResult<CleanupItem> {
    get_live(conn, id)?;
    let now = system_now_ms();
    let (status, at) = if removed { ("removed", Some(now)) } else { ("open", None) };
    conn.execute(
        "UPDATE cleanup_items SET status=?2, removed_at=?3, updated_at=?4 WHERE id=?1",
        params![id, status, at, now],
    )?;
    get(conn, id)
}

/// Hides a suggestion: inserts a `dismissed` row keyed by the suggestion.
pub fn dismiss(conn: &Connection, engagement_id: &str, suggestion_key: &str) -> AppResult<()> {
    engagement_exists(conn, engagement_id)?;
    let key = suggestion_key.trim();
    let n = key.chars().count();
    if n == 0 || n > 500 {
        return Err(invalid("suggestionKey", "suggestion key must be 1-500 characters"));
    }
    if key_taken(conn, engagement_id, key)? {
        return Err(invalid("suggestionKey", "this suggestion is already on the list or dismissed"));
    }
    let now = system_now_ms();
    conn.execute(
        "INSERT INTO cleanup_items (id, engagement_id, host_id, kind, target, notes, source_entry_id, \
         suggestion_key, status, removed_at, created_at, updated_at) \
         VALUES (?1,?2,NULL,'other',?3,NULL,NULL,?3,'dismissed',NULL,?4,?4)",
        params![uuid::Uuid::new_v4().to_string(), engagement_id, key, now],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    get_live(conn, id)?;
    conn.execute("DELETE FROM cleanup_items WHERE id = ?1", [id])?;
    Ok(())
}

/// Open items per engagement (engagements with none are absent).
pub fn counts(conn: &Connection) -> AppResult<HashMap<String, i64>> {
    let mut st = conn.prepare(
        "SELECT engagement_id, count(*) FROM cleanup_items WHERE status = 'open' GROUP BY engagement_id",
    )?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    Ok(rows.collect::<Result<HashMap<_, _>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engagements::{self, EngagementInput};
    use crate::hosts::{self, HostInput};
    use crate::paths::DataPaths;
    use crate::vault::Vault;

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    fn eng(c: &Connection, name: &str) -> String {
        engagements::create(
            c,
            EngagementInput {
                name: name.into(),
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

    fn host(c: &Connection, eid: &str, ip: &str) -> String {
        hosts::create(c, eid, HostInput { name: ip.into(), ip: Some(ip.into()), os: None, access: None, dual_homed: None, ad_set: None })
            .unwrap()
            .id
    }

    fn log_entry(c: &Connection, eid: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        c.execute(
            "INSERT INTO log_entries (id, engagement_id, kind, title, content, at, created_at, updated_at) \
             VALUES (?1, ?2, 'note', 't', 'x', 1, 1, 1)",
            params![id, eid],
        )
        .unwrap();
        id
    }

    fn inp(target: &str) -> CleanupInput {
        CleanupInput {
            host_id: None,
            kind: "file".into(),
            target: target.into(),
            notes: None,
            source_entry_id: None,
            suggestion_key: None,
        }
    }

    fn field(e: AppError) -> String {
        match e {
            AppError::Validation { field, .. } => field,
            other => panic!("expected validation, got {other:?}"),
        }
    }

    #[test]
    fn create_list_update_roundtrip() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let h = host(c, &e, "10.0.0.1");
        let l = log_entry(c, &e);
        let first = create(
            c,
            &e,
            CleanupInput {
                host_id: Some(h.clone()),
                notes: Some("  dropped via smb ".into()),
                source_entry_id: Some(l.clone()),
                suggestion_key: Some("k1".into()),
                ..inp("  C:\\Windows\\Temp\\x.exe  ")
            },
        )
        .unwrap();
        assert_eq!(first.target, "C:\\Windows\\Temp\\x.exe");
        assert_eq!(first.status, "open");
        assert_eq!(first.removed_at, None);
        assert_eq!(first.host_id.as_deref(), Some(h.as_str()));
        assert_eq!(first.notes.as_deref(), Some("dropped via smb"));
        assert_eq!(first.source_entry_id.as_deref(), Some(l.as_str()));
        let second = create(c, &e, CleanupInput { kind: "account".into(), ..inp("backdoor") }).unwrap();
        let all = list(c, &e).unwrap();
        assert_eq!(all.iter().map(|i| i.id.clone()).collect::<Vec<_>>(), [first.id.clone(), second.id.clone()]);

        let up = update(
            c,
            &first.id,
            CleanupInput { kind: "service".into(), host_id: None, suggestion_key: Some("other".into()), ..inp("svc") },
        )
        .unwrap();
        assert_eq!((up.kind.as_str(), up.target.as_str()), ("service", "svc"));
        assert_eq!(up.host_id, None);
        assert_eq!(up.suggestion_key.as_deref(), Some("k1"));
        assert_eq!(up.status, "open");
        assert_eq!(up.created_at, first.created_at);
        assert_eq!(update(c, "nope", inp("x")).unwrap_err(), AppError::NotFound);
        assert_eq!(field(update(c, &first.id, CleanupInput { kind: "zzz".into(), ..inp("x") }).unwrap_err()), "kind");
        let other = eng(c, "B");
        assert_eq!(
            field(update(c, &first.id, CleanupInput { source_entry_id: Some(log_entry(c, &other)), ..inp("x") }).unwrap_err()),
            "sourceEntryId"
        );
    }

    #[test]
    fn set_removed_stamps_and_clears_removed_at() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let it = create(c, &e, inp("x")).unwrap();
        let r = set_removed(c, &it.id, true).unwrap();
        assert_eq!(r.status, "removed");
        assert!(r.removed_at.is_some());
        // updating a removed item is allowed and keeps it removed
        let u = update(c, &it.id, inp("y")).unwrap();
        assert_eq!((u.status.as_str(), u.target.as_str()), ("removed", "y"));
        assert!(u.removed_at.is_some());
        let o = set_removed(c, &it.id, false).unwrap();
        assert_eq!(o.status, "open");
        assert_eq!(o.removed_at, None);
        assert_eq!(set_removed(c, "nope", true).unwrap_err(), AppError::NotFound);
    }

    #[test]
    fn dismiss_inserts_a_dismissed_row_and_a_second_dismiss_or_create_with_the_same_key_is_rejected() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        dismiss(c, &e, "file:abc").unwrap();
        let all = list(c, &e).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(
            (all[0].status.as_str(), all[0].kind.as_str(), all[0].target.as_str(), all[0].suggestion_key.as_deref()),
            ("dismissed", "other", "file:abc", Some("file:abc"))
        );
        assert_eq!(field(dismiss(c, &e, "file:abc").unwrap_err()), "suggestionKey");
        assert_eq!(
            field(create(c, &e, CleanupInput { suggestion_key: Some("file:abc".into()), ..inp("x") }).unwrap_err()),
            "suggestionKey"
        );
        // the same key in another engagement is fine
        let e2 = eng(c, "B");
        dismiss(c, &e2, "file:abc").unwrap();
        // dismissed rows are frozen
        let id = all[0].id.clone();
        assert_eq!(field(update(c, &id, inp("x")).unwrap_err()), "status");
        assert_eq!(field(set_removed(c, &id, true).unwrap_err()), "status");
        assert_eq!(field(delete(c, &id).unwrap_err()), "status");
        assert_eq!(dismiss(c, "nope", "k").unwrap_err(), AppError::NotFound);
    }

    #[test]
    fn host_from_another_engagement_is_rejected() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let a = eng(c, "A");
        let b = eng(c, "B");
        let hb = host(c, &b, "10.0.0.9");
        let err = create(c, &a, CleanupInput { host_id: Some(hb.clone()), ..inp("x") }).unwrap_err();
        assert_eq!(field(err), "hostId");
        let it = create(c, &a, inp("x")).unwrap();
        assert_eq!(field(update(c, &it.id, CleanupInput { host_id: Some(hb), ..inp("x") }).unwrap_err()), "hostId");
        assert_eq!(create(c, "nope", inp("x")).unwrap_err(), AppError::NotFound);
    }

    #[test]
    fn blank_or_long_target_is_rejected() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        assert_eq!(field(create(c, &e, inp("   ")).unwrap_err()), "target");
        assert_eq!(field(create(c, &e, inp(&"a".repeat(501))).unwrap_err()), "target");
        create(c, &e, inp(&"a".repeat(500))).unwrap();
        assert_eq!(
            field(create(c, &e, CleanupInput { notes: Some("n".repeat(2001)), ..inp("x") }).unwrap_err()),
            "notes"
        );
        create(c, &e, CleanupInput { notes: Some("n".repeat(2000)), ..inp("x") }).unwrap();
        let it = create(c, &e, inp("ok")).unwrap();
        assert_eq!(field(update(c, &it.id, inp("")).unwrap_err()), "target");
    }

    #[test]
    fn counts_only_open_items_per_engagement() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let a = eng(c, "A");
        let b = eng(c, "B");
        let _c = eng(c, "C");
        create(c, &a, inp("1")).unwrap();
        create(c, &a, inp("2")).unwrap();
        let gone = create(c, &a, inp("3")).unwrap();
        set_removed(c, &gone.id, true).unwrap();
        dismiss(c, &a, "k").unwrap();
        create(c, &b, inp("4")).unwrap();
        let n = counts(c).unwrap();
        assert_eq!(n.get(&a), Some(&2));
        assert_eq!(n.get(&b), Some(&1));
        assert_eq!(n.len(), 2);
    }

    #[test]
    fn deleting_the_engagement_deletes_its_items_and_deleting_the_entry_keeps_the_item() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let a = eng(c, "A");
        let h = host(c, &a, "10.0.0.1");
        let l = log_entry(c, &a);
        let it = create(
            c,
            &a,
            CleanupInput { host_id: Some(h.clone()), source_entry_id: Some(l.clone()), ..inp("x") },
        )
        .unwrap();
        c.execute("DELETE FROM log_entries WHERE id = ?1", [&l]).unwrap();
        assert_eq!(get(c, &it.id).unwrap().source_entry_id, None);
        c.execute("DELETE FROM hosts WHERE id = ?1", [&h]).unwrap();
        assert_eq!(get(c, &it.id).unwrap().host_id, None);
        let d = create(c, &a, inp("y")).unwrap();
        delete(c, &d.id).unwrap();
        assert_eq!(delete(c, &d.id).unwrap_err(), AppError::NotFound);
        engagements::delete(c, &a).unwrap();
        assert!(list(c, &a).unwrap().is_empty());
        let n: i64 = c.query_row("SELECT count(*) FROM cleanup_items", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
