//! NIST NVD CVE lookup: Raven's one network call (user decision 2026-11-06).
//!
//! Only the CVE ID and the API key leave the machine, in a single
//! `GET https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=<CVE>` with an `apiKey` header.
//! The request runs here in Rust, never in the webview (its CSP stays closed). Each successful
//! answer is cached raw in `nvd_cache`, so a repeat lookup and later offline use cost nothing.

use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

pub const NVD_URL: &str = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NvdRecord {
    pub cve_id: String,
    pub description: Option<String>,
    pub vector: Option<String>,
    pub score: Option<f64>,
    pub cwes: Vec<String>,
    pub references: Vec<String>,
    pub published: Option<String>,
    pub last_modified: Option<String>,
}

/// Trims and upper-cases `cve`, then checks it against `^CVE-\d{4}-\d{4,}$`.
pub fn normalize_cve_id(cve: &str) -> AppResult<String> {
    let id = cve.trim().to_ascii_uppercase();
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let ok = id
        .strip_prefix("CVE-")
        .and_then(|rest| rest.split_once('-'))
        .is_some_and(|(year, num)| year.len() == 4 && digits(year) && num.len() >= 4 && digits(num));
    if ok {
        Ok(id)
    } else {
        Err(AppError::validation("cveId", "use a CVE ID like CVE-2021-44228"))
    }
}

/// The CVSS entry to use: `cvssMetricV40` > `cvssMetricV31` > `cvssMetricV30`; within a version the
/// `Primary` (NVD's own) entry, else the first `Secondary` (the CNA's).
fn pick_metric(metrics: &Value) -> Option<&Value> {
    ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30"].iter().find_map(|k| {
        let list = metrics.get(*k)?.as_array()?;
        let of_type = |t: &str| list.iter().find(|m| m.get("type").and_then(Value::as_str) == Some(t));
        of_type("Primary").or_else(|| of_type("Secondary"))
    })
}

fn push_unique(list: &mut Vec<String>, v: &str) {
    if !list.iter().any(|x| x == v) {
        list.push(v.to_string());
    }
}

fn is_cwe(v: &str) -> bool {
    v.strip_prefix("CWE-").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Reads the first vulnerability of an NVD 2.0 answer; `None` when it lists none.
pub fn parse(json: &Value) -> Option<NvdRecord> {
    let cve = json.get("vulnerabilities")?.as_array()?.first()?.get("cve")?;
    let text = |k: &str| cve.get(k).and_then(Value::as_str).map(str::to_string);
    let cve_id = text("id")?;
    let description = cve
        .get("descriptions")
        .and_then(Value::as_array)
        .and_then(|d| d.iter().find(|x| x.get("lang").and_then(Value::as_str) == Some("en")))
        .and_then(|x| x.get("value").and_then(Value::as_str))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let data = cve.get("metrics").and_then(pick_metric).and_then(|m| m.get("cvssData"));
    let vector = data.and_then(|d| d.get("vectorString")).and_then(Value::as_str).map(str::to_string);
    let score = data.and_then(|d| d.get("baseScore")).and_then(Value::as_f64);
    let mut cwes = Vec::new();
    for w in cve.get("weaknesses").and_then(Value::as_array).into_iter().flatten() {
        for d in w.get("description").and_then(Value::as_array).into_iter().flatten() {
            if let Some(v) = d.get("value").and_then(Value::as_str).filter(|v| is_cwe(v)) {
                push_unique(&mut cwes, v);
            }
        }
    }
    let mut references = Vec::new();
    for r in cve.get("references").and_then(Value::as_array).into_iter().flatten() {
        if let Some(url) = r.get("url").and_then(Value::as_str) {
            push_unique(&mut references, url);
        }
    }
    Some(NvdRecord {
        cve_id,
        description,
        vector,
        score,
        cwes,
        references,
        published: text("published"),
        last_modified: text("lastModified"),
    })
}

/// What a lookup needs after the cache check: a cached record, or a request for `cve`.
#[derive(Debug, PartialEq)]
pub enum Step {
    Cached(NvdRecord),
    Fetch { cve: String },
}

/// Validates the ID, then reads the cache; with no cache hit and no key it is `no_key`.
/// No request is made for an invalid ID or a missing key.
pub fn begin(conn: &Connection, key: &str, cve: &str) -> AppResult<Step> {
    let cve = normalize_cve_id(cve)?;
    let cached: Option<String> =
        conn.query_row("SELECT json FROM nvd_cache WHERE cve_id = ?1", [&cve], |r| r.get(0)).optional()?;
    if let Some(rec) = cached.and_then(|j| serde_json::from_str::<Value>(&j).ok()).as_ref().and_then(parse) {
        return Ok(Step::Cached(rec));
    }
    if key.trim().is_empty() {
        return Err(AppError::NoKey);
    }
    Ok(Step::Fetch { cve })
}

/// Parses a fetched answer (empty `vulnerabilities` is `not_found`) without caching it.
pub fn read_answer(raw: &str) -> AppResult<NvdRecord> {
    let json: Value =
        serde_json::from_str(raw).map_err(|_| AppError::Offline("NVD sent an answer Raven can't read".into()))?;
    parse(&json).ok_or(AppError::NotFound)
}

pub fn store(conn: &Connection, cve: &str, raw: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO nvd_cache(cve_id, fetched_at, json) VALUES(?1, ?2, ?3) \
         ON CONFLICT(cve_id) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json",
        params![cve, now_ms(), raw],
    )?;
    Ok(())
}

