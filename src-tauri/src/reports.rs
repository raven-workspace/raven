//! Report storage: one report per engagement, made of sections. Each section holds a ProseMirror JSON
//! document (stored as text) that references evidence by id. No generated prose lives here.

use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_TITLE: &str = "OSCP Exam Report";

const KINDS: &[&str] = &[
    "details",
    "introduction",
    "summary",
    "considerations",
    "methodology",
    "target",
    "ad",
    "engagement-tested",
    "appendix-proof",
    "appendix-tools",
    "appendix-msf",
    "appendix-cleanup",
    "further",
    "references",
    // An owner-written page (appendix or free page), keyed by a fresh id so the unique index holds.
    "page",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: String,
    pub engagement_id: String,
    pub candidate_name: String,
    pub email: String,
    pub osid: String,
    pub title: String,
    pub meta: Value,
    pub created_at: i64,
    pub updated_at: i64,
    pub exported_at: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDefaults {
    pub candidate_name: String,
    pub email: String,
    pub osid: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportPatch {
    pub candidate_name: Option<String>,
    pub email: Option<String>,
    pub osid: Option<String>,
    pub title: Option<String>,
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSection {
    pub id: String,
    pub report_id: String,
    pub kind: String,
    pub target_key: Option<String>,
    pub position: i64,
    pub doc: Option<Value>,
    pub meta: Value,
    pub draft_built_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionInput {
    pub kind: String,
    pub target_key: Option<String>,
    pub position: i64,
    pub doc: Option<Value>,
    pub meta: Value,
    pub draft_built_at: Option<i64>,
}

fn parse(s: &str) -> AppResult<Value> {
    serde_json::from_str(s).map_err(|e| AppError::Db(format!("stored report JSON is invalid: {e}")))
}

fn to_text(v: &Value) -> String {
    v.to_string()
}

const REPORT_COLS: &str = "id, engagement_id, candidate_name, email, osid, title, meta, created_at, updated_at, exported_at";

fn report_row(r: &Row) -> rusqlite::Result<(Report, String)> {
    let meta: String = r.get(6)?;
    Ok((
        Report {
            id: r.get(0)?,
            engagement_id: r.get(1)?,
            candidate_name: r.get(2)?,
            email: r.get(3)?,
            osid: r.get(4)?,
            title: r.get(5)?,
            meta: Value::Null,
            created_at: r.get(7)?,
            updated_at: r.get(8)?,
            exported_at: r.get(9)?,
        },
        meta,
    ))
}

fn report_by(conn: &Connection, col: &str, key: &str) -> AppResult<Option<Report>> {
    match conn.query_row(&format!("SELECT {REPORT_COLS} FROM reports WHERE {col} = ?1"), [key], report_row).optional()? {
        Some((mut rep, meta)) => {
            rep.meta = parse(&meta)?;
            Ok(Some(rep))
        }
        None => Ok(None),
    }
}

/// One report per engagement. The first call creates it from `defaults`; later calls return it unchanged.
pub fn get_or_create(conn: &Connection, engagement_id: &str, defaults: &ReportDefaults) -> AppResult<Report> {
    if let Some(r) = report_by(conn, "engagement_id", engagement_id)? {
        return Ok(r);
    }
    let exists: i64 = conn.query_row("SELECT count(*) FROM engagements WHERE id = ?1", [engagement_id], |r| r.get(0))?;
    if exists == 0 {
        return Err(AppError::NotFound);
    }
    let now = now_ms();
    conn.execute(
        "INSERT INTO reports (id, engagement_id, candidate_name, email, osid, title, meta, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,'{}',?7,?7)",
        params![
            uuid::Uuid::new_v4().to_string(),
            engagement_id,
            defaults.candidate_name,
            defaults.email,
            defaults.osid,
            DEFAULT_TITLE,
            now
        ],
    )?;
    report_by(conn, "engagement_id", engagement_id)?.ok_or(AppError::NotFound)
}

/// Name, email, OSID and title: at most 2000 characters each, like the report defaults in Settings.
pub(crate) const MAX_REPORT_FIELD_LEN: usize = 2000;

pub fn update(conn: &Connection, id: &str, patch: ReportPatch) -> AppResult<Report> {
    for (field, value) in [("candidateName", &patch.candidate_name), ("email", &patch.email), ("osid", &patch.osid), ("title", &patch.title)] {
        if value.as_deref().is_some_and(|v| v.chars().count() > MAX_REPORT_FIELD_LEN) {
            return Err(AppError::validation(field, format!("at most {MAX_REPORT_FIELD_LEN} characters")));
        }
    }
    let cur = report_by(conn, "id", id)?.ok_or(AppError::NotFound)?;
    let title = patch.title.unwrap_or(cur.title);
    if title.trim().is_empty() {
        return Err(AppError::validation("title", "title is required"));
    }
    conn.execute(
        "UPDATE reports SET candidate_name=?1, email=?2, osid=?3, title=?4, meta=?5, updated_at=?6 WHERE id=?7",
        params![
            patch.candidate_name.unwrap_or(cur.candidate_name),
            patch.email.unwrap_or(cur.email),
            patch.osid.unwrap_or(cur.osid),
            title,
            to_text(&patch.meta.unwrap_or(cur.meta)),
            now_ms(),
            id
        ],
    )?;
    report_by(conn, "id", id)?.ok_or(AppError::NotFound)
}

/// Records that the report was exported now.
pub fn mark_exported(conn: &Connection, id: &str) -> AppResult<Report> {
    let n = conn.execute("UPDATE reports SET exported_at=?1 WHERE id=?2", params![now_ms(), id])?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    report_by(conn, "id", id)?.ok_or(AppError::NotFound)
}

/// A section's page and meta, serialized, at most 8 MiB.
const MAX_SECTION_BYTES: usize = 8 * 1024 * 1024;

const SECTION_COLS: &str = "id, report_id, kind, target_key, position, doc, meta, draft_built_at, updated_at";

fn section_row(r: &Row) -> rusqlite::Result<(ReportSection, Option<String>, String)> {
    Ok((
        ReportSection {
            id: r.get(0)?,
            report_id: r.get(1)?,
            kind: r.get(2)?,
            target_key: r.get(3)?,
            position: r.get(4)?,
            doc: None,
            meta: Value::Null,
            draft_built_at: r.get(7)?,
            updated_at: r.get(8)?,
        },
        r.get(5)?,
        r.get(6)?,
    ))
}

fn finish(parts: (ReportSection, Option<String>, String)) -> AppResult<ReportSection> {
    let (mut s, doc, meta) = parts;
    s.doc = doc.as_deref().map(parse).transpose()?;
    s.meta = parse(&meta)?;
    Ok(s)
}

fn section_get(conn: &Connection, id: &str) -> AppResult<ReportSection> {
    finish(conn.query_row(&format!("SELECT {SECTION_COLS} FROM report_sections WHERE id = ?1"), [id], section_row).optional()?.ok_or(AppError::NotFound)?)
}

pub fn sections_list(conn: &Connection, report_id: &str) -> AppResult<Vec<ReportSection>> {
    let mut st = conn.prepare(&format!("SELECT {SECTION_COLS} FROM report_sections WHERE report_id = ?1 ORDER BY position, kind"))?;
    let parts = st.query_map([report_id], section_row)?.collect::<Result<Vec<_>, _>>()?;
    parts.into_iter().map(finish).collect()
}

/// The page and meta as stored, refused past 8 MiB together.
fn section_texts(doc: Option<&Value>, meta: &Value) -> AppResult<(Option<String>, String)> {
    let doc = doc.map(to_text);
    let meta = to_text(meta);
    if doc.as_ref().map_or(0, String::len) + meta.len() > MAX_SECTION_BYTES {
        return Err(AppError::validation("doc", "this page is over 8 MiB"));
    }
    Ok((doc, meta))
}

fn validate(input: &SectionInput) -> AppResult<()> {
    let bad = |field: &str, message: &str| Err(AppError::validation(field, message));
    if !KINDS.contains(&input.kind.as_str()) {
        return bad("kind", "unknown section kind");
    }
    let key = input.target_key.as_deref();
    match input.kind.as_str() {
        "target" if key.is_none_or(|k| k.trim().is_empty()) => bad("targetKey", "a target section needs a host id"),
        "ad" if key != Some("ad-set") => bad("targetKey", "the AD section uses the key ad-set"),
        "page" if key.is_none_or(|k| k.trim().is_empty()) => bad("targetKey", "a page needs a key"),
        "target" | "ad" | "page" => Ok(()),
        _ if key.is_some() => bad("targetKey", "this section takes no target key"),
        _ => Ok(()),
    }
}

/// Unique on (report, kind, target key): an existing row keeps its id and takes the new values.
pub fn section_upsert(conn: &Connection, report_id: &str, input: SectionInput) -> AppResult<ReportSection> {
    validate(&input)?;
    let (doc, meta) = section_texts(input.doc.as_ref(), &input.meta)?;
    if report_by(conn, "id", report_id)?.is_none() {
        return Err(AppError::NotFound);
    }
    let existing: Option<String> = conn.query_row(
        "SELECT id FROM report_sections WHERE report_id = ?1 AND kind = ?2 AND COALESCE(target_key, '') = COALESCE(?3, '')",
        params![report_id, input.kind, input.target_key],
        |r| r.get(0),
    ).optional()?;
    let now = now_ms();
    let id = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE report_sections SET position=?1, doc=?2, meta=?3, draft_built_at=?4, updated_at=?5 WHERE id=?6",
                params![input.position, doc, meta, input.draft_built_at, now, id],
            )?;
            id
        }
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                &format!("INSERT INTO report_sections ({SECTION_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"),
                params![id, report_id, input.kind, input.target_key, input.position, doc, meta, input.draft_built_at, now],
            )?;
            id
        }
    };
    section_get(conn, &id)
}

