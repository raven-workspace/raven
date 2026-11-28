//! Tauri's ACL for Raven's own commands (SR-1, docs/specs/terminal.md §6). With an app manifest, the webview may
//! call a command only if a capability allows it by name, so `capabilities/default.json` lists every one through
//! the sets in `permissions/`. A command missing from these lists can't be called at all; `lib.rs`'s tests check
//! that the lists, the permission sets and `generate_handler!` agree.

/// Every command in `generate_handler!` outside the terminal.
const APP_COMMANDS: &[&str] = &[
    "vault_status", "vault_create", "vault_unlock", "vault_lock", "settings_get", "tun0_address",
    "settings_update", "nvd_lookup", "backup_now", "backups_list", "backup_restore", "backup_restore_locked",
    "field_manual_scan", "field_manual_latest_mtime", "field_manual_save", "field_manual_load", "engagements_list",
    "engagement_get", "engagement_create", "engagement_update", "engagement_set_status", "engagement_delete",
    "engagement_set_msf_host", "engagement_set_timebox_paused", "hosts_list", "host_create", "host_update",
    "host_move", "host_mark_access_reviewed", "host_delete", "host_sync_board", "services_list",
    "services_list_engagement", "services_upsert_scan", "service_create", "service_update", "service_confirm",
    "service_unconfirm", "service_delete", "service_set_verdict", "host_identity_get", "host_identity_set",
    "vectors_list", "vector_upsert", "vector_set_status", "vector_delete", "log_list", "log_create", "log_update",
    "log_delete", "checklist_list", "checklist_put", "checklist_apply_cover", "checklist_apply_facts",
    "checklist_apply_entry_ticks", "notes_get", "notes_list", "note_save", "ruled_out_list", "ruled_out_create",
    "ruled_out_delete", "tunnels_list", "tunnel_create", "tunnel_update", "tunnel_delete", "hops_list",
    "hop_create", "hop_update", "hop_delete", "credentials_list", "credential_create", "same_domains",
    "credential_update", "credential_delete", "credential_crack", "credential_set_crack_status",
    "credential_convert_to_access", "usernames_list", "username_create", "username_delete", "cred_attempts_list",
    "cred_attempts_upsert", "cred_attempt_delete", "cred_attempts_rekey", "payload_builds_list",
    "report_get_or_create", "report_update", "report_export", "report_sections_list", "report_section_upsert",
    "report_section_save", "report_sections_save", "report_sections_reorder", "report_section_delete",
    "payload_build_record", "tried_pairs_list", "tried_pairs_upsert", "tried_pair_delete", "tried_pair_promote",
    "extraction_save", "extraction_file", "extraction_finish", "extraction_get", "extractions_list",
    "extraction_undo", "findings_list", "finding_create", "finding_update", "finding_delete", "finding_files_list",
    "finding_file_create", "finding_file_update", "finding_file_delete", "failed_attempts_list",
    "failed_attempt_create", "failed_attempt_update", "failed_attempt_delete", "access_grants_list",
    "access_grant_create", "access_grant_delete", "attachment_get", "engagements_progress", "cleanup_list",
    "cleanup_create", "cleanup_update", "cleanup_set_removed", "cleanup_dismiss", "interface_dismissals_list",
    "interface_dismiss", "cleanup_delete", "cleanup_counts",
];

/// The terminal's commands (docs/specs/terminal.md §5), registered only with the `terminal` feature. Their
/// permissions exist either way, so the capability needs no feature switch.
const TERMINAL_COMMANDS: &[&str] = &[
    "terminal_spawn", "terminal_list", "terminal_attach", "terminal_write", "terminal_resize", "terminal_close",
];

fn main() {
    println!("cargo:rerun-if-changed=permissions");
    let commands: &'static [&'static str] = Box::leak([APP_COMMANDS, TERMINAL_COMMANDS].concat().into_boxed_slice());
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("tauri build");
}
