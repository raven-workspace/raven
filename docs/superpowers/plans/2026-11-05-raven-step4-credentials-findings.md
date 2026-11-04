# Raven step 4: credentials, findings and attempts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build order step 4, the last step before sim-ready. It covers:
- **Credentials:** the old engagement credentials feature, ported. That means the matrix, half-credentials, access grants, the credential routine, hash cracking, and nxc result intake from the log.
- **Findings and attempts**, as spec §6.6 defines them.
- **Step-3 carryovers:** credential-driven playbook triggers, access flags, "new credential since" badges, and USER/PASS/HASH in filled commands.

**Architecture:** the same layering as step 3.
- **Rust:** stores rows behind thin validated commands, with one migration, 0004.
- **Engines:** the old credential engines are ported as pure TS under `src/engines/credentials/`, with CVSS under `src/engines/findings/`, adapted from `Machine` to Raven's `Host` plus `servicesByHost`.
- **UI:** derives the matrix, the overall states, the triggers and the flags on render.
- **nxc intake** is planned in TS from a command entry's blocks while the user is still in the Add to log panel. It is applied on save, together with the credentials the user accepts.

**Tech Stack:** Tauri 2, rusqlite (SQLCipher), React 19, TypeScript, Tailwind v4, TanStack Query, zustand, Vitest. There is one new UI dependency, `highlight.js` (core plus selected languages), for the views of finding files.

**Spec:** `docs/superpowers/specs/2026-11-03-raven-desktop-design.md`:
- §5.2: Credentials and Findings sections;
- §5.3: host Credentials and Findings tabs;
- §6.4: half-credentials;
- §6.6: findings and attempts;
- §9: the credential engines to port.

**Old engine (read-only):** the old app's repo.
- Engines: `utils/{credentialMatrix,credentialCommands,credentialIntake,nxcResultParser,hashIdentifier,cvss}.ts` and `utils/checklist/labels.ts`.
- Credential helpers: the credential parts of `utils/checklist/engagementState.ts`, and the key and upsert helpers in `store/lootPersistence.ts` (`credKey`, `usernameKey`, `attemptKey`, `upsertAttemptInList`, `findDuplicateCredential`, `defaultHashType`, `rekeyUsernameAttempts`).
- UI reference: `components/credentials/*`.
- Tests: `test/utils/{credentialMatrix,credentialCommands,credentialIntake,nxcResultParser}.test.ts`, `test/credentials/halfCredentials.test.ts`, `test/checklist/engagementState.test.ts`, `utils/hashIdentifier.test.ts` and `utils/cvss.test.ts`.
- Never modify pwndash. Never open anything under the owner's lab folder.

**Branch:** `step4-credentials-findings` from `main`.

## Global Constraints

- **Real data:** stored data is real lab data. Storage changes go through migration 0004, run by the existing runner (backup first, one transaction). Tests use synthetic data only.
- **One engagement per credential:** every credential, username, attempt, finding and attempt record belongs to exactly one engagement. The old "Unassigned" state and moving credentials between engagements are not ported.
- **Secrets:** they are stored in the encrypted database as entered. In the UI they are **masked by default** (`••••••••`), with a per-row Reveal and a Copy that works without revealing. Hashes are masked the same way.
- **Results:** attempt results are `admin | valid | failed | errored`, and errored never downgrades a recorded valid, admin or failed. Auth modes are `domain | local`.
- **Private:**
  - finding `lessons` are always private;
  - an attempt whose reason is operator error or inexperience is private;
  - private content must be marked so a later export or report can exclude it. The field is `private: true`, derived and stored.
- **Severity:** `critical | high | medium | low | info`. A score from a CVSS v3.1 vector suggests a severity, and the user's choice wins.
- **Ink design:** reuse `src/ui/*`. No stock styling and no native select/checkbox/radio. The accent is used only for meaning (admin/valid cells, the active selection). Warn is used for dead, locked or errored states.
- **Keys:** the existing key rules apply. There are no new global keys in step 4.
- **Commits:** one per task, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge.

## Review Focus

1. **Secrets with spaces, quotes, colons or `$`** (`P@ss w0rd'!`, `LM:NT`, `$krb5tgs$…`) come out shell-safe in every generated command. nxc lines carrying them are parsed back to the same credential, not a new one. Owned by Tasks 4 and 5.
2. **Pasting or saving the same nxc output twice** creates no duplicate credentials, usernames or attempts. Results never downgrade: errored never replaces failed, valid or admin, and the stronger result wins. Owned by Tasks 2, 5 and 8.
3. **Deleting things:**
   - deleting a credential removes its attempts;
   - deleting a host removes its attempts, access grants and finding host links;
   - deleting a log entry leaves its attempts and access grants in place without proof (`logEntryId` set to null), and removes it from finding steps (the other steps keep their order).

   Owned by Tasks 1, 2 and 3.
