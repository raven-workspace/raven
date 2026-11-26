//! Credentials, usernames and access grants. Everything belongs to one engagement.
//!
//! Secrets are stored as entered (the database is encrypted); masking is a UI concern.

use crate::db::{blank_to_none, check_in_engagement, check_scope, delete_by_id, now_ms};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// A username: a name, an optional domain, and its scope. `domain` is a domain account, `local` an account on one host
/// (`local_host_id`, cleared when that host is deleted), `unknown` either; usernames stored before scope existed are
/// unknown. Scope decides identity (`username_find`).
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
    pub scope: String,
    pub local_host_id: Option<String>,
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
    /// `domain`, `local` or `unknown`; absent means `unknown`.
    #[serde(default)]
    pub scope: Option<String>,
    /// Required iff scope is `local`.
    #[serde(default)]
    pub local_host_id: Option<String>,
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

/// The kind of a hash captured from a challenge or a ticket (Kerberoast, AS-REP, NetNTLM). Such a hash differs on
/// every capture but cracks to the same password, so the account and the kind identify it, not the text. NT and
/// stored hashes have none. Agrees with TS `hashCaptureKind`.
fn capture_kind(c: &Credential) -> Option<&'static str> {
    if c.kind != "hash" {
        return None;
    }
    let s = c.secret.trim();
    let starts = |s: &str, p: &str| s.get(..p.len()).is_some_and(|h| h.eq_ignore_ascii_case(p));
    if starts(s, "$krb5tgs$") {
        return Some("krb5tgs");
    }
    if starts(s, "$krb5asrep$") {
        return Some("krb5asrep");
    }
    if c.hash_type.as_deref().is_some_and(|t| starts(t, "netntlm")) || is_netntlm_shape(s) {
        return Some("netntlm");
    }
    None
}

/// `user::domain:<16 hex>:...`, the shape Responder and friends print for a NetNTLM capture.
fn is_netntlm_shape(s: &str) -> bool {
    let Some(i) = s.find("::") else { return false };
    let user = &s[..i];
    if user.is_empty() || user.chars().any(|c| c == ':' || c.is_whitespace()) {
        return false;
    }
    let Some((_, rest)) = s[i + 2..].split_once(':') else { return false };
    rest.get(..16).is_some_and(|h| h.chars().all(|c| c.is_ascii_hexdigit())) && rest.as_bytes().get(16) == Some(&b':')
}

/// The domain-free part of a credential's identity inside one engagement: type, username, secret (hashes
/// lower-cased, a captured hash by its kind), and the local host for local-scope credentials. Two credentials are
/// the same when their keys are equal and their domains are the same domain.
fn cred_key(c: &Credential) -> (String, String, String, String) {
    let secret = match capture_kind(c) {
        Some(kind) => format!("capture:{kind}"),
        None if c.kind == "hash" => clean_secret(&c.kind, &c.secret).to_lowercase(),
        None => clean_secret(&c.kind, &c.secret).to_string(),
    };
    (
        c.kind.clone(),
        c.username.trim().to_lowercase(),
        secret,
        if c.scope == "local" { c.local_host_id.clone().unwrap_or_default() } else { String::new() },
    )
}

/// Whether two domain spellings name the same domain, inside an engagement whose own domain is `engagement_domain`
/// (an FQDN such as `corp.lan`). They are the same when equal ignoring case and surrounding whitespace, or when one is
/// the engagement's domain and the other its first label (`CORP` for `corp.lan`). With no engagement domain only
/// equal spellings match, and a NetBIOS name never matches any other FQDN (`CORP` is not `corp.local`, `WEB01` is not
/// `web01.corp.lan`). A blank domain matches only a blank one.
pub fn same_domain(engagement_domain: Option<&str>, a: Option<&str>, b: Option<&str>) -> bool {
    let norm = |s: Option<&str>| s.unwrap_or("").trim().to_lowercase();
    let (x, y) = (norm(a), norm(b));
    if x == y {
        return true;
    }
    let fqdn = norm(engagement_domain);
    let Some((label, _)) = fqdn.split_once('.') else { return false };
    if label.is_empty() || x.is_empty() || y.is_empty() {
        return false;
    }
    (x == fqdn && y == label) || (y == fqdn && x == label)
}

/// The engagement's own domain, the anchor of `same_domain`. None when it has none (or there is no such engagement).
pub(crate) fn engagement_domain(conn: &Connection, engagement_id: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT domain FROM engagements WHERE id = ?1", [engagement_id], |r| r.get::<_, Option<String>>(0))
        .optional()?
        .flatten())
}

/// For each pair of domain spellings, whether they are the same domain in the engagement (`same_domain`). Lets the
/// frontend ask the store instead of keeping its own copy of the rule.
pub fn same_domains(conn: &Connection, engagement_id: &str, pairs: &[(Option<String>, Option<String>)]) -> AppResult<Vec<bool>> {
    check_scope(conn, engagement_id, None)?;
    let anchor = engagement_domain(conn, engagement_id)?;
    Ok(pairs.iter().map(|(a, b)| same_domain(anchor.as_deref(), a.as_deref(), b.as_deref())).collect())
}

