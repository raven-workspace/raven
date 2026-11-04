//! Engagement log: typed entries, host links, screenshot/flag attachments.

use crate::backup::system_now_ms;
use crate::error::{AppError, AppResult};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBlock {
    pub command: String,
    pub output: String,
    #[serde(default)]
    pub shell: Option<String>,
}

/// Stored as JSON in `log_entries.content`; the tag equals the `kind` column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LogContent {
    Command { blocks: Vec<CommandBlock> },
    Screenshot { attachment_id: String, caption: String, file_name: String },
    Http { request: String, #[serde(default)] response: Option<String> },
    Note { text: String },
    Flag { flag_kind: String, value: String, #[serde(default)] attachment_id: Option<String> },
}

impl LogContent {
    pub fn kind(&self) -> &'static str {
        match self {
            LogContent::Command { .. } => "command",
            LogContent::Screenshot { .. } => "screenshot",
            LogContent::Http { .. } => "http",
            LogContent::Note { .. } => "note",
            LogContent::Flag { .. } => "flag",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub engagement_id: String,
    pub kind: String,
    pub title: String,
    pub title_edited: bool,
    pub ran_on: Option<String>,
    pub host_ids: Vec<String>,
    pub observations: Option<String>,
    pub returned_nothing: bool,
    pub private: bool,
    pub content: LogContent,
    pub at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAttachment {
    pub mime: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub mime: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryInput {
    pub title: String,
    #[serde(default)]
    pub title_edited: bool,
    #[serde(default)]
    pub ran_on: Option<String>,
    #[serde(default)]
    pub host_ids: Vec<String>,
    #[serde(default)]
    pub observations: Option<String>,
    #[serde(default)]
    pub returned_nothing: bool,
    #[serde(default)]
    pub private: bool,
    pub content: LogContent,
    #[serde(default)]
    pub at: Option<i64>,
    #[serde(default)]
    pub attachment: Option<NewAttachment>,
}

const COLS: &str = "id, engagement_id, kind, title, title_edited, ran_on, observations, \
    returned_nothing, private, content, at, created_at, updated_at";
const MAX_ATTACHMENT: usize = 25 * 1024 * 1024;

fn invalid(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

fn opt_trim(v: &Option<String>) -> Option<String> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn from_row(r: &Row) -> rusqlite::Result<LogEntry> {
    let json: String = r.get(9)?;
    let content = serde_json::from_str(&json)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(e)))?;
    Ok(LogEntry {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        kind: r.get(2)?,
        title: r.get(3)?,
        title_edited: r.get(4)?,
        ran_on: r.get(5)?,
        host_ids: vec![],
        observations: r.get(6)?,
        returned_nothing: r.get(7)?,
        private: r.get(8)?,
        content,
        at: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

fn fill_hosts(conn: &Connection, e: &mut LogEntry) -> AppResult<()> {
    let mut st = conn.prepare("SELECT host_id FROM log_entry_hosts WHERE entry_id = ?1 ORDER BY host_id")?;
    e.host_ids = st.query_map([&e.id], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
    Ok(())
}

fn get(conn: &Connection, id: &str) -> AppResult<LogEntry> {
    let mut e = match conn.query_row(&format!("SELECT {COLS} FROM log_entries WHERE id = ?1"), [id], from_row) {
        Ok(e) => e,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Err(AppError::NotFound),
        Err(e) => return Err(e.into()),
    };
    fill_hosts(conn, &mut e)?;
    Ok(e)
}

/// Newest `at` first.
pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<LogEntry>> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM log_entries WHERE engagement_id = ?1 ORDER BY at DESC, created_at DESC, rowid DESC"
    ))?;
    let mut rows = st.query_map([engagement_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    for e in &mut rows {
        fill_hosts(conn, e)?;
    }
    Ok(rows)
}

fn check_title(t: &str) -> AppResult<String> {
    let t = t.trim().to_string();
    if t.is_empty() || t.chars().count() > 300 {
        return Err(invalid("title", "title must be 1-300 characters"));
    }
    Ok(t)
}

fn check_content(c: &LogContent) -> AppResult<()> {
    let bad = |m: &str| Err(invalid("content", m));
    match c {
        LogContent::Command { blocks } => {
            if blocks.is_empty() || blocks.iter().any(|b| b.command.trim().is_empty()) {
                return bad("a command entry needs at least one non-empty command");
            }
        }
        LogContent::Note { text } if text.trim().is_empty() => return bad("note text is required"),
        LogContent::Http { request, .. } if request.trim().is_empty() => return bad("request is required"),
        LogContent::Flag { flag_kind, .. } if !matches!(flag_kind.as_str(), "local" | "proof") => {
            return bad("flagKind must be local or proof");
        }
        _ => {}
    }
    Ok(())
}

fn check_hosts(conn: &Connection, engagement_id: &str, ids: &[String]) -> AppResult<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        let ok: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM hosts WHERE id = ?1 AND engagement_id = ?2)",
            params![id, engagement_id],
            |r| r.get(0),
        )?;
        if !ok {
            return Err(invalid("hostIds", "host does not belong to this engagement"));
        }
        if !out.contains(id) {
            out.push(id.clone());
        }
    }
    Ok(out)
}

/// Validates the upload and returns the decoded bytes.
fn decode_attachment(a: &NewAttachment) -> AppResult<Vec<u8>> {
    let bad = |m: &str| invalid("attachment", m);
    if !matches!(a.mime.as_str(), "image/png" | "image/jpeg" | "image/webp" | "image/gif") {
        return Err(bad("attachment must be a png, jpeg, webp or gif image"));
    }
    // Reject oversized input before decoding (4 base64 chars carry 3 bytes).
    if a.data_base64.len() > MAX_ATTACHMENT / 3 * 4 + 8 {
        return Err(bad("attachment is larger than 25 MiB"));
    }
    let bytes = STANDARD.decode(a.data_base64.as_bytes()).map_err(|_| bad("attachment is not valid base64"))?;
    if bytes.len() > MAX_ATTACHMENT {
        return Err(bad("attachment is larger than 25 MiB"));
    }
    Ok(bytes)
}

fn write_hosts(conn: &Connection, entry_id: &str, host_ids: &[String]) -> AppResult<()> {
    for h in host_ids {
        conn.execute("INSERT INTO log_entry_hosts (entry_id, host_id) VALUES (?1, ?2)", params![entry_id, h])?;
    }
    Ok(())
}

pub fn create(conn: &Connection, engagement_id: &str, input: LogEntryInput) -> AppResult<LogEntry> {
    let exists: bool =
        conn.query_row("SELECT EXISTS(SELECT 1 FROM engagements WHERE id = ?1)", [engagement_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::NotFound);
    }
    let title = check_title(&input.title)?;
    check_content(&input.content)?;
    let host_ids = check_hosts(conn, engagement_id, &input.host_ids)?;
    let mut content = input.content.clone();
    let wants_attachment = matches!(content, LogContent::Screenshot { .. } | LogContent::Flag { .. });
    let attachment = match (&input.attachment, &content) {
        (Some(a), _) if wants_attachment => Some(decode_attachment(a)?),
        (None, LogContent::Screenshot { .. }) => return Err(invalid("attachment", "a screenshot needs an image")),
        (Some(_), _) => return Err(invalid("attachment", "this kind of entry takes no attachment")),
        _ => None,
    };

    let now = system_now_ms();
    let at = input.at.unwrap_or(now);
    let id = uuid::Uuid::new_v4().to_string();
    let tx = conn.unchecked_transaction()?;
    if let Some(bytes) = attachment {
        let att_id = uuid::Uuid::new_v4().to_string();
        // The entry row comes first so the attachment's FK is satisfied.
        match &mut content {
            LogContent::Screenshot { attachment_id, .. } => *attachment_id = att_id.clone(),
            LogContent::Flag { attachment_id, .. } => *attachment_id = Some(att_id.clone()),
            _ => {}
        }
        insert_entry(&tx, &id, engagement_id, &input, &title, &content, at, now)?;
        tx.execute(
            "INSERT INTO attachments (id, engagement_id, entry_id, mime, bytes, size, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![att_id, engagement_id, id, input.attachment.as_ref().unwrap().mime, bytes, bytes.len() as i64, now],
        )?;
    } else {
        // No upload, no attachment: a client-supplied id would point at nothing (or at another entry's image).
        if let LogContent::Flag { attachment_id, .. } = &mut content {
            *attachment_id = None;
        }
        insert_entry(&tx, &id, engagement_id, &input, &title, &content, at, now)?;
    }
    write_hosts(&tx, &id, &host_ids)?;
    tx.execute("UPDATE engagements SET last_activity_at = ?2 WHERE id = ?1", params![engagement_id, at])?;
    if let Some(r) = opt_trim(&input.ran_on) {
        crate::engagements::set_last_ran_on(&tx, engagement_id, Some(&r))?;
    }
    tx.commit()?;
    get(conn, &id)
}

#[allow(clippy::too_many_arguments)]
fn insert_entry(
    tx: &Connection,
    id: &str,
    engagement_id: &str,
    input: &LogEntryInput,
    title: &str,
    content: &LogContent,
    at: i64,
    now: i64,
) -> AppResult<()> {
    let json = serde_json::to_string(content).map_err(|e| AppError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO log_entries (id, engagement_id, kind, title, title_edited, ran_on, observations, \
         returned_nothing, private, content, at, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
        params![
            id,
            engagement_id,
            content.kind(),
            title,
            input.title_edited,
            opt_trim(&input.ran_on),
            opt_trim(&input.observations),
            input.returned_nothing,
            input.private,
            json,
            at,
            now
        ],
    )?;
    Ok(())
}

/// Full update. The attachment is ignored and the kind cannot change; a stored
/// `attachmentId` is kept regardless of what the client sends.
pub fn update(conn: &Connection, id: &str, input: LogEntryInput) -> AppResult<LogEntry> {
    let old = get(conn, id)?;
    let title = check_title(&input.title)?;
    check_content(&input.content)?;
    if input.content.kind() != old.kind {
        return Err(invalid("content", "an entry's kind cannot change"));
    }
    let host_ids = check_hosts(conn, &old.engagement_id, &input.host_ids)?;
    let mut content = input.content.clone();
    match (&mut content, &old.content) {
        (LogContent::Screenshot { attachment_id, .. }, LogContent::Screenshot { attachment_id: o, .. }) => {
            *attachment_id = o.clone()
        }
        (LogContent::Flag { attachment_id, .. }, LogContent::Flag { attachment_id: o, .. }) => *attachment_id = o.clone(),
        _ => {}
    }
    let json = serde_json::to_string(&content).map_err(|e| AppError::Db(e.to_string()))?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE log_entries SET title=?2, title_edited=?3, ran_on=?4, observations=?5, returned_nothing=?6, \
         private=?7, content=?8, at=?9, updated_at=?10 WHERE id=?1",
        params![
            id,
            title,
            input.title_edited,
            opt_trim(&input.ran_on),
            opt_trim(&input.observations),
            input.returned_nothing,
            input.private,
            json,
            input.at.unwrap_or(old.at),
            system_now_ms()
        ],
    )?;
    tx.execute("DELETE FROM log_entry_hosts WHERE entry_id = ?1", [id])?;
    write_hosts(&tx, id, &host_ids)?;
    tx.commit()?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM log_entries WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn attachment_get(conn: &Connection, id: &str) -> AppResult<Attachment> {
    match conn.query_row("SELECT id, mime, bytes FROM attachments WHERE id = ?1", [id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Vec<u8>>(2)?))
    }) {
        Ok((id, mime, bytes)) => Ok(Attachment { id, mime, data_base64: STANDARD.encode(bytes) }),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
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
        hosts::create(c, e, HostInput { name: ip.into(), ip: Some(ip.into()), os: None, access: None }).unwrap().id
    }

    fn input(content: LogContent) -> LogEntryInput {
        LogEntryInput {
            title: "  nmap sweep ".into(),
            title_edited: false,
            ran_on: None,
            host_ids: vec![],
            observations: None,
            returned_nothing: false,
            private: false,
            content,
            at: None,
            attachment: None,
        }
    }

    fn cmd() -> LogContent {
        LogContent::Command { blocks: vec![CommandBlock { command: "nmap -sV 10.0.0.5".into(), output: "".into(), shell: None }] }
    }

    fn shot() -> LogContent {
        LogContent::Screenshot { attachment_id: "client-supplied".into(), caption: "c".into(), file_name: "a.png".into() }
    }

    fn png(data: &[u8]) -> NewAttachment {
        NewAttachment { mime: "image/png".into(), data_base64: STANDARD.encode(data) }
    }

    fn flag(kind: &str) -> LogContent {
        LogContent::Flag { flag_kind: kind.into(), value: "deadbeef".into(), attachment_id: None }
    }

    fn field<T: std::fmt::Debug>(r: AppResult<T>) -> String {
        match r {
            Err(AppError::Validation { field, .. }) => field,
            o => panic!("expected validation, got {o:?}"),
        }
    }

    #[test]
    fn create_command_entry_links_hosts_and_bumps_activity() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let mut i = input(cmd());
        i.host_ids = vec![h.clone(), h.clone()];
        i.ran_on = Some(" Kali (VM) ".into());
        i.at = Some(1234);
        let en = create(c, &e, i).unwrap();
        assert_eq!((en.title.as_str(), en.kind.as_str(), en.at), ("nmap sweep", "command", 1234));
        assert_eq!(en.host_ids, vec![h]);
        assert_eq!(en.ran_on.as_deref(), Some("Kali (VM)"));
        let g = engagements::get(c, &e).unwrap();
        assert_eq!((g.last_activity_at, g.last_ran_on.as_deref()), (Some(1234), Some("Kali (VM)")));
        assert_eq!(list(c, &e).unwrap(), vec![en.clone()]);
        let newer = create(c, &e, { let mut i = input(cmd()); i.at = Some(5000); i }).unwrap();
        assert_eq!(list(c, &e).unwrap()[0].id, newer.id);
        // validation
        assert_eq!(field(create(c, &e, { let mut i = input(cmd()); i.title = "  ".into(); i })), "title");
        assert_eq!(field(create(c, &e, input(LogContent::Command { blocks: vec![] }))), "content");
        assert_eq!(field(create(c, &e, input(LogContent::Note { text: " ".into() }))), "content");
        assert_eq!(field(create(c, &e, input(LogContent::Http { request: "".into(), response: None }))), "content");
        assert_eq!(field(create(c, &e, input(flag("root")))), "content");
    }

    #[test]
    fn create_rejects_foreign_host() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (a, b) = (eng(c), eng(c));
        let hb = host(c, &b, "10.0.0.9");
        let mut i = input(cmd());
        i.host_ids = vec![hb];
        assert_eq!(field(create(c, &a, i)), "hostIds");
        assert!(list(c, &a).unwrap().is_empty());
    }

    #[test]
    fn screenshot_requires_attachment_and_stores_bytes() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        assert_eq!(field(create(c, &e, input(shot()))), "attachment");
        let mut bad = input(shot());
        bad.attachment = Some(NewAttachment { mime: "image/svg+xml".into(), data_base64: STANDARD.encode(b"x") });
        assert_eq!(field(create(c, &e, bad)), "attachment");
        let mut bad = input(shot());
        bad.attachment = Some(NewAttachment { mime: "image/png".into(), data_base64: "!!not base64".into() });
        assert_eq!(field(create(c, &e, bad)), "attachment");
        let mut ok = input(shot());
        ok.attachment = Some(png(&[1, 2, 3, 4]));
        let en = create(c, &e, ok).unwrap();
        let LogContent::Screenshot { attachment_id, .. } = &en.content else { panic!() };
        assert_ne!(attachment_id, "client-supplied");
        let a = attachment_get(c, attachment_id).unwrap();
        assert_eq!(STANDARD.decode(&a.data_base64).unwrap(), vec![1, 2, 3, 4]);
        assert_eq!(a.mime, "image/png");
        let size: i64 = c.query_row("SELECT size FROM attachments WHERE id=?1", [attachment_id], |r| r.get(0)).unwrap();
        assert_eq!(size, 4);
        assert_eq!(attachment_get(c, "nope"), Err(AppError::NotFound));
        // a flag may carry one; a note may not
        let mut f = input(flag("proof"));
        f.attachment = Some(png(&[9]));
        let fe = create(c, &e, f).unwrap();
        assert!(matches!(&fe.content, LogContent::Flag { attachment_id: Some(_), .. }));
        let mut n = input(LogContent::Note { text: "x".into() });
        n.attachment = Some(png(&[9]));
        assert_eq!(field(create(c, &e, n)), "attachment");
        // deleting the entry removes its attachment
        delete(c, &en.id).unwrap();
        assert_eq!(attachment_get(c, attachment_id), Err(AppError::NotFound));
    }

    #[test]
    fn flag_without_upload_ignores_client_attachment_id() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let i = input(LogContent::Flag { flag_kind: "local".into(), value: "deadbeef".into(), attachment_id: Some("forged".into()) });
        let en = create(c, &e, i).unwrap();
        assert!(matches!(&en.content, LogContent::Flag { attachment_id: None, .. }), "got {:?}", en.content);
    }

    #[test]
    fn attachment_too_large_rejected() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let mut i = input(shot());
        i.attachment = Some(png(&vec![0u8; MAX_ATTACHMENT + 1]));
        assert_eq!(field(create(c, &e, i)), "attachment");
        let mut i = input(shot());
        i.attachment = Some(png(&vec![0u8; MAX_ATTACHMENT]));
        assert!(create(c, &e, i).is_ok());
    }

    #[test]
    fn update_cannot_change_kind() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let en = create(c, &e, input(cmd())).unwrap();
        assert_eq!(field(update(c, &en.id, input(LogContent::Note { text: "x".into() }))), "content");
        let mut i = input(cmd());
        i.title = "renamed".into();
        i.host_ids = vec![h.clone()];
        i.private = true;
        let u = update(c, &en.id, i).unwrap();
        assert_eq!((u.title.as_str(), u.private, u.host_ids.clone()), ("renamed", true, vec![h]));
        assert_eq!(u.at, en.at);
        assert_eq!(update(c, "nope", input(cmd())), Err(AppError::NotFound));
        // screenshot keeps its stored attachment id
        let mut s = input(shot());
        s.attachment = Some(png(&[1]));
        let se = create(c, &e, s).unwrap();
        let su = update(c, &se.id, input(shot())).unwrap();
        assert_eq!(su.content, se.content);
    }

    #[test]
    fn deleting_proving_entry_keeps_confirmation() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        let mut i = input(cmd());
        i.host_ids = vec![h.clone()];
        let en = create(c, &e, i).unwrap();
        let s = crate::services::create(c, &h, crate::services::ServiceInput { port: 80, protocol: None, nmap_service: None, nmap_version: None }).unwrap();
        let s = crate::services::confirm(
            c,
            &s.id,
            crate::services::ConfirmInput { product: "nginx".into(), version: None, entry_id: Some(en.id.clone()) },
        )
        .unwrap();
        assert_eq!(s.confirmed_entry_id.as_deref(), Some(en.id.as_str()));
        delete(c, &en.id).unwrap();
        let s = crate::services::get(c, &s.id).unwrap();
        assert_eq!((s.confirmed_product.as_deref(), s.confirmed_entry_id), (Some("nginx"), None));
        let links: i64 = c.query_row("SELECT COUNT(*) FROM log_entry_hosts", [], |r| r.get(0)).unwrap();
        assert_eq!(links, 0);
        assert_eq!(delete(c, &en.id), Err(AppError::NotFound));
    }

    #[test]
    fn progress_counts_rooted_and_flags() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let e2 = eng(c);
        let (a, b, _z) = (host(c, &e, "10.0.0.1"), host(c, &e, "10.0.0.2"), host(c, &e, "10.0.0.3"));
        host(c, &e2, "10.0.0.1");
        let mk = |kind: &str, hs: &[&String]| {
            let mut i = input(flag(kind));
            i.host_ids = hs.iter().map(|h| (*h).clone()).collect();
            create(c, &e, i).unwrap();
        };
        mk("local", &[&a]);
        mk("local", &[&a]); // duplicate pair counts once
        mk("proof", &[&a]);
        mk("local", &[&b]);
        let p = engagements::progress_all(c).unwrap();
        let pe = &p[&e];
        assert_eq!((pe.hosts_total, pe.hosts_rooted, pe.flags_found, pe.flags_total), (3, 1, 3, 6));
        let p2 = &p[&e2];
        assert_eq!((p2.hosts_total, p2.hosts_rooted, p2.flags_found, p2.flags_total), (1, 0, 0, 2));
    }

    #[test]
    fn content_json_round_trips_each_kind() {
        let kinds = vec![
            cmd(),
            LogContent::Command { blocks: vec![CommandBlock { command: "id".into(), output: "uid=0".into(), shell: Some("bash".into()) }] },
            shot(),
            LogContent::Http { request: "GET / HTTP/1.1".into(), response: Some("200".into()) },
            LogContent::Http { request: "GET /".into(), response: None },
            LogContent::Note { text: "hi".into() },
            LogContent::Flag { flag_kind: "local".into(), value: "v".into(), attachment_id: Some("a".into()) },
        ];
        for k in kinds {
            let j = serde_json::to_value(&k).unwrap();
            assert_eq!(j["kind"], k.kind());
            assert_eq!(serde_json::from_value::<LogContent>(j).unwrap(), k);
        }
        let j = serde_json::to_value(shot()).unwrap();
        assert!(j.get("attachmentId").is_some() && j.get("fileName").is_some());
        let f: LogContent = serde_json::from_str(r#"{"kind":"flag","flagKind":"proof","value":"x"}"#).unwrap();
        assert_eq!(f, LogContent::Flag { flag_kind: "proof".into(), value: "x".into(), attachment_id: None });
        // stored round trip keeps kind column == tag
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let en = create(c, &e, input(LogContent::Http { request: "GET /".into(), response: None })).unwrap();
        let kind: String = c.query_row("SELECT kind FROM log_entries WHERE id=?1", [&en.id], |r| r.get(0)).unwrap();
        assert_eq!(kind, "http");
    }
}