4. **Private content:** lessons, and attempts for operator error or inexperience, are stored with `private = true` and shown with the Private chip. A reported attempt can never carry the operator-error reason. Owned by Tasks 3 and 12.
5. **Secrets on screen:** a list, the matrix popover or a filled command never shows a secret unmasked until the user reveals it. The exception is a filled checklist command, which needs the real value to be copied; its displayed text masks PASS and HASH and Copy uses the real value. Owned by Tasks 6, 7 and 9.

---

## File map

**Rust (`src-tauri/`):**
- New: `migrations/0004_credentials_findings.sql`, `src/credentials.rs` (credentials, usernames, access grants), `src/attempts.rs` (credential attempts) and `src/findings.rs` (findings, finding links, finding files and failed attempts).
- Changed: `src/hosts.rs` (`access_reviewed_at`), `commands.rs` and `lib.rs`.

**TS engines:**
- `src/engines/credentials/{types.ts,keys.ts,matrix.ts,commands.ts,nxc.ts,intake.ts,hashes.ts,labels.ts,state.ts,index.ts}`;
- `src/engines/findings/{cvss.ts,index.ts}`.

**TS UI:**
- `src/features/credentials/*`: queries, CredentialsSection, CredentialForm, UsernamesList, HashesList, AccessGrants, TestGrid, CellPopover, RoutineSection, HostCredentials and MaskedSecret;
- `src/features/findings/*`: queries, FindingsSection, FindingEditor, FindingSteps, FindingFiles, CodeView, AttemptsList, AttemptForm and HostFindings.
- Changed: the capture save path and Add to log panel (intake), `features/checklist/*` (fill, triggers, access flags and badges), `sections.tsx`, `HostView.tsx`, `src/types/*` and `src/lib/api.ts`.

---

### Task 1: Migration 0004; credentials, usernames and access grants storage

**Files:**
- Create: `src-tauri/migrations/0004_credentials_findings.sql`, `src-tauri/src/credentials.rs`, `src/types/credentials.ts`
- Modify: `src-tauri/src/migrations/mod.rs`, `src-tauri/src/hosts.rs`, `commands.rs`, `lib.rs`, `src/lib/api.ts`, `src/types/host.ts`

**Interfaces (Produces):**
- **0004 SQL.** All step-4 tables are created here; later tasks add no migration.
  - `credentials(id PK, engagement_id FK CASCADE, type CHECK IN ('password','hash','ticket','key','token','other'), username TEXT NOT NULL DEFAULT '', domain TEXT, secret TEXT NOT NULL DEFAULT '', hash_type TEXT, scope CHECK IN ('domain','local','app') NOT NULL DEFAULT 'domain', local_host_id FK hosts ON DELETE SET NULL, source_host_id FK hosts ON DELETE SET NULL, source TEXT, notes TEXT, crack_status CHECK IN ('uncracked','cracked','uncrackable'), cracked_from FK credentials ON DELETE SET NULL, from_secret_id FK credentials ON DELETE SET NULL, created_at, updated_at)`.
  - `usernames(id PK, engagement_id FK CASCADE, username NOT NULL, domain TEXT, source_host_id FK hosts SET NULL, source TEXT, created_at)`, with a UNIQUE index on `(engagement_id, lower(username), lower(ifnull(domain,'')))`.
  - `access_grants(id PK, engagement_id FK CASCADE, username_id FK usernames CASCADE, host_id FK hosts CASCADE, level CHECK IN ('user','admin','system'), via TEXT NOT NULL, log_entry_id FK log_entries SET NULL, at INTEGER NOT NULL)`.
  - `cred_attempts(id PK, engagement_id FK CASCADE, cred_id FK credentials CASCADE, username_id FK usernames CASCADE NULL, host_id FK hosts CASCADE, service CHECK IN ('smb','winrm','rdp','mssql','ssh','ftp','ldap','wmi','vnc','nfs','http','kerberos','other'), port INTEGER, result CHECK IN ('admin','valid','failed','errored'), auth_mode CHECK IN ('domain','local'), detail TEXT, log_entry_id FK log_entries SET NULL, at INTEGER NOT NULL)`, with a UNIQUE index on `(cred_id, ifnull(username_id,''), host_id, service, auth_mode)`.
  - `findings(id PK, engagement_id FK CASCADE, title NOT NULL, severity CHECK IN ('critical','high','medium','low','info'), cvss_vector TEXT, cvss_score REAL, status CHECK IN ('draft','confirmed','reported') NOT NULL DEFAULT 'draft', description TEXT NOT NULL DEFAULT '', impact TEXT NOT NULL DEFAULT '', remediation TEXT NOT NULL DEFAULT '', exploit_notes TEXT NOT NULL DEFAULT '', lessons TEXT NOT NULL DEFAULT '', refs TEXT NOT NULL DEFAULT '[]', created_at, updated_at)`.
  - `finding_hosts(finding_id FK CASCADE, host_id FK hosts CASCADE, PK(finding_id, host_id))` and `finding_services(finding_id FK CASCADE, service_id FK services CASCADE, PK(finding_id, service_id))`.
  - `finding_steps(finding_id FK CASCADE, entry_id FK log_entries CASCADE, position INTEGER NOT NULL, PK(finding_id, entry_id))`.
  - `finding_files(id PK, finding_id FK CASCADE, name NOT NULL, language TEXT, content TEXT NOT NULL, created_at, updated_at)`.
  - `failed_attempts(id PK, engagement_id FK CASCADE, host_id FK hosts SET NULL, finding_id FK findings SET NULL, title NOT NULL, reason_kind CHECK IN ('control','precondition','access','operator'), reason TEXT NOT NULL, private INTEGER NOT NULL, log_entry_id FK log_entries SET NULL, created_at, updated_at)`.
  - `ALTER TABLE hosts ADD COLUMN access_reviewed_at INTEGER`.
