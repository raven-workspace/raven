//! Filing an extraction: what one saved log entry's output proved (the proofs, which the frontend reads from the
//! output) becomes hosts, services, an identity, credentials, usernames, attempts, tried pairs and privesc vectors.
//! Every write and the extraction record happen in one transaction, and the record is built here from what the writes
//! did, next to `undo`, which reverses it.

use super::{get, Extraction, ExtractionRecord, ExtractionSummary, HostOsBefore, IdentityBefore, OutputTick, Promotion};
use crate::attempts::{self, CredAttempt, CredAttemptInput};
use crate::credentials::{self, engagement_domain, same_domain, Credential, CredentialInput, UsernameInput};
use crate::db::{blank_to_none, check_in_engagement, now_ms};
use crate::error::{AppError, AppResult};
use crate::host_facts::{self, clean_list, HostIdentity, PrivescVector, VectorInput};
use crate::hosts::{self, HostInput};
use crate::services::{self, ScanPort};
use crate::tried_pairs::{self, TriedPair, TriedPairInput};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// What one saved entry's output proved, as the frontend read it. A host id anywhere in it may be the `key` of one of
/// `new_hosts`: filing puts that host's id in its place. Attempts and tried pairs take the entry as their proof and
/// its time.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExtractionProofs {
    /// Hosts the save made before the entry, for a scan of an IP that wasn't one yet.
    pub created_host_ids: Vec<String>,
    /// IPs the output proved are hosts. One the engagement has already is used as it is.
    pub new_hosts: Vec<NewHost>,
    /// nmap results: the open ports, and the OS for a host that has none.
    pub scans: Vec<ScanProof>,
    /// Who the user is on a host, merged with what was stored.
    pub identity: Option<IdentityProof>,
    /// Dumped and pasted credentials.
    pub credentials: Vec<CredentialInput>,
    pub cracks: Vec<CrackProof>,
    pub usernames: Vec<UsernameInput>,
    /// nxc results and roast hashes.
    pub intake: Option<IntakeProof>,
    /// Failed pairs whose secret is no credential.
    pub tried_pairs: Vec<TriedPairInput>,
    pub vectors: Vec<VectorProof>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NewHost {
    pub key: String,
    pub ip: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProof {
    pub host_id: String,
    pub ports: Vec<ScanPort>,
    #[serde(default)]
    pub os: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityProof {
    pub host_id: String,
    pub username: String,
    #[serde(default)]
    pub privileges: Vec<String>,
    #[serde(default)]
    pub groups: Vec<String>,
}

/// A cracked secret and the hashes it cracks: stored ones by id, and ones in this proof's `credentials` by index.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CrackProof {
    pub plaintext: String,
    pub credential_ids: Vec<String>,
    pub proof_credentials: Vec<usize>,
}

/// A credential intake plan (the frontend's `CredentialIntakePlan`), with the operator's choice on each pending
/// credential.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IntakeProof {
    pub usernames: Vec<PlannedUsername>,
    pub attempts: Vec<PlannedAttempt>,
    pub credentials: Vec<PendingCredential>,
    pub hashes: Vec<CredentialInput>,
    pub links: Vec<Link>,
    /// Stored rows the output proved again without adding them.
    pub reproved_credential_ids: Vec<String>,
    pub reproved_username_ids: Vec<String>,
}

