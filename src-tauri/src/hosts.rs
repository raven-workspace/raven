//! Host repository. A host belongs to one engagement; deleting the engagement deletes its hosts.

use crate::backup::system_now_ms;
use crate::engagements::valid_cidr;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

/// SQL for a host's effective AD-set flag; `alias` names the hosts table in the query. The one
/// definition behind both the host list (the chip) and exam-sim progress.
///
/// Only `state = 'open'` counts: a UDP scan reports `open|filtered` for most ports, which would
/// otherwise flag every UDP-scanned host as a DC.
pub fn ad_effective_sql(alias: &str) -> String {
    format!(
        "COALESCE({alias}.ad_set, (EXISTS(SELECT 1 FROM services s WHERE s.host_id = {alias}.id AND s.port = 88 AND s.state = 'open') \
           AND EXISTS(SELECT 1 FROM services s WHERE s.host_id = {alias}.id AND s.port = 389 AND s.state = 'open')))"
    )
}

/// Column list for queries written `FROM hosts`.
fn cols() -> String {
    format!(
        "id, engagement_id, name, ip, os, board_column, board_manual, access, created_at, updated_at, dual_homed, \
         board_derived, access_reviewed_at, ad_set, {}",
        ad_effective_sql("hosts")
    )
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub engagement_id: String,
    pub name: String,
    pub ip: Option<String>,
    pub os: Option<String>,
    pub board_column: String,
    pub board_manual: bool,
    pub access: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub dual_homed: bool,
    /// The board column the checklist last derived; a hand placement holds until this changes.
    pub board_derived: Option<String>,
    /// When the user last reviewed this host's access grants (Unix ms); null = never.
    pub access_reviewed_at: Option<i64>,
    /// Exam-sim AD set, as stored: null = automatic, true/false = set by hand.
    pub ad_set: Option<bool>,
    /// Whether the host counts as part of the AD set: `ad_set` if set, else open services on 88 and 389.
    pub ad_set_effective: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInput {
    pub name: String,
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub access: Option<String>,
    /// Absent keeps the current value.
    #[serde(default)]
    pub dual_homed: Option<bool>,
    /// Absent keeps the current value; an explicit null resets to automatic.
    #[serde(default, deserialize_with = "present_or_null")]
    pub ad_set: Option<Option<bool>>,
}

/// Distinguishes an absent field (`None`, via `default`) from an explicit null (`Some(None)`).
fn present_or_null<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<bool>>, D::Error> {
    Option::<bool>::deserialize(d).map(Some)
}

fn invalid(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

/// A single IPv4 address (no prefix, or `/32`), returned without the `/32`.
fn single_ip(s: &str) -> Option<String> {
    let bare = s.strip_suffix("/32").unwrap_or(s);
    (!bare.contains('/') && valid_cidr(bare)).then(|| bare.to_string())
}

struct Clean {
    name: String,
    ip: Option<String>,
    os: Option<String>,
    access: String,
    dual_homed: Option<bool>,
    ad_set: Option<Option<bool>>,
}

fn normalise(i: HostInput) -> AppResult<Clean> {
    let ip = match i.ip.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(raw) => Some(single_ip(raw).ok_or_else(|| invalid("ip", "must be a single IPv4 address"))?),
    };
    let mut name = i.name.trim().to_string();
    if name.is_empty() {
        name = ip.clone().unwrap_or_default();
    }
    if name.is_empty() || name.chars().count() > 80 {
        return Err(invalid("name", "name must be 1-80 characters"));
    }
    let os = i.os.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if let Some(o) = &os
        && !matches!(o.as_str(), "windows" | "linux" | "other") {
            return Err(invalid("os", "os must be windows, linux or other"));
        }
    let access = i.access.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("none").to_string();
    if !matches!(access.as_str(), "none" | "user" | "root") {
        return Err(invalid("access", "access must be none, user or root"));
    }
    Ok(Clean { name, ip, os, access, dual_homed: i.dual_homed, ad_set: i.ad_set })
}

fn from_row(r: &Row) -> rusqlite::Result<Host> {
    Ok(Host {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        name: r.get(2)?,
        ip: r.get(3)?,
        os: r.get(4)?,
        board_column: r.get(5)?,
        board_manual: r.get::<_, i64>(6)? != 0,
        access: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
        dual_homed: r.get::<_, i64>(10)? != 0,
        board_derived: r.get(11)?,
        access_reviewed_at: r.get(12)?,
        ad_set: r.get::<_, Option<i64>>(13)?.map(|v| v != 0),
        ad_set_effective: r.get::<_, i64>(14)? != 0,
    })
}

fn ip_key(ip: &Option<String>) -> Option<u32> {
    let parts: Vec<u32> = ip.as_deref()?.split('.').filter_map(|p| p.parse().ok()).collect();
    (parts.len() == 4).then(|| parts.iter().fold(0, |a, p| (a << 8) | p))
}

/// Ordered by IP numerically (hosts without an IP last), then name.
pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Host>> {
    let mut st = conn.prepare(&format!("SELECT {} FROM hosts WHERE engagement_id = ?1", cols()))?;
    let mut rows = st.query_map([engagement_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    rows.sort_by(|a, b| {
        (ip_key(&a.ip).is_none(), ip_key(&a.ip), a.name.to_lowercase(), &a.id)
            .cmp(&(ip_key(&b.ip).is_none(), ip_key(&b.ip), b.name.to_lowercase(), &b.id))
    });
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Host> {
    match conn.query_row(&format!("SELECT {} FROM hosts WHERE id = ?1", cols()), [id], from_row) {
        Ok(h) => Ok(h),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
}

fn ip_taken(conn: &Connection, engagement_id: &str, ip: &str, except_id: &str) -> AppResult<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM hosts WHERE engagement_id = ?1 AND ip = ?2 AND id != ?3)",
        params![engagement_id, ip, except_id],
        |r| r.get(0),
    )?)
}

const DUP_IP: &str = "A host with this IP already exists";

pub fn create(conn: &Connection, engagement_id: &str, input: HostInput) -> AppResult<Host> {
    let c = normalise(input)?;
    let exists: bool =
        conn.query_row("SELECT EXISTS(SELECT 1 FROM engagements WHERE id = ?1)", [engagement_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::NotFound);
    }
    if let Some(ip) = &c.ip
        && ip_taken(conn, engagement_id, ip, "")? {
            return Err(invalid("ip", DUP_IP));
        }
    let id = uuid::Uuid::new_v4().to_string();
    let now = system_now_ms();
    conn.execute(
        "INSERT INTO hosts (id, engagement_id, name, ip, os, access, dual_homed, ad_set, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        params![id, engagement_id, c.name, c.ip, c.os, c.access, c.dual_homed.unwrap_or(false), c.ad_set.flatten(), now],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: HostInput) -> AppResult<Host> {
    let c = normalise(input)?;
    let current = get(conn, id)?;
    if let Some(ip) = &c.ip
        && ip_taken(conn, &current.engagement_id, ip, id)? {
            return Err(invalid("ip", DUP_IP));
        }
    conn.execute(
        "UPDATE hosts SET name=?2, ip=?3, os=?4, access=?5, dual_homed=COALESCE(?6, dual_homed), \
         ad_set=CASE WHEN ?7 THEN ?8 ELSE ad_set END, updated_at=?9 WHERE id=?1",
        params![id, c.name, c.ip, c.os, c.access, c.dual_homed, c.ad_set.is_some(), c.ad_set.flatten(), system_now_ms()],
    )?;
    get(conn, id)
}

/// Moves a host to a board column by hand; this pins it there (`board_manual`).
pub fn move_to(conn: &Connection, id: &str, column: &str) -> AppResult<Host> {
    if !matches!(column, "enumerate" | "foothold" | "privesc" | "loot" | "done") {
        return Err(invalid("column", "column must be enumerate, foothold, privesc, loot or done"));
    }
    let n = conn.execute(
        "UPDATE hosts SET board_column=?2, board_manual=1, updated_at=?3 WHERE id=?1",
        params![id, column, system_now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

/// Stamps the host as access-reviewed now.
pub fn mark_access_reviewed(conn: &Connection, id: &str) -> AppResult<Host> {
    let now = system_now_ms();
    let n = conn.execute("UPDATE hosts SET access_reviewed_at=?2, updated_at=?2 WHERE id=?1", params![id, now])?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

/// Applies the board column the checklist derived. Only when `derived` differs from the last
/// derived value does the host move (and unpin), so a hand placement holds until the next stage completes.
pub fn sync_board(conn: &Connection, id: &str, derived: &str) -> AppResult<Host> {
    if !matches!(derived, "enumerate" | "foothold" | "privesc" | "loot" | "done") {
        return Err(invalid("derived", "column must be enumerate, foothold, privesc, loot or done"));
    }
    let current = get(conn, id)?;
    if current.board_derived.as_deref() == Some(derived) {
        return Ok(current);
    }
    // A card placed by hand before the board was derived (pre-0003 hosts) keeps its place: the first sync only
    // records the derived column, so the placement holds until the next stage completes.
    if current.board_derived.is_none() && current.board_manual {
        conn.execute(
            "UPDATE hosts SET board_derived=?2, updated_at=?3 WHERE id=?1",
            params![id, derived, system_now_ms()],
        )?;
        return get(conn, id);
    }
    conn.execute(
        "UPDATE hosts SET board_column=?2, board_manual=0, board_derived=?2, updated_at=?3 WHERE id=?1",
        params![id, derived, system_now_ms()],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    if tx.execute("DELETE FROM hosts WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    // checklist_items.owner_id has no FK (it may be an engagement id), so clean up by hand.
    tx.execute("DELETE FROM checklist_items WHERE owner_id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

/// Adds a host (named after its IP) for every single-IP scope entry that has none yet.
/// Never deletes or renames. Returns how many were added.
/// Like `sync_scope`, for an engagement save: only IPs that `previous` did not already list become hosts,
/// so a host the user deleted (or re-addressed) is not recreated on every save.
pub fn sync_scope_added(conn: &Connection, engagement_id: &str, previous: &[String], scope: &[String]) -> AppResult<usize> {
    let before: std::collections::HashSet<String> = previous.iter().filter_map(|e| single_ip(e.trim())).collect();
    let added: Vec<String> = scope.iter().filter(|e| single_ip(e.trim()).is_some_and(|ip| !before.contains(&ip))).cloned().collect();
    sync_scope(conn, engagement_id, &added)
}

pub fn sync_scope(conn: &Connection, engagement_id: &str, scope: &[String]) -> AppResult<usize> {
    let mut added = 0;
    for entry in scope {
        let Some(ip) = single_ip(entry.trim()) else { continue };
        if ip_taken(conn, engagement_id, &ip, "")? {
            continue;
        }
        let now = system_now_ms();
        conn.execute(
            "INSERT INTO hosts (id, engagement_id, name, ip, created_at, updated_at) VALUES (?1,?2,?3,?3,?4,?4)",
            params![uuid::Uuid::new_v4().to_string(), engagement_id, ip, now],
        )?;
        added += 1;
    }
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engagements::{self, EngagementInput};
    use crate::error::AppError;
    use crate::paths::DataPaths;
    use crate::vault::Vault;

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    fn eng_input(scope: &[&str]) -> EngagementInput {
        EngagementInput {
            name: "lab".into(),
            kind: "lab".into(),
            client: None,
            sub_label: None,
            scope_cidrs: scope.iter().map(|s| s.to_string()).collect(),
            domain: None,
            starts_at: None,
            ends_at: None,
            timebox_start: None,
            timebox_minutes: None,
        }
    }

    fn hin(name: &str, ip: Option<&str>) -> HostInput {
        HostInput { name: name.into(), ip: ip.map(str::to_string), os: None, access: None, dual_homed: None, ad_set: None }
    }

    fn field<T: std::fmt::Debug>(r: AppResult<T>) -> (String, String) {
        match r {
            Err(AppError::Validation { field, message }) => (field, message),
            o => panic!("expected validation, got {o:?}"),
        }
    }

    #[test]
    fn host_create_validates_ip_and_duplicates() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        for bad in ["10.0.0.0/24", "10.0.0", "300.1.1.1", "a.b.c.d", "10.0.0.1/31"] {
            assert_eq!(field(create(c, &e.id, hin("x", Some(bad)))).0, "ip", "{bad}");
        }
        let h = create(c, &e.id, hin("web", Some("10.0.0.5/32"))).unwrap();
        assert_eq!(h.ip.as_deref(), Some("10.0.0.5"));
        assert_eq!((h.board_column.as_str(), h.board_manual, h.access.as_str()), ("enumerate", false, "none"));
        let (f, m) = field(create(c, &e.id, hin("dup", Some("10.0.0.5"))));
        assert_eq!((f.as_str(), m.as_str()), ("ip", "A host with this IP already exists"));
        // the same IP in another engagement is fine; so are several hosts without IPs
        let e2 = engagements::create(c, eng_input(&[])).unwrap();
        create(c, &e2.id, hin("web", Some("10.0.0.5"))).unwrap();
        create(c, &e.id, hin("a", None)).unwrap();
        create(c, &e.id, hin("b", None)).unwrap();
        // update: own IP is not a duplicate, another host's is
        let other = create(c, &e.id, hin("other", Some("10.0.0.6"))).unwrap();
        update(c, &h.id, hin("web2", Some("10.0.0.5"))).unwrap();
        assert_eq!(field(update(c, &other.id, hin("other", Some("10.0.0.5")))).0, "ip");
        // os / access
        let mut i = hin("w", None);
        i.os = Some("beos".into());
        assert_eq!(field(create(c, &e.id, i)).0, "os");
        let mut i = hin("w", None);
        i.access = Some("admin".into());
        assert_eq!(field(create(c, &e.id, i)).0, "access");
        let mut i = hin("w", None);
        i.os = Some("linux".into());
        i.access = Some("root".into());
        let w = create(c, &e.id, i).unwrap();
        assert_eq!((w.os.as_deref(), w.access.as_str()), (Some("linux"), "root"));
        assert_eq!(field(create(c, &e.id, hin(&"a".repeat(81), None))).0, "name");
        assert_eq!(create(c, "nope", hin("x", None)), Err(AppError::NotFound));
    }

    #[test]
    fn host_name_falls_back_to_ip() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        let h = create(c, &e.id, hin("   ", Some(" 10.0.0.9 "))).unwrap();
        assert_eq!((h.name.as_str(), h.ip.as_deref()), ("10.0.0.9", Some("10.0.0.9")));
        assert_eq!(field(create(c, &e.id, hin("  ", None))).0, "name");
        assert_eq!(field(create(c, &e.id, hin("", Some("")))).0, "name");
        let j = serde_json::to_value(&h).unwrap();
        assert!(j.get("engagementId").is_some() && j.get("boardColumn").is_some() && j.get("boardManual").is_some());
    }

    #[test]
    fn move_sets_manual() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        let h = create(c, &e.id, hin("web", None)).unwrap();
        let m = move_to(c, &h.id, "privesc").unwrap();
        assert_eq!((m.board_column.as_str(), m.board_manual), ("privesc", true));
        assert_eq!(field(move_to(c, &h.id, "nowhere")).0, "column");
        assert_eq!(move_to(c, "nope", "done"), Err(AppError::NotFound));
        delete(c, &h.id).unwrap();
        assert_eq!(get(c, &h.id), Err(AppError::NotFound));
        assert_eq!(delete(c, &h.id), Err(AppError::NotFound));
    }

    #[test]
    fn list_orders_by_ip_numerically_then_name() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        create(c, &e.id, hin("z-noip", None)).unwrap();
        create(c, &e.id, hin("ten", Some("10.0.0.10"))).unwrap();
        create(c, &e.id, hin("two", Some("10.0.0.2"))).unwrap();
        create(c, &e.id, hin("a-noip", None)).unwrap();
        let names: Vec<String> = list(c, &e.id).unwrap().into_iter().map(|h| h.name).collect();
        assert_eq!(names, ["two", "ten", "a-noip", "z-noip"]);
    }

    #[test]
    fn deleting_engagement_cascades_hosts() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        let h = create(c, &e.id, hin("web", Some("10.0.0.5"))).unwrap();
        let now = 1;
        c.execute(
            "INSERT INTO services (id, host_id, port, created_at, updated_at) VALUES ('s1', ?1, 80, ?2, ?2)",
            rusqlite::params![h.id, now],
        )
        .unwrap();
        engagements::delete(c, &e.id).unwrap();
        let n: i64 = c.query_row("SELECT (SELECT count(*) FROM hosts) + (SELECT count(*) FROM services)", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn scope_sync_adds_single_ips_only() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&["10.0.0.0/24"])).unwrap();
        assert!(list(c, &e.id).unwrap().is_empty());
        let e2 = engagements::create(c, eng_input(&["10.0.0.0/24", "10.0.0.5", "10.0.0.6/32"])).unwrap();
        let hs = list(c, &e2.id).unwrap();
        let got: Vec<(&str, Option<&str>)> = hs.iter().map(|h| (h.name.as_str(), h.ip.as_deref())).collect();
        assert_eq!(got, [("10.0.0.5", Some("10.0.0.5")), ("10.0.0.6", Some("10.0.0.6"))]);
        assert!(list(c, &e.id).unwrap().is_empty());
        // update adds new ones; re-running adds none
        let mut i = eng_input(&["10.0.0.5", "10.0.0.7"]);
        i.name = "lab".into();
        engagements::update(c, &e2.id, i).unwrap();
        assert_eq!(list(c, &e2.id).unwrap().len(), 3);
        assert_eq!(sync_scope(c, &e2.id, &["10.0.0.5".into(), "10.0.0.7".into()]).unwrap(), 0);
    }

    #[test]
    fn scope_sync_is_add_only_and_keeps_renames() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&["10.0.0.5", "10.0.0.6"])).unwrap();
        let h = list(c, &e.id).unwrap().into_iter().find(|h| h.ip.as_deref() == Some("10.0.0.5")).unwrap();
        update(c, &h.id, hin("dc01", Some("10.0.0.5"))).unwrap();
        // drop 10.0.0.6 from scope entirely: nothing is deleted, nothing renamed
        engagements::update(c, &e.id, eng_input(&["10.0.0.5"])).unwrap();
        let hs = list(c, &e.id).unwrap();
        assert_eq!(hs.len(), 2);
        assert!(hs.iter().any(|h| h.name == "dc01" && h.ip.as_deref() == Some("10.0.0.5")));
        assert!(hs.iter().any(|h| h.ip.as_deref() == Some("10.0.0.6")));
    }

    #[test]
    fn sync_failure_rolls_back_engagement_write() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        // pre-existing engagement update is atomic: a failing sync leaves no half-write
        let e = engagements::create(c, eng_input(&[])).unwrap();
        c.execute_batch("CREATE TRIGGER boom BEFORE INSERT ON hosts BEGIN SELECT RAISE(ABORT, 'boom'); END;").unwrap();
        assert!(engagements::update(c, &e.id, eng_input(&["10.0.0.5"])).is_err());
        assert!(engagements::get(c, &e.id).unwrap().scope_cidrs.is_empty());
        assert!(engagements::create(c, eng_input(&["10.0.0.9"])).is_err());
        assert_eq!(engagements::list(c).unwrap().len(), 1);
    }

    #[test]
    fn dual_homed_defaults_false_and_is_kept_when_absent() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        let h = create(c, &e.id, hin("web", None)).unwrap();
        assert_eq!((h.dual_homed, h.board_derived.clone()), (false, None));
        let mut i = hin("web", None);
        i.dual_homed = Some(true);
        assert!(update(c, &h.id, i).unwrap().dual_homed);
        assert!(update(c, &h.id, hin("web2", None)).unwrap().dual_homed);
        let mut i = hin("web2", None);
        i.dual_homed = Some(false);
        assert!(!update(c, &h.id, i).unwrap().dual_homed);
        let mut i = hin("dm", None);
        i.dual_homed = Some(true);
        assert!(create(c, &e.id, i).unwrap().dual_homed);
        assert!(serde_json::to_value(&h).unwrap().get("dualHomed").is_some());
    }

    #[test]
    fn sync_board_moves_only_when_derived_changes() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        let h = create(c, &e.id, hin("web", None)).unwrap();
        let s = sync_board(c, &h.id, "enumerate").unwrap();
        assert_eq!((s.board_column.as_str(), s.board_manual, s.board_derived.as_deref()), ("enumerate", false, Some("enumerate")));
        move_to(c, &h.id, "loot").unwrap();
        let s = sync_board(c, &h.id, "enumerate").unwrap();
        assert_eq!((s.board_column.as_str(), s.board_manual), ("loot", true));
        let s = sync_board(c, &h.id, "foothold").unwrap();
        assert_eq!((s.board_column.as_str(), s.board_manual, s.board_derived.as_deref()), ("foothold", false, Some("foothold")));
        assert_eq!(field(sync_board(c, &h.id, "nowhere")).0, "derived");
        assert_eq!(sync_board(c, "nope", "done"), Err(AppError::NotFound));
    }

    #[test]
    fn sync_board_seeds_null_derived_without_moving_a_manual_card() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        let h = create(c, &e.id, hin("web", None)).unwrap();
        move_to(c, &h.id, "privesc").unwrap();
        // Hand-placed with no derived column yet: seed it, don't move.
        let s = sync_board(c, &h.id, "enumerate").unwrap();
        assert_eq!((s.board_column.as_str(), s.board_manual, s.board_derived.as_deref()), ("privesc", true, Some("enumerate")));
        // Same derived column again: still holds.
        let s = sync_board(c, &h.id, "enumerate").unwrap();
        assert_eq!((s.board_column.as_str(), s.board_manual), ("privesc", true));
        // The next stage completes: the card moves.
        let s = sync_board(c, &h.id, "foothold").unwrap();
        assert_eq!((s.board_column.as_str(), s.board_manual, s.board_derived.as_deref()), ("foothold", false, Some("foothold")));
        // Null derived and not manual: moves as before.
        let h2 = create(c, &e.id, hin("dc", None)).unwrap();
        assert!(h2.board_derived.is_none() && !h2.board_manual);
        let s = sync_board(c, &h2.id, "privesc").unwrap();
        assert_eq!((s.board_column.as_str(), s.board_manual, s.board_derived.as_deref()), ("privesc", false, Some("privesc")));
    }

    fn put_all_children(c: &rusqlite::Connection, e: &str, h: &str, other: &str) {
        crate::notes::save(c, e, Some(h), "n", false).unwrap();
        crate::notes::ruled_out_create(
            c,
            crate::notes::RuledOutInput { engagement_id: e.into(), host_id: Some(h.into()), text: "t".into(), reason: "r".into(), private: false },
        )
        .unwrap();
        crate::network::tunnel_create(
            c,
            e,
            crate::network::TunnelInput { kind: "ssh".into(), via_host_id: h.into(), subnets: vec![], callback_ip: String::new(), status: "up".into(), notes: None },
        )
        .unwrap();
        crate::network::hop_create(
            c,
            e,
            crate::network::HopInput { from_host_id: Some(h.into()), to_host_id: other.into(), via: "ssh".into(), log_entry_id: None, at: None },
        )
        .unwrap();
        engagements::set_msf_host(c, e, Some(h)).unwrap();
    }

    #[test]
    fn deleting_host_clears_its_notes_tunnels_hops_and_msf_lock() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        let h = create(c, &e.id, hin("web", Some("10.0.0.5"))).unwrap();
        let o = create(c, &e.id, hin("db", Some("10.0.0.6"))).unwrap();
        put_all_children(c, &e.id, &h.id, &o.id);
        c.execute(
            "INSERT INTO checklist_items (owner_id, engagement_id, goal_id, status, updated_at) VALUES (?1, ?2, 'g', 'todo', 1)",
            params![h.id, e.id],
        )
        .unwrap();
        delete(c, &h.id).unwrap();
        let n: i64 = c
            .query_row(
                "SELECT (SELECT count(*) FROM notes) + (SELECT count(*) FROM ruled_out) + (SELECT count(*) FROM tunnels) \
                 + (SELECT count(*) FROM hops) + (SELECT count(*) FROM checklist_items)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
        assert_eq!(engagements::get(c, &e.id).unwrap().msf_host_id, None);
        assert_eq!(list(c, &e.id).unwrap().len(), 1);
    }

    #[test]
    fn ad_set_null_follows_ports_and_explicit_overrides() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = engagements::create(c, eng_input(&[])).unwrap();
        let h = create(c, &e.id, hin("dc", Some("10.0.0.5"))).unwrap();
        assert_eq!((h.ad_set, h.ad_set_effective), (None, false));
        let port = |p: i64, state: &str| {
            c.execute(
                "INSERT INTO services (id,host_id,port,protocol,state,created_at,updated_at) VALUES (?1,?2,?3,'tcp',?4,1,1)",
                params![format!("s{p}"), h.id, p, state],
            )
            .unwrap();
        };
        port(88, "open");
        assert!(!get(c, &h.id).unwrap().ad_set_effective);
        port(389, "closed");
        assert!(!get(c, &h.id).unwrap().ad_set_effective);
        c.execute("UPDATE services SET state='open' WHERE port=389", []).unwrap();
        let g = get(c, &h.id).unwrap();
        assert_eq!((g.ad_set, g.ad_set_effective), (None, true));
        // explicit off beats the ports; absent keeps it
        let mut inp = hin("dc", Some("10.0.0.5"));
        inp.ad_set = Some(Some(false));
        let g = update(c, &h.id, inp).unwrap();
        assert_eq!((g.ad_set, g.ad_set_effective), (Some(false), false));
        let g = update(c, &h.id, hin("dc", Some("10.0.0.5"))).unwrap();
        assert_eq!(g.ad_set, Some(false));
        // explicit null resets to automatic
        let mut inp = hin("dc", Some("10.0.0.5"));
        inp.ad_set = Some(None);
        let g = update(c, &h.id, inp).unwrap();
        assert_eq!((g.ad_set, g.ad_set_effective), (None, true));
        // explicit on without ports
        let mut inp = hin("client", Some("10.0.0.6"));
        inp.ad_set = Some(Some(true));
        let cl = create(c, &e.id, inp).unwrap();
        assert_eq!((cl.ad_set, cl.ad_set_effective), (Some(true), true));
        // serde: absent vs null vs value
        let a: HostInput = serde_json::from_str(r#"{"name":"x"}"#).unwrap();
        let n: HostInput = serde_json::from_str(r#"{"name":"x","adSet":null}"#).unwrap();
        let t: HostInput = serde_json::from_str(r#"{"name":"x","adSet":true}"#).unwrap();
        assert_eq!((a.ad_set, n.ad_set, t.ad_set), (None, Some(None), Some(Some(true))));
        assert!(serde_json::to_value(&cl).unwrap().get("adSetEffective").is_some());
    }
}
