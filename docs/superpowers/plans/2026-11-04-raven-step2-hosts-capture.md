# Raven Step 2 (Hosts, Board, Capture, Services) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** inside an engagement the user has:
- hosts, including ones created automatically from single IPs in scope;
- a kanban board of hosts;
- a host view showing services, with confirmed identities;
- `L` capture for every log-entry kind (command, screenshot, HTTP, note, flag proof), with auto-titles and host detection;
- an engagement-wide Log.

It also lands the three step-1 leftovers: damaged-database detection with restore while locked, UI lock on any `locked` error, and best-effort chmod.

**Architecture:**
- **Rust** owns storage. New tables arrive in migration `0002`, with one repository module each (`hosts.rs`, `services.rs`, `log.rs`) plus thin commands in `commands.rs`.
- **Parsing engines** are pure TypeScript under `src/engines/`, ported from the old repo with their tests. They don't touch the DB or the API.
- **Capture** has two halves:
  - a pure draft builder (`src/engines/capture/`);
  - a UI panel and a `saveCapture` orchestrator (`src/features/capture/`) that calls the API.
- **Routing:** an engagement's sections and hosts move into the URL, so the host view has its own route.

**Tech Stack:** as step 1. New Rust crates: `base64 = "0.22"` and `blake2 = "0.10"`. No new npm dependencies; drag and drop uses native HTML5 DnD.

**Spec:** `docs/superpowers/specs/2026-11-03-raven-desktop-design.md`. This plan covers §10 build step 2, plus:
- §5.2 sidebar, board and log;
- §5.3 host view (header, services column and tabs; the stuck view is step 6);
- §6.1 capture;
- §6.2 services.

Field notes and threads, the checklist, auto-tick and the Metasploit lock are step 3. Placeholders stay for them.

**Old repo:** the old app's repo, read-only. Engines are copied from there.

## Global Constraints

- **Everything in step 1's Global Constraints still holds:**
  - local only; macOS only; Ink design; data directories; encryption and backup rules;
  - never open `a file outside the repo`;
  - tests use synthetic data.
- **Ownership boundary.** Every new table hangs off `engagements(id)`, directly or through `hosts`, with `ON DELETE CASCADE`. Deleting an engagement deletes all its data.
- **Migrations.** New schema goes in `src-tauri/migrations/0002_hosts_log.sql`, registered in `migrations/mod.rs` the way `0001` is. Never edit `0001_init.sql`.
- **Spec copy and values** (verbatim):
  - **Board columns:** `Enumerate · Foothold · Privesc · Loot/Pivot · Done`. Stored values: `enumerate`, `foothold`, `privesc`, `loot`, `done`.
  - **Log kinds:** `command`, `screenshot`, `http`, `note`, `flag`.
  - **Flag files:** `local.txt` and `proof.txt`. Stored `flagKind`: `local` or `proof`.
  - **Observations** is the field's user-facing name.
  - **Default machines:** `Kali (VM)`, `Docker build`, `Mac`. A label containing "kali" (case-insensitive, whole word) means the attacker.
- **No silent claims.** Raven fills in suggestions (title, hosts, ran-on, kind, services from nmap, OS from nmap when the host has none). The user sees each in the capture panel before saving. A confirmed service identity is only ever set by the user.
- **Private marker.** Every log entry has `private: boolean`, default `false`. The UI shows a visible marker on private entries.
- **Keys (spec §5.4):**
  - `L` opens capture anywhere inside an engagement;
  - number keys `1`–`6` switch sections;
  - `Esc` closes overlays, then goes back (host view → engagement, engagement → dashboard);
  - `N` is reserved for field notes (step 3), so don't bind it;
  - every new single-key shortcut must check `isFreeKey(e)` from `src/lib/keys.ts`.
- **Engine ports** keep their behaviour and tests. Adapt types only; don't refactor logic. Keep the MIT notice at the top of the command library index (`oscp-notes-2026`).

## Review Focus

1. **A pasted block whose IP is in no host and not in scope** (e.g. the attacker IP `10.10.14.8` in a `nc -lvnp` line). It must not attribute a host or be offered as a new host. Test: `capture draft ignores out-of-scope IPs` (Task 8).
2. **Re-saving an engagement whose scope gained an IP after the user renamed the auto-created host.**
   - The new IP's host is added.
   - The renamed host is untouched, with no duplicate, and nothing is deleted.
   - Test: `scope_sync_is_add_only_and_keeps_renames` (Task 3).
3. **A rescan of a host whose service was confirmed.** The nmap guess updates; the confirmed product and version stay. Test: `scan_upsert_never_touches_confirmed` (Task 4).
4. **Deleting a log entry that proved a service.** The service stays confirmed, and its proving link becomes empty (`ON DELETE SET NULL`). Test: `deleting_proving_entry_keeps_confirmation` (Task 5).
5. **The user edits an auto-title, then edits the hosts of that entry.** The edited title is never regenerated. Test: `edited title survives host change` (Task 12).

---

### Task 1: Step-1 leftovers (best-effort chmod, lock on `locked`)

**Files:**
- Modify: `src-tauri/src/paths.rs` (tightening of existing files becomes best-effort), `src/main.tsx` (QueryClient caches), `src/features/vault/VaultGate.tsx`.
- Create: `src/lib/lockSignal.ts`.
- Test: `src-tauri/src/paths.rs` (tests module), `src/test/vault.test.tsx`.

**Interfaces:**
- Produces:
  - `onLockedError(cb: () => void): () => void` (subscribe; returns unsubscribe);
  - `reportError(err: unknown): void` (fires the callbacks when `RavenError.from(err).code === "locked"`).
  - Both live in `src/lib/lockSignal.ts`.

- [ ] **Step 1: Failing Rust test** `prepare_tolerates_unchmoddable_existing_file`.
  - Simulate an existing file whose permissions can't be changed. Use a path where `set_mode` errors: make the helper injectable, or test the inner `tighten_existing(paths, setter)` with a setter that returns `Err` for one file.
  - Assert that `prepare` returns `Ok`.
  - Creating the root and backups directories must still fail loudly.