pub fn section_save(conn: &Connection, id: &str, doc: Value, meta: Value) -> AppResult<ReportSection> {
    let (doc, meta) = section_texts(Some(&doc), &meta)?;
    let n = conn.execute(
        "UPDATE report_sections SET doc=?1, meta=?2, updated_at=?3 WHERE id=?4",
        params![doc, meta, now_ms(), id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    section_get(conn, id)
}

/// Deletes an owner-written page of the report. Other sections are part of the report's outline and are never deleted.
pub fn section_delete(conn: &Connection, report_id: &str, id: &str) -> AppResult<()> {
    let kind: String = conn.query_row("SELECT kind FROM report_sections WHERE id = ?1 AND report_id = ?2", params![id, report_id], |r| r.get(0)).optional()?.ok_or(AppError::NotFound)?;
    if kind != "page" {
        return Err(AppError::validation("kind", "only pages can be deleted"));
    }
    conn.execute("DELETE FROM report_sections WHERE id = ?1", [id])?;
    Ok(())
}

/// `position` becomes the index in `ids`. Any id outside the report fails with NotFound and changes nothing.
pub fn sections_reorder(conn: &Connection, report_id: &str, ids: Vec<String>) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    for (i, id) in ids.iter().enumerate() {
        let n = tx.execute("UPDATE report_sections SET position=?1 WHERE id=?2 AND report_id=?3", params![i as i64, id, report_id])?;
        if n == 0 {
            return Err(AppError::NotFound);
        }
    }
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
    use serde_json::json;

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

    fn host(c: &Connection, e: &str) -> String {
        hosts::create(c, e, HostInput { name: "a".into(), ip: Some("192.0.2.5".into()), os: None, access: None, dual_homed: None, ad_set: None })
            .unwrap()
            .id
    }

    fn input(kind: &str, key: Option<&str>, position: i64) -> SectionInput {
        SectionInput { kind: kind.into(), target_key: key.map(Into::into), position, doc: None, meta: json!({}), draft_built_at: None }
    }

    fn defaults() -> ReportDefaults {
        ReportDefaults { candidate_name: "A. Candidate".into(), email: "a@example.test".into(), osid: "OS-123456".into() }
    }

    #[test]
    fn get_or_create_is_idempotent() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let a = get_or_create(c, &e, &defaults()).unwrap();
        let b = get_or_create(c, &e, &ReportDefaults::default()).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(b.candidate_name, "A. Candidate");
        assert_eq!(a.title, "OSCP Exam Report");
        assert_eq!(a.meta, json!({}));
        assert!(matches!(get_or_create(c, "missing", &defaults()), Err(AppError::NotFound)));
    }

    #[test]
    fn mark_exported_records_when_and_refuses_an_unknown_report() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "E");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        assert_eq!(r.exported_at, None);
        let marked = mark_exported(c, &r.id).unwrap();
        assert!(marked.exported_at.is_some());
        assert!(matches!(mark_exported(c, "nope"), Err(AppError::NotFound)));
    }

    #[test]
    fn update_patches_only_given_fields() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        let u = update(c, &r.id, ReportPatch { osid: Some("OS-1".into()), meta: Some(json!({"k": 1})), ..Default::default() }).unwrap();
        assert_eq!((u.osid.as_str(), u.email.as_str(), u.meta), ("OS-1", "a@example.test", json!({"k": 1})));
        assert!(matches!(update(c, &r.id, ReportPatch { title: Some(" ".into()), ..Default::default() }), Err(AppError::Validation { .. })));
    }

    #[test]
    fn section_upsert_keeps_id_and_updates() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let h = host(c, &e);
        let r = get_or_create(c, &e, &defaults()).unwrap();
        let a = section_upsert(c, &r.id, input("target", Some(&h), 1)).unwrap();
        let b = section_upsert(c, &r.id, input("target", Some(&h), 5)).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(b.position, 5);
        assert_eq!(sections_list(c, &r.id).unwrap().len(), 1);
        // A key-less kind is unique on (report, kind) too.
        let s1 = section_upsert(c, &r.id, input("summary", None, 0)).unwrap();
        assert_eq!(s1.id, section_upsert(c, &r.id, input("summary", None, 2)).unwrap().id);
    }

    #[test]
    fn section_kind_and_key_validated() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        for bad in [input("nope", None, 0), input("target", None, 0), input("summary", Some("x"), 0), input("ad", None, 0)] {
            assert!(matches!(section_upsert(c, &r.id, bad), Err(AppError::Validation { .. })));
        }
        assert!(section_upsert(c, &r.id, input("ad", Some("ad-set"), 0)).is_ok());
        // Section 1 of OffSec's sample (layout 2) is report-level: no target key.
        assert!(section_upsert(c, &r.id, input("introduction", None, 0)).is_ok());
        assert!(matches!(section_upsert(c, &r.id, input("introduction", Some("x"), 0)), Err(AppError::Validation { .. })));
    }

    #[test]
    fn section_save_round_trips_json() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        let s = section_upsert(c, &r.id, input("summary", None, 0)).unwrap();
        let doc = json!({"type":"doc","content":[]});
        let saved = section_save(c, &s.id, doc.clone(), json!({"x": true})).unwrap();
        assert_eq!(saved.doc, Some(doc.clone()));
        let listed = sections_list(c, &r.id).unwrap();
        assert_eq!(listed[0].doc, Some(doc));
        assert_eq!(listed[0].meta, json!({"x": true}));
        assert!(matches!(section_save(c, "missing", json!({}), json!({})), Err(AppError::NotFound)));
    }

    #[test]
    fn update_caps_text_fields_at_2000_chars() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        let long = "é".repeat(2001);
        let ok = "é".repeat(2000);
        let patches: [fn(String) -> ReportPatch; 4] = [
            |s| ReportPatch { candidate_name: Some(s), ..Default::default() },
            |s| ReportPatch { email: Some(s), ..Default::default() },
            |s| ReportPatch { osid: Some(s), ..Default::default() },
            |s| ReportPatch { title: Some(s), ..Default::default() },
        ];
        for (patch, field) in patches.iter().zip(["candidateName", "email", "osid", "title"]) {
            match update(c, &r.id, patch(long.clone())) {
                Err(AppError::Validation { field: f, .. }) => assert_eq!(f, field),
                other => panic!("{field}: expected a validation error, got {other:?}"),
            }
            assert!(update(c, &r.id, patch(ok.clone())).is_ok(), "{field} at 2000 chars");
        }
    }

    #[test]
    fn section_writes_cap_the_page_size() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        let s = section_upsert(c, &r.id, input("summary", None, 0)).unwrap();
        let huge = json!({"type": "doc", "content": [{"type": "text", "text": "x".repeat(MAX_SECTION_BYTES)}]});
        assert!(matches!(section_save(c, &s.id, huge.clone(), json!({})), Err(AppError::Validation { .. })));
        let mut big = input("summary", None, 0);
        big.doc = Some(huge);
        assert!(matches!(section_upsert(c, &r.id, big), Err(AppError::Validation { .. })));
        // Nothing was written.
        assert_eq!(sections_list(c, &r.id).unwrap()[0].doc, None);
        let fits = json!({"type": "doc", "content": [{"type": "text", "text": "x".repeat(1024 * 1024)}]});
        assert!(section_save(c, &s.id, fits, json!({})).is_ok());
    }

    #[test]
    fn reorder_sets_positions_and_rejects_foreign_ids() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        let a = section_upsert(c, &r.id, input("summary", None, 0)).unwrap();
        let b = section_upsert(c, &r.id, input("further", None, 1)).unwrap();
        sections_reorder(c, &r.id, vec![b.id.clone(), a.id.clone()]).unwrap();
        let ids: Vec<_> = sections_list(c, &r.id).unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![b.id.clone(), a.id.clone()]);

        let e2 = eng(c, "e2");
        let r2 = get_or_create(c, &e2, &defaults()).unwrap();
        let foreign = section_upsert(c, &r2.id, input("summary", None, 0)).unwrap();
        assert!(matches!(sections_reorder(c, &r.id, vec![a.id.clone(), foreign.id]), Err(AppError::NotFound)));
        // Nothing changed.
        let ids: Vec<_> = sections_list(c, &r.id).unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![b.id, a.id]);
    }

    #[test]
    fn page_kind_requires_key() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        for bad in [input("page", None, 0), input("page", Some(" "), 0)] {
            match section_upsert(c, &r.id, bad) {
                Err(AppError::Validation { field, .. }) => assert_eq!(field, "targetKey"),
                other => panic!("expected a validation error, got {other:?}"),
            }
        }
        // Each page has its own key, so two pages are two rows.
        let a = section_upsert(c, &r.id, input("page", Some("p1"), 0)).unwrap();
        let b = section_upsert(c, &r.id, input("page", Some("p2"), 1)).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(sections_list(c, &r.id).unwrap().len(), 2);
    }

    #[test]
    fn delete_refuses_non_page() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        let s = section_upsert(c, &r.id, input("summary", None, 0)).unwrap();
        match section_delete(c, &r.id, &s.id) {
            Err(AppError::Validation { field, message }) => assert_eq!((field.as_str(), message.as_str()), ("kind", "only pages can be deleted")),
            other => panic!("expected a validation error, got {other:?}"),
        }
        assert_eq!(sections_list(c, &r.id).unwrap().len(), 1);
        assert!(matches!(section_delete(c, &r.id, "missing"), Err(AppError::NotFound)));
    }

    #[test]
    fn delete_removes_page() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        let keep = section_upsert(c, &r.id, input("page", Some("p1"), 0)).unwrap();
        let gone = section_upsert(c, &r.id, input("page", Some("p2"), 1)).unwrap();
        // A page of another report is out of reach.
        let e2 = eng(c, "e2");
        let r2 = get_or_create(c, &e2, &defaults()).unwrap();
        assert!(matches!(section_delete(c, &r2.id, &gone.id), Err(AppError::NotFound)));
        section_delete(c, &r.id, &gone.id).unwrap();
        let ids: Vec<_> = sections_list(c, &r.id).unwrap().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![keep.id]);
    }

    #[test]
    fn engagement_delete_cascades() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        section_upsert(c, &r.id, input("summary", None, 0)).unwrap();
        c.execute("DELETE FROM engagements WHERE id = ?1", [&e]).unwrap();
        let n: i64 = c.query_row("SELECT (SELECT count(*) FROM reports) + (SELECT count(*) FROM report_sections)", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn corrupt_stored_json_is_a_db_error() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let r = get_or_create(c, &e, &defaults()).unwrap();
        c.execute("UPDATE reports SET meta = 'not json' WHERE id = ?1", [&r.id]).unwrap();
        assert!(matches!(get_or_create(c, &e, &defaults()), Err(AppError::Db(_))));
    }

    #[test]
    fn migrates_14_to_15_keeps_finding_files() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..14], &mut |_, _| Ok(())).unwrap();
        c.execute("INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)", []).unwrap();
        c.execute("INSERT INTO findings (id,engagement_id,title,status,created_at,updated_at) VALUES ('f1','e1','t','draft',1,1)", []).unwrap();
        c.execute("INSERT INTO finding_files (id,finding_id,name,content,created_at,updated_at) VALUES ('ff1','f1','a.py','x',1,1)", []).unwrap();
        migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..15], &mut |f, t| {
            assert_eq!((f, t), (14, 15));
            Ok(())
        })
        .unwrap();
        let (content, modified, url): (String, i64, Option<String>) =
            c.query_row("SELECT content, modified, original_url FROM finding_files WHERE id='ff1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((content.as_str(), modified, url), ("x", 0, None));
    }
}
