//! Credential attempts: one result per credential x (optional username) x host x service x auth mode.
//!
//! Upserts never downgrade a recorded result: see `merge`.

use crate::db::{blank_to_none, check_in_engagement, check_scope, delete_by_id, now_ms};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredAttempt {
    pub id: String,
    pub engagement_id: String,
    pub cred_id: String,
    pub username_id: Option<String>,
    pub host_id: String,
    pub service: String,
    pub port: Option<i64>,
    pub result: String,
    pub auth_mode: String,
    pub detail: Option<String>,
    pub log_entry_id: Option<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredAttemptInput {
    pub cred_id: String,
    /// Set when the attempt was made as a bare username with this secret credential.
    #[serde(default)]
    pub username_id: Option<String>,
    pub host_id: String,
    pub service: String,
    #[serde(default)]
    pub port: Option<i64>,
    pub result: String,
    /// Absent means `domain`.
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub log_entry_id: Option<String>,
    /// Absent means now.
    #[serde(default)]
    pub at: Option<i64>,
}

const COLS: &str = "id, engagement_id, cred_id, username_id, host_id, service, port, result, auth_mode, detail, log_entry_id, at";

const SERVICES: [&str; 13] =
    ["smb", "winrm", "rdp", "mssql", "ssh", "ftp", "ldap", "wmi", "vnc", "nfs", "http", "kerberos", "other"];

fn row(r: &Row) -> rusqlite::Result<CredAttempt> {
    Ok(CredAttempt {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        cred_id: r.get(2)?,
        username_id: r.get(3)?,
        host_id: r.get(4)?,
        service: r.get(5)?,
        port: r.get(6)?,
        result: r.get(7)?,
        auth_mode: r.get(8)?,
        detail: r.get(9)?,
        log_entry_id: r.get(10)?,
        at: r.get(11)?,
    })
}

/// admin > valid > failed > errored.
fn rank(result: &str) -> u8 {
    match result {
        "admin" => 3,
        "valid" => 2,
        "failed" => 1,
        _ => 0,
    }
}

pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<CredAttempt>> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM cred_attempts WHERE engagement_id = ?1 ORDER BY at, id"
    ))?;
    Ok(st.query_map([engagement_id], row)?.collect::<Result<Vec<_>, _>>()?)
}

/// A validated, normalised input.
struct Clean {
    cred_id: String,
    username_id: Option<String>,
    host_id: String,
    service: String,
    port: Option<i64>,
    result: String,
    auth_mode: String,
    detail: Option<String>,
    log_entry_id: Option<String>,
    at: i64,
}

fn clean(conn: &Connection, engagement_id: &str, i: &CredAttemptInput, now: i64) -> AppResult<Clean> {
    if !SERVICES.contains(&i.service.as_str()) {
        return Err(AppError::validation("service", "unknown service"));
    }
    if !matches!(i.result.as_str(), "admin" | "valid" | "failed" | "errored") {
        return Err(AppError::validation("result", "result must be admin, valid, failed or errored"));
    }
    let auth_mode = i.auth_mode.as_deref().unwrap_or("domain");
    if !matches!(auth_mode, "domain" | "local") {
        return Err(AppError::validation("authMode", "auth mode must be domain or local"));
    }
    if i.port.is_some_and(|p| !(1..=65535).contains(&p)) {
        return Err(AppError::validation("port", "port must be 1-65535"));
    }
    check_in_engagement(conn, "credentials", engagement_id, &i.cred_id)?;
    check_scope(conn, engagement_id, Some(&i.host_id))?;
    let username_id = blank_to_none(i.username_id.as_deref());
    if let Some(u) = &username_id {
        check_in_engagement(conn, "usernames", engagement_id, u)?;
    }
    let log_entry_id = blank_to_none(i.log_entry_id.as_deref());
    if let Some(l) = &log_entry_id {
        check_in_engagement(conn, "log_entries", engagement_id, l)?;
    }
    Ok(Clean {
        cred_id: i.cred_id.clone(),
        username_id,
        host_id: i.host_id.clone(),
        service: i.service.clone(),
        port: i.port,
        result: i.result.clone(),
        auth_mode: auth_mode.to_string(),
        detail: blank_to_none(i.detail.as_deref()),
        log_entry_id,
        at: i.at.unwrap_or(now),
    })
}