- **`credentials.rs`:**
  - Structs and inputs: `Credential`, `CredentialInput`, `Username`, `UsernameInput`, `AccessGrant` and `AccessGrantInput`, all serde camelCase and mirroring the columns.
  - Functions: `list(conn, eid)`, `create(conn, eid, input)`, `update(conn, id, input)`, `delete(conn, id)`, `crack(conn, hash_id, plaintext) -> Credential` (creates a password credential with `cracked_from` and sets the hash `crack_status = 'cracked'`, in one transaction), `set_crack_status(conn, id, status)`, `convert_to_access(conn, cred_id, grant) -> Username` (for the old placeholder-secret credential: finds or creates the username, adds the grant, deletes the credential, all in one transaction), `usernames_list|username_create|username_delete` and `grant_create|grant_delete`.
  - Validation:
    - host ids belong to the engagement, as with `check_scope`;
    - `local_host_id` is required iff `scope = 'local'`;
    - `hash_type` is derived when absent for `type = 'hash'`, through the same rule as TS `defaultHashType`: 32 hex gives `NTLM`, `LM:NT` gives `pwdump (LM:NT)`, otherwise none. The TS side may refine it later.
    - Creating a duplicate by the credential key (type, lower username, secret with hashes lower-cased, lower domain, same engagement and same local host) returns the existing row, not an error.
- **Commands:**
  - credentials: `credentials_list`, `credential_create`, `credential_update`, `credential_delete`, `credential_crack`, `credential_set_crack_status`, `credential_convert_to_access`;
  - usernames: `usernames_list`, `username_create`, `username_delete`;
  - access grants: `access_grants_list`, `access_grant_create`, `access_grant_delete`;
  - hosts: `host_mark_access_reviewed(hostId)`, which sets `access_reviewed_at` to now.

  `Host` gains `accessReviewedAt: number | null`.
- **TS:** `src/types/credentials.ts` mirrors every struct, with the unions `CredentialType`, `CredentialScope`, `CrackStatus` and `AccessLevel`. Add the api functions.

- [ ] **Step 1: Write the failing Rust tests:**
  - `migration_0004_from_v3_keeps_data`;
  - `credential_round_trip_and_hash_type_derived`;
  - `duplicate_credential_returns_existing`;
  - `local_scope_requires_local_host`;
  - `crack_creates_linked_password_and_marks_hash`;
  - `convert_to_access_moves_to_username_grant`;
  - `deleting_credential_cascades_attempts`, by inserting an attempt row directly;
  - `deleting_host_cascades_grants_and_clears_local_host`;
  - `deleting_log_entry_keeps_grant_without_proof`;
  - `username_unique_case_insensitive`.
- [ ] **Step 2: Run** `cargo test credentials migrations`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cargo test && cargo clippy --all-targets -- -D warnings && npm run typecheck`. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(store): migration 0004; credentials, usernames, access grants`.

### Task 2: Credential attempts storage

**Files:**
- Create: `src-tauri/src/attempts.rs`, plus the types added to `src/types/credentials.ts`
- Modify: `commands.rs`, `lib.rs`, `src/lib/api.ts`

