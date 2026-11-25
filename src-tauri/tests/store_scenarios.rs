//! Runs every store scenario (`src/test/storeScenarios/*.json`) on a migrated in-memory SQLite database, calling the
//! same domain module functions the Tauri commands call. `src/test/storeScenarios/storeScenarios.test.ts` runs the
//! same files on the in-browser fake, so the two stores can't drift apart. The format is in the README beside them.

use raven_lib::error::{AppError, AppResult};
use raven_lib::reports::ReportDefaults;
use raven_lib::{
    attempts, checklist, cleanup, credentials, engagements, extractions, field_manual, findings, host_facts, hosts, log,
    migrations, network, notes, payload_builds, reports, services, settings, tried_pairs,
};
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;

fn open() -> Connection {
    let mut c = Connection::open_in_memory().expect("in-memory database");
    c.execute_batch("PRAGMA foreign_keys = ON").expect("foreign keys on");
    migrations::migrate(&mut c, &mut |_, _| Ok(())).expect("migrations");
    c
}

/// Argument `i`, as the Tauri command would deserialise it. A missing argument is `null`.
fn arg<T: DeserializeOwned>(cmd: &str, a: &[Value], i: usize) -> T {
    serde_json::from_value(a.get(i).cloned().unwrap_or(Value::Null))
        .unwrap_or_else(|e| panic!("{cmd}: argument {i} does not fit the command: {e}"))
}