/// Merges `new` into `old` (same key). Returns the row to store, or None to leave `old` untouched.
///  - a non-errored result always replaces a stored errored one, whatever the order of `at`;
///  - otherwise an older `at` is ignored, and on an equal `at` only a stronger result wins;
///  - an errored input over a non-errored result is a complete no-op (detail and proof link untouched).
fn merge(old: &CredAttempt, new: &Clean) -> Option<CredAttempt> {
    let supersedes_error = old.result == "errored" && new.result != "errored";
    if new.result == "errored" && old.result != "errored" {
        return None;
    }
    if !supersedes_error {
        if new.at < old.at {
            return None;
        }
        if new.at == old.at && rank(&new.result) < rank(&old.result) {
            return None;
        }
    }
    let mut out = old.clone();
    out.result = new.result.clone();
    out.at = new.at;
    out.port = new.port.or(old.port);
    out.log_entry_id = new.log_entry_id.clone();
    out.detail = new.detail.clone().or_else(|| if supersedes_error { old.detail.clone() } else { None });
    if out == *old { None } else { Some(out) }
}

/// Upserts one cleaned attempt using the transaction's cached statements. `id` is used for a new row.
fn upsert_clean(conn: &Connection, engagement_id: &str, c: &Clean, id: Option<&str>) -> AppResult<CredAttempt> {
    let existing = conn
        .prepare_cached(&format!(
            "SELECT {COLS} FROM cred_attempts WHERE cred_id = ?1 AND ifnull(username_id, '') = ifnull(?2, '') \
             AND host_id = ?3 AND service = ?4 AND auth_mode = ?5"
        ))?
        .query_row(params![c.cred_id, c.username_id, c.host_id, c.service, c.auth_mode], row);
    match existing.optional()? {
        Some(old) => match merge(&old, c) {
            None => Ok(old),
            Some(new) => {
                conn.prepare_cached(
                    "UPDATE cred_attempts SET result = ?2, port = ?3, detail = ?4, log_entry_id = ?5, at = ?6 WHERE id = ?1",
                )?
                .execute(params![new.id, new.result, new.port, new.detail, new.log_entry_id, new.at])?;
                Ok(new)
            }
        },
        None => {
            let a = CredAttempt {
                id: id.map(str::to_string).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                engagement_id: engagement_id.to_string(),
                cred_id: c.cred_id.clone(),
                username_id: c.username_id.clone(),
                host_id: c.host_id.clone(),
                service: c.service.clone(),
                port: c.port,
                result: c.result.clone(),
                auth_mode: c.auth_mode.clone(),
                detail: c.detail.clone(),
                log_entry_id: c.log_entry_id.clone(),
                at: c.at,
            };
            conn.prepare_cached(&format!(
                "INSERT INTO cred_attempts ({COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"
            ))?
            .execute(params![
                a.id, a.engagement_id, a.cred_id, a.username_id, a.host_id, a.service, a.port, a.result,
                a.auth_mode, a.detail, a.log_entry_id, a.at
            ])?;
            Ok(a)
        }
    }
}

/// Upserts a batch in one transaction (all or nothing). Returns the resulting row for each input, in order.
pub fn upsert(conn: &Connection, engagement_id: &str, inputs: &[CredAttemptInput]) -> AppResult<Vec<CredAttempt>> {
    check_scope(conn, engagement_id, None)?;
    let now = now_ms();
    let tx = crate::db::atomic(conn)?;
    let mut out = Vec::with_capacity(inputs.len());
    for i in inputs {
        let c = clean(&tx, engagement_id, i, now)?;
        out.push(upsert_clean(&tx, engagement_id, &c, None)?);
    }
    tx.commit()?;
    Ok(out)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    delete_by_id(conn, "cred_attempts", id)
}