/// A username to add; attempts name it by `key` until it is stored.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedUsername {
    pub key: String,
    pub input: UsernameInput,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedAttempt {
    /// Empty on a pending credential's own attempts: they go on that credential.
    #[serde(default)]
    pub cred_id: String,
    #[serde(default)]
    pub username_id: Option<String>,
    #[serde(default)]
    pub username_key: Option<String>,
    pub host_id: String,
    pub service: String,
    #[serde(default)]
    pub port: Option<i64>,
    pub result: String,
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingCredential {
    pub input: CredentialInput,
    pub accepted: bool,
    #[serde(default)]
    pub attempts: Vec<PlannedAttempt>,
    /// A username-list spray hit: that username's results with these secrets move onto the credential.
    #[serde(default)]
    pub from_username: Option<FromUsername>,
    /// What is recorded instead when the credential is not accepted.
    #[serde(default)]
    pub if_declined: Vec<PlannedAttempt>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FromUsername {
    pub username_id: Option<String>,
    pub username_key: Option<String>,
    pub secret_cred_ids: Vec<String>,
    pub host_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub cred_id: String,
    pub from_secret_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorProof {
    pub host_id: String,
    pub title: String,
}

/// What filing did, for the summary the frontend words.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Filed {
    /// The stored extraction. Its summary is empty until `finish`.
    pub extraction: Extraction,
    /// Each new host's id, by its key.
    pub host_ids: HashMap<String, String>,
    pub scans: Vec<ScanFiled>,
    pub identity_changed: bool,
    /// The attempts the save added or whose result it changed, as they are now. Failures kept from promoted tried
    /// pairs are not among them.
    pub attempts: Vec<CredAttempt>,
    /// Every credential the save created or changed, or that one of `attempts` is on, as it is now.
    pub credentials: Vec<Credential>,
    /// Tried pairs the save added, promoted ones included.
    pub tried_pairs_added: usize,
    pub cracked: Vec<Cracked>,
    /// The vectors the save created, in order.
    pub vectors: Vec<PrivescVector>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFiled {
    pub host_id: String,
    /// Services added or changed.
    pub services: usize,
    pub os_set: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cracked {
    pub hash_id: String,
    pub plaintext: String,
}

/// Files the proofs of log entry `log_entry_id` and stores its extraction, all in one transaction: a failure part-way
/// writes nothing. An entry is extracted once: a second filing is a `Conflict` and writes nothing.
pub fn file(conn: &Connection, engagement_id: &str, log_entry_id: &str, proofs: &ExtractionProofs) -> AppResult<Filed> {
    check_in_engagement(conn, "log_entries", engagement_id, log_entry_id)?;
    let tx = conn.unchecked_transaction()?;
    if get(&tx, log_entry_id)?.is_some() {
        return Err(AppError::Conflict("this entry's extraction is already recorded".into()));
    }
    let at: i64 = tx.query_row("SELECT at FROM log_entries WHERE id = ?1", [log_entry_id], |r| r.get(0))?;
    let mut f = Filing::start(&tx, engagement_id, log_entry_id, at)?;
    f.hosts(proofs)?;
    f.scans(&proofs.scans)?;
    if let Some(i) = &proofs.identity {
        f.identity(i)?;
    }
    let proof_ids = f.credentials(&proofs.credentials)?;
    f.cracks(&proofs.cracks, &proof_ids)?;
    f.usernames(&proofs.usernames)?;
    if let Some(plan) = &proofs.intake {
        f.intake(plan)?;
    }
    f.tried_pairs(&proofs.tried_pairs)?;
    f.vectors(&proofs.vectors)?;
    let filed = f.finish()?;
    tx.commit()?;
    Ok(filed)
}

/// Completes a filed extraction after the save's follow-ups (checklist ticks, board) ran: its summary and the output
/// ticks, stamped now, so Undo counts those follow-ups as part of the save. An undone extraction is a `Conflict`.
pub fn finish(conn: &Connection, log_entry_id: &str, summary: &ExtractionSummary, output_ticks: &[OutputTick]) -> AppResult<Extraction> {
    let ext = get(conn, log_entry_id)?.ok_or(AppError::NotFound)?;
    if ext.undone_at.is_some() {
        return Err(AppError::Conflict("this entry's extraction was undone".into()));
    }
    let record = ExtractionRecord { output_ticks: output_ticks.to_vec(), ..ext.record };
    conn.execute(
        "UPDATE extractions SET summary = ?2, record = ?3, created_at = max(created_at, ?4) WHERE log_entry_id = ?1",
        params![log_entry_id, serde_json::to_string(summary)?, serde_json::to_string(&record)?, now_ms()],
    )?;
    get(conn, log_entry_id)?.ok_or(AppError::NotFound)
}

/// The engagement's rows as they were when the filing began.
struct Before {
    credentials: Vec<Credential>,
    usernames: HashSet<String>,
    attempts: Vec<CredAttempt>,
    tried_pairs: Vec<TriedPair>,
}

struct Filing<'c> {
    conn: &'c Connection,
    engagement_id: &'c str,
    entry_id: &'c str,
    at: i64,
    anchor: Option<String>,
    before: Before,
    host_ids: HashMap<String, String>,
    record: ExtractionRecord,
    scans: Vec<ScanFiled>,
    identity_changed: bool,
    cracked: Vec<Cracked>,
    vectors: Vec<PrivescVector>,
}

impl<'c> Filing<'c> {
    fn start(conn: &'c Connection, engagement_id: &'c str, entry_id: &'c str, at: i64) -> AppResult<Self> {
        let before = Before {
            credentials: credentials::list(conn, engagement_id)?,
            usernames: credentials::usernames_list(conn, engagement_id)?.into_iter().map(|u| u.id).collect(),
            attempts: attempts::list(conn, engagement_id)?,
            tried_pairs: tried_pairs::list(conn, engagement_id)?,
        };
        Ok(Filing {
            conn,
            engagement_id,
            entry_id,
            at,
            anchor: engagement_domain(conn, engagement_id)?,
            before,
            host_ids: HashMap::new(),
            record: ExtractionRecord::default(),
            scans: Vec::new(),
            identity_changed: false,
            cracked: Vec::new(),
            vectors: Vec::new(),
        })
    }

    /// The host id a proof names: a new host's key becomes its id.
    fn host(&self, id: &str) -> String {
        self.host_ids.get(id).cloned().unwrap_or_else(|| id.to_string())
    }

    fn host_opt(&self, id: &Option<String>) -> Option<String> {
        id.as_deref().map(|h| self.host(h))
    }

    /// A stored credential the output proved again (another entry's Undo keeps it). Rows this save made don't count.
    fn reprove_credential(&mut self, id: &str) {
        let ids = &mut self.record.reproved_credential_ids;
        if self.before.credentials.iter().any(|c| c.id == id) && !ids.iter().any(|x| x == id) {
            ids.push(id.to_string());
        }
    }

    fn reprove_username(&mut self, id: &str) {
        let ids = &mut self.record.reproved_username_ids;
        if self.before.usernames.contains(id) && !ids.iter().any(|x| x == id) {
            ids.push(id.to_string());
        }
    }

    fn hosts(&mut self, p: &ExtractionProofs) -> AppResult<()> {
        for id in &p.created_host_ids {
            check_in_engagement(self.conn, "hosts", self.engagement_id, id)?;
            push_new(&mut self.record.created_host_ids, id);
        }
        for h in &p.new_hosts {
            let found: Option<String> = self
                .conn
                .query_row("SELECT id FROM hosts WHERE engagement_id = ?1 AND ip = ?2", params![self.engagement_id, h.ip], |r| r.get(0))
                .optional()?;
            let id = match found {
                Some(id) => id,
                None => {
                    let input = HostInput { name: h.ip.clone(), ip: Some(h.ip.clone()), os: None, access: None, dual_homed: None, ad_set: None };
                    let id = hosts::create(self.conn, self.engagement_id, input)?.id;
                    push_new(&mut self.record.created_host_ids, &id);
                    id
                }
            };
            self.host_ids.insert(h.key.clone(), id);
        }
        Ok(())
    }

    /// Upserts each scan's ports as services, and fills the OS of a host that has none.
    fn scans(&mut self, scans: &[ScanProof]) -> AppResult<()> {
        for s in scans {
            let host_id = self.host(&s.host_id);
            let was = services::list(self.conn, &host_id)?;
            let mut changed = 0;
            for now in services::upsert_scan(self.conn, &host_id, &s.ports)? {
                match was.iter().find(|w| w.id == now.id) {
                    None => self.record.created_service_ids.push(now.id.clone()),
                    Some(old) if *old != now => self.record.services_before.push(old.clone()),
                    Some(_) => continue,
                }
                changed += 1;
            }
            let mut os_set = false;
            if let Some(os) = s.os.as_deref().map(str::trim).filter(|o| !o.is_empty()) {
                let h = hosts::get(self.conn, &host_id)?;
                if h.os.as_deref().is_none_or(|o| o.trim().is_empty()) {
                    let input = HostInput { name: h.name, ip: h.ip, os: Some(os.to_string()), access: Some(h.access), dual_homed: None, ad_set: None };
                    hosts::update(self.conn, &host_id, input)?;
                    self.record.host_os_before.push(HostOsBefore { host_id: host_id.clone(), os: h.os });
                    os_set = true;
                }
            }
            self.scans.push(ScanFiled { host_id, services: changed, os_set });
        }
        Ok(())
    }

    /// Stores the identity when it differs from the stored one.
    fn identity(&mut self, i: &IdentityProof) -> AppResult<()> {
        let host_id = self.host(&i.host_id);
        let before = host_facts::identity_get(self.conn, &host_id)?;
        let (username, privileges, groups) = (i.username.trim().to_string(), clean_list(&i.privileges), clean_list(&i.groups));
        if before.as_ref().is_some_and(|b| b.username == username && b.privileges == privileges && b.groups == groups) {
            return Ok(());
        }
        let input = HostIdentity { host_id: host_id.clone(), username, privileges, groups, entry_id: Some(self.entry_id.to_string()), updated_at: 0 };
        host_facts::identity_set(self.conn, input)?;
        self.record.identity_before.push(IdentityBefore { host_id, identity: before });
        self.identity_changed = true;
        Ok(())
    }

    /// Dumped and pasted credentials. Returns the stored id of each, in order. A dumped local account that is password
    /// reuse (`create_credential`) is a result of the stored credential on the dumped host instead.
    fn credentials(&mut self, inputs: &[CredentialInput]) -> AppResult<Vec<String>> {
        let mut ids = Vec::with_capacity(inputs.len());
        for input in inputs {
            let (created, reused_on) = self.create_credential(input)?;
            if created.existed {
                self.reprove_credential(&created.credential.id);
            }
            if let Some(host_id) = reused_on {
                let found = CredAttemptInput {
                    cred_id: created.credential.id.clone(),
                    username_id: None,
                    host_id,
                    service: "other".into(),
                    port: None,
                    result: "valid".into(),
                    auth_mode: Some("local".into()),
                    detail: Some("password reuse".into()),
                    log_entry_id: Some(self.entry_id.to_string()),
                    at: Some(self.at),
                };
                attempts::upsert(self.conn, self.engagement_id, &[found])?;
            }
            ids.push(created.credential.id);
        }
        Ok(ids)
    }

    /// Creates a credential, or returns the stored one that is the same credential. A local account whose name and
    /// secret are stored as a local credential for another host is password reuse: that stored credential is returned,
    /// with the host this one was found on, and nothing is written.
    fn create_credential(&self, input: &CredentialInput) -> AppResult<(credentials::CreatedCredential, Option<String>)> {
        let mut input = input.clone();
        input.local_host_id = self.host_opt(&input.local_host_id);
        input.source_host_id = self.host_opt(&input.source_host_id);
        if let Some(stored) = credentials::find_reused_local(self.conn, self.engagement_id, &input)? {
            return Ok((credentials::CreatedCredential { credential: stored, existed: true }, input.local_host_id));
        }
        Ok((credentials::create(self.conn, self.engagement_id, input)?, None))
    }

    /// The scope capture output gives a username, unless the proof sets one: `.\name` is a local account on the host the
    /// output ran on, `HOST\name` (HOST one host's short name) a local account on that host, and a name in the
    /// engagement's own domain, in either spelling, a domain account. Anything else is unknown. Host keys become ids.
    fn scoped(&self, input: &UsernameInput) -> AppResult<UsernameInput> {
        let mut u = input.clone();
        u.source_host_id = self.host_opt(&u.source_host_id);
        u.local_host_id = self.host_opt(&u.local_host_id);
        if blank_to_none(u.scope.as_deref()).is_some() {
            return Ok(u);
        }
        let domain = u.domain.as_deref().map(str::trim).unwrap_or("");
        let local = match domain {
            "" => None,
            "." => u.source_host_id.clone(),
            d => self.host_named(d)?,
        };
        let anchor = blank_to_none(self.anchor.as_deref());
        let scope = if let Some(host_id) = local {
            u.local_host_id = Some(host_id);
            u.domain = None;
            "local"
        } else if !domain.is_empty() && anchor.as_deref().is_some_and(|a| same_domain(Some(a), Some(domain), Some(a))) {
            "domain"
        } else {
            "unknown"
        };
        u.scope = Some(scope.into());
        Ok(u)
    }

    /// The one host whose short name (its name's first label, never an IP) is `label`, ignoring case. None when no host
    /// or several have it.
    fn host_named(&self, label: &str) -> AppResult<Option<String>> {
        let named: Vec<String> = hosts::list(self.conn, self.engagement_id)?
            .into_iter()
            .filter(|h| {
                let name = h.name.trim();
                name.parse::<std::net::Ipv4Addr>().is_err()
                    && !name.contains(':')
                    && name.split('.').next().is_some_and(|first| first.eq_ignore_ascii_case(label))
            })
            .map(|h| h.id)
            .collect();
        Ok(if named.len() == 1 { named.into_iter().next() } else { None })
    }

    /// Of an intake plan's usernames, the local accounts that are only password reuse: a result of a stored local
    /// credential for another host, with that account's name, on the username's host, and no other secret for it there
    /// and nothing that needs the username. Each is (host id, name lowercased).
    fn reuse_only(&self, plan: &IntakeProof, attempts: &[&PlannedAttempt]) -> AppResult<HashSet<(String, String)>> {
        let mut reused = HashSet::new();
        for a in attempts.iter().filter(|a| a.username_id.is_none() && a.username_key.is_none()) {
            let host_id = self.host(&a.host_id);
            if let Some(c) = self.before.credentials.iter().find(|c| c.id == a.cred_id)
                && c.scope == "local"
                && c.local_host_id.as_deref().is_some_and(|h| h != host_id)
            {
                reused.insert((host_id, c.username.trim().to_lowercase()));
            }
        }
        let mut other_secret = HashSet::new();
        for p in &plan.credentials {
            let Some(host_id) = self.host_opt(&p.input.local_host_id).filter(|_| p.input.scope.as_deref() == Some("local")) else {
                continue;
            };
            let mut input = p.input.clone();
            input.local_host_id = Some(host_id.clone());
            input.source_host_id = self.host_opt(&input.source_host_id);
            let account = (host_id, input.username.trim().to_lowercase());
            if p.accepted && credentials::find_reused_local(self.conn, self.engagement_id, &input)?.is_some() {
                reused.insert(account);
            } else {
                other_secret.insert(account);
            }
        }
        Ok(reused.difference(&other_secret).cloned().collect())
    }

    /// Cracks each named hash not cracked yet. One cracked before is proved again, with the passwords cracked from it.
    fn cracks(&mut self, cracks: &[CrackProof], proof_ids: &[String]) -> AppResult<()> {
        for k in cracks {
            let mut ids: Vec<String> = Vec::new();
            let named = k.credential_ids.iter().cloned().chain(k.proof_credentials.iter().filter_map(|i| proof_ids.get(*i).cloned()));
            for id in named {
                push_new(&mut ids, &id);
            }
            for id in ids {
                let hash = credentials::get(self.conn, &id)?;
                if hash.kind != "hash" {
                    continue;
                }
                if hash.crack_status.as_deref() == Some("cracked") {
                    self.reprove_credential(&id);
                    let passwords: Vec<String> = self
                        .conn
                        .prepare("SELECT id FROM credentials WHERE cracked_from = ?1")?
                        .query_map([&id], |r| r.get(0))?
                        .collect::<Result<_, _>>()?;
                    for pw in passwords {
                        self.reprove_credential(&pw);
                    }
                    continue;
                }
                credentials::crack(self.conn, &id, &k.plaintext)?;
                self.cracked.push(Cracked { hash_id: id, plaintext: k.plaintext.clone() });
            }
        }
        Ok(())
    }

    fn usernames(&mut self, inputs: &[UsernameInput]) -> AppResult<()> {
        for input in inputs {
            let input = self.scoped(input)?;
            let stored = credentials::username_create(self.conn, self.engagement_id, input)?;
            self.reprove_username(&stored.id);
        }
        Ok(())
    }

    /// Records a credential intake plan, in order: its usernames (less local accounts that are only password reuse), the
    /// accepted credentials (a stored one that is the same credential, or the one a local account reuses, is used, and
    /// gets the owner-less secret it came from when it has none), the plan's attempts (less failed username results
    /// already kept as a tried pair), each pending credential's results (on it when accepted, its `if_declined` ones
    /// otherwise), the roast hashes, then the links to owner-less secrets.
    fn intake(&mut self, plan: &IntakeProof) -> AppResult<()> {
        let attempts: Vec<&PlannedAttempt> = {
            let mut keep = Vec::new();
            for a in &plan.attempts {
                if !self.already_tried(a, plan)? {
                    keep.push(a);
                }
            }
            keep
        };
        let reuse_only = self.reuse_only(plan, &attempts)?;
        let needed: HashSet<&str> = plan
            .attempts
            .iter()
            .chain(plan.credentials.iter().flat_map(|p| p.attempts.iter().chain(&p.if_declined)))
            .filter_map(|a| a.username_key.as_deref())
            .chain(plan.credentials.iter().filter_map(|p| p.from_username.as_ref()?.username_key.as_deref()))
            .collect();
        let mut username_ids: HashMap<String, String> = HashMap::new();
        for u in &plan.usernames {
            let input = self.scoped(&u.input)?;
            if let Some(host_id) = input.local_host_id.clone()
                && reuse_only.contains(&(host_id, input.username.trim().to_lowercase()))
                && !needed.contains(u.key.as_str())
            {
                continue;
            }
            let stored = credentials::username_create(self.conn, self.engagement_id, input)?;
            username_ids.insert(u.key.clone(), stored.id);
        }
        let username_id = |id: &Option<String>, key: &Option<String>| -> Option<String> {
            id.clone().or_else(|| key.as_ref().and_then(|k| username_ids.get(k).cloned()))
        };

        let mut cred_ids: Vec<Option<String>> = Vec::with_capacity(plan.credentials.len());
        for p in &plan.credentials {
            cred_ids.push(if p.accepted { Some(self.accept_credential(&p.input)?) } else { None });
        }

        let upsert = |this: &Self, rows: Vec<(&PlannedAttempt, &str)>| -> AppResult<()> {
            let inputs: Vec<CredAttemptInput> = rows
                .into_iter()
                .filter_map(|(a, cred_id)| {
                    let username = username_id(&a.username_id, &a.username_key);
                    // A username that was not added: nothing to attach the result to.
                    if a.username_key.is_some() && username.is_none() {
                        return None;
                    }
                    Some(CredAttemptInput {
                        cred_id: cred_id.to_string(),
                        username_id: username,
                        host_id: this.host(&a.host_id),
                        service: a.service.clone(),
                        port: a.port,
                        result: a.result.clone(),
                        auth_mode: a.auth_mode.clone(),
                        detail: a.detail.clone(),
                        log_entry_id: Some(this.entry_id.to_string()),
                        at: Some(this.at),
                    })
                })
                .collect();
            if !inputs.is_empty() {
                attempts::upsert(this.conn, this.engagement_id, &inputs)?;
            }
            Ok(())
        };
        upsert(self, attempts.iter().map(|a| (*a, a.cred_id.as_str())).collect())?;
        for (p, cred_id) in plan.credentials.iter().zip(&cred_ids) {
            let Some(cred_id) = cred_id else {
                upsert(self, p.if_declined.iter().map(|a| (a, a.cred_id.as_str())).collect())?;
                continue;
            };
            upsert(self, p.attempts.iter().map(|a| (a, cred_id.as_str())).collect())?;
            if let Some(from) = &p.from_username
                && let Some(from_id) = username_id(&from.username_id, &from.username_key)
            {
                let host = self.host_opt(&from.host_id);
                attempts::rekey_username_attempts(self.conn, &from_id, &from.secret_cred_ids, cred_id, host.as_deref())?;
            }
        }

        for h in &plan.hashes {
            self.accept_credential(h)?;
        }
        for l in &plan.links {
            let c = credentials::get(self.conn, &l.cred_id)?;
            if c.from_secret_id.is_none() && l.from_secret_id != c.id {
                self.link_secret(&c.id, &l.from_secret_id)?;
            }
        }
        for id in &plan.reproved_credential_ids {
            self.reprove_credential(id);
        }
        for id in &plan.reproved_username_ids {
            self.reprove_username(id);
        }
        Ok(())
    }

    /// Whether a failed username attempt is a stored tried pair already: the same user, secret, host, service and
    /// auth mode, in the same domain.
    fn already_tried(&self, a: &PlannedAttempt, plan: &IntakeProof) -> AppResult<bool> {
        if !matches!(a.result.as_str(), "failed" | "errored") {
            return Ok(false);
        }
        let user: Option<(String, Option<String>)> = match (&a.username_id, &a.username_key) {
            (Some(id), _) => self
                .conn
                .query_row("SELECT username, domain FROM usernames WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?,
            (None, Some(key)) => plan.usernames.iter().find(|u| &u.key == key).map(|u| (u.input.username.clone(), u.input.domain.clone())),
            (None, None) => return Ok(false),
        };
        let Some((username, domain)) = user else { return Ok(false) };
        let Some(secret) = self.before.credentials.iter().find(|c| c.id == a.cred_id).map(|c| &c.secret) else {
            return Ok(false);
        };
        let host_id = self.host(&a.host_id);
        let auth_mode = a.auth_mode.as_deref().unwrap_or("domain");
        Ok(self.before.tried_pairs.iter().any(|t| {
            t.username.trim().to_lowercase() == username.trim().to_lowercase()
                && &t.secret == secret
                && t.host_id == host_id
                && t.service == a.service
                && t.auth_mode == auth_mode
                && same_domain(self.anchor.as_deref(), t.domain.as_deref(), domain.as_deref())
        }))
    }

    /// Adds an accepted credential, or reuses the stored one that is the same credential. Returns its id.
    fn accept_credential(&mut self, input: &CredentialInput) -> AppResult<String> {
        let (created, _) = self.create_credential(input)?;
        let c = created.credential;
        if created.existed {
            self.reprove_credential(&c.id);
            if let Some(from) = input.from_secret_id.as_deref().filter(|f| !f.trim().is_empty())
                && c.from_secret_id.is_none()
                && from != c.id
            {
                self.link_secret(&c.id, from)?;
            }
        }
        Ok(c.id)
    }

    /// Records the owner-less secret a stored credential came from.
    fn link_secret(&self, id: &str, from_secret_id: &str) -> AppResult<()> {
        check_in_engagement(self.conn, "credentials", self.engagement_id, from_secret_id)?;
        self.conn.execute(
            "UPDATE credentials SET from_secret_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, from_secret_id, now_ms()],
        )?;
        Ok(())
    }

    fn tried_pairs(&mut self, inputs: &[TriedPairInput]) -> AppResult<()> {
        let inputs: Vec<TriedPairInput> = inputs
            .iter()
            .map(|t| TriedPairInput {
                host_id: self.host(&t.host_id),
                log_entry_id: Some(self.entry_id.to_string()),
                at: Some(self.at),
                ..t.clone()
            })
            .collect();
        if !inputs.is_empty() {
            tried_pairs::upsert(self.conn, self.engagement_id, &inputs)?;
        }
        Ok(())
    }

    fn vectors(&mut self, vectors: &[VectorProof]) -> AppResult<()> {
        for v in vectors {
            let host_id = self.host(&v.host_id);
            let known: HashSet<String> = host_facts::vectors_list(self.conn, &host_id)?.into_iter().map(|x| x.id).collect();
            let input = VectorInput { title: v.title.clone(), status: "try".into(), source: "auto".into() };
            let row = host_facts::vector_upsert(self.conn, &host_id, input)?;
            if !known.contains(&row.id) && !self.record.created_vector_ids.contains(&row.id) {
                self.record.created_vector_ids.push(row.id.clone());
                self.vectors.push(row);
            }
        }
        Ok(())
    }

    /// Each credential this save created takes over its tried pairs (R24): their failures become failed attempts on
    /// it, with their own proof and time, then the pairs go. Stored pairs promoted this way are in the record.
    fn promote(&mut self) -> AppResult<()> {
        let created: Vec<Credential> = credentials::list(self.conn, self.engagement_id)?
            .into_iter()
            .filter(|c| !self.before.credentials.iter().any(|b| b.id == c.id))
            .collect();
        for c in created {
            let pairs: Vec<TriedPair> = tried_pairs::list(self.conn, self.engagement_id)?
                .into_iter()
                .filter(|t| {
                    t.username.trim().to_lowercase() == c.username.trim().to_lowercase()
                        && t.secret == c.secret
                        && same_domain(self.anchor.as_deref(), t.domain.as_deref(), c.domain.as_deref())
                })
                .collect();
            if pairs.is_empty() {
                continue;
            }
            let inputs: Vec<CredAttemptInput> = pairs
                .iter()
                .map(|t| CredAttemptInput {
                    cred_id: c.id.clone(),
                    username_id: None,
                    host_id: t.host_id.clone(),
                    service: t.service.clone(),
                    port: None,
                    result: "failed".into(),
                    auth_mode: Some(t.auth_mode.clone()),
                    detail: None,
                    log_entry_id: t.log_entry_id.clone(),
                    at: Some(t.at),
                })
                .collect();
            let rows = attempts::upsert(self.conn, self.engagement_id, &inputs)?;
            for t in &pairs {
                self.conn.execute("DELETE FROM tried_pairs WHERE id = ?1", [&t.id])?;
            }
            let mut promotion = Promotion { credential_id: c.id.clone(), tried_pairs: Vec::new(), attempts: Vec::new() };
            for (t, a) in pairs.into_iter().zip(rows) {
                if self.before.tried_pairs.iter().any(|b| b.id == t.id) {
                    promotion.tried_pairs.push(t);
                    if !promotion.attempts.iter().any(|x| x.id == a.id) {
                        promotion.attempts.push(a);
                    }
                }
            }
            if !promotion.tried_pairs.is_empty() {
                self.record.promoted_tried_pairs.push(promotion);
            }
        }
        Ok(())
    }

    /// Promotes tried pairs, completes the record from what the writes changed, and stores the extraction.
    fn finish(mut self) -> AppResult<Filed> {
        // What the summary counts is read before the promotion, whose failures were recorded by earlier entries.
        let attempts: Vec<CredAttempt> = attempts::list(self.conn, self.engagement_id)?
            .into_iter()
            .filter(|a| self.before.attempts.iter().find(|b| b.id == a.id).is_none_or(|b| b.result != a.result))
            .collect();
        let tried_pairs_added =
            tried_pairs::list(self.conn, self.engagement_id)?.iter().filter(|t| !self.before.tried_pairs.iter().any(|b| b.id == t.id)).count();
        self.promote()?;

        let b = &self.before;
        let r = &mut self.record;
        let credentials_now = credentials::list(self.conn, self.engagement_id)?;
        for c in &credentials_now {
            match b.credentials.iter().find(|x| x.id == c.id) {
                None => r.created_credential_ids.push(c.id.clone()),
                Some(old) if old != c => r.credentials_before.push(old.clone()),
                Some(_) => {}
            }
        }
        let mut usernames_now = credentials::usernames_list(self.conn, self.engagement_id)?;
        usernames_now.sort_by(|x, y| (x.created_at, &x.id).cmp(&(y.created_at, &y.id)));
        r.created_username_ids = usernames_now.into_iter().filter(|u| !b.usernames.contains(&u.id)).map(|u| u.id).collect();
        for a in attempts::list(self.conn, self.engagement_id)? {
            match b.attempts.iter().find(|x| x.id == a.id) {
                None => r.created_attempt_ids.push(a.id),
                Some(old) if *old != a => r.attempts_before.push(old.clone()),
                Some(_) => {}
            }
        }
        r.created_tried_pair_ids = tried_pairs::list(self.conn, self.engagement_id)?
            .into_iter()
            .filter(|t| !b.tried_pairs.iter().any(|x| x.id == t.id))
            .map(|t| t.id)
            .collect();

        let named: HashSet<&str> = r
            .created_credential_ids
            .iter()
            .chain(r.credentials_before.iter().map(|c| &c.id))
            .map(String::as_str)
            .chain(attempts.iter().map(|a| a.cred_id.as_str()))
            .collect();
        let credentials: Vec<Credential> = credentials_now.into_iter().filter(|c| named.contains(c.id.as_str())).collect();

        let summary = serde_json::to_string(&ExtractionSummary::default())?;
        self.conn.execute(
            "INSERT INTO extractions (log_entry_id, engagement_id, summary, record, created_at, undone_at) VALUES (?1,?2,?3,?4,?5,NULL)",
            params![self.entry_id, self.engagement_id, summary, serde_json::to_string(&self.record)?, now_ms()],
        )?;
        Ok(Filed {
            extraction: get(self.conn, self.entry_id)?.ok_or(AppError::NotFound)?,
            host_ids: self.host_ids,
            scans: self.scans,
            identity_changed: self.identity_changed,
            attempts,
            credentials,
            tried_pairs_added,
            cracked: self.cracked,
            vectors: self.vectors,
        })
    }
}

fn push_new(ids: &mut Vec<String>, id: &str) {
    if !ids.iter().any(|x| x == id) {
        ids.push(id.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extractions::{list, undo};
    use crate::migrations;
    use rusqlite::types::Value;

    /// An in-memory vault at the latest schema: engagement `e` (domain corp.lan) with host `h1` (SRV12, 10.10.1.5, no
    /// OS) and log entries `l0` (at 5) and `l1` (at 10).
    fn vault() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        migrations::migrate_with(&mut c, migrations::MIGRATIONS, &mut |_, _| Ok(())).unwrap();
        c.execute(
            "INSERT INTO engagements (id,name,kind,scope_cidrs,domain,status,created_at,updated_at) \
             VALUES ('e','Lab A','lab','[]','corp.lan','active',1,1)",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES ('h1','e','SRV12','10.10.1.5',1,1)", []).unwrap();
        entry(&c, "l0", 5);
        entry(&c, "l1", 10);
        c
    }

    fn entry(c: &Connection, id: &str, at: i64) {
        c.execute(
            "INSERT INTO log_entries (id,engagement_id,kind,title,content,at,created_at,updated_at) VALUES (?1,'e','command','t','{}',?2,?2,?2)",
            params![id, at],
        )
        .unwrap();
    }

    fn tried(c: &Connection, id: &str, user: &str, domain: &str, secret: &str, service: &str, entry: &str) {
        c.execute(
            "INSERT INTO tried_pairs (id,engagement_id,username,domain,secret,secret_kind,host_id,service,auth_mode,log_entry_id,at) \
             VALUES (?1,'e',?2,?3,?4,'password','h1',?5,'domain',?6,5)",
            params![id, user, domain, secret, service, entry],
        )
        .unwrap();
    }

    fn cred(kind: &str, username: &str, domain: Option<&str>, secret: &str) -> CredentialInput {
        CredentialInput {
            kind: kind.into(),
            username: username.into(),
            domain: domain.map(str::to_string),
            secret: secret.into(),
            hash_type: None,
            scope: None,
            local_host_id: None,
            source_host_id: None,
            source: None,
            notes: None,
            crack_status: None,
            cracked_from: None,
            from_secret_id: None,
        }
    }

    fn attempt(host: &str, service: &str, result: &str) -> PlannedAttempt {
        PlannedAttempt {
            cred_id: String::new(),
            username_id: None,
            username_key: None,
            host_id: host.into(),
            service: service.into(),
            port: None,
            result: result.into(),
            auth_mode: None,
            detail: None,
        }
    }

    fn pending(input: CredentialInput, accepted: bool, attempts: Vec<PlannedAttempt>) -> PendingCredential {
        PendingCredential { input, accepted, attempts, from_username: None, if_declined: vec![] }
    }

    fn pair(user: &str, secret: &str, host: &str, service: &str) -> TriedPairInput {
        TriedPairInput {
            username: user.into(),
            domain: Some("corp.lan".into()),
            secret: secret.into(),
            secret_kind: "password".into(),
            host_id: host.into(),
            service: service.into(),
            auth_mode: None,
            log_entry_id: None,
            at: None,
        }
    }

    fn port(port: i64, service: &str, version: &str) -> ScanPort {
        ScanPort { port, protocol: "tcp".into(), state: "open".into(), service: service.into(), version: version.into() }
    }

    /// Every row a filing can touch, as text. A host's `updated_at` is left out: restoring its OS stamps it now.
    fn state(c: &Connection) -> Vec<Vec<String>> {
        [
            "SELECT id, name, ip, os, access FROM hosts",
            "SELECT * FROM services",
            "SELECT * FROM host_identity",
            "SELECT * FROM credentials",
            "SELECT * FROM usernames",
            "SELECT * FROM cred_attempts",
            "SELECT * FROM tried_pairs",
            "SELECT * FROM privesc_vectors",
            "SELECT * FROM extractions",
        ]
        .iter()
        .flat_map(|sql| {
            let mut st = c.prepare(&format!("{sql} ORDER BY 1")).unwrap();
            let n = st.column_count();
            st.query_map([], |r| (0..n).map(|i| r.get::<_, Value>(i).map(|v| format!("{v:?}"))).collect::<Result<Vec<_>, _>>())
                .unwrap()
                .map(|r| {
                    let mut row = r.unwrap();
                    row.insert(0, sql.to_string());
                    row
                })
                .collect::<Vec<_>>()
        })
        .collect()
    }

    fn ids(c: &Connection, sql: &str) -> Vec<String> {
        c.prepare(sql).unwrap().query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect()
    }

    /// What earlier work left: dina failed with Synth01! on SRV12's SSH (entry l0), a stored NT hash for paul, SSH on
    /// SRV12, and who the user is there.
    fn earlier_work(c: &Connection) {
        tried(c, "t1", "dina", "CORP", "Synth01!", "ssh", "l0");
        let hash = credentials::create(c, "e", cred("hash", "paul", Some("corp.lan"), "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f")).unwrap();
        c.execute("UPDATE credentials SET id='cH' WHERE id=?1", [hash.credential.id]).unwrap();
        c.execute(
            "INSERT INTO services (id,host_id,port,protocol,state,nmap_service,nmap_version,created_at,updated_at) \
             VALUES ('s22','h1',22,'tcp','open','ssh','OpenSSH 8.0',1,1)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO host_identity (host_id,username,privileges,groups,entry_id,updated_at) VALUES ('h1','corp\\jay','[]','[]','l0',1)",
            [],
        )
        .unwrap();
    }

    /// Entry l1's proofs: a scan of SRV12 and of a new host, an identity, a local dump on the new host, a crack, a
    /// username, an nxc hit for dina (whose earlier failure is a tried pair), a failed pair and a vector.
    fn everything() -> ExtractionProofs {
        let new = "new:10.10.1.9";
        let mut admin = cred("hash", "Administrator", None, "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0");
        admin.scope = Some("local".into());
        admin.local_host_id = Some(new.into());
        admin.source_host_id = Some(new.into());
        ExtractionProofs {
            new_hosts: vec![NewHost { key: new.into(), ip: "10.10.1.9".into() }],
            scans: vec![
                ScanProof { host_id: "h1".into(), ports: vec![port(22, "ssh", "OpenSSH 8.9"), port(445, "microsoft-ds", "")], os: Some("windows".into()) },
                ScanProof { host_id: new.into(), ports: vec![port(445, "microsoft-ds", "")], os: Some("windows".into()) },
            ],
            identity: Some(IdentityProof {
                host_id: "h1".into(),
                username: "corp\\jay".into(),
                privileges: vec!["SeImpersonatePrivilege".into()],
                groups: vec![],
            }),
            credentials: vec![admin],
            cracks: vec![CrackProof { plaintext: "Winter2000!".into(), credential_ids: vec!["cH".into()], proof_credentials: vec![] }],
            usernames: vec![UsernameInput { username: "mia".into(), domain: Some("corp.lan".into()), source_host_id: Some("h1".into()), source: None, scope: None, local_host_id: None }],
            intake: Some(IntakeProof {
                credentials: vec![pending(cred("password", "dina", Some("corp.lan"), "Synth01!"), true, vec![attempt("h1", "smb", "valid")])],
                ..Default::default()
            }),
            tried_pairs: vec![pair("sam", "Guess1", "h1", "smb")],
            vectors: vec![VectorProof { host_id: "h1".into(), title: "SeImpersonatePrivilege abuse".into() }],
            ..Default::default()
        }
    }

    #[test]
    fn a_save_then_its_undo_leaves_the_vault_as_it_was_tried_pairs_included() {
        let c = vault();
        earlier_work(&c);
        let before = state(&c);
        let filed = file(&c, "e", "l1", &everything()).unwrap();
        let r = &filed.extraction.record;

        // dina is a credential now: the earlier failure is an attempt on it, with its own proof and time.
        let dina = credentials::list(&c, "e").unwrap().into_iter().find(|x| x.username == "dina").unwrap();
        let on_dina: Vec<(String, String, Option<String>, i64)> = attempts::list(&c, "e")
            .unwrap()
            .into_iter()
            .filter(|a| a.cred_id == dina.id)
            .map(|a| (a.service, a.result, a.log_entry_id, a.at))
            .collect();
        assert_eq!(
            on_dina,
            vec![("ssh".into(), "failed".into(), Some("l0".into()), 5), ("smb".into(), "valid".into(), Some("l1".into()), 10)]
        );
        assert_eq!(ids(&c, "SELECT username FROM tried_pairs"), vec!["sam"]);
        assert_eq!(r.promoted_tried_pairs.len(), 1);
        assert_eq!(r.promoted_tried_pairs[0].credential_id, dina.id);
        assert_eq!(r.promoted_tried_pairs[0].tried_pairs.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["t1"]);
        // The summary's failures are this save's: the promoted one was counted when it was tried.
        assert_eq!(filed.tried_pairs_added, 1);
        assert!(filed.attempts.iter().all(|a| a.log_entry_id.as_deref() == Some("l1")));
        assert_eq!(filed.cracked, vec![Cracked { hash_id: "cH".into(), plaintext: "Winter2000!".into() }]);
        assert!(filed.identity_changed);
        assert_eq!(filed.vectors.iter().map(|v| v.title.as_str()).collect::<Vec<_>>(), vec!["SeImpersonatePrivilege abuse"]);
        let new_host = filed.host_ids["new:10.10.1.9"].clone();
        assert_eq!(r.created_host_ids, vec![new_host.clone()]);
        assert_eq!(
            filed.scans,
            vec![
                ScanFiled { host_id: "h1".into(), services: 2, os_set: true },
                ScanFiled { host_id: new_host.clone(), services: 1, os_set: true },
            ]
        );

        undo(&c, "l1").unwrap();
        // The extraction stays, marked undone; every other row is as it was.
        let rows = |s: Vec<Vec<String>>| s.into_iter().filter(|r| !r[0].contains("extractions")).collect::<Vec<_>>();
        assert_eq!(rows(state(&c)), rows(before));
    }

    #[test]
    fn a_failure_part_way_writes_nothing() {
        let c = vault();
        earlier_work(&c);
        let before = state(&c);
        let mut proofs = everything();
        // The last write fails: a vector needs a title.
        proofs.vectors.push(VectorProof { host_id: "h1".into(), title: " ".into() });
        assert!(matches!(file(&c, "e", "l1", &proofs), Err(AppError::Validation { .. })));
        assert_eq!(state(&c), before);
        // Nothing is left half open: the next filing works.
        file(&c, "e", "l1", &everything()).unwrap();
    }

    #[test]
    fn an_entry_is_filed_once() {
        let c = vault();
        let proofs = ExtractionProofs { tried_pairs: vec![pair("sam", "Guess1", "h1", "smb")], ..Default::default() };
        file(&c, "e", "l1", &proofs).unwrap();
        let before = state(&c);
        let again = ExtractionProofs { tried_pairs: vec![pair("tom", "Guess2", "h1", "smb")], ..Default::default() };
        assert!(matches!(file(&c, "e", "l1", &again), Err(AppError::Conflict(_))));
        assert_eq!(state(&c), before);
        assert!(matches!(file(&c, "e", "nope", &again), Err(AppError::NotFound)));
    }

    #[test]
    fn finish_adds_the_summary_and_ticks_and_restamps() {
        let c = vault();
        let filed = file(&c, "e", "l1", &ExtractionProofs::default()).unwrap();
        assert_eq!(filed.extraction.summary, ExtractionSummary::default());
        let summary = ExtractionSummary { wins: vec![], counts: vec!["Nothing new: already recorded".into()], ticks: vec![] };
        let ticks = vec![OutputTick { owner_id: "h1".into(), goal_id: "g".into(), parser: "nxc".into() }];
        let done = finish(&c, "l1", &summary, &ticks).unwrap();
        assert_eq!((done.summary, done.record.output_ticks), (summary.clone(), ticks.clone()));
        assert!(done.created_at >= filed.extraction.created_at);
        undo(&c, "l1").unwrap();
        assert!(matches!(finish(&c, "l1", &summary, &ticks), Err(AppError::Conflict(_))));
        assert!(matches!(finish(&c, "l0", &summary, &ticks), Err(AppError::NotFound)));
    }

    #[test]
    fn a_spray_files_the_hit_the_failures_and_proves_stored_rows_again() {
        let c = vault();
        let spray = |stored: &str| ExtractionProofs {
            intake: Some(IntakeProof {
                usernames: vec![PlannedUsername {
                    key: "stan|".into(),
                    input: UsernameInput { username: "stan".into(), domain: None, source_host_id: None, source: Some("nxc".into()), scope: None, local_host_id: None },
                }],
                credentials: vec![pending(cred("password", "stan", None, "Synth01!"), true, vec![attempt("h1", "ssh", "valid")])],
                reproved_username_ids: vec![stored.to_string()],
                ..Default::default()
            }),
            tried_pairs: vec![pair("dina", "Synth01!", "h1", "ssh")],
            ..Default::default()
        };
        let first = file(&c, "e", "l0", &spray("")).unwrap().extraction.record;
        let stan = credentials::list(&c, "e").unwrap().remove(0);
        let user = credentials::usernames_list(&c, "e").unwrap().remove(0);
        assert_eq!(first.created_credential_ids, vec![stan.id.clone()]);
        assert_eq!(first.created_username_ids, vec![user.id.clone()]);
        assert_eq!(first.created_tried_pair_ids, ids(&c, "SELECT id FROM tried_pairs"));
        assert_eq!(first.created_attempt_ids.len(), 1);
        assert!(first.reproved_credential_ids.is_empty() && first.reproved_username_ids.is_empty());

        // The same output again files nothing new, and says what it proved again.
        let filed = file(&c, "e", "l1", &spray(&user.id)).unwrap();
        let second = &filed.extraction.record;
        assert!(second.created_credential_ids.is_empty() && second.created_tried_pair_ids.is_empty());
        assert!(second.created_attempt_ids.is_empty());
        assert_eq!(second.reproved_credential_ids, vec![stan.id.clone()]);
        assert_eq!(second.reproved_username_ids, vec![user.id]);
        // Its attempt is re-dated (a later proof), not changed in result: not news.
        assert_eq!(second.attempts_before.len(), 1);
        assert!(filed.attempts.is_empty());
    }

    #[test]
    fn a_failed_username_result_already_kept_as_a_tried_pair_is_not_filed_again() {
        let c = vault();
        let pw = credentials::create(&c, "e", cred("password", "", None, "Synth01!")).unwrap().credential;
        let input = UsernameInput { username: "dina".into(), domain: Some("CORP".into()), source_host_id: None, source: None, scope: None, local_host_id: None };
        let dina = credentials::username_create(&c, "e", input).unwrap();
        tried(&c, "t1", "Dina", "corp.lan", "Synth01!", "ssh", "l0");
        let failed = |service: &str| PlannedAttempt { cred_id: pw.id.clone(), username_id: Some(dina.id.clone()), ..attempt("h1", service, "failed") };
        let intake = IntakeProof { attempts: vec![failed("ssh"), failed("smb")], ..Default::default() };
        file(&c, "e", "l1", &ExtractionProofs { intake: Some(intake), ..Default::default() }).unwrap();
        let services: Vec<String> = attempts::list(&c, "e").unwrap().into_iter().map(|a| a.service).collect();
        assert_eq!(services, vec!["smb"]);
    }

    #[test]
    fn a_credential_takes_over_only_the_tried_pairs_in_its_domain() {
        let c = vault();
        tried(&c, "tNetbios", "jay", "CORP", "Synth999!", "ssh", "l0");
        tried(&c, "tOther", "jay", "corp.local", "Synth999!", "ssh", "l0");
        let proofs = ExtractionProofs { credentials: vec![cred("password", "jay", Some("corp.lan"), "Synth999!")], ..Default::default() };
        let r = file(&c, "e", "l1", &proofs).unwrap().extraction.record;
        assert_eq!(ids(&c, "SELECT id FROM tried_pairs"), vec!["tOther"]);
        assert_eq!(r.promoted_tried_pairs[0].tried_pairs.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["tNetbios"]);
        undo(&c, "l1").unwrap();
        assert_eq!(ids(&c, "SELECT id FROM tried_pairs ORDER BY id"), vec!["tNetbios", "tOther"]);
        assert!(ids(&c, "SELECT id FROM credentials").is_empty());
    }

    #[test]
    fn promoted_pairs_stay_promoted_while_another_entry_proves_the_credential() {
        let c = vault();
        entry(&c, "l2", 20);
        tried(&c, "t1", "jay", "corp.lan", "Synth999!", "ssh", "l0");
        let jay = || ExtractionProofs { credentials: vec![cred("password", "jay", Some("corp.lan"), "Synth999!")], ..Default::default() };
        file(&c, "e", "l1", &jay()).unwrap();
        // l2 dumps jay again: it proves the credential l1 created.
        assert_eq!(file(&c, "e", "l2", &jay()).unwrap().extraction.record.reproved_credential_ids.len(), 1);
        undo(&c, "l1").unwrap();
        assert_eq!(ids(&c, "SELECT username FROM credentials"), vec!["jay"]);
        assert!(ids(&c, "SELECT id FROM tried_pairs").is_empty());
        assert_eq!(ids(&c, "SELECT log_entry_id FROM cred_attempts"), vec!["l0"]);
    }

    #[test]
    fn an_accepted_pair_the_store_holds_is_reused_and_linked_to_its_secret() {
        let c = vault();
        let secret = credentials::create(&c, "e", cred("password", "", None, "Synth01!")).unwrap().credential;
        let stan = credentials::create(&c, "e", cred("password", "stan", None, "Synth01!")).unwrap().credential;
        let mut input = cred("password", "stan", None, "Synth01!");
        input.from_secret_id = Some(secret.id.clone());
        let intake = IntakeProof { credentials: vec![pending(input, true, vec![attempt("h1", "ssh", "valid")])], ..Default::default() };
        let filed = file(&c, "e", "l1", &ExtractionProofs { intake: Some(intake), ..Default::default() }).unwrap();
        let r = &filed.extraction.record;
        assert!(r.created_credential_ids.is_empty());
        assert_eq!(r.reproved_credential_ids, vec![stan.id.clone()]);
        assert_eq!(r.credentials_before, vec![stan.clone()]);
        assert_eq!(credentials::get(&c, &stan.id).unwrap().from_secret_id, Some(secret.id));
        // The win line's credential comes back with its attempt.
        assert_eq!(filed.attempts.len(), 1);
        assert_eq!(filed.credentials.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec![stan.id.as_str()]);
    }

    #[test]
    fn a_hash_cracked_before_is_proved_again_with_its_password() {
        let c = vault();
        let hash = credentials::create(&c, "e", cred("hash", "paul", Some("corp.lan"), "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f")).unwrap().credential;
        let pw = credentials::crack(&c, &hash.id, "Winter2000!").unwrap();
        let crack = CrackProof { plaintext: "Winter2000!".into(), credential_ids: vec![hash.id.clone()], proof_credentials: vec![] };
        let filed = file(&c, "e", "l1", &ExtractionProofs { cracks: vec![crack], ..Default::default() }).unwrap();
        assert!(filed.cracked.is_empty());
        assert_eq!(filed.extraction.record.reproved_credential_ids, vec![hash.id, pw.id]);
    }

    #[test]
    fn a_crack_can_name_a_hash_dumped_in_the_same_save() {
        let c = vault();
        let proofs = ExtractionProofs {
            credentials: vec![cred("hash", "paul", Some("corp.lan"), "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f")],
            cracks: vec![CrackProof { plaintext: "Winter2000!".into(), credential_ids: vec![], proof_credentials: vec![0] }],
            ..Default::default()
        };
        let filed = file(&c, "e", "l1", &proofs).unwrap();
        assert_eq!(filed.cracked.len(), 1);
        assert_eq!(filed.extraction.record.created_credential_ids.len(), 2);
        undo(&c, "l1").unwrap();
        assert!(ids(&c, "SELECT id FROM credentials").is_empty());
    }

    #[test]
    fn a_scan_fills_only_a_missing_os() {
        let c = vault();
        c.execute("UPDATE hosts SET os='linux' WHERE id='h1'", []).unwrap();
        let scan = ScanProof { host_id: "h1".into(), ports: vec![port(22, "ssh", "")], os: Some("windows".into()) };
        let filed = file(&c, "e", "l1", &ExtractionProofs { scans: vec![scan], ..Default::default() }).unwrap();
        assert_eq!(filed.scans, vec![ScanFiled { host_id: "h1".into(), services: 1, os_set: false }]);
        assert!(filed.extraction.record.host_os_before.is_empty());
        assert_eq!(hosts::get(&c, "h1").unwrap().os.as_deref(), Some("linux"));
    }

    #[test]
    fn an_unchanged_identity_is_not_written() {
        let c = vault();
        earlier_work(&c);
        let identity = IdentityProof { host_id: "h1".into(), username: "corp\\jay".into(), privileges: vec![], groups: vec![] };
        let filed = file(&c, "e", "l1", &ExtractionProofs { identity: Some(identity), ..Default::default() }).unwrap();
        assert!(!filed.identity_changed && filed.extraction.record.identity_before.is_empty());
        assert_eq!(host_facts::identity_get(&c, "h1").unwrap().unwrap().entry_id.as_deref(), Some("l0"));
    }

    #[test]
    fn a_record_stored_before_promotions_were_recorded_still_undoes() {
        let c = vault();
        // What the earlier frontend filed for l1 (an nxc hit for jay, whose l0 failure it promoted, and a failed pair
        // for sam) and the record it stored, in that record's shape: no promotedTriedPairs.
        let jay = credentials::create(&c, "e", cred("password", "jay", Some("corp.lan"), "Synth999!")).unwrap().credential;
        c.execute(
            "INSERT INTO cred_attempts (id,engagement_id,cred_id,host_id,service,result,auth_mode,log_entry_id,at) VALUES \
             ('aHit','e',?1,'h1','smb','valid','domain','l1',10), ('aPromoted','e',?1,'h1','ssh','failed','domain','l0',5)",
            [&jay.id],
        )
        .unwrap();
        tried(&c, "tSam", "sam", "corp.lan", "Guess1", "smb", "l1");
        let old = format!(
            r#"{{"createdHostIds":[],"createdServiceIds":[],"servicesBefore":[],"hostOsBefore":[],"identityBefore":[],
              "createdCredentialIds":["{}"],"credentialsBefore":[],"createdUsernameIds":[],"createdAttemptIds":["aHit","aPromoted"],
              "attemptsBefore":[],"createdTriedPairIds":["tSam"],"createdVectorIds":[],"outputTicks":[],
              "reprovedCredentialIds":[],"reprovedUsernameIds":[]}}"#,
            jay.id
        );
        c.execute(
            "INSERT INTO extractions (log_entry_id,engagement_id,summary,record,created_at) VALUES ('l1','e','{\"wins\":[],\"counts\":[],\"ticks\":[]}',?1,?2)",
            params![old, now_ms()],
        )
        .unwrap();
        assert!(list(&c, "e").unwrap()[0].record.promoted_tried_pairs.is_empty());
        assert!(undo(&c, "l1").unwrap().undone_at.is_some());
        // As before records said what they promoted: this entry's rows go, and the failure l0 proved keeps the
        // credential.
        assert!(ids(&c, "SELECT id FROM tried_pairs").is_empty());
        assert_eq!(ids(&c, "SELECT id FROM cred_attempts"), vec!["aPromoted"]);
        assert_eq!(ids(&c, "SELECT id FROM credentials"), vec![jay.id]);
    }

    /// Adds WEB01 (`hW`) and sql01.corp.lan (`hS`) to the vault.
    fn two_windows_hosts(c: &Connection) {
        c.execute_batch(
            "INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES \
             ('hW','e','WEB01','192.0.2.10',1,1), ('hS','e','sql01.corp.lan','192.0.2.11',1,1)",
        )
        .unwrap();
    }

    fn user(name: &str, domain: Option<&str>, source_host: Option<&str>) -> UsernameInput {
        UsernameInput {
            username: name.into(),
            domain: domain.map(str::to_string),
            source_host_id: source_host.map(str::to_string),
            source: None,
            scope: None,
            local_host_id: None,
        }
    }

    /// Every username: (name, domain, scope, local host).
    fn scoped(c: &Connection) -> Vec<(String, Option<String>, String, Option<String>)> {
        let mut out: Vec<_> = credentials::usernames_list(c, "e")
            .unwrap()
            .into_iter()
            .map(|u| (u.username, u.domain, u.scope, u.local_host_id))
            .collect();
        out.sort();
        out
    }

    fn local_cred(kind: &str, name: &str, secret: &str, host: &str) -> CredentialInput {
        let mut i = cred(kind, name, None, secret);
        i.scope = Some("local".into());
        i.local_host_id = Some(host.into());
        i.source_host_id = Some(host.into());
        i
    }

    #[test]
    fn capture_output_sets_a_username_scope() {
        let c = vault();
        two_windows_hosts(&c);
        let s = |x: &str| Some(x.to_string());
        let proofs = ExtractionProofs {
            usernames: vec![
                // `.\name`: local to the host the output ran on; with no such host, unknown.
                user("ann", Some("."), Some("hS")),
                user("bea", Some("."), None),
                // A host's short name, in any case, from wherever the output ran: local to that host.
                user("cal", Some("web01"), Some("hS")),
                user("dee", Some("SQL01"), Some("hS")),
                // The engagement's domain, in either spelling: domain, as written.
                user("eve", Some("CORP"), Some("hS")),
                user("fay", Some("corp.lan"), None),
                // Anything else: unknown.
                user("gus", Some("FABRIKAM"), None),
                user("hal", Some("corp.local"), None),
                user("ivy", None, Some("hS")),
            ],
            // An nxc --local-auth result's username, which the frontend plans as `.\name` on the host it answered from.
            intake: Some(IntakeProof {
                usernames: vec![PlannedUsername { key: "k-jo".into(), input: user("jo", Some("."), Some("hW")) }],
                ..Default::default()
            }),
            ..Default::default()
        };
        let filed = file(&c, "e", "l1", &proofs).unwrap();
        assert_eq!(
            scoped(&c),
            vec![
                ("ann".into(), None, "local".into(), s("hS")),
                ("bea".into(), s("."), "unknown".into(), None),
                ("cal".into(), None, "local".into(), s("hW")),
                ("dee".into(), None, "local".into(), s("hS")),
                ("eve".into(), s("CORP"), "domain".into(), None),
                ("fay".into(), s("corp.lan"), "domain".into(), None),
                ("gus".into(), s("FABRIKAM"), "unknown".into(), None),
                ("hal".into(), s("corp.local"), "unknown".into(), None),
                ("ivy".into(), None, "unknown".into(), None),
                ("jo".into(), None, "local".into(), s("hW")),
            ]
        );
        assert_eq!(filed.extraction.record.created_username_ids.len(), 10);

        // The same listing again is the same usernames, proved again.
        let listing = ExtractionProofs { usernames: proofs.usernames.clone(), ..Default::default() };
        let again = file(&c, "e", "l0", &listing).unwrap().extraction.record;
        assert!(again.created_username_ids.is_empty());
        assert_eq!(again.reproved_username_ids.len(), 9);

        // A local name on another host is another username; a domain one never merges with the unknown one.
        let more = ExtractionProofs { usernames: vec![user("ann", Some("."), Some("hW")), user("ivy", Some("corp.lan"), None)], ..Default::default() };
        entry(&c, "l2", 20);
        assert_eq!(file(&c, "e", "l2", &more).unwrap().extraction.record.created_username_ids.len(), 2);
        undo(&c, "l2").unwrap();
        undo(&c, "l1").unwrap();
        // l0 still proves the listed ones; the nxc one goes with l1.
        assert_eq!(credentials::usernames_list(&c, "e").unwrap().len(), 9);
    }

    #[test]
    fn a_host_named_by_its_ip_or_shared_by_two_hosts_names_no_local_account() {
        let c = vault();
        c.execute_batch(
            "INSERT INTO hosts (id,engagement_id,name,ip,created_at,updated_at) VALUES \
             ('hIp','e','192.0.2.30','192.0.2.30',1,1), ('hA','e','dup.corp.lan','192.0.2.31',1,1), \
             ('hB','e','DUP','192.0.2.32',1,1)",
        )
        .unwrap();
        let proofs = ExtractionProofs { usernames: vec![user("ann", Some("192"), None), user("bo", Some("dup"), None)], ..Default::default() };
        file(&c, "e", "l1", &proofs).unwrap();
        let scopes: Vec<String> = scoped(&c).into_iter().map(|u| u.2).collect();
        assert_eq!(scopes, vec!["unknown", "unknown"]);
    }

    /// The stored local credential jay / Winter2024! on WEB01, which the reuse tests find again on SQL01.
    fn jen_on_web(c: &Connection) -> Credential {
        two_windows_hosts(c);
        credentials::create(c, "e", local_cred("password", "jay", "Winter2024!", "hW")).unwrap().credential
    }

    #[test]
    fn a_local_account_whose_name_and_secret_are_stored_for_another_host_is_password_reuse() {
        let c = vault();
        let web = jen_on_web(&c);
        // nxc --local-auth against SQL01: `SQL01\JAY:Winter2024!`. The frontend finds the stored credential by name and
        // secret, so its result is an attempt of that credential, and plans the local username.
        let spray = IntakeProof {
            usernames: vec![PlannedUsername { key: "k-jay".into(), input: user("JAY", Some("."), Some("hS")) }],
            attempts: vec![PlannedAttempt { cred_id: web.id.clone(), auth_mode: Some("local".into()), ..attempt("hS", "smb", "valid") }],
            ..Default::default()
        };
        let filed = file(&c, "e", "l1", &ExtractionProofs { intake: Some(spray), ..Default::default() }).unwrap();
        let r = &filed.extraction.record;
        assert!(r.created_username_ids.is_empty() && r.created_credential_ids.is_empty());
        assert!(credentials::usernames_list(&c, "e").unwrap().is_empty());
        let tried: Vec<(String, String, String, String)> =
            attempts::list(&c, "e").unwrap().into_iter().map(|a| (a.cred_id, a.host_id, a.result, a.auth_mode)).collect();
        assert_eq!(tried, vec![(web.id.clone(), "hS".into(), "valid".into(), "local".into())]);

        // A dump on SQL01 holding the same account and secret: no new credential, an attempt of the stored one there.
        let dump = ExtractionProofs { credentials: vec![local_cred("password", "Jay", "Winter2024!", "hS")], ..Default::default() };
        let r = file(&c, "e", "l0", &dump).unwrap().extraction.record;
        assert!(r.created_credential_ids.is_empty() && r.created_username_ids.is_empty());
        assert_eq!(r.reproved_credential_ids, vec![web.id.clone()]);
        assert_eq!(credentials::list(&c, "e").unwrap().len(), 1);
        let on_sql: Vec<(String, String)> =
            attempts::list(&c, "e").unwrap().into_iter().filter(|a| a.host_id == "hS").map(|a| (a.cred_id, a.service)).collect();
        assert_eq!(on_sql, vec![(web.id.clone(), "other".into()), (web.id.clone(), "smb".into())]);

        // Undo takes the dump's attempt away and leaves the credential, which l1 still proves.
        undo(&c, "l0").unwrap();
        assert_eq!(attempts::list(&c, "e").unwrap().len(), 1);
        assert_eq!(credentials::list(&c, "e").unwrap().len(), 1);
    }

    #[test]
    fn a_reused_nt_hash_matches_whatever_its_case() {
        let c = vault();
        two_windows_hosts(&c);
        let web = credentials::create(&c, "e", local_cred("hash", "jay", &"AB".repeat(16), "hW")).unwrap().credential;
        let dump = ExtractionProofs { credentials: vec![local_cred("hash", "jay", &"ab".repeat(16), "hS")], ..Default::default() };
        file(&c, "e", "l1", &dump).unwrap();
        assert_eq!(ids(&c, "SELECT id FROM credentials"), vec![web.id.clone()]);
        assert_eq!(ids(&c, "SELECT cred_id || '@' || host_id FROM cred_attempts"), vec![format!("{}@hS", web.id)]);
    }

    #[test]
    fn a_different_secret_or_none_files_a_new_local_username() {
        let c = vault();
        let web = jen_on_web(&c);
        // nxc --local-auth against SQL01 with another password: a new local credential, and jay's username on SQL01.
        let other = IntakeProof {
            usernames: vec![PlannedUsername { key: "k-jay".into(), input: user("jay", Some("."), Some("hS")) }],
            credentials: vec![pending(local_cred("password", "jay", "Spring2025!", "hS"), true, vec![attempt("hS", "smb", "valid")])],
            ..Default::default()
        };
        let r = file(&c, "e", "l1", &ExtractionProofs { intake: Some(other), ..Default::default() }).unwrap().extraction.record;
        assert_eq!(r.created_credential_ids.len(), 1);
        assert_eq!(scoped(&c), vec![("jay".into(), None, "local".into(), Some("hS".into()))]);
        let sql_cred = credentials::get(&c, &r.created_credential_ids[0]).unwrap();
        assert_eq!((sql_cred.local_host_id.as_deref(), sql_cred.secret.as_str()), (Some("hS"), "Spring2025!"));
        assert_ne!(sql_cred.id, web.id);
        undo(&c, "l1").unwrap();

        // Enumeration alone (`SQL01\jay`, no secret) files the local username on SQL01 too.
        let listed = ExtractionProofs { usernames: vec![user("jay", Some("SQL01"), Some("hS"))], ..Default::default() };
        file(&c, "e", "l0", &listed).unwrap();
        assert_eq!(scoped(&c), vec![("jay".into(), None, "local".into(), Some("hS".into()))]);
        assert_eq!(credentials::list(&c, "e").unwrap().len(), 1);
    }

    #[test]
    fn the_same_output_with_reuse_and_another_secret_keeps_the_username() {
        let c = vault();
        let web = jen_on_web(&c);
        let both = IntakeProof {
            usernames: vec![PlannedUsername { key: "k-jay".into(), input: user("jay", Some("."), Some("hS")) }],
            attempts: vec![PlannedAttempt { cred_id: web.id.clone(), auth_mode: Some("local".into()), ..attempt("hS", "smb", "valid") }],
            credentials: vec![pending(local_cred("password", "jay", "Spring2025!", "hS"), true, vec![attempt("hS", "winrm", "valid")])],
            ..Default::default()
        };
        file(&c, "e", "l1", &ExtractionProofs { intake: Some(both), ..Default::default() }).unwrap();
        assert_eq!(scoped(&c), vec![("jay".into(), None, "local".into(), Some("hS".into()))]);
        assert_eq!(credentials::list(&c, "e").unwrap().len(), 2);
    }

    #[test]
    fn deleting_a_host_keeps_the_local_usernames_capture_filed_on_it() {
        let c = vault();
        two_windows_hosts(&c);
        file(&c, "e", "l1", &ExtractionProofs { usernames: vec![user("jay", Some("."), Some("hW"))], ..Default::default() }).unwrap();
        hosts::delete(&c, "hW").unwrap();
        assert_eq!(scoped(&c), vec![("jay".into(), None, "local".into(), None)]);
    }
}