- [ ] **Step 2:** In `prepare`, a failure to chmod an **existing** file (`raven.db`, `vault.json`, backup files) is logged with `eprintln!` and skipped. A failure to create or chmod the directories still returns `Err`. Run `cargo test paths` and expect PASS.
- [ ] **Step 3: Failing UI test** `any locked error moves the UI to the unlock screen`.
  - Render the app unlocked.
  - Make `api.engagementsList` reject with `new RavenError("locked", "vault is locked")`.
  - Assert the unlock screen appears.
  - Do the same for a rejected mutation: `api.engagementCreate` rejects `locked` → unlock screen.
- [ ] **Step 4:** Implement it.
  - In `main.tsx`, the `QueryClient` gets `queryCache: new QueryCache({ onError: reportError })` and `mutationCache: new MutationCache({ onError: reportError })`.
  - `VaultGate` subscribes with `onLockedError(markLocked)` while unlocked.
  - The test renders through a helper that builds the same caches. Export `makeQueryClient()` from `src/lib/queryClient.ts` and use it in `main.tsx` and the tests.
- [ ] **Step 5:** Run `npm test`, `npm run typecheck`, `npm run lint` and `cargo test`. All pass.
- [ ] **Step 6: Commit** `fix(core): best-effort chmod of existing files; UI locks on any locked error`.

### Task 2: Damaged database detection and restore while locked (R13)

**Files:**
- Modify:
  - `src-tauri/Cargo.toml` (add `blake2 = "0.10"`);
  - `src-tauri/src/vault.rs` (verifier);
  - `src-tauri/src/error.rs` (new `Damaged`);
  - `src-tauri/src/backup.rs` (`restore_locked`; `list` must not need an unlocked vault);
  - `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (register);
  - `src/types/errors.ts`, `src/lib/api.ts`, `src/features/vault/UnlockScreen.tsx`.
- Test: `vault.rs` and `backup.rs` test modules, `src/test/vault.test.tsx`.

**Interfaces:**
- Produces:
  - **Rust:**
    - `AppError::Damaged` with code `"damaged"` and message `"the database file is damaged"`;
    - `VaultMeta.verifier: Option<String>` (`#[serde(default, skip_serializing_if = "Option::is_none")]`);
    - `backup::restore_locked(vault: &mut Vault, file: &str, password: &str) -> AppResult<()>`;
    - command `backup_restore_locked(file: String, password: String) -> ()`;
    - `backups_list` works while locked.
  - **TS:**
    - `ErrorCode` gains `"damaged"`;
    - `api.backupRestoreLocked(file: string, password: string): Promise<null>`.

**Verifier:** lowercase hex of `Blake2bMac<U32>` keyed with the 32-byte DB key, over the message `b"raven vault verifier v1"`.
- `create` writes it.
- `unlock`, after a successful open of a vault whose meta lacks it, adds it. It writes atomically through the existing tmp-then-rename helper. A failure to write is not an unlock failure.

**Unlock decision:**