/// Moves the bare-username attempts of `username_id` made with any of `secret_cred_ids` onto credential
/// `cred_id`, dropping the username subject. With `host_id` (a local credential) only that host's
/// local-auth attempts move. Each moved row is merged by the upsert rules, so an older or errored result
/// never downgrades one the credential already has. Returns the resulting rows.
pub fn rekey_username_attempts(
    conn: &Connection,
    username_id: &str,
    secret_cred_ids: &[String],
    cred_id: &str,
    host_id: Option<&str>,
) -> AppResult<Vec<CredAttempt>> {
    let engagement_id: String = conn.query_row(
        "SELECT engagement_id FROM usernames WHERE id = ?1",
        [username_id],
        |r| r.get(0),
    ).optional()?.ok_or(AppError::NotFound)?;
    check_in_engagement(conn, "credentials", &engagement_id, cred_id)?;
    for s in secret_cred_ids {
        check_in_engagement(conn, "credentials", &engagement_id, s)?;
    }
    let tx = crate::db::atomic(conn)?;
    let moving: Vec<CredAttempt> = {
        let mut st = tx.prepare(&format!(
            "SELECT {COLS} FROM cred_attempts WHERE username_id = ?1 ORDER BY at, id"
        ))?;
        let rows = st.query_map([username_id], row)?.collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .filter(|a| {
                secret_cred_ids.contains(&a.cred_id)
                    && host_id.is_none_or(|h| a.host_id == h && a.auth_mode == "local")
            })
            .collect()
    };
    for a in &moving {
        tx.execute("DELETE FROM cred_attempts WHERE id = ?1", [&a.id])?;
    }
    let mut out = Vec::with_capacity(moving.len());
    for a in &moving {
        let c = Clean {
            cred_id: cred_id.to_string(),
            username_id: None,
            host_id: a.host_id.clone(),
            service: a.service.clone(),
            port: a.port,
            result: a.result.clone(),
            auth_mode: a.auth_mode.clone(),
            detail: a.detail.clone(),
            log_entry_id: a.log_entry_id.clone(),
            at: a.at,
        };
        out.push(upsert_clean(&tx, &engagement_id, &c, Some(&a.id))?);
    }
    tx.commit()?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::{self, CredentialInput, UsernameInput};
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

    fn cred(c: &Connection, eid: &str, user: &str, secret: &str) -> String {
        credentials::create(
            c,
            eid,
            CredentialInput {
                kind: "password".into(),
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
            },
        )
        .unwrap()
        .credential
        .id
    }

    fn uname(c: &Connection, eid: &str, name: &str) -> String {
        credentials::username_create(
            c,
            eid,
            UsernameInput { username: name.into(), domain: None, source_host_id: None, source: None, scope: None, local_host_id: None },
        )
        .unwrap()
        .id
    }

    fn inp(cred_id: &str, host_id: &str, result: &str, at: i64) -> CredAttemptInput {
        CredAttemptInput {
            cred_id: cred_id.into(),
            username_id: None,
            host_id: host_id.into(),
            service: "smb".into(),
            port: None,
            result: result.into(),
            auth_mode: None,
            detail: None,
            log_entry_id: None,
            at: Some(at),
        }
    }

    fn one(c: &Connection, eid: &str, i: CredAttemptInput) -> CredAttempt {
        upsert(c, eid, &[i]).unwrap().remove(0)
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

    #[test]
    fn upsert_is_idempotent() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let h = host(c, &e, "10.0.0.1");
        let k = cred(c, &e, "alice", "Fake!Pass1");
        let a = one(c, &e, inp(&k, &h, "valid", 10));
        let b = one(c, &e, inp(&k, &h, "valid", 10));
        assert_eq!(a.id, b.id);
        assert_eq!(a.auth_mode, "domain");
        assert_eq!(list(c, &e).unwrap().len(), 1);
    }

    #[test]
    fn errored_never_downgrades() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let h = host(c, &e, "10.0.0.1");
        let k = cred(c, &e, "alice", "Fake!Pass1");
        let proof = log_entry(c, &e);
        let other_proof = log_entry(c, &e);
        for (r, svc) in [("admin", "smb"), ("valid", "winrm"), ("failed", "rdp")] {
            let mut first = inp(&k, &h, r, 10);
            first.service = svc.into();
            first.detail = Some("proof".into());
            first.log_entry_id = Some(proof.clone());
            let before = one(c, &e, first);
            let mut err = inp(&k, &h, "errored", 99);
            err.service = svc.into();
            err.detail = Some("timeout".into());
            err.log_entry_id = Some(other_proof.clone());
            let got = one(c, &e, err);
            // a complete no-op: result, at, detail and proof link all untouched
            assert_eq!(got, before);
            assert_eq!(list(c, &e).unwrap().iter().find(|a| a.id == before.id), Some(&before));
        }
        // a real result replaces an errored one even when older, and keeps its detail if it has none
        let mut err = inp(&k, &h, "errored", 50);
        err.service = "ssh".into();
        err.detail = Some("refused".into());
        one(c, &e, err);
        let mut ok = inp(&k, &h, "failed", 5);
        ok.service = "ssh".into();
        let got = one(c, &e, ok);
        assert_eq!(got.result, "failed");
        assert_eq!(got.detail.as_deref(), Some("refused"));
    }

    #[test]
    fn newer_result_wins_else_stronger() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let h = host(c, &e, "10.0.0.1");
        let k = cred(c, &e, "alice", "Fake!Pass1");
        let l1 = log_entry(c, &e);
        let mut first = inp(&k, &h, "valid", 10);
        first.detail = Some("first".into());
        first.port = Some(445);
        one(c, &e, first);
        // older ignored
        assert_eq!(one(c, &e, inp(&k, &h, "admin", 5)).result, "valid");
        // equal at, weaker ignored
        assert_eq!(one(c, &e, inp(&k, &h, "failed", 10)).result, "valid");
        // equal at, stronger wins
        let mut s = inp(&k, &h, "admin", 10);
        s.detail = Some("pwn3d".into());
        s.log_entry_id = Some(l1.clone());
        let got = one(c, &e, s);
        assert_eq!(got.result, "admin");
        assert_eq!(got.detail.as_deref(), Some("pwn3d"));
        assert_eq!(got.log_entry_id.as_deref(), Some(l1.as_str()));
        assert_eq!(got.port, Some(445));
        // newer weaker wins; detail and log follow the winner
        let got = one(c, &e, inp(&k, &h, "failed", 20));
        assert_eq!((got.result.as_str(), got.at), ("failed", 20));
        assert_eq!((got.detail, got.log_entry_id), (None, None));
    }

    #[test]
    fn username_and_credential_subjects_are_distinct_rows() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let h = host(c, &e, "10.0.0.1");
        let k = cred(c, &e, "alice", "Fake!Pass1");
        let u = uname(c, &e, "bob");
        let mut with_user = inp(&k, &h, "valid", 10);
        with_user.username_id = Some(u);
        let a = one(c, &e, inp(&k, &h, "failed", 10));
        let b = one(c, &e, with_user);
        assert_ne!(a.id, b.id);
        let mut local = inp(&k, &h, "valid", 10);
        local.auth_mode = Some("local".into());
        let l = one(c, &e, local);
        assert_ne!(l.id, a.id);
        assert_eq!(list(c, &e).unwrap().len(), 3);
    }

    #[test]
    fn rekey_merges_into_existing_row() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let h = host(c, &e, "10.0.0.1");
        let h2 = host(c, &e, "10.0.0.2");
        let secret = cred(c, &e, "bob", "Fake!Pass2");
        let accepted = cred(c, &e, "bob2", "Fake!Pass3");
        let u = uname(c, &e, "bob");
        // existing credential row (older, failed) and moving username row (newer, admin)
        one(c, &e, inp(&accepted, &h, "failed", 5));
        let mut m = inp(&secret, &h, "admin", 9);
        m.username_id = Some(u.clone());
        one(c, &e, m);
        // a moving row with no collision, and one that is not moving (other secret)
        let mut m2 = inp(&secret, &h2, "valid", 7);
        m2.username_id = Some(u.clone());
        one(c, &e, m2);
        let mut other = inp(&accepted, &h2, "valid", 7);
        other.username_id = Some(u.clone());
        one(c, &e, other);
        let moved = rekey_username_attempts(c, &u, std::slice::from_ref(&secret), &accepted, None).unwrap();
        assert_eq!(moved.len(), 2);
        let all = list(c, &e).unwrap();
        assert_eq!(all.len(), 3);
        let on_h = all.iter().find(|a| a.host_id == h && a.username_id.is_none()).unwrap();
        assert_eq!((on_h.cred_id.as_str(), on_h.result.as_str(), on_h.at), (accepted.as_str(), "admin", 9));
        assert!(all.iter().all(|a| a.cred_id != secret));
        // host-limited rekey only moves local attempts on that host
        let k3 = cred(c, &e, "carol", "Fake!Pass4");
        let mut loc = inp(&secret, &h, "valid", 3);
        loc.username_id = Some(u.clone());
        loc.auth_mode = Some("local".into());
        one(c, &e, loc);
        let mut dom = inp(&secret, &h, "valid", 3);
        dom.username_id = Some(u.clone());
        one(c, &e, dom);
        let moved = rekey_username_attempts(c, &u, std::slice::from_ref(&secret), &k3, Some(&h)).unwrap();
        assert_eq!(moved.len(), 1);
        assert_eq!(moved[0].auth_mode, "local");
        assert!(list(c, &e).unwrap().iter().any(|a| a.cred_id == secret && a.auth_mode == "domain"));
    }

    #[test]
    fn rekey_keeps_stronger_or_newer_existing_row() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let h = host(c, &e, "10.0.0.1");
        let h2 = host(c, &e, "10.0.0.2");
        let h3 = host(c, &e, "10.0.0.3");
        let secret = cred(c, &e, "bob", "Fake!Pass2");
        let accepted = cred(c, &e, "bob2", "Fake!Pass3");
        let u = uname(c, &e, "bob");
        let proof = log_entry(c, &e);
        let mut ids = vec![];
        // existing rows on the accepted credential
        for (host_id, result, at) in [(&h, "admin", 20), (&h2, "valid", 20), (&h3, "valid", 30)] {
            let mut x = inp(&accepted, host_id, result, at);
            x.detail = Some("keep".into());
            x.log_entry_id = Some(proof.clone());
            ids.push(one(c, &e, x));
        }
        // moving rows: errored (newer) over admin, older failed over valid, equal-at weaker over newer valid
        let mut m1 = inp(&secret, &h, "errored", 99);
        m1.detail = Some("timeout".into());
        let mut m2 = inp(&secret, &h2, "failed", 10);
        m2.detail = Some("old".into());
        let m3 = inp(&secret, &h3, "failed", 30);
        for mut m in [m1, m2, m3] {
            m.username_id = Some(u.clone());
            one(c, &e, m);
        }
        let moved = rekey_username_attempts(c, &u, std::slice::from_ref(&secret), &accepted, None).unwrap();
        assert_eq!(moved.len(), 3);
        for before in &ids {
            assert!(moved.contains(before));
        }
        let all = list(c, &e).unwrap();
        assert_eq!(all.len(), 3);
        for before in &ids {
            assert_eq!(all.iter().find(|a| a.id == before.id), Some(before));
        }
    }

    #[test]
    fn foreign_host_or_credential_rejected() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let o = eng(c, "B");
        let h = host(c, &e, "10.0.0.1");
        let oh = host(c, &o, "10.0.0.9");
        let k = cred(c, &e, "alice", "Fake!Pass1");
        let ok = cred(c, &o, "mallory", "Fake!Pass9");
        let ou = uname(c, &o, "eve");
        let ol = log_entry(c, &o);
        assert!(matches!(upsert(c, &e, &[inp(&k, &oh, "valid", 1)]), Err(AppError::NotFound)));
        assert!(matches!(upsert(c, &e, &[inp(&ok, &h, "valid", 1)]), Err(AppError::NotFound)));
        let mut u = inp(&k, &h, "valid", 1);
        u.username_id = Some(ou);
        assert!(matches!(upsert(c, &e, &[u]), Err(AppError::NotFound)));
        let mut l = inp(&k, &h, "valid", 1);
        l.log_entry_id = Some(ol);
        assert!(matches!(upsert(c, &e, &[l]), Err(AppError::NotFound)));
        let mut bad = inp(&k, &h, "great", 1);
        assert!(matches!(upsert(c, &e, &[bad.clone()]), Err(AppError::Validation { .. })));
        bad.result = "valid".into();
        bad.service = "gopher".into();
        assert!(matches!(upsert(c, &e, &[bad.clone()]), Err(AppError::Validation { .. })));
        bad.service = "smb".into();
        bad.auth_mode = Some("kerb".into());
        assert!(matches!(upsert(c, &e, &[bad]), Err(AppError::Validation { .. })));
        // a bad row rolls the whole batch back
        let batch = [inp(&k, &h, "valid", 1), inp(&k, &oh, "valid", 1)];
        assert!(upsert(c, &e, &batch).is_err());
        assert!(list(c, &e).unwrap().is_empty());
    }

    #[test]
    fn delete_removes_row() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "A");
        let h = host(c, &e, "10.0.0.1");
        let k = cred(c, &e, "alice", "Fake!Pass1");
        let a = one(c, &e, inp(&k, &h, "valid", 1));
        delete(c, &a.id).unwrap();
        assert!(matches!(delete(c, &a.id), Err(AppError::NotFound)));
    }
}