**Interfaces (Produces):**
- `CredAttempt { id, engagement_id, cred_id, username_id: Option, host_id, service, port: Option, result, auth_mode, detail: Option, log_entry_id: Option, at }`.
- `upsert(conn, eid, inputs: &[CredAttemptInput]) -> Vec<CredAttempt>` runs as one transaction, keyed on `(cred_id, username_id, host_id, service, auth_mode)`. For an existing row:
  - a new `errored` never replaces `admin`, `valid` or `failed`;
  - otherwise the newer `at` wins, and on equal `at` the stronger result wins (admin > valid > failed > errored);
  - `detail` and `log_entry_id` follow the winning result.

  Mirror old `upsertAttemptInList`, and read it for any further rule.
- `delete(conn, id)`, `list(conn, eid)` and `rekey_username_attempts(conn, username_id, secret_cred_ids, cred_id, host_id: Option)`, ported from the old `rekeyUsernameAttempts`. It moves bare-username attempts onto an accepted credential, merging by the same upsert rule.
- **Commands:** `cred_attempts_list`, `cred_attempts_upsert`, `cred_attempt_delete`, `cred_attempts_rekey`.

- [ ] **Step 1: Failing tests:**
  - `upsert_is_idempotent` (same input twice gives one row);
  - `errored_never_downgrades`;
  - `newer_result_wins_else_stronger`;
  - `username_and_credential_subjects_are_distinct_rows`;
  - `rekey_merges_into_existing_row`;
  - `foreign_host_or_credential_rejected`.
- [ ] **Step 2: Run** `cargo test attempts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full cargo test and clippy, and the typecheck. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(store): credential attempts with upsert rules`.

### Task 3: Findings and failed-attempts storage

**Files:**
- Create: `src-tauri/src/findings.rs`, `src/types/findings.ts`
- Modify: `commands.rs`, `lib.rs`, `src/lib/api.ts`

**Interfaces (Produces):**
- **Findings:**
  - `Finding { id, engagement_id, title, severity, cvss_vector, cvss_score, status, description, impact, remediation, exploit_notes, lessons, refs: Vec<String>, host_ids: Vec<String>, service_ids: Vec<String>, step_entry_ids: Vec<String> (ordered), created_at, updated_at }`.
  - `FindingInput` is the editable fields plus `host_ids`, `service_ids` and `step_entry_ids`. The full link sets are replaced on update in one transaction, and steps are renumbered 0..n.
  - `FindingFile { id, finding_id, name, language: Option, content, created_at, updated_at }`. The content limit is 1 MiB.
  - `FailedAttempt { id, engagement_id, host_id, finding_id, title, reason_kind, reason, private, log_entry_id, created_at, updated_at }`. `private` is set by the server: true iff `reason_kind = 'operator'`. A client value is ignored.
- **Commands:**
  - `findings_list`, `finding_create`, `finding_update`, `finding_delete`;
  - `finding_files_list(findingId)`, `finding_file_create`, `finding_file_update`, `finding_file_delete`;
  - `failed_attempts_list`, `failed_attempt_create`, `failed_attempt_update`, `failed_attempt_delete`.
- **Validation:**
  - linked host, service and entry ids belong to the engagement;
  - `cvss_score` is within 0..=10;
  - `refs` entries are non-blank, max 100;
  - `title` and `reason` are non-blank.

- [ ] **Step 1: Failing tests:**
  - `finding_round_trip_with_links_in_order`;
  - `update_replaces_links_and_renumbers_steps`;
  - `deleting_log_entry_drops_step_keeps_order`;
  - `deleting_host_drops_finding_host_link`;
  - `operator_reason_is_private_and_client_flag_ignored` (Review Focus 4);
  - `file_content_limit`;
  - `foreign_links_rejected`.
