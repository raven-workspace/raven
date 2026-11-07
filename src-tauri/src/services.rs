//! Service repository. Nmap supplies guesses (`nmap_*`); only the user sets the confirmed identity.

use crate::backup::system_now_ms;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub host_id: String,
    pub port: i64,
    pub protocol: String,
    pub state: String,
    pub nmap_service: Option<String>,
    pub nmap_version: Option<String>,
    pub confirmed_product: Option<String>,
    pub confirmed_version: Option<String>,
    pub confirmed_entry_id: Option<String>,
    /// `candidate`, `untested` or `dead_end`; `None` = no call made yet.
    pub verdict: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanPort {
    pub port: i64,
    pub protocol: String,
    pub state: String,
    pub service: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInput {
    pub port: i64,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub nmap_service: Option<String>,
    #[serde(default)]
    pub nmap_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmInput {
    pub product: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub entry_id: Option<String>,
}

const COLS: &str = "id, host_id, port, protocol, state, nmap_service, nmap_version, \
    confirmed_product, confirmed_version, confirmed_entry_id, verdict, created_at, updated_at";

fn invalid(field: &str, message: &str) -> AppError {
    AppError::Validation { field: field.into(), message: message.into() }
}

fn from_row(r: &Row) -> rusqlite::Result<Service> {
    Ok(Service {
        id: r.get(0)?,
        host_id: r.get(1)?,
        port: r.get(2)?,
        protocol: r.get(3)?,
        state: r.get(4)?,
        nmap_service: r.get(5)?,
        nmap_version: r.get(6)?,
        confirmed_product: r.get(7)?,
        confirmed_version: r.get(8)?,
        confirmed_entry_id: r.get(9)?,
        verdict: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

/// Trims; empty becomes `None`.
fn blank_to_none(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn check_port(port: i64) -> AppResult<()> {
    if (1..=65535).contains(&port) {
        Ok(())
    } else {
        Err(invalid("port", "port must be 1-65535"))
    }
}

fn check_protocol(p: &str) -> AppResult<String> {
    let p = p.trim().to_lowercase();
    if matches!(p.as_str(), "tcp" | "udp") {
        Ok(p)
    } else {
        Err(invalid("protocol", "protocol must be tcp or udp"))
    }
}

fn host_exists(conn: &Connection, host_id: &str) -> AppResult<()> {
    let ok: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM hosts WHERE id = ?1)", [host_id], |r| r.get(0))?;
    if ok { Ok(()) } else { Err(AppError::NotFound) }
}

/// Ordered by protocol, then port.
pub fn list(conn: &Connection, host_id: &str) -> AppResult<Vec<Service>> {
    let mut st =
        conn.prepare(&format!("SELECT {COLS} FROM services WHERE host_id = ?1 ORDER BY protocol, port"))?;
    let rows = st.query_map([host_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Every service of every host in the engagement, ordered by host, protocol, port.
pub fn list_engagement(conn: &Connection, engagement_id: &str) -> AppResult<Vec<Service>> {
    let cols = COLS.split(", ").map(|c| format!("s.{c}")).collect::<Vec<_>>().join(", ");
    let mut st = conn.prepare(&format!(
        "SELECT {cols} FROM services s JOIN hosts h ON h.id = s.host_id WHERE h.engagement_id = ?1 \
         ORDER BY s.host_id, s.protocol, s.port"
    ))?;
    let rows = st.query_map([engagement_id], from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Service> {
    match conn.query_row(&format!("SELECT {COLS} FROM services WHERE id = ?1"), [id], from_row) {
        Ok(s) => Ok(s),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
}

/// Applies nmap results: new `(port, protocol)` rows are inserted, existing ones get fresh
/// `state`/`nmap_*`. The confirmed identity is never touched. All-or-nothing.
pub fn upsert_scan(conn: &Connection, host_id: &str, ports: &[ScanPort]) -> AppResult<Vec<Service>> {
    host_exists(conn, host_id)?;
    let mut clean = Vec::with_capacity(ports.len());
    for p in ports {
        check_port(p.port)?;
        let state = blank_to_none(Some(&p.state)).unwrap_or_else(|| "open".into());
        clean.push((p.port, check_protocol(&p.protocol)?, state, blank_to_none(Some(&p.service)), blank_to_none(Some(&p.version))));
    }
    let tx = conn.unchecked_transaction()?;
    let now = system_now_ms();
    for (port, protocol, state, svc, ver) in clean {
        tx.execute(
            "INSERT INTO services (id, host_id, port, protocol, state, nmap_service, nmap_version, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8) \
             ON CONFLICT (host_id, port, protocol) DO UPDATE SET \
               state = excluded.state, \
               nmap_service = COALESCE(excluded.nmap_service, services.nmap_service), \
               nmap_version = COALESCE(excluded.nmap_version, services.nmap_version), \
               updated_at = excluded.updated_at",
            params![uuid::Uuid::new_v4().to_string(), host_id, port, protocol, state, svc, ver, now],
        )?;
    }
    tx.commit()?;
    list(conn, host_id)
}

const DUP_PORT: &str = "That port is already listed";

fn port_taken(conn: &Connection, host_id: &str, port: i64, protocol: &str, except_id: &str) -> AppResult<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM services WHERE host_id = ?1 AND port = ?2 AND protocol = ?3 AND id != ?4)",
        params![host_id, port, protocol, except_id],
        |r| r.get(0),
    )?)
}

fn clean_input(i: &ServiceInput) -> AppResult<(i64, String, Option<String>, Option<String>)> {
    check_port(i.port)?;
    let protocol = check_protocol(i.protocol.as_deref().unwrap_or("tcp"))?;
    Ok((i.port, protocol, blank_to_none(i.nmap_service.as_deref()), blank_to_none(i.nmap_version.as_deref())))
}

pub fn create(conn: &Connection, host_id: &str, input: ServiceInput) -> AppResult<Service> {
    let (port, protocol, svc, ver) = clean_input(&input)?;
    host_exists(conn, host_id)?;
    if port_taken(conn, host_id, port, &protocol, "")? {
        return Err(invalid("port", DUP_PORT));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = system_now_ms();
    conn.execute(
        "INSERT INTO services (id, host_id, port, protocol, nmap_service, nmap_version, created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
        params![id, host_id, port, protocol, svc, ver, now],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, input: ServiceInput) -> AppResult<Service> {
    let (port, protocol, svc, ver) = clean_input(&input)?;
    let current = get(conn, id)?;
    if port_taken(conn, &current.host_id, port, &protocol, id)? {
        return Err(invalid("port", DUP_PORT));
    }
    conn.execute(
        "UPDATE services SET port=?2, protocol=?3, nmap_service=?4, nmap_version=?5, updated_at=?6 WHERE id=?1",
        params![id, port, protocol, svc, ver, system_now_ms()],
    )?;
    get(conn, id)
}

/// Records the user's own call on what a service is. `entry_id`, when given, must be a log
/// entry in the same engagement as the service's host.
pub fn confirm(conn: &Connection, id: &str, input: ConfirmInput) -> AppResult<Service> {
    let product = input.product.trim().to_string();
    if product.is_empty() || product.chars().count() > 80 {
        return Err(invalid("product", "product must be 1-80 characters"));
    }
    let version = blank_to_none(input.version.as_deref());
    let entry_id = blank_to_none(input.entry_id.as_deref());
    get(conn, id)?;
    if let Some(e) = &entry_id {
        let ok: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM services s JOIN hosts h ON h.id = s.host_id \
             JOIN log_entries le ON le.engagement_id = h.engagement_id WHERE s.id = ?1 AND le.id = ?2)",
            params![id, e],
            |r| r.get(0),
        )?;
        if !ok {
            return Err(invalid("entryId", "entry must belong to this engagement"));
        }
    }
    conn.execute(
        "UPDATE services SET confirmed_product=?2, confirmed_version=?3, confirmed_entry_id=?4, updated_at=?5 WHERE id=?1",
        params![id, product, version, entry_id, system_now_ms()],
    )?;
    get(conn, id)
}

pub fn unconfirm(conn: &Connection, id: &str) -> AppResult<Service> {
    let n = conn.execute(
        "UPDATE services SET confirmed_product=NULL, confirmed_version=NULL, confirmed_entry_id=NULL, updated_at=?2 WHERE id=?1",
        params![id, system_now_ms()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

/// How a service reads in the ruled-out list: `445/tcp Samba smbd 4.6.2`.
fn service_label(s: &Service) -> String {
    let ident = match &s.confirmed_product {
        Some(p) => match &s.confirmed_version {
            Some(v) => format!("{p} {v}"),
            None => p.clone(),
        },
        None => s.nmap_version.clone().or_else(|| s.nmap_service.clone()).unwrap_or_default(),
    };
    format!("{}/{} {}", s.port, s.protocol, ident).trim().to_string()
}

/// Sets or clears the user's call on a service. `dead_end` needs a reason and creates a linked
/// ruled-out item; leaving `dead_end` (or changing the reason) removes only that linked item.
/// One transaction.
pub fn set_verdict(conn: &Connection, id: &str, verdict: Option<&str>, reason: Option<&str>) -> AppResult<Service> {
    if let Some(v) = verdict {
        if !matches!(v, "candidate" | "untested" | "dead_end") {
            return Err(invalid("verdict", "verdict must be candidate, untested or dead_end"));
        }
    }
    let reason = blank_to_none(reason);
    if verdict == Some("dead_end") && reason.is_none() {
        return Err(invalid("reason", "a dead end needs a reason"));
    }
    let svc = get(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    crate::notes::unlink_ruled_out(&tx, "service", id)?;
    if let (Some("dead_end"), Some(reason)) = (verdict, reason.as_deref()) {
        let engagement_id: String =
            tx.query_row("SELECT engagement_id FROM hosts WHERE id = ?1", [&svc.host_id], |r| r.get(0))?;
        crate::notes::link_ruled_out(&tx, &engagement_id, &svc.host_id, "service", id, &service_label(&svc), reason)?;
    }
    tx.execute("UPDATE services SET verdict = ?2, updated_at = ?3 WHERE id = ?1", params![id, verdict, system_now_ms()])?;
    tx.commit()?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM services WHERE id = ?1", [id])? == 0 {
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

    fn eng(c: &Connection) -> String {
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

    fn host(c: &Connection, eng_id: &str, name: &str) -> String {
        hosts::create(c, eng_id, HostInput { name: name.into(), ip: None, os: None, access: None, dual_homed: None, ad_set: None }).unwrap().id
    }

    fn entry(c: &Connection, eng_id: &str, id: &str) {
        c.execute(
            "INSERT INTO log_entries (id, engagement_id, kind, title, content, at, created_at, updated_at) \
             VALUES (?1, ?2, 'note', 't', '{}', 1, 1, 1)",
            rusqlite::params![id, eng_id],
        )
        .unwrap();
    }

    fn sp(port: i64, proto: &str, state: &str, svc: &str, ver: &str) -> ScanPort {
        ScanPort { port, protocol: proto.into(), state: state.into(), service: svc.into(), version: ver.into() }
    }

    fn sin(port: i64) -> ServiceInput {
        ServiceInput { port, protocol: None, nmap_service: None, nmap_version: None }
    }

    fn cin(product: &str) -> ConfirmInput {
        ConfirmInput { product: product.into(), version: None, entry_id: None }
    }

    fn field<T: std::fmt::Debug>(r: AppResult<T>) -> (String, String) {
        match r {
            Err(AppError::Validation { field, message }) => (field, message),
            o => panic!("expected validation, got {o:?}"),
        }
    }

    #[test]
    fn list_engagement_covers_all_hosts_of_that_engagement_only() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let (e1, e2) = (eng(c), eng(c));
        let (a, b, other) = (host(c, &e1, "a"), host(c, &e1, "b"), host(c, &e2, "o"));
        for (h, port) in [(&a, 80), (&a, 22), (&b, 443), (&other, 8080)] {
            upsert_scan(c, h, &[sp(port, "tcp", "open", "x", "")]).unwrap();
        }
        let got = list_engagement(c, &e1).unwrap();
        assert_eq!(got.len(), 3);
        assert!(got.iter().all(|s| s.host_id == a || s.host_id == b));
        assert!(list_engagement(c, "nope").unwrap().is_empty());
    }

    #[test]
    fn upsert_scan_inserts_and_updates() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let h = host(c, &eng(c), "web");
        let got = upsert_scan(c, &h, &[sp(443, "tcp", "open", "https", ""), sp(22, "tcp", "open", "ssh", "OpenSSH 8.9"), sp(53, "udp", "open", "domain", "")]).unwrap();
        let keys: Vec<(String, i64)> = got.iter().map(|s| (s.protocol.clone(), s.port)).collect();
        assert_eq!(keys, [("tcp".into(), 22), ("tcp".into(), 443), ("udp".into(), 53)]);
        assert_eq!(got[0].nmap_version.as_deref(), Some("OpenSSH 8.9"));
        assert_eq!(got[1].nmap_version, None, "empty string is stored as NULL");
        let id22 = got[0].id.clone();
        let again = upsert_scan(c, &h, &[sp(22, "tcp", "filtered", "ssh", "OpenSSH 9.0"), sp(8080, "tcp", "open", "", "")]).unwrap();
        assert_eq!(again.len(), 4);
        let s22 = again.iter().find(|s| s.port == 22).unwrap();
        assert_eq!((s22.id.as_str(), s22.state.as_str(), s22.nmap_version.as_deref()), (id22.as_str(), "filtered", Some("OpenSSH 9.0")));
        assert_eq!(again.iter().find(|s| s.port == 8080).unwrap().nmap_service, None);
        assert_eq!(field(upsert_scan(c, &h, &[sp(0, "tcp", "open", "", "")])).0, "port");
        assert_eq!(field(upsert_scan(c, &h, &[sp(80, "sctp", "open", "", "")])).0, "protocol");
        assert_eq!(upsert_scan(c, "nope", &[sp(80, "tcp", "open", "", "")]), Err(AppError::NotFound));
    }

    #[test]
    fn rescan_without_versions_keeps_known_guess() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let h = host(c, &eng(c), "web");
        upsert_scan(c, &h, &[sp(22, "tcp", "open", "ssh", "OpenSSH 8.9")]).unwrap();
        // A later -p- run: no service name or version for the same port.
        let got = upsert_scan(c, &h, &[sp(22, "tcp", "open", "", "")]).unwrap();
        assert_eq!((got[0].nmap_service.as_deref(), got[0].nmap_version.as_deref()), (Some("ssh"), Some("OpenSSH 8.9")));
        // A new guess still replaces the old one.
        let got = upsert_scan(c, &h, &[sp(22, "tcp", "open", "ssh", "OpenSSH 9.0")]).unwrap();
        assert_eq!(got[0].nmap_version.as_deref(), Some("OpenSSH 9.0"));
    }

    #[test]
    fn scan_upsert_never_touches_confirmed() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "web");
        entry(c, &e, "e1");
        let s = upsert_scan(c, &h, &[sp(80, "tcp", "open", "http", "Apache 2.4")]).unwrap().remove(0);
        let ci = ConfirmInput { product: "nginx".into(), version: Some("1.18".into()), entry_id: Some("e1".into()) };
        confirm(c, &s.id, ci).unwrap();
        let after = upsert_scan(c, &h, &[sp(80, "tcp", "closed", "http-alt", "other")]).unwrap().remove(0);
        assert_eq!(after.state, "closed");
        assert_eq!(after.nmap_service.as_deref(), Some("http-alt"));
        assert_eq!(
            (after.confirmed_product.as_deref(), after.confirmed_version.as_deref(), after.confirmed_entry_id.as_deref()),
            (Some("nginx"), Some("1.18"), Some("e1"))
        );
    }

    #[test]
    fn confirm_validates_entry_belongs_to_engagement() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e1 = eng(c);
        let e2 = eng(c);
        let h = host(c, &e1, "web");
        entry(c, &e1, "mine");
        entry(c, &e2, "theirs");
        let s = create(c, &h, sin(80)).unwrap();
        let mut ci = cin("nginx");
        ci.entry_id = Some("theirs".into());
        assert_eq!(field(confirm(c, &s.id, ci.clone())).0, "entryId");
        ci.entry_id = Some("missing".into());
        assert_eq!(field(confirm(c, &s.id, ci.clone())).0, "entryId");
        ci.entry_id = Some("mine".into());
        let ok = confirm(c, &s.id, ci).unwrap();
        assert_eq!(ok.confirmed_entry_id.as_deref(), Some("mine"));
        // product is trimmed and 1-80 chars
        let t = confirm(c, &s.id, cin("  Apache  ")).unwrap();
        assert_eq!((t.confirmed_product.as_deref(), t.confirmed_entry_id.as_deref()), (Some("Apache"), None));
        assert_eq!(field(confirm(c, &s.id, cin("   "))).0, "product");
        assert_eq!(field(confirm(c, &s.id, cin(&"a".repeat(81)))).0, "product");
        assert_eq!(confirm(c, "nope", cin("x")), Err(AppError::NotFound));
    }

    #[test]
    fn unconfirm_clears() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "web");
        entry(c, &e, "e1");
        let s = create(c, &h, sin(80)).unwrap();
        confirm(c, &s.id, ConfirmInput { product: "nginx".into(), version: Some("1".into()), entry_id: Some("e1".into()) }).unwrap();
        let u = unconfirm(c, &s.id).unwrap();
        assert_eq!((u.confirmed_product, u.confirmed_version, u.confirmed_entry_id), (None, None, None));
        assert_eq!(unconfirm(c, "nope"), Err(AppError::NotFound));
    }

    #[test]
    fn create_rejects_duplicate_port() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let h = host(c, &eng(c), "web");
        let s = create(c, &h, sin(80)).unwrap();
        assert_eq!((s.protocol.as_str(), s.state.as_str()), ("tcp", "open"));
        let (f, m) = field(create(c, &h, sin(80)));
        assert_eq!((f.as_str(), m.as_str()), ("port", "That port is already listed"));
        // same port on udp, or on another host, is fine
        let mut u = sin(80);
        u.protocol = Some("udp".into());
        let udp = create(c, &h, u).unwrap();
        let h2 = host(c, &eng(c), "other");
        create(c, &h2, sin(80)).unwrap();
        assert_eq!(field(create(c, &h, sin(0))).0, "port");
        assert_eq!(field(create(c, &h, sin(65536))).0, "port");
        // update: own key is not a duplicate, another row's is
        let mut same = sin(80);
        same.nmap_service = Some("http".into());
        assert_eq!(update(c, &s.id, same).unwrap().nmap_service.as_deref(), Some("http"));
        assert_eq!(field(update(c, &udp.id, sin(80)).map(|_| ())).0, "port");
        let mut to_tcp = sin(80);
        to_tcp.protocol = Some("tcp".into());
        assert_eq!(field(update(c, &udp.id, to_tcp)).0, "port");
        assert_eq!(create(c, "nope", sin(81)), Err(AppError::NotFound));
        assert_eq!(update(c, "nope", sin(81)), Err(AppError::NotFound));
    }

    #[test]
    fn deleting_host_cascades_services() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let h = host(c, &eng(c), "web");
        let s = create(c, &h, sin(80)).unwrap();
        create(c, &h, sin(22)).unwrap();
        assert_eq!(list(c, &h).unwrap().len(), 2);
        delete(c, &s.id).unwrap();
        assert_eq!(delete(c, &s.id), Err(AppError::NotFound));
        hosts::delete(c, &h).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM services", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    fn ruled(c: &Connection, h: &str) -> Vec<crate::notes::RuledOut> {
        let e: String = c.query_row("SELECT engagement_id FROM hosts WHERE id=?1", [h], |r| r.get(0)).unwrap();
        crate::notes::ruled_out_list(c, &e).unwrap().into_iter().filter(|r| r.host_id.as_deref() == Some(h)).collect()
    }

    #[test]
    fn dead_end_requires_reason() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let h = host(c, &eng(c), "web");
        let s = create(c, &h, sin(445)).unwrap();
        assert_eq!(field(set_verdict(c, &s.id, Some("dead_end"), None)).0, "reason");
        assert_eq!(field(set_verdict(c, &s.id, Some("dead_end"), Some("   "))).0, "reason");
        assert_eq!(field(set_verdict(c, &s.id, Some("maybe"), None)).0, "verdict");
        assert_eq!(get(c, &s.id).unwrap().verdict, None);
        assert!(ruled(c, &h).is_empty());
        assert_eq!(set_verdict(c, "nope", Some("candidate"), None), Err(AppError::NotFound));
    }

    #[test]
    fn dead_end_creates_linked_ruled_out() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let h = host(c, &eng(c), "web");
        let s = upsert_scan(c, &h, &[sp(445, "tcp", "open", "netbios-ssn", "Samba smbd 4.6.2")]).unwrap().remove(0);
        let got = set_verdict(c, &s.id, Some("dead_end"), Some(" signing required ")).unwrap();
        assert_eq!(got.verdict.as_deref(), Some("dead_end"));
        let r = ruled(c, &h);
        assert_eq!(r.len(), 1);
        assert_eq!((r[0].text.as_str(), r[0].reason.as_str(), r[0].private), ("445/tcp Samba smbd 4.6.2", "signing required", false));
        assert_eq!((r[0].source_kind.as_deref(), r[0].source_id.as_deref()), (Some("service"), Some(s.id.as_str())));
        // Confirmed identity wins over the nmap guess in the label.
        confirm(c, &s.id, cin("Samba")).unwrap();
        set_verdict(c, &s.id, Some("dead_end"), Some("patched")).unwrap();
        let r = ruled(c, &h);
        assert_eq!((r.len(), r[0].text.as_str(), r[0].reason.as_str()), (1, "445/tcp Samba", "patched"));
    }

    #[test]
    fn unset_verdict_removes_only_its_own_ruled_out_item() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c);
        let h = host(c, &e, "web");
        let s = create(c, &h, sin(21)).unwrap();
        let other = create(c, &h, sin(22)).unwrap();
        crate::notes::ruled_out_create(
            c,
            crate::notes::RuledOutInput { engagement_id: e, host_id: Some(h.clone()), text: "21/tcp ftp".into(), reason: "by hand".into(), private: false },
        )
        .unwrap();
        set_verdict(c, &s.id, Some("dead_end"), Some("anon off")).unwrap();
        set_verdict(c, &other.id, Some("dead_end"), Some("closed")).unwrap();
        assert_eq!(ruled(c, &h).len(), 3);
        let back = set_verdict(c, &s.id, Some("candidate"), None).unwrap();
        assert_eq!(back.verdict.as_deref(), Some("candidate"));
        let left = ruled(c, &h);
        assert_eq!(left.len(), 2);
        assert!(left.iter().any(|r| r.reason == "by hand" && r.source_id.is_none()));
        assert!(left.iter().any(|r| r.source_id.as_deref() == Some(other.id.as_str())));
        assert_eq!(set_verdict(c, &s.id, None, None).unwrap().verdict, None);
    }
}
