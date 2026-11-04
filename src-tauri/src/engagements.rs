//! Engagement repository.

use crate::backup::system_now_ms;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

const COLS: &str = "id, name, kind, client, sub_label, scope_cidrs, domain, starts_at, ends_at, \
                    timebox_start, timebox_minutes, status, created_at, updated_at, last_activity_at";

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

fn valid_cidr(s: &str) -> bool {
    let (ip, prefix) = match s.split_once('/') {
        Some((ip, p)) => (ip, Some(p)),
        None => (s, None),
    };
    if let Some(p) = prefix
        && (p.is_empty() || p.len() > 2 || !p.bytes().all(|b| b.is_ascii_digit()) || p.parse::<u8>().map_or(true, |n| n > 32)) {
            return false;
        }
    let parts: Vec<&str> = ip.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|o| !o.is_empty() && o.len() <= 3 && o.bytes().all(|b| b.is_ascii_digit()) && o.parse::<u16>().is_ok_and(|n| n <= 255))
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
    conn.execute(
        "INSERT INTO engagements (id, name, kind, client, sub_label, scope_cidrs, domain, starts_at, ends_at, \
         timebox_start, timebox_minutes, status, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'active',?12,?12)",
        params![
            id, i.name, i.kind, i.client, i.sub_label,
            serde_json::to_string(&i.scope_cidrs).map_err(|e| AppError::Db(e.to_string()))?,
            i.domain, i.starts_at, i.ends_at, i.timebox_start, i.timebox_minutes, now
        ],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: EngagementInput) -> AppResult<Engagement> {
    let i = normalise(input)?;
    let n = conn.execute(
        "UPDATE engagements SET name=?2, kind=?3, client=?4, sub_label=?5, scope_cidrs=?6, domain=?7, \
         starts_at=?8, ends_at=?9, timebox_start=?10, timebox_minutes=?11, updated_at=?12 WHERE id=?1",
        params![
            id, i.name, i.kind, i.client, i.sub_label,
            serde_json::to_string(&i.scope_cidrs).map_err(|e| AppError::Db(e.to_string()))?,
            i.domain, i.starts_at, i.ends_at, i.timebox_start, i.timebox_minutes, system_now_ms()
        ],
    )?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
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
        assert_eq!(e.timebox_minutes, Some(1440));
        let all = list(c).unwrap();
        assert_eq!(all, vec![e.clone()]);
        assert_eq!(get(c, &e.id).unwrap(), e);
        let j = serde_json::to_value(&e).unwrap();
        assert_eq!(j["scopeCidrs"][0], "10.0.0.0/24");
        assert!(j.get("subLabel").is_some() && j.get("lastActivityAt").is_some());
    }

    #[test]
    fn create_rejects_invalid_cidr() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        for bad in ["10.0.0.0/33", "10.0.0/24", "300.1.1.1", "a.b.c.d", "10.0.0.1/", "10.0.0.1/-1"] {
            let mut i = input("x", "lab");
            i.scope_cidrs = vec![bad.into()];
            assert_eq!(field(create(c, i)), "scopeCidrs", "{bad}");
        }
        let mut i = input("x", "lab");
        i.scope_cidrs = vec!["10.0.0.0/24".into(), "10.0.0.5".into()];
        assert!(create(c, i).is_ok());
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
}