- [ ] **Step 2: Run** `cargo test findings`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full cargo test and clippy, and the typecheck. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(store): findings, finding files and failed attempts`.

### Task 4: Port the credential engines (keys, matrix, commands, hashes, labels)

**Files:**
- Create: `src/engines/credentials/{types.ts,keys.ts,matrix.ts,commands.ts,hashes.ts,labels.ts,index.ts}`
- Test: `src/test/engines/credentials/{matrix,commands,hashes,halfCredentials}.test.ts`

**Interfaces:**
- **Consumes:** `Host`, `Service` and `servicesByHost: Map<string, Service[]>`, plus the Task 1–2 types.
- **Produces.** Ported verbatim in behaviour from the old modules, with `Machine` replaced by `Host` plus its services:
  - `types.ts`: `SprayService`, `CredService`, `CredAuthMode`, `CredAttemptResult`.
  - `keys.ts`: `credKey`, `usernameKey`, `attemptKey`, `findDuplicateCredential`, `defaultHashType`.
  - `matrix.ts`: `SERVICE_PORTS`, `hostSprayServices(host, services)`, `isNtlmHash`, `isOwnerless`, `isPlaceholderSecret`, `isSprayable`, `authModesFor`, `CellState`, `Cell`, `cellFor(cred, host, services, service, attempts, usernameId?)`, `cellModes`, `OverallState`, `overallState(cred, hosts, servicesByHost, attempts)`, `foldCrackedHashes`, `hashCaptureKind`, `dedupeHashCaptures`.
  - `commands.ts`: `shellQuote`, `TestCommand`, `CommandSet`, `buildTestCommands`, `buildRoastCommands`, `buildUsernameSprayCommands`, `RoutineStepId`, `ROUTINE_STEPS`, `routineStepApplies`.
  - `hashes.ts`: `identifyHash`, `formatCrackingList`, `groupByHashcatMode`, `getCrackingCommands`.
  - `labels.ts`: `credLabel`, `usernameLabel`.
  - Old ISO `at` strings become Unix ms numbers throughout.
- The old `credentialEngagement.ts` is not ported, since every record has one engagement (Global Constraints).

- [ ] **Step 1: Port the tests.**
  - Port the old `credentialMatrix`, `credentialCommands`, `hashIdentifier` and `halfCredentials` (engine cases only) tests, with fixtures rebuilt on `Host`/`Service`. Keep every assertion that doesn't need the old store, and list each dropped one with its reason in the report.
  - Add `secrets with spaces, quotes, colons and $ are shell-safe in every builder` (Review Focus 1). It must cover `P@ss w0rd'!`, `LM:NT` and a `$krb5tgs$` hash.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/credentials`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(credentials): port matrix, commands, hash identifier and labels`.

### Task 5: Port the nxc parser, intake planning, credential engagement state and CVSS

**Files:**
- Create: `src/engines/credentials/{nxc.ts,intake.ts,state.ts}`, `src/engines/findings/{cvss.ts,index.ts}`
- Test: `src/test/engines/credentials/{nxc,intake,state}.test.ts`, `src/test/engines/findings/cvss.test.ts`

**Interfaces:**
- **Consumes:** Task 4. `adHosts` and `findDcHost` from `src/engines/checklist/facts.ts`. `CommandBlock` from `src/types/log.ts`. The `Hop` type.
- **Produces:**
  - `nxc.ts`: `NxcAuthResult`, `parseNxcAuthResults(text, knownSecrets)`, `parseRoastHashes(text)`. Verbatim.
  - `intake.ts`: `PlannedAttempt`, `PendingCredential`, `CredentialIntakePlan`, `knownSecretsOf`, `planCredentialIntake({ blocks, engagement, hosts, credentials, usernames })`, `formatIntakeSummary`, `pendingCredentialLabel`, `unrecordedLabel`.
    - Ported in behaviour. Host matching is by IP and then by NetBIOS label, as before; there are no `extraIps`.
    - Records carry `engagementId = engagement.id`.
  - `state.ts`:
    - `playbookTriggers({ engagement, hosts, servicesByHost, credentials, attempts, hops }): Record<'nocreds'|'user'|'da', boolean>`;
    - `newCredSince(goalCompletedAt: number | undefined, credentials)`;
    - `AccessFlag`, `accessFlags({ hosts, attempts, credentials })`, which uses `host.accessReviewedAt`.

    The rules are as in old `engagementState`. `da` uses `findDcHost` (no pin) and a hop whose `toHostId` is the DC.
  - `cvss.ts`: `parseCvssVector`, `cvssRoundUp`, `calculateCvssScore`, `scoreToSeverity`, `sortFindingsBySeverity`. Verbatim.

- [ ] **Step 1: Port the tests.**
  - Port the old `nxcResultParser`, `credentialIntake`, `engagementState` (credential cases: triggers, local-auth-only does not open `user`, `newCredSince`, `accessFlags` against `accessReviewedAt`) and `cvss` tests.
  - Add `the same nxc output planned against its own result adds nothing` (Review Focus 2): plan, apply the plan to the fixture lists, then plan again, and the second plan has no new credentials, usernames or changed attempts.
