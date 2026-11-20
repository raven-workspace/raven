//! Findings (with linked hosts, services and ordered reproduction steps), finding files and failed attempts.

use crate::db::{blank_to_none, check_in_engagement, check_scope, delete_by_id, now_ms};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub(crate) const MAX_CONTENT: usize = 1024 * 1024;
pub(crate) const MAX_REFS: usize = 100;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub engagement_id: String,
    pub title: String,
    pub severity: Option<String>,
    pub cvss_vector: Option<String>,
    pub cvss_score: Option<f64>,
    pub status: String,
    pub description: String,
    pub impact: String,
    pub remediation: String,
    pub exploit_notes: String,
    /// Always private: a later export or report must exclude it.
    pub lessons: String,
    pub refs: Vec<String>,
    pub host_ids: Vec<String>,
    pub service_ids: Vec<String>,
    /// Log entry ids in reproduction order.
    pub step_entry_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingInput {
    pub title: String,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub cvss_vector: Option<String>,
    #[serde(default)]
    pub cvss_score: Option<f64>,
    /// Absent means draft.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub impact: String,
    #[serde(default)]
    pub remediation: String,
    #[serde(default)]
    pub exploit_notes: String,
    #[serde(default)]
    pub lessons: String,
    #[serde(default)]
    pub refs: Vec<String>,
    #[serde(default)]
    pub host_ids: Vec<String>,
    #[serde(default)]
    pub service_ids: Vec<String>,
    #[serde(default)]
    pub step_entry_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingFile {
    pub id: String,
    pub finding_id: String,
    pub name: String,
    pub language: Option<String>,
    pub content: String,
    pub modified: bool,
    pub original_url: Option<String>,
    pub original_content: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// `modified`, `original_url` and `original_content` are optional: absent keeps the current value on update.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingFileInput {
    pub name: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub modified: Option<bool>,
    #[serde(default)]
    pub original_url: Option<String>,
    #[serde(default)]
    pub original_content: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedAttempt {
    pub id: String,
    pub engagement_id: String,
    pub host_id: Option<String>,
    pub finding_id: Option<String>,
    pub title: String,
    pub reason_kind: Option<String>,
    pub reason: String,
    /// Set by the server: true iff `reason_kind` is `operator`.
    pub private: bool,
    pub log_entry_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedAttemptInput {
    #[serde(default)]
    pub host_id: Option<String>,
    #[serde(default)]
    pub finding_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub reason_kind: Option<String>,
    pub reason: String,
    // No `private`: privacy is derived from `reason_kind`, and a client's flag is dropped on deserialize.
    #[serde(default)]
    pub log_entry_id: Option<String>,
}

fn dedupe(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter().filter(|i| seen.insert(i.as_str())).cloned().collect()
}

fn finding_engagement(conn: &Connection, id: &str) -> AppResult<String> {
    conn.query_row("SELECT engagement_id FROM findings WHERE id = ?1", [id], |r| r.get(0)).optional()?.ok_or(AppError::NotFound)
}

// ---- findings ----

const F_COLS: &str = "id, engagement_id, title, severity, cvss_vector, cvss_score, status, description, impact, \
    remediation, exploit_notes, lessons, refs, created_at, updated_at";

fn finding_row(r: &Row) -> rusqlite::Result<Finding> {
    let refs_json: String = r.get(12)?;
    let refs = serde_json::from_str(&refs_json)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(e)))?;
    Ok(Finding {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        title: r.get(2)?,
        severity: r.get(3)?,
        cvss_vector: r.get(4)?,
        cvss_score: r.get(5)?,
        status: r.get(6)?,
        description: r.get(7)?,
        impact: r.get(8)?,
        remediation: r.get(9)?,
        exploit_notes: r.get(10)?,
        lessons: r.get(11)?,
        refs,
        host_ids: vec![],
        service_ids: vec![],
        step_entry_ids: vec![],
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

fn ids(conn: &Connection, sql: &str, finding_id: &str) -> AppResult<Vec<String>> {
    let mut st = conn.prepare_cached(sql)?;
    Ok(st.query_map([finding_id], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?)
}

fn fill_links(conn: &Connection, f: &mut Finding) -> AppResult<()> {
    f.host_ids = ids(conn, "SELECT host_id FROM finding_hosts WHERE finding_id = ?1 ORDER BY rowid", &f.id)?;
    f.service_ids = ids(conn, "SELECT service_id FROM finding_services WHERE finding_id = ?1 ORDER BY rowid", &f.id)?;
    f.step_entry_ids = ids(conn, "SELECT entry_id FROM finding_steps WHERE finding_id = ?1 ORDER BY position, entry_id", &f.id)?;
    Ok(())
}

fn get(conn: &Connection, id: &str) -> AppResult<Finding> {
    let mut f = conn.query_row(&format!("SELECT {F_COLS} FROM findings WHERE id = ?1"), [id], finding_row).optional()?.ok_or(AppError::NotFound)?;
    fill_links(conn, &mut f)?;
    Ok(f)
}

pub fn findings_list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Finding>> {
    check_scope(conn, engagement_id, None)?;
    let mut st =
        conn.prepare(&format!("SELECT {F_COLS} FROM findings WHERE engagement_id = ?1 ORDER BY created_at, rowid"))?;
    let mut out = st.query_map([engagement_id], finding_row)?.collect::<Result<Vec<_>, _>>()?;
    for f in &mut out {
        fill_links(conn, f)?;
    }
    Ok(out)
}

struct CleanFinding {
    title: String,
    severity: Option<String>,
    cvss_vector: Option<String>,
    cvss_score: Option<f64>,
    status: String,
    refs_json: String,
    host_ids: Vec<String>,
    service_ids: Vec<String>,
    step_entry_ids: Vec<String>,
}

fn clean_finding(conn: &Connection, engagement_id: &str, i: &FindingInput) -> AppResult<CleanFinding> {
    let title = i.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::validation("title", "title must not be blank"));
    }
    let severity = blank_to_none(i.severity.as_deref());
    if severity.as_deref().is_some_and(|s| !matches!(s, "critical" | "high" | "medium" | "low" | "info")) {
        return Err(AppError::validation("severity", "severity must be critical, high, medium, low or info"));
    }
    let status = i.status.clone().unwrap_or_else(|| "draft".into());
    if !matches!(status.as_str(), "draft" | "confirmed" | "reported") {
        return Err(AppError::validation("status", "status must be draft, confirmed or reported"));
    }
    if i.cvss_score.is_some_and(|s| !(0.0..=10.0).contains(&s)) {
        return Err(AppError::validation("cvssScore", "CVSS score must be 0-10"));
    }
    if i.refs.len() > MAX_REFS {
        return Err(AppError::validation("refs", "at most 100 references"));
    }
    let mut refs = Vec::with_capacity(i.refs.len());
    for r in &i.refs {
        let r = r.trim();
        if r.is_empty() {
            return Err(AppError::validation("refs", "references must not be blank"));
        }
        refs.push(r.to_string());
    }
    for (field, text) in [
        ("description", &i.description),
        ("impact", &i.impact),
        ("remediation", &i.remediation),
        ("exploitNotes", &i.exploit_notes),
        ("lessons", &i.lessons),
    ] {
        if text.len() > MAX_CONTENT {
            return Err(AppError::validation(field, "text is too long (1 MiB max)"));
        }
    }
    let host_ids = dedupe(&i.host_ids);
    for h in &host_ids {
        check_scope(conn, engagement_id, Some(h))?;
    }
    let service_ids = dedupe(&i.service_ids);
    for s in &service_ids {
        let ok: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM services s JOIN hosts h ON h.id = s.host_id WHERE s.id = ?1 AND h.engagement_id = ?2)",
            params![s, engagement_id],
            |r| r.get(0),
        )?;
        if !ok {
            return Err(AppError::NotFound);
        }
    }
    let step_entry_ids = dedupe(&i.step_entry_ids);
    for e in &step_entry_ids {
        check_in_engagement(conn, "log_entries", engagement_id, e)?;
    }
    Ok(CleanFinding {
        title,
        severity,
        cvss_vector: blank_to_none(i.cvss_vector.as_deref()),
        cvss_score: i.cvss_score,
        status,
        refs_json: serde_json::to_string(&refs)?,
        host_ids,
        service_ids,
        step_entry_ids,
    })
}

fn replace_links(conn: &Connection, finding_id: &str, c: &CleanFinding) -> AppResult<()> {
    for t in ["finding_hosts", "finding_services", "finding_steps"] {
        conn.execute(&format!("DELETE FROM {t} WHERE finding_id = ?1"), [finding_id])?;
    }
    for h in &c.host_ids {
        conn.execute("INSERT INTO finding_hosts (finding_id, host_id) VALUES (?1, ?2)", params![finding_id, h])?;
    }
    for s in &c.service_ids {
        conn.execute("INSERT INTO finding_services (finding_id, service_id) VALUES (?1, ?2)", params![finding_id, s])?;
    }
    for (pos, e) in c.step_entry_ids.iter().enumerate() {
        conn.execute(
            "INSERT INTO finding_steps (finding_id, entry_id, position) VALUES (?1, ?2, ?3)",
            params![finding_id, e, pos as i64],
        )?;
    }
    Ok(())
}

pub fn finding_create(conn: &Connection, engagement_id: &str, input: FindingInput) -> AppResult<Finding> {
    check_scope(conn, engagement_id, None)?;
    let c = clean_finding(conn, engagement_id, &input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO findings (id, engagement_id, title, severity, cvss_vector, cvss_score, status, description, impact, \
         remediation, exploit_notes, lessons, refs, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14)",
        params![
            id, engagement_id, c.title, c.severity, c.cvss_vector, c.cvss_score, c.status, input.description,
            input.impact, input.remediation, input.exploit_notes, input.lessons, c.refs_json, now
        ],
    )?;
    replace_links(&tx, &id, &c)?;
    tx.commit()?;
    get(conn, &id)
}

pub fn finding_update(conn: &Connection, id: &str, input: FindingInput) -> AppResult<Finding> {
    let engagement_id = finding_engagement(conn, id)?;
    let c = clean_finding(conn, &engagement_id, &input)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE findings SET title=?2, severity=?3, cvss_vector=?4, cvss_score=?5, status=?6, description=?7, impact=?8, \
         remediation=?9, exploit_notes=?10, lessons=?11, refs=?12, updated_at=?13 WHERE id=?1",
        params![
            id, c.title, c.severity, c.cvss_vector, c.cvss_score, c.status, input.description, input.impact,
            input.remediation, input.exploit_notes, input.lessons, c.refs_json, now_ms()
        ],
    )?;
    replace_links(&tx, id, &c)?;
    tx.commit()?;
    get(conn, id)
}

