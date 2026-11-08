//! Extraction records: what a log entry's Save filed automatically (created ids plus "before" snapshots of the rows
//! it changed), so one Undo can reverse exactly that save's contribution. One record per log entry; deleting the
//! entry drops the record (FK cascade) but keeps the filed data.

use crate::attempts::CredAttempt;
use crate::backup::system_now_ms;
use crate::credentials::Credential;
use crate::error::{AppError, AppResult};
use crate::host_facts::HostIdentity;
use crate::notes::check_scope;
use crate::services::Service;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

/// Display lines, already worded: `wins` in the accent colour, `counts` muted, `ticks` like "Ticked 'Dump hashes' on DC01".
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExtractionSummary {
    pub wins: Vec<String>,
    pub counts: Vec<String>,
    pub ticks: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostOsBefore {
    pub host_id: String,
    pub os: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityBefore {
    pub host_id: String,
    pub identity: Option<HostIdentity>,
}

/// A checklist tick the entry's output proved. Undo leaves checklist rows alone; the UI recomputes ticks after.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputTick {
    pub owner_id: String,
    pub goal_id: String,
    pub parser: String,
}

/// Mirrors the TS `ExtractionRecord`. Every list defaults to empty.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExtractionRecord {
    pub created_host_ids: Vec<String>,
    pub created_service_ids: Vec<String>,
    /// Services a scan changed, as they were.
    pub services_before: Vec<Service>,
    pub host_os_before: Vec<HostOsBefore>,
    pub identity_before: Vec<IdentityBefore>,
    pub created_credential_ids: Vec<String>,
    /// Credentials this save upgraded (cracked), as they were.
    pub credentials_before: Vec<Credential>,
    pub created_username_ids: Vec<String>,
    pub created_attempt_ids: Vec<String>,
    /// Attempts whose result this save changed, as they were.
    pub attempts_before: Vec<CredAttempt>,
    pub created_tried_pair_ids: Vec<String>,
    pub created_vector_ids: Vec<String>,
    pub output_ticks: Vec<OutputTick>,
    /// Stored credentials this save proved again (re-dumped, re-cracked): another entry's Undo keeps them.
    pub reproved_credential_ids: Vec<String>,
    /// Stored usernames this save listed again: another entry's Undo keeps them.
    pub reproved_username_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Extraction {
    pub log_entry_id: String,
    pub engagement_id: String,
    pub summary: ExtractionSummary,
    pub record: ExtractionRecord,
    pub created_at: i64,
    pub undone_at: Option<i64>,
}

const COLS: &str = "log_entry_id, engagement_id, summary, record, created_at, undone_at";

fn row(r: &Row) -> rusqlite::Result<(String, String, String, String, i64, Option<i64>)> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
}

fn parse(raw: (String, String, String, String, i64, Option<i64>)) -> AppResult<Extraction> {
    let (log_entry_id, engagement_id, summary, record, created_at, undone_at) = raw;
    Ok(Extraction {
        log_entry_id,
        engagement_id,
        summary: serde_json::from_str(&summary).map_err(|e| AppError::Db(e.to_string()))?,
        record: serde_json::from_str(&record).map_err(|e| AppError::Db(e.to_string()))?,
        created_at,
        undone_at,
    })
}

pub fn get(conn: &Connection, log_entry_id: &str) -> AppResult<Option<Extraction>> {
    conn.query_row(&format!("SELECT {COLS} FROM extractions WHERE log_entry_id = ?1"), [log_entry_id], row)
        .optional()?
        .map(parse)
        .transpose()
}

pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Extraction>> {
    check_scope(conn, engagement_id, None)?;
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM extractions WHERE engagement_id = ?1 ORDER BY created_at, log_entry_id"))?;
    let raw = st.query_map([engagement_id], row)?.collect::<Result<Vec<_>, _>>()?;
    raw.into_iter().map(parse).collect()
}

/// Stores the record for a log entry (stamped now). An entry is extracted once, on create: a second save is a
/// `Conflict` and leaves the stored record (and any undo) as it is.
pub fn save(
    conn: &Connection,
    log_entry_id: &str,
    engagement_id: &str,
    summary: &ExtractionSummary,
    record: &ExtractionRecord,
) -> AppResult<Extraction> {
    let ok: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM log_entries WHERE id = ?1 AND engagement_id = ?2)",
        params![log_entry_id, engagement_id],
        |r| r.get(0),
    )?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let summary = serde_json::to_string(summary).map_err(|e| AppError::Db(e.to_string()))?;
    let record = serde_json::to_string(record).map_err(|e| AppError::Db(e.to_string()))?;
    let inserted = conn.execute(
        "INSERT INTO extractions (log_entry_id, engagement_id, summary, record, created_at, undone_at) \
         VALUES (?1,?2,?3,?4,?5,NULL) ON CONFLICT (log_entry_id) DO NOTHING",
        params![log_entry_id, engagement_id, summary, record, system_now_ms()],
    )?;
    if inserted == 0 {
        return Err(AppError::Conflict("this entry's extraction is already recorded".into()));
    }
    get(conn, log_entry_id)?.ok_or(AppError::NotFound)
}