- [ ] **Step 2: Run** `npx vitest run src/test/engines`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(credentials): port nxc parser, intake, engagement state; port cvss`.

### Task 6: Credentials section, part 1: list, form, usernames, hashes, access

**Files:**
- Create: `src/features/credentials/{queries.ts,CredentialsSection.tsx,CredentialForm.tsx,UsernamesList.tsx,HashesList.tsx,AccessGrants.tsx,MaskedSecret.tsx}`
- Modify: `sections.tsx` (section 3 renders `CredentialsSection`)
- Test: `src/test/credentials.test.tsx`

**Interfaces:**
- **Queries:** `useCredentials(eid)` (key `['credentials', eid]`), `useUsernames(eid)`, `useAccessGrants(eid)` and `useCredAttempts(eid)` (key `['credAttempts', eid]`), plus mutation hooks. Every mutation invalidates its own key, plus `['credAttempts', eid]` when the attempts may change (credential delete, crack, convert).
- **`MaskedSecret({ secret, label })`:** shows `••••••••` by default, with a Reveal toggle (`aria-pressed`) and a Copy that copies the real value without revealing it.
- **Behaviour,** following the old `CredentialsPanel`, `CredentialForm`, `UsernamesList`, `HashesList` and `HalfCredentials`:
  - The credentials table shows each credential's label (`credLabel`), type, scope, source, an overall-state chip (`overallState`), the masked secret, and row actions: edit, delete (confirmed), convert to access-only (when `isPlaceholderSecret`) and crack (for hashes). Cracked hashes are folded and captures deduped before listing.
  - The add/edit form has a "What you have" toggle: a credential, an ownerless secret, or a username with access. It has type, scope, domain, local host (required for local), the secret, and a hash-type suggestion from `identifyHash`.
  - The usernames list supports `DOMAIN\user`, delete and copy-all, plus the access tags per username.
  - The hashes list shows the masked hash, the identified type with hashcat and john commands, a crack form (plaintext), and mark uncrackable / reset.
  - Owner-unknown secrets get the "owner unknown" chip, plus "matched: users" from `fromSecretId` links.

- [ ] **Step 1: Failing tests:**
  - `adding a password credential lists it masked; Reveal shows it; Copy copies without revealing` (Review Focus 5);
  - `an ownerless secret shows owner unknown`;
  - `local scope requires a host`;
  - `cracking a hash adds the linked password and folds the hash`;
  - `convert a placeholder credential to access-only`;
  - `usernames accept DOMAIN\\user and reject duplicates`;
  - `delete asks first and removes the credential`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(credentials): credentials list, form, usernames, hashes and access`.

### Task 7: Test matrix, cell popover and the credential routine

**Files:**
- Create: `src/features/credentials/{TestGrid.tsx,CellPopover.tsx,RoutineSection.tsx,TestCommands.tsx}`
- Modify: `CredentialsSection.tsx`
- Test: `src/test/credentialMatrix.test.tsx`

**Behaviour,** following the old `TestGrid`, `CellPopover`, `CredentialRoutineSection` and `TestCommands`:
- **Grid:** credential rows by host × service columns. Each cell shows a glyph by state, with a legend:
  - A for admin and V for valid, in the accent colour;
  - ✕ for failed and · for untested;
  - errored in the warn colour;
  - `na` hatched.

  Failed cells that still have untried modes show a "partial" hint.
- **Cell popover:** for each auth mode, the latest attempt (time, detail, and a link to its proof log entry that opens the Log section), plus "Set <mode> result: admin / valid / failed" and "Clear <mode> result". The set buttons call `cred_attempts_upsert` with `detail: 'set by hand'`.
- **Routine:** a picker of the engagement's sprayable credentials. Its default is the newest credential that still has commands. Each row in `ROUTINE_STEPS` has:
  - a Done checkbox (an Ink `Toggle`), which ticks the engagement checklist item `step.itemId` through `useChecklistMutations(eid).setStatus(engagement.id, itemId, …)`;
  - a "doesn't apply" dim when `routineStepApplies` is false;
  - otherwise, its commands with Copy.
- **Command text:** the displayed command masks the secret part (Review Focus 5), and Copy copies the real command.

