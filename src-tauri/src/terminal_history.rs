//! What the built-in terminal keeps in the vault (docs/specs/terminal.md §5.1, §5.3): each engagement's typed
//! command lines, and where its engagement folder is.
//!
//! Sessions write no history file (SR-4). Every command line a Raven session runs (never its output) is stored here,
//! encrypted with the rest of the vault, and a new session in the same engagement is preloaded with it.
//!
//! Needs no terminal feature, so it is checked on every build.

use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::{Path, PathBuf};

/// How many of an engagement's command lines a new session is preloaded with: the most recent ones.
pub const PRELOAD_LIMIT: usize = 10_000;

/// Store one command line typed in a session of `engagement_id`. Blank lines are not stored.
pub fn record(conn: &Connection, engagement_id: &str, command: &str) -> AppResult<()> {
    if command.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO terminal_commands (engagement_id, command, created_at) VALUES (?1, ?2, ?3)",
        params![engagement_id, command, now_ms()],
    )?;
    Ok(())
}

/// The engagement's most recent `limit` command lines, oldest first, as a shell's history wants them.
pub fn recent(conn: &Connection, engagement_id: &str, limit: usize) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT command FROM (SELECT id, command FROM terminal_commands WHERE engagement_id = ?1 \
         ORDER BY id DESC LIMIT ?2) ORDER BY id",
    )?;
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    let rows = stmt.query_map(params![engagement_id, limit], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Where engagement folders go: `~/Raven`.
pub fn default_folder_root() -> AppResult<PathBuf> {
    std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(|home| PathBuf::from(home).join("Raven"))
        .ok_or_else(|| AppError::Io("HOME is not set, so there is nowhere for the engagement folder".into()))
}

/// The engagement folder: an ordinary, unencrypted directory where the engagement's sessions start (GLOSSARY).
///
/// The first call picks `<root>/<slug of the engagement's name>`, adding `-2`, `-3`, … if another engagement
/// already has that folder, and stores it on the engagement, so a later rename never moves it. Every call creates
/// the directory if it is missing, readable only by its owner.
pub fn engagement_folder(conn: &Connection, root: &Path, engagement_id: &str) -> AppResult<PathBuf> {
    let row: Option<(String, Option<String>)> = conn
        .query_row("SELECT name, folder FROM engagements WHERE id = ?1", [engagement_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    let Some((name, folder)) = row else { return Err(AppError::NotFound) };
    let folder = match folder {
        Some(folder) => PathBuf::from(folder),
        None => {
            let base = slug(&name);
            let mut n = 1;
            let picked = loop {
                let candidate = root.join(if n == 1 { base.clone() } else { format!("{base}-{n}") });
                let taken: bool = conn.query_row(
                    "SELECT EXISTS (SELECT 1 FROM engagements WHERE folder = ?1 AND id <> ?2)",
                    params![candidate.to_string_lossy(), engagement_id],
                    |r| r.get(0),
                )?;
                if !taken {
                    break candidate;
                }
                n += 1;
            };
            conn.execute(
                "UPDATE engagements SET folder = ?1 WHERE id = ?2",
                params![picked.to_string_lossy(), engagement_id],
            )?;
            picked
        }
    };
    create_private_dir(&folder)?;
    Ok(folder)
}

fn create_private_dir(dir: &Path) -> AppResult<()> {
    // An existing folder keeps whatever permissions its owner gave it.
    if dir.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(dir).map_err(|e| AppError::Io(format!("could not create {}: {e}", dir.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| AppError::Io(format!("could not restrict {}: {e}", dir.display())))?;
    }
    Ok(())
}

/// A folder name from an engagement name: lowercase ASCII letters and digits, anything else one `-`, at most 48
/// characters. A name with none of those is `engagement`.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
        if out.len() >= 48 {
            break;
        }
    }
    let out = out.trim_end_matches('-');
    if out.is_empty() { "engagement".into() } else { out.into() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engagements::{self, EngagementInput};
    use crate::migrations;

    fn open() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        migrations::migrate(&mut c, &mut |_, _| Ok(())).unwrap();
        c
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

    #[test]
    fn records_command_lines_per_engagement_oldest_first() {
        let c = open();
        let a = eng(&c, "a");
        let b = eng(&c, "b");
        record(&c, &a, "nmap -sV 192.0.2.5").unwrap();
        record(&c, &b, "id").unwrap();
        record(&c, &a, "   ").unwrap();
        record(&c, &a, "gobuster dir -u http://$RHOST").unwrap();
        assert_eq!(recent(&c, &a, 100).unwrap(), ["nmap -sV 192.0.2.5", "gobuster dir -u http://$RHOST"]);
        assert_eq!(recent(&c, &b, 100).unwrap(), ["id"]);
    }

    #[test]
    fn preload_keeps_the_most_recent_commands() {
        let c = open();
        let a = eng(&c, "a");
        for n in 1..=5 {
            record(&c, &a, &format!("echo {n}")).unwrap();
        }
        assert_eq!(recent(&c, &a, 2).unwrap(), ["echo 4", "echo 5"]);
    }

    #[test]
    fn deleting_the_engagement_deletes_its_history() {
        let c = open();
        let a = eng(&c, "a");
        record(&c, &a, "whoami").unwrap();
        engagements::delete(&c, &a).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM terminal_commands", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn slugs_are_plain_folder_names() {
        assert_eq!(slug("OSCP Exam Sim #2"), "oscp-exam-sim-2");
        assert_eq!(slug("  Forge / HTB  "), "forge-htb");
        assert_eq!(slug("ÆØÅ"), "engagement");
        assert_eq!(slug(&"x".repeat(80)).len(), 48);
    }

    #[test]
    fn the_folder_is_picked_once_kept_through_renames_and_never_shared() {
        let c = open();
        let root = tempfile::tempdir().unwrap();
        let a = eng(&c, "Forge");
        let b = eng(&c, "forge");
        let fa = engagement_folder(&c, root.path(), &a).unwrap();
        let fb = engagement_folder(&c, root.path(), &b).unwrap();
        assert_eq!(fa, root.path().join("forge"));
        assert_eq!(fb, root.path().join("forge-2"));
        assert!(fa.is_dir() && fb.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&fa).unwrap().permissions().mode() & 0o777, 0o700);
        }

        c.execute("UPDATE engagements SET name = 'Renamed' WHERE id = ?1", [&a]).unwrap();
        std::fs::remove_dir(&fa).unwrap();
        assert_eq!(engagement_folder(&c, root.path(), &a).unwrap(), fa, "kept after a rename");
        assert!(fa.is_dir(), "created again when missing");
    }

    #[test]
    fn no_folder_for_an_unknown_engagement() {
        let c = open();
        let root = tempfile::tempdir().unwrap();
        assert_eq!(engagement_folder(&c, root.path(), "nope"), Err(AppError::NotFound));
    }
}
