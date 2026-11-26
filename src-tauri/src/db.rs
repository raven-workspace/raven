//! Row helpers shared by the data modules: the clock, blank-text handling, "is this row in
//! this engagement" checks and plain deletes.
//!
//! Every `table` argument is `&'static str` so only a constant table name, never user input,
//! is formatted into SQL.

use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};

/// Milliseconds since the Unix epoch (0 if the clock is before it).
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Trimmed text, or `None` when it is missing or blank.
pub(crate) fn blank_to_none(s: Option<&str>) -> Option<String> {
    s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Whether the engagement exists.
pub(crate) fn engagement_exists(conn: &Connection, engagement_id: &str) -> AppResult<bool> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM engagements WHERE id = ?1)", [engagement_id], |r| r.get(0))?)
}

/// Whether row `id` of `table` exists and belongs to the engagement. The caller picks the error.
pub(crate) fn in_engagement(conn: &Connection, table: &'static str, engagement_id: &str, id: &str) -> AppResult<bool> {
    Ok(conn.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1 AND engagement_id = ?2)"),
        params![id, engagement_id],
        |r| r.get(0),
    )?)
}

/// Row `id` of `table` must belong to the engagement; otherwise `NotFound`.
pub(crate) fn check_in_engagement(conn: &Connection, table: &'static str, engagement_id: &str, id: &str) -> AppResult<()> {
    if in_engagement(conn, table, engagement_id, id)? { Ok(()) } else { Err(AppError::NotFound) }
}

/// The engagement must exist, and a host (if given) must belong to it; otherwise `NotFound`.
pub(crate) fn check_scope(conn: &Connection, engagement_id: &str, host_id: Option<&str>) -> AppResult<()> {
    let ok = match host_id {
        None => engagement_exists(conn, engagement_id)?,
        Some(h) => in_engagement(conn, "hosts", engagement_id, h)?,
    };
    if ok { Ok(()) } else { Err(AppError::NotFound) }
}

/// An all-or-nothing group of writes that also works inside a caller's transaction: a savepoint, which is its own
/// transaction when there is none open. Dropped without `commit`, it rolls back to where it started.
pub(crate) struct Atomic<'c> {
    conn: &'c Connection,
    done: bool,
}

pub(crate) fn atomic(conn: &Connection) -> AppResult<Atomic<'_>> {
    conn.execute_batch("SAVEPOINT raven_atomic")?;
    Ok(Atomic { conn, done: false })
}

impl Atomic<'_> {
    pub(crate) fn commit(mut self) -> AppResult<()> {
        self.conn.execute_batch("RELEASE raven_atomic")?;
        self.done = true;
        Ok(())
    }
}

impl std::ops::Deref for Atomic<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        self.conn
    }
}

impl Drop for Atomic<'_> {
    fn drop(&mut self) {
        if !self.done {
            let _ = self.conn.execute_batch("ROLLBACK TO raven_atomic; RELEASE raven_atomic");
        }
    }
}

/// Deletes row `id` of `table`; `NotFound` if there was none.
pub(crate) fn delete_by_id(conn: &Connection, table: &'static str, id: &str) -> AppResult<()> {
    if conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])? == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_to_none_trims_and_drops_blank() {
        assert_eq!(blank_to_none(None), None);
        assert_eq!(blank_to_none(Some("  \n")), None);
        assert_eq!(blank_to_none(Some(" a b ")), Some("a b".into()));
    }
}
