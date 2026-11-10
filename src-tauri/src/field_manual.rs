//! Field-Manual import support: a read-only scan of the vault folder and the stored snapshot of the last import.
//!
//! The scan only ever reads, and only these paths: `00-Home/Toolkit.md`, `01-Playbook/*.md`,
//! `02-Cards/**/*.md` and the Manual notes in `03-Tools`, `04-Foundations` and `05-Reporting` (recursive). Parsing and merging happen in TypeScript; this module moves text in and the result out.

use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    /// Path relative to the vault, with `/` separators.
    pub rel_path: String,
    pub mtime_ms: i64,
    pub text: String,
}

/// The stored result of an import. Everything besides `imported_at` is opaque JSON owned by the TS side.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldManualSnapshot {
    pub imported_at: i64,
    #[serde(flatten)]
    pub body: serde_json::Map<String, serde_json::Value>,
}

/// Expands a leading `~` or `~/` using `HOME`.
pub fn expand_home(path: &str) -> PathBuf {
    expand_home_with(path, std::env::var_os("HOME"))
}

fn expand_home_with(path: &str, home: Option<std::ffi::OsString>) -> PathBuf {
    match (path.strip_prefix("~/").or(if path == "~" { Some("") } else { None }), home) {
        (Some(rest), Some(h)) => Path::new(&h).join(rest),
        _ => PathBuf::from(path),
    }
}

fn io(e: std::io::Error) -> AppError {
    AppError::Io(e.to_string())
}

fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_md(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

/// Markdown files directly in `dir` (or all below it when `recursive`). Symlinks are skipped.
fn collect(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) -> AppResult<()> {
    let rd = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(io(e)),
    };
    for entry in rd {
        let entry = entry.map_err(io)?;
        let ft = entry.file_type().map_err(io)?;
        let p = entry.path();
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            if recursive {
                collect(&p, true, out)?;
            }
        } else if ft.is_file() && is_md(&p) {
            out.push(p);
        }
    }
    Ok(())
}

fn files(root: &Path) -> AppResult<Vec<PathBuf>> {
    let meta = fs::metadata(root).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound { AppError::NotFound } else { io(e) }
    })?;
    if !meta.is_dir() {
        return Err(AppError::NotFound);
    }
    let mut out = Vec::new();
    let toolkit = root.join("00-Home").join("Toolkit.md");
    if fs::symlink_metadata(&toolkit).is_ok_and(|m| m.is_file()) {
        out.push(toolkit);
    }
    collect(&root.join("01-Playbook"), false, &mut out)?;
    collect(&root.join("02-Cards"), true, &mut out)?;
    for dir in ["03-Tools", "04-Foundations", "05-Reporting"] {
        collect(&root.join(dir), true, &mut out)?;
    }
    out.sort();
    Ok(out)
}

fn rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .unwrap_or(p)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn scan(path: &str) -> AppResult<Vec<VaultFile>> {
    let root = expand_home(path);
    let mut out = Vec::new();
    for p in files(&root)? {
        let meta = fs::metadata(&p).map_err(io)?;
        let text = fs::read_to_string(&p).map_err(io)?;
        out.push(VaultFile { rel_path: rel(&root, &p), mtime_ms: mtime_ms(&meta), text });
    }
    Ok(out)
}

pub fn latest_mtime(path: &str) -> AppResult<Option<i64>> {
    let root = expand_home(path);
    let mut newest = None;
    for p in files(&root)? {
        let m = mtime_ms(&fs::metadata(&p).map_err(io)?);
        newest = Some(newest.map_or(m, |n: i64| n.max(m)));
    }
    Ok(newest)
}

/// Replaces the stored snapshot in one transaction.
pub fn save(conn: &Connection, snap: &FieldManualSnapshot) -> AppResult<()> {
    let json = serde_json::to_string(&snap.body).map_err(|e| AppError::Io(e.to_string()))?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO field_manual (id, imported_at, snapshot) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET imported_at = excluded.imported_at, snapshot = excluded.snapshot",
        params![snap.imported_at, json],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn load(conn: &Connection) -> AppResult<Option<FieldManualSnapshot>> {
    let row: Option<(i64, String)> = conn
        .query_row("SELECT imported_at, snapshot FROM field_manual WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    row.map(|(imported_at, text)| {
        let body = serde_json::from_str(&text).map_err(|e| AppError::Db(format!("stored Field Manual snapshot: {e}")))?;
        Ok(FieldManualSnapshot { imported_at, body })
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    #[test]
    fn scan_reads_only_the_imported_folders() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        write(r, "00-Home/Toolkit.md", "t");
        write(r, "00-Home/Other.md", "no");
        write(r, "01-Playbook/Enum.md", "p");
        write(r, "01-Playbook/sub/Deep.md", "no");
        write(r, "02-Cards/a.md", "a");
        write(r, "02-Cards/Group/b.md", "b");
        write(r, "03-Tools/Nmap.md", "n");
        write(r, "04-Foundations/sub/Deep.md", "f");
        write(r, "05-Reporting/Rep.md", "r");
        write(r, "05-Reporting/img.png", "no");
        write(r, "02-Cards/notes.txt", "no");
        write(r, ".obsidian/x.json", "no");
        write(r, "Elsewhere/note.md", "no");
        let got = scan(r.to_str().unwrap()).unwrap();
        let rels: Vec<&str> = got.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(rels, ["00-Home/Toolkit.md", "01-Playbook/Enum.md", "02-Cards/Group/b.md", "02-Cards/a.md", "03-Tools/Nmap.md", "04-Foundations/sub/Deep.md", "05-Reporting/Rep.md"]);
        assert_eq!(got[0].text, "t");
        assert!(got.iter().all(|f| f.mtime_ms > 0));
        assert!(latest_mtime(r.to_str().unwrap()).unwrap().is_some());
    }

    #[test]
    fn scan_missing_path_is_not_found() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("nope");
        assert_eq!(scan(p.to_str().unwrap()), Err(AppError::NotFound));
        assert_eq!(latest_mtime(p.to_str().unwrap()), Err(AppError::NotFound));
    }

    #[test]
    fn latest_mtime_is_none_for_an_empty_vault() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(latest_mtime(d.path().to_str().unwrap()).unwrap(), None);
    }

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../migrations/0009_field_manual.sql")).unwrap();
        c
    }

    #[test]
    fn save_then_load_round_trips_the_snapshot() {
        let c = mem();
        assert_eq!(load(&c).unwrap(), None);
        let mut body = serde_json::Map::new();
        body.insert("cards".into(), json!([{"id": "a"}]));
        body.insert("report".into(), json!({"cardsAdded": 1}));
        let s = FieldManualSnapshot { imported_at: 42, body };
        save(&c, &s).unwrap();
        assert_eq!(load(&c).unwrap(), Some(s));
        let mut body2 = serde_json::Map::new();
        body2.insert("cards".into(), json!([]));
        let s2 = FieldManualSnapshot { imported_at: 43, body: body2 };
        save(&c, &s2).unwrap();
        assert_eq!(load(&c).unwrap(), Some(s2));
        let n: i64 = c.query_row("SELECT count(*) FROM field_manual", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn expand_home_replaces_a_leading_tilde() {
        let h = Some(std::ffi::OsString::from("/h"));
        assert_eq!(expand_home_with("~/x/y", h.clone()), PathBuf::from("/h/x/y"));
        assert_eq!(expand_home_with("~", h.clone()), PathBuf::from("/h"));
        assert_eq!(expand_home_with("/abs", h), PathBuf::from("/abs"));
        assert_eq!(expand_home_with("~/x", None), PathBuf::from("~/x"));
    }
}