/// Every other row that ties a host to the engagement's work. This entry's own host link and auto-written checklist
/// rows do not count (the UI recomputes ticks after an undo).
const HOST_REFS: &str = "SELECT \
      (SELECT count(*) FROM services WHERE host_id = ?1) \
    + (SELECT count(*) FROM log_entry_hosts WHERE host_id = ?1 AND entry_id <> ?2) \
    + (SELECT count(*) FROM credentials WHERE local_host_id = ?1 OR source_host_id = ?1) \
    + (SELECT count(*) FROM usernames WHERE source_host_id = ?1) \
    + (SELECT count(*) FROM access_grants WHERE host_id = ?1) \
    + (SELECT count(*) FROM cred_attempts WHERE host_id = ?1) \
    + (SELECT count(*) FROM tried_pairs WHERE host_id = ?1) \
    + (SELECT count(*) FROM finding_hosts WHERE host_id = ?1) \
    + (SELECT count(*) FROM failed_attempts WHERE host_id = ?1) \
    + (SELECT count(*) FROM cleanup_items WHERE host_id = ?1) \
    + (SELECT count(*) FROM notes WHERE host_id = ?1 AND body <> '') \
    + (SELECT count(*) FROM ruled_out WHERE host_id = ?1) \
    + (SELECT count(*) FROM tunnels WHERE via_host_id = ?1) \
    + (SELECT count(*) FROM hops WHERE from_host_id = ?1 OR to_host_id = ?1) \
    + (SELECT count(*) FROM host_identity WHERE host_id = ?1) \
    + (SELECT count(*) FROM privesc_vectors WHERE host_id = ?1) \
    + (SELECT count(*) FROM engagements WHERE msf_host_id = ?1) \
    + (SELECT count(*) FROM checklist_items WHERE owner_id = ?1 AND (status_manual = 1 OR ifnull(notes, '') <> ''))";

