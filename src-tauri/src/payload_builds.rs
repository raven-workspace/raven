//! Payload build memory: which baked payload was last built for a host, and with what LHOST/LPORT. No payload text.
//! One row per (host, payload); recording again replaces it.

use crate::error::{AppError, AppResult};
use crate::notes::check_scope;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadBuild {
    pub engagement_id: String,
    pub host_id: String,
    pub payload_id: String,
    pub lhost: String,
    pub lport: String,
    pub at: i64,
}

const COLS: &str = "engagement_id, host_id, payload_id, lhost, lport, at";

fn row(r: &Row) -> rusqlite::Result<PayloadBuild> {
    Ok(PayloadBuild {
        engagement_id: r.get(0)?,
        host_id: r.get(1)?,
        payload_id: r.get(2)?,
        lhost: r.get(3)?,
        lport: r.get(4)?,
        at: r.get(5)?,
    })
}

pub fn list(conn: &Connection, engagement_id: &str) -> AppResult<Vec<PayloadBuild>> {
    check_scope(conn, engagement_id, None)?;
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM payload_builds WHERE engagement_id = ?1 ORDER BY at, host_id, payload_id"))?;
    Ok(st.query_map([engagement_id], row)?.collect::<Result<Vec<_>, _>>()?)
}

/// Upserts on (host, payload). The host must belong to the engagement (NotFound otherwise).
pub fn record(conn: &Connection, input: PayloadBuild) -> AppResult<PayloadBuild> {
    if input.payload_id.trim().is_empty() {
        return Err(AppError::validation("payloadId", "payload id is required"));
    }
    check_scope(conn, &input.engagement_id, Some(&input.host_id))?;
    conn.execute(
        &format!(
            "INSERT INTO payload_builds ({COLS}) VALUES (?1,?2,?3,?4,?5,?6) \
             ON CONFLICT(host_id, payload_id) DO UPDATE SET lhost = excluded.lhost, lport = excluded.lport, at = excluded.at"
        ),
        params![input.engagement_id, input.host_id, input.payload_id, input.lhost, input.lport, input.at],
    )?;
    Ok(input)
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

    fn host(c: &Connection, e: &str) -> String {
        hosts::create(c, e, HostInput { name: "a".into(), ip: Some("192.0.2.5".into()), os: None, access: None, dual_homed: None, ad_set: None })
            .unwrap()
            .id
    }

    fn build(e: &str, h: &str, lhost: &str, at: i64) -> PayloadBuild {
        PayloadBuild { engagement_id: e.into(), host_id: h.into(), payload_id: "nishang-cradle".into(), lhost: lhost.into(), lport: "443".into(), at }
    }

    #[test]
    fn record_upserts_one_row_per_host_and_payload() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let h = host(c, &e);
        record(c, build(&e, &h, "192.0.2.10", 1)).unwrap();
        let second = record(c, build(&e, &h, "192.0.2.20", 2)).unwrap();
        let mut other = build(&e, &h, "192.0.2.20", 3);
        other.payload_id = "nc-exe".into();
        record(c, other).unwrap();
        let rows = list(c, &e).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], second);
        assert_eq!(rows[0].lhost, "192.0.2.20");
    }

    #[test]
    fn record_rejects_host_of_other_engagement() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let h = host(c, &e);
        let e2 = eng(c, "e2");
        assert!(matches!(record(c, build(&e2, &h, "192.0.2.10", 1)), Err(AppError::NotFound)));
        assert!(list(c, &e2).unwrap().is_empty());
    }

    #[test]
    fn deleting_host_cascades() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let e = eng(c, "e");
        let h = host(c, &e);
        record(c, build(&e, &h, "192.0.2.10", 1)).unwrap();
        c.execute("DELETE FROM hosts WHERE id = ?1", [&h]).unwrap();
        assert!(list(c, &e).unwrap().is_empty());
    }

    #[test]
    fn migrates_12_to_13_keeps_rows() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..12], &mut |_, _| Ok(())).unwrap();
        c.execute("INSERT INTO engagements (id,name,kind,scope_cidrs,status,created_at,updated_at) VALUES ('e1','x','lab','[]','active',1,1)", []).unwrap();
        let mut calls = 0;
        let out = migrations::migrate_with(&mut c, &migrations::MIGRATIONS[..13], &mut |f, t| {
            assert_eq!((f, t), (12, 13));
            calls += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!((calls, out.to), (1, 13));
        let n: i64 = c.query_row("SELECT count(*) FROM engagements WHERE id='e1'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let n: i64 = c.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='payload_builds'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }
}
