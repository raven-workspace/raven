//! Tried pairs: username + secret combinations that failed on a host/service. Kept so a spray is not
//! repeated, but never credentials. `promote` removes them once the pair becomes a real credential.

use crate::credentials::{engagement_domain, pick_same_domain, same_domain};
use crate::db::{blank_to_none, check_in_engagement, check_scope, delete_by_id, now_ms};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriedPair {
    pub id: String,
    pub engagement_id: String,
    pub username: String,
    pub domain: Option<String>,
    pub secret: String,
    pub secret_kind: String,
    pub host_id: String,
    pub service: String,
    pub auth_mode: String,
    pub log_entry_id: Option<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriedPairInput {
    pub username: String,
    #[serde(default)]
    pub domain: Option<String>,
    pub secret: String,
    pub secret_kind: String,
    pub host_id: String,
    pub service: String,
    /// Absent means `domain`.
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub log_entry_id: Option<String>,
    /// Absent means now.
    #[serde(default)]
    pub at: Option<i64>,
}

const COLS: &str = "id, engagement_id, username, domain, secret, secret_kind, host_id, service, auth_mode, log_entry_id, at";

fn row(r: &Row) -> rusqlite::Result<TriedPair> {
    Ok(TriedPair {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        username: r.get(2)?,
        domain: r.get(3)?,
        secret: r.get(4)?,
        secret_kind: r.get(5)?,
        host_id: r.get(6)?,
        service: r.get(7)?,
        auth_mode: r.get(8)?,
        log_entry_id: r.get(9)?,
        at: r.get(10)?,
    })
}

pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<TriedPair>> {
    check_scope(conn, engagement_id, None)?;
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM tried_pairs WHERE engagement_id = ?1 ORDER BY at, id"))?;
    Ok(st.query_map([engagement_id], row)?.collect::<Result<Vec<_>, _>>()?)
}

/// Idempotent: an input that is a stored pair (case-insensitive user, the same domain, and an equal secret, host,
/// service and auth mode) returns the stored row unchanged; any other is inserted. Returns the stored row for each
/// input, in order, existing ones included. All or nothing.
pub fn upsert(conn: &Connection, engagement_id: &str, inputs: &[TriedPairInput]) -> AppResult<Vec<TriedPair>> {
    check_scope(conn, engagement_id, None)?;
    let anchor = engagement_domain(conn, engagement_id)?;
    let now = now_ms();
    let tx = crate::db::atomic(conn)?;
    let mut out = Vec::with_capacity(inputs.len());
    for i in inputs {
        let username = i.username.trim();
        if username.is_empty() {
            return Err(AppError::validation("username", "username is required"));
        }
        if i.secret.is_empty() {
            return Err(AppError::validation("secret", "secret is required"));
        }
        if !matches!(i.secret_kind.as_str(), "password" | "hash") {
            return Err(AppError::validation("secretKind", "secret kind must be password or hash"));
        }
        let auth_mode = i.auth_mode.as_deref().unwrap_or("domain");
        if !matches!(auth_mode, "domain" | "local") {
            return Err(AppError::validation("authMode", "auth mode must be domain or local"));
        }
        if i.service.trim().is_empty() {
            return Err(AppError::validation("service", "service is required"));
        }
        check_scope(&tx, engagement_id, Some(&i.host_id))?;
        let domain = blank_to_none(i.domain.as_deref());
        let log_entry_id = blank_to_none(i.log_entry_id.as_deref());
        if let Some(l) = &log_entry_id {
            check_in_engagement(&tx, "log_entries", engagement_id, l)?;
        }
        let stored = {
            let mut st = tx.prepare_cached(&format!(
                "SELECT {COLS} FROM tried_pairs WHERE engagement_id = ?1 AND lower(username) = lower(?2) AND secret = ?3 \
                 AND host_id = ?4 AND service = ?5 AND auth_mode = ?6 ORDER BY at, id"
            ))?;
            let rows = st
                .query_map(params![engagement_id, username, i.secret, i.host_id, i.service, auth_mode], row)?
                .collect::<Result<Vec<_>, _>>()?;
            pick_same_domain(rows, |t| t.domain.as_deref(), anchor.as_deref(), domain.as_deref())
        };
        if let Some(t) = stored {
            out.push(t);
            continue;
        }
        tx.prepare_cached(&format!(
            "INSERT OR IGNORE INTO tried_pairs ({COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"
        ))?
        .execute(params![
            uuid::Uuid::new_v4().to_string(),
            engagement_id,
            username,
            domain,
            i.secret,
            i.secret_kind,
            i.host_id,
            i.service,
            auth_mode,
            log_entry_id,
            i.at.unwrap_or(now)
        ])?;
        let stored = tx
            .prepare_cached(&format!(
                "SELECT {COLS} FROM tried_pairs WHERE engagement_id = ?1 AND lower(username) = lower(?2) \
                 AND lower(ifnull(domain,'')) = lower(ifnull(?3,'')) AND secret = ?4 AND host_id = ?5 \
                 AND service = ?6 AND auth_mode = ?7"
            ))?
            .query_row(params![engagement_id, username, domain, i.secret, i.host_id, i.service, auth_mode], row)?;
        out.push(stored);
    }
    tx.commit()?;
    Ok(out)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    delete_by_id(conn, "tried_pairs", id)
}

/// Deletes the tried pairs matching (username, domain, secret) once that pair is a real credential.
/// User compares case-insensitively; the domain by `same_domain`, anchored to the engagement's domain. Returns how
/// many were removed.
pub fn promote(
    conn: &Connection,
    engagement_id: &str,
    username: &str,
    domain: Option<&str>,
    secret: &str,
) -> AppResult<usize> {
    check_scope(conn, engagement_id, None)?;
    let domain = blank_to_none(domain);
    let anchor = engagement_domain(conn, engagement_id)?;
    let tx = conn.unchecked_transaction()?;
    let ids: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT id, domain FROM tried_pairs WHERE engagement_id = ?1 AND lower(username) = lower(?2) AND secret = ?3",
        )?;
        let rows = stmt.query_map(params![engagement_id, username.trim(), secret], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        let mut ids = Vec::new();
        for row in rows {
            let (id, d) = row?;
            if same_domain(anchor.as_deref(), d.as_deref(), domain.as_deref()) {
                ids.push(id);
            }
        }
        ids
    };
    for id in &ids {
        tx.execute("DELETE FROM tried_pairs WHERE id = ?1", [id])?;
    }
    tx.commit()?;
    Ok(ids.len())
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

    fn setup(c: &Connection) -> (String, String) {
        let e = eng(c, "e");
        let h = hosts::create(c, &e, HostInput { name: "a".into(), ip: Some("10.10.1.5".into()), os: None, access: None, dual_homed: None, ad_set: None })
            .unwrap()
            .id;
        (e, h)
    }

    fn inp(host: &str, user: &str, domain: Option<&str>, secret: &str) -> TriedPairInput {
        TriedPairInput {
            username: user.into(),
            domain: domain.map(str::to_string),
            secret: secret.into(),
            secret_kind: "password".into(),
            host_id: host.into(),
            service: "smb".into(),
            auth_mode: None,
            log_entry_id: None,
            at: Some(5),
        }
    }

    #[test]
    fn migrates_10_to_11_keeps_rows() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..10], &mut |_, _| Ok(())).unwrap();
        c.execute("INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)", []).unwrap();
        c.execute("INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h1','e1','a','10.0.0.5',1,1)", []).unwrap();
        let mut calls = 0;
        let out = migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..11], &mut |f, t| {
            assert_eq!((f, t), (10, 11));
            calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!((calls, out.to), (1, 11));
        let n: i64 = c.query_row("SELECT count(*) FROM hosts WHERE id='h1'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        for t in ["tried_pairs", "extractions"] {
            let n: i64 = c.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [t], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "{t}");
        }
        assert!(c
            .execute("INSERT INTO tried_pairs (id,engagement_id,username,secret,secret_kind,host_id,service,auth_mode,at) VALUES ('t','e1','u','s','bogus','h1','smb','domain',1)", [])
            .is_err());
    }

    #[test]
    fn upsert_is_idempotent() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        let a = upsert(c, &e, &[inp(&h, "jay", Some("corp.lan"), "Winter2024!")]).unwrap();
        let b = upsert(c, &e, &[inp(&h, "jay", Some("corp.lan"), "Winter2024!")]).unwrap();
        assert_eq!(a, b);
        assert_eq!(list(c, &e).unwrap().len(), 1);
    }

    #[test]
    fn pair_key_ignores_case() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        let a = upsert(c, &e, &[inp(&h, "JAY", Some("corp.lan"), "Winter2024!")]).unwrap();
        let b = upsert(c, &e, &[inp(&h, "jay", Some("CORP.LAN"), "Winter2024!")]).unwrap();
        assert_eq!(a[0].id, b[0].id);
        assert_eq!(list(c, &e).unwrap().len(), 1);
        // The secret is case-sensitive.
        upsert(c, &e, &[inp(&h, "jay", Some("corp.lan"), "winter2024!")]).unwrap();
        assert_eq!(list(c, &e).unwrap().len(), 2);
    }

    #[test]
    fn promote_deletes_matching_pairs() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        let mut other_svc = inp(&h, "jay", Some("corp.lan"), "Winter2024!");
        other_svc.service = "winrm".into();
        upsert(c, &e, &[inp(&h, "jay", Some("corp.lan"), "Winter2024!"), other_svc, inp(&h, "drew", None, "Winter2024!")]).unwrap();
        assert_eq!(promote(c, &e, "JAY", Some("CORP.LAN"), "Winter2024!").unwrap(), 2);
        let left = list(c, &e).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].username, "drew");
    }

    #[test]
    fn promote_treats_netbios_and_fqdn_as_one_domain() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        on_domain(c, &e, Some("corp.lan"));
        upsert(
            c,
            &e,
            &[
                inp(&h, "jay", Some("CORP"), "Winter2024!"),
                inp(&h, "jay", Some("corp.local"), "Winter2024!"),
                inp(&h, "jay", Some("other.com"), "Winter2024!"),
                inp(&h, "jay", None, "Winter2024!"),
            ],
        )
        .unwrap();
        assert_eq!(promote(c, &e, "jay", Some("corp.lan"), "Winter2024!").unwrap(), 1);
        let left: Vec<Option<String>> = list(c, &e).unwrap().into_iter().map(|t| t.domain).collect();
        assert_eq!(left.len(), 3);
        assert!(!left.contains(&Some("CORP".to_string())));
    }

    /// Sets the engagement's own domain.
    fn on_domain(c: &Connection, e: &str, domain: Option<&str>) {
        c.execute("UPDATE engagements SET domain = ?2 WHERE id = ?1", params![e, domain]).unwrap();
    }

    #[test]
    fn promote_without_an_engagement_domain_matches_only_equal_spellings() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        upsert(c, &e, &[inp(&h, "jay", Some("CORP"), "Winter2024!"), inp(&h, "jay", Some("corp"), "Spring2024!")]).unwrap();
        assert_eq!(promote(c, &e, "jay", Some("corp.lan"), "Winter2024!").unwrap(), 0);
        assert_eq!(promote(c, &e, "jay", Some("Corp "), "Spring2024!").unwrap(), 1);
        assert_eq!(list(c, &e).unwrap().len(), 1);
    }

    #[test]
    fn upsert_finds_the_pair_stored_in_the_other_spelling() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        on_domain(c, &e, Some("corp.lan"));
        let a = upsert(c, &e, &[inp(&h, "jay", Some("CORP"), "Winter2024!")]).unwrap();
        let b = upsert(c, &e, &[inp(&h, "JAY", Some("corp.lan"), "Winter2024!")]).unwrap();
        assert_eq!(a, b);
        // Another FQDN with the same first label is another pair.
        let other = upsert(c, &e, &[inp(&h, "jay", Some("corp.local"), "Winter2024!")]).unwrap();
        assert_ne!(other[0].id, a[0].id);
        assert_eq!(list(c, &e).unwrap().len(), 2);
    }

    #[test]
    fn rejects_host_of_another_engagement_and_bad_kind() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e, h) = setup(c);
        let e2 = eng(c, "e2");
        assert!(matches!(upsert(c, &e2, &[inp(&h, "jay", None, "x")]), Err(AppError::NotFound)));
        let mut bad = inp(&h, "jay", None, "x");
        bad.secret_kind = "ticket".into();
        assert!(upsert(c, &e, &[bad]).is_err());
    }
}
