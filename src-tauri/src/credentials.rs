//! Credentials, usernames and access grants. Everything belongs to one engagement.
//!
//! Secrets are stored as entered (the database is encrypted); masking is a UI concern.

use crate::backup::system_now_ms;
use crate::error::{AppError, AppResult};
use crate::notes::check_scope;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credential {
    pub id: String,
    pub engagement_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub username: String,
    pub domain: Option<String>,
    pub secret: String,
    pub hash_type: Option<String>,
    pub scope: String,
    pub local_host_id: Option<String>,
    pub source_host_id: Option<String>,
    pub source: Option<String>,
    pub notes: Option<String>,
    pub crack_status: Option<String>,
    pub cracked_from: Option<String>,
    pub from_secret_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialInput {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub secret: String,
    #[serde(default)]
    pub hash_type: Option<String>,
    /// Absent means `domain`.
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub local_host_id: Option<String>,
    #[serde(default)]
    pub source_host_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Absent keeps the current value on update; a new hash starts `uncracked`.
    #[serde(default)]
    pub crack_status: Option<String>,
    /// Absent keeps the current value on update.
    #[serde(default)]
    pub cracked_from: Option<String>,
    /// Absent keeps the current value on update.
    #[serde(default)]
    pub from_secret_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Username {
    pub id: String,
    pub engagement_id: String,
    pub username: String,
    pub domain: Option<String>,
    pub source_host_id: Option<String>,
    pub source: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsernameInput {
    pub username: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub source_host_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessGrant {
    pub id: String,
    pub engagement_id: String,
    pub username_id: String,
    pub host_id: String,
    pub level: String,
    pub via: String,
    pub log_entry_id: Option<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessGrantInput {
    /// Ignored by `convert_to_access`, which derives the username from the credential.
    #[serde(default)]
    pub username_id: String,
    pub host_id: String,
    pub level: String,
    pub via: String,
    #[serde(default)]
    pub log_entry_id: Option<String>,
    /// Absent means now.
    #[serde(default)]
    pub at: Option<i64>,
}

fn invalid(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

/// Ruling F-R1: a secret keeps its spaces as entered; only leading and trailing line breaks go.
fn strip_line_breaks(s: &str) -> &str {
    s.trim_matches(|c| c == '\r' || c == '\n')
}

/// The stored form of a secret: a hash loses all edge whitespace (pasted hashes pick up stray spaces and
/// tabs), anything else follows F-R1.
fn clean_secret<'a>(kind: &str, s: &'a str) -> &'a str {
    if kind == "hash" {
        s.trim()
    } else {
        strip_line_breaks(s)
    }
}

fn blank_to_none(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

const CRED_COLS: &str = "id, engagement_id, type, username, domain, secret, hash_type, scope, local_host_id, \
     source_host_id, source, notes, crack_status, cracked_from, from_secret_id, created_at, updated_at";

fn cred_row(r: &Row) -> rusqlite::Result<Credential> {
    Ok(Credential {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        kind: r.get(2)?,
        username: r.get(3)?,
        domain: r.get(4)?,
        secret: r.get(5)?,
        hash_type: r.get(6)?,
        scope: r.get(7)?,
        local_host_id: r.get(8)?,
        source_host_id: r.get(9)?,
        source: r.get(10)?,
        notes: r.get(11)?,
        crack_status: r.get(12)?,
        cracked_from: r.get(13)?,
        from_secret_id: r.get(14)?,
        created_at: r.get(15)?,
        updated_at: r.get(16)?,
    })
}

/// Same rule as TS `defaultHashType` minus the identifyHash fallback: 32 hex is NTLM, `LM:NT` is pwdump.
fn derive_hash_type(secret: &str) -> Option<String> {
    let s = secret.trim();
    let hex = |p: &str| p.len() == 32 && p.chars().all(|c| c.is_ascii_hexdigit());
    if hex(s) {
        return Some("NTLM".into());
    }
    match s.split_once(':') {
        Some((a, b)) if hex(a) && hex(b) => Some("pwdump (LM:NT)".into()),
        _ => None,
    }
}

/// Identity of a credential inside one engagement: type, username, secret (hashes lower-cased),
/// domain, and the local host for local-scope credentials.
fn cred_key(c: &Credential) -> (String, String, String, String, String) {
    let secret = clean_secret(&c.kind, &c.secret);
    let secret = if c.kind == "hash" { secret.to_lowercase() } else { secret.to_string() };
    (
        c.kind.clone(),
        c.username.trim().to_lowercase(),
        secret,
        c.domain.as_deref().unwrap_or("").trim().to_lowercase(),
        if c.scope == "local" { c.local_host_id.clone().unwrap_or_default() } else { String::new() },
    )
}

/// An existing credential (other than `except_id`) with the same key. Empty secrets never match.
pub(crate) fn find_duplicate(conn: &Connection, probe: &Credential, except_id: &str) -> AppResult<Option<Credential>> {
    if clean_secret(&probe.kind, &probe.secret).is_empty() {
        return Ok(None);
    }
    let key = cred_key(probe);
    Ok(list(conn, &probe.engagement_id)?
        .into_iter()
        .find(|c| c.id != except_id && !clean_secret(&c.kind, &c.secret).is_empty() && cred_key(c) == key))
}

pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Credential>> {
    let mut st = conn.prepare(&format!(
        "SELECT {CRED_COLS} FROM credentials WHERE engagement_id = ?1 ORDER BY created_at, id"
    ))?;
    Ok(st.query_map([engagement_id], cred_row)?.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Credential> {
    match conn.query_row(&format!("SELECT {CRED_COLS} FROM credentials WHERE id = ?1"), [id], cred_row) {
        Ok(c) => Ok(c),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
}

fn check_cred_scope(conn: &Connection, engagement_id: &str, id: &str) -> AppResult<()> {
    let ok: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM credentials WHERE id = ?1 AND engagement_id = ?2)",
        params![id, engagement_id],
        |r| r.get(0),
    )?;
    if ok { Ok(()) } else { Err(AppError::NotFound) }
}

fn check_log_scope(conn: &Connection, engagement_id: &str, id: &str) -> AppResult<()> {
    let ok: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM log_entries WHERE id = ?1 AND engagement_id = ?2)",
        params![id, engagement_id],
        |r| r.get(0),
    )?;
    if ok { Ok(()) } else { Err(AppError::NotFound) }
}

/// Validates and normalises an input into a Credential (id and timestamps filled by the caller).
fn build(conn: &Connection, engagement_id: &str, i: CredentialInput) -> AppResult<Credential> {
    if !matches!(i.kind.as_str(), "password" | "hash" | "ticket" | "key" | "token" | "other") {
        return Err(invalid("type", "type must be password, hash, ticket, key, token or other"));
    }
    let scope = blank_to_none(i.scope.as_deref()).unwrap_or_else(|| "domain".into());
    if !matches!(scope.as_str(), "domain" | "local" | "app") {
        return Err(invalid("scope", "scope must be domain, local or app"));
    }
    let local_host_id = blank_to_none(i.local_host_id.as_deref());
    match (scope == "local", &local_host_id) {
        (true, None) => return Err(invalid("localHostId", "a local credential needs its host")),
        (false, Some(_)) => return Err(invalid("localHostId", "only a local credential has a host")),
        _ => {}
    }
    check_scope(conn, engagement_id, local_host_id.as_deref())?;
    let source_host_id = blank_to_none(i.source_host_id.as_deref());
    check_scope(conn, engagement_id, source_host_id.as_deref())?;
    let crack_status = blank_to_none(i.crack_status.as_deref());
    if let Some(s) = &crack_status {
        check_crack_status(s)?;
    }
    let cracked_from = blank_to_none(i.cracked_from.as_deref());
    if let Some(id) = &cracked_from {
        check_cred_scope(conn, engagement_id, id)?;
    }
    let from_secret_id = blank_to_none(i.from_secret_id.as_deref());
    if let Some(id) = &from_secret_id {
        check_cred_scope(conn, engagement_id, id)?;
    }
    let secret = clean_secret(&i.kind, &i.secret).to_string();
    let hash_type = if i.kind == "hash" {
        blank_to_none(i.hash_type.as_deref()).or_else(|| derive_hash_type(&secret))
    } else {
        None
    };
    Ok(Credential {
        id: String::new(),
        engagement_id: engagement_id.into(),
        username: i.username.trim().to_string(),
        domain: blank_to_none(i.domain.as_deref()),
        secret,
        hash_type,
        scope,
        local_host_id,
        source_host_id,
        source: blank_to_none(i.source.as_deref()),
        notes: blank_to_none(i.notes.as_deref()),
        crack_status,
        cracked_from,
        from_secret_id,
        kind: i.kind,
        created_at: 0,
        updated_at: 0,
    })
}

fn check_crack_status(s: &str) -> AppResult<()> {
    if matches!(s, "uncracked" | "cracked" | "uncrackable") {
        Ok(())
    } else {
        Err(invalid("crackStatus", "crack status must be uncracked, cracked or uncrackable"))
    }
}

fn insert(conn: &Connection, c: &Credential) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO credentials ({CRED_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)"),
        params![
            c.id, c.engagement_id, c.kind, c.username, c.domain, c.secret, c.hash_type, c.scope,
            c.local_host_id, c.source_host_id, c.source, c.notes, c.crack_status, c.cracked_from,
            c.from_secret_id, c.created_at, c.updated_at
        ],
    )?;
    Ok(())
}

/// Creates a credential, or returns the existing one with the same key (never an error for a duplicate).
pub fn create(conn: &Connection, engagement_id: &str, input: CredentialInput) -> AppResult<Credential> {
    check_scope(conn, engagement_id, None)?;
    let mut c = build(conn, engagement_id, input)?;
    if c.kind == "hash" && c.crack_status.is_none() {
        c.crack_status = Some("uncracked".into());
    }
    if let Some(existing) = find_duplicate(conn, &c, "")? {
        return Ok(existing);
    }
    let now = system_now_ms();
    c.id = uuid::Uuid::new_v4().to_string();
    c.created_at = now;
    c.updated_at = now;
    insert(conn, &c)?;
    get(conn, &c.id)
}

/// Full update. `sourceHostId`, `crackStatus`, `crackedFrom` and `fromSecretId` keep their current values
/// when absent.
pub fn update(conn: &Connection, id: &str, input: CredentialInput) -> AppResult<Credential> {
    let current = get(conn, id)?;
    let c = build(conn, &current.engagement_id, input)?;
    if find_duplicate(conn, &c, id)?.is_some() {
        return Err(invalid("secret", "A credential with these values already exists"));
    }
    for link in [&c.cracked_from, &c.from_secret_id] {
        if link.as_deref() == Some(id) {
            return Err(invalid("crackedFrom", "a credential cannot link to itself"));
        }
    }
    // Absent keeps the current status; a hash with none starts uncracked; a non-hash has none.
    let status = if c.kind == "hash" {
        c.crack_status.clone().or(current.crack_status.clone()).or(Some("uncracked".into()))
    } else {
        None
    };
    let source_host = c.source_host_id.clone().or(current.source_host_id.clone());
    let (cracked_from, from_secret) = (
        c.cracked_from.clone().or(current.cracked_from.clone()),
        c.from_secret_id.clone().or(current.from_secret_id.clone()),
    );
    conn.execute(
        "UPDATE credentials SET type=?2, username=?3, domain=?4, secret=?5, hash_type=?6, scope=?7, local_host_id=?8, \
         source_host_id=?9, source=?10, notes=?11, crack_status=?12, cracked_from=?13, from_secret_id=?14, updated_at=?15 \
         WHERE id=?1",
        params![
            id, c.kind, c.username, c.domain, c.secret, c.hash_type, c.scope, c.local_host_id, source_host,
            c.source, c.notes,
            status,
            cracked_from, from_secret, system_now_ms()
        ],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM credentials WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn set_crack_status(conn: &Connection, id: &str, status: &str) -> AppResult<Credential> {
    check_crack_status(status)?;
    let n = conn.execute(
        "UPDATE credentials SET crack_status=?2, updated_at=?3 WHERE id=?1",
        params![id, status, system_now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

/// Records a cracked hash: a password credential linked by `cracked_from`, and the hash marked cracked.
/// If the same password credential already exists it is returned instead of a second row.
pub fn crack(conn: &Connection, hash_id: &str, plaintext: &str) -> AppResult<Credential> {
    let hash = get(conn, hash_id)?;
    if hash.kind != "hash" {
        return Err(invalid("type", "only a hash can be cracked"));
    }
    let plaintext = strip_line_breaks(plaintext);
    if plaintext.trim().is_empty() {
        return Err(invalid("plaintext", "plaintext is required"));
    }
    let tx = conn.unchecked_transaction()?;
    let now = system_now_ms();
    let pw = Credential {
        id: uuid::Uuid::new_v4().to_string(),
        engagement_id: hash.engagement_id.clone(),
        kind: "password".into(),
        username: hash.username.clone(),
        domain: hash.domain.clone(),
        secret: plaintext.to_string(),
        hash_type: None,
        scope: hash.scope.clone(),
        local_host_id: hash.local_host_id.clone(),
        source_host_id: hash.source_host_id.clone(),
        source: hash.source.clone(),
        notes: None,
        crack_status: None,
        cracked_from: Some(hash.id.clone()),
        from_secret_id: None,
        created_at: now,
        updated_at: now,
    };
    let out = match find_duplicate(&tx, &pw, "")? {
        Some(existing) => {
            tx.execute(
                "UPDATE credentials SET cracked_from=?2, updated_at=?3 WHERE id=?1 AND cracked_from IS NULL",
                params![existing.id, hash.id, now],
            )?;
            get(&tx, &existing.id)?
        }
        None => {
            insert(&tx, &pw)?;
            get(&tx, &pw.id)?
        }
    };
    tx.execute("UPDATE credentials SET crack_status='cracked', updated_at=?2 WHERE id=?1", params![hash_id, now])?;
    tx.commit()?;
    Ok(out)
}

// ---------------------------------------------------------------- usernames

const USER_COLS: &str = "id, engagement_id, username, domain, source_host_id, source, created_at";

fn user_row(r: &Row) -> rusqlite::Result<Username> {
    Ok(Username {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        username: r.get(2)?,
        domain: r.get(3)?,
        source_host_id: r.get(4)?,
        source: r.get(5)?,
        created_at: r.get(6)?,
    })
}

pub fn usernames_list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Username>> {
    let mut st = conn.prepare(&format!(
        "SELECT {USER_COLS} FROM usernames WHERE engagement_id = ?1 ORDER BY lower(username), created_at, id"
    ))?;
    Ok(st.query_map([engagement_id], user_row)?.collect::<Result<Vec<_>, _>>()?)
}

fn username_get(conn: &Connection, id: &str) -> AppResult<Username> {
    match conn.query_row(&format!("SELECT {USER_COLS} FROM usernames WHERE id = ?1"), [id], user_row) {
        Ok(u) => Ok(u),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
}

fn username_find(conn: &Connection, engagement_id: &str, username: &str, domain: Option<&str>) -> AppResult<Option<Username>> {
    let r = conn.query_row(
        &format!(
            "SELECT {USER_COLS} FROM usernames WHERE engagement_id = ?1 AND lower(username) = lower(?2) \
             AND lower(ifnull(domain,'')) = lower(?3)"
        ),
        params![engagement_id, username, domain.unwrap_or("")],
        user_row,
    );
    match r {
        Ok(u) => Ok(Some(u)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Creates a username, or returns the existing one (case-insensitive on username and domain).
pub fn username_create(conn: &Connection, engagement_id: &str, input: UsernameInput) -> AppResult<Username> {
    check_scope(conn, engagement_id, None)?;
    let username = input.username.trim().to_string();
    if username.is_empty() {
        return Err(invalid("username", "username is required"));
    }
    let domain = blank_to_none(input.domain.as_deref());
    let source_host_id = blank_to_none(input.source_host_id.as_deref());
    check_scope(conn, engagement_id, source_host_id.as_deref())?;
    if let Some(u) = username_find(conn, engagement_id, &username, domain.as_deref())? {
        return Ok(u);
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        &format!("INSERT INTO usernames ({USER_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7)"),
        params![id, engagement_id, username, domain, source_host_id, blank_to_none(input.source.as_deref()), system_now_ms()],
    )?;
    username_get(conn, &id)
}

pub fn username_delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM usernames WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// ------------------------------------------------------------ access grants

const GRANT_COLS: &str = "id, engagement_id, username_id, host_id, level, via, log_entry_id, at";

fn grant_row(r: &Row) -> rusqlite::Result<AccessGrant> {
    Ok(AccessGrant {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        username_id: r.get(2)?,
        host_id: r.get(3)?,
        level: r.get(4)?,
        via: r.get(5)?,
        log_entry_id: r.get(6)?,
        at: r.get(7)?,
    })
}

pub fn grants_list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<AccessGrant>> {
    let mut st = conn.prepare(&format!(
        "SELECT {GRANT_COLS} FROM access_grants WHERE engagement_id = ?1 ORDER BY at, id"
    ))?;
    Ok(st.query_map([engagement_id], grant_row)?.collect::<Result<Vec<_>, _>>()?)
}

fn grant_insert(conn: &Connection, engagement_id: &str, username_id: &str, i: &AccessGrantInput) -> AppResult<AccessGrant> {
    if !matches!(i.level.as_str(), "user" | "admin" | "system") {
        return Err(invalid("level", "level must be user, admin or system"));
    }
    let via = i.via.trim();
    if via.is_empty() {
        return Err(invalid("via", "say how access was gained"));
    }
    check_scope(conn, engagement_id, Some(&i.host_id))?;
    let ok: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM usernames WHERE id = ?1 AND engagement_id = ?2)",
        params![username_id, engagement_id],
        |r| r.get(0),
    )?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let log_entry_id = blank_to_none(i.log_entry_id.as_deref());
    if let Some(l) = &log_entry_id {
        check_log_scope(conn, engagement_id, l)?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        &format!("INSERT INTO access_grants ({GRANT_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"),
        params![id, engagement_id, username_id, i.host_id, i.level, via, log_entry_id, i.at.unwrap_or_else(system_now_ms)],
    )?;
    Ok(conn.query_row(&format!("SELECT {GRANT_COLS} FROM access_grants WHERE id = ?1"), [&id], grant_row)?)
}

pub fn grant_create(conn: &Connection, engagement_id: &str, input: AccessGrantInput) -> AppResult<AccessGrant> {
    check_scope(conn, engagement_id, None)?;
    grant_insert(conn, engagement_id, &input.username_id, &input)
}

pub fn grant_delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM access_grants WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// For an old placeholder-secret credential: finds or creates its username, records the grant, and
/// deletes the credential, all or nothing. Returns the username.
pub fn convert_to_access(conn: &Connection, cred_id: &str, grant: AccessGrantInput) -> AppResult<Username> {
    let cred = get(conn, cred_id)?;
    let placeholder = matches!(cred.secret.trim().to_lowercase().as_str(), "" | "none" | "n/a" | "-");
    if cred.kind != "password" || !placeholder {
        return Err(invalid("secret", "only a placeholder password credential can be converted"));
    }
    if cred.username.trim().is_empty() {
        return Err(invalid("username", "the credential has no username to convert"));
    }
    let tx = conn.unchecked_transaction()?;
    let user = username_create(
        &tx,
        &cred.engagement_id,
        UsernameInput {
            username: cred.username.clone(),
            domain: cred.domain.clone(),
            source_host_id: cred.source_host_id.clone(),
            source: cred.source.clone(),
        },
    )?;
    grant_insert(&tx, &cred.engagement_id, &user.id, &grant)?;
    tx.execute("DELETE FROM credentials WHERE id = ?1", [cred_id])?;
    tx.commit()?;
    Ok(user)
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
        hosts::create(
            c,
            eid,
            HostInput { name: ip.into(), ip: Some(ip.into()), os: None, access: None, dual_homed: None, ad_set: None },
        )
        .unwrap()
        .id
    }

    fn cin(kind: &str, user: &str, secret: &str) -> CredentialInput {
        CredentialInput {
            kind: kind.into(),
            username: user.into(),
            domain: None,
            secret: secret.into(),
            hash_type: None,
            scope: None,
            local_host_id: None,
            source_host_id: None,
            source: None,
            notes: None,
            crack_status: None,
            cracked_from: None,
            from_secret_id: None,
        }
    }

    fn ginput(host_id: &str) -> AccessGrantInput {
        AccessGrantInput {
            username_id: String::new(),
            host_id: host_id.into(),
            level: "admin".into(),
            via: "psexec".into(),
            log_entry_id: None,
            at: Some(5),
        }
    }

    fn count(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn credential_round_trip_and_hash_type_derived() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let h = host(c, &e, "10.0.0.5");
        let mut i = cin("hash", " svc ", &"AB".repeat(16));
        i.domain = Some(" corp ".into());
        i.source_host_id = Some(h.clone());
        let made = create(c, &e, i).unwrap();
        assert_eq!(made.username, "svc");
        assert_eq!(made.domain.as_deref(), Some("corp"));
        assert_eq!(made.hash_type.as_deref(), Some("NTLM"));
        assert_eq!(made.scope, "domain");
        assert_eq!(made.crack_status.as_deref(), Some("uncracked"));
        assert_eq!(made.source_host_id.as_deref(), Some(h.as_str()));
        assert_eq!(list(c, &e).unwrap(), vec![made.clone()]);
        let pw = format!("{}:{}", "aa".repeat(16), "bb".repeat(16));
        let pwd = create(c, &e, cin("hash", "other", &pw)).unwrap();
        assert_eq!(pwd.hash_type.as_deref(), Some("pwdump (LM:NT)"));
        let unk = create(c, &e, cin("hash", "x", "not-a-hash")).unwrap();
        assert_eq!(unk.hash_type, None);
        let mut i2 = cin("hash", "svc", &"AB".repeat(16));
        i2.hash_type = Some("MD5".into());
        i2.notes = Some("n".into());
        let upd = update(c, &made.id, i2).unwrap();
        assert_eq!(upd.hash_type.as_deref(), Some("MD5"));
        assert_eq!(upd.notes.as_deref(), Some("n"));
        assert_eq!(upd.crack_status.as_deref(), Some("uncracked"));
        assert_eq!(field(create(c, &e, cin("bogus", "a", "b"))).0, "type");
        delete(c, &made.id).unwrap();
        assert_eq!(delete(c, &made.id), Err(AppError::NotFound));
        assert_eq!(list(c, &e).unwrap().len(), 2);
    }

    fn field<T: std::fmt::Debug>(r: AppResult<T>) -> (String, String) {
        match r {
            Err(AppError::Validation { field, message }) => (field, message),
            o => panic!("expected validation, got {o:?}"),
        }
    }

    #[test]
    fn duplicate_credential_returns_existing() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let e2 = eng(c, "b");
        let first = create(c, &e, cin("hash", "Admin", &"AB".repeat(16))).unwrap();
        let again = create(c, &e, cin("hash", "admin", &"ab".repeat(16))).unwrap();
        assert_eq!(first.id, again.id);
        assert_eq!(list(c, &e).unwrap().len(), 1);
        // passwords are case-sensitive
        let p1 = create(c, &e, cin("password", "u", "Pass")).unwrap();
        let p2 = create(c, &e, cin("password", "u", "pass")).unwrap();
        assert_ne!(p1.id, p2.id);
        // another engagement stores its own
        let other = create(c, &e2, cin("hash", "admin", &"ab".repeat(16))).unwrap();
        assert_ne!(other.id, first.id);
        // different domain is a different credential
        let mut d = cin("password", "u", "Pass");
        d.domain = Some("corp".into());
        assert_ne!(create(c, &e, d).unwrap().id, p1.id);
        // local credentials are per host
        let (h1, h2) = (host(c, &e, "10.0.0.1"), host(c, &e, "10.0.0.2"));
        let local = |h: &str| {
            let mut i = cin("password", "root", "toor");
            i.scope = Some("local".into());
            i.local_host_id = Some(h.into());
            i
        };
        let l1 = create(c, &e, local(&h1)).unwrap();
        assert_eq!(create(c, &e, local(&h1)).unwrap().id, l1.id);
        assert_ne!(create(c, &e, local(&h2)).unwrap().id, l1.id);
        // a placeholder with no secret never dedupes
        let a = create(c, &e, cin("password", "ph", "")).unwrap();
        let b = create(c, &e, cin("password", "ph", "")).unwrap();
        assert_ne!(a.id, b.id);
        // update colliding with another row is a validation error
        assert_eq!(field(update(c, &p2.id, cin("password", "u", "Pass"))).0, "secret");
    }

    #[test]
    fn local_scope_requires_local_host() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let e2 = eng(c, "b");
        let h = host(c, &e, "10.0.0.1");
        let foreign = host(c, &e2, "10.0.0.9");
        let mut i = cin("password", "root", "toor");
        i.scope = Some("local".into());
        assert_eq!(field(create(c, &e, i.clone())).0, "localHostId");
        i.local_host_id = Some(foreign.clone());
        assert_eq!(create(c, &e, i.clone()), Err(AppError::NotFound));
        i.local_host_id = Some(h.clone());
        assert_eq!(create(c, &e, i).unwrap().local_host_id.as_deref(), Some(h.as_str()));
        let mut dom = cin("password", "u", "p");
        dom.local_host_id = Some(h.clone());
        assert_eq!(field(create(c, &e, dom)).0, "localHostId");
        let mut src = cin("password", "u", "p");
        src.source_host_id = Some(foreign);
        assert_eq!(create(c, &e, src), Err(AppError::NotFound));
    }

    #[test]
    fn crack_creates_linked_password_and_marks_hash() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let mut hi = cin("hash", "svc", &"ab".repeat(16));
        hi.domain = Some("corp".into());
        let hash = create(c, &e, hi).unwrap();
        let pw = crack(c, &hash.id, "Summer2024!\r\n").unwrap();
        assert_eq!(pw.kind, "password");
        assert_eq!(pw.secret, "Summer2024!");
        assert_eq!((pw.username.as_str(), pw.domain.as_deref()), ("svc", Some("corp")));
        assert_eq!(pw.cracked_from.as_deref(), Some(hash.id.as_str()));
        assert_eq!(get(c, &hash.id).unwrap().crack_status.as_deref(), Some("cracked"));
        assert_eq!(list(c, &e).unwrap().len(), 2);
        // cracking again does not duplicate the password
        assert_eq!(crack(c, &hash.id, "Summer2024!").unwrap().id, pw.id);
        // an existing matching password without a link gains it
        let h2 = create(c, &e, cin("hash", "bob", &"cd".repeat(16))).unwrap();
        let loose = create(c, &e, cin("password", "bob", "Winter1!")).unwrap();
        assert_eq!(loose.cracked_from, None);
        let linked = crack(c, &h2.id, "Winter1!").unwrap();
        assert_eq!((linked.id.as_str(), linked.cracked_from.as_deref()), (loose.id.as_str(), Some(h2.id.as_str())));
        delete(c, &h2.id).unwrap();
        delete(c, &loose.id).unwrap();
        assert_eq!(field(crack(c, &hash.id, "  ")).0, "plaintext");
        assert_eq!(field(crack(c, &pw.id, "x")).0, "type");
        // deleting the hash leaves the password, unlinked
        delete(c, &hash.id).unwrap();
        assert_eq!(get(c, &pw.id).unwrap().cracked_from, None);
        assert_eq!(set_crack_status(c, &pw.id, "uncrackable").unwrap().crack_status.as_deref(), Some("uncrackable"));
        assert_eq!(field(set_crack_status(c, &pw.id, "x")).0, "crackStatus");
    }

    #[test]
    fn update_keeps_fields_the_form_does_not_send() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let (src, local) = (host(c, &e, "10.0.0.5"), host(c, &e, "10.0.0.6"));
        let hash = create(c, &e, cin("hash", "svc", &"ab".repeat(16))).unwrap();
        let parent = create(c, &e, cin("password", "svc", "Pw1!")).unwrap();
        let mut i = cin("password", "svc", "Pw2!");
        i.source_host_id = Some(src.clone());
        i.source = Some("lsass".into());
        i.cracked_from = Some(hash.id.clone());
        i.from_secret_id = Some(parent.id.clone());
        let made = create(c, &e, i).unwrap();
        // an edit of the notes alone (no sourceHostId, crackedFrom or fromSecretId sent) keeps them
        let mut edit = cin("password", "svc", "Pw2!");
        edit.source = Some("lsass".into());
        edit.notes = Some("n".into());
        let u = update(c, &made.id, edit).unwrap();
        assert_eq!(u.notes.as_deref(), Some("n"));
        assert_eq!(u.source_host_id.as_deref(), Some(src.as_str()));
        assert_eq!(u.source.as_deref(), Some("lsass"));
        assert_eq!(u.cracked_from.as_deref(), Some(hash.id.as_str()));
        assert_eq!(u.from_secret_id.as_deref(), Some(parent.id.as_str()));
        // a sent sourceHostId replaces it
        let mut moved = cin("password", "svc", "Pw2!");
        moved.source_host_id = Some(local.clone());
        assert_eq!(update(c, &made.id, moved).unwrap().source_host_id.as_deref(), Some(local.as_str()));
    }

    #[test]
    fn secret_keeps_spaces_and_loses_line_breaks() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        assert_eq!(create(c, &e, cin("password", "a", " pa ss ")).unwrap().secret, " pa ss ");
        let nl = create(c, &e, cin("password", "b", "pass\n")).unwrap();
        assert_eq!(nl.secret, "pass");
        // dedupe compares the stored form: "pass\r\n" is "pass", " pass" is not
        assert_eq!(create(c, &e, cin("password", "b", "\r\npass\r\n")).unwrap().id, nl.id);
        assert_ne!(create(c, &e, cin("password", "b", " pass")).unwrap().id, nl.id);
        let hash = create(c, &e, cin("hash", "svc", &"ab".repeat(16))).unwrap();
        assert_eq!(crack(c, &hash.id, " Sum mer \n").unwrap().secret, " Sum mer ");
    }

    #[test]
    fn hash_secret_edge_spaces_are_trimmed_and_dedupe() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let nt = "ab".repeat(16);
        let first = create(c, &e, cin("hash", "svc", &format!("{nt} "))).unwrap();
        assert_eq!(first.secret, nt);
        assert_eq!(create(c, &e, cin("hash", "svc", &format!("\t {nt}\r\n"))).unwrap().id, first.id);
        assert_eq!(create(c, &e, cin("hash", "svc", &nt)).unwrap().id, first.id);
        // a cracked plaintext is a password and keeps its spaces
        assert_eq!(crack(c, &first.id, " Sum mer ").unwrap().secret, " Sum mer ");
    }

    #[test]
    fn update_keeps_crack_status_and_rejects_self_links() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let hash = create(c, &e, cin("hash", "svc", &"ab".repeat(16))).unwrap();
        crack(c, &hash.id, "Pw1!").unwrap();
        let mut edit = cin("hash", "svc", &"ab".repeat(16));
        edit.notes = Some("n".into());
        let u = update(c, &hash.id, edit.clone()).unwrap();
        assert_eq!((u.crack_status.as_deref(), u.notes.as_deref()), (Some("cracked"), Some("n")));
        set_crack_status(c, &hash.id, "uncrackable").unwrap();
        edit.domain = Some("corp".into());
        let u = update(c, &hash.id, edit.clone()).unwrap();
        assert_eq!((u.crack_status.as_deref(), u.domain.as_deref()), (Some("uncrackable"), Some("corp")));
        edit.crack_status = Some("uncracked".into());
        assert_eq!(update(c, &hash.id, edit.clone()).unwrap().crack_status.as_deref(), Some("uncracked"));
        // retyping away from hash clears the status
        let pw = update(c, &hash.id, cin("password", "svc", "x")).unwrap();
        assert_eq!(pw.crack_status, None);
        let mut selfie = cin("password", "svc", "x");
        selfie.cracked_from = Some(hash.id.clone());
        assert_eq!(field(update(c, &hash.id, selfie)).0, "crackedFrom");
    }

    #[test]
    fn convert_refuses_real_secret() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let h = host(c, &e, "10.0.0.5");
        let cred = create(c, &e, cin("password", "alice", "Real1!")).unwrap();
        c.execute(
            "INSERT INTO cred_attempts (id,engagement_id,cred_id,host_id,service,result,auth_mode,at) \
             VALUES ('a1',?1,?2,?3,'smb','valid','domain',1)",
            params![e, cred.id, h],
        )
        .unwrap();
        assert_eq!(field(convert_to_access(c, &cred.id, ginput(&h))).0, "secret");
        let hash = create(c, &e, cin("hash", "bob", &"ab".repeat(16))).unwrap();
        assert_eq!(field(convert_to_access(c, &hash.id, ginput(&h))).0, "secret");
        assert_eq!(get(c, &cred.id).unwrap().secret, "Real1!");
        assert_eq!(count(c, "SELECT count(*) FROM cred_attempts"), 1);
        assert_eq!(usernames_list(c, &e).unwrap().len(), 0);
        for ph in ["None", "n/a", "-"] {
            let p = create(c, &e, cin("password", &format!("u{ph}"), ph)).unwrap();
            convert_to_access(c, &p.id, ginput(&h)).unwrap();
        }
    }

    #[test]
    fn convert_to_access_moves_to_username_grant() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let h = host(c, &e, "10.0.0.5");
        let mut ph = cin("password", "Alice", "");
        ph.domain = Some("corp".into());
        let cred = create(c, &e, ph).unwrap();
        let existing = username_create(
            c,
            &e,
            UsernameInput { username: "alice".into(), domain: Some("CORP".into()), source_host_id: None, source: None },
        )
        .unwrap();
        let u = convert_to_access(c, &cred.id, ginput(&h)).unwrap();
        assert_eq!(u.id, existing.id);
        assert_eq!(list(c, &e).unwrap().len(), 0);
        let grants = grants_list(c, &e).unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!((grants[0].username_id.as_str(), grants[0].level.as_str(), grants[0].at), (u.id.as_str(), "admin", 5));
        // no pre-existing username: one is created
        let cred2 = create(c, &e, cin("password", "bob", "")).unwrap();
        let u2 = convert_to_access(c, &cred2.id, ginput(&h)).unwrap();
        assert_eq!(u2.username, "bob");
        // a failing grant rolls everything back
        let cred3 = create(c, &e, cin("password", "carol", "")).unwrap();
        let mut bad = ginput(&h);
        bad.level = "god".into();
        assert_eq!(field(convert_to_access(c, &cred3.id, bad)).0, "level");
        assert_eq!(get(c, &cred3.id).unwrap().id, cred3.id);
        assert_eq!(usernames_list(c, &e).unwrap().len(), 2);
        // a nameless credential cannot convert
        let anon = create(c, &e, cin("password", "", "")).unwrap();
        assert_eq!(field(convert_to_access(c, &anon.id, ginput(&h))).0, "username");
    }

    #[test]
    fn deleting_credential_cascades_attempts() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let h = host(c, &e, "10.0.0.5");
        let cred = create(c, &e, cin("password", "u", "p")).unwrap();
        c.execute(
            "INSERT INTO cred_attempts (id,engagement_id,cred_id,host_id,service,result,auth_mode,at) \
             VALUES ('a1',?1,?2,?3,'smb','valid','domain',1)",
            params![e, cred.id, h],
        )
        .unwrap();
        // unique on (cred, username, host, service, mode), including a null username
        let dup = c.execute(
            "INSERT INTO cred_attempts (id,engagement_id,cred_id,host_id,service,result,auth_mode,at) \
             VALUES ('a2',?1,?2,?3,'smb','failed','domain',2)",
            params![e, cred.id, h],
        );
        assert!(dup.is_err());
        delete(c, &cred.id).unwrap();
        assert_eq!(count(c, "SELECT count(*) FROM cred_attempts"), 0);
    }

    #[test]
    fn deleting_host_cascades_grants_and_clears_local_host() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let h = host(c, &e, "10.0.0.5");
        let u = username_create(c, &e, UsernameInput { username: "a".into(), domain: None, source_host_id: Some(h.clone()), source: None }).unwrap();
        grant_create(c, &e, AccessGrantInput { username_id: u.id.clone(), ..ginput(&h) }).unwrap();
        let mut li = cin("password", "root", "toor");
        li.scope = Some("local".into());
        li.local_host_id = Some(h.clone());
        li.source_host_id = Some(h.clone());
        let cred = create(c, &e, li).unwrap();
        hosts::delete(c, &h).unwrap();
        assert_eq!(grants_list(c, &e).unwrap().len(), 0);
        let after = get(c, &cred.id).unwrap();
        assert_eq!((after.local_host_id, after.source_host_id), (None, None));
        assert_eq!(usernames_list(c, &e).unwrap()[0].source_host_id, None);
    }

    #[test]
    fn deleting_log_entry_keeps_grant_without_proof() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let h = host(c, &e, "10.0.0.5");
        c.execute(
            "INSERT INTO log_entries (id,engagement_id,kind,title,content,at,created_at,updated_at) VALUES ('l1',?1,'command','t','c',1,1,1)",
            [&e],
        )
        .unwrap();
        let u = username_create(c, &e, UsernameInput { username: "a".into(), domain: None, source_host_id: None, source: None }).unwrap();
        let mut gi = ginput(&h);
        gi.username_id = u.id.clone();
        gi.log_entry_id = Some("l1".into());
        let g = grant_create(c, &e, gi.clone()).unwrap();
        assert_eq!(g.log_entry_id.as_deref(), Some("l1"));
        c.execute("DELETE FROM log_entries WHERE id='l1'", []).unwrap();
        let kept = grants_list(c, &e).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].log_entry_id, None);
        // validation
        gi.log_entry_id = Some("nope".into());
        assert_eq!(grant_create(c, &e, gi.clone()), Err(AppError::NotFound));
        gi.log_entry_id = None;
        gi.via = "  ".into();
        assert_eq!(field(grant_create(c, &e, gi)).0, "via");
        grant_delete(c, &g.id).unwrap();
        assert_eq!(grant_delete(c, &g.id), Err(AppError::NotFound));
    }

    #[test]
    fn username_unique_case_insensitive() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let e2 = eng(c, "b");
        let mk = |u: &str, d: Option<&str>| UsernameInput {
            username: u.into(),
            domain: d.map(str::to_string),
            source_host_id: None,
            source: None,
        };
        let a = username_create(c, &e, mk("Alice", Some("CORP"))).unwrap();
        assert_eq!(username_create(c, &e, mk("alice", Some("corp"))).unwrap().id, a.id);
        assert_ne!(username_create(c, &e, mk("alice", None)).unwrap().id, a.id);
        assert_ne!(username_create(c, &e2, mk("alice", Some("corp"))).unwrap().id, a.id);
        assert_eq!(usernames_list(c, &e).unwrap().len(), 2);
        assert_eq!(field(username_create(c, &e, mk("  ", None))).0, "username");
        // the index itself enforces it
        let raw = c.execute(
            "INSERT INTO usernames (id,engagement_id,username,domain,created_at) VALUES ('x',?1,'ALICE','Corp',1)",
            [&e],
        );
        assert!(raw.is_err());
        username_delete(c, &a.id).unwrap();
        assert_eq!(username_delete(c, &a.id), Err(AppError::NotFound));
    }

    #[test]
    fn host_access_reviewed_stamps() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let h = host(c, &e, "10.0.0.5");
        assert_eq!(hosts::get(c, &h).unwrap().access_reviewed_at, None);
        assert!(hosts::mark_access_reviewed(c, &h).unwrap().access_reviewed_at.is_some());
        assert_eq!(hosts::mark_access_reviewed(c, "nope"), Err(AppError::NotFound));
    }
}