/// One `api` command, by its name in `src/lib/api.ts`, with that function's positional arguments. Where the
/// TypeScript wrapper reshapes its arguments before `invoke`, the same reshaping is done here.
fn call(c: &Connection, cmd: &str, a: &[Value]) -> AppResult<Value> {
    macro_rules! out {
        ($e:expr) => {
            Ok(serde_json::to_value($e?).expect("serialise result"))
        };
    }
    let s = |i: usize| -> String { arg(cmd, a, i) };
    let o = |i: usize| -> Option<String> { arg(cmd, a, i) };
    match cmd {
        "settingsGet" => out!(settings::get(c)),
        "settingsUpdate" => out!(settings::update(c, arg(cmd, a, 0))),
        "fieldManualSave" => out!(field_manual::save(c, &arg(cmd, a, 0))),
        "fieldManualLoad" => out!(field_manual::load(c)),

        "engagementsList" => out!(engagements::list(c)),
        "engagementGet" => out!(engagements::get(c, &s(0))),
        "engagementCreate" => out!(engagements::create(c, arg(cmd, a, 0))),
        "engagementUpdate" => out!(engagements::update(c, &s(0), arg(cmd, a, 1))),
        "engagementSetStatus" => out!(engagements::set_status(c, &s(0), &s(1))),
        "engagementSetMsfHost" => out!(engagements::set_msf_host(c, &s(0), o(1).as_deref())),
        "engagementSetTimeboxPaused" => out!(engagements::set_timebox_paused(c, &s(0), arg(cmd, a, 1))),
        "engagementDelete" => out!(engagements::delete(c, &s(0))),
        "engagementsProgress" => out!(engagements::progress_all(c)),

        "hostsList" => out!(hosts::list(c, &s(0))),
        "hostCreate" => out!(hosts::create(c, &s(0), arg(cmd, a, 1))),
        "hostUpdate" => out!(hosts::update(c, &s(0), arg(cmd, a, 1))),
        "hostMove" => out!(hosts::move_to(c, &s(0), &s(1))),
        "hostSyncBoard" => out!(hosts::sync_board(c, &s(0), &s(1))),
        "hostMarkAccessReviewed" => out!(hosts::mark_access_reviewed(c, &s(0))),
        "hostDelete" => out!(hosts::delete(c, &s(0))),

        "servicesList" => out!(services::list(c, &s(0))),
        "servicesListEngagement" => out!(services::list_engagement(c, &s(0))),
        "servicesUpsertScan" => out!(services::upsert_scan(c, &s(0), &arg::<Vec<services::ScanPort>>(cmd, a, 1))),
        "serviceCreate" => out!(services::create(c, &s(0), arg(cmd, a, 1))),
        "serviceUpdate" => out!(services::update(c, &s(0), arg(cmd, a, 1))),
        "serviceConfirm" => out!(services::confirm(c, &s(0), arg(cmd, a, 1))),
        "serviceUnconfirm" => out!(services::unconfirm(c, &s(0))),
        "serviceDelete" => out!(services::delete(c, &s(0))),
        "serviceSetVerdict" => out!(services::set_verdict(c, &s(0), o(1).as_deref(), o(2).as_deref())),
        "hostIdentityGet" => out!(host_facts::identity_get(c, &s(0))),
        "hostIdentitySet" => {
            // The wrapper sends `updatedAt: 0`; the store stamps its own.
            let mut input = a.first().cloned().unwrap_or(Value::Null);
            if let Some(m) = input.as_object_mut() {
                m.insert("updatedAt".into(), Value::from(0));
            }
            out!(host_facts::identity_set(c, arg(cmd, &[input], 0)))
        }
        "vectorsList" => out!(host_facts::vectors_list(c, &s(0))),
        "vectorUpsert" => out!(host_facts::vector_upsert(c, &s(0), arg(cmd, a, 1))),
        "vectorSetStatus" => out!(host_facts::vector_set_status(c, &s(0), &s(1), o(2).as_deref())),
        "vectorDelete" => out!(host_facts::vector_delete(c, &s(0))),

        "logList" => out!(log::list(c, &s(0))),
        "logCreate" => out!(log::create(c, &s(0), arg(cmd, a, 1))),
        "logUpdate" => out!(log::update(c, &s(0), arg(cmd, a, 1))),
        "logDelete" => out!(log::delete(c, &s(0))),
        "attachmentGet" => out!(log::attachment_get(c, &s(0))),

        "checklistList" => out!(checklist::list(c, &s(0))),
        "checklistPut" => out!(checklist::put(c, &s(0), &arg::<Vec<checklist::ChecklistItemInput>>(cmd, a, 1))),
        "checklistApplyCover" => {
            out!(checklist::apply_cover(c, &s(0), &arg::<Vec<checklist::GoalRef>>(cmd, a, 1), &arg::<Vec<checklist::GoalRef>>(cmd, a, 2)))
        }
        "checklistApplyFacts" => {
            out!(checklist::apply_facts(c, &s(0), &arg::<Vec<checklist::GoalRef>>(cmd, a, 1), &arg::<Vec<checklist::GoalRef>>(cmd, a, 2)))
        }

        "notesGet" => out!(notes::get(c, &s(0), o(1).as_deref())),
        "notesList" => out!(notes::list(c, &s(0))),
        "noteSave" => out!(notes::save(c, &s(0), o(1).as_deref(), &s(2), arg(cmd, a, 3))),
        "ruledOutList" => out!(notes::ruled_out_list(c, &s(0))),
        "ruledOutCreate" => out!(notes::ruled_out_create(c, arg(cmd, a, 0))),
        "ruledOutDelete" => out!(notes::ruled_out_delete(c, &s(0))),

        "tunnelsList" => out!(network::tunnels_list(c, &s(0))),
        "tunnelCreate" => out!(network::tunnel_create(c, &s(0), arg(cmd, a, 1))),
        "tunnelUpdate" => out!(network::tunnel_update(c, &s(0), arg(cmd, a, 1))),
        "tunnelDelete" => out!(network::tunnel_delete(c, &s(0))),
        "interfaceDismissalsList" => out!(network::interface_dismissals_list(c, &s(0))),
        "interfaceDismiss" => out!(network::interface_dismiss(c, &s(0), &s(1), &s(2))),
        "hopsList" => out!(network::hops_list(c, &s(0))),
        "hopCreate" => out!(network::hop_create(c, &s(0), arg(cmd, a, 1))),
        "hopUpdate" => out!(network::hop_update(c, &s(0), arg(cmd, a, 1))),
        "hopDelete" => out!(network::hop_delete(c, &s(0))),

        "credentialsList" => out!(credentials::list(c, &s(0))),
        "credentialCreate" => out!(credentials::create(c, &s(0), arg(cmd, a, 1))),
        "sameDomains" => out!(credentials::same_domains(c, &s(0), &arg::<Vec<(Option<String>, Option<String>)>>(cmd, a, 1))),
        "credentialUpdate" => out!(credentials::update(c, &s(0), arg(cmd, a, 1))),
        "credentialDelete" => out!(credentials::delete(c, &s(0))),
        "credentialCrack" => out!(credentials::crack(c, &s(0), &s(1))),
        "credentialSetCrackStatus" => out!(credentials::set_crack_status(c, &s(0), &s(1))),
        "credentialConvertToAccess" => out!(credentials::convert_to_access(c, &s(0), arg(cmd, a, 1))),
        "usernamesList" => out!(credentials::usernames_list(c, &s(0))),
        "usernameCreate" => out!(credentials::username_create(c, &s(0), arg(cmd, a, 1))),
        "usernameDelete" => out!(credentials::username_delete(c, &s(0))),
        "accessGrantsList" => out!(credentials::grants_list(c, &s(0))),
        "accessGrantCreate" => out!(credentials::grant_create(c, &s(0), arg(cmd, a, 1))),
        "accessGrantDelete" => out!(credentials::grant_delete(c, &s(0))),
        "credAttemptsList" => out!(attempts::list(c, &s(0))),
        "credAttemptsUpsert" => out!(attempts::upsert(c, &s(0), &arg::<Vec<attempts::CredAttemptInput>>(cmd, a, 1))),
        "credAttemptDelete" => out!(attempts::delete(c, &s(0))),
        "credAttemptsRekey" => {
            out!(attempts::rekey_username_attempts(c, &s(0), &arg::<Vec<String>>(cmd, a, 1), &s(2), o(3).as_deref()))
        }
        "triedPairsList" => out!(tried_pairs::list(c, &s(0))),
        "triedPairsUpsert" => out!(tried_pairs::upsert(c, &s(0), &arg::<Vec<tried_pairs::TriedPairInput>>(cmd, a, 1))),
        "triedPairDelete" => out!(tried_pairs::delete(c, &s(0))),
        "triedPairPromote" => out!(tried_pairs::promote(c, &s(0), &s(1), o(2).as_deref(), &s(3))),
        "payloadBuildsList" => out!(payload_builds::list(c, &s(0))),
        "payloadBuildRecord" => out!(payload_builds::record(c, arg(cmd, a, 0))),
        "extractionSave" => out!(extractions::save(c, &s(0), &s(1), &arg(cmd, a, 2), &arg(cmd, a, 3))),
        "extractionFile" => out!(extractions::file(c, &s(0), &s(1), &arg(cmd, a, 2))),
        "extractionFinish" => {
            out!(extractions::finish(c, &s(0), &arg(cmd, a, 1), &arg::<Vec<extractions::OutputTick>>(cmd, a, 2)))
        }
        "extractionGet" => out!(extractions::get(c, &s(0))),
        "extractionsList" => out!(extractions::list(c, &s(0))),
        "extractionUndo" => out!(extractions::undo(c, &s(0))),

        "reportGetOrCreate" => {
            let st = settings::get(c)?;
            let defaults = ReportDefaults { candidate_name: st.report_name, email: st.report_email, osid: st.report_osid };
            out!(reports::get_or_create(c, &s(0), &defaults))
        }
        "reportUpdate" => out!(reports::update(c, &s(0), arg(cmd, a, 1))),
        "reportSectionsList" => out!(reports::sections_list(c, &s(0))),
        "reportSectionUpsert" => out!(reports::section_upsert(c, &s(0), arg(cmd, a, 1))),
        "reportSectionSave" => out!(reports::section_save(c, &s(0), arg(cmd, a, 1), arg(cmd, a, 2))),
        "reportSectionsReorder" => out!(reports::sections_reorder(c, &s(0), arg(cmd, a, 1))),
        "reportSectionsSave" => out!(reports::sections_save(c, &s(0), arg(cmd, a, 1), o(2))),
        "reportSectionDelete" => out!(reports::section_delete(c, &s(0), &s(1))),

        "findingsList" => out!(findings::findings_list(c, &s(0))),
        "findingCreate" => out!(findings::finding_create(c, &s(0), arg(cmd, a, 1))),
        "findingUpdate" => out!(findings::finding_update(c, &s(0), arg(cmd, a, 1))),
        "findingDelete" => out!(findings::finding_delete(c, &s(0))),
        "findingFilesList" => out!(findings::files_list(c, &s(0))),
        "findingFileCreate" => out!(findings::file_create(c, &s(0), arg(cmd, a, 1))),
        "findingFileUpdate" => out!(findings::file_update(c, &s(0), arg(cmd, a, 1))),
        "findingFileDelete" => out!(findings::file_delete(c, &s(0))),
        "failedAttemptsList" => out!(findings::attempts_list(c, &s(0))),
        "failedAttemptCreate" => out!(findings::attempt_create(c, &s(0), arg(cmd, a, 1))),
        "failedAttemptUpdate" => out!(findings::attempt_update(c, &s(0), arg(cmd, a, 1))),
        "failedAttemptDelete" => out!(findings::attempt_delete(c, &s(0))),

        "cleanupList" => out!(cleanup::list(c, &s(0))),
        "cleanupCreate" => out!(cleanup::create(c, &s(0), arg(cmd, a, 1))),
        "cleanupUpdate" => out!(cleanup::update(c, &s(0), arg(cmd, a, 1))),
        "cleanupSetRemoved" => out!(cleanup::set_removed(c, &s(0), arg(cmd, a, 1))),
        "cleanupDismiss" => out!(cleanup::dismiss(c, &s(0), &s(1))),
        "cleanupDelete" => out!(cleanup::delete(c, &s(0))),
        "cleanupCounts" => out!(cleanup::counts(c)),

        other => panic!("no store mapping for `{other}`: add it to call() in tests/store_scenarios.rs"),
    }
}

