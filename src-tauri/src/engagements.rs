//! Engagement repository.

use crate::backup::system_now_ms;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

const COLS: &str = "id, name, kind, client, sub_label, scope_cidrs, domain, starts_at, ends_at, \
                    timebox_start, timebox_minutes, status, created_at, updated_at, last_activity_at, last_ran_on, msf_host_id, \
                    timebox_paused_ms, timebox_paused_at";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Engagement {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub client: Option<String>,
    pub sub_label: Option<String>,
    pub scope_cidrs: Vec<String>,
    pub domain: Option<String>,
    pub starts_at: Option<i64>,
    pub ends_at: Option<i64>,
    pub timebox_start: Option<i64>,
    pub timebox_minutes: Option<i64>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_activity_at: Option<i64>,
    pub last_ran_on: Option<String>,
    /// The host that holds the Metasploit lock, if any.
    pub msf_host_id: Option<String>,
    /// Exam sims: time the timebox has spent paused, not counting a pause still running.
    pub timebox_paused_ms: i64,
    /// Exam sims: when the running pause began; `None` while the timebox runs.
    pub timebox_paused_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngagementInput {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub client: Option<String>,
    #[serde(default)]
    pub sub_label: Option<String>,
    #[serde(default)]
    pub scope_cidrs: Vec<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub starts_at: Option<i64>,
    #[serde(default)]
    pub ends_at: Option<i64>,
    #[serde(default)]
    pub timebox_start: Option<i64>,
    #[serde(default)]
    pub timebox_minutes: Option<i64>,
}

fn invalid(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

pub(crate) fn valid_cidr(s: &str) -> bool {
    let (ip, prefix) = match s.split_once('/') {
        Some((ip, p)) => (ip, Some(p)),
        None => (s, None),
    };
    if let Some(p) = prefix
        && (p.is_empty() || p.len() > 2 || (p.len() > 1 && p.starts_with('0')) || !p.bytes().all(|b| b.is_ascii_digit()) || p.parse::<u8>().map_or(true, |n| n > 32)) {
            return false;
        }
    let parts: Vec<&str> = ip.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|o| !o.is_empty() && o.len() <= 3 && !(o.len() > 1 && o.starts_with('0')) && o.bytes().all(|b| b.is_ascii_digit()) && o.parse::<u16>().is_ok_and(|n| n <= 255))
}

fn opt_trim(v: &Option<String>) -> Option<String> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Validated, normalised input ready to store.
fn normalise(mut i: EngagementInput) -> AppResult<EngagementInput> {
    i.name = i.name.trim().to_string();
    if i.name.is_empty() || i.name.chars().count() > 120 {
        return Err(invalid("name", "name must be 1-120 characters"));
    }
    if !matches!(i.kind.as_str(), "exam-sim" | "lab" | "client") {
        return Err(invalid("kind", "kind must be exam-sim, lab or client"));
    }
    i.client = opt_trim(&i.client);
    i.sub_label = opt_trim(&i.sub_label);
    i.domain = opt_trim(&i.domain);
    i.scope_cidrs = i.scope_cidrs.iter().map(|c| c.trim().to_string()).collect();
    if let Some(bad) = i.scope_cidrs.iter().find(|c| !valid_cidr(c)) {
        return Err(invalid("scopeCidrs", &format!("invalid IPv4 CIDR: {bad}")));
    }
    if let (Some(s), Some(e)) = (i.starts_at, i.ends_at)
        && e < s {
            return Err(invalid("endsAt", "end must not be before start"));
        }
    if i.kind != "exam-sim" {
        i.timebox_start = None;
        i.timebox_minutes = None;
    } else if let Some(m) = i.timebox_minutes
        && !(1..=4320).contains(&m) {
            return Err(invalid("timeboxMinutes", "timebox must be 1-4320 minutes"));
        }
    Ok(i)
}

fn from_row(r: &Row) -> rusqlite::Result<Engagement> {
    let cidrs: String = r.get(5)?;
    Ok(Engagement {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        client: r.get(3)?,
        sub_label: r.get(4)?,
        scope_cidrs: serde_json::from_str(&cidrs).unwrap_or_default(),
        domain: r.get(6)?,
        starts_at: r.get(7)?,
        ends_at: r.get(8)?,
        timebox_start: r.get(9)?,
        timebox_minutes: r.get(10)?,
        status: r.get(11)?,
        created_at: r.get(12)?,
        updated_at: r.get(13)?,
        last_activity_at: r.get(14)?,
        last_ran_on: r.get(15)?,
        msf_host_id: r.get(16)?,
        timebox_paused_ms: r.get(17)?,
        timebox_paused_at: r.get(18)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Engagement>> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM engagements ORDER BY status ASC, COALESCE(last_activity_at, updated_at) DESC, created_at DESC, rowid DESC"
    ))?;
    let rows = st.query_map([], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Engagement> {
    match conn.query_row(&format!("SELECT {COLS} FROM engagements WHERE id = ?1"), [id], from_row) {
        Ok(e) => Ok(e),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
}

pub fn create(conn: &Connection, input: EngagementInput) -> AppResult<Engagement> {
    let i = normalise(input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = system_now_ms();
    // The scope sync shares the transaction: both land or neither does.
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO engagements (id, name, kind, client, sub_label, scope_cidrs, domain, starts_at, ends_at, \
         timebox_start, timebox_minutes, status, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'active',?12,?12)",
        params![
            id, i.name, i.kind, i.client, i.sub_label,
            serde_json::to_string(&i.scope_cidrs).map_err(|e| AppError::Db(e.to_string()))?,
            i.domain, i.starts_at, i.ends_at, i.timebox_start, i.timebox_minutes, now
        ],
    )?;
    crate::hosts::sync_scope(&tx, &id, &i.scope_cidrs)?;
    tx.commit()?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: EngagementInput) -> AppResult<Engagement> {
    let i = normalise(input)?;
    let tx = conn.unchecked_transaction()?;
    let previous: Vec<String> = match tx.query_row("SELECT scope_cidrs FROM engagements WHERE id = ?1", params![id], |r| r.get::<_, String>(0)) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(rusqlite::Error::QueryReturnedNoRows) => return Err(AppError::NotFound),
        Err(e) => return Err(e.into()),
    };
    let n = tx.execute(
        "UPDATE engagements SET name=?2, kind=?3, client=?4, sub_label=?5, scope_cidrs=?6, domain=?7, \
         starts_at=?8, ends_at=?9, timebox_start=?10, timebox_minutes=?11, updated_at=?12, \
         timebox_paused_ms = CASE WHEN ?10 IS NULL OR ?11 IS NULL THEN 0 ELSE timebox_paused_ms END, \
         timebox_paused_at = CASE WHEN ?10 IS NULL OR ?11 IS NULL THEN NULL ELSE timebox_paused_at END \
         WHERE id=?1",
        params![
            id, i.name, i.kind, i.client, i.sub_label,
            serde_json::to_string(&i.scope_cidrs).map_err(|e| AppError::Db(e.to_string()))?,
            i.domain, i.starts_at, i.ends_at, i.timebox_start, i.timebox_minutes, system_now_ms()
        ],
    )?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    crate::hosts::sync_scope_added(&tx, id, &previous, &i.scope_cidrs)?;
    tx.commit()?;
    get(conn, id)
}

/// Remembers the machine label last used for a log entry (the capture panel's default).
pub fn set_last_ran_on(conn: &Connection, id: &str, value: Option<&str>) -> AppResult<()> {
    if conn.execute("UPDATE engagements SET last_ran_on = ?2 WHERE id = ?1", params![id, value])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Sets or clears the Metasploit lock. The host must belong to the engagement.
pub fn set_msf_host(conn: &Connection, id: &str, host_id: Option<&str>) -> AppResult<Engagement> {
    crate::notes::check_scope(conn, id, host_id)?;
    conn.execute("UPDATE engagements SET msf_host_id = ?2, updated_at = ?3 WHERE id = ?1", params![id, host_id, system_now_ms()])?;
    get(conn, id)
}

/// Pauses or resumes an exam sim's timebox. Pausing an already paused timebox, or resuming a running
/// one, changes nothing. Only a started exam-sim timebox can pause.
pub fn set_timebox_paused(conn: &Connection, id: &str, paused: bool) -> AppResult<Engagement> {
    let e = get(conn, id)?;
    let now = system_now_ms();
    if paused {
        if e.timebox_paused_at.is_some() {
            return Ok(e);
        }
        match (e.kind.as_str(), e.timebox_start, e.timebox_minutes) {
            ("exam-sim", Some(start), Some(_)) if start <= now => {}
            _ => return Err(invalid("timeboxPaused", "only a started exam-sim timebox can pause")),
        }
        conn.execute("UPDATE engagements SET timebox_paused_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    } else {
        let Some(at) = e.timebox_paused_at else { return Ok(e) };
        conn.execute(
            "UPDATE engagements SET timebox_paused_ms = timebox_paused_ms + ?2, timebox_paused_at = NULL, updated_at = ?3 WHERE id = ?1",
            params![id, (now - at).max(0), now],
        )?;
    }
    get(conn, id)
}

/// Per-engagement host and flag progress. `flags_total` is 2 per host (local + proof).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub hosts_total: i64,
    pub hosts_rooted: i64,
    pub flags_found: i64,
    pub flags_total: i64,
}

/// Exam sims count the AD set (every host whose effective `ad_set` is on) as ONE target and ONE
/// flag, the proof.txt on the DC; every other host keeps its local + proof pair.
fn exam_sim_progress(conn: &Connection) -> AppResult<std::collections::HashMap<String, Progress>> {
    let sql = format!(
        "SELECT h.engagement_id, {ad} AS ad,
           EXISTS(SELECT 1 FROM log_entry_hosts lh JOIN log_entries l ON l.id = lh.entry_id
                  WHERE lh.host_id = h.id AND l.engagement_id = h.engagement_id AND l.kind = 'flag' AND json_extract(l.content, '$.flagKind') = 'local'),
           EXISTS(SELECT 1 FROM log_entry_hosts lh JOIN log_entries l ON l.id = lh.entry_id
                  WHERE lh.host_id = h.id AND l.engagement_id = h.engagement_id AND l.kind = 'flag' AND json_extract(l.content, '$.flagKind') = 'proof')
         FROM hosts h JOIN engagements e ON e.id = h.engagement_id WHERE e.kind = 'exam-sim'",
        ad = crate::hosts::ad_effective_sql("h")
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0, r.get::<_, i64>(2)? != 0, r.get::<_, i64>(3)? != 0))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut out: std::collections::HashMap<String, Progress> = std::collections::HashMap::new();
    let mut ad_proof: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    for (eid, ad, local, proof) in rows {
        if ad {
            *ad_proof.entry(eid).or_default() |= proof;
        } else {
            let p = out.entry(eid).or_default();
            p.hosts_total += 1;
            p.flags_total += 2;
            p.hosts_rooted += proof as i64;
            p.flags_found += local as i64 + proof as i64;
        }
    }
    for (eid, proof) in ad_proof {
        let p = out.entry(eid).or_default();
        p.hosts_total += 1;
        p.flags_total += 1;
        p.hosts_rooted += proof as i64;
        p.flags_found += proof as i64;
    }
    Ok(out)
}

pub fn progress_all(conn: &Connection) -> AppResult<std::collections::HashMap<String, Progress>> {
    let mut out = std::collections::HashMap::new();
    let mut st = conn.prepare(
        "SELECT e.id,
           (SELECT COUNT(*) FROM hosts h WHERE h.engagement_id = e.id),
           (SELECT COUNT(DISTINCT lh.host_id) FROM log_entry_hosts lh JOIN log_entries l ON l.id = lh.entry_id
              WHERE l.engagement_id = e.id AND l.kind = 'flag' AND json_extract(l.content, '$.flagKind') = 'proof'),
           (SELECT COUNT(*) FROM (SELECT DISTINCT lh.host_id, json_extract(l.content, '$.flagKind')
              FROM log_entry_hosts lh JOIN log_entries l ON l.id = lh.entry_id
              WHERE l.engagement_id = e.id AND l.kind = 'flag'))
         FROM engagements e",
    )?;
    let rows = st.query_map([], |r| {
        let total: i64 = r.get(1)?;
        Ok((
            r.get::<_, String>(0)?,
            Progress { hosts_total: total, hosts_rooted: r.get(2)?, flags_found: r.get(3)?, flags_total: total * 2 },
        ))
    })?;
    for row in rows {
        let (id, p) = row?;
        out.insert(id, p);
    }
    // Exam sims: the AD set counts once. An exam sim with no hosts keeps its zero row from above.
    out.extend(exam_sim_progress(conn)?);
    Ok(out)
}

pub fn set_status(conn: &Connection, id: &str, status: &str) -> AppResult<Engagement> {
    if !matches!(status, "active" | "archived") {
        return Err(invalid("status", "status must be active or archived"));
    }
    let n = conn.execute("UPDATE engagements SET status=?2, updated_at=?3 WHERE id=?1", params![id, status, system_now_ms()])?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM engagements WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::paths::DataPaths;
    use crate::vault::Vault;

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    fn input(name: &str, kind: &str) -> EngagementInput {
        EngagementInput {
            name: name.into(),
            kind: kind.into(),
            client: None,
            sub_label: None,
            scope_cidrs: vec![],
            domain: None,
            starts_at: None,
            ends_at: None,
            timebox_start: None,
            timebox_minutes: None,
        }
    }

    fn field(r: AppResult<Engagement>) -> String {
        match r {
            Err(AppError::Validation { field, .. }) => field,
            o => panic!("expected validation, got {o:?}"),
        }
    }

    #[test]
    fn create_and_list_engagement() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let mut i = input("  PEN-200 mock  ", "exam-sim");
        i.scope_cidrs = vec!["10.0.0.0/24".into()];
        i.timebox_minutes = Some(1440);
        let e = create(c, i).unwrap();
        assert_eq!(e.name, "PEN-200 mock");
        assert_eq!(e.status, "active");
        assert_eq!(e.id.len(), 36);
        assert_eq!(e.created_at, e.updated_at);
        assert_eq!(e.last_activity_at, None);
        assert_eq!(e.last_ran_on, None);
        assert_eq!(e.timebox_minutes, Some(1440));
        let all = list(c).unwrap();
        assert_eq!(all, vec![e.clone()]);
        assert_eq!(get(c, &e.id).unwrap(), e);
        let j = serde_json::to_value(&e).unwrap();
        assert_eq!(j["scopeCidrs"][0], "10.0.0.0/24");
        assert!(j.get("subLabel").is_some() && j.get("lastActivityAt").is_some());
    }

    #[test]
    fn timebox_pause_and_resume_accumulate() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let mut i = input("sim", "exam-sim");
        i.timebox_start = Some(system_now_ms() - 60_000);
        i.timebox_minutes = Some(1425);
        let e = create(c, i.clone()).unwrap();
        assert_eq!((e.timebox_paused_ms, e.timebox_paused_at), (0, None));
        // Resuming a running timebox changes nothing.
        assert_eq!(set_timebox_paused(c, &e.id, false).unwrap().timebox_paused_at, None);
        let p = set_timebox_paused(c, &e.id, true).unwrap();
        let at = p.timebox_paused_at.expect("paused");
        // Pausing twice keeps the first pause's start.
        assert_eq!(set_timebox_paused(c, &e.id, true).unwrap().timebox_paused_at, Some(at));
        // Pretend the pause began 10 minutes ago.
        c.execute("UPDATE engagements SET timebox_paused_at = ?2 WHERE id = ?1", params![e.id, at - 600_000]).unwrap();
        let r = set_timebox_paused(c, &e.id, false).unwrap();
        assert_eq!(r.timebox_paused_at, None);
        assert!(r.timebox_paused_ms >= 600_000 && r.timebox_paused_ms < 660_000, "{}", r.timebox_paused_ms);
        // Editing the engagement keeps the paused total; clearing the timebox resets it.
        assert_eq!(update(c, &e.id, i.clone()).unwrap().timebox_paused_ms, r.timebox_paused_ms);
        set_timebox_paused(c, &e.id, true).unwrap();
        let mut cleared = i.clone();
        cleared.timebox_start = None;
        let u = update(c, &e.id, cleared).unwrap();
        assert_eq!((u.timebox_paused_ms, u.timebox_paused_at), (0, None));
    }

    #[test]
    fn timebox_pause_needs_a_started_exam_sim_timebox() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let lab = create(c, input("lab", "lab")).unwrap();
        assert_eq!(field(set_timebox_paused(c, &lab.id, true)), "timeboxPaused");
        let mut i = input("sim", "exam-sim");
        i.timebox_minutes = Some(1425);
        let not_started = create(c, i.clone()).unwrap();
        assert_eq!(field(set_timebox_paused(c, &not_started.id, true)), "timeboxPaused");
        i.timebox_start = Some(system_now_ms() + 3_600_000);
        let future = create(c, i).unwrap();
        assert_eq!(field(set_timebox_paused(c, &future.id, true)), "timeboxPaused");
        assert!(matches!(set_timebox_paused(c, "nope", true), Err(AppError::NotFound)));
    }

    #[test]
    fn create_rejects_invalid_cidr() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        for bad in ["10.0.0.0/33", "10.0.0/24", "300.1.1.1", "a.b.c.d", "10.0.0.1/", "10.0.0.1/-1", "010.0.0.1", "10.0.0.0/08", "10.0.0.0/ 24", "256.0.0.1"] {
            let mut i = input("x", "lab");
            i.scope_cidrs = vec![bad.into()];
            assert_eq!(field(create(c, i)), "scopeCidrs", "{bad}");
        }
        let mut i = input("x", "lab");
        i.scope_cidrs = vec!["10.0.0.0/24".into(), "10.0.0.5".into(), " 10.0.0.1".into(), "0.0.0.0/0".into()];
        let e = create(c, i).unwrap();
        assert_eq!(e.scope_cidrs[2], "10.0.0.1");
    }

    #[test]
    fn create_validates_name_dates_kind() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        assert_eq!(field(create(c, input("   ", "lab"))), "name");
        assert_eq!(field(create(c, input(&"a".repeat(121), "lab"))), "name");
        assert!(create(c, input(&"a".repeat(120), "lab")).is_ok());
        assert_eq!(field(create(c, input("x", "weird"))), "kind");
        let mut i = input("x", "lab");
        i.starts_at = Some(10);
        i.ends_at = Some(9);
        assert_eq!(field(create(c, i)), "endsAt");
        for m in [0, 4321] {
            let mut i = input("x", "exam-sim");
            i.timebox_minutes = Some(m);
            assert_eq!(field(create(c, i)), "timeboxMinutes");
        }
    }

    #[test]
    fn timebox_dropped_for_non_exam_kinds() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let mut i = input("lab", "lab");
        i.timebox_minutes = Some(60);
        i.timebox_start = Some(5);
        let e = create(c, i).unwrap();
        assert_eq!((e.timebox_minutes, e.timebox_start), (None, None));
        assert_eq!(get(c, &e.id).unwrap().timebox_minutes, None);
    }

    #[test]
    fn update_changes_fields_and_updated_at() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = create(c, input("a", "lab")).unwrap();
        c.execute("UPDATE engagements SET updated_at = 1, created_at = 1", []).unwrap();
        let mut i = input("b", "client");
        i.client = Some("Acme".into());
        let u = update(c, &e.id, i).unwrap();
        assert_eq!((u.name.as_str(), u.kind.as_str()), ("b", "client"));
        assert_eq!(u.client.as_deref(), Some("Acme"));
        assert_eq!(u.created_at, 1);
        assert!(u.updated_at > 1);
        assert_eq!(update(c, "nope", input("z", "lab")), Err(AppError::NotFound));
    }

    #[test]
    fn deleted_host_stays_deleted_on_engagement_save() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let mut i = input("a", "lab");
        i.scope_cidrs = vec!["10.0.0.5".into(), "10.0.0.0/24".into()];
        let e = create(c, i.clone()).unwrap();
        let hosts = crate::hosts::list(c, &e.id).unwrap();
        assert_eq!(hosts.len(), 1, "create syncs every single-IP scope entry");
        crate::hosts::delete(c, &hosts[0].id).unwrap();
        // Saving again with the same scope (say, a rename) must not bring the deleted host back.
        i.name = "renamed".into();
        update(c, &e.id, i.clone()).unwrap();
        assert!(crate::hosts::list(c, &e.id).unwrap().is_empty());
        // A newly added IP still becomes a host.
        i.scope_cidrs.push("10.0.0.6/32".into());
        update(c, &e.id, i).unwrap();
        let ips: Vec<_> = crate::hosts::list(c, &e.id).unwrap().into_iter().filter_map(|h| h.ip).collect();
        assert_eq!(ips, ["10.0.0.6"]);
    }

    #[test]
    fn list_orders_active_first() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let a = create(c, input("a", "lab")).unwrap();
        let b = create(c, input("b", "lab")).unwrap();
        let d = create(c, input("d", "lab")).unwrap();
        c.execute("UPDATE engagements SET updated_at = 100 WHERE id = ?1", [&a.id]).unwrap();
        c.execute("UPDATE engagements SET updated_at = 200 WHERE id = ?1", [&b.id]).unwrap();
        c.execute("UPDATE engagements SET updated_at = 300 WHERE id = ?1", [&d.id]).unwrap();
        c.execute("UPDATE engagements SET last_activity_at = 400 WHERE id = ?1", [&a.id]).unwrap();
        set_status(c, &d.id, "archived").unwrap();
        let names: Vec<String> = list(c).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["a", "b", "d"]);
        match set_status(c, &a.id, "bogus") {
            Err(AppError::Validation { field, .. }) => assert_eq!(field, "status"),
            o => panic!("{o:?}"),
        }
        assert_eq!(set_status(c, "nope", "active"), Err(AppError::NotFound));
    }

    #[test]
    fn delete_missing_is_not_found() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        assert_eq!(delete(c, "nope"), Err(AppError::NotFound));
        let e = create(c, input("a", "lab")).unwrap();
        delete(c, &e.id).unwrap();
        assert_eq!(get(c, &e.id), Err(AppError::NotFound));
    }

    #[test]
    fn last_ran_on_round_trips() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = create(c, input("a", "lab")).unwrap();
        set_last_ran_on(c, &e.id, Some("Mac")).unwrap();
        let g = get(c, &e.id).unwrap();
        assert_eq!(g.last_ran_on.as_deref(), Some("Mac"));
        assert_eq!(serde_json::to_value(&g).unwrap()["lastRanOn"], "Mac");
        set_last_ran_on(c, &e.id, None).unwrap();
        assert_eq!(get(c, &e.id).unwrap().last_ran_on, None);
        assert_eq!(set_last_ran_on(c, "nope", None), Err(AppError::NotFound));
    }

    #[test]
    fn msf_lock_set_clear_and_foreign_host_rejected() {
        use crate::hosts::{self, HostInput};
        let dir = tempfile::tempdir().unwrap();
        let mut v = crate::vault::Vault::new(crate::paths::DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        let c = v.conn().unwrap();
        let mk = || EngagementInput {
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
        };
        let hin = |ip: &str| HostInput { name: ip.into(), ip: Some(ip.into()), os: None, access: None, dual_homed: None, ad_set: None };
        let e = create(c, mk()).unwrap();
        let e2 = create(c, mk()).unwrap();
        assert_eq!(e.msf_host_id, None);
        let h = hosts::create(c, &e.id, hin("10.0.0.5")).unwrap();
        let foreign = hosts::create(c, &e2.id, hin("10.0.0.5")).unwrap();
        assert_eq!(set_msf_host(c, &e.id, Some(&h.id)).unwrap().msf_host_id.as_deref(), Some(h.id.as_str()));
        assert_eq!(get(c, &e.id).unwrap().msf_host_id.as_deref(), Some(h.id.as_str()));
        assert_eq!(set_msf_host(c, &e.id, Some(&foreign.id)), Err(AppError::NotFound));
        assert_eq!(set_msf_host(c, &e.id, Some("nope")), Err(AppError::NotFound));
        assert_eq!(get(c, &e.id).unwrap().msf_host_id.as_deref(), Some(h.id.as_str()));
        assert_eq!(set_msf_host(c, &e.id, None).unwrap().msf_host_id, None);
        assert_eq!(set_msf_host(c, "nope", None), Err(AppError::NotFound));
        assert!(serde_json::to_value(&e).unwrap().get("msfHostId").is_some());
    }

    fn prog_fixture(kind: &str) -> (tempfile::TempDir, crate::vault::Vault, String) {
        use crate::hosts::{self, HostInput};
        let dir = tempfile::tempdir().unwrap();
        let mut v = crate::vault::Vault::new(crate::paths::DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        let c = v.conn().unwrap();
        let e = create(
            c,
            EngagementInput {
                name: "x".into(),
                kind: kind.into(),
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
        .unwrap();
        let mk = |name: &str, ip: &str, ad: Option<bool>| {
            let h = hosts::create(
                c,
                &e.id,
                HostInput { name: name.into(), ip: Some(ip.into()), os: None, access: None, dual_homed: None, ad_set: Some(ad) },
            )
            .unwrap();
            h.id
        };
        let s1 = mk("s1", "10.0.0.1", None);
        mk("s2", "10.0.0.2", None);
        mk("s3", "10.0.0.3", None);
        let dc = mk("dc", "10.0.0.10", None);
        mk("c1", "10.0.0.11", Some(true));
        mk("c2", "10.0.0.12", Some(true));
        for (i, p) in [88, 389].iter().enumerate() {
            c.execute(
                "INSERT INTO services (id,host_id,port,protocol,state,created_at,updated_at) VALUES (?1,?2,?3,'tcp','open',1,1)",
                params![format!("sv{i}"), dc, p],
            )
            .unwrap();
        }
        let flag = |id: &str, host: &str, kind: &str| {
            c.execute(
                "INSERT INTO log_entries (id,engagement_id,kind,title,content,at,created_at,updated_at) VALUES (?1,?2,'flag','f',?3,1,1,1)",
                params![id, e.id, format!(r#"{{"flagKind":"{kind}"}}"#)],
            )
            .unwrap();
            c.execute("INSERT INTO log_entry_hosts (entry_id,host_id) VALUES (?1,?2)", params![id, host]).unwrap();
        };
        flag("f1", &s1, "local");
        flag("f2", &s1, "proof");
        flag("f3", &dc, "proof");
        (dir, v, e.id)
    }

    #[test]
    fn exam_sim_progress_counts_ad_set_once() {
        let (_d, v, id) = prog_fixture("exam-sim");
        let p = &progress_all(v.conn().unwrap()).unwrap()[&id];
        assert_eq!((p.hosts_total, p.hosts_rooted, p.flags_found, p.flags_total), (4, 2, 3, 7));
    }

    #[test]
    fn lab_progress_unchanged() {
        let (_d, v, id) = prog_fixture("lab");
        let p = &progress_all(v.conn().unwrap()).unwrap()[&id];
        assert_eq!((p.hosts_total, p.hosts_rooted, p.flags_found, p.flags_total), (6, 2, 3, 12));
    }

    #[test]
    fn exam_sim_progress_edge_cases() {
        use crate::hosts;
        let (_d, v, id) = prog_fixture("exam-sim");
        let c = v.conn().unwrap();
        let ids: std::collections::HashMap<String, String> = hosts::list(c, &id)
            .unwrap()
            .into_iter()
            .map(|h| (h.name, h.id))
            .collect();
        let flag = |eid: &str, host: &str, kind: &str| {
            c.execute(
                "INSERT INTO log_entries (id,engagement_id,kind,title,content,at,created_at,updated_at) VALUES (?1,?2,'flag','f',?3,1,1,1)",
                params![eid, id, format!(r#"{{"flagKind":"{kind}"}}"#)],
            )
            .unwrap();
            c.execute("INSERT INTO log_entry_hosts (entry_id,host_id) VALUES (?1,?2)", params![eid, host]).unwrap();
        };
        let get = |c: &Connection| {
            let p = progress_all(c).unwrap()[&id].clone();
            (p.hosts_total, p.hosts_rooted, p.flags_found, p.flags_total)
        };
        // fixture baseline (4,2,3,7); a local.txt on an AD client does not count
        flag("x1", &ids["c1"], "local");
        assert_eq!(get(c), (4, 2, 3, 7));
        // a proof on an AD client with the DC proof already found still counts the AD set once
        flag("x2", &ids["c1"], "proof");
        flag("x3", &ids["c2"], "proof");
        assert_eq!(get(c), (4, 2, 3, 7));
        // duplicate proofs on a standalone count once
        flag("x4", &ids["s1"], "proof");
        flag("x5", &ids["s1"], "proof");
        assert_eq!(get(c), (4, 2, 3, 7));
        // a proof on a client alone counts as the one AD flag
        c.execute("DELETE FROM log_entries WHERE id IN ('f3','x2','x3')", []).unwrap();
        assert_eq!(get(c), (4, 1, 2, 7));
        c.execute("UPDATE hosts SET ad_set = 1 WHERE name = 'c1'", []).unwrap();
        flag("x6", &ids["c1"], "proof");
        assert_eq!(get(c), (4, 2, 3, 7));
        // only AD hosts: (1, p, p, 1)
        c.execute("UPDATE hosts SET ad_set = 1", []).unwrap();
        assert_eq!(get(c), (1, 1, 1, 1));
        c.execute("DELETE FROM log_entries", []).unwrap();
        assert_eq!(get(c), (1, 0, 0, 1));
        // an exam sim with no hosts
        let empty = create(
            c,
            EngagementInput {
                name: "e".into(),
                kind: "exam-sim".into(),
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
        .unwrap();
        let p = &progress_all(c).unwrap()[&empty.id];
        assert_eq!((p.hosts_total, p.hosts_rooted, p.flags_found, p.flags_total), (0, 0, 0, 0));
    }
}