/// Maps an HTTP error status: 401/403 is `key_rejected` (NVD also answers 403 when rate-limited),
/// 404 `not_found`, a busy/overloaded 429 or 5xx is `nvd_busy` (online, so not `offline`), anything else `offline`.
pub fn status_error(code: u16) -> AppError {
    match code {
        401 | 403 => AppError::KeyRejected,
        404 => AppError::NotFound,
        c if transient(c) => AppError::NvdBusy,
        _ => AppError::Offline(format!("NVD answered {code}")),
    }
}

/// A transient status worth retrying: NVD overloaded (503), rate-limiting (429), or a passing 5xx.
fn transient(code: u16) -> bool {
    matches!(code, 429 | 500 | 502 | 503 | 504)
}

/// Backoff before each retry. NVD is slow and frequently 503s or hangs under load, so one attempt is
/// not enough; these waits (plus the attempts around them) stay well inside a background lookup's budget.
const BACKOFF: [Duration; 2] = [Duration::from_millis(900), Duration::from_millis(2500)];

/// One GET to `base?cveId=<cve>` with the `apiKey` header and a 10s timeout; returns the raw body.
/// Redirects are not followed, so the key is only ever sent to `base`. Retries transient failures
/// (503/429/5xx and timeouts) with a short backoff before giving up.
pub fn fetch_from(base: &str, key: &str, cve: &str) -> AppResult<String> {
    fetch_retrying(base, key, cve, &BACKOFF)
}

/// `fetch_from`'s core with an injectable backoff schedule (empty = a single attempt), for the tests.
fn fetch_retrying(base: &str, key: &str, cve: &str, backoff: &[Duration]) -> AppResult<String> {
    let agent = ureq::AgentBuilder::new().timeout(TIMEOUT).redirects(0).build();
    let url = format!("{base}?cveId={cve}");
    let mut waits = backoff.iter();
    loop {
        // `retry`: this failure may clear on another try (server busy or the request timed out / dropped).
        let (err, retry) = match agent.get(&url).set("apiKey", key.trim()).call() {
            Ok(resp) if resp.status() == 200 => {
                return resp.into_string().map_err(|_| AppError::Offline("the NVD answer was cut off".into()));
            }
            Ok(resp) => (status_error(resp.status()), transient(resp.status())),
            Err(ureq::Error::Status(code, _)) => (status_error(code), transient(code)),
            Err(ureq::Error::Transport(_)) => (AppError::Offline("no connection to NVD".into()), true),
        };
        match waits.next() {
            Some(&w) if retry => std::thread::sleep(w),
            _ => return Err(err),
        }
    }
}