pub fn finding_delete(conn: &Connection, id: &str) -> AppResult<()> {
    delete_by_id(conn, "findings", id)
}

// ---- finding files ----

const FILE_COLS: &str = "id, finding_id, name, language, content, modified, original_url, original_content, created_at, updated_at";

fn file_row(r: &Row) -> rusqlite::Result<FindingFile> {
    Ok(FindingFile {
        id: r.get(0)?,
        finding_id: r.get(1)?,
        name: r.get(2)?,
        language: r.get(3)?,
        content: r.get(4)?,
        modified: r.get::<_, i64>(5)? != 0,
        original_url: r.get(6)?,
        original_content: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

fn clean_file(i: &FindingFileInput) -> AppResult<(String, Option<String>)> {
    let name = i.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::validation("name", "name must not be blank"));
    }
    if i.content.len() > MAX_CONTENT {
        return Err(AppError::validation("content", "content is too long (1 MiB max)"));
    }
    if i.original_content.as_deref().is_some_and(|c| c.len() > MAX_CONTENT) {
        return Err(AppError::validation("originalContent", "original content is too long (1 MiB max)"));
    }
    Ok((name, blank_to_none(i.language.as_deref())))
}

fn file_get(conn: &Connection, id: &str) -> AppResult<FindingFile> {
    conn.query_row(&format!("SELECT {FILE_COLS} FROM finding_files WHERE id = ?1"), [id], file_row).optional()?.ok_or(AppError::NotFound)
}

pub fn files_list(conn: &Connection, finding_id: &str) -> AppResult<Vec<FindingFile>> {
    finding_engagement(conn, finding_id)?;
    let mut st = conn.prepare(&format!(
        "SELECT {FILE_COLS} FROM finding_files WHERE finding_id = ?1 ORDER BY created_at, rowid"
    ))?;
    Ok(st.query_map([finding_id], file_row)?.collect::<Result<Vec<_>, _>>()?)
}

pub fn file_create(conn: &Connection, finding_id: &str, input: FindingFileInput) -> AppResult<FindingFile> {
    finding_engagement(conn, finding_id)?;
    let (name, language) = clean_file(&input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO finding_files (id, finding_id, name, language, content, modified, original_url, original_content, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        params![
            id,
            finding_id,
            name,
            language,
            input.content,
            input.modified.unwrap_or(false),
            blank_to_none(input.original_url.as_deref()),
            input.original_content.clone().filter(|c| !c.is_empty()),
            now
        ],
    )?;
    file_get(conn, &id)
}

pub fn file_update(conn: &Connection, id: &str, input: FindingFileInput) -> AppResult<FindingFile> {
    file_get(conn, id)?;
    let (name, language) = clean_file(&input)?;
    conn.execute(
        "UPDATE finding_files SET name=?2, language=?3, content=?4, \
         modified=COALESCE(?5, modified), \
         original_url=CASE WHEN ?6 IS NULL THEN original_url ELSE NULLIF(trim(?6), '') END, \
         original_content=CASE WHEN ?7 IS NULL THEN original_content ELSE NULLIF(?7, '') END, \
         updated_at=?8 WHERE id=?1",
        params![id, name, language, input.content, input.modified, input.original_url, input.original_content, now_ms()],
    )?;
    file_get(conn, id)
}

pub fn file_delete(conn: &Connection, id: &str) -> AppResult<()> {
    delete_by_id(conn, "finding_files", id)
}

// ---- failed attempts ----

const A_COLS: &str =
    "id, engagement_id, host_id, finding_id, title, reason_kind, reason, private, log_entry_id, created_at, updated_at";

fn attempt_row(r: &Row) -> rusqlite::Result<FailedAttempt> {
    Ok(FailedAttempt {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        host_id: r.get(2)?,
        finding_id: r.get(3)?,
        title: r.get(4)?,
        reason_kind: r.get(5)?,
        reason: r.get(6)?,
        private: r.get::<_, i64>(7)? != 0,
        log_entry_id: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

struct CleanAttempt {
    host_id: Option<String>,
    finding_id: Option<String>,
    title: String,
    reason_kind: Option<String>,
    reason: String,
    private: bool,
    log_entry_id: Option<String>,
}

fn clean_attempt(conn: &Connection, engagement_id: &str, i: &FailedAttemptInput) -> AppResult<CleanAttempt> {
    let title = i.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::validation("title", "title must not be blank"));
    }
    let reason = i.reason.trim().to_string();
    if reason.is_empty() {
        return Err(AppError::validation("reason", "reason must not be blank"));
    }
    if reason.len() > MAX_CONTENT {
        return Err(AppError::validation("reason", "reason is too long (1 MiB max)"));
    }
    let reason_kind = blank_to_none(i.reason_kind.as_deref());
    if reason_kind.is_none() {
        return Err(AppError::validation("reasonKind", "say why it failed"));
    }
    if reason_kind.as_deref().is_some_and(|k| !matches!(k, "control" | "precondition" | "access" | "operator")) {
        return Err(AppError::validation("reasonKind", "reason kind must be control, precondition, access or operator"));
    }
    let host_id = blank_to_none(i.host_id.as_deref());
    if let Some(h) = &host_id {
        check_scope(conn, engagement_id, Some(h))?;
    }
    let finding_id = blank_to_none(i.finding_id.as_deref());
    if let Some(f) = &finding_id {
        check_in_engagement(conn, "findings", engagement_id, f)?;
    }
    let log_entry_id = blank_to_none(i.log_entry_id.as_deref());
    if let Some(l) = &log_entry_id {
        check_in_engagement(conn, "log_entries", engagement_id, l)?;
    }
    let private = reason_kind.as_deref() == Some("operator");
    Ok(CleanAttempt { host_id, finding_id, title, reason_kind, reason, private, log_entry_id })
}

fn attempt_get(conn: &Connection, id: &str) -> AppResult<FailedAttempt> {
    conn.query_row(&format!("SELECT {A_COLS} FROM failed_attempts WHERE id = ?1"), [id], attempt_row).optional()?.ok_or(AppError::NotFound)
}

pub fn attempts_list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<FailedAttempt>> {
    check_scope(conn, engagement_id, None)?;
    let mut st = conn.prepare(&format!(
        "SELECT {A_COLS} FROM failed_attempts WHERE engagement_id = ?1 ORDER BY created_at, rowid"
    ))?;
    Ok(st.query_map([engagement_id], attempt_row)?.collect::<Result<Vec<_>, _>>()?)
}

pub fn attempt_create(conn: &Connection, engagement_id: &str, input: FailedAttemptInput) -> AppResult<FailedAttempt> {
    check_scope(conn, engagement_id, None)?;
    let c = clean_attempt(conn, engagement_id, &input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        &format!("INSERT INTO failed_attempts ({A_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)"),
        params![id, engagement_id, c.host_id, c.finding_id, c.title, c.reason_kind, c.reason, c.private, c.log_entry_id, now],
    )?;
    attempt_get(conn, &id)
}

pub fn attempt_update(conn: &Connection, id: &str, input: FailedAttemptInput) -> AppResult<FailedAttempt> {
    let engagement_id = attempt_get(conn, id)?.engagement_id;
    let c = clean_attempt(conn, &engagement_id, &input)?;
    conn.execute(
        "UPDATE failed_attempts SET host_id=?2, finding_id=?3, title=?4, reason_kind=?5, reason=?6, private=?7, \
         log_entry_id=?8, updated_at=?9 WHERE id=?1",
        params![id, c.host_id, c.finding_id, c.title, c.reason_kind, c.reason, c.private, c.log_entry_id, now_ms()],
    )?;
    attempt_get(conn, id)
}

pub fn attempt_delete(conn: &Connection, id: &str) -> AppResult<()> {
    delete_by_id(conn, "failed_attempts", id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engagements::{self, EngagementInput};
    use crate::hosts::{self, HostInput};
    use crate::paths::DataPaths;
    use crate::services::{self, ServiceInput};
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

    fn svc(c: &Connection, host_id: &str, port: i64) -> String {
        services::create(c, host_id, ServiceInput { port, protocol: None, nmap_service: None, nmap_version: None })
            .unwrap()
            .id
    }

    fn entry(c: &Connection, eid: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        c.execute(
            "INSERT INTO log_entries (id, engagement_id, kind, title, content, at, created_at, updated_at) \
             VALUES (?1, ?2, 'note', 't', 'x', 1, 1, 1)",
            params![id, eid],
        )
        .unwrap();
        id
    }

    fn fin(title: &str) -> FindingInput {
        FindingInput { title: title.into(), ..Default::default() }
    }

    fn att(title: &str, kind: Option<&str>) -> FailedAttemptInput {
        FailedAttemptInput {
            host_id: None,
            finding_id: None,
            title: title.into(),
            reason_kind: kind.map(str::to_string),
            reason: "because".into(),
            log_entry_id: None,
        }
    }

    #[test]
    fn finding_round_trip_with_links_in_order() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let h = host(c, &e, "10.0.0.1");
        let s = svc(c, &h, 445);
        let (e1, e2, e3) = (entry(c, &e), entry(c, &e), entry(c, &e));
        let mut i = fin("  SMB signing off  ");
        i.severity = Some("high".into());
        i.cvss_vector = Some("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H".into());
        i.cvss_score = Some(9.8);
        i.description = "d".into();
        i.lessons = "private lesson".into();
        i.refs = vec![" https://example.test/a ".into()];
        i.host_ids = vec![h.clone()];
        i.service_ids = vec![s.clone()];
        i.step_entry_ids = vec![e3.clone(), e1.clone(), e2.clone()];
        let f = finding_create(c, &e, i).unwrap();
        assert_eq!(f.title, "SMB signing off");
        assert_eq!(f.status, "draft");
        assert_eq!(f.refs, vec!["https://example.test/a".to_string()]);
        assert_eq!(f.host_ids, vec![h]);
        assert_eq!(f.service_ids, vec![s]);
        assert_eq!(f.step_entry_ids, vec![e3, e1, e2]);
        assert_eq!(f.lessons, "private lesson");
        let list = findings_list(c, &e).unwrap();
        assert_eq!(list, vec![f]);
        finding_delete(c, &list[0].id).unwrap();
        assert!(findings_list(c, &e).unwrap().is_empty());
        assert!(matches!(finding_delete(c, "nope"), Err(AppError::NotFound)));
    }

    #[test]
    fn update_replaces_links_and_renumbers_steps() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let (h1, h2) = (host(c, &e, "10.0.0.1"), host(c, &e, "10.0.0.2"));
        let s2 = svc(c, &h2, 80);
        let (e1, e2, e3) = (entry(c, &e), entry(c, &e), entry(c, &e));
        let mut i = fin("F");
        i.host_ids = vec![h1];
        i.step_entry_ids = vec![e1.clone(), e2.clone(), e3.clone()];
        let f = finding_create(c, &e, i).unwrap();
        let mut u = fin("F2");
        u.host_ids = vec![h2.clone()];
        u.service_ids = vec![s2.clone()];
        u.step_entry_ids = vec![e3.clone(), e1.clone()];
        let f2 = finding_update(c, &f.id, u).unwrap();
        assert_eq!(f2.title, "F2");
        assert_eq!(f2.host_ids, vec![h2]);
        assert_eq!(f2.service_ids, vec![s2]);
        assert_eq!(f2.step_entry_ids, vec![e3.clone(), e1.clone()]);
        let pos: Vec<(String, i64)> = c
            .prepare("SELECT entry_id, position FROM finding_steps WHERE finding_id = ?1 ORDER BY position")
            .unwrap()
            .query_map([&f.id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(pos, vec![(e3, 0), (e1, 1)]);
        assert!(matches!(finding_update(c, "nope", fin("x")), Err(AppError::NotFound)));
    }

    #[test]
    fn deleting_log_entry_drops_step_keeps_order() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let (e1, e2, e3) = (entry(c, &e), entry(c, &e), entry(c, &e));
        let mut i = fin("F");
        i.step_entry_ids = vec![e1.clone(), e2.clone(), e3.clone()];
        let f = finding_create(c, &e, i).unwrap();
        c.execute("DELETE FROM log_entries WHERE id = ?1", [&e2]).unwrap();
        let got = findings_list(c, &e).unwrap().remove(0);
        assert_eq!(got.step_entry_ids, vec![e1, e3]);
        assert_eq!(got.id, f.id);
    }

    #[test]
    fn deleting_host_drops_finding_host_link() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let (h1, h2) = (host(c, &e, "10.0.0.1"), host(c, &e, "10.0.0.2"));
        let mut i = fin("F");
        i.host_ids = vec![h1.clone(), h2.clone()];
        finding_create(c, &e, i).unwrap();
        hosts::delete(c, &h1).unwrap();
        assert_eq!(findings_list(c, &e).unwrap()[0].host_ids, vec![h2]);
    }

    #[test]
    fn operator_reason_is_private_and_client_flag_ignored() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let a = attempt_create(c, &e, att("typo'd the payload", Some("operator"))).unwrap();
        assert!(a.private);
        // A client-sent `"private": true` is dropped on deserialize.
        let json = r#"{"title":"blocked by EDR","reasonKind":"control","reason":"because","private":true}"#;
        let b = attempt_create(c, &e, serde_json::from_str::<FailedAttemptInput>(json).unwrap()).unwrap();
        assert!(!b.private);
        let n = attempt_create(c, &e, att("other", Some("precondition"))).unwrap();
        assert!(!n.private);
        // update re-derives
        let mut u = att("blocked by EDR", Some("operator"));
        u.reason = "my mistake".into();
        let b2 = attempt_update(c, &b.id, u).unwrap();
        assert!(b2.private);
        let a2 = attempt_update(c, &a.id, att("x", Some("access"))).unwrap();
        assert!(!a2.private);
        let stored: i64 = c.query_row("SELECT private FROM failed_attempts WHERE id = ?1", [&a.id], |r| r.get(0)).unwrap();
        assert_eq!(stored, 0);
        assert_eq!(attempts_list(c, &e).unwrap().len(), 3);
        assert!(attempt_create(c, &e, att("  ", Some("control"))).is_err());
        let mut blank = att("t", Some("control"));
        blank.reason = " ".into();
        assert!(matches!(attempt_create(c, &e, blank), Err(AppError::Validation { field, .. }) if field == "reason"));
        attempt_delete(c, &a.id).unwrap();
        assert!(matches!(attempt_delete(c, &a.id), Err(AppError::NotFound)));
    }

    #[test]
    fn reason_kind_is_required_on_create_and_update() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let is_kind = |r: Result<FailedAttempt, AppError>| matches!(r, Err(AppError::Validation { field, .. }) if field == "reasonKind");
        assert!(is_kind(attempt_create(c, &e, att("t", None))));
        assert!(is_kind(attempt_create(c, &e, att("t", Some("  ")))));
        let a = attempt_create(c, &e, att("t", Some("control"))).unwrap();
        assert!(is_kind(attempt_update(c, &a.id, att("t", None))));
        assert!(is_kind(attempt_update(c, &a.id, att("t", Some("")))));
    }

    #[test]
    fn file_content_limit() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let f = finding_create(c, &e, fin("F")).unwrap();
        let ok = FindingFileInput { name: " poc.py ".into(), language: Some("python".into()), content: "x".repeat(1024 * 1024), modified: None, original_url: None, original_content: None };
        let file = file_create(c, &f.id, ok).unwrap();
        assert_eq!(file.name, "poc.py");
        let big = FindingFileInput { name: "a".into(), language: None, content: "x".repeat(1024 * 1024 + 1), modified: None, original_url: None, original_content: None };
        assert!(matches!(file_create(c, &f.id, big.clone()), Err(AppError::Validation { field, .. }) if field == "content"));
        assert!(matches!(file_update(c, &file.id, big), Err(AppError::Validation { .. })));
        let blank = FindingFileInput { name: " ".into(), language: None, content: "".into(), modified: None, original_url: None, original_content: None };
        assert!(matches!(file_create(c, &f.id, blank), Err(AppError::Validation { field, .. }) if field == "name"));
        let upd = FindingFileInput { name: "b.sh".into(), language: None, content: "echo".into(), modified: None, original_url: None, original_content: None };
        let u = file_update(c, &file.id, upd).unwrap();
        assert_eq!((u.name.as_str(), u.language, u.content.as_str()), ("b.sh", None, "echo"));
        assert_eq!(files_list(c, &f.id).unwrap().len(), 1);
        file_delete(c, &file.id).unwrap();
        assert!(files_list(c, &f.id).unwrap().is_empty());
        assert!(matches!(file_create(c, "nope", fin_file()), Err(AppError::NotFound)));
        // cascade with the finding
        let f2 = finding_create(c, &e, fin("G")).unwrap();
        file_create(c, &f2.id, fin_file()).unwrap();
        finding_delete(c, &f2.id).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM finding_files", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn finding_file_modified_fields_round_trip() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let f = finding_create(c, &e, fin("F")).unwrap();
        let url = "https://www.exploit-db.com/exploits/50000";
        let mut i = fin_file();
        i.modified = Some(true);
        i.original_url = Some(url.into());
        i.original_content = Some("orig".into());
        let file = file_create(c, &f.id, i).unwrap();
        assert!(file.modified);
        assert_eq!(file.original_url.as_deref(), Some(url));
        assert_eq!(file.original_content.as_deref(), Some("orig"));
        // Absent on update keeps them.
        let mut u = fin_file();
        u.content = "new".into();
        let u = file_update(c, &file.id, u).unwrap();
        assert_eq!(u.content, "new");
        assert!(u.modified);
        assert_eq!(u.original_url.as_deref(), Some(url));
        assert_eq!(u.original_content.as_deref(), Some("orig"));
        // Explicit values change them; blank clears.
        let mut u2 = fin_file();
        u2.modified = Some(false);
        u2.original_url = Some(" ".into());
        let u2 = file_update(c, &file.id, u2).unwrap();
        assert!(!u2.modified);
        assert_eq!(u2.original_url, None);
        assert_eq!(u2.original_content.as_deref(), Some("orig"));
        // Defaults on a plain create; original content is capped.
        let plain = file_create(c, &f.id, fin_file()).unwrap();
        assert!(!plain.modified && plain.original_url.is_none() && plain.original_content.is_none());
        let mut big = fin_file();
        big.original_content = Some("x".repeat(1024 * 1024 + 1));
        assert!(matches!(file_create(c, &f.id, big), Err(AppError::Validation { field, .. }) if field == "originalContent"));
    }

    fn fin_file() -> FindingFileInput {
        FindingFileInput { name: "n".into(), language: None, content: "c".into(), modified: None, original_url: None, original_content: None }
    }

    #[test]
    fn foreign_links_rejected() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (a, b) = (eng(c, "A"), eng(c, "B"));
        let hb = host(c, &b, "10.0.1.1");
        let sb = svc(c, &hb, 22);
        let eb = entry(c, &b);
        let mut i = fin("F");
        i.host_ids = vec![hb.clone()];
        assert!(matches!(finding_create(c, &a, i), Err(AppError::NotFound)));
        let mut i = fin("F");
        i.service_ids = vec![sb];
        assert!(matches!(finding_create(c, &a, i), Err(AppError::NotFound)));
        let mut i = fin("F");
        i.step_entry_ids = vec![eb.clone()];
        assert!(matches!(finding_create(c, &a, i), Err(AppError::NotFound)));
        let fa = finding_create(c, &a, fin("ok")).unwrap();
        let mut u = fin("ok");
        u.host_ids = vec![hb.clone()];
        assert!(matches!(finding_update(c, &fa.id, u), Err(AppError::NotFound)));
        assert!(findings_list(c, &a).unwrap()[0].host_ids.is_empty());
        let mut x = att("t", Some("control"));
        x.host_id = Some(hb);
        assert!(matches!(attempt_create(c, &a, x), Err(AppError::NotFound)));
        let mut x = att("t", Some("control"));
        x.log_entry_id = Some(eb);
        assert!(matches!(attempt_create(c, &a, x), Err(AppError::NotFound)));
        let fb = finding_create(c, &b, fin("b")).unwrap();
        let mut x = att("t", Some("control"));
        x.finding_id = Some(fb.id);
        assert!(matches!(attempt_create(c, &a, x), Err(AppError::NotFound)));
        assert!(matches!(findings_list(c, "nope"), Err(AppError::NotFound)));
    }

    #[test]
    fn finding_validation() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let field = |r: AppResult<Finding>| match r {
            Err(AppError::Validation { field, .. }) => field,
            other => panic!("expected validation, got {other:?}"),
        };
        assert_eq!(field(finding_create(c, &e, fin("  "))), "title");
        let mut i = fin("F");
        i.cvss_score = Some(10.1);
        assert_eq!(field(finding_create(c, &e, i)), "cvssScore");
        let mut i = fin("F");
        i.cvss_score = Some(-0.1);
        assert_eq!(field(finding_create(c, &e, i)), "cvssScore");
        let mut i = fin("F");
        i.cvss_score = Some(10.0);
        assert!(finding_create(c, &e, i).is_ok());
        let mut i = fin("F");
        i.refs = vec!["ok".into(), " ".into()];
        assert_eq!(field(finding_create(c, &e, i)), "refs");
        let mut i = fin("F");
        i.refs = (0..101).map(|n| format!("r{n}")).collect();
        assert_eq!(field(finding_create(c, &e, i)), "refs");
        let mut i = fin("F");
        i.severity = Some("urgent".into());
        assert_eq!(field(finding_create(c, &e, i)), "severity");
        let mut i = fin("F");
        i.status = Some("done".into());
        assert_eq!(field(finding_create(c, &e, i)), "status");
    }
}