| Verifier present? | Derived key | DB open/read | Result |
|---|---|---|---|
| yes | doesn't match | (not tried) | `WrongPassword` (DB never opened) |
| yes | matches | `NotADatabase`, or any other failure while reading `sqlite_master` | `Damaged` |
| no (old vault) | — | `NotADatabase` | `WrongPassword` (today's behaviour) |

**`restore_locked`:**
1. Validate the file name as `restore_at` does.
2. Read the backup's companion `<file>.vault.json`. Without one, use the live `vault.json`.
3. Derive the key with the password. A verifier mismatch, or the backup not opening, gives `Validation{field:"password", message:"Wrong password for this backup"}`.
4. Stage the copy and open it to verify.
5. Rename the live `raven.db` to `raven.db.damaged-<ms>`. Don't delete it.
6. Move the staged file into place, copy the companion meta over `vault.json` (atomically), and remove stale journals.
7. Leave the vault locked.

No pre-restore backup is taken: the live DB is unreadable, and the `.damaged` copy is kept instead.

- [ ] **Step 1: Failing tests:**
  - `unlock_wrong_password_with_verifier_never_opens_db`;
  - `unlock_corrupt_db_with_verifier_is_damaged` (overwrite the first 4096 bytes of `raven.db` with zeros after create+lock);
  - `old_vault_gains_verifier_on_unlock`;
  - `restore_locked_replaces_damaged_db_and_keeps_damaged_copy`;
  - `restore_locked_wrong_password_changes_nothing`;
  - `backups_list_works_while_locked`.
- [ ] **Step 2:** Implement until `cargo test` passes.
- [ ] **Step 3: Failing UI tests:**
  - `damaged vault offers restore from backup`. Unlock rejects `damaged`, and the screen shows "Raven can't read its database file. Restore a backup to continue." with the backup list from `api.backupsList` (newest first, showing date and reason). Picking one and entering the password calls `api.backupRestoreLocked(file, password)`.
  - On success, the screen shows "Restored. Unlock to continue." with the password field cleared.
  - `restore while locked shows wrong password inline`.
- [ ] **Step 4:** Implement in `UnlockScreen.tsx`. Keep the existing unlock form; the damaged panel replaces it while active. Run `npm test`, `npm run typecheck`, `npm run lint` and `cargo test`. All pass.
- [ ] **Step 5: Commit** `feat(vault): detect a damaged database and restore a backup while locked`.

### Task 3: Schema 0002, hosts, scope-to-hosts, machines setting

**Files:**
- Create: `src-tauri/migrations/0002_hosts_log.sql`, `src-tauri/src/hosts.rs`.
- Modify:
  - `src-tauri/src/migrations/mod.rs`;
  - `src-tauri/src/engagements.rs` (scope sync in create/update; `last_ran_on`);
  - `src-tauri/src/settings.rs` (machines);
  - `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`.
- Test: test modules in `hosts.rs`, `engagements.rs`, `settings.rs`, `migrations/mod.rs`.

**Schema (the whole of 0002):**
- `hosts`:
  - `id TEXT PK`, `engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `ip TEXT`;
  - `os TEXT CHECK (os IN ('windows','linux','other'))`;
  - `board_column TEXT NOT NULL DEFAULT 'enumerate' CHECK (board_column IN ('enumerate','foothold','privesc','loot','done'))`;
  - `board_manual INTEGER NOT NULL DEFAULT 0`;
  - `access TEXT NOT NULL DEFAULT 'none' CHECK (access IN ('none','user','root'))`;
  - `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`;
  - `UNIQUE (engagement_id, ip)`.
- `services`:
  - `id TEXT PK`, `host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE`, `port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535)`;
  - `protocol TEXT NOT NULL DEFAULT 'tcp' CHECK (protocol IN ('tcp','udp'))`, `state TEXT NOT NULL DEFAULT 'open'`;
  - `nmap_service TEXT`, `nmap_version TEXT`, `confirmed_product TEXT`, `confirmed_version TEXT`;
  - `confirmed_entry_id TEXT REFERENCES log_entries(id) ON DELETE SET NULL`;
  - `created_at`, `updated_at`;
  - `UNIQUE (host_id, port, protocol)`.
- `log_entries`:
  - `id TEXT PK`, `engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE`;
  - `kind TEXT NOT NULL CHECK (kind IN ('command','screenshot','http','note','flag'))`;
  - `title TEXT NOT NULL`, `title_edited INTEGER NOT NULL DEFAULT 0`, `ran_on TEXT`, `observations TEXT`;
  - `returned_nothing INTEGER NOT NULL DEFAULT 0`, `private INTEGER NOT NULL DEFAULT 0`, `content TEXT NOT NULL` (JSON);
  - `at INTEGER NOT NULL`, `created_at`, `updated_at`;
  - index `(engagement_id, at)`.
- `log_entry_hosts`: `entry_id REFERENCES log_entries(id) ON DELETE CASCADE`, `host_id REFERENCES hosts(id) ON DELETE CASCADE`, `PRIMARY KEY (entry_id, host_id)`.
- `attachments`: `id TEXT PK`, `engagement_id … ON DELETE CASCADE`, `entry_id TEXT REFERENCES log_entries(id) ON DELETE CASCADE`, `mime TEXT NOT NULL`, `bytes BLOB NOT NULL`, `size INTEGER NOT NULL`, `created_at`.
- `ALTER TABLE engagements ADD COLUMN last_ran_on TEXT`.

**Interfaces:**
- Produces:
  - **Types:**
    - `Host { id, engagement_id, name, ip: Option<String>, os: Option<String>, board_column: String, board_manual: bool, access: String, created_at, updated_at }`, serialised camelCase;
    - `HostInput { name: String, #[serde(default)] ip: Option<String>, #[serde(default)] os: Option<String>, #[serde(default)] access: Option<String> }`.
  - **Repository functions in `hosts.rs`:**
    - `list(conn, engagement_id) -> Vec<Host>`, ordered by IP numerically, then name;
    - `get(conn, id)`;
    - `create(conn, engagement_id, HostInput) -> Host`;
    - `update(conn, id, HostInput) -> Host`;
    - `move_to(conn, id, column: &str) -> Host` (sets `board_manual = 1`);
    - `delete(conn, id)`;
    - `sync_scope(conn, engagement_id, scope: &[String]) -> AppResult<usize>` (count added).
  - **Engagements:** `Engagement` gains `last_ran_on: Option<String>`. `engagements::set_last_ran_on(conn, id, value)` is used by Task 5.
  - **Settings:** `Settings` gains `machines: Vec<String>` (key `machines`, JSON array). The default is `["Kali (VM)","Docker build","Mac"]`. Validation: 1–20 entries, each trimmed to 1–40 characters, duplicates removed (case-insensitive).
  - **Commands:**
    - `hosts_list(engagementId)`, `host_create(engagementId, input)`, `host_update(id, input)`, `host_move(id, column)`, `host_delete(id)`;
    - TS mirrors these in `src/types/host.ts` and `src/lib/api.ts` (`hostsList`, `hostCreate`, `hostUpdate`, `hostMove`, `hostDelete`);
    - `Settings` and `Engagement` TS types gain `machines` and `lastRanOn`.

**Validation:**
- `name` is trimmed; when empty it falls back to `ip`; when both are empty → `Validation{field:"name"}`. Name is at most 80 characters.
- `ip` must be a single IPv4: `valid_cidr` without a `/`, or with `/32`, stored without `/32`.
- A duplicate IP in the engagement → `Validation{field:"ip", message:"A host with this IP already exists"}`.
- `os` is in the set or null; `access` is in the set (default `none`).

**`sync_scope`:**
- For every scope entry that is a single IP (no `/`, or `/32`) with no host in the engagement holding that IP, insert a host with `name = ip`.
- It never deletes or renames anything.
- `engagements::create` and `update` call it inside the same transaction as the engagement write.

- [ ] **Step 1: Failing tests:**
  - `migration_0002_applies_on_a_v1_db`;
  - `host_create_validates_ip_and_duplicates`;
  - `host_name_falls_back_to_ip`;
  - `move_sets_manual`;
  - `deleting_engagement_cascades_hosts`;
  - `scope_sync_adds_single_ips_only` (`10.0.0.0/24` makes nothing; `10.0.0.5` and `10.0.0.6/32` make two);
  - `scope_sync_is_add_only_and_keeps_renames`;
  - `machines_setting_default_and_validation`.
- [ ] **Step 2:** Implement until `cargo test` passes. Update the TS types and api, and fix the existing TS test fixtures for the new fields. Run `npm test` and `npm run typecheck`.
- [ ] **Step 3: Commit** `feat(core): hosts table, scope IPs become hosts, machines setting`.

### Task 4: Services repository

**Files:**
- Create: `src-tauri/src/services.rs`.
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`; create `src/types/service.ts`; modify `src/lib/api.ts`.
- Test: `services.rs` tests module.

**Interfaces:**
- Produces:
  - **Types:**
    - `Service { id, host_id, port: i64, protocol, state, nmap_service, nmap_version, confirmed_product, confirmed_version, confirmed_entry_id, created_at, updated_at }`, camelCase;
    - `ScanPort { port: i64, protocol: String, state: String, service: String, version: String }`;
    - `ServiceInput { port, #[serde(default)] protocol: Option<String>, #[serde(default)] nmap_service, #[serde(default)] nmap_version }`;
    - `ConfirmInput { product: String, #[serde(default)] version: Option<String>, #[serde(default)] entry_id: Option<String> }`.
  - **Functions:**
    - `list(conn, host_id) -> Vec<Service>`, ordered by protocol then port;
    - `upsert_scan(conn, host_id, ports: &[ScanPort]) -> Vec<Service>` (returns the host's full list). It inserts new `(port, protocol)` rows and updates `state`, `nmap_service` and `nmap_version` on existing ones, never touching `confirmed_*`. Empty strings are stored as NULL.
    - `create(conn, host_id, ServiceInput)` (duplicate → `Validation{field:"port", message:"That port is already listed"}`), `update(conn, id, ServiceInput)`;
    - `confirm(conn, id, ConfirmInput) -> Service`: product 1–80 characters, trimmed. `entry_id`, when given, must be a log entry in the same engagement, else `Validation{field:"entryId"}`. Until Task 5 lands, the FK target table exists from Task 3, so tests insert a row directly.
    - `unconfirm(conn, id) -> Service` (clears all three `confirmed_*`);
    - `delete(conn, id)`.
  - **Commands:** `services_list(hostId)`, `services_upsert_scan(hostId, ports)`, `service_create(hostId, input)`, `service_update(id, input)`, `service_confirm(id, input)`, `service_unconfirm(id)`, `service_delete(id)`. They're mirrored in TS (`servicesList`, `servicesUpsertScan`, …).

- [ ] **Step 1: Failing tests:**
  - `upsert_scan_inserts_and_updates`;
  - `scan_upsert_never_touches_confirmed`;
  - `confirm_validates_entry_belongs_to_engagement`;
  - `unconfirm_clears`;
  - `create_rejects_duplicate_port`;
  - `deleting_host_cascades_services`.
- [ ] **Step 2:** Implement. Run `cargo test`, `npm run typecheck`.
- [ ] **Step 3: Commit** `feat(core): services with nmap guesses and user confirmation`.

### Task 5: Log entries, attachments, engagement progress

**Files:**
- Create: `src-tauri/src/log.rs`, `src/types/log.ts`.
- Modify: `src-tauri/Cargo.toml` (`base64 = "0.22"`), `commands.rs`, `lib.rs`, `engagements.rs` (progress), `src/lib/api.ts`.
- Test: `log.rs` tests module.

**Interfaces:**
- Produces:
  - **Content** (stored as JSON in `content`; `kind` column = tag):
    ```rust
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    enum LogContent {
        Command { blocks: Vec<CommandBlock> },            // CommandBlock { command, output, #[serde(default)] shell: Option<String> }
        Screenshot { attachment_id: String, caption: String, file_name: String },
        Http { request: String, #[serde(default)] response: Option<String> },
        Note { text: String },
        Flag { flag_kind: String, value: String, #[serde(default)] attachment_id: Option<String> },
    }
    ```
  - **Types:**
    - `LogEntry { id, engagement_id, kind, title, title_edited, ran_on, host_ids: Vec<String>, observations, returned_nothing, private, content: LogContent, at, created_at, updated_at }`;
    - `NewAttachment { mime: String, data_base64: String }`;
    - `LogEntryInput { title, #[serde(default)] title_edited: bool, ran_on, host_ids, observations, returned_nothing, private, content, #[serde(default)] at: Option<i64>, #[serde(default)] attachment: Option<NewAttachment> }`.
  - **Functions:**
    - `list(conn, engagement_id) -> Vec<LogEntry>` (newest `at` first);
    - `create(conn, engagement_id, LogEntryInput) -> LogEntry`;
    - `update(conn, id, LogEntryInput) -> LogEntry`. `attachment` is ignored, and content `kind` must not change → `Validation{field:"content"}`.
    - `delete(conn, id)`;
    - `attachment_get(conn, id) -> Attachment { id, mime, data_base64 }`.
  - **`engagements::progress_all(conn) -> HashMap<String, Progress>`,** where `Progress { hosts_total, hosts_rooted, flags_found, flags_total }`:
    - `hosts_total` = host count;
    - `hosts_rooted` = hosts linked to a `flag` entry with `flagKind = "proof"`;
    - `flags_found` = distinct `(host, flagKind)` pairs over flag entries;
    - `flags_total` = `2 × hosts_total`.
  - **Commands:** `log_list(engagementId)`, `log_create(engagementId, input)`, `log_update(id, input)`, `log_delete(id)`, `attachment_get(id)`, `engagements_progress()`. TS mirrors: `logList`, `logCreate`, `logUpdate`, `logDelete`, `attachmentGet`, `engagementsProgress` (returns `Record<string, Progress>`). `src/types/log.ts` has a discriminated-union `LogContent` matching the Rust tags.

**Rules for create:**
- One transaction.
- `title` is trimmed and 1–300 characters.
- Every `host_id` belongs to the engagement, else `Validation{field:"hostIds"}`.
- **Content checks:**
  - command: at least 1 block, each command non-empty;
  - note: text non-empty;
  - http: request non-empty;
  - flag: `flagKind` in `local|proof`.
- **Attachments:**
  - Screenshot requires `attachment`; flag allows one.
  - The mime must be in `image/png|image/jpeg|image/webp|image/gif`, and the decoded size at most 25 MiB, else `Validation{field:"attachment"}`.
  - The attachment row is inserted with the entry, and its id is written into the content's `attachmentId` (any client value is overwritten).
- `at` defaults to now.
- Sets `engagements.last_activity_at = at` and, when `ran_on` is `Some`, `engagements.last_ran_on`.
- Deleting an entry cascades attachments and host links. Services that it proved keep their confirmation, with `confirmed_entry_id` set to NULL.

- [ ] **Step 1: Failing tests:**
  - `create_command_entry_links_hosts_and_bumps_activity`;
  - `create_rejects_foreign_host`;
  - `screenshot_requires_attachment_and_stores_bytes`;
  - `attachment_too_large_rejected`;
  - `update_cannot_change_kind`;
  - `deleting_proving_entry_keeps_confirmation`;
  - `progress_counts_rooted_and_flags`;
  - `content_json_round_trips_each_kind`.
- [ ] **Step 2:** Implement. Run `cargo test`, `npm run typecheck`.
- [ ] **Step 3: Commit** `feat(core): log entries of every kind, attachments, engagement progress`.

### Task 6: Port the parsing engines

**Files:**
- Copy from the old app's repo into `src/engines/parse/`:
  - `src/utils/logPasteParser.ts` → `logPaste.ts`;
  - `src/utils/engagementScope.ts` → `scope.ts`;
  - `src/utils/scanParserUtils.ts` → `scan.ts`;
  - `src/utils/commandOutputParser.ts` → `commandOutput.ts`.
- Tests: port `src/test/utils/logPasteParser.test.ts`, `src/test/utils/engagementScope.test.ts`, `src/utils/scanParserUtils.test.ts` and `src/utils/commandOutputParser.test.ts` to `src/test/engines/parse/*.test.ts`.

**Interfaces:**
- Produces (same names as the old repo):
  - `splitPaste(text): CommandBlock[]`, `detectPrompt(line)`;
  - `extractIps(text): string[]`, `ipInScope(ip, scope): boolean`, `parseScopeList(text)`;
  - `detectAndParseScan(raw): ScanImportResult | null`, `parseMultiHostScan(raw): ParsedMultiHost[]`;
  - `analyzeCommandOutput(text): CommandOutputAnalysis`, `normalizeOsName(raw): HostOs | null`.
- `CommandBlock = { command: string; output: string; shell?: string }` lives in `src/types/log.ts` (Task 5 created it), shared with the Rust `CommandBlock`.
- `HostOs = "windows" | "linux" | "other"` is exported from `src/types/host.ts`. `normalizeOsName` maps the old Windows to `windows`, Linux to `linux`, and anything else recognised to `other`.

- [ ] **Step 1:** Copy the files and their tests. Adapt only imports and types. Drop the old `getServiceIntelligence` and its `suggestedTools`/`cveNotes` fields only if they pull in data files not ported. Otherwise keep them.
- [ ] **Step 2:** Run `npx vitest run src/test/engines/parse`. Every ported test passes. A test that only exercised a removed old-app concept is deleted, and the report lists each one with the reason.
- [ ] **Step 3:** Run `npm run typecheck`, `npm run lint`. Clean.
- [ ] **Step 4: Commit** `feat(engines): port paste, scope, scan and command-output parsers`.

### Task 7: Port the command library, matcher and host attribution

**Files:**
- Copy:
  - `src/types/commandLibrary.ts` → `src/engines/library/types.ts`;
  - `src/data/commandLibrary/*` → `src/engines/library/data/*` (keep the MIT header in `index.ts`);
  - `src/utils/checklist/matcher.ts` → `src/engines/library/matcher.ts`.
- Create: `src/engines/attribution.ts`.
- Tests: port `src/test/checklist/matcher.test.ts` and `src/test/checklist/commandLibrary.test.ts` to `src/test/engines/library/`. Create `src/test/engines/attribution.test.ts`, porting the attribution cases from the old `src/test/checklist/autoTick.test.ts` (the `namedHostsInLine`/`shellHost` and HOST_IP cases, including "UNC-style //IP attributes the host").

**Interfaces:**
- Produces:
  - `BUILTIN_LIBRARY: LibraryCommand[]`;
  - `matchLine(line, library): LibraryCommand[]`, `firstBinary(line)`, `firstSegment(line)`;
  - in `attribution.ts`:
    - `type HostRef = { id: string; name: string; ip: string | null }`;
    - `HOST_IP` (the regex, verbatim from old `autoTick.ts:41`);
    - `ipsIn(text): Set<string>`;
    - `hostsNamedIn(text, hosts: HostRef[], domain: string): HostRef[]`;
    - `namedHostsInLine(line, hosts, domain): HostRef[]`;
    - `shellHost(shell, ranOn, hosts, domain): HostRef | null`;
    - `isKaliLabel(label): boolean`.
  - Logic is copied verbatim from old `autoTick.ts` lines 1–105, minus `extraIps`.
- Library entries keep their `goals` (checklist goal ids) as plain strings. Any test assertion that needs checklist data (`HOST_GOALS`, `ENGAGEMENT_SETUP`) is removed here, listed in the report, and comes back in step 3.

- [ ] **Step 1:** Copy and adapt. Every `matchExamples` hit/miss assertion still runs.
- [ ] **Step 2:** Run `npx vitest run src/test/engines`, `npm run typecheck`, `npm run lint`. All pass.
- [ ] **Step 3: Commit** `feat(engines): port command library, matcher and host attribution`.

### Task 8: Capture draft engine

**Files:**
- Create: `src/engines/capture/{kind.ts,titles.ts,draft.ts,http.ts,screenshot.ts,index.ts}`.
- Test: `src/test/engines/capture/*.test.ts`.

**Interfaces:**
- Consumes: Tasks 6 and 7, and the types from Tasks 3 and 5.
- Produces:
  - `detectKind(text: string, hasImage: boolean): LogKind`.
    - image → `screenshot`;
    - first non-empty line matches `^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S+ HTTP/\d` → `http`;
    - trimmed text matches `^[0-9a-f]{32}$`i → `flag`;
    - any line where `detectPrompt` matches, or `firstBinary(first line)` is a `bins` entry of any `BUILTIN_LIBRARY` matcher → `command`;
    - else `note`.
  - `commandTitle(blocks: CommandBlock[], hosts: HostRef[], domain: string): string`.
    - Takes the first block's command.
    - If `matchLine` returns a match, the title is `${match.title} · ${target}`. The target is the first host from `namedHostsInLine` (its IP, else its name), else the first `HOST_IP` token in the line. Without a target, the title is just `match.title`.
    - Otherwise the title is the full first command line, whitespace collapsed, capped at 200 characters.
  - `httpParts(text): { request: string; response: string | null; method: string; host: string | null; port: number | null; path: string }`. The response starts at the first line matching `^HTTP/\d(\.\d)? \d{3}` after the request.
  - `httpTitle(parts, attributed: HostRef | null): string`.
    - Format: `${method} ${hostShown}${path}`.
    - `hostShown` is `:${port}` (or empty when there's no port) when the Host header's host equals the attributed host's IP or name. Otherwise it's `host[:port]`.
    - Example: `GET :81/`.
  - `noteTitle(text): string`: first non-empty line, leading `#`s and spaces stripped, capped at 120 characters.
  - `flagTitle(flagKind, host: HostRef | null): string`: `local.txt · srv11`, or `local.txt` without a host.
  - `screenshotFileName(input: { ip: string | null; hostName: string | null; column: BoardColumn | null; caption: string; mime: string }): string`.
    - Format: `${ip ?? hostName ?? "engagement"}_${stage}_${topic}.${ext}`.
    - `stage` from the column: enumerate→`enum`, foothold→`foothold`, privesc→`privesc`, loot→`loot`, done→`done`, null→`enum`.
    - `topic`: a caption `:(\d+)` or `port\s*(\d+)` gives `port<n>`. Otherwise the first 3 words of the caption, lowercased, `[a-z0-9]+` joined with `-`. Otherwise `shot`.
    - `ext` from the mime: png, jpg, webp or gif.
    - Example: `10.10.61.143_enum_port81.png`.
  - **`buildDraft(input: { text: string; image: { mime: string } | null; kind?: LogKind; hosts: (HostRef & { column: BoardColumn })[]; scope: string[]; domain: string; machines: string[]; lastRanOn: string | null }): CaptureDraft`.**
    - `CaptureDraft = { kind; title; hostIds: string[]; ranOn: string; content: LogContent (attachmentId "" for screenshot/flag); unknownScopeIps: string[]; scan: { hostId: string; ports: ScanPort[]; os: HostOs | null } | null }`.
    - **Hosts:**
      - For a command, per block: `shellHost(block.shell, undefined, …)` if non-null, else `namedHostsInLine(block.command, …)`. Take the union, in first-seen order.
      - For other kinds: `hostsNamedIn(text)`.
    - **ranOn:**
      - a block's shell resolves to a host → that host's name;
      - a shell or prompt user is a Kali label → the first machine with `isKaliLabel`;
      - else `lastRanOn ?? machines[0]`.
    - **unknownScopeIps:** `HOST_IP` tokens in command lines (or the text, for non-commands) that pass `ipInScope` and aren't any host's IP, unique.
    - **scan:** set only when `analyzeCommandOutput` over the outputs finds a scan with `format !== "raw-ports"` and exactly one host is attributed. It holds that host's ports (`ScanPort` shape) and the detected OS.

- [ ] **Step 1: Failing tests,** using spec examples:
  - `nmap -p- full scan gets library title with target IP` → `"Scan every TCP port · 10.10.61.143"` (the library title verbatim);
  - `unmatched command keeps the full first line` (`./exploit.py --target 10.10.61.143 --lport 4444` stays whole);
  - `prompt shell attributes target host and ranOn`: `srv11@srv11:~$ id`, with a host named `srv11`, gives host srv11 and ranOn `srv11`;
  - `prompt naming no host falls back to the command line`: `*Evil-WinRM* PS C:\Users\x> whoami` with `lastRanOn: "Kali (VM)"` gives no host and ranOn `Kali (VM)`;
  - `kali prompt sets ranOn to the kali machine`;
  - `capture draft ignores out-of-scope IPs`;
  - `unknown in-scope IP is offered`;
  - `http title GET :81/`;
  - `screenshot file name 10.10.61.143_enum_port81`;
  - `32-hex paste is a flag`;
  - `note title strips heading marks`;
  - `scan output yields services for the single attributed host`.
- [ ] **Step 2:** Implement until the tests pass. Run `npm run typecheck`, `npm run lint`.
- [ ] **Step 3: Commit** `feat(capture): draft engine with kind detection, auto-titles and host detection`.

### Task 9: Engagement routing, hosts sidebar, host dialog, progress

**Files:**
- Modify:
  - `src/App.tsx` (routes);
  - `src/features/engagements/EngagementShell.tsx` (becomes a layout with `<Outlet/>`; split into files);
  - `ActiveCard.tsx` and `format.ts` (progress from `engagementsProgress`).
- Create:
  - `src/features/engagements/Sidebar.tsx`, `EngagementHeader.tsx`, `StatusStrip.tsx`, `sections.tsx`;
  - `src/features/hosts/{HostDialog.tsx,queries.ts,HostGlyph.tsx}`.
- Test: `src/test/hosts.test.tsx`, updates to `src/test/dashboard.test.tsx`.

**Interfaces:**
- Produces:
  - **Routes:**
    - `e/:id` → Board (index);
    - `e/:id/s/:section` (`log|credentials|findings|checklist|report`);
    - `e/:id/h/:hostId` → host view (Task 13 fills it; this task renders a placeholder).
    - Number keys navigate between the section routes.
  - **Query hooks in `src/features/hosts/queries.ts`:**
    - `useHosts(engagementId)` (key `["hosts", engagementId]`);
    - `useHostMutations(engagementId)` returning `{ create, update, move, remove }`. Each invalidates `["hosts", id]` and `["progress"]`.
    - `useProgress()` (key `["progress"]`).
  - `HostGlyph({ column })`: a small glyph per column (`○` enumerate, `◔` foothold, `◑` privesc, `◕` loot, `●` done), `aria-label` = the column name.
  - `HostDialog({ open, onOpenChange, engagementId, host? })`: create/edit with name, IP, OS (Select: Unknown/Windows/Linux/Other) and access (Select: None/User/Root). It shows field errors from `RavenError.field`.
  - `COLUMN_LABELS: Record<BoardColumn,string>` = `{enumerate:"Enumerate",foothold:"Foothold",privesc:"Privesc",loot:"Loot/Pivot",done:"Done"}` in `src/features/hosts/columns.ts`.

**Sidebar:** under Hosts, each host shows its glyph, name and IP (mono, faint), sorted as returned. Clicking goes to `e/:id/h/:hostId`; the current host is marked like the current section. A `+ Add host` row opens HostDialog. Empty state: "No hosts yet".

**Progress:** StatusStrip and ActiveCard show `Rooted {hostsRooted}/{hostsTotal} · flags {flagsFound}/{flagsTotal}` from `useProgress()`.

**Engagement edits:** `EngagementDialog` save also invalidates `["hosts", id]`, because the scope may add hosts.

- [ ] **Step 1: Failing tests:**
  - `sidebar lists hosts and opens host route`;
  - `add host dialog creates and shows field error for duplicate ip`;
  - `number keys navigate section routes`;
  - `status strip shows progress from api`;
  - `saving engagement scope refreshes hosts`.
- [ ] **Step 2:** Implement. Keep each new file under ~200 lines. Run `npm test`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 3: Commit** `feat(app): engagement routes, hosts sidebar, host dialog, live progress`.

### Task 10: Board

**Files:**
- Create: `src/features/board/{Board.tsx,BoardCard.tsx}`.
- Modify: `src/features/engagements/sections.tsx` (Board is the index route).
- Test: `src/test/board.test.tsx`.

**Interfaces:**
- Consumes: `useHosts`, `useHostMutations().move`, `COLUMN_LABELS`.

**Behaviour:**
- **Layout:** five columns in spec order, each with a tracked uppercase label and a count.
- **Cards:** host name; IP in small mono text; an OS chip (`Windows`/`Linux`/`Other`, none when unknown); an access chip only when access ≠ none (accent variant).
- **Clicking a card** opens the host view.
- **Moving a card:**
  - drag (HTML5 `draggable`, `dataTransfer` carries the host id, columns are drop targets with a hairline accent outline while hovered) calls `move(hostId, column)`;
  - **keyboard:** with a card focused, `[` moves it one column left and `]` one right, and focus stays on the card.
- **No hosts:** `EmptyState` titled "No hosts yet" with the body "Hosts are added from single IPs in the scope, from capture, or by hand." and an "Add host" button.

- [ ] **Step 1: Failing tests:**
  - `cards sit in their column with ip and os chip`;
  - `drop on another column calls move`;
  - `bracket keys move the focused card`;
  - `empty board offers add host`.
- [ ] **Step 2:** Implement. Run `npm test`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 3: Commit** `feat(board): host kanban with drag and keyboard moves`.

### Task 11: Capture panel (`L`) and save orchestration

**Files:**
- Create:
  - `src/features/capture/CapturePanel.tsx`;
  - `src/features/capture/useCaptureStore.ts` (zustand: open state, the unsaved draft per engagement, the element to refocus);
  - `src/features/capture/saveCapture.ts`;
  - `src/features/capture/imagePaste.ts` (reads an image from a `ClipboardEvent` → `{ mime, dataBase64, objectUrl }`).
- Modify: the engagement layout, to mount `CapturePanel` and bind `L`.
- Test: `src/test/capture.test.tsx`, `src/test/saveCapture.test.ts`.

**Interfaces:**
- Consumes: `buildDraft` and friends (Task 8), `api.logCreate`, `api.servicesUpsertScan`, `api.hostCreate`, `api.hostUpdate`, settings `machines`, engagement `lastRanOn`/`scopeCidrs`/`domain`.
- Produces: `saveCapture(args: { engagementId: string; draft: CaptureDraft; edits: CaptureEdits; addIps: string[]; image: { mime; dataBase64 } | null; hosts: Host[] }): Promise<LogEntry>`. Order of calls:
  1. Create a host for each IP in `addIps` (name = IP), adding its id to `hostIds`.
  2. `logCreate`.
  3. If `draft.scan` is set and its host is still linked, call `servicesUpsertScan`, then `hostUpdate` with the OS when the host has none and the scan found one.
  4. Return the entry.

  If a step after `logCreate` fails, the entry stays saved and the panel shows "Saved, but services didn't update: <message>".

**Panel behaviour:**
- **Opening:** `L` (a free key, inside any engagement route) opens a right-side panel over the screen. It's a `Dialog` sized `lg` or a custom sheet in Ink style. Focus starts in the paste area.
- **Unsaved drafts:** reopening restores the engagement's unsaved draft. `Esc` closes the panel and keeps the draft. A "Discard" button clears it.
- **Paste area:**
  - text paste → `buildDraft`;
  - image paste → screenshot kind with a preview;
  - the detected kind shows as a row of five kind chips (`⌘1`–`⌘5` switch; the active chip is in the accent colour), and switching re-runs `buildDraft` with `kind`.
- **Fields, all editable:**
  - **Title:** typing sets `titleEdited`; later redrafts never overwrite an edited title.
  - **Hosts:** chips with ×, plus a host picker. Unknown in-scope IPs show as `+ 10.x.x.x` chips; clicking one adds it to `addIps`.
  - **Ran on:** a Select of machines plus host names.
  - **Observations:** a textarea.
  - **Kind-specific:** caption for screenshots, showing the generated file name in mono below it; local/proof toggle and value for flags, defaulting to `proof` when the host's column is `privesc` or later, else `local`; note text for notes.
- **Toggles:**
  - "Returned nothing" (`⌘.`), shown for command kind;
  - "Private" (`⌘P`, `preventDefault`), which shows a marker on the panel;
  - "Services" line: when `draft.scan` is set it shows `Updates services on <host>: 22, 80, 3003`.
- **Saving:**
  - `Enter` saves from the title, the paste area of a non-note kind, and observations.
  - `Shift+Enter` inserts a newline.
  - In a note's text, `Enter` is a newline and `⌘Enter` saves.
  - `⌘Enter` saves everywhere.
- **After saving:** close, clear the draft, invalidate `["log", id]`, `["hosts", id]`, `["services"]`, `["progress"]` and `["engagement", id]`, and return focus to the element focused before `L`.

- [ ] **Step 1: Failing tests:**
  - **saveCapture:** `saveCapture creates new hosts before the entry`, `saveCapture upserts services and fills os`, `services failure still keeps the entry`;
  - **panel:**
    - `L opens capture with focus in paste area`;
    - `pasting nmap output fills title, host and services line`;
    - `Enter saves and focus returns`;
    - `edited title is kept when kind changes`;
    - `Esc keeps the draft for next open`;
    - `L is ignored while typing in an input`;
    - `image paste becomes a screenshot with generated file name`.
- [ ] **Step 2:** Implement. Run `npm test`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 3: Commit** `feat(capture): L capture panel for every kind with save orchestration`.

### Task 12: Log section and entry view/edit

**Files:**
- Create: `src/features/log/{LogSection.tsx,LogEntryRow.tsx,LogEntryBody.tsx,EditEntryDialog.tsx,queries.ts,AttachmentImage.tsx}`.
- Modify: `sections.tsx` (the `log` route).
- Test: `src/test/log.test.tsx`.

**Interfaces:**
- Produces:
  - `useLog(engagementId)` (key `["log", id]`), `useLogMutations(engagementId)` → `{ update, remove }`;
  - `LogEntryRow({ entry, hosts, defaultOpen? })` and `LogEntryBody({ entry })`, reused by the host view's Story tab (Task 13);
  - `AttachmentImage({ id, alt })`: loads `api.attachmentGet` (query key `["attachment", id]`, `staleTime: Infinity`) into a `data:` URL.

**Behaviour:**
- **Filters:** a filter bar with Host (All / each host / No host), Kind (All / five kinds) and Ran on (All / values seen).
- **List:** newest first.
- **Row:** time `HH:MM` in mono with the date on hover (title attribute), a kind label, the title, host chips, a `private` chip when private, and `returned nothing` in faint text when set.
- **Expanding a row** (click or Enter) shows the body:
  - **command:** each block as `$ command` (mono, fg) over the output in a `pre` with a max height of 320px and its own scroll. Output over 40 lines starts folded with "Show all N lines".
  - **http:** the request; the response folded by default.
  - **note:** pre-wrap text.
  - **screenshot:** the image, caption and file name.
  - **flag:** kind, value (mono) and an optional image.
  - Observations sit under a small "Observations" label.
- **Edit** opens `EditEntryDialog`: title (changing it sets `titleEdited: true`), hosts, ran on, observations, private, returned nothing, and note text for notes. It sends the full `LogEntryInput` with the existing content.
- **Delete** asks for confirmation ("Delete this entry? Its screenshot goes with it.").
- **Empty:** "Nothing logged yet. Press L to capture."

- [ ] **Step 1: Failing tests:**
  - `log lists newest first with filters`;
  - `expanding a command entry shows blocks and observations`;
  - `edited title survives host change` (after editing the title, then editing hosts only, `logUpdate` receives the user's title and `titleEdited: true`);
  - `private entry shows marker`;
  - `delete asks first`.
- [ ] **Step 2:** Implement. Run `npm test`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 3: Commit** `feat(log): engagement log with filters, entry view and edit`.

### Task 13: Host view

**Files:**
- Create: `src/features/hosts/{HostView.tsx,HostHeader.tsx,ServicesColumn.tsx,ConfirmServiceDialog.tsx,ServiceDialog.tsx}`, `src/features/services/queries.ts`.
- Modify: the `e/:id/h/:hostId` route.
- Test: `src/test/hostView.test.tsx`.

**Interfaces:**
- Consumes: `useHosts`, `HostDialog`, `useLog`, `LogEntryRow`, `api.services*`.
- Produces: `useServices(hostId)` (key `["services", hostId]`) and `useServiceMutations(hostId)`.

**Header:**
- name;
- IP (mono);
- OS chip;
- access chip (accent variant when access ≠ none; label `user` / `root`);
- stage chip (`COLUMN_LABELS[column]`);
- Edit (HostDialog) and Delete (confirm: "Delete <name>? Its services go with it; log entries stay but lose this host.").

**Pinned left column (about 300px, own scroll):**
- **Services:** one row per service.
  - Port and protocol in mono (`80/tcp`).
  - When confirmed: `product version ✓` in fg with the ✓ in the accent colour, and nmap's guess beneath it, dimmed (faint, struck-through style not required).
  - When unconfirmed: the nmap guess in muted text, or `unidentified` in warn-amber when the guess is empty or ends with `?`.
  - Clicking a row opens `ConfirmServiceDialog`:
    - product, version, and "Proved by" (a Select of this host's log entries by title, optional);
    - buttons: Confirm, and Remove confirmation when confirmed.
  - `+ Add service` opens ServiceDialog (port, protocol, nmap service/version).
- **Now:** a placeholder panel, "The current stage's open steps arrive with the checklist (build step 3)."

**Right tabs:**
- **Story:** the host's entries, oldest first, using `LogEntryRow`; empty: "Nothing logged on this host yet. Press L to capture." Capture opened from the host view preselects this host.
- **Checklist, Credentials and Findings:** placeholders naming their build step (3, 4, 4).

**Keys:** `Esc` returns to the engagement board.

- [ ] **Step 1: Failing tests:**
  - `header shows ip os access and stage`;
  - `confirmed service shows identity with nmap guess dimmed`;
  - `unidentified service flagged`;
  - `confirm dialog sends product version and proving entry`;
  - `story tab lists host entries oldest first`;
  - `capture from host view preselects the host`;
  - `esc goes back to board`.
- [ ] **Step 2:** Implement. Run `npm test`, `npm run typecheck`, `npm run lint`, `cargo test`.
- [ ] **Step 3: Commit** `feat(hosts): host view with services, confirmation and story`.