pub fn fetch(key: &str, cve: &str) -> AppResult<String> {
    fetch_from(NVD_URL, key, cve)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::DataPaths;
    use crate::vault::Vault;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// The `nvd_lookup` command's flow (`begin` → fetch → `read_answer` → `store`) with an injectable fetch.
    fn lookup_with(
        conn: &Connection,
        key: &str,
        cve: &str,
        fetch: impl FnOnce(&str, &str) -> AppResult<String>,
    ) -> AppResult<NvdRecord> {
        match begin(conn, key, cve)? {
            Step::Cached(rec) => Ok(rec),
            Step::Fetch { cve } => {
                let raw = fetch(key, &cve)?;
                let rec = read_answer(&raw)?;
                store(conn, &cve, &raw)?;
                Ok(rec)
            }
        }
    }

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    fn metric(kind: &str, vector: &str, score: f64) -> Value {
        json!({ "source": "x", "type": kind, "cvssData": { "vectorString": vector, "baseScore": score } })
    }

    fn answer(metrics: Value) -> Value {
        json!({
            "resultsPerPage": 1, "totalResults": 1, "format": "NVD_CVE", "version": "2.0",
            "vulnerabilities": [{ "cve": {
                "id": "CVE-2020-1234",
                "published": "2020-05-01T10:15:00.000",
                "lastModified": "2024-11-21T05:00:00.000",
                "descriptions": [
                    { "lang": "es", "value": "XSS almacenado." },
                    { "lang": "en", "value": " Stored XSS in the comment field. " }
                ],
                "metrics": metrics,
                "weaknesses": [
                    { "source": "nvd@nist.gov", "type": "Primary", "description": [{ "lang": "en", "value": "CWE-79" }] },
                    { "source": "cna", "type": "Secondary", "description": [
                        { "lang": "en", "value": "CWE-79" }, { "lang": "en", "value": "NVD-CWE-Other" }
                    ] }
                ],
                "references": [
                    { "url": "https://www.exploit-db.com/exploits/12345", "source": "cna" },
                    { "url": "https://vendor.example/advisory", "source": "cna" },
                    { "url": "https://vendor.example/advisory", "source": "nvd" }
                ]
            } }]
        })
    }

    const V40: &str = "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N";
    const V40B: &str = "CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N";
    const V31: &str = "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N";

    #[test]
    fn nvd_parse_reads_the_fields() {
        let r = parse(&answer(json!({ "cvssMetricV31": [metric("Primary", V31, 6.1)] }))).unwrap();
        assert_eq!(r.cve_id, "CVE-2020-1234");
        assert_eq!(r.description.as_deref(), Some("Stored XSS in the comment field."));
        assert_eq!((r.vector.as_deref(), r.score), (Some(V31), Some(6.1)));
        assert_eq!(r.cwes, ["CWE-79"]);
        assert_eq!(r.references, ["https://www.exploit-db.com/exploits/12345", "https://vendor.example/advisory"]);
        assert_eq!(r.published.as_deref(), Some("2020-05-01T10:15:00.000"));
        assert_eq!(r.last_modified.as_deref(), Some("2024-11-21T05:00:00.000"));
        let j = serde_json::to_value(&r).unwrap();
        assert!(j.get("cveId").is_some() && j.get("lastModified").is_some());
    }

    #[test]
    fn nvd_parse_prefers_v40_secondary_over_v31_primary() {
        let m = json!({ "cvssMetricV31": [metric("Primary", V31, 6.1)], "cvssMetricV40": [metric("Secondary", V40, 9.3)] });
        let r = parse(&answer(m)).unwrap();
        assert_eq!((r.vector.as_deref(), r.score), (Some(V40), Some(9.3)));
    }

    #[test]
    fn nvd_parse_prefers_primary_within_a_version() {
        let m = json!({ "cvssMetricV40": [metric("Secondary", V40, 9.3), metric("Primary", V40B, 8.7)] });
        let r = parse(&answer(m)).unwrap();
        assert_eq!((r.vector.as_deref(), r.score), (Some(V40B), Some(8.7)));
        let m = json!({ "cvssMetricV30": [metric("Secondary", "CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8)] });
        assert_eq!(parse(&answer(m)).unwrap().score, Some(9.8));
        let r = parse(&answer(json!({}))).unwrap();
        assert_eq!((r.vector, r.score), (None, None));
    }

    #[test]
    fn nvd_parse_empty_vulnerabilities_is_none() {
        assert_eq!(parse(&json!({ "totalResults": 0, "vulnerabilities": [] })), None);
        assert_eq!(parse(&json!({})), None);
    }

    #[test]
    fn nvd_cve_id_validation() {
        assert_eq!(normalize_cve_id(" cve-2021-44228 ").unwrap(), "CVE-2021-44228");
        assert_eq!(normalize_cve_id("CVE-2024-123456").unwrap(), "CVE-2024-123456");
        for bad in ["", "CVE-21-44228", "CVE-2021-442", "CVE-2021-4422a", "CVE-2021-44228&x=1", "EDB-12345", "CVE-2021-"] {
            assert!(matches!(normalize_cve_id(bad), Err(AppError::Validation { .. })), "{bad}");
        }
    }

    #[test]
    fn nvd_invalid_cve_id_makes_no_request() {
        let (_d, v) = unlocked();
        let r = lookup_with(v.conn().unwrap(), "key", "CVE-2021-1&apiKey=x", |_, _| panic!("no request"));
        match r {
            Err(AppError::Validation { field, .. }) => assert_eq!(field, "cveId"),
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn nvd_no_key_is_no_key_without_a_request() {
        let (_d, v) = unlocked();
        let r = lookup_with(v.conn().unwrap(), "  ", "CVE-2020-1234", |_, _| panic!("no request"));
        assert_eq!(r, Err(AppError::NoKey));
    }

    #[test]
    fn nvd_lookup_caches_and_reuses_the_answer() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let raw = answer(json!({ "cvssMetricV40": [metric("Secondary", V40, 9.3)] })).to_string();
        let r = lookup_with(c, "key", "cve-2020-1234", |k, cve| {
            assert_eq!((k, cve), ("key", "CVE-2020-1234"));
            Ok(raw.clone())
        })
        .unwrap();
        assert_eq!(r.vector.as_deref(), Some(V40));
        let stored: String = c.query_row("SELECT json FROM nvd_cache WHERE cve_id='CVE-2020-1234'", [], |r| r.get(0)).unwrap();
        assert_eq!(stored, raw);
        // Second lookup: cache hit, no request, and no key needed.
        let again = lookup_with(c, "", "CVE-2020-1234", |_, _| panic!("cached")).unwrap();
        assert_eq!(again, r);
    }

    #[test]
    fn nvd_empty_answer_is_not_found_and_not_cached() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        let r = lookup_with(c, "key", "CVE-2099-0001", |_, _| Ok(r#"{"totalResults":0,"vulnerabilities":[]}"#.into()));
        assert_eq!(r, Err(AppError::NotFound));
        let n: i64 = c.query_row("SELECT COUNT(*) FROM nvd_cache", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        assert!(matches!(read_answer("<html>"), Err(AppError::Offline(_))));
    }

    #[test]
    fn nvd_fetch_errors_propagate_and_are_not_cached() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        for e in [AppError::KeyRejected, AppError::Offline("no connection to NVD".into())] {
            let want = e.clone();
            assert_eq!(lookup_with(c, "key", "CVE-2020-1234", move |_, _| Err(e)), Err(want));
        }
        let n: i64 = c.query_row("SELECT COUNT(*) FROM nvd_cache", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn nvd_status_mapping() {
        assert_eq!(status_error(401), AppError::KeyRejected);
        assert_eq!(status_error(403), AppError::KeyRejected);
        assert_eq!(status_error(404), AppError::NotFound);
        // NVD overloaded or rate-limiting: busy, not offline (the machine is online).
        for code in [429, 500, 502, 503, 504] {
            assert_eq!(status_error(code), AppError::NvdBusy, "{code}");
        }
        assert_eq!(status_error(418).code(), "offline");
    }

    /// Serves one canned HTTP response on a loopback port and hands back the request it received.
    /// Loopback only: these tests never reach the internet.
    fn one_shot(response: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/rest/json/cves/2.0", l.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 1024];
            while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = s.read(&mut chunk).unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            s.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&buf).into_owned()
        });
        (base, h)
    }

    #[test]
    fn nvd_fetch_sends_only_the_id_and_key() {
        let (base, h) = one_shot("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
        assert_eq!(fetch_from(&base, " k3y ", "CVE-2020-1234").unwrap(), "{}");
        let req = h.join().unwrap();
        assert!(req.starts_with("GET /rest/json/cves/2.0?cveId=CVE-2020-1234 HTTP/1.1"), "{req}");
        assert!(req.lines().any(|l| l.eq_ignore_ascii_case("apiKey: k3y")), "{req}");
    }

    #[test]
    fn nvd_fetch_403_is_key_rejected() {
        let (base, h) = one_shot("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert_eq!(fetch_from(&base, "bad", "CVE-2020-1234"), Err(AppError::KeyRejected));
        h.join().unwrap();
    }

    #[test]
    fn nvd_fetch_without_a_connection_is_offline() {
        // Bind then drop, so the port is closed and the connection is refused. No backoff: a single attempt.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let r = fetch_retrying(&format!("http://127.0.0.1:{port}/x"), "k", "CVE-2020-1234", &[]);
        assert_eq!(r.unwrap_err().code(), "offline");
    }

    /// Serves a sequence of canned responses, one per connection, so a retry reaches the next one.
    fn serve_seq(responses: &'static [&'static str]) -> (String, std::thread::JoinHandle<()>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/rest/json/cves/2.0", l.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            for response in responses {
                let (mut s, _) = l.accept().unwrap();
                let mut buf = Vec::new();
                let mut chunk = [0u8; 1024];
                while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = s.read(&mut chunk).unwrap();
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                s.write_all(response.as_bytes()).unwrap();
            }
        });
        (base, h)
    }

    #[test]
    fn nvd_fetch_retries_a_503_then_succeeds() {
        let (base, h) = serve_seq(&[
            "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
        ]);
        assert_eq!(fetch_retrying(&base, "k", "CVE-2020-1234", &[Duration::ZERO]).unwrap(), "{}");
        h.join().unwrap();
    }

    #[test]
    fn nvd_fetch_gives_up_busy_after_the_backoff_is_spent() {
        let (base, h) = serve_seq(&[
            "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        ]);
        assert_eq!(fetch_retrying(&base, "k", "CVE-2020-1234", &[Duration::ZERO]), Err(AppError::NvdBusy));
        h.join().unwrap();
    }
}