/// Replaces every `"$name"` string with the value bound to `name`.
fn resolve(v: &Value, refs: &HashMap<String, Value>, at: &str) -> Value {
    match v {
        Value::String(s) if s.starts_with('$') => {
            refs.get(&s[1..]).cloned().unwrap_or_else(|| panic!("{at}: `{s}` is not bound by an earlier step"))
        }
        Value::Array(xs) => Value::Array(xs.iter().map(|x| resolve(x, refs, at)).collect()),
        Value::Object(m) => Value::Object(m.iter().map(|(k, x)| (k.clone(), resolve(x, refs, at))).collect()),
        other => other.clone(),
    }
}

/// The scenario match: an expected object names only the fields it checks (a missing field counts as null), arrays
/// must have the same length and match in any order unless `ordered`, and scalars must be equal.
fn matches(expected: &Value, actual: &Value, ordered: bool) -> bool {
    match (expected, actual) {
        (Value::Object(e), Value::Object(a)) => {
            e.iter().all(|(k, ev)| matches(ev, a.get(k).unwrap_or(&Value::Null), false))
        }
        (Value::Array(e), Value::Array(a)) => {
            if e.len() != a.len() {
                return false;
            }
            if ordered {
                return e.iter().zip(a).all(|(x, y)| matches(x, y, false));
            }
            let mut used = vec![false; a.len()];
            assign(e, a, &mut used)
        }
        (Value::Number(e), Value::Number(a)) => e.as_f64() == a.as_f64(),
        (e, a) => e == a,
    }
}

