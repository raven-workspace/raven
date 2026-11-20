//! Applies an `ImportPlan` (built in TS from an old-Raven backup) to the open vault.
//!
//! Safety rules:
//! - an automatic `pre-import` backup is taken first; if it fails, nothing is touched;
//! - everything is written in ONE transaction: any error (a dangling reference, a constraint) rolls back all of it;
//! - add-only: every record carries an explicit id; a record whose id is already stored is counted as present
//!   and never updated. Its child rows (entry hosts, attachments, finding links) are not added either. The one
//!   UPDATE is `engagements.msf_host_id`, and only for engagements added by this run.
//! - a record that collides on a secondary unique key (a host's IP, a service's port, a username) under a
//!   different id is counted as present, and the plan's references to it are remapped to the existing row.

use crate::backup::{self, system_now_ms};
use crate::checklist::Evidence;
use crate::error::{AppError, AppResult};
use crate::log::{LogContent, NewAttachment};
use crate::vault::Vault;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

// ------------------------------------------------------------------ plan (mirror of src/engines/import/plan.ts)

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlanInput {
    pub engagements: Vec<PlanEngagement>,
    pub hosts: Vec<PlanHost>,
    pub services: Vec<PlanService>,
    pub log_entries: Vec<PlanLogEntry>,
    pub notes: Vec<PlanNote>,
    pub checklist: Vec<PlanChecklistItem>,
    pub hops: Vec<PlanHop>,
    pub tunnels: Vec<PlanTunnel>,
    pub findings: Vec<PlanFinding>,
    /// Ordered so a credential's `crackedFrom`/`fromSecretId` target comes before it.
    pub credentials: Vec<PlanCredential>,
    pub usernames: Vec<PlanUsername>,
    pub access_grants: Vec<PlanAccessGrant>,
    pub cred_attempts: Vec<PlanCredAttempt>,
    /// Informational only (shown by the UI before applying).
    #[serde(default)]
    pub skipped: HashMap<String, u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEngagement {
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
    pub msf_host_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanHost {
    pub id: String,
    pub engagement_id: String,
    pub name: String,
    pub ip: Option<String>,
    pub os: Option<String>,
    pub access: String,
    pub dual_homed: bool,
    pub ad_set: Option<bool>,
    pub board_column: String,
    pub board_manual: bool,
    pub access_reviewed_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanService {
    pub id: String,
    pub host_id: String,
    pub port: i64,
    pub protocol: String,
    pub state: String,
    pub nmap_service: Option<String>,
    pub nmap_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanLogEntry {
    pub id: String,
    pub engagement_id: String,
    pub kind: String,
    pub title: String,
    pub title_edited: bool,
    pub ran_on: Option<String>,
    pub host_ids: Vec<String>,
    pub observations: Option<String>,
    pub returned_nothing: bool,
    pub private: bool,
    pub content: LogContent,
    pub at: i64,
    #[serde(default)]
    pub attachment: Option<NewAttachment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanNote {
    pub owner_id: String,
    pub engagement_id: String,
    pub host_id: Option<String>,
    pub body: String,
    pub private: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChecklistItem {
    pub engagement_id: String,
    pub owner_id: String,
    pub goal_id: String,
    pub status: String,
    pub notes: Option<String>,
    pub completed_at: Option<i64>,
    pub auto: bool,
    pub auto_from: Option<String>,
    #[serde(default)]
    pub status_manual: bool,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanHop {
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
pub struct PlanTunnel {
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
pub struct PlanFinding {
    pub id: String,
    pub engagement_id: String,
    pub title: String,
    pub severity: Option<String>,
    pub cvss_vector: Option<String>,
    pub cvss_score: Option<f64>,
    pub status: String,
    pub description: String,
    pub impact: String,
    pub remediation: String,
    pub exploit_notes: String,
    pub lessons: String,
    pub refs: Vec<String>,
    pub host_ids: Vec<String>,
    pub service_ids: Vec<String>,
    pub step_entry_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCredential {
    pub id: String,
    pub engagement_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub username: String,
    pub domain: Option<String>,
    pub secret: String,
    pub hash_type: Option<String>,
    pub scope: String,
    pub local_host_id: Option<String>,
    pub source_host_id: Option<String>,
    pub source: Option<String>,
    pub notes: Option<String>,
    pub crack_status: Option<String>,
    pub cracked_from: Option<String>,
    pub from_secret_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanUsername {
    pub id: String,
    pub engagement_id: String,
    pub username: String,
    pub domain: Option<String>,
    pub source_host_id: Option<String>,
    pub source: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAccessGrant {
    pub id: String,
    pub engagement_id: String,
    pub username_id: String,
    pub host_id: String,
    pub level: String,
    pub via: String,
    pub log_entry_id: Option<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCredAttempt {
    pub id: String,
    pub engagement_id: String,
    pub cred_id: String,
    pub username_id: Option<String>,
    pub host_id: String,
    pub service: String,
    pub port: Option<i64>,
    pub result: String,
    pub auth_mode: String,
    pub detail: Option<String>,
    pub log_entry_id: Option<String>,
    pub at: i64,
}

// ------------------------------------------------------------------ summary

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Counts {
    pub added: u32,
    /// Already stored under the same id (or, for services, usernames and attempts, the same unique key).
    pub present: u32,
    /// Matched to a different row the user already had (a host on its IP, a credential on its key);
    /// the plan's references now point at that row.
    pub merged: u32,
}

/// What happened to one planned record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Added,
    Present,
    Merged,
}

impl Counts {
    fn count(&mut self, o: Outcome) {
        match o {
            Outcome::Added => self.added += 1,
            Outcome::Present => self.present += 1,
            Outcome::Merged => self.merged += 1,
        }
    }
}

impl From<bool> for Outcome {
    fn from(added: bool) -> Self {
        if added { Outcome::Added } else { Outcome::Present }
    }
}

/// Added and already-present counts per record type.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub engagements: Counts,
    pub hosts: Counts,
    pub services: Counts,
    pub log_entries: Counts,
    pub notes: Counts,
    pub checklist: Counts,
    pub tunnels: Counts,
    pub hops: Counts,
    pub findings: Counts,
    pub credentials: Counts,
    pub usernames: Counts,
    pub access_grants: Counts,
    pub cred_attempts: Counts,
}

// ------------------------------------------------------------------ apply

/// Takes a `pre-import` backup, then applies the plan in one transaction.
pub fn apply(vault: &Vault, plan: &ImportPlanInput) -> AppResult<ImportSummary> {
    let conn = vault.conn()?;
    backup::take(vault, "pre-import")?;
    apply_plan(conn, plan, system_now_ms())
}

/// The transaction part of `apply` (no backup). All or nothing: the transaction rolls back on any error.
pub(crate) fn apply_plan(conn: &Connection, plan: &ImportPlanInput, now: i64) -> AppResult<ImportSummary> {
    let tx = conn.unchecked_transaction()?;
    let mut cx = Ctx {
        tx: &tx,
        now,
        hosts: HashMap::new(),
        services: HashMap::new(),
        usernames: HashMap::new(),
        credentials: HashMap::new(),
        added_hosts: HashSet::new(),
        host_engagement: HashMap::new(),
        merged_names: HashMap::new(),
    };
    let mut sum = ImportSummary::default();
    let mut added_engagements: HashSet<&str> = HashSet::new();

    for e in &plan.engagements {
        let added = cx.engagement(e, plan)?;
        if added {
            added_engagements.insert(e.id.as_str());
        }
        sum.engagements.count(added.into());
    }
    for h in &plan.hosts {
        sum.hosts.count(cx.host(h)?);
    }
    for s in &plan.services {
        sum.services.count(cx.service(s)?.into());
    }
    for e in &plan.log_entries {
        sum.log_entries.count(cx.log_entry(e)?.into());
    }
    for n in &plan.notes {
        sum.notes.count(cx.note(n)?);
    }
    for i in &plan.checklist {
        sum.checklist.count(cx.checklist_item(i)?.into());
    }
    for t in &plan.tunnels {
        sum.tunnels.count(cx.tunnel(t)?.into());
    }
    for h in &plan.hops {
        sum.hops.count(cx.hop(h)?.into());
    }
    for f in &plan.findings {
        sum.findings.count(cx.finding(f)?.into());
    }
    for c in &plan.credentials {
        sum.credentials.count(cx.credential(c)?);
    }
    for u in &plan.usernames {
        sum.usernames.count(cx.username(u)?.into());
    }
    for g in &plan.access_grants {
        sum.access_grants.count(cx.grant(g)?.into());
    }
    for a in &plan.cred_attempts {
        sum.cred_attempts.count(cx.attempt(a)?.into());
    }
    // Last, once the hosts exist: the msf lock, only for engagements this run added.
    for e in &plan.engagements {
        if let (true, Some(h)) = (added_engagements.contains(e.id.as_str()), &e.msf_host_id) {
            let h = cx.host_ref(&e.id, h, "msfHostId")?;
            tx.execute(
                "UPDATE engagements SET msf_host_id = ?2 WHERE id = ?1 AND msf_host_id IS NULL",
                params![e.id, h],
            )?;
        }
    }
    tx.commit()?;
    Ok(sum)
}

fn dangling(field: &str, id: &str) -> AppError {
    AppError::validation(field, format!("{field} {id} is neither in this import nor in the database"))
}

/// Order-preserving dedupe.
fn dedupe(ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.into_iter().filter(|i| seen.insert(i.clone())).collect()
}

/// Insert state: the transaction plus the id remaps for unique-key collisions (planned id -> stored id).
struct Ctx<'a> {
    tx: &'a Connection,
    now: i64,
    hosts: HashMap<String, String>,
    services: HashMap<String, String>,
    usernames: HashMap<String, String>,
    credentials: HashMap<String, String>,
    /// Hosts this run inserted: an IP collision with one of them is a plan bug, never a merge (Ruling T6-R1).
    added_hosts: HashSet<String>,
    /// Planned host id -> its planned engagement (services resolve their host through it).
    host_engagement: HashMap<String, String>,
    /// Planned host id -> planned name, for hosts merged onto a host the user already had.
    merged_names: HashMap<String, String>,
}

impl Ctx<'_> {
    fn exists(&self, table: &str, id: &str) -> AppResult<bool> {
        Ok(self.tx.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1)"), [id], |r| r.get(0))?)
    }

    fn find(&self, sql: &str, p: impl rusqlite::Params) -> AppResult<Option<String>> {
        Ok(self.tx.query_row(sql, p, |r| r.get(0)).optional()?)
    }

    fn engagement_ref(&self, id: &str) -> AppResult<()> {
        if self.exists("engagements", id)? { Ok(()) } else { Err(dangling("engagementId", id)) }
    }

    /// Resolves a reference to a row of `table` (with an `engagement_id` column) in `engagement_id`.
    fn scoped(&self, table: &str, engagement_id: &str, id: &str, field: &str) -> AppResult<String> {
        let owner = self.find(&format!("SELECT engagement_id FROM {table} WHERE id = ?1"), [id])?;
        match owner {
            None => Err(dangling(field, id)),
            Some(e) if e != engagement_id => Err(AppError::validation(field, format!("{field} {id} belongs to another engagement"))),
            Some(_) => Ok(id.to_string()),
        }
    }

    fn host_ref(&self, engagement_id: &str, id: &str, field: &str) -> AppResult<String> {
        let id = self.hosts.get(id).map_or(id, String::as_str);
        self.scoped("hosts", engagement_id, id, field)
    }

    fn opt_host_ref(&self, engagement_id: &str, id: &Option<String>, field: &str) -> AppResult<Option<String>> {
        id.as_deref().map(|h| self.host_ref(engagement_id, h, field)).transpose()
    }

    fn entry_ref(&self, engagement_id: &str, id: &str, field: &str) -> AppResult<String> {
        self.scoped("log_entries", engagement_id, id, field)
    }

    fn opt_entry_ref(&self, engagement_id: &str, id: &Option<String>, field: &str) -> AppResult<Option<String>> {
        id.as_deref().map(|e| self.entry_ref(engagement_id, e, field)).transpose()
    }

    fn cred_ref(&self, engagement_id: &str, id: &str, field: &str) -> AppResult<String> {
        let id = self.credentials.get(id).map_or(id, String::as_str);
        self.scoped("credentials", engagement_id, id, field)
    }

    fn username_ref(&self, engagement_id: &str, id: &str, field: &str) -> AppResult<String> {
        let id = self.usernames.get(id).map_or(id, String::as_str);
        self.scoped("usernames", engagement_id, id, field)
    }

    fn service_ref(&self, engagement_id: &str, id: &str, field: &str) -> AppResult<String> {
        let id = self.services.get(id).map_or(id, String::as_str);
        let owner = self.find(
            "SELECT h.engagement_id FROM services s JOIN hosts h ON h.id = s.host_id WHERE s.id = ?1",
            [id],
        )?;
        match owner {
            None => Err(dangling(field, id)),
            Some(e) if e != engagement_id => Err(AppError::validation(field, format!("{field} {id} belongs to another engagement"))),
            Some(_) => Ok(id.to_string()),
        }
    }

    fn engagement(&mut self, e: &PlanEngagement, plan: &ImportPlanInput) -> AppResult<bool> {
        // The rules engagements.rs applies on every edit (Ruling T6-R2).
        let name = e.name.trim();
        if name.is_empty() || name.chars().count() > 120 {
            return Err(AppError::validation("name", format!("engagement {}: name must be 1-120 characters", e.id)));
        }
        if let Some(bad) = e.scope_cidrs.iter().find(|c| !crate::engagements::valid_cidr(c.trim())) {
            return Err(AppError::validation("scopeCidrs", format!("engagement {}: invalid IPv4 CIDR: {bad}", e.id)));
        }
        if self.exists("engagements", &e.id)? {
            return Ok(false);
        }
        let last_activity = plan.log_entries.iter().filter(|l| l.engagement_id == e.id).map(|l| l.at).max();
        let cidrs = serde_json::to_string(&e.scope_cidrs)?;
        // msf_host_id is set at the end, once the hosts exist.
        self.tx.execute(
            "INSERT INTO engagements (id, name, kind, client, sub_label, scope_cidrs, domain, starts_at, ends_at, \
             timebox_start, timebox_minutes, status, created_at, updated_at, last_activity_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,?14)",
            params![
                e.id, name, e.kind, e.client, e.sub_label, cidrs, e.domain, e.starts_at, e.ends_at,
                e.timebox_start, e.timebox_minutes, e.status, self.now, last_activity
            ],
        )?;
        Ok(true)
    }

    fn host(&mut self, h: &PlanHost) -> AppResult<Outcome> {
        self.engagement_ref(&h.engagement_id)?;
        // The rules hosts.rs applies on every edit (Ruling T6-R2).
        let name = h.name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(AppError::validation("name", format!("host {}: name must be 1-80 characters", h.id)));
        }
        if let Some(ip) = &h.ip
            && crate::hosts::single_ip(ip).as_deref() != Some(ip.as_str())
        {
            return Err(AppError::validation("ip", format!("host {}: {ip} is not a single IPv4 address", h.id)));
        }
        self.host_engagement.insert(h.id.clone(), h.engagement_id.clone());
        if let Some(stored) = self.find("SELECT engagement_id FROM hosts WHERE id = ?1", [&h.id])? {
            if stored != h.engagement_id {
                return Err(AppError::validation(
                    "hostId",
                    format!("{name} was already imported into another engagement; import it from there or delete it first"),
                ));
            }
            return Ok(Outcome::Present);
        }
        if let Some(ip) = &h.ip
            && let Some(existing) =
                self.find("SELECT id FROM hosts WHERE engagement_id = ?1 AND ip = ?2", params![h.engagement_id, ip])?
        {
            // Ruling T6-R1: two planned hosts on one IP must never merge; only a host the user already had does.
            if self.added_hosts.contains(&existing) {
                return Err(AppError::validation("ip", format!("hosts {existing} and {} in this import share the IP {ip}", h.id)));
            }
            self.hosts.insert(h.id.clone(), existing);
            self.merged_names.insert(h.id.clone(), name.to_string());
            return Ok(Outcome::Merged);
        }
        self.tx.execute(
            "INSERT INTO hosts (id, engagement_id, name, ip, os, board_column, board_manual, access, created_at, \
             updated_at, dual_homed, access_reviewed_at, ad_set) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10,?11,?12)",
            params![
                h.id, h.engagement_id, name, h.ip, h.os, h.board_column, h.board_manual, h.access, self.now,
                h.dual_homed, h.access_reviewed_at, h.ad_set
            ],
        )?;
        self.added_hosts.insert(h.id.clone());
        Ok(Outcome::Added)
    }

    fn service(&mut self, s: &PlanService) -> AppResult<bool> {
        // A service comes with its host: resolving through the planned host's engagement means it never
        // attaches to a host of another engagement.
        let eng = self.host_engagement.get(&s.host_id).cloned().ok_or_else(|| dangling("hostId", &s.host_id))?;
        let host_id = self.host_ref(&eng, &s.host_id, "hostId")?;
        if self.exists("services", &s.id)? {
            return Ok(false);
        }
        if let Some(existing) = self.find(
            "SELECT id FROM services WHERE host_id = ?1 AND port = ?2 AND protocol = ?3",
            params![host_id, s.port, s.protocol],
        )? {
            self.services.insert(s.id.clone(), existing);
            return Ok(false);
        }
        self.tx.execute(
            "INSERT INTO services (id, host_id, port, protocol, state, nmap_service, nmap_version, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
            params![s.id, host_id, s.port, s.protocol, s.state, s.nmap_service, s.nmap_version, self.now],
        )?;
        Ok(true)
    }

    fn log_entry(&mut self, e: &PlanLogEntry) -> AppResult<bool> {
        let eng = e.engagement_id.as_str();
        self.engagement_ref(eng)?;
        let title = crate::log::check_title(&e.title)?;
        crate::log::check_content(&e.content)?;
        if e.kind != e.content.kind() {
            return Err(AppError::validation("content", format!("entry {} has kind {} but {} content", e.id, e.kind, e.content.kind())));
        }
        let mut host_ids = Vec::with_capacity(e.host_ids.len());
        for h in &e.host_ids {
            host_ids.push(self.host_ref(eng, h, "hostIds")?);
        }
        let host_ids = dedupe(host_ids);
        // Before the decode: a re-import must not decode up to 25 MiB per stored screenshot for nothing.
        if self.exists("log_entries", &e.id)? {
            return Ok(false);
        }
        let mut content = e.content.clone();
        let wants_attachment = matches!(content, LogContent::Screenshot { .. } | LogContent::Flag { .. });
        let upload = match (&e.attachment, &content) {
            (Some(a), _) if wants_attachment => Some((a.mime.clone(), crate::log::decode_attachment(a)?)),
            (None, LogContent::Screenshot { .. }) => {
                return Err(AppError::validation("attachment", format!("screenshot entry {} has no image", e.id)));
            }
            (Some(_), _) => return Err(AppError::validation("attachment", format!("entry {} takes no attachment", e.id))),
            _ => None,
        };
        let att_id = upload.as_ref().map(|_| uuid::Uuid::new_v4().to_string());
        match &mut content {
            LogContent::Screenshot { attachment_id, .. } => *attachment_id = att_id.clone().unwrap_or_default(),
            // No upload, no attachment: a planned id would point at nothing (or at another entry's image).
            LogContent::Flag { attachment_id, .. } => *attachment_id = att_id.clone(),
            _ => {}
        }
        let json = serde_json::to_string(&content)?;
        let trim = |v: &Option<String>| v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        self.tx.execute(
            "INSERT INTO log_entries (id, engagement_id, kind, title, title_edited, ran_on, observations, \
             returned_nothing, private, content, at, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
            params![
                e.id, eng, content.kind(), title, e.title_edited, trim(&e.ran_on), trim(&e.observations),
                e.returned_nothing, e.private, json, e.at, self.now
            ],
        )?;
        for h in &host_ids {
            self.tx.execute("INSERT INTO log_entry_hosts (entry_id, host_id) VALUES (?1, ?2)", params![e.id, h])?;
        }
        if let (Some(att_id), Some((mime, bytes))) = (att_id, upload) {
            self.tx.execute(
                "INSERT INTO attachments (id, engagement_id, entry_id, mime, bytes, size, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![att_id, eng, e.id, mime, bytes, bytes.len() as i64, self.now],
            )?;
        }
        Ok(true)
    }

    fn note(&mut self, n: &PlanNote) -> AppResult<Outcome> {
        let eng = n.engagement_id.as_str();
        self.engagement_ref(eng)?;
        if n.body.len() > crate::notes::MAX_BODY {
            return Err(AppError::validation("body", format!("note {} is longer than 1 MiB", n.owner_id)));
        }
        let (owner, host_id) = match &n.host_id {
            None if n.owner_id == eng => (eng.to_string(), None),
            Some(h) if &n.owner_id == h => {
                let h = self.host_ref(eng, h, "hostId")?;
                (h.clone(), Some(h))
            }
            _ => return Err(AppError::validation("ownerId", format!("note owner {} does not match its host", n.owner_id))),
        };
        if self.find("SELECT owner_id FROM notes WHERE owner_id = ?1", [&owner])?.is_some() {
            // A merged host whose user-made host already has a note: the user's note is never touched; the
            // imported body becomes a log note on that host, under a fixed id so a re-import finds it.
            if let (Some(h), Some(old_name)) = (&host_id, self.merged_names.get(&n.owner_id)) {
                return self.merged_note_entry(eng, h, &n.owner_id, old_name, &n.body);
            }
            return Ok(Outcome::Present);
        }
        self.tx.execute(
            "INSERT INTO notes (owner_id, engagement_id, host_id, body, private, updated_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![owner, eng, host_id, n.body, n.private, self.now],
        )?;
        Ok(Outcome::Added)
    }

    fn merged_note_entry(&self, eng: &str, host_id: &str, planned_host: &str, old_name: &str, body: &str) -> AppResult<Outcome> {
        let id = format!("{planned_host}:imported-notes");
        if self.exists("log_entries", &id)? {
            return Ok(Outcome::Present);
        }
        if body.trim().is_empty() {
            return Ok(Outcome::Present);
        }
        let title = crate::log::check_title(&format!("Imported notes ({old_name})"))?;
        let content = LogContent::Note { text: body.to_string() };
        let json = serde_json::to_string(&content)?;
        self.tx.execute(
            "INSERT INTO log_entries (id, engagement_id, kind, title, title_edited, content, at, created_at, updated_at) \
             VALUES (?1,?2,'note',?3,1,?4,?5,?5,?5)",
            params![id, eng, title, json, self.now],
        )?;
        self.tx.execute("INSERT INTO log_entry_hosts (entry_id, host_id) VALUES (?1, ?2)", params![id, host_id])?;
        Ok(Outcome::Merged)
    }

    fn checklist_item(&mut self, i: &PlanChecklistItem) -> AppResult<bool> {
        let eng = i.engagement_id.as_str();
        self.engagement_ref(eng)?;
        if i.goal_id.trim().is_empty() {
            return Err(AppError::validation("goalId", "goal id is required"));
        }
        let owner = if i.owner_id == eng { eng.to_string() } else { self.host_ref(eng, &i.owner_id, "ownerId")? };
        for ev in &i.evidence {
            self.entry_ref(eng, &ev.entry_id, "evidence")?;
        }
        if self
            .find("SELECT goal_id FROM checklist_items WHERE owner_id = ?1 AND goal_id = ?2", params![owner, i.goal_id])?
            .is_some()
        {
            return Ok(false);
        }
        let evidence = serde_json::to_string(&i.evidence)?;
        self.tx.execute(
            "INSERT INTO checklist_items \
               (owner_id, engagement_id, goal_id, status, notes, completed_at, auto, auto_from, evidence, updated_at, status_manual) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![owner, eng, i.goal_id, i.status, i.notes, i.completed_at, i.auto, i.auto_from, evidence, self.now, i.status_manual],
        )?;
        Ok(true)
    }

    fn tunnel(&mut self, t: &PlanTunnel) -> AppResult<bool> {
        let eng = t.engagement_id.as_str();
        self.engagement_ref(eng)?;
        let via = self.host_ref(eng, &t.via_host_id, "viaHostId")?;
        // The rules network.rs applies on every edit.
        if t.subnets.len() > crate::network::MAX_SUBNETS {
            return Err(AppError::validation("subnets", format!("tunnel {} has too many subnets", t.id)));
        }
        if let Some(bad) = t.subnets.iter().find(|c| !crate::engagements::valid_cidr(c.trim())) {
            return Err(AppError::validation("subnets", format!("tunnel {}: invalid IPv4 CIDR: {bad}", t.id)));
        }
        let cb = t.callback_ip.trim();
        if !cb.is_empty() && (cb.contains('/') || !crate::engagements::valid_cidr(cb)) {
            return Err(AppError::validation("callbackIp", format!("tunnel {}: callback must be a single IPv4 address", t.id)));
        }
        if self.exists("tunnels", &t.id)? {
            return Ok(false);
        }
        let subnets = serde_json::to_string(&t.subnets)?;
        self.tx.execute(
            "INSERT INTO tunnels (id, engagement_id, kind, via_host_id, subnets, callback_ip, status, notes, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![t.id, eng, t.kind, via, subnets, t.callback_ip, t.status, t.notes, t.created_at, t.updated_at],
        )?;
        Ok(true)
    }

    fn hop(&mut self, h: &PlanHop) -> AppResult<bool> {
        let eng = h.engagement_id.as_str();
        self.engagement_ref(eng)?;
        let to = self.host_ref(eng, &h.to_host_id, "toHostId")?;
        let from = self.opt_host_ref(eng, &h.from_host_id, "fromHostId")?;
        if from.as_deref() == Some(to.as_str()) {
            return Err(AppError::validation("toHostId", format!("hop {} goes from a host to itself", h.id)));
        }
        let log_entry_id = self.opt_entry_ref(eng, &h.log_entry_id, "logEntryId")?;
        if h.via.trim().is_empty() {
            return Err(AppError::validation("via", format!("hop {} has no via", h.id)));
        }
        if self.exists("hops", &h.id)? {
            return Ok(false);
        }
        self.tx.execute(
            "INSERT INTO hops (id, engagement_id, from_host_id, to_host_id, via, log_entry_id, at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![h.id, eng, from, to, h.via.trim(), log_entry_id, h.at, h.updated_at],
        )?;
        Ok(true)
    }

    fn finding(&mut self, f: &PlanFinding) -> AppResult<bool> {
        let eng = f.engagement_id.as_str();
        self.engagement_ref(eng)?;
        // The rules findings.rs applies on every edit.
        if f.title.trim().is_empty() {
            return Err(AppError::validation("title", format!("finding {} has no title", f.id)));
        }
        if f.cvss_score.is_some_and(|s| !(0.0..=10.0).contains(&s)) {
            return Err(AppError::validation("cvssScore", format!("finding {} has a CVSS score outside 0-10", f.id)));
        }
        if f.refs.len() > crate::findings::MAX_REFS || f.refs.iter().any(|r| r.trim().is_empty()) {
            return Err(AppError::validation("refs", format!("finding {}: at most 100 non-blank references", f.id)));
        }
        for (field, text) in [
            ("description", &f.description),
            ("impact", &f.impact),
            ("remediation", &f.remediation),
            ("exploitNotes", &f.exploit_notes),
            ("lessons", &f.lessons),
        ] {
            if text.len() > crate::findings::MAX_CONTENT {
                return Err(AppError::validation(field, format!("finding {}: {field} is longer than 1 MiB", f.id)));
            }
        }
        let host_ids = dedupe(f.host_ids.iter().map(|h| self.host_ref(eng, h, "hostIds")).collect::<AppResult<_>>()?);
        let service_ids =
            dedupe(f.service_ids.iter().map(|s| self.service_ref(eng, s, "serviceIds")).collect::<AppResult<_>>()?);
        let steps =
            dedupe(f.step_entry_ids.iter().map(|e| self.entry_ref(eng, e, "stepEntryIds")).collect::<AppResult<_>>()?);
        if self.exists("findings", &f.id)? {
            return Ok(false);
        }
        let refs = serde_json::to_string(&f.refs)?;
        self.tx.execute(
            "INSERT INTO findings (id, engagement_id, title, severity, cvss_vector, cvss_score, status, description, impact, \
             remediation, exploit_notes, lessons, refs, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![
                f.id, eng, f.title, f.severity, f.cvss_vector, f.cvss_score, f.status, f.description, f.impact,
                f.remediation, f.exploit_notes, f.lessons, refs, f.created_at, f.updated_at
            ],
        )?;
        for h in &host_ids {
            self.tx.execute("INSERT INTO finding_hosts (finding_id, host_id) VALUES (?1, ?2)", params![f.id, h])?;
        }
        for s in &service_ids {
            self.tx.execute("INSERT INTO finding_services (finding_id, service_id) VALUES (?1, ?2)", params![f.id, s])?;
        }
        for (pos, e) in steps.iter().enumerate() {
            self.tx.execute(
                "INSERT INTO finding_steps (finding_id, entry_id, position) VALUES (?1, ?2, ?3)",
                params![f.id, e, pos as i64],
            )?;
        }
        Ok(true)
    }

    fn credential(&mut self, c: &PlanCredential) -> AppResult<Outcome> {
        let eng = c.engagement_id.as_str();
        self.engagement_ref(eng)?;
        let local_host = self.opt_host_ref(eng, &c.local_host_id, "localHostId")?;
        if (c.scope == "local") != local_host.is_some() {
            return Err(AppError::validation("localHostId", format!("credential {}: only a local credential has a host", c.id)));
        }
        let source_host = self.opt_host_ref(eng, &c.source_host_id, "sourceHostId")?;
        let mut links = [None, None];
        for (slot, (field, link)) in links.iter_mut().zip([("crackedFrom", &c.cracked_from), ("fromSecretId", &c.from_secret_id)]) {
            if let Some(l) = link {
                let l = self.cred_ref(eng, l, field)?;
                if l == c.id {
                    return Err(AppError::validation(field, format!("credential {} links to itself", c.id)));
                }
                *slot = Some(l);
            }
        }
        let [cracked_from, from_secret] = links;
        if self.exists("credentials", &c.id)? {
            return Ok(Outcome::Present);
        }
        // A stored credential with the same key (type, username, secret, domain, local host): merge, so editing
        // either never trips credentials.rs's "already exists" rule.
        let probe = crate::credentials::Credential {
            id: c.id.clone(),
            engagement_id: eng.to_string(),
            kind: c.kind.clone(),
            username: c.username.clone(),
            domain: c.domain.clone(),
            secret: c.secret.clone(),
            hash_type: None,
            scope: c.scope.clone(),
            local_host_id: local_host.clone(),
            source_host_id: None,
            source: None,
            notes: None,
            crack_status: None,
            cracked_from: None,
            from_secret_id: None,
            created_at: 0,
            updated_at: 0,
        };
        if let Some(existing) = crate::credentials::find_duplicate(self.tx, &probe, &c.id)? {
            self.credentials.insert(c.id.clone(), existing.id);
            return Ok(Outcome::Merged);
        }
        self.tx.execute(
            "INSERT INTO credentials (id, engagement_id, type, username, domain, secret, hash_type, scope, local_host_id, \
             source_host_id, source, notes, crack_status, cracked_from, from_secret_id, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            params![
                c.id, eng, c.kind, c.username, c.domain, c.secret, c.hash_type, c.scope, local_host, source_host,
                c.source, c.notes, c.crack_status, cracked_from, from_secret, c.created_at, c.updated_at
            ],
        )?;
        Ok(Outcome::Added)
    }

    fn username(&mut self, u: &PlanUsername) -> AppResult<bool> {
        let eng = u.engagement_id.as_str();
        self.engagement_ref(eng)?;
        if u.username.trim().is_empty() {
            return Err(AppError::validation("username", format!("username {} is blank", u.id)));
        }
        let source_host = self.opt_host_ref(eng, &u.source_host_id, "sourceHostId")?;
        if self.exists("usernames", &u.id)? {
            return Ok(false);
        }
        // The unique index is (engagement, lower(username), lower(ifnull(domain,''))): reuse that row.
        if let Some(existing) = self.find(
            "SELECT id FROM usernames WHERE engagement_id = ?1 AND lower(username) = lower(?2) \
             AND lower(ifnull(domain,'')) = lower(ifnull(?3,''))",
            params![eng, u.username, u.domain],
        )? {
            self.usernames.insert(u.id.clone(), existing);
            return Ok(false);
        }
        self.tx.execute(
            "INSERT INTO usernames (id, engagement_id, username, domain, source_host_id, source, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![u.id, eng, u.username, u.domain, source_host, u.source, u.created_at],
        )?;
        Ok(true)
    }

    fn grant(&mut self, g: &PlanAccessGrant) -> AppResult<bool> {
        let eng = g.engagement_id.as_str();
        self.engagement_ref(eng)?;
        let username = self.username_ref(eng, &g.username_id, "usernameId")?;
        let host = self.host_ref(eng, &g.host_id, "hostId")?;
        let log_entry_id = self.opt_entry_ref(eng, &g.log_entry_id, "logEntryId")?;
        if g.via.trim().is_empty() {
            return Err(AppError::validation("via", format!("access grant {} has no via", g.id)));
        }
        if self.exists("access_grants", &g.id)? {
            return Ok(false);
        }
        self.tx.execute(
            "INSERT INTO access_grants (id, engagement_id, username_id, host_id, level, via, log_entry_id, at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![g.id, eng, username, host, g.level, g.via.trim(), log_entry_id, g.at],
        )?;
        Ok(true)
    }

    fn attempt(&mut self, a: &PlanCredAttempt) -> AppResult<bool> {
        let eng = a.engagement_id.as_str();
        self.engagement_ref(eng)?;
        let cred = self.cred_ref(eng, &a.cred_id, "credId")?;
        let username = a.username_id.as_deref().map(|u| self.username_ref(eng, u, "usernameId")).transpose()?;
        let host = self.host_ref(eng, &a.host_id, "hostId")?;
        let log_entry_id = self.opt_entry_ref(eng, &a.log_entry_id, "logEntryId")?;
        if a.port.is_some_and(|p| !(1..=65535).contains(&p)) {
            return Err(AppError::validation("port", format!("attempt {} has a port outside 1-65535", a.id)));
        }
        if self.exists("cred_attempts", &a.id)? {
            return Ok(false);
        }
        // Same key under another id: the stored result stands.
        if self
            .find(
                "SELECT id FROM cred_attempts WHERE cred_id = ?1 AND ifnull(username_id,'') = ifnull(?2,'') \
                 AND host_id = ?3 AND service = ?4 AND auth_mode = ?5",
                params![cred, username, host, a.service, a.auth_mode],
            )?
            .is_some()
        {
            return Ok(false);
        }
        self.tx.execute(
            "INSERT INTO cred_attempts (id, engagement_id, cred_id, username_id, host_id, service, port, result, \
             auth_mode, detail, log_entry_id, at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                a.id, eng, cred, username, host, a.service, a.port, a.result, a.auth_mode, a.detail, log_entry_id, a.at
            ],
        )?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::DataPaths;
    use serde_json::{json, Value};

    const PNG: &str = "iVBORw0KGgo=";

    /// Breaks one field of a plan.
    type Breaker = Box<dyn Fn(&mut Value)>;

    fn unlocked() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        (dir, v)
    }

    /// A plan in the exact JSON shape the TS `ImportPlan` serialises to.
    fn plan_json() -> Value {
        json!({
            "engagements": [{
                "id": "E1", "name": "Lab one", "kind": "lab", "client": null, "subLabel": null,
                "scopeCidrs": ["10.0.0.0/24"], "domain": "corp.local", "startsAt": null, "endsAt": null,
                "timeboxStart": null, "timeboxMinutes": null, "status": "active", "msfHostId": "h1"
            }],
            "hosts": [
                { "id": "h1", "engagementId": "E1", "name": "dc01", "ip": "10.0.0.5", "os": "windows", "access": "root",
                  "dualHomed": false, "adSet": null, "boardColumn": "post-exploitation", "boardManual": true, "accessReviewedAt": null },
                { "id": "h2", "engagementId": "E1", "name": "web", "ip": "10.0.0.6", "os": "linux", "access": "user",
                  "dualHomed": true, "adSet": false, "boardColumn": "vulnerability-detection", "boardManual": false, "accessReviewedAt": 5 }
            ],
            "services": [
                { "id": "h1:tcp/445", "hostId": "h1", "port": 445, "protocol": "tcp", "state": "open",
                  "nmapService": "microsoft-ds", "nmapVersion": null },
                { "id": "h2:tcp/80", "hostId": "h2", "port": 80, "protocol": "tcp", "state": "open",
                  "nmapService": "http", "nmapVersion": "nginx" }
            ],
            "logEntries": [
                { "id": "l1", "engagementId": "E1", "kind": "command", "title": "nmap", "titleEdited": true,
                  "ranOn": "kali", "hostIds": ["h1", "h2"], "observations": null, "returnedNothing": false,
                  "private": false, "content": { "kind": "command", "blocks": [{ "command": "nmap -sV", "output": "x" }] },
                  "at": 100 },
                { "id": "l2", "engagementId": "E1", "kind": "screenshot", "title": "shot", "titleEdited": true,
                  "ranOn": null, "hostIds": ["h2"], "observations": null, "returnedNothing": false, "private": false,
                  "content": { "kind": "screenshot", "attachmentId": "", "caption": "c", "fileName": "s.png" },
                  "at": 200, "attachment": { "mime": "image/png", "dataBase64": PNG } },
                { "id": "l3", "engagementId": "E1", "kind": "flag", "title": "flag", "titleEdited": true,
                  "ranOn": null, "hostIds": ["h1"], "observations": null, "returnedNothing": false, "private": false,
                  "content": { "kind": "flag", "flagKind": "proof", "value": "abc", "attachmentId": null, "proof": null },
                  "at": 300, "attachment": { "mime": "image/png", "dataBase64": PNG } },
                { "id": "l4", "engagementId": "E1", "kind": "note", "title": "n", "titleEdited": true,
                  "ranOn": null, "hostIds": [], "observations": null, "returnedNothing": false, "private": false,
                  "content": { "kind": "note", "text": "hello" }, "at": 400 }
            ],
            "notes": [
                { "ownerId": "h1", "engagementId": "E1", "hostId": "h1", "body": "dc notes", "private": false },
                { "ownerId": "E1", "engagementId": "E1", "hostId": null, "body": "eng notes", "private": false }
            ],
            "checklist": [
                { "engagementId": "E1", "ownerId": "h1", "goalId": "g-host", "status": "done", "notes": null,
                  "completedAt": 10, "auto": false, "autoFrom": null, "evidence": [{ "entryId": "l1", "commandId": null }] },
                { "engagementId": "E1", "ownerId": "E1", "goalId": "g-eng", "status": "todo", "notes": "n",
                  "completedAt": null, "auto": true, "autoFrom": "na", "evidence": [] }
            ],
            "hops": [
                { "id": "p1", "engagementId": "E1", "fromHostId": null, "toHostId": "h2", "via": "web shell",
                  "logEntryId": "l1", "at": 150, "updatedAt": 150 },
                { "id": "p2", "engagementId": "E1", "fromHostId": "h2", "toHostId": "h1", "via": "psexec",
                  "logEntryId": null, "at": 250, "updatedAt": 250 }
            ],
            "tunnels": [
                { "id": "t1", "engagementId": "E1", "kind": "ligolo", "viaHostId": "h2", "subnets": ["10.60.0.0/24"],
                  "callbackIp": "10.10.14.2", "status": "down", "notes": null, "createdAt": 1, "updatedAt": 2 }
            ],
            "findings": [
                { "id": "f1", "engagementId": "E1", "title": "SMB signing", "severity": "high", "cvssVector": null,
                  "cvssScore": 7.5, "status": "draft", "description": "d", "impact": "", "remediation": "r",
                  "exploitNotes": "", "lessons": "", "refs": ["CVE-1"], "hostIds": ["h1"], "serviceIds": ["h1:tcp/445"],
                  "stepEntryIds": ["l1", "l3"], "createdAt": 1, "updatedAt": 2 }
            ],
            "credentials": [
                { "id": "c1", "engagementId": "E1", "type": "hash", "username": "alice", "domain": "corp",
                  "secret": "aad3b435b51404eeaad3b435b51404ee", "hashType": "NTLM", "scope": "domain",
                  "localHostId": null, "sourceHostId": "h2", "source": "sam", "notes": null, "crackStatus": "cracked",
                  "crackedFrom": null, "fromSecretId": null, "createdAt": 1, "updatedAt": 1 },
                { "id": "c2", "engagementId": "E1", "type": "password", "username": "alice", "domain": "corp",
                  "secret": "Summer2024!", "hashType": null, "scope": "local", "localHostId": "h2",
                  "sourceHostId": null, "source": null, "notes": null, "crackStatus": null,
                  "crackedFrom": "c1", "fromSecretId": null, "createdAt": 2, "updatedAt": 2 }
            ],
            "usernames": [
                { "id": "u1", "engagementId": "E1", "username": "bob", "domain": "corp", "sourceHostId": "h1",
                  "source": "ldap", "createdAt": 3 }
            ],
            "accessGrants": [
                { "id": "g1", "engagementId": "E1", "usernameId": "u1", "hostId": "h1", "level": "admin",
                  "via": "winrm", "logEntryId": "l3", "at": 300 }
            ],
            "credAttempts": [
                { "id": "a1", "engagementId": "E1", "credId": "c2", "usernameId": null, "hostId": "h1", "service": "smb",
                  "port": 445, "result": "admin", "authMode": "local", "detail": null, "logEntryId": "l1", "at": 100 },
                { "id": "a2", "engagementId": "E1", "credId": "c2", "usernameId": "u1", "hostId": "h2", "service": "ssh",
                  "port": null, "result": "failed", "authMode": "domain", "detail": "nope", "logEntryId": null, "at": 110 }
            ],
            "skipped": { "missingImage": 1 }
        })
    }

    fn plan_of(v: Value) -> ImportPlanInput {
        serde_json::from_value(v).unwrap()
    }

    fn n(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn s(c: &Connection, sql: &str) -> Option<String> {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    const TABLES: [&str; 18] = [
        "engagements", "hosts", "services", "log_entries", "log_entry_hosts", "attachments", "notes",
        "checklist_items", "tunnels", "hops", "findings", "finding_hosts", "finding_services", "finding_steps",
        "credentials", "usernames", "access_grants", "cred_attempts",
    ];

    fn row_counts(c: &Connection) -> Vec<i64> {
        TABLES.iter().map(|t| n(c, &format!("SELECT count(*) FROM {t}"))).collect()
    }

    fn all_added() -> ImportSummary {
        let c = |added| Counts { added, present: 0, merged: 0 };
        ImportSummary {
            engagements: c(1),
            hosts: c(2),
            services: c(2),
            log_entries: c(4),
            notes: c(2),
            checklist: c(2),
            tunnels: c(1),
            hops: c(2),
            findings: c(1),
            credentials: c(2),
            usernames: c(1),
            access_grants: c(1),
            cred_attempts: c(2),
        }
    }

    fn all_present() -> ImportSummary {
        let a = all_added();
        let p = |c: Counts| Counts { added: 0, present: c.added, merged: 0 };
        ImportSummary {
            engagements: p(a.engagements),
            hosts: p(a.hosts),
            services: p(a.services),
            log_entries: p(a.log_entries),
            notes: p(a.notes),
            checklist: p(a.checklist),
            tunnels: p(a.tunnels),
            hops: p(a.hops),
            findings: p(a.findings),
            credentials: p(a.credentials),
            usernames: p(a.usernames),
            access_grants: p(a.access_grants),
            cred_attempts: p(a.cred_attempts),
        }
    }

    fn expect_validation(p: Value, name: &str) {
        let (_d, v) = unlocked();
        let r = apply(&v, &plan_of(p));
        assert!(matches!(r, Err(AppError::Validation { .. })), "{name}: {r:?}");
        assert_eq!(row_counts(v.conn().unwrap()).iter().sum::<i64>(), 0, "{name}: nothing written");
    }

    #[test]
    fn a_duplicate_ip_within_one_plan_is_rejected_not_merged() {
        let (_d, v) = unlocked();
        let mut p = plan_json();
        p["hosts"][1]["ip"] = json!("10.0.0.5");
        let r = apply(&v, &plan_of(p));
        assert!(matches!(&r, Err(AppError::Validation { field, .. }) if field == "ip"), "{r:?}");
        assert_eq!(row_counts(v.conn().unwrap()).iter().sum::<i64>(), 0);
    }

    #[test]
    fn a_host_merged_onto_a_user_made_host_counts_as_merged() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        c.execute_batch(
            "INSERT INTO engagements (id,name,kind,created_at,updated_at) VALUES ('E1','mine','lab',7,7);
             INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('mine','E1','by hand','10.0.0.5',7,7);",
        )
        .unwrap();
        let sum = apply(&v, &plan_of(plan_json())).unwrap();
        assert_eq!(sum.hosts, Counts { added: 1, present: 0, merged: 1 });
        assert_eq!(n(c, "SELECT count(*) FROM hosts WHERE id='h1'"), 0);
        assert_eq!(s(c, "SELECT name FROM hosts WHERE id='mine'").as_deref(), Some("by hand"));
        assert_eq!(s(c, "SELECT host_id FROM finding_hosts WHERE finding_id='f1'").as_deref(), Some("mine"));
    }

    #[test]
    fn a_credential_equal_to_a_stored_one_is_merged_so_edits_never_hit_the_duplicate_rule() {
        let (_d, v) = unlocked();
        apply(&v, &plan_of(plan_json())).unwrap();
        let c = v.conn().unwrap();
        // The user enters the same hash by hand under another id; a later backup brings it again as c9.
        let mut p = plan_json();
        for k in ["hosts", "services", "logEntries", "notes", "checklist", "hops", "tunnels", "findings", "usernames", "accessGrants"] {
            p[k] = json!([]);
        }
        let mut c9 = p["credentials"][0].clone();
        c9["id"] = json!("c9");
        c9["secret"] = json!(" AAD3B435B51404EEAAD3B435B51404EE ");
        p["credentials"] = json!([c9]);
        p["credAttempts"] = json!([{ "id": "a9", "engagementId": "E1", "credId": "c9", "usernameId": null, "hostId": "h1",
            "service": "winrm", "port": null, "result": "valid", "authMode": "domain", "detail": null, "logEntryId": null, "at": 5 }]);
        let sum = apply(&v, &plan_of(p)).unwrap();
        assert_eq!(sum.credentials, Counts { added: 0, present: 0, merged: 1 });
        assert_eq!(n(c, "SELECT count(*) FROM credentials WHERE id='c9'"), 0);
        assert_eq!(s(c, "SELECT cred_id FROM cred_attempts WHERE id='a9'").as_deref(), Some("c1"));
        // The stored credential still passes the app's own update validation.
        let cur = crate::credentials::get(c, "c1").unwrap();
        let input = crate::credentials::CredentialInput {
            kind: cur.kind, username: cur.username, domain: cur.domain, secret: cur.secret, hash_type: cur.hash_type,
            scope: Some(cur.scope), local_host_id: cur.local_host_id, source_host_id: cur.source_host_id,
            source: cur.source, notes: Some("edited".into()), crack_status: cur.crack_status,
            cracked_from: cur.cracked_from, from_secret_id: cur.from_secret_id,
        };
        crate::credentials::update(c, "c1", input).unwrap();
    }

    #[test]
    fn records_that_would_fail_the_apps_edit_rules_are_rejected() {
        let cases: Vec<(&str, Breaker)> = vec![
            ("host name > 80", Box::new(|p| p["hosts"][0]["name"] = json!("h".repeat(81)))),
            ("blank host name", Box::new(|p| p["hosts"][0]["name"] = json!("  "))),
            ("host ip range", Box::new(|p| p["hosts"][0]["ip"] = json!("10.0.0.0/24"))),
            ("host ip placeholder", Box::new(|p| p["hosts"][0]["ip"] = json!("10.10.11.x"))),
            ("engagement name > 120", Box::new(|p| p["engagements"][0]["name"] = json!("e".repeat(121)))),
            ("engagement scope", Box::new(|p| p["engagements"][0]["scopeCidrs"] = json!(["dmz"]))),
            ("note > 1 MiB", Box::new(|p| p["notes"][0]["body"] = json!("n".repeat(1024 * 1024 + 1)))),
            ("finding refs > 100", Box::new(|p| p["findings"][0]["refs"] = json!(vec!["r"; 101]))),
            ("blank finding ref", Box::new(|p| p["findings"][0]["refs"] = json!([" "]))),
            ("blank finding title", Box::new(|p| p["findings"][0]["title"] = json!(" "))),
            ("finding text > 1 MiB", Box::new(|p| p["findings"][0]["remediation"] = json!("r".repeat(1024 * 1024 + 1)))),
            ("tunnel subnet", Box::new(|p| p["tunnels"][0]["subnets"] = json!(["dmz"]))),
            ("tunnel callback", Box::new(|p| p["tunnels"][0]["callbackIp"] = json!("10.0.0.0/24"))),
            ("blank username", Box::new(|p| p["usernames"][0]["username"] = json!(" "))),
        ];
        for (name, break_it) in cases {
            let mut p = plan_json();
            break_it(&mut p);
            expect_validation(p, name);
        }
        // Names at the limit are fine, counted in characters (not bytes).
        let (_d, v) = unlocked();
        let mut p = plan_json();
        p["hosts"][0]["name"] = json!("é".repeat(80));
        p["engagements"][0]["name"] = json!("é".repeat(120));
        apply(&v, &plan_of(p)).unwrap();
    }

    #[test]
    fn a_present_entry_is_not_decoded_again() {
        let (_d, v) = unlocked();
        apply(&v, &plan_of(plan_json())).unwrap();
        // A broken image on an entry that is already stored is never looked at.
        let mut p = plan_json();
        p["logEntries"][1]["attachment"]["dataBase64"] = json!("%%%");
        let sum = apply(&v, &plan_of(p)).unwrap();
        assert_eq!(sum.log_entries, Counts { added: 0, present: 4, merged: 0 });
    }

    #[test]
    fn a_host_stored_under_another_engagement_is_rejected_with_its_name() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        c.execute_batch(
            "INSERT INTO engagements (id,name,kind,created_at,updated_at) VALUES ('X','other','lab',1,1);
             INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h1','X','dc01','10.9.9.9',1,1);",
        )
        .unwrap();
        let before = row_counts(c);
        let r = apply(&v, &plan_of(plan_json()));
        match &r {
            Err(AppError::Validation { message, .. }) => assert!(
                message.contains("dc01 was already imported into another engagement; import it from there or delete it first"),
                "{message}"
            ),
            other => panic!("{other:?}"),
        }
        assert_eq!(row_counts(c), before);
    }

    #[test]
    fn a_service_never_attaches_to_a_host_outside_the_import() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        c.execute_batch(
            "INSERT INTO engagements (id,name,kind,created_at,updated_at) VALUES ('X','other','lab',1,1);
             INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('hx','X','x','10.9.9.9',1,1);",
        )
        .unwrap();
        let mut p = plan_json();
        p["services"][1]["hostId"] = json!("hx");
        let r = apply(&v, &plan_of(p));
        assert!(matches!(r, Err(AppError::Validation { .. })), "{r:?}");
        assert_eq!(n(c, "SELECT count(*) FROM services"), 0);
    }

    #[test]
    fn a_merged_hosts_note_goes_to_the_log_when_the_user_already_has_one() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        c.execute_batch(
            "INSERT INTO engagements (id,name,kind,created_at,updated_at) VALUES ('E1','mine','lab',7,7);
             INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('mine','E1','by hand','10.0.0.5',7,7);
             INSERT INTO notes (owner_id,engagement_id,host_id,body,updated_at) VALUES ('mine','E1','mine','my note',7);",
        )
        .unwrap();
        let sum = apply(&v, &plan_of(plan_json()));
        let sum = sum.unwrap();
        assert_eq!(sum.notes, Counts { added: 1, present: 0, merged: 1 });
        assert_eq!(s(c, "SELECT body FROM notes WHERE owner_id='mine'").as_deref(), Some("my note"));
        assert_eq!(s(c, "SELECT title FROM log_entries WHERE id='h1:imported-notes'").as_deref(), Some("Imported notes (dc01)"));
        let content: LogContent =
            serde_json::from_str(&s(c, "SELECT content FROM log_entries WHERE id='h1:imported-notes'").unwrap()).unwrap();
        assert_eq!(content, LogContent::Note { text: "dc notes".into() });
        assert_eq!(s(c, "SELECT host_id FROM log_entry_hosts WHERE entry_id='h1:imported-notes'").as_deref(), Some("mine"));
        // A re-import finds the entry and reports the note as present.
        let again = apply(&v, &plan_of(plan_json())).unwrap();
        assert_eq!(again.notes, Counts { added: 0, present: 2, merged: 0 });
        assert_eq!(n(c, "SELECT count(*) FROM log_entries WHERE id='h1:imported-notes'"), 1);
    }

    #[test]
    fn import_adds_everything_and_counts() {
        let (_d, v) = unlocked();
        let sum = apply(&v, &plan_of(plan_json())).unwrap();
        assert_eq!(sum, all_added());
        let c = v.conn().unwrap();
        assert_eq!(row_counts(c), vec![1, 2, 2, 4, 4, 2, 2, 2, 1, 2, 1, 1, 1, 2, 2, 1, 1, 2]);
        // Engagement: active, msf lock set once its host exists, last activity from the newest entry.
        assert_eq!(s(c, "SELECT msf_host_id FROM engagements WHERE id='E1'").as_deref(), Some("h1"));
        assert_eq!(s(c, "SELECT status FROM engagements WHERE id='E1'").as_deref(), Some("active"));
        assert_eq!(n(c, "SELECT last_activity_at FROM engagements WHERE id='E1'"), 400);
        assert_eq!(s(c, "SELECT scope_cidrs FROM engagements WHERE id='E1'").as_deref(), Some(r#"["10.0.0.0/24"]"#));
        // Host fields carried over.
        assert_eq!(n(c, "SELECT board_manual FROM hosts WHERE id='h1'"), 1);
        assert_eq!(n(c, "SELECT ad_set FROM hosts WHERE id='h2'"), 0);
        assert_eq!(n(c, "SELECT access_reviewed_at FROM hosts WHERE id='h2'"), 5);
        // Attachments: rows exist and the content points at them.
        for entry in ["l2", "l3"] {
            let content = s(c, &format!("SELECT content FROM log_entries WHERE id='{entry}'")).unwrap();
            let content: LogContent = serde_json::from_str(&content).unwrap();
            let att = match content {
                LogContent::Screenshot { attachment_id, .. } => attachment_id,
                LogContent::Flag { attachment_id, .. } => attachment_id.unwrap(),
                other => panic!("unexpected {other:?}"),
            };
            assert_eq!(
                s(c, &format!("SELECT entry_id FROM attachments WHERE id='{att}'")).as_deref(),
                Some(entry)
            );
            let a = crate::log::attachment_get(c, &att).unwrap();
            assert_eq!((a.mime.as_str(), a.data_base64.as_str()), ("image/png", PNG));
        }
        // Finding steps keep their order.
        assert_eq!(n(c, "SELECT position FROM finding_steps WHERE finding_id='f1' AND entry_id='l3'"), 1);
        assert_eq!(s(c, "SELECT cracked_from FROM credentials WHERE id='c2'").as_deref(), Some("c1"));
        assert_eq!(s(c, "SELECT evidence FROM checklist_items WHERE owner_id='h1'").unwrap(), r#"[{"entryId":"l1","commandId":null}]"#);
        // The summary serialises with camelCase keys.
        let j = serde_json::to_value(&sum).unwrap();
        assert_eq!(j["logEntries"], json!({ "added": 4, "present": 0, "merged": 0 }));
        assert_eq!(j["credAttempts"], json!({ "added": 2, "present": 0, "merged": 0 }));
    }

    #[test]
    fn reimport_is_add_only_and_reports_present() {
        let (_d, v) = unlocked();
        apply(&v, &plan_of(plan_json())).unwrap();
        let c = v.conn().unwrap();
        // The user edits imported records afterwards.
        c.execute_batch(
            "UPDATE hosts SET name='renamed', access='none' WHERE id='h1';
             UPDATE notes SET body='edited' WHERE owner_id='h1';
             UPDATE checklist_items SET status='na' WHERE owner_id='h1' AND goal_id='g-host';
             UPDATE engagements SET msf_host_id='h2', name='Mine' WHERE id='E1';
             UPDATE cred_attempts SET result='valid' WHERE id='a1';
             DELETE FROM log_entry_hosts WHERE entry_id='l1' AND host_id='h2';
             DELETE FROM finding_steps WHERE finding_id='f1' AND entry_id='l3';",
        )
        .unwrap();
        let before = row_counts(c);
        let sum = apply(&v, &plan_of(plan_json())).unwrap();
        assert_eq!(sum, all_present());
        assert_eq!(row_counts(c), before, "re-import adds nothing");
        assert_eq!(s(c, "SELECT name FROM hosts WHERE id='h1'").as_deref(), Some("renamed"));
        assert_eq!(s(c, "SELECT access FROM hosts WHERE id='h1'").as_deref(), Some("none"));
        assert_eq!(s(c, "SELECT body FROM notes WHERE owner_id='h1'").as_deref(), Some("edited"));
        assert_eq!(s(c, "SELECT status FROM checklist_items WHERE owner_id='h1'").as_deref(), Some("na"));
        assert_eq!(s(c, "SELECT msf_host_id FROM engagements WHERE id='E1'").as_deref(), Some("h2"));
        assert_eq!(s(c, "SELECT name FROM engagements WHERE id='E1'").as_deref(), Some("Mine"));
        assert_eq!(s(c, "SELECT result FROM cred_attempts WHERE id='a1'").as_deref(), Some("valid"));
        // Child rows of a present record are not re-added.
        assert_eq!(n(c, "SELECT count(*) FROM log_entry_hosts WHERE entry_id='l1'"), 1);
        assert_eq!(n(c, "SELECT count(*) FROM finding_steps WHERE finding_id='f1'"), 1);
    }

    #[test]
    fn reimport_remaps_unique_key_collisions_to_existing_rows() {
        let (_d, v) = unlocked();
        apply(&v, &plan_of(plan_json())).unwrap();
        let c = v.conn().unwrap();
        let mut p = plan_json();
        // A second backup where the same principal, host and port carry different ids.
        p["hosts"] = json!([{ "id": "h9", "engagementId": "E1", "name": "dc-again", "ip": "10.0.0.5", "os": null,
            "access": "none", "dualHomed": false, "adSet": null, "boardColumn": "information-gathering", "boardManual": false,
            "accessReviewedAt": null }]);
        p["services"] = json!([{ "id": "h9:tcp/445", "hostId": "h9", "port": 445, "protocol": "tcp", "state": "open",
            "nmapService": null, "nmapVersion": null }]);
        p["logEntries"] = json!([]);
        p["notes"] = json!([{ "ownerId": "h9", "engagementId": "E1", "hostId": "h9", "body": "other", "private": false }]);
        p["checklist"] = json!([]);
        p["hops"] = json!([]);
        p["tunnels"] = json!([]);
        p["findings"] = json!([{ "id": "f9", "engagementId": "E1", "title": "t", "severity": null, "cvssVector": null,
            "cvssScore": null, "status": "draft", "description": "", "impact": "", "remediation": "", "exploitNotes": "",
            "lessons": "", "refs": [], "hostIds": ["h9"], "serviceIds": ["h9:tcp/445"], "stepEntryIds": [],
            "createdAt": 1, "updatedAt": 1 }]);
        p["credentials"] = json!([]);
        p["usernames"] = json!([{ "id": "u9", "engagementId": "E1", "username": "BOB", "domain": "CORP",
            "sourceHostId": "h9", "source": null, "createdAt": 9 }]);
        p["accessGrants"] = json!([{ "id": "g9", "engagementId": "E1", "usernameId": "u9", "hostId": "h9",
            "level": "user", "via": "ssh", "logEntryId": null, "at": 9 }]);
        p["credAttempts"] = json!([
            // Same key as a2 (c2, u1, h2, ssh, domain) under another id: present.
            { "id": "a9", "engagementId": "E1", "credId": "c2", "usernameId": "u9", "hostId": "h2", "service": "ssh",
              "port": null, "result": "admin", "authMode": "domain", "detail": null, "logEntryId": null, "at": 999 },
            { "id": "a10", "engagementId": "E1", "credId": "c2", "usernameId": "u9", "hostId": "h9", "service": "winrm",
              "port": null, "result": "valid", "authMode": "domain", "detail": null, "logEntryId": null, "at": 9 }
        ]);
        let sum = apply(&v, &plan_of(p)).unwrap();
        assert_eq!(sum.engagements, Counts { added: 0, present: 1, merged: 0 });
        assert_eq!(sum.hosts, Counts { added: 0, present: 0, merged: 1 });
        assert_eq!(sum.services, Counts { added: 0, present: 1, merged: 0 });
        // h1 already has a note: h9's imported note goes to the log on h1 (never into the user's note).
        assert_eq!(sum.notes, Counts { added: 0, present: 0, merged: 1 });
        assert_eq!(s(c, "SELECT host_id FROM log_entry_hosts WHERE entry_id='h9:imported-notes'").as_deref(), Some("h1"));
        assert_eq!(sum.usernames, Counts { added: 0, present: 1, merged: 0 });
        assert_eq!(sum.findings, Counts { added: 1, present: 0, merged: 0 });
        assert_eq!(sum.access_grants, Counts { added: 1, present: 0, merged: 0 });
        assert_eq!(sum.cred_attempts, Counts { added: 1, present: 1, merged: 0 });
        assert_eq!(n(c, "SELECT count(*) FROM hosts WHERE id='h9'"), 0);
        assert_eq!(n(c, "SELECT count(*) FROM usernames WHERE id='u9'"), 0);
        assert_eq!(s(c, "SELECT host_id FROM finding_hosts WHERE finding_id='f9'").as_deref(), Some("h1"));
        assert_eq!(s(c, "SELECT service_id FROM finding_services WHERE finding_id='f9'").as_deref(), Some("h1:tcp/445"));
        assert_eq!(s(c, "SELECT username_id FROM access_grants WHERE id='g9'").as_deref(), Some("u1"));
        assert_eq!(s(c, "SELECT host_id FROM access_grants WHERE id='g9'").as_deref(), Some("h1"));
        assert_eq!(s(c, "SELECT username_id FROM cred_attempts WHERE id='a10'").as_deref(), Some("u1"));
        // The colliding attempt left the stored one alone.
        assert_eq!(s(c, "SELECT result FROM cred_attempts WHERE id='a2'").as_deref(), Some("failed"));
        assert_eq!(n(c, "SELECT count(*) FROM cred_attempts WHERE id='a9'"), 0);
        assert_eq!(s(c, "SELECT body FROM notes WHERE owner_id='h1'").as_deref(), Some("dc notes"));
    }

    #[test]
    fn import_takes_a_backup_first() {
        let (_d, v) = unlocked();
        assert!(backup::list(v.paths()).unwrap().is_empty());
        apply(&v, &plan_of(plan_json())).unwrap();
        let list = backup::list(v.paths()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].reason, "pre-import");
        // The backup holds the state from before the import.
        let path = v.paths().backups.join(&list[0].file);
        let b = crate::vault::open_keyed(&path, &v.key_pragma().unwrap(), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
        assert_eq!(n(&b, "SELECT count(*) FROM engagements"), 0);
    }

    #[test]
    fn a_failed_backup_aborts_before_any_change() {
        let (_d, v) = unlocked();
        // A file where the backups directory should be makes the backup fail.
        std::fs::write(&v.paths().backups, b"not a dir").unwrap();
        let r = apply(&v, &plan_of(plan_json()));
        assert!(matches!(r, Err(AppError::Io(_))), "{r:?}");
        assert_eq!(row_counts(v.conn().unwrap()).iter().sum::<i64>(), 0);
    }

    #[test]
    fn import_requires_an_unlocked_vault() {
        let (_d, mut v) = unlocked();
        v.lock();
        assert_eq!(apply(&v, &plan_of(plan_json())), Err(AppError::Locked));
        assert!(backup::list(v.paths()).unwrap().is_empty());
    }

    #[test]
    fn a_dangling_reference_rolls_back_everything() {
        // Each case breaks one reference; the dangling record sits late in the insert order, so many rows
        // were already written inside the transaction.
        let cases: Vec<(&str, Breaker)> = vec![
            ("entry host", Box::new(|p| p["logEntries"][0]["hostIds"] = json!(["h1", "ghost"]))),
            ("service host", Box::new(|p| p["services"][0]["hostId"] = json!("ghost"))),
            ("evidence entry", Box::new(|p| p["checklist"][0]["evidence"] = json!([{ "entryId": "ghost" }]))),
            ("note host", Box::new(|p| { p["notes"][0]["ownerId"] = json!("ghost"); p["notes"][0]["hostId"] = json!("ghost"); })),
            ("hop entry", Box::new(|p| p["hops"][0]["logEntryId"] = json!("ghost"))),
            ("tunnel host", Box::new(|p| p["tunnels"][0]["viaHostId"] = json!("ghost"))),
            ("finding step", Box::new(|p| p["findings"][0]["stepEntryIds"] = json!(["l1", "ghost"]))),
            ("finding service", Box::new(|p| p["findings"][0]["serviceIds"] = json!(["ghost"]))),
            ("cracked from", Box::new(|p| p["credentials"][1]["crackedFrom"] = json!("ghost"))),
            ("grant username", Box::new(|p| p["accessGrants"][0]["usernameId"] = json!("ghost"))),
            ("grant entry", Box::new(|p| p["accessGrants"][0]["logEntryId"] = json!("ghost"))),
            ("attempt cred", Box::new(|p| p["credAttempts"][1]["credId"] = json!("ghost"))),
            ("attempt username", Box::new(|p| p["credAttempts"][1]["usernameId"] = json!("ghost"))),
            ("attempt host", Box::new(|p| p["credAttempts"][1]["hostId"] = json!("ghost"))),
            ("msf host", Box::new(|p| p["engagements"][0]["msfHostId"] = json!("ghost"))),
            ("host engagement", Box::new(|p| p["hosts"][1]["engagementId"] = json!("ghost"))),
        ];
        for (name, break_it) in cases {
            let (_d, v) = unlocked();
            let mut p = plan_json();
            break_it(&mut p);
            let r = apply(&v, &plan_of(p));
            assert!(matches!(r, Err(AppError::Validation { .. })), "{name}: {r:?}");
            assert_eq!(row_counts(v.conn().unwrap()).iter().sum::<i64>(), 0, "{name}: nothing written");
        }
    }

    #[test]
    fn a_reference_to_another_engagement_is_rejected() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        c.execute_batch(
            "INSERT INTO engagements (id,name,kind,created_at,updated_at) VALUES ('X','other','lab',1,1);
             INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('hx','X','x','10.9.9.9',1,1);",
        )
        .unwrap();
        let mut p = plan_json();
        p["credAttempts"][0]["hostId"] = json!("hx");
        let r = apply(&v, &plan_of(p));
        assert!(matches!(r, Err(AppError::Validation { .. })), "{r:?}");
        assert_eq!(n(c, "SELECT count(*) FROM engagements"), 1);
    }

    #[test]
    fn a_reference_to_an_existing_row_is_accepted() {
        let (_d, v) = unlocked();
        apply(&v, &plan_of(plan_json())).unwrap();
        let c = v.conn().unwrap();
        // A later plan that only adds an attempt against rows already stored.
        let mut p = plan_json();
        for k in ["hosts", "services", "logEntries", "notes", "checklist", "hops", "tunnels", "findings", "credentials", "usernames", "accessGrants"] {
            p[k] = json!([]);
        }
        p["credAttempts"] = json!([{ "id": "a3", "engagementId": "E1", "credId": "c1", "usernameId": "u1", "hostId": "h1",
            "service": "winrm", "port": null, "result": "valid", "authMode": "domain", "detail": null, "logEntryId": "l4", "at": 5 }]);
        let sum = apply(&v, &plan_of(p)).unwrap();
        assert_eq!(sum.cred_attempts, Counts { added: 1, present: 0, merged: 0 });
        assert_eq!(n(c, "SELECT count(*) FROM cred_attempts"), 3);
    }

    #[test]
    fn import_respects_existing_rows() {
        let (_d, v) = unlocked();
        let c = v.conn().unwrap();
        // The engagement and host already exist (same ids), edited by the user, with no msf lock.
        c.execute_batch(
            "INSERT INTO engagements (id,name,kind,status,created_at,updated_at) VALUES ('E1','Kept','client','archived',7,7);
             INSERT INTO hosts (id,engagement_id,name,ip,os,access,created_at,updated_at) VALUES ('h1','E1','mine','10.0.0.99','linux','user',7,7);
             INSERT INTO notes (owner_id,engagement_id,host_id,body,updated_at) VALUES ('h1','E1','h1','my note',7);
             INSERT INTO checklist_items (owner_id,engagement_id,goal_id,status,updated_at) VALUES ('h1','E1','g-host','in_progress',7);",
        )
        .unwrap();
        let sum = apply(&v, &plan_of(plan_json())).unwrap();
        assert_eq!(sum.engagements, Counts { added: 0, present: 1, merged: 0 });
        assert_eq!(sum.hosts, Counts { added: 1, present: 1, merged: 0 });
        assert_eq!(sum.notes, Counts { added: 1, present: 1, merged: 0 });
        assert_eq!(sum.checklist, Counts { added: 1, present: 1, merged: 0 });
        let host: (String, Option<String>, Option<String>, String, i64) = c
            .query_row("SELECT name, ip, os, access, updated_at FROM hosts WHERE id='h1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .unwrap();
        assert_eq!(host, ("mine".into(), Some("10.0.0.99".into()), Some("linux".into()), "user".into(), 7));
        let eng: (String, String, String, Option<String>, i64) = c
            .query_row("SELECT name, kind, status, msf_host_id, updated_at FROM engagements WHERE id='E1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .unwrap();
        assert_eq!(eng, ("Kept".into(), "client".into(), "archived".into(), None, 7), "no msf lock on a present engagement");
        assert_eq!(s(c, "SELECT body FROM notes WHERE owner_id='h1'").as_deref(), Some("my note"));
        assert_eq!(s(c, "SELECT status FROM checklist_items WHERE owner_id='h1' AND goal_id='g-host'").as_deref(), Some("in_progress"));
        // New rows still hang off the existing host.
        assert_eq!(n(c, "SELECT count(*) FROM services WHERE host_id='h1'"), 1);
    }

    #[test]
    fn attachment_rules_follow_the_log() {
        let cases: Vec<(&str, Breaker)> = vec![
            ("bad base64", Box::new(|p| p["logEntries"][1]["attachment"]["dataBase64"] = json!("%%%"))),
            ("bad mime", Box::new(|p| p["logEntries"][1]["attachment"]["mime"] = json!("text/html"))),
            ("screenshot without image", Box::new(|p| p["logEntries"][1]["attachment"] = Value::Null)),
            ("image on a note", Box::new(|p| p["logEntries"][3]["attachment"] = json!({ "mime": "image/png", "dataBase64": PNG }))),
            ("kind mismatch", Box::new(|p| p["logEntries"][3]["kind"] = json!("command"))),
        ];
        for (name, break_it) in cases {
            let (_d, v) = unlocked();
            let mut p = plan_json();
            break_it(&mut p);
            let r = apply(&v, &plan_of(p));
            assert!(matches!(r, Err(AppError::Validation { .. })), "{name}: {r:?}");
            assert_eq!(row_counts(v.conn().unwrap()).iter().sum::<i64>(), 0, "{name}");
        }
    }

    #[test]
    fn a_flag_without_an_upload_has_no_attachment_id() {
        let (_d, v) = unlocked();
        let mut p = plan_json();
        p["logEntries"][2]["attachment"] = Value::Null;
        p["logEntries"][2]["content"]["attachmentId"] = json!("someone-elses-image");
        apply(&v, &plan_of(p)).unwrap();
        let c = v.conn().unwrap();
        let content: LogContent = serde_json::from_str(&s(c, "SELECT content FROM log_entries WHERE id='l3'").unwrap()).unwrap();
        assert!(matches!(content, LogContent::Flag { attachment_id: None, .. }), "{content:?}");
        assert_eq!(n(c, "SELECT count(*) FROM attachments"), 1);
    }
}