- [ ] **Step 1: Failing tests:**
  - `grid shows admin, valid, failed and na cells from attempts`;
  - `setting a cell result upserts an attempt marked set by hand`;
  - `clear removes it`;
  - `routine rows that don't apply are dimmed`;
  - `routine command copy contains the real secret, display masks it`;
  - `ticking a routine step sets its checklist item`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(credentials): test matrix, cell popover and credential routine`.

### Task 8: nxc intake in Add to log; host Credentials tab

**Files:**
- Modify: `src/features/capture/{resolve.ts,CaptureForm.tsx,saveCapture.ts}`, `src/features/hosts/HostView.tsx`
- Create: `src/features/credentials/{HostCredentials.tsx,applyIntake.ts}`
- Test: `src/test/credentialIntake.test.tsx`

**Behaviour:**
- **Intake preview:** for a command entry, the Add to log panel computes `planCredentialIntake` from the draft's blocks and the engagement's credentials, usernames and hosts. When the plan is non-null it shows:
  - the summary (`formatIntakeSummary`);
  - a list of pending credentials (`pendingCredentialLabel`), each an Ink toggle, on by default for successes and off for `failedOnly`;
  - unknown-host and IP-change notes.
- **`applyIntake(engagementId, plan, { logEntryId, at, acceptKeys })`** runs after the entry saves, in this order:
  1. create the new usernames;
  2. create the accepted credentials (reusing duplicates, setting `fromSecretId`);
  3. upsert the planned attempts with `logEntryId` and `at`, resolving `usernameKey` to the created username ids;
  4. run `cred_attempts_rekey` for accepted pending credentials, and upsert the `ifDeclined` attempts for declined ones;
  5. create the new hashes.

  Its failure throws the existing `PartialSaveError` with "Saved the entry, but the credentials didn't update." Afterwards it invalidates the credential keys.
- **When intake runs:** only when a new entry is saved. Editing an entry doesn't re-run it, and deleting an entry leaves its attempts without proof.
- **Host Credentials tab:** replaces the placeholder. It shows the engagement credentials with this host's matrix column (a one-host `TestGrid`), "Access without a secret" grants for this host (add and remove), and "Results against this host" with links to their proof entries.

- [ ] **Step 1: Failing tests:**
  - `pasting nxc output shows the intake summary and pending credentials`;
  - `saving applies attempts with the entry as proof and adds accepted credentials`;
  - `a declined pending credential records its username attempts instead`;
  - `saving the same output twice adds nothing new` (Review Focus 2);
  - `intake failure shows the partial-save message and the entry stays`;
  - `host Credentials tab lists grants and results with proof links`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(credentials): nxc intake on save; host Credentials tab`.

### Task 9: Checklist carryovers: credential fill, playbook triggers, access flags and badges

**Files:**
- Modify: `src/engines/checklist/fill.ts`, `src/features/checklist/{goalCommands.ts,HostChecklist.tsx,NowPanel.tsx,EngagementChecklist.tsx,PlaybookSection.tsx,GoalRow.tsx}`
- Create: `src/features/checklist/{CredentialPicker.tsx,AccessFlags.tsx}`
- Test: additions to `src/test/engines/checklist/fill.test.ts`, `src/test/hostChecklist.test.tsx` and `src/test/engagementChecklist.test.tsx`

**Behaviour:**
- **Fill:** `FillInput` gains `cred?: Credential | null`, ported from old `commandContext`:
  - USER is the credential's username, empty for ownerless;
  - PASS is the secret for a password;
  - HASH is the NT half for an NTLM hash;
  - DOMAIN prefers the credential's domain;
  - a redacted or empty secret stays unresolved.

  Add `defaultCredFor(host, credentials, attempts)`: the newest credential with a valid or admin attempt on that host.
- **Credential picker:** a picker on the Checklist tab and in Now ("Commands use: <credLabel> ▾"). It defaults to `defaultCredFor`, offers "none", and is remembered per host for the session. Displayed command text masks PASS and HASH; Copy uses the real value (Review Focus 5).
- **Playbooks:** `EngagementChecklist` opens them from `playbookTriggers`. The "opens with credentials" note is removed.
- **Access flags:** a section in the Engagement checklist lists `accessFlags` ("dc01: admin over winrm as CORP\\svc_sql"), each with "Reviewed", which calls `host_mark_access_reviewed`.
- **Badges:** a GoalRow for a done goal shows a "new credential since" badge when `newCredSince(completedAt, credentials)` is non-empty, listing the credential labels.

- [ ] **Step 1: Failing tests:**
  - `fill puts USER and PASS from the picked credential and the NT half for HASH`;
  - `picker defaults to the newest credential with access on the host`;
  - `displayed command masks PASS; copy has it`;
  - `First domain user opens once a domain credential has a valid domain attempt`;
  - `local-auth-only success does not open it`;
  - `an admin attempt on the DC opens Domain admin`;
  - `access flag appears for a new valid attempt and Reviewed clears it`;
  - `a done goal shows new credential since for a later domain credential`.
- [ ] **Step 2: Run** the affected test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(checklist): credential fill, playbook triggers, access flags and badges`.

### Task 10: Findings section: list and editor

**Files:**
- Create: `src/features/findings/{queries.ts,FindingsSection.tsx,FindingEditor.tsx}`
- Modify: `sections.tsx` (section 4 renders `FindingsSection`)
- Test: `src/test/findings.test.tsx`

**Behaviour:**
- **List:** sorted with `sortFindingsBySeverity`. Each row shows a severity chip (critical and high in the warn colour, the rest neutral), the title, the affected host names, the status, and the score when present.
- **Editor:** a full-height panel or dialog, matching the app's dialogs. It has:
  - title, severity, status, the CVSS vector (computes the score live and suggests a severity, with "Use suggested");
  - affected hosts and services (Ink multi-pick chips);
  - references (an add/remove list; CVE and EDB ids and URLs, shown as links when they are URLs);
  - description, impact, remediation and exploit notes (Markdown textareas);
  - lessons, a textarea with the Private chip next to its label, always.
- **Saving:** it saves on an explicit Save, with `⌘Enter` as the shortcut. Unsaved changes ask before closing.

- [ ] **Step 1: Failing tests:**
  - `list sorts critical first then by score`;
  - `a valid CVSS vector shows the score and suggests the severity; an invalid one shows an error and saves no score`;
  - `affected hosts and services round-trip`;
  - `lessons are marked private`;
  - `closing with unsaved changes asks first`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(findings): findings list and editor with CVSS`.