/// Backtracking: every expected row matches a different actual row.
fn assign(e: &[Value], a: &[Value], used: &mut [bool]) -> bool {
    let Some((first, rest)) = e.split_first() else { return true };
    for i in 0..a.len() {
        if !used[i] && matches(first, &a[i], false) {
            used[i] = true;
            if assign(rest, a, used) {
                return true;
            }
            used[i] = false;
        }
    }
    false
}

fn error_json(e: &AppError) -> Value {
    serde_json::to_value(e).expect("serialise error")
}

fn path<'a>(v: &'a Value, dotted: &str) -> Option<&'a Value> {
    dotted.split('.').try_fold(v, |v, k| match v {
        Value::Array(xs) => xs.get(k.parse::<usize>().ok()?),
        _ => v.get(k),
    })
}

fn run(file: &PathBuf) {
    let text = std::fs::read_to_string(file).expect("read scenario");
    let scenario: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: invalid JSON: {e}", file.display()));
    let name = scenario["name"].as_str().unwrap_or_else(|| panic!("{}: no name", file.display())).to_string();
    let steps = scenario["steps"].as_array().unwrap_or_else(|| panic!("{name}: no steps"));
    let c = open();
    let mut refs: HashMap<String, Value> = HashMap::new();
    for (n, step) in steps.iter().enumerate() {
        let cmd = step["do"].as_str().unwrap_or_else(|| panic!("{name}, step {n}: no `do`"));
        let at = format!("{name}, step {n} ({cmd})");
        let args = resolve(&step.get("args").cloned().unwrap_or(Value::Array(vec![])), &refs, &at);
        let args = args.as_array().unwrap_or_else(|| panic!("{at}: `args` must be an array")).clone();
        let result = call(&c, cmd, &args);
        match (step.get("error"), result) {
            (Some(want), Err(e)) => {
                let want = resolve(want, &refs, &at);
                assert!(matches(&want, &error_json(&e), false), "{at}: expected error {want}, got {}", error_json(&e));
            }
            (Some(want), Ok(v)) => panic!("{at}: expected error {want}, got {v}"),
            (None, Err(e)) => panic!("{at}: failed with {}", error_json(&e)),
            (None, Ok(v)) => {
                if let Some(want) = step.get("expect") {
                    let want = resolve(want, &refs, &at);
                    let ordered = step["ordered"].as_bool().unwrap_or(false);
                    assert!(
                        matches(&want, &v, ordered),
                        "{at}: result does not match\nexpected: {}\nactual:   {}",
                        serde_json::to_string_pretty(&want).unwrap(),
                        serde_json::to_string_pretty(&v).unwrap()
                    );
                }
                if let Some(Value::String(as_name)) = step.get("as") {
                    let id = v.get("id").unwrap_or_else(|| panic!("{at}: `as` needs a result with an id"));
                    refs.insert(as_name.clone(), id.clone());
                }
                if let Some(Value::Object(bind)) = step.get("bind") {
                    bind_paths(bind, &v, &mut refs, &at);
                }
            }
        }
    }
}

fn bind_paths(bind: &Map<String, Value>, v: &Value, refs: &mut HashMap<String, Value>, at: &str) {
    for (k, p) in bind {
        let p = p.as_str().unwrap_or_else(|| panic!("{at}: bind paths are strings"));
        let got = path(v, p).unwrap_or_else(|| panic!("{at}: no `{p}` in the result to bind"));
        refs.insert(k.clone(), got.clone());
    }
}

#[test]
fn store_scenarios_pass_on_the_real_store() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/test/storeScenarios");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .map(|e| e.expect("dir entry").path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no store scenarios in {}", dir.display());
    // Every file runs; each failure has already printed its message.
    let failed: Vec<String> = files
        .iter()
        .filter(|f| std::panic::catch_unwind(|| run(f)).is_err())
        .map(|f| f.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert!(failed.is_empty(), "store scenarios failed on the real store: {failed:?}");
}
