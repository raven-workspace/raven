//! Free-text notes (one per host, one per engagement) and ruled-out items.
//! "Private" marks content that must never reach a client report or export.

use crate::backup::system_now_ms;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

pub(crate) const MAX_BODY: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    /// The host id, or the engagement id for the engagement-level note.
    pub owner_id: String,
    pub engagement_id: String,
    pub host_id: Option<String>,
    pub body: String,
    pub private: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuledOut {
    pub id: String,
    pub engagement_id: String,
    pub host_id: Option<String>,
    pub text: String,
    pub reason: String,
    pub private: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuledOutInput {
    pub engagement_id: String,
    #[serde(default)]
    pub host_id: Option<String>,
    pub text: String,
    pub reason: String,
    #[serde(default)]
    pub private: bool,
}

fn invalid(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

/// The engagement must exist, and a host (if given) must belong to it; otherwise `NotFound`.
pub(crate) fn check_scope(conn: &Connection, engagement_id: &str, host_id: Option<&str>) -> AppResult<()> {
    let ok: bool = match host_id {
        None => conn.query_row("SELECT EXISTS(SELECT 1 FROM engagements WHERE id = ?1)", [engagement_id], |r| r.get(0))?,
        Some(h) => conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM hosts WHERE id = ?1 AND engagement_id = ?2)",
            params![h, engagement_id],
            |r| r.get(0),
        )?,
    };
    if ok { Ok(()) } else { Err(AppError::NotFound) }
}

fn note_row(r: &Row) -> rusqlite::Result<Note> {
    Ok(Note {
        owner_id: r.get(0)?,
        engagement_id: r.get(1)?,
        host_id: r.get(2)?,
        body: r.get(3)?,
        private: r.get::<_, i64>(4)? != 0,
        updated_at: r.get(5)?,
    })
}

const NOTE_COLS: &str = "owner_id, engagement_id, host_id, body, private, updated_at";

/// The host's note, or the engagement's when `host_id` is None. An empty unsaved note (`updated_at` 0) if none yet.
pub fn get(conn: &Connection, engagement_id: &str, host_id: Option<&str>) -> AppResult<Note> {
    check_scope(conn, engagement_id, host_id)?;
    let owner = host_id.unwrap_or(engagement_id);
    match conn.query_row(&format!("SELECT {NOTE_COLS} FROM notes WHERE owner_id = ?1"), [owner], note_row) {
        Ok(n) => Ok(n),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Note {
            owner_id: owner.to_string(),
            engagement_id: engagement_id.to_string(),
            host_id: host_id.map(str::to_string),
            body: String::new(),
            private: false,
            updated_at: 0,
        }),
        Err(e) => Err(e.into()),
    }
}

pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Note>> {
    let mut st = conn.prepare(&format!("SELECT {NOTE_COLS} FROM notes WHERE engagement_id = ?1 ORDER BY owner_id"))?;
    let rows = st.query_map([engagement_id], note_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn save(conn: &Connection, engagement_id: &str, host_id: Option<&str>, body: &str, private: bool) -> AppResult<Note> {
    if body.len() > MAX_BODY {
        return Err(invalid("body", "note is too long (1 MiB max)"));
    }
    check_scope(conn, engagement_id, host_id)?;
    let owner = host_id.unwrap_or(engagement_id);
    conn.execute(
        "INSERT INTO notes (owner_id, engagement_id, host_id, body, private, updated_at) VALUES (?1,?2,?3,?4,?5,?6) \
         ON CONFLICT (owner_id) DO UPDATE SET body = excluded.body, private = excluded.private, updated_at = excluded.updated_at",
        params![owner, engagement_id, host_id, body, private, system_now_ms()],
    )?;
    get(conn, engagement_id, host_id)
}

fn ruled_row(r: &Row) -> rusqlite::Result<RuledOut> {
    Ok(RuledOut {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        host_id: r.get(2)?,
        text: r.get(3)?,
        reason: r.get(4)?,
        private: r.get::<_, i64>(5)? != 0,
        created_at: r.get(6)?,
    })
}

const RULED_COLS: &str = "id, engagement_id, host_id, text, reason, private, created_at";

pub fn ruled_out_list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<RuledOut>> {
    let mut st = conn.prepare(&format!("SELECT {RULED_COLS} FROM ruled_out WHERE engagement_id = ?1 ORDER BY created_at, rowid"))?;
    let rows = st.query_map([engagement_id], ruled_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn ruled_out_create(conn: &Connection, input: RuledOutInput) -> AppResult<RuledOut> {
    let text = input.text.trim().to_string();
    let reason = input.reason.trim().to_string();
    if text.is_empty() {
        return Err(invalid("text", "text must not be blank"));
    }
    if reason.is_empty() {
        return Err(invalid("reason", "reason must not be blank"));
    }
    if text.len() > MAX_BODY {
        return Err(invalid("text", "text is too long (1 MiB max)"));
    }
    if reason.len() > MAX_BODY {
        return Err(invalid("reason", "reason is too long (1 MiB max)"));
    }
    check_scope(conn, &input.engagement_id, input.host_id.as_deref())?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ruled_out (id, engagement_id, host_id, text, reason, private, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![id, input.engagement_id, input.host_id, text, reason, input.private, system_now_ms()],
    )?;
    Ok(conn.query_row(&format!("SELECT {RULED_COLS} FROM ruled_out WHERE id = ?1"), [&id], ruled_row)?)
}

pub fn ruled_out_delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM ruled_out WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engagements::{self, EngagementInput};
    use crate::error::AppError;
    use crate::hosts::{self, HostInput};
    use crate::paths::DataPaths;
    use crate::vault::Vault;

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    fn eng(c: &rusqlite::Connection) -> String {
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

    fn host(c: &rusqlite::Connection, e: &str, ip: &str) -> String {
        hosts::create(c, e, HostInput { name: ip.into(), ip: Some(ip.into()), os: None, access: None, dual_homed: None, ad_set: None }).unwrap().id
    }

    fn field<T: std::fmt::Debug>(r: AppResult<T>) -> String {
        match r {
            Err(AppError::Validation { field, .. }) => field,
            o => panic!("expected validation, got {o:?}"),
        }
    }

    #[test]
    fn note_get_missing_is_empty() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let n = get(c, &e, Some(&h)).unwrap();
        assert_eq!((n.owner_id.as_str(), n.host_id.as_deref(), n.body.as_str(), n.private, n.updated_at), (h.as_str(), Some(h.as_str()), "", false, 0));
        let n = get(c, &e, None).unwrap();
        assert_eq!((n.owner_id.as_str(), n.host_id, n.updated_at), (e.as_str(), None, 0));
        assert!(list(c, &e).unwrap().is_empty());
    }

    #[test]
    fn note_save_upserts_host_and_engagement_notes_separately() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let a = save(c, &e, Some(&h), "host note", false).unwrap();
        assert_eq!((a.owner_id.as_str(), a.body.as_str()), (h.as_str(), "host note"));
        assert!(a.updated_at > 0);
        let b = save(c, &e, None, "eng note", true).unwrap();
        assert_eq!((b.owner_id.as_str(), b.host_id.clone(), b.private), (e.as_str(), None, true));
        let a2 = save(c, &e, Some(&h), "host note 2", true).unwrap();
        assert_eq!((a2.body.as_str(), a2.private), ("host note 2", true));
        assert_eq!(list(c, &e).unwrap().len(), 2);
        assert_eq!(get(c, &e, None).unwrap().body, "eng note");
        assert_eq!(get(c, &e, Some(&h)).unwrap().body, "host note 2");
        let j = serde_json::to_value(&a2).unwrap();
        assert!(j.get("ownerId").is_some() && j.get("engagementId").is_some() && j.get("hostId").is_some() && j.get("updatedAt").is_some());
        // foreign host / missing engagement
        let e2 = eng(c);
        assert_eq!(save(c, &e2, Some(&h), "x", false), Err(AppError::NotFound));
        assert_eq!(save(c, "nope", None, "x", false), Err(AppError::NotFound));
    }

    #[test]
    fn note_rejects_oversize_body() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        assert_eq!(field(save(c, &e, None, &"a".repeat(MAX_BODY + 1), false)), "body");
        save(c, &e, None, &"a".repeat(MAX_BODY), false).unwrap();
    }

    #[test]
    fn ruled_out_crud_and_blank_rejected() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let inp = |text: &str, reason: &str, host_id: Option<&str>| RuledOutInput {
            engagement_id: e.clone(),
            host_id: host_id.map(str::to_string),
            text: text.into(),
            reason: reason.into(),
            private: false,
        };
        assert_eq!(field(ruled_out_create(c, inp("  ", "r", None))), "text");
        assert_eq!(field(ruled_out_create(c, inp("t", " ", None))), "reason");
        let long = "a".repeat(MAX_BODY + 1);
        assert_eq!(field(ruled_out_create(c, inp(&long, "r", None))), "text");
        assert_eq!(field(ruled_out_create(c, inp("t", &long, None))), "reason");
        let r = ruled_out_create(c, inp(" SMB relay ", " signing on ", Some(&h))).unwrap();
        assert_eq!((r.text.as_str(), r.reason.as_str(), r.host_id.as_deref()), ("SMB relay", "signing on", Some(h.as_str())));
        ruled_out_create(c, inp("kerberoast", "no SPNs", None)).unwrap();
        assert_eq!(ruled_out_list(c, &e).unwrap().len(), 2);
        let e2 = eng(c);
        assert_eq!(ruled_out_create(c, RuledOutInput { engagement_id: e2, ..inp("t", "r", Some(&h)) }), Err(AppError::NotFound));
        ruled_out_delete(c, &r.id).unwrap();
        assert_eq!(ruled_out_list(c, &e).unwrap().len(), 1);
        assert_eq!(ruled_out_delete(c, &r.id), Err(AppError::NotFound));
    }
}