### Task 11: Finding steps, finding files and the host Findings tab

**Files:**
- Create: `src/features/findings/{FindingSteps.tsx,FindingFiles.tsx,CodeView.tsx,HostFindings.tsx}`
- Modify: `FindingEditor.tsx`, `HostView.tsx`, `package.json` (add `highlight.js`)
- Test: `src/test/findingSteps.test.tsx`

**Behaviour:**
- **Steps:** an ordered list of linked log entries, shown as the entry's kind label, title and time. The user can:
  - add from a searchable picker of the engagement's log, filtered by the finding's hosts first;
  - move up and down (buttons, plus `⌥↑` and `⌥↓` on a focused step);
  - remove a step.

  Each step expands to `LogEntryBody`, so its command and screenshot show.
- **Files:** a list of files, each with name and content. Adding is by paste, or by choosing a local file via `<input type=file>` styled as a Button (text only, max 1 MiB). The language is guessed from the extension (lua, c, py, sh, ps1, php, js, ts, rb, go, txt), with an override.
  - **`CodeView`** renders with `highlight.js/lib/core` and only those languages registered, using an Ink theme (muted greys plus the accent for keywords; no stock theme).
  - Files can be edited, copied and deleted (confirmed).
- **Host Findings tab:** the findings affecting this host, as list rows that open the editor.

- [ ] **Step 1: Failing tests:**
  - `adding steps keeps order; moving up and down reorders; saving sends the ordered ids`;
  - `a deleted log entry disappears from steps, the rest stay in order`;
  - `a file is highlighted by its extension's language`;
  - `files over 1 MiB are refused with a message`;
  - `host Findings tab lists only that host's findings`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(findings): reproduction steps, files with highlighting, host Findings tab`.

### Task 12: Attempts (things tried that failed)

**Files:**
- Create: `src/features/findings/{AttemptsList.tsx,AttemptForm.tsx}`
- Modify: `FindingsSection.tsx` (an "Attempts" list below the findings) and `HostFindings.tsx` (this host's attempts)
- Test: `src/test/attempts.test.tsx`

**Behaviour:**
- **Form:** "What was tried" (title), host (optional), finding (optional), the linked log entry (optional), and the reason. The reason is a choice of:
  - Blocked by a control;
  - Missing precondition;
  - Insufficient access;
  - Operator error or inexperience (labelled "private").

  It also has a one-line reason text.
- **Private display:** the private reason shows the Private chip on the row, and the form says "Never appears in a report".
- **Rows:** edit and delete (confirmed). Each row links to its log entry.

- [ ] **Step 1: Failing tests:**
  - `a reported reason saves as not private`;
  - `operator error saves private and shows the chip` (Review Focus 4);
  - `switching a private attempt to a reported reason clears private`;
  - `host Findings tab lists this host's attempts`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`, and in src-tauri `cargo test` and `cargo clippy --all-targets -- -D warnings`. Expected: all green.
- [ ] **Step 5: Commit** `feat(findings): attempts with reported and private reasons`.

---

## Rulings in this plan (for the user to check)

1. **One engagement per record:** every credential belongs to exactly one engagement. There is no "Unassigned" and no moving credentials between engagements.
2. **Masked secrets:** secrets are masked everywhere until revealed, and Copy works without revealing. Filled checklist commands display masked and copy the real value.
3. **When nxc intake runs:** only when a new log entry is saved, with a preview and accept toggles in Add to log. Edits don't re-run it.
4. **Intake only reads nxc output,** auth lines and roast hashes, as the old app did. secretsdump, mimikatz and plain `user:pass` parsing are not part of step 4.
5. **Finding status** is Draft, Confirmed or Reported.
6. **Finding files** are stored as text in the database, at most 1 MiB each. They get syntax highlighting through `highlight.js`, which is the one new dependency.
7. **Failed attempts** (§6.6) are a separate table from credential test results, and their `private` flag is set by the server from the reason.
8. **The credential picker** for filled commands defaults to the newest credential with access on that host, per host, for the session.
9. **Not in step 4:** the stuck view (step 6), the cleanup list (step 6), import (step 5) and reports (phase 3).
