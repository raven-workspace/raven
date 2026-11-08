//! Pivot network: tunnels (how traffic reaches a subnet) and hops (who we moved from and to).

use crate::backup::system_now_ms;
use crate::engagements::valid_cidr;
use crate::error::{AppError, AppResult};
use crate::notes::check_scope;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

pub(crate) const MAX_SUBNETS: usize = 50;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tunnel {
    pub id: String,
    pub engagement_id: String,
    pub kind: String,
    pub via_host_id: String,
    pub subnets: Vec<String>,
    pub callback_ip: String,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInput {
    pub kind: String,
    pub via_host_id: String,
    #[serde(default)]
    pub subnets: Vec<String>,
    #[serde(default)]
    pub callback_ip: String,
    pub status: String,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hop {
    pub id: String,
    pub engagement_id: String,
    pub from_host_id: Option<String>,
    pub to_host_id: String,
    pub via: String,
    pub log_entry_id: Option<String>,
    pub at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HopInput {
    #[serde(default)]
    pub from_host_id: Option<String>,
    pub to_host_id: String,
    pub via: String,
    #[serde(default)]
    pub log_entry_id: Option<String>,
    #[serde(default)]
    pub at: Option<i64>,
}

fn invalid(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

struct CleanTunnel {
    kind: String,
    via: String,
    subnets: Vec<String>,
    callback_ip: String,
    status: String,
    notes: Option<String>,
}

fn clean_tunnel(conn: &Connection, engagement_id: &str, i: TunnelInput) -> AppResult<CleanTunnel> {
    if !matches!(i.kind.as_str(), "ligolo" | "chisel" | "ssh" | "socks" | "other") {
        return Err(invalid("kind", "kind must be ligolo, chisel, ssh, socks or other"));
    }
    if !matches!(i.status.as_str(), "up" | "down") {
        return Err(invalid("status", "status must be up or down"));
    }
    let subnets: Vec<String> = i.subnets.iter().map(|s| s.trim().to_string()).collect();
    if subnets.len() > MAX_SUBNETS {
        return Err(invalid("subnets", "too many subnets"));
    }
    if let Some(bad) = subnets.iter().find(|s| !valid_cidr(s)) {
        return Err(invalid("subnets", &format!("invalid IPv4 CIDR: {bad}")));
    }
    let callback_ip = i.callback_ip.trim().to_string();
    if !callback_ip.is_empty() && (callback_ip.contains('/') || !valid_cidr(&callback_ip)) {
        return Err(invalid("callbackIp", "must be a single IPv4 address"));
    }
    check_scope(conn, engagement_id, Some(&i.via_host_id))?;
    let notes = i.notes.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    Ok(CleanTunnel { kind: i.kind, via: i.via_host_id, subnets, callback_ip, status: i.status, notes })
}

const TUNNEL_COLS: &str = "id, engagement_id, kind, via_host_id, subnets, callback_ip, status, notes, created_at, updated_at";

fn tunnel_row(r: &Row) -> rusqlite::Result<Tunnel> {
    let subnets: String = r.get(4)?;
    Ok(Tunnel {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        kind: r.get(2)?,
        via_host_id: r.get(3)?,
        subnets: serde_json::from_str(&subnets).unwrap_or_default(),
        callback_ip: r.get(5)?,
        status: r.get(6)?,
        notes: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

fn tunnel_get(conn: &Connection, id: &str) -> AppResult<Tunnel> {
    match conn.query_row(&format!("SELECT {TUNNEL_COLS} FROM tunnels WHERE id = ?1"), [id], tunnel_row) {
        Ok(t) => Ok(t),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
}

pub fn tunnels_list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Tunnel>> {
    let mut st = conn.prepare(&format!("SELECT {TUNNEL_COLS} FROM tunnels WHERE engagement_id = ?1 ORDER BY created_at, rowid"))?;
    let rows = st.query_map([engagement_id], tunnel_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn subnets_json(s: &[String]) -> AppResult<String> {
    serde_json::to_string(s).map_err(|e| AppError::Db(e.to_string()))
}

pub fn tunnel_create(conn: &Connection, engagement_id: &str, input: TunnelInput) -> AppResult<Tunnel> {
    check_scope(conn, engagement_id, None)?;
    let c = clean_tunnel(conn, engagement_id, input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = system_now_ms();
    conn.execute(
        "INSERT INTO tunnels (id, engagement_id, kind, via_host_id, subnets, callback_ip, status, notes, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        params![id, engagement_id, c.kind, c.via, subnets_json(&c.subnets)?, c.callback_ip, c.status, c.notes, now],
    )?;
    tunnel_get(conn, &id)
}

pub fn tunnel_update(conn: &Connection, id: &str, input: TunnelInput) -> AppResult<Tunnel> {
    let current = tunnel_get(conn, id)?;
    let c = clean_tunnel(conn, &current.engagement_id, input)?;
    conn.execute(
        "UPDATE tunnels SET kind=?2, via_host_id=?3, subnets=?4, callback_ip=?5, status=?6, notes=?7, updated_at=?8 WHERE id=?1",
        params![id, c.kind, c.via, subnets_json(&c.subnets)?, c.callback_ip, c.status, c.notes, system_now_ms()],
    )?;
    tunnel_get(conn, id)
}

pub fn tunnel_delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM tunnels WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

struct CleanHop {
    from: Option<String>,
    to: String,
    via: String,
    log_entry_id: Option<String>,
    at: Option<i64>,
}

fn clean_hop(conn: &Connection, engagement_id: &str, i: HopInput) -> AppResult<CleanHop> {
    let via = i.via.trim().to_string();
    if via.is_empty() {
        return Err(invalid("via", "via must not be blank"));
    }
    if i.from_host_id.as_deref() == Some(i.to_host_id.as_str()) {
        return Err(invalid("toHostId", "a hop must go to a different host"));
    }
    check_scope(conn, engagement_id, Some(&i.to_host_id))?;
    if let Some(f) = &i.from_host_id {
        check_scope(conn, engagement_id, Some(f))?;
    }
    if let Some(l) = &i.log_entry_id {
        let ok: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM log_entries WHERE id = ?1 AND engagement_id = ?2)",
            params![l, engagement_id],
            |r| r.get(0),
        )?;
        if !ok {
            return Err(AppError::NotFound);
        }
    }
    Ok(CleanHop { from: i.from_host_id, to: i.to_host_id, via, log_entry_id: i.log_entry_id, at: i.at })
}

const HOP_COLS: &str = "id, engagement_id, from_host_id, to_host_id, via, log_entry_id, at, updated_at";

fn hop_row(r: &Row) -> rusqlite::Result<Hop> {
    Ok(Hop {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        from_host_id: r.get(2)?,
        to_host_id: r.get(3)?,
        via: r.get(4)?,
        log_entry_id: r.get(5)?,
        at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

fn hop_get(conn: &Connection, id: &str) -> AppResult<Hop> {
    match conn.query_row(&format!("SELECT {HOP_COLS} FROM hops WHERE id = ?1"), [id], hop_row) {
        Ok(h) => Ok(h),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
}

pub fn hops_list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Hop>> {
    let mut st = conn.prepare(&format!("SELECT {HOP_COLS} FROM hops WHERE engagement_id = ?1 ORDER BY at, rowid"))?;
    let rows = st.query_map([engagement_id], hop_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn hop_create(conn: &Connection, engagement_id: &str, input: HopInput) -> AppResult<Hop> {
    check_scope(conn, engagement_id, None)?;
    let c = clean_hop(conn, engagement_id, input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = system_now_ms();
    conn.execute(
        "INSERT INTO hops (id, engagement_id, from_host_id, to_host_id, via, log_entry_id, at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, engagement_id, c.from, c.to, c.via, c.log_entry_id, c.at.unwrap_or(now), now],
    )?;
    hop_get(conn, &id)
}

pub fn hop_update(conn: &Connection, id: &str, input: HopInput) -> AppResult<Hop> {
    let current = hop_get(conn, id)?;
    let c = clean_hop(conn, &current.engagement_id, input)?;
    conn.execute(
        "UPDATE hops SET from_host_id=?2, to_host_id=?3, via=?4, log_entry_id=?5, at=?6, updated_at=?7 WHERE id=?1",
        params![id, c.from, c.to, c.via, c.log_entry_id, c.at.unwrap_or(current.at), system_now_ms()],
    )?;
    hop_get(conn, id)
}

pub fn hop_delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM hops WHERE id = ?1", [id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engagements::{self, EngagementInput};
    use crate::error::AppError;
    use crate::hosts::{self, HostInput};
    use crate::paths::DataPaths;
    use crate::vault::Vault;

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    fn eng(c: &rusqlite::Connection) -> String {
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

    fn host(c: &rusqlite::Connection, e: &str, ip: &str) -> String {
        hosts::create(c, e, HostInput { name: ip.into(), ip: Some(ip.into()), os: None, access: None, dual_homed: None, ad_set: None }).unwrap().id
    }

    fn field<T: std::fmt::Debug>(r: AppResult<T>) -> String {
        match r {
            Err(AppError::Validation { field, .. }) => field,
            o => panic!("expected validation, got {o:?}"),
        }
    }

    fn tin(via: &str, subnets: &[&str], cb: &str) -> TunnelInput {
        TunnelInput {
            kind: "ligolo".into(),
            via_host_id: via.into(),
            subnets: subnets.iter().map(|s| s.to_string()).collect(),
            callback_ip: cb.into(),
            status: "up".into(),
            notes: None,
        }
    }

    #[test]
    fn tunnel_validates_subnets_and_callback() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "10.0.0.5");
        assert_eq!(field(tunnel_create(c, &e, tin(&h, &["10.10.0.0/33"], ""))), "subnets");
        assert_eq!(field(tunnel_create(c, &e, tin(&h, &["nope"], ""))), "subnets");
        assert_eq!(field(tunnel_create(c, &e, tin(&h, &["10.10.0.0/24"], "10.10.0"))), "callbackIp");
        assert_eq!(field(tunnel_create(c, &e, tin(&h, &[], "10.10.0.0/24"))), "callbackIp");
        let mut bad = tin(&h, &[], "");
        bad.kind = "wireguard".into();
        assert_eq!(field(tunnel_create(c, &e, bad)), "kind");
        let mut bad = tin(&h, &[], "");
        bad.status = "sideways".into();
        assert_eq!(field(tunnel_create(c, &e, bad)), "status");
        let t = tunnel_create(c, &e, tin(&h, &[" 10.10.0.0/24 ", "10.60.0.5"], " 10.10.0.2 ")).unwrap();
        assert_eq!((t.subnets.clone(), t.callback_ip.as_str(), t.status.as_str()), (vec!["10.10.0.0/24".to_string(), "10.60.0.5".to_string()], "10.10.0.2", "up"));
        tunnel_create(c, &e, tin(&h, &[], "")).unwrap();
        assert_eq!(tunnels_list(c, &e).unwrap().len(), 2);
        let mut upd = tin(&h, &["10.10.66.0/24"], "");
        upd.status = "down".into();
        let u = tunnel_update(c, &t.id, upd).unwrap();
        assert_eq!((u.status.as_str(), u.subnets.clone()), ("down", vec!["10.10.66.0/24".to_string()]));
        // foreign host
        let e2 = eng(c);
        let h2 = host(c, &e2, "10.0.0.5");
        assert_eq!(tunnel_create(c, &e, tin(&h2, &[], "")), Err(AppError::NotFound));
        assert_eq!(tunnel_update(c, &t.id, tin(&h2, &[], "")), Err(AppError::NotFound));
        tunnel_delete(c, &t.id).unwrap();
        assert_eq!(tunnel_delete(c, &t.id), Err(AppError::NotFound));
        let j = serde_json::to_value(&u).unwrap();
        assert!(j.get("viaHostId").is_some() && j.get("callbackIp").is_some());
    }

    #[test]
    fn hop_rejects_self_hop_and_foreign_host() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let a = host(c, &e, "10.0.0.5");
        let b = host(c, &e, "10.0.0.6");
        let hin = |from: Option<&str>, to: &str, via: &str| HopInput {
            from_host_id: from.map(str::to_string),
            to_host_id: to.into(),
            via: via.into(),
            log_entry_id: None,
            at: None,
        };
        assert_eq!(field(hop_create(c, &e, hin(Some(&a), &a, "ssh"))), "toHostId");
        assert_eq!(field(hop_create(c, &e, hin(Some(&a), &b, "  "))), "via");
        let e2 = eng(c);
        let foreign = host(c, &e2, "10.0.0.5");
        assert_eq!(hop_create(c, &e, hin(Some(&foreign), &b, "ssh")), Err(AppError::NotFound));
        assert_eq!(hop_create(c, &e, hin(Some(&a), &foreign, "ssh")), Err(AppError::NotFound));
        let first = hop_create(c, &e, hin(None, &a, "initial access")).unwrap();
        assert_eq!((first.from_host_id, first.at > 0), (None, true));
        let h = hop_create(c, &e, hin(Some(&a), &b, " ssh key ")).unwrap();
        assert_eq!((h.via.as_str(), h.to_host_id.as_str()), ("ssh key", b.as_str()));
        assert_eq!(hops_list(c, &e).unwrap().len(), 2);
        assert_eq!(field(hop_update(c, &h.id, hin(Some(&b), &b, "x"))), "toHostId");
        let u = hop_update(c, &h.id, hin(Some(&a), &b, "psexec")).unwrap();
        assert_eq!(u.via, "psexec");
        hop_delete(c, &h.id).unwrap();
        assert_eq!(hop_delete(c, &h.id), Err(AppError::NotFound));
        assert_eq!(hops_list(c, &e).unwrap().len(), 1);
    }
}