/// Reverses the entry's extraction in one transaction and marks it undone. A no-op when already undone.
/// Snapshots are restored only onto rows not changed since the save; created rows are deleted, except a credential
/// edited since or proven by another entry, a username something else still uses, a vector edited since, and a host
/// that anything else still references. A credential or username another live (not undone) extraction created or
/// proved again stays too (spec §3.2).
pub fn undo(conn: &Connection, log_entry_id: &str) -> AppResult<Extraction> {
    let ext = get(conn, log_entry_id)?.ok_or(AppError::NotFound)?;
    if ext.undone_at.is_some() {
        return Ok(ext);
    }
    let at = ext.created_at;
    let r = &ext.record;
    let tx = conn.unchecked_transaction()?;

    // Credentials and usernames another live extraction of this engagement created or proved again.
    let mut kept_creds = std::collections::HashSet::new();
    let mut kept_users = std::collections::HashSet::new();
    for other in list(&tx, &ext.engagement_id)? {
        if other.log_entry_id == log_entry_id || other.undone_at.is_some() {
            continue;
        }
        kept_creds.extend(other.record.created_credential_ids.into_iter().chain(other.record.reproved_credential_ids));
        kept_users.extend(other.record.created_username_ids.into_iter().chain(other.record.reproved_username_ids));
    }

    // 1. Restore "before" snapshots onto rows nobody changed since the save.
    for s in &r.services_before {
        tx.execute(
            "UPDATE services SET state=?2, nmap_service=?3, nmap_version=?4, confirmed_product=?5, confirmed_version=?6, \
               confirmed_entry_id=(SELECT id FROM log_entries WHERE id=?7), verdict=?8, updated_at=?9 \
             WHERE id=?1 AND updated_at <= ?10",
            params![
                s.id, s.state, s.nmap_service, s.nmap_version, s.confirmed_product, s.confirmed_version,
                s.confirmed_entry_id, s.verdict, s.updated_at, at
            ],
        )?;
    }
    for h in &r.host_os_before {
        tx.execute(
            "UPDATE hosts SET os=?2, updated_at=?3 WHERE id=?1 AND updated_at <= ?4",
            params![h.host_id, h.os, system_now_ms(), at],
        )?;
    }
    for i in &r.identity_before {
        let current: Option<i64> = tx
            .query_row("SELECT updated_at FROM host_identity WHERE host_id=?1", [&i.host_id], |r| r.get(0))
            .optional()?;
        match (current, &i.identity) {
            (Some(u), _) if u > at => {}
            (None, _) => {}
            (Some(_), None) => {
                tx.execute("DELETE FROM host_identity WHERE host_id=?1", [&i.host_id])?;
            }
            (Some(_), Some(id)) => {
                let privileges = serde_json::to_string(&id.privileges).map_err(|e| AppError::Db(e.to_string()))?;
                let groups = serde_json::to_string(&id.groups).map_err(|e| AppError::Db(e.to_string()))?;
                tx.execute(
                    "UPDATE host_identity SET username=?2, privileges=?3, groups=?4, \
                       entry_id=(SELECT id FROM log_entries WHERE id=?5), updated_at=?6 WHERE host_id=?1",
                    params![i.host_id, id.username, privileges, groups, id.entry_id, id.updated_at],
                )?;
            }
        }
    }
    for c in &r.credentials_before {
        tx.execute(
            "UPDATE credentials SET type=?2, username=?3, domain=?4, secret=?5, hash_type=?6, scope=?7, \
               local_host_id=(SELECT id FROM hosts WHERE id=?8), source_host_id=(SELECT id FROM hosts WHERE id=?9), \
               source=?10, notes=?11, crack_status=?12, cracked_from=(SELECT id FROM credentials WHERE id=?13), \
               from_secret_id=(SELECT id FROM credentials WHERE id=?14), updated_at=?15 \
             WHERE id=?1 AND updated_at <= ?16",
            params![
                c.id, c.kind, c.username, c.domain, c.secret, c.hash_type, c.scope, c.local_host_id, c.source_host_id,
                c.source, c.notes, c.crack_status, c.cracked_from, c.from_secret_id, c.updated_at, at
            ],
        )?;
    }
    for a in &r.attempts_before {
        tx.execute(
            "UPDATE cred_attempts SET port=?2, result=?3, detail=?4, log_entry_id=(SELECT id FROM log_entries WHERE id=?5), at=?6 \
             WHERE id=?1 AND at <= ?7 AND ifnull(log_entry_id, '') = ?8",
            params![a.id, a.port, a.result, a.detail, a.log_entry_id, a.at, at, log_entry_id],
        )?;
    }

    // 2. Delete what the save created, dependants first. Attempts and tried pairs go only while they are still this
    // entry's: a later save that merged into the row (rewriting its log_entry_id) owns it now.
    let delete_ids = |sql: &str, ids: &[String]| -> AppResult<()> {
        for id in ids {
            tx.execute(sql, params![id, log_entry_id])?;
        }
        Ok(())
    };
    delete_ids("DELETE FROM tried_pairs WHERE id=?1 AND ifnull(log_entry_id, '') = ?2", &r.created_tried_pair_ids)?;
    delete_ids("DELETE FROM cred_attempts WHERE id=?1 AND ifnull(log_entry_id, '') = ?2", &r.created_attempt_ids)?;
    // A vector the owner took over (manual) or changed since stays.
    for id in &r.created_vector_ids {
        tx.execute("DELETE FROM privesc_vectors WHERE id=?1 AND source <> 'manual' AND updated_at <= ?2", params![id, at])?;
    }
    for id in r.created_credential_ids.iter().filter(|id| !kept_creds.contains(*id)) {
        tx.execute(
            "DELETE FROM credentials WHERE id=?1 AND updated_at <= ?2 \
             AND NOT EXISTS (SELECT 1 FROM cred_attempts WHERE cred_id=?1 AND ifnull(log_entry_id, '') <> ?3)",
            params![id, at, log_entry_id],
        )?;
    }
    // A username stays when something else still uses it: an attempt, grant or tried pair from another entry or made
    // by hand, or any credential left for that user (another entry's, hand-made, or one of ours kept above).
    for id in r.created_username_ids.iter().filter(|id| !kept_users.contains(*id)) {
        tx.execute(
            "DELETE FROM usernames WHERE id=?1 \
             AND NOT EXISTS (SELECT 1 FROM cred_attempts WHERE username_id=?1 AND ifnull(log_entry_id, '') <> ?2) \
             AND NOT EXISTS (SELECT 1 FROM access_grants WHERE username_id=?1 AND ifnull(log_entry_id, '') <> ?2) \
             AND NOT EXISTS (SELECT 1 FROM tried_pairs t WHERE t.engagement_id=usernames.engagement_id \
               AND lower(t.username)=lower(usernames.username) AND lower(ifnull(t.domain,''))=lower(ifnull(usernames.domain,'')) \
               AND ifnull(t.log_entry_id, '') <> ?2) \
             AND NOT EXISTS (SELECT 1 FROM credentials c WHERE c.engagement_id=usernames.engagement_id \
               AND lower(c.username)=lower(usernames.username) AND lower(ifnull(c.domain,''))=lower(ifnull(usernames.domain,'')))",
            params![id, log_entry_id],
        )?;
    }
    // A service changed since the save (the owner confirmed it, or a later scan updated it) or linked to a finding stays.
    for id in &r.created_service_ids {
        tx.execute(
            "DELETE FROM services WHERE id=?1 AND updated_at <= ?2 \
             AND NOT EXISTS (SELECT 1 FROM finding_services WHERE service_id=?1)",
            params![id, at],
        )?;
    }
    for id in &r.created_host_ids {
        let refs: i64 = tx.query_row(HOST_REFS, params![id, log_entry_id], |r| r.get(0))?;
        if refs == 0 {
            tx.execute("DELETE FROM hosts WHERE id=?1", [id])?;
            // checklist_items.owner_id has no FK; clean up as hosts::delete does.
            tx.execute("DELETE FROM checklist_items WHERE owner_id=?1", [id])?;
        }
    }

    tx.execute("UPDATE extractions SET undone_at=?2 WHERE log_entry_id=?1", params![log_entry_id, system_now_ms()])?;
    tx.commit()?;
    get(conn, log_entry_id)?.ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engagements::{self, EngagementInput};
    use crate::paths::DataPaths;
    use crate::vault::Vault;

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    struct Fx {
        e: String,
        h: String,
        entry: String,
    }

    /// An engagement, one existing host (10.10.1.5, linux, updated at 1) and one log entry `l1`.
    fn setup(c: &Connection) -> Fx {
        let e = engagements::create(
            c,
            EngagementInput {
                name: "e".into(),
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
        c.execute(
            "INSERT INTO hosts (id,engagement_id,name,ip,os,created_at,updated_at) VALUES ('h1',?1,'DC01','10.10.1.5','linux',1,1)",
            [&e],
        )
        .unwrap();
        log_entry(c, &e, "l1");
        Fx { e, h: "h1".into(), entry: "l1".into() }
    }

    fn log_entry(c: &Connection, e: &str, id: &str) {
        c.execute(
            "INSERT INTO log_entries (id,engagement_id,kind,title,content,at,created_at,updated_at) VALUES (?1,?2,'command','t','c',1,1,1)",
            params![id, e],
        )
        .unwrap();
    }

    fn count(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn cred(c: &Connection, e: &str, id: &str, secret: &str, updated_at: i64) {
        c.execute(
            "INSERT INTO credentials (id,engagement_id,type,username,domain,secret,scope,created_at,updated_at) \
             VALUES (?1,?2,'password','jay','corp.lan',?3,'domain',1,?4)",
            params![id, e, secret, updated_at],
        )
        .unwrap();
    }

    fn attempt(c: &Connection, e: &str, id: &str, cred_id: &str, host: &str, result: &str, entry: Option<&str>, at: i64) {
        c.execute(
            "INSERT INTO cred_attempts (id,engagement_id,cred_id,host_id,service,result,auth_mode,log_entry_id,at) \
             VALUES (?1,?2,?3,?4,'smb',?5,'domain',?6,?7)",
            params![id, e, cred_id, host, result, entry, at],
        )
        .unwrap();
    }

    fn save_now(c: &Connection, f: &Fx, record: ExtractionRecord) -> Extraction {
        let summary = ExtractionSummary { wins: vec!["Credential jay".into()], counts: vec![], ticks: vec![] };
        save(c, &f.entry, &f.e, &summary, &record).unwrap()
    }

    #[test]
    fn record_round_trips_camel_case_with_defaults() {
        let r: ExtractionRecord = serde_json::from_str(
            r#"{"createdHostIds":["h9"],"outputTicks":[{"ownerId":"h9","goalId":"g","parser":"nxc"}]}"#,
        )
        .unwrap();
        assert_eq!(r.created_host_ids, vec!["h9"]);
        assert!(r.services_before.is_empty() && r.identity_before.is_empty());
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["outputTicks"][0]["goalId"], "g");
        assert!(json["createdTriedPairIds"].as_array().unwrap().is_empty());
        assert!(json["reprovedCredentialIds"].as_array().unwrap().is_empty());
        assert!(json["reprovedUsernameIds"].as_array().unwrap().is_empty());
        let s: ExtractionSummary = serde_json::from_str("{}").unwrap();
        assert_eq!(s, ExtractionSummary::default());
    }

    #[test]
    fn save_get_and_list() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        assert_eq!(get(c, "l1").unwrap(), None);
        let rec = ExtractionRecord { created_host_ids: vec!["x".into()], ..Default::default() };
        let x = save_now(c, &f, rec.clone());
        assert_eq!((x.record.clone(), x.undone_at), (rec, None));
        assert_eq!(get(c, "l1").unwrap(), Some(x.clone()));
        assert_eq!(list(c, &f.e).unwrap(), vec![x]);
        assert!(matches!(save(c, "nope", &f.e, &ExtractionSummary::default(), &ExtractionRecord::default()), Err(AppError::NotFound)));
    }

    #[test]
    fn save_twice_is_rejected() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        let first = save_now(c, &f, ExtractionRecord { created_credential_ids: vec!["c1".into()], ..Default::default() });
        let undone = undo(c, "l1").unwrap();
        let again = save(c, "l1", &f.e, &ExtractionSummary::default(), &ExtractionRecord::default());
        assert!(matches!(again, Err(AppError::Conflict(_))));
        // The stored record, and its undone state, are untouched.
        let stored = get(c, "l1").unwrap().unwrap();
        assert_eq!((stored.record, stored.undone_at), (first.record, undone.undone_at));
    }

    #[test]
    fn undo_deletes_created_rows() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        // What the save created: a host + service, a credential + username + attempt, a tried pair and a vector.
        c.execute("INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h2',?1,'WEB01','10.10.1.6',1,1)", [&f.e]).unwrap();
        c.execute("INSERT INTO log_entry_hosts (entry_id,host_id) VALUES ('l1','h2')", []).unwrap();
        c.execute("INSERT INTO services (id,host_id,port,created_at,updated_at) VALUES ('s1','h2',445,1,1)", []).unwrap();
        c.execute("INSERT INTO checklist_items (owner_id,engagement_id,goal_id,status,auto,updated_at) VALUES ('h2',?1,'g','done',1,1)", [&f.e]).unwrap();
        cred(c, &f.e, "c1", "Winter2024!", 1);
        c.execute("INSERT INTO usernames (id,engagement_id,username,domain,created_at) VALUES ('u1',?1,'jay','corp.lan',1)", [&f.e]).unwrap();
        attempt(c, &f.e, "a1", "c1", &f.h, "valid", Some("l1"), 1);
        c.execute(
            "INSERT INTO tried_pairs (id,engagement_id,username,secret,secret_kind,host_id,service,auth_mode,log_entry_id,at) \
             VALUES ('t1',?1,'drew','Spring2024!','password','h1','smb','domain','l1',1)",
            [&f.e],
        )
        .unwrap();
        c.execute("INSERT INTO privesc_vectors (id,host_id,title,status,source,created_at,updated_at) VALUES ('v1','h1','SeImpersonate','try','auto',1,1)", []).unwrap();
        let x = save_now(
            c,
            &f,
            ExtractionRecord {
                created_host_ids: vec!["h2".into()],
                created_service_ids: vec!["s1".into()],
                created_credential_ids: vec!["c1".into()],
                created_username_ids: vec!["u1".into()],
                created_attempt_ids: vec!["a1".into()],
                created_tried_pair_ids: vec!["t1".into()],
                created_vector_ids: vec!["v1".into()],
                ..Default::default()
            },
        );
        let u = undo(c, "l1").unwrap();
        assert!(u.undone_at.is_some());
        assert_eq!(u.record, x.record);
        for t in ["services", "credentials", "usernames", "cred_attempts", "tried_pairs", "privesc_vectors", "checklist_items"] {
            assert_eq!(count(c, &format!("SELECT count(*) FROM {t}")), 0, "{t}");
        }
        assert_eq!(count(c, "SELECT count(*) FROM hosts WHERE id='h2'"), 0);
        // The pre-existing host and the entry itself stay.
        assert_eq!(count(c, "SELECT count(*) FROM hosts WHERE id='h1'"), 1);
        assert_eq!(count(c, "SELECT count(*) FROM log_entries WHERE id='l1'"), 1);
    }

    #[test]
    fn undo_keeps_created_service_changed_since_or_linked() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        for (id, port) in [("s1", 80), ("s2", 445), ("s3", 3389)] {
            c.execute("INSERT INTO services (id,host_id,port,created_at,updated_at) VALUES (?1,'h1',?2,1,1)", params![id, port]).unwrap();
        }
        let x = save_now(c, &f, ExtractionRecord { created_service_ids: ["s1", "s2", "s3"].map(String::from).to_vec(), ..Default::default() });
        // s1: the owner confirmed product/version after the save. s2: linked to a finding. s3: untouched.
        c.execute("UPDATE services SET confirmed_product='Apache httpd', confirmed_version='2.4.41', updated_at=?1 WHERE id='s1'", [x.created_at + 1]).unwrap();
        c.execute(
            "INSERT INTO findings (id,engagement_id,title,created_at,updated_at) VALUES ('fd1',?1,'SMB signing',1,1)",
            [&f.e],
        )
        .unwrap();
        c.execute("INSERT INTO finding_services (finding_id,service_id) VALUES ('fd1','s2')", []).unwrap();
        undo(c, "l1").unwrap();
        let left: Vec<String> =
            c.prepare("SELECT id FROM services ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect();
        assert_eq!(left, vec!["s1", "s2"]);
        assert_eq!(count(c, "SELECT count(*) FROM finding_services"), 1);
    }

    #[test]
    fn undo_keeps_created_host_referenced_elsewhere() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        c.execute("INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h2',?1,'WEB01','10.10.1.6',1,1)", [&f.e]).unwrap();
        log_entry(c, &f.e, "l2");
        c.execute("INSERT INTO log_entry_hosts (entry_id,host_id) VALUES ('l2','h2')", []).unwrap();
        save_now(c, &f, ExtractionRecord { created_host_ids: vec!["h2".into()], ..Default::default() });
        undo(c, "l1").unwrap();
        assert_eq!(count(c, "SELECT count(*) FROM hosts WHERE id='h2'"), 1);
    }

    #[test]
    fn undo_keeps_credential_edited_since() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        cred(c, &f.e, "c1", "Winter2024!", 1);
        cred(c, &f.e, "c2", "Spring2024!", 1);
        attempt(c, &f.e, "a1", "c2", &f.h, "valid", Some("l1"), 1);
        let x = save_now(
            c,
            &f,
            ExtractionRecord {
                created_credential_ids: vec!["c1".into(), "c2".into()],
                created_attempt_ids: vec!["a1".into()],
                ..Default::default()
            },
        );
        // The owner edits c1 after the save.
        c.execute("UPDATE credentials SET notes='keep', updated_at=?1 WHERE id='c1'", [x.created_at + 1]).unwrap();
        undo(c, "l1").unwrap();
        assert_eq!(count(c, "SELECT count(*) FROM credentials WHERE id='c1'"), 1);
        assert_eq!(count(c, "SELECT count(*) FROM credentials WHERE id='c2'"), 0);
        assert_eq!(count(c, "SELECT count(*) FROM cred_attempts"), 0);
    }

    #[test]
    fn undo_keeps_credential_proven_by_later_entry() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        log_entry(c, &f.e, "l2");
        c.execute("INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h2',?1,'WEB01','10.10.1.6',1,1)", [&f.e]).unwrap();
        cred(c, &f.e, "c1", "Winter2024!", 1);
        attempt(c, &f.e, "a1", "c1", &f.h, "valid", Some("l1"), 1);
        // A later entry proved the same credential on another host.
        attempt(c, &f.e, "a2", "c1", "h2", "admin", Some("l2"), 1);
        save_now(
            c,
            &f,
            ExtractionRecord {
                created_credential_ids: vec!["c1".into()],
                created_attempt_ids: vec!["a1".into()],
                ..Default::default()
            },
        );
        undo(c, "l1").unwrap();
        assert_eq!(count(c, "SELECT count(*) FROM credentials WHERE id='c1'"), 1);
        assert_eq!(count(c, "SELECT count(*) FROM cred_attempts WHERE id='a1'"), 0);
        assert_eq!(count(c, "SELECT count(*) FROM cred_attempts WHERE id='a2'"), 1);
    }

    #[test]
    fn undo_keeps_rows_a_later_save_proved_again() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        log_entry(c, &f.e, "l2");
        cred(c, &f.e, "c1", "aad3b435b51404eeaad3b435b51404ee:22222222222222222222222222222222", 1);
        cred(c, &f.e, "c2", "Winter2024!", 1);
        for (id, user) in [("u1", "jay"), ("u2", "drew")] {
            c.execute("INSERT INTO usernames (id,engagement_id,username,domain,created_at) VALUES (?1,?2,?3,'nowhere.local',1)", params![id, f.e, user]).unwrap();
        }
        c.execute("UPDATE credentials SET username='mia' WHERE id IN ('c1','c2')", []).unwrap();
        save_now(
            c,
            &f,
            ExtractionRecord {
                created_credential_ids: vec!["c1".into(), "c2".into()],
                created_username_ids: vec!["u1".into(), "u2".into()],
                ..Default::default()
            },
        );
        // l2 dumped the same hash and listed jay again; it created nothing.
        let s = ExtractionSummary::default();
        let later = ExtractionRecord { reproved_credential_ids: vec!["c1".into()], reproved_username_ids: vec!["u1".into()], ..Default::default() };
        save(c, "l2", &f.e, &s, &later).unwrap();
        undo(c, "l1").unwrap();
        let ids = |sql: &str| -> Vec<String> { c.prepare(sql).unwrap().query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect() };
        assert_eq!(ids("SELECT id FROM credentials ORDER BY id"), vec!["c1"]);
        assert_eq!(ids("SELECT id FROM usernames ORDER BY id"), vec!["u1"]);
    }

    #[test]
    fn undo_ignores_an_undone_extraction_that_proved_again() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        log_entry(c, &f.e, "l2");
        cred(c, &f.e, "c1", "Winter2024!", 1);
        save_now(c, &f, ExtractionRecord { created_credential_ids: vec!["c1".into()], ..Default::default() });
        let later = ExtractionRecord { reproved_credential_ids: vec!["c1".into()], ..Default::default() };
        save(c, "l2", &f.e, &ExtractionSummary::default(), &later).unwrap();
        undo(c, "l2").unwrap();
        undo(c, "l1").unwrap();
        assert_eq!(count(c, "SELECT count(*) FROM credentials"), 0);
    }

    #[test]
    fn undo_restores_identity_and_os_snapshots() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        c.execute("INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h3',?1,'FILES01','10.10.1.7',1,1)", [&f.e]).unwrap();
        log_entry(c, &f.e, "l0");
        let before = HostIdentity {
            host_id: "h1".into(),
            username: "corp\\drew".into(),
            privileges: vec!["SeShutdownPrivilege".into()],
            groups: vec!["Users".into()],
            entry_id: Some("l0".into()),
            updated_at: 1,
        };
        // The save: h1 os linux -> windows, identity drew -> jay; h3 got its first identity.
        c.execute("UPDATE hosts SET os='windows' WHERE id='h1'", []).unwrap();
        c.execute(
            "INSERT INTO host_identity (host_id,username,privileges,groups,entry_id,updated_at) VALUES \
             ('h1','corp\\jay','[\"SeImpersonatePrivilege\"]','[]','l1',2), ('h3','nt authority\\system','[]','[]','l1',2)",
            [],
        )
        .unwrap();
        save_now(
            c,
            &f,
            ExtractionRecord {
                host_os_before: vec![HostOsBefore { host_id: "h1".into(), os: Some("linux".into()) }],
                identity_before: vec![
                    IdentityBefore { host_id: "h1".into(), identity: Some(before.clone()) },
                    IdentityBefore { host_id: "h3".into(), identity: None },
                ],
                ..Default::default()
            },
        );
        undo(c, "l1").unwrap();
        let os: Option<String> = c.query_row("SELECT os FROM hosts WHERE id='h1'", [], |r| r.get(0)).unwrap();
        assert_eq!(os.as_deref(), Some("linux"));
        assert_eq!(crate::host_facts::identity_get(c, "h1").unwrap(), Some(before));
        assert_eq!(crate::host_facts::identity_get(c, "h3").unwrap(), None);
    }

    #[test]
    fn undo_leaves_snapshot_rows_changed_since() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        c.execute("INSERT INTO host_identity (host_id,username,privileges,groups,updated_at) VALUES ('h1','corp\\jay','[]','[]',2)", []).unwrap();
        let x = save_now(
            c,
            &f,
            ExtractionRecord {
                host_os_before: vec![HostOsBefore { host_id: "h1".into(), os: None }],
                identity_before: vec![IdentityBefore { host_id: "h1".into(), identity: None }],
                ..Default::default()
            },
        );
        c.execute("UPDATE hosts SET os='windows', updated_at=?1 WHERE id='h1'", [x.created_at + 1]).unwrap();
        c.execute("UPDATE host_identity SET username='corp\\drew', updated_at=?1 WHERE host_id='h1'", [x.created_at + 1]).unwrap();
        undo(c, "l1").unwrap();
        let os: Option<String> = c.query_row("SELECT os FROM hosts WHERE id='h1'", [], |r| r.get(0)).unwrap();
        assert_eq!(os.as_deref(), Some("windows"));
        assert_eq!(crate::host_facts::identity_get(c, "h1").unwrap().unwrap().username, "corp\\drew");
    }

    #[test]
    fn undo_restores_attempt_result_before() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        log_entry(c, &f.e, "l0");
        cred(c, &f.e, "c1", "Winter2024!", 1);
        attempt(c, &f.e, "a1", "c1", &f.h, "failed", Some("l0"), 1);
        let before: CredAttempt = crate::attempts::list(c, &f.e).unwrap().remove(0);
        // This save upgraded the attempt to admin and cracked c1's hash... (credential snapshot too).
        cred(c, &f.e, "c0", "aad3b435b51404eeaad3b435b51404ee:11111111111111111111111111111111", 1);
        c.execute("UPDATE credentials SET crack_status='uncracked', type='hash' WHERE id='c0'", []).unwrap();
        let cred_before: Credential = crate::credentials::list(c, &f.e).unwrap().into_iter().find(|x| x.id == "c0").unwrap();
        c.execute("UPDATE cred_attempts SET result='admin', log_entry_id='l1', at=2 WHERE id='a1'", []).unwrap();
        c.execute("UPDATE credentials SET crack_status='cracked', updated_at=2 WHERE id='c0'", []).unwrap();
        save_now(
            c,
            &f,
            ExtractionRecord { attempts_before: vec![before.clone()], credentials_before: vec![cred_before.clone()], ..Default::default() },
        );
        undo(c, "l1").unwrap();
        assert_eq!(crate::attempts::list(c, &f.e).unwrap(), vec![before]);
        let now_c0 = crate::credentials::list(c, &f.e).unwrap().into_iter().find(|x| x.id == "c0").unwrap();
        assert_eq!(now_c0, cred_before);
    }

    #[test]
    fn undo_keeps_attempt_merged_by_later_entry() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        log_entry(c, &f.e, "l2");
        cred(c, &f.e, "c1", "Winter2024!", 1);
        let input = |result: &str, entry: &str| crate::attempts::CredAttemptInput {
            cred_id: "c1".into(),
            username_id: None,
            host_id: f.h.clone(),
            service: "smb".into(),
            port: None,
            result: result.into(),
            auth_mode: None,
            detail: None,
            log_entry_id: Some(entry.into()),
            at: None,
        };
        // l1 files c1 + a1 (valid on DC01); its record is written after the save.
        let a1 = crate::attempts::upsert(c, &f.e, &[input("valid", "l1")]).unwrap().remove(0);
        save_now(
            c,
            &f,
            ExtractionRecord { created_credential_ids: vec!["c1".into()], created_attempt_ids: vec![a1.id.clone()], ..Default::default() },
        );
        // l2 proves admin with the same pair: the upsert merges into a1 and takes it over.
        let merged = crate::attempts::upsert(c, &f.e, &[input("admin", "l2")]).unwrap().remove(0);
        assert_eq!((merged.id.as_str(), merged.result.as_str(), merged.log_entry_id.as_deref()), (a1.id.as_str(), "admin", Some("l2")));
        undo(c, "l1").unwrap();
        assert_eq!(crate::attempts::list(c, &f.e).unwrap(), vec![merged]);
        assert_eq!(count(c, "SELECT count(*) FROM credentials WHERE id='c1'"), 1);
    }

    #[test]
    fn undo_keeps_username_used_by_later_entry() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        log_entry(c, &f.e, "l2");
        for (id, user) in [("u1", "jay"), ("u2", "drew"), ("u3", "paul"), ("u4", "mia"), ("u5", "sam"), ("u6", "tom")] {
            c.execute("INSERT INTO usernames (id,engagement_id,username,domain,created_at) VALUES (?1,?2,?3,'corp.lan',1)", params![id, f.e, user]).unwrap();
        }
        cred(c, &f.e, "c9", "Summer2024!", 1); // a credential for jay from elsewhere (not in this record)
        c.execute("UPDATE credentials SET username='JAY' WHERE id='c9'", []).unwrap();
        cred(c, &f.e, "c1", "Winter2024!", 1);
        c.execute("UPDATE credentials SET username='mia' WHERE id='c1'", []).unwrap();
        // drew: a later entry's attempt; paul: a hand-made access grant; sam: only this entry's own attempt.
        attempt(c, &f.e, "a2", "c9", &f.h, "valid", Some("l2"), 1);
        c.execute("UPDATE cred_attempts SET username_id='u2' WHERE id='a2'", []).unwrap();
        c.execute("INSERT INTO access_grants (id,engagement_id,username_id,host_id,level,via,at) VALUES ('g1',?1,'u3','h1','user','rdp',1)", [&f.e]).unwrap();
        attempt(c, &f.e, "a1", "c1", &f.h, "valid", Some("l1"), 1);
        c.execute("UPDATE cred_attempts SET username_id='u5' WHERE id='a1'", []).unwrap();
        // tom: a tried pair a later entry filed.
        c.execute(
            "INSERT INTO tried_pairs (id,engagement_id,username,domain,secret,secret_kind,host_id,service,auth_mode,log_entry_id,at) \
             VALUES ('t1',?1,'Tom','CORP.LAN','Spring2024!','password','h1','smb','domain','l2',1)",
            [&f.e],
        )
        .unwrap();
        save_now(
            c,
            &f,
            ExtractionRecord {
                created_username_ids: ["u1", "u2", "u3", "u4", "u5", "u6"].map(String::from).to_vec(),
                created_credential_ids: vec!["c1".into()],
                created_attempt_ids: vec!["a1".into()],
                ..Default::default()
            },
        );
        undo(c, "l1").unwrap();
        let left: Vec<String> =
            c.prepare("SELECT id FROM usernames ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect();
        // u4 (mia) went with this entry's credential; u5 only had this entry's attempt.
        assert_eq!(left, vec!["u1", "u2", "u3", "u6"]);
        assert_eq!(count(c, "SELECT count(*) FROM cred_attempts WHERE id='a2'"), 1);
    }

    #[test]
    fn undo_keeps_vector_edited_since() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        for (id, title) in [("v1", "SeImpersonate"), ("v2", "AlwaysInstallElevated"), ("v3", "Unquoted path")] {
            c.execute("INSERT INTO privesc_vectors (id,host_id,title,status,source,created_at,updated_at) VALUES (?1,'h1',?2,'try','auto',1,1)", params![id, title]).unwrap();
        }
        let x = save_now(c, &f, ExtractionRecord { created_vector_ids: ["v1", "v2", "v3"].map(String::from).to_vec(), ..Default::default() });
        c.execute("UPDATE privesc_vectors SET status='ruled_out', updated_at=?1 WHERE id='v1'", [x.created_at + 1]).unwrap();
        c.execute("UPDATE privesc_vectors SET source='manual' WHERE id='v2'", []).unwrap();
        undo(c, "l1").unwrap();
        let left: Vec<String> =
            c.prepare("SELECT id FROM privesc_vectors ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect();
        assert_eq!(left, vec!["v1", "v2"]);
    }

    #[test]
    fn undo_twice_is_noop() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        cred(c, &f.e, "c1", "Winter2024!", 1);
        save_now(c, &f, ExtractionRecord { created_credential_ids: vec!["c1".into()], ..Default::default() });
        let first = undo(c, "l1").unwrap();
        // Re-filed by hand with the same id: a second undo must not touch it.
        cred(c, &f.e, "c1", "Winter2024!", 1);
        let second = undo(c, "l1").unwrap();
        assert_eq!(first, second);
        assert_eq!(count(c, "SELECT count(*) FROM credentials WHERE id='c1'"), 1);
        assert!(matches!(undo(c, "missing"), Err(AppError::NotFound)));
    }

    #[test]
    fn deleting_log_entry_cascades_extraction() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let f = setup(c);
        cred(c, &f.e, "c1", "Winter2024!", 1);
        save_now(c, &f, ExtractionRecord { created_credential_ids: vec!["c1".into()], ..Default::default() });
        crate::log::delete(c, "l1").unwrap();
        assert_eq!(get(c, "l1").unwrap(), None);
        assert_eq!(count(c, "SELECT count(*) FROM extractions"), 0);
        // Delete isn't undo: the filed credential stays.
        assert_eq!(count(c, "SELECT count(*) FROM credentials WHERE id='c1'"), 1);
    }
}