/// Of `rows`, the first whose domain is the same domain as `domain`, preferring an equal spelling so that of
/// duplicates stored before the store owned identity, the one spelled the same wins.
pub(crate) fn pick_same_domain<T>(rows: Vec<T>, domain_of: impl Fn(&T) -> Option<&str>, anchor: Option<&str>, domain: Option<&str>) -> Option<T> {
    let at = rows
        .iter()
        .position(|r| same_domain(None, domain_of(r), domain))
        .or_else(|| rows.iter().position(|r| same_domain(anchor, domain_of(r), domain)))?;
    rows.into_iter().nth(at)
}

/// An existing credential (other than `except_id`) that is the same credential: an equal key and the same domain.
/// Empty secrets never match.
pub(crate) fn find_duplicate(conn: &Connection, probe: &Credential, except_id: &str) -> AppResult<Option<Credential>> {
    if clean_secret(&probe.kind, &probe.secret).is_empty() {
        return Ok(None);
    }
    let key = cred_key(probe);
    let anchor = engagement_domain(conn, &probe.engagement_id)?;
    let candidates: Vec<Credential> = list(conn, &probe.engagement_id)?
        .into_iter()
        .filter(|c| c.id != except_id && !clean_secret(&c.kind, &c.secret).is_empty() && cred_key(c) == key)
        .collect();
    Ok(pick_same_domain(candidates, |c| c.domain.as_deref(), anchor.as_deref(), probe.domain.as_deref()))
}

/// Password reuse: for a new local credential (`input`), the stored local credential for another host with the same
/// account and secret. The name matches ignoring case and the secret by the credential identity rule: exactly for a
/// password, the hash value ignoring case for a hash. A captured hash (Kerberoast, AS-REP, NetNTLM) is never reuse, and
/// neither is a stored local credential whose host was deleted.
pub(crate) fn find_reused_local(conn: &Connection, engagement_id: &str, input: &CredentialInput) -> AppResult<Option<Credential>> {
    let probe = build(conn, engagement_id, input.clone(), None)?;
    let reusable = |c: &Credential| {
        c.scope == "local"
            && c.local_host_id.is_some()
            && matches!(c.kind.as_str(), "password" | "hash")
            && capture_kind(c).is_none()
            && !clean_secret(&c.kind, &c.secret).is_empty()
    };
    if !reusable(&probe) {
        return Ok(None);
    }
    // The credential's key without its host.
    let account = |c: &Credential| {
        let (kind, user, secret, _) = cred_key(c);
        (kind, user, secret)
    };
    Ok(list(conn, engagement_id)?
        .into_iter()
        .find(|c| reusable(c) && c.local_host_id != probe.local_host_id && account(c) == account(&probe)))
}

/// Whether two credentials are the same credential, in an engagement whose domain is `anchor`.
fn same_credential(anchor: Option<&str>, a: &Credential, b: &Credential) -> bool {
    cred_key(a) == cred_key(b) && same_domain(anchor, a.domain.as_deref(), b.domain.as_deref())
}

pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Credential>> {
    let mut st = conn.prepare(&format!(
        "SELECT {CRED_COLS} FROM credentials WHERE engagement_id = ?1 ORDER BY created_at, id"
    ))?;
    Ok(st.query_map([engagement_id], cred_row)?.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Credential> {
    conn.query_row(&format!("SELECT {CRED_COLS} FROM credentials WHERE id = ?1"), [id], cred_row).optional()?.ok_or(AppError::NotFound)
}

/// Validates and normalises an input into a Credential (id and timestamps filled by the caller). `current` is the
/// stored credential on update, None on create.
fn build(conn: &Connection, engagement_id: &str, i: CredentialInput, current: Option<&Credential>) -> AppResult<Credential> {
    if !matches!(i.kind.as_str(), "password" | "hash" | "ticket" | "key" | "token" | "other") {
        return Err(AppError::validation("type", "type must be password, hash, ticket, key, token or other"));
    }
    let scope = blank_to_none(i.scope.as_deref()).unwrap_or_else(|| "domain".into());
    if !matches!(scope.as_str(), "domain" | "local" | "app") {
        return Err(AppError::validation("scope", "scope must be domain, local or app"));
    }
    let local_host_id = blank_to_none(i.local_host_id.as_deref());
    // A local credential needs its host only when scope or host is being set or changed: deleting a host leaves its
    // local credentials with none (the schema's set-null), and an edit that keeps scope and host stays allowed.
    let keeps_scope_and_host = current.is_some_and(|c| c.scope == scope && c.local_host_id == local_host_id);
    match (scope == "local", &local_host_id) {
        (true, None) if !keeps_scope_and_host => {
            return Err(AppError::validation("localHostId", "a local credential needs its host"))
        }
        (false, Some(_)) => return Err(AppError::validation("localHostId", "only a local credential has a host")),
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
        check_in_engagement(conn, "credentials", engagement_id, id)?;
    }
    let from_secret_id = blank_to_none(i.from_secret_id.as_deref());
    if let Some(id) = &from_secret_id {
        check_in_engagement(conn, "credentials", engagement_id, id)?;
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
        Err(AppError::validation("crackStatus", "crack status must be uncracked, cracked or uncrackable"))
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

/// What `create` returns: the stored credential, and whether it was stored already (the same credential), in which
/// case nothing was written.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedCredential {
    pub credential: Credential,
    pub existed: bool,
}

/// Creates a credential, or returns the stored one that is the same credential (never an error for a duplicate).
pub fn create(conn: &Connection, engagement_id: &str, input: CredentialInput) -> AppResult<CreatedCredential> {
    check_scope(conn, engagement_id, None)?;
    let mut c = build(conn, engagement_id, input, None)?;
    if c.kind == "hash" && c.crack_status.is_none() {
        c.crack_status = Some("uncracked".into());
    }
    if let Some(existing) = find_duplicate(conn, &c, "")? {
        return Ok(CreatedCredential { credential: existing, existed: true });
    }
    let now = now_ms();
    c.id = uuid::Uuid::new_v4().to_string();
    c.created_at = now;
    c.updated_at = now;
    insert(conn, &c)?;
    Ok(CreatedCredential { credential: get(conn, &c.id)?, existed: false })
}

/// Full update. `sourceHostId`, `crackStatus`, `crackedFrom` and `fromSecretId` keep their current values
/// when absent.
pub fn update(conn: &Connection, id: &str, input: CredentialInput) -> AppResult<Credential> {
    let current = get(conn, id)?;
    let c = build(conn, &current.engagement_id, input, Some(&current))?;
    // An edit that keeps the credential's identity is always allowed, so a duplicate stored before the store owned
    // identity stays editable; one that makes it another stored credential is refused.
    let anchor = engagement_domain(conn, &current.engagement_id)?;
    if !same_credential(anchor.as_deref(), &current, &c) && find_duplicate(conn, &c, id)?.is_some() {
        return Err(AppError::validation("secret", "A credential with these values already exists"));
    }
    for link in [&c.cracked_from, &c.from_secret_id] {
        if link.as_deref() == Some(id) {
            return Err(AppError::validation("crackedFrom", "a credential cannot link to itself"));
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
            cracked_from, from_secret, now_ms()
        ],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    delete_by_id(conn, "credentials", id)
}

pub fn set_crack_status(conn: &Connection, id: &str, status: &str) -> AppResult<Credential> {
    check_crack_status(status)?;
    let n = conn.execute(
        "UPDATE credentials SET crack_status=?2, updated_at=?3 WHERE id=?1",
        params![id, status, now_ms()],
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
        return Err(AppError::validation("type", "only a hash can be cracked"));
    }
    let plaintext = strip_line_breaks(plaintext);
    if plaintext.trim().is_empty() {
        return Err(AppError::validation("plaintext", "plaintext is required"));
    }
    let tx = crate::db::atomic(conn)?;
    let now = now_ms();
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

const USER_COLS: &str = "id, engagement_id, username, domain, source_host_id, source, created_at, scope, local_host_id";

fn user_row(r: &Row) -> rusqlite::Result<Username> {
    Ok(Username {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        username: r.get(2)?,
        domain: r.get(3)?,
        source_host_id: r.get(4)?,
        source: r.get(5)?,
        created_at: r.get(6)?,
        scope: r.get(7)?,
        local_host_id: r.get(8)?,
    })
}

pub fn usernames_list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Username>> {
    let mut st = conn.prepare(&format!(
        "SELECT {USER_COLS} FROM usernames WHERE engagement_id = ?1 ORDER BY lower(username), created_at, id"
    ))?;
    Ok(st.query_map([engagement_id], user_row)?.collect::<Result<Vec<_>, _>>()?)
}

fn username_get(conn: &Connection, id: &str) -> AppResult<Username> {
    conn.query_row(&format!("SELECT {USER_COLS} FROM usernames WHERE id = ?1"), [id], user_row).optional()?.ok_or(AppError::NotFound)
}

/// A username input's scope and host, checked: absent scope is `unknown`; a local username has a host, and only a
/// local one has.
fn username_scope(i: &UsernameInput) -> AppResult<(String, Option<String>)> {
    let scope = blank_to_none(i.scope.as_deref()).unwrap_or_else(|| "unknown".into());
    if !matches!(scope.as_str(), "domain" | "local" | "unknown") {
        return Err(AppError::validation("scope", "scope must be domain, local or unknown"));
    }
    let local_host_id = blank_to_none(i.local_host_id.as_deref());
    match (scope == "local", &local_host_id) {
        (true, None) => Err(AppError::validation("localHostId", "a local username needs its host")),
        (false, Some(_)) => Err(AppError::validation("localHostId", "only a local username has a host")),
        _ => Ok((scope, local_host_id)),
    }
}

/// The stored username that is the same username: the name equal ignoring case, the same scope, and
/// - unknown: the same domain, where a blank domain matches only a blank one;
/// - domain: the same domain, where a blank domain stands for the engagement's own (and is only blank with none set);
/// - local: the same host.
///
/// Unknown and domain usernames never match each other, and a local one matches neither.
fn username_find(
    conn: &Connection,
    engagement_id: &str,
    username: &str,
    domain: Option<&str>,
    scope: &str,
    local_host_id: Option<&str>,
) -> AppResult<Option<Username>> {
    let mut st = conn.prepare(&format!(
        "SELECT {USER_COLS} FROM usernames WHERE engagement_id = ?1 AND lower(username) = lower(?2) AND scope = ?3 \
         ORDER BY created_at, id"
    ))?;
    let rows = st.query_map(params![engagement_id, username, scope], user_row)?.collect::<Result<Vec<_>, _>>()?;
    if scope == "local" {
        return Ok(rows.into_iter().find(|u| local_host_id.is_some() && u.local_host_id.as_deref() == local_host_id));
    }
    let anchor = engagement_domain(conn, engagement_id)?;
    if scope == "unknown" {
        return Ok(pick_same_domain(rows, |u| u.domain.as_deref(), anchor.as_deref(), domain));
    }
    // A domain username with no domain written is in the engagement's domain.
    let own = |d: Option<&str>| blank_to_none(d).or_else(|| blank_to_none(anchor.as_deref()));
    let keyed: Vec<(Option<String>, Username)> = rows.into_iter().map(|u| (own(u.domain.as_deref()), u)).collect();
    Ok(pick_same_domain(keyed, |(d, _)| d.as_deref(), anchor.as_deref(), own(domain).as_deref()).map(|(_, u)| u))
}

/// Creates a username, or returns the stored one that is the same username (`username_find`). A local username keeps
/// no domain: its host says whose account it is.
pub fn username_create(conn: &Connection, engagement_id: &str, input: UsernameInput) -> AppResult<Username> {
    check_scope(conn, engagement_id, None)?;
    let username = input.username.trim().to_string();
    if username.is_empty() {
        return Err(AppError::validation("username", "username is required"));
    }
    let (scope, local_host_id) = username_scope(&input)?;
    check_scope(conn, engagement_id, local_host_id.as_deref())?;
    let domain = if scope == "local" { None } else { blank_to_none(input.domain.as_deref()) };
    let source_host_id = blank_to_none(input.source_host_id.as_deref());
    check_scope(conn, engagement_id, source_host_id.as_deref())?;
    if let Some(u) = username_find(conn, engagement_id, &username, domain.as_deref(), &scope, local_host_id.as_deref())? {
        return Ok(u);
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        &format!("INSERT INTO usernames ({USER_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"),
        params![
            id, engagement_id, username, domain, source_host_id, blank_to_none(input.source.as_deref()), now_ms(), scope,
            local_host_id
        ],
    )?;
    username_get(conn, &id)
}

pub fn username_delete(conn: &Connection, id: &str) -> AppResult<()> {
    delete_by_id(conn, "usernames", id)
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
        return Err(AppError::validation("level", "level must be user, admin or system"));
    }
    let via = i.via.trim();
    if via.is_empty() {
        return Err(AppError::validation("via", "say how access was gained"));
    }
    check_scope(conn, engagement_id, Some(&i.host_id))?;
    check_in_engagement(conn, "usernames", engagement_id, username_id)?;
    let log_entry_id = blank_to_none(i.log_entry_id.as_deref());
    if let Some(l) = &log_entry_id {
        check_in_engagement(conn, "log_entries", engagement_id, l)?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        &format!("INSERT INTO access_grants ({GRANT_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)"),
        params![id, engagement_id, username_id, i.host_id, i.level, via, log_entry_id, i.at.unwrap_or_else(now_ms)],
    )?;
    Ok(conn.query_row(&format!("SELECT {GRANT_COLS} FROM access_grants WHERE id = ?1"), [&id], grant_row)?)
}

pub fn grant_create(conn: &Connection, engagement_id: &str, input: AccessGrantInput) -> AppResult<AccessGrant> {
    check_scope(conn, engagement_id, None)?;
    grant_insert(conn, engagement_id, &input.username_id, &input)
}

pub fn grant_delete(conn: &Connection, id: &str) -> AppResult<()> {
    delete_by_id(conn, "access_grants", id)
}

/// For an old placeholder-secret credential: finds or creates its username, records the grant, and
/// deletes the credential, all or nothing. Returns the username.
pub fn convert_to_access(conn: &Connection, cred_id: &str, grant: AccessGrantInput) -> AppResult<Username> {
    let cred = get(conn, cred_id)?;
    let placeholder = matches!(cred.secret.trim().to_lowercase().as_str(), "" | "none" | "n/a" | "-");
    if cred.kind != "password" || !placeholder {
        return Err(AppError::validation("secret", "only a placeholder password credential can be converted"));
    }
    if cred.username.trim().is_empty() {
        return Err(AppError::validation("username", "the credential has no username to convert"));
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
            scope: None,
            local_host_id: None,
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
    use crate::attempts;
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

    /// `super::create`'s credential, for tests that don't look at `existed`.
    fn create(c: &Connection, e: &str, i: CredentialInput) -> AppResult<Credential> {
        super::create(c, e, i).map(|x| x.credential)
    }

    /// An engagement whose own domain is `domain`.
    fn eng_on(c: &Connection, name: &str, domain: Option<&str>) -> String {
        let e = eng(c, name);
        c.execute("UPDATE engagements SET domain = ?2 WHERE id = ?1", params![e, domain]).unwrap();
        e
    }

    fn on(mut i: CredentialInput, domain: &str) -> CredentialInput {
        i.domain = Some(domain.into());
        i
    }

    #[test]
    fn same_domain_is_anchored_to_the_engagement() {
        let corp = Some("corp.lan");
        // The engagement's FQDN and its first label are one domain, either way round, in any case.
        assert!(same_domain(corp, Some("CORP"), Some("corp.lan")));
        assert!(same_domain(corp, Some("corp.lan"), Some("corp")));
        assert!(same_domain(Some(" Corp.LAN "), Some("CORP"), Some("CORP.LAN")));
        // With no engagement domain, only equal spellings.
        assert!(!same_domain(None, Some("CORP"), Some("corp.lan")));
        assert!(!same_domain(Some("  "), Some("CORP"), Some("corp.lan")));
        // A NetBIOS name never matches another FQDN, nor a host's DNS name.
        assert!(!same_domain(corp, Some("CORP"), Some("corp.local")));
        assert!(!same_domain(corp, Some("WEB01"), Some("web01.corp.lan")));
        assert!(!same_domain(corp, Some("corp"), Some("corporate.com")));
        // An engagement domain that isn't an FQDN anchors nothing.
        assert!(!same_domain(Some("CORP"), Some("corp"), Some("corp.lan")));
        // Case and surrounding whitespace are ignored; blank matches only blank.
        assert!(same_domain(None, Some(" Corp.Local "), Some("corp.local")));
        assert!(same_domain(corp, None, Some("  ")));
        assert!(!same_domain(corp, None, Some("corp.lan")));
        assert!(!same_domain(corp, None, Some("CORP")));
    }

    #[test]
    fn create_returns_the_stored_credential_in_either_spelling() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng_on(c, "a", Some("corp.lan"));
        let first = super::create(c, &e, on(cin("password", "zoe", "Winter2024!"), "CORP")).unwrap();
        assert!(!first.existed);
        let again = super::create(c, &e, on(cin("password", "ZOE", "Winter2024!"), "corp.lan")).unwrap();
        assert_eq!((again.credential.id.as_str(), again.existed), (first.credential.id.as_str(), true));
        // Another FQDN with the same first label, or no domain, is another credential.
        assert!(!super::create(c, &e, on(cin("password", "zoe", "Winter2024!"), "corp.local")).unwrap().existed);
        assert!(!super::create(c, &e, cin("password", "zoe", "Winter2024!")).unwrap().existed);
        // Nothing was written for the duplicate.
        assert_eq!(list(c, &e).unwrap().len(), 3);
        // A crack finds the password stored in the other spelling.
        let hash = create(c, &e, on(cin("hash", "zoe", &"ab".repeat(16)), "corp.lan")).unwrap();
        assert_eq!(crack(c, &hash.id, "Winter2024!").unwrap().id, first.credential.id);

        // With no engagement domain the two spellings are two credentials.
        let e2 = eng_on(c, "b", None);
        let a = super::create(c, &e2, on(cin("password", "zoe", "Winter2024!"), "CORP")).unwrap();
        let b = super::create(c, &e2, on(cin("password", "zoe", "Winter2024!"), "corp.lan")).unwrap();
        assert!(!a.existed && !b.existed);
        assert_ne!(a.credential.id, b.credential.id);
    }

    #[test]
    fn a_recaptured_hash_is_one_credential_per_account_and_kind() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng_on(c, "a", Some("corp.lan"));
        let tgs = |s: &str| on(cin("hash", "svc_sql", &format!("$krb5tgs$23$*svc_sql$CORP.LAN$cifs/sql01*${s}")), "corp.lan");
        let roast = super::create(c, &e, tgs("aaaa$bbbb")).unwrap();
        let reroast = super::create(c, &e, tgs("cccc$dddd")).unwrap();
        assert_eq!((reroast.credential.id.as_str(), reroast.existed), (roast.credential.id.as_str(), true));
        // ...in either spelling of the domain.
        let mut netbios = tgs("eeee$ffff");
        netbios.domain = Some("CORP".into());
        assert!(super::create(c, &e, netbios).unwrap().existed);
        // AS-REP is another kind; another account is another credential.
        let asrep = |u: &str, s: &str| on(cin("hash", u, &format!("$krb5asrep$23$svc_sql@CORP.LAN:{s}")), "corp.lan");
        let a1 = super::create(c, &e, asrep("svc_sql", "11$22")).unwrap();
        assert!(!a1.existed);
        assert!(super::create(c, &e, asrep("svc_sql", "33$44")).unwrap().existed);
        assert!(!super::create(c, &e, on(cin("hash", "svc_web", "$krb5tgs$23$*svc_web$CORP.LAN$http/web01*$aa$bb"), "corp.lan")).unwrap().existed);
        // NetNTLM, by its shape or by its hash type.
        let ntlmv2 = |chal: &str| on(cin("hash", "zoe", &format!("zoe::CORP:{chal}:0101aa:0101bb")), "CORP");
        let n1 = super::create(c, &e, ntlmv2("1122334455667788")).unwrap();
        assert!(!n1.existed);
        assert!(super::create(c, &e, ntlmv2("8877665544332211")).unwrap().existed);
        let mut typed = on(cin("hash", "zoe", "opaque-capture-bytes"), "corp.lan");
        typed.hash_type = Some("NetNTLMv2".into());
        assert_eq!(super::create(c, &e, typed).unwrap().credential.id, n1.credential.id);
        // An NT hash is identified by its value.
        let nt1 = super::create(c, &e, on(cin("hash", "zoe", &"ab".repeat(16)), "corp.lan")).unwrap();
        let nt2 = super::create(c, &e, on(cin("hash", "zoe", &"cd".repeat(16)), "corp.lan")).unwrap();
        assert!(!nt1.existed && !nt2.existed);
    }

    #[test]
    fn update_refuses_a_collision_but_a_stored_duplicate_stays_editable() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng_on(c, "a", Some("corp.lan"));
        // Two rows for one credential, stored before the store owned identity.
        for (id, domain) in [("c1", "CORP"), ("c2", "corp.lan")] {
            c.execute(
                "INSERT INTO credentials (id,engagement_id,type,username,domain,secret,scope,created_at,updated_at) \
                 VALUES (?1,?2,'password','zoe',?3,'Winter2024!','domain',1,1)",
                params![id, e, domain],
            )
            .unwrap();
        }
        let mut notes = on(cin("password", "zoe", "Winter2024!"), "CORP");
        notes.notes = Some("from the share".into());
        assert_eq!(update(c, "c1", notes).unwrap().notes.as_deref(), Some("from the share"));
        assert_eq!(list(c, &e).unwrap().len(), 2);
        // Creating it again returns the row spelled the same.
        let again = super::create(c, &e, on(cin("password", "zoe", "Winter2024!"), "corp.lan")).unwrap();
        assert_eq!((again.credential.id.as_str(), again.existed), ("c2", true));
        // Editing another credential into this one is refused, in either spelling.
        let other = create(c, &e, on(cin("password", "zoe", "Spring2024!"), "corp.lan")).unwrap();
        let (field_name, message) = field(update(c, &other.id, on(cin("password", "zoe", "Winter2024!"), "CORP")));
        assert_eq!((field_name.as_str(), message.as_str()), ("secret", "A credential with these values already exists"));
    }

    #[test]
    fn usernames_are_the_same_in_either_spelling_of_the_engagement_domain() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng_on(c, "a", Some("corp.lan"));
        let mk = |u: &str, d: &str| UsernameInput { username: u.into(), domain: Some(d.into()), source_host_id: None, source: None, scope: None, local_host_id: None };
        let a = username_create(c, &e, mk("alice", "CORP")).unwrap();
        assert_eq!(username_create(c, &e, mk("Alice", "corp.lan")).unwrap().id, a.id);
        assert_ne!(username_create(c, &e, mk("alice", "corp.local")).unwrap().id, a.id);
        let e2 = eng_on(c, "b", None);
        let b = username_create(c, &e2, mk("alice", "CORP")).unwrap();
        assert_ne!(username_create(c, &e2, mk("alice", "corp.lan")).unwrap().id, b.id);
    }

    #[test]
    fn same_domains_answers_for_the_engagement() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng_on(c, "a", Some("corp.lan"));
        let s = |x: &str| Some(x.to_string());
        let pairs = [(s("CORP"), s("corp.lan")), (s("CORP"), s("corp.local")), (None, None), (None, s("CORP"))];
        assert_eq!(same_domains(c, &e, &pairs).unwrap(), vec![true, false, true, false]);
        assert_eq!(same_domains(c, "nope", &pairs), Err(AppError::NotFound));
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
            UsernameInput { username: "alice".into(), domain: Some("CORP".into()), source_host_id: None, source: None, scope: None, local_host_id: None },
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
        let u = username_create(c, &e, UsernameInput { username: "a".into(), domain: None, source_host_id: Some(h.clone()), source: None, scope: None, local_host_id: None }).unwrap();
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

    fn local_on(host_id: Option<&str>, user: &str, secret: &str) -> CredentialInput {
        let mut i = cin("password", user, secret);
        i.scope = Some("local".into());
        i.local_host_id = host_id.map(Into::into);
        i
    }

    #[test]
    fn deleting_its_host_keeps_a_local_credential_editable() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let (gone, other) = (host(c, &e, "192.0.2.20"), host(c, &e, "192.0.2.21"));
        let cred = create(c, &e, local_on(Some(&gone), "administrator", "Local-1")).unwrap();
        attempts::upsert(
            c,
            &e,
            &[attempts::CredAttemptInput {
                cred_id: cred.id.clone(),
                username_id: None,
                host_id: other.clone(),
                service: "smb".into(),
                port: None,
                result: "valid".into(),
                auth_mode: Some("local".into()),
                detail: None,
                log_entry_id: None,
                at: Some(1),
            }],
        )
        .unwrap();
        hosts::delete(c, &gone).unwrap();

        // The credential and its attempts elsewhere stay; only its host link is gone.
        let kept = get(c, &cred.id).unwrap();
        assert_eq!((kept.scope.as_str(), kept.local_host_id.as_deref()), ("local", None));
        assert_eq!(attempts::list(c, &e).unwrap().len(), 1);

        // An edit that leaves scope and host as they are is allowed: its notes, then its secret.
        let mut notes = local_on(None, "administrator", "Local-1");
        notes.notes = Some("reused on files01".into());
        let noted = update(c, &cred.id, notes).unwrap();
        assert_eq!((noted.notes.as_deref(), noted.local_host_id.as_deref()), (Some("reused on files01"), None));
        let resecret = update(c, &cred.id, local_on(None, "administrator", "Local-2")).unwrap();
        assert_eq!((resecret.secret.as_str(), resecret.scope.as_str()), ("Local-2", "local"));

        // A new local credential still needs its host.
        assert_eq!(field(create(c, &e, local_on(None, "guest", "Guest-1"))), ("localHostId".into(), "a local credential needs its host".into()));
    }

    #[test]
    fn setting_or_changing_scope_or_host_still_needs_a_host() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let (gone, live) = (host(c, &e, "192.0.2.30"), host(c, &e, "192.0.2.31"));
        let orphan = create(c, &e, local_on(Some(&gone), "administrator", "Local-1")).unwrap();
        hosts::delete(c, &gone).unwrap();

        // A domain credential made local with no host is refused.
        let dom = create(c, &e, cin("password", "alice", "Winter2026!")).unwrap();
        assert_eq!(field(update(c, &dom.id, local_on(None, "alice", "Winter2026!"))).0, "localHostId");
        // A local credential that has a host can't drop it.
        let held = create(c, &e, local_on(Some(&live), "backup", "Backup-1")).unwrap();
        assert_eq!(field(update(c, &held.id, local_on(None, "backup", "Backup-1"))).0, "localHostId");
        // Only a local credential has a host, orphaned or not.
        let mut hosted_domain = cin("password", "administrator", "Local-1");
        hosted_domain.local_host_id = Some(live.clone());
        assert_eq!(field(update(c, &orphan.id, hosted_domain)), ("localHostId".into(), "only a local credential has a host".into()));
        // An orphaned local credential can be given a new host...
        assert_eq!(update(c, &orphan.id, local_on(Some(&live), "administrator", "Local-1")).unwrap().local_host_id.as_deref(), Some(live.as_str()));
        // ...or, orphaned again, made a domain credential.
        hosts::delete(c, &live).unwrap();
        let domain = update(c, &orphan.id, cin("password", "administrator", "Local-1")).unwrap();
        assert_eq!((domain.scope.as_str(), domain.local_host_id), ("domain", None));
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
        let u = username_create(c, &e, UsernameInput { username: "a".into(), domain: None, source_host_id: None, source: None, scope: None, local_host_id: None }).unwrap();
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
            scope: None,
            local_host_id: None,
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

    fn uin(user: &str, domain: Option<&str>, scope: Option<&str>, host: Option<&str>) -> UsernameInput {
        UsernameInput {
            username: user.into(),
            domain: domain.map(str::to_string),
            scope: scope.map(str::to_string),
            local_host_id: host.map(str::to_string),
            source_host_id: None,
            source: None,
        }
    }

    #[test]
    fn username_identity_follows_its_scope() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng_on(c, "a", Some("corp.lan"));
        let (web, sql) = (host(c, &e, "192.0.2.10"), host(c, &e, "192.0.2.11"));
        let mk = |user: &str, domain: Option<&str>, scope: Option<&str>, host: Option<&str>| {
            username_create(c, &e, uin(user, domain, scope, host)).unwrap()
        };

        // Domain: a blank domain is the engagement's own, in either spelling.
        let dom = mk("zoe", None, Some("domain"), None);
        assert_eq!((dom.scope.as_str(), dom.local_host_id.as_deref()), ("domain", None));
        assert_eq!(mk("ZOE", Some("CORP"), Some("domain"), None).id, dom.id);
        assert_eq!(mk("zoe", Some("corp.lan"), Some("domain"), None).id, dom.id);
        assert_ne!(mk("zoe", Some("corp.local"), Some("domain"), None).id, dom.id);

        // Unknown keeps today's rule, and never merges with a domain username.
        let unknown = mk("zoe", None, None, None);
        assert_eq!(unknown.scope, "unknown");
        assert_ne!(unknown.id, dom.id);
        let unknown_corp = mk("zoe", Some("CORP"), None, None);
        assert_ne!(unknown_corp.id, dom.id);
        assert_ne!(unknown_corp.id, unknown.id);
        assert_eq!(mk("zoe", Some("corp.lan"), Some("unknown"), None).id, unknown_corp.id);
        assert_eq!(mk("Zoe", None, Some("unknown"), None).id, unknown.id);

        // Local: one per name on each host, never a domain or unknown one. Its domain is its host, so none is kept.
        let on_web = mk("zoe", Some("WEB01"), Some("local"), Some(&web));
        assert_eq!((on_web.scope.as_str(), on_web.local_host_id.as_deref(), on_web.domain.as_deref()), ("local", Some(web.as_str()), None));
        assert_eq!(mk("ZOE", None, Some("local"), Some(&web)).id, on_web.id);
        let on_sql = mk("zoe", None, Some("local"), Some(&sql));
        assert_ne!(on_sql.id, on_web.id);
        for other in [&dom.id, &unknown.id, &unknown_corp.id] {
            assert_ne!(&on_web.id, other);
            assert_ne!(&on_sql.id, other);
        }
        assert_eq!(usernames_list(c, &e).unwrap().len(), 6);

        // With no engagement domain, a blank domain is only blank.
        let e2 = eng_on(c, "b", None);
        let blank = username_create(c, &e2, uin("zoe", None, Some("domain"), None)).unwrap();
        assert_ne!(username_create(c, &e2, uin("zoe", Some("CORP"), Some("domain"), None)).unwrap().id, blank.id);
        assert_eq!(username_create(c, &e2, uin("zoe", Some(" "), Some("domain"), None)).unwrap().id, blank.id);
    }

    #[test]
    fn a_username_scope_and_host_are_checked() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let e2 = eng(c, "b");
        let (h, foreign) = (host(c, &e, "192.0.2.10"), host(c, &e2, "192.0.2.20"));
        let err = |i: UsernameInput| field(username_create(c, &e, i));
        assert_eq!(err(uin("zoe", None, Some("local"), None)), ("localHostId".into(), "a local username needs its host".into()));
        assert_eq!(err(uin("zoe", None, Some("domain"), Some(&h))), ("localHostId".into(), "only a local username has a host".into()));
        assert_eq!(err(uin("zoe", None, None, Some(&h))).0, "localHostId");
        assert_eq!(err(uin("zoe", None, Some("app"), None)), ("scope".into(), "scope must be domain, local or unknown".into()));
        assert_eq!(username_create(c, &e, uin("zoe", None, Some("local"), Some(&foreign))), Err(AppError::NotFound));
        assert!(usernames_list(c, &e).unwrap().is_empty());
    }

    #[test]
    fn deleting_its_host_keeps_a_local_username() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "a");
        let (web, sql, files) = (host(c, &e, "192.0.2.10"), host(c, &e, "192.0.2.11"), host(c, &e, "192.0.2.12"));
        let on_web = username_create(c, &e, uin("zoe", None, Some("local"), Some(&web))).unwrap();
        let on_sql = username_create(c, &e, uin("zoe", None, Some("local"), Some(&sql))).unwrap();
        grant_create(c, &e, AccessGrantInput { username_id: on_web.id.clone(), ..ginput(&files) }).unwrap();
        hosts::delete(c, &web).unwrap();
        hosts::delete(c, &sql).unwrap();

        // Both stay local, with no host; two that lost their hosts never collide; their grants elsewhere stay.
        let left = usernames_list(c, &e).unwrap();
        assert_eq!(left.len(), 2);
        for u in &left {
            assert_eq!((u.scope.as_str(), u.local_host_id.as_deref()), ("local", None));
        }
        assert!(left.iter().any(|u| u.id == on_web.id) && left.iter().any(|u| u.id == on_sql.id));
        assert_eq!(grants_list(c, &e).unwrap().len(), 1);

        // A new local username still needs its host, and is a new username on that host.
        assert_eq!(field(username_create(c, &e, uin("zoe", None, Some("local"), None))).0, "localHostId");
        let on_files = username_create(c, &e, uin("zoe", None, Some("local"), Some(&files))).unwrap();
        assert!(on_files.id != on_web.id && on_files.id != on_sql.id);
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
