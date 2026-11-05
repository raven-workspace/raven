# Raven step 5: fixes, exam-sim AD flag counts, import from old Raven — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close the step-4 follow-ups, count exam-sim flags the way the OSCP exam does (the AD set holds one flag), and import the user's engagements from an old-Raven backup JSON (spec §7).

**Architecture:**
- **Fixes and flag counts:** small Rust and UI changes. One migration, 0005, adds a tri-state `hosts.ad_set`.
- **Import, in TS:** reads the chosen file in the webview, validates it, and lists the pickable engagements. It maps the selected ones into an `ImportPlan` of new-model records, keeping the old ids.
- **Import, in Rust:** `import_apply` writes the plan in one transaction after an automatic backup. It is add-only by id and returns counts.

**Tech Stack:** Tauri 2, rusqlite (SQLCipher), React 19, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-raven-desktop-design.md` §7 (import), §6.5 (exam sims).

**Old format reference:** the old source tree is the old app's repo, read-only.
- Backups: `store/backupFile.ts`, `store/useCtfStore.ts` `exportBackup`, `utils/workspaceStorage.ts` (2.0.0) and `utils/backupCrypto.ts`.
- Data shapes: `types/index.ts` (Machine), `types/engagementLog.ts`, `types/checklist.ts`, `types/loot.ts` and `types/labStudy.ts`.
- Behaviour: `store/lootPersistence.ts` (normalisers and legacy migrations), `utils/targetType.ts` (labs) and `utils/backupChecksum.ts`.
- Fixture shapes: `test/store/backupV3.test.ts`, `test/store/lootEngagementPersistence.test.ts` and `test/store/checklistReworkRoundTrip.test.ts`.

**Branch:** `step5-import` from `main`.

## Global Constraints

- **The real backup** `a file outside the repo` contains secrets. No agent opens, reads, copies or commits it. Tests use synthetic fixtures only.
- **Storage changes** go through migration 0005. Import goes through `import_apply` after an automatic backup, in one transaction.
- **Formats:** accept a plain backup of version `"3.0.0"` (the current old-app backup) and `"2.0.0"` (the legacy workspace export). Reject `{format:"raven-backup-encrypted"}` with exactly: "This backup is encrypted. Export an unencrypted backup from old Raven and import that."
- **Kind mapping:** `exam-sim` stays `exam-sim`; `challenge-lab` or unset becomes `lab`; `real` becomes `client`.
- **Picker:** lists the backup's labs and standalone machines with their dates. Nothing is selected by default. HTB/THM catalog machines are never listed.
- **Re-import is add-only:** records are matched by their old id; existing rows are never overwritten or deleted. The summary lists added and already-present counts per type.
- **Notes mapping:**
  - a host's `quickNotes` becomes that host's field notes, verbatim, except that lines starting with `? ` are escaped to `\? ` so they stay plain text;
  - a non-empty `nextMove` becomes an open thread (`? <nextMove>`);
  - `writeupMarkdown`, vault/CPTS notes and global `userNotes`/`customNotes` are not imported.
- **Ink design and keys** as in earlier steps. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge.

## Review Focus

1. **Re-importing the same engagement:** a second import of the same file adds nothing and changes nothing. The summary shows everything as already present. Owned by Task 6.
2. **The user's backup may be either format** (2.0.0 or 3.0.0), may lack `indexedDb.images`, and may carry legacy fields: `commandOutputs`/`rawScanOutput` instead of `logEntries`, credential `verifications`, attempt results `tried`/`invalid`, a missing `authMode`. Import maps each one the way old Raven's normalisers did, and never crashes on an unknown field. Owned by Tasks 3–5.
3. **A failure mid-import** (bad record, disk error) leaves the database unchanged, and the pre-import backup exists. Owned by Task 6.
4. **The privacy of imported secrets:** imported credentials show masked like any other. A redacted credential (`redacted: true` or `"[REDACTED]"`) is skipped and counted, never stored as a password. Owned by Tasks 5 and 7.
5. **Exam-sim progress with the AD set:** three standalones plus a DC and two clients show "flags x/7" and "Rooted x/4". Lab and client engagements keep 2 flags per host. Owned by Task 2.

---

### Task 1: Step-4 follow-ups (batch)

**Files:**
- Modify: `src-tauri/src/credentials.rs`, `src/engines/credentials/keys.ts`, `src/features/hosts/HostHeader.tsx`, `src/features/vault/VaultGate.tsx`
- Create: `src/lib/clipboard.ts`

**Interfaces (Produces):**
- **`src/lib/clipboard.ts`:**
  - `copySecret(text: string): Promise<void>` writes the clipboard and remembers that Raven put a secret there.
  - `clearSecretClipboard(): Promise<void>` writes `""` to the clipboard only if the last Raven copy was a secret, then forgets it.
  - Every Copy of a secret, or of a command containing a real secret, uses `copySecret`. That covers MaskedSecret, the credential routine, filled checklist commands and HashesList.
- **Lock:** VaultGate's `markLocked` calls `clearSecretClipboard()`.

**Changes:**
1. **Hash secrets:** for credentials of type `hash` (only), trim all edge whitespace when storing (Rust `build`/`crack`) and when keying (Rust `cred_key`, TS `credKey`/`findDuplicateCredential`). Passwords keep Ruling F-R1 (only edge line breaks stripped).
2. **Host delete confirm** (HostHeader `HOST_DELETE_DETAIL`): also lists field notes, ruled-out items, tunnels through the host and hops to or from it.
3. **Clipboard on lock:** as above.

- [ ] **Step 1: Failing tests:**
  - Rust: `hash_secret_edge_spaces_are_trimmed_and_dedupe` ("<nt> " and "<nt>" give one credential);
  - TS: `credKey treats a padded hash as the same hash`;
  - UI: `host delete confirm names notes, ruled-out items, tunnels and hops`;
  - UI: `locking clears the clipboard after a secret copy, and leaves it alone after a non-secret copy`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`, `cargo test` and `cargo clippy --all-targets -- -D warnings`. Expected: green.
- [ ] **Step 5: Commit** `fix: hash dedupe ignores edge spaces; truthful host delete; clipboard cleared on lock`.

### Task 2: Exam-sim AD set and flag counts

**Files:**
- Create: `src-tauri/migrations/0005_ad_set.sql`
- Modify: `src-tauri/src/migrations/mod.rs`, `src-tauri/src/hosts.rs`, `src-tauri/src/engagements.rs` (`progress_all`), `src/types/host.ts`, `src/features/hosts/HostDialog.tsx`, `src/features/hosts/HostHeader.tsx`

**Interfaces (Produces):**
- **Schema:** `ALTER TABLE hosts ADD COLUMN ad_set INTEGER` (NULL = automatic, 0 = no, 1 = yes).
- **`Host`:**
  - `adSet: boolean | null` (stored);
  - `adSetEffective: boolean`, computed in Rust as `ad_set` if not NULL, else the host has open services on both 88 and 389;
  - `HostInput.adSet?: boolean | null`, where absent keeps the value and null resets to automatic.
- **`progress_all`, for engagements of kind `exam-sim` only:**
  - Let S be the hosts whose `adSetEffective` is false and A the hosts where it is true.
  - `flags_total = 2·|S| + (|A| > 0 ? 1 : 0)`.
  - `flags_found` = distinct (host, flagKind) pairs over S, plus 1 if any host in A has a `proof` flag.
  - `hosts_total = |S| + (|A| > 0 ? 1 : 0)`.
  - `hosts_rooted` = S hosts with a proof flag, plus 1 if any A host has a proof flag.
  - Other kinds are unchanged (2 per host).
- **UI:** HostDialog shows an Ink toggle "Part of the AD set" in exam sims only, offering automatic, on and off. Automatic shows "(auto: DC detected)" or "(auto)". HostHeader shows an "AD set" chip when effective.

- [ ] **Step 1: Failing tests:**
  - Rust `exam_sim_progress_counts_ad_set_once`:
    - fixture: 3 standalones, a DC with 88 and 389 open, and two clients with `ad_set = 1`;
    - flags: a local and a proof on one standalone, and a proof on the DC;
    - expect `(hosts_total, hosts_rooted, flags_found, flags_total) = (4, 2, 3, 7)`.
  - Rust `lab_progress_unchanged`.
  - Rust `ad_set_null_follows_ports_and_explicit_overrides`.
  - Rust `migration_0005_from_v4_keeps_data`.
  - UI: `the AD-set toggle shows only in exam sims and saves on, off and automatic`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full checks.** Expected: green.
- [ ] **Step 5: Commit** `feat(exam): AD set counts as one target and one flag in exam sims`.

### Task 3: Import: read, validate and list (TS engine)

**Files:**
- Create: `src/engines/import/{types.ts,read.ts,list.ts,index.ts}`
- Test: `src/test/engines/import/{read,list}.test.ts`, `src/test/engines/import/fixtures.ts` (synthetic 2.0.0 and 3.0.0 builders)

**Interfaces (Produces):**
- `types.ts`: the minimal typed views of the old shapes the importer reads (`OldMachine`, `OldLogEntry`, `OldCredential`, `OldCredAttempt`, `OldUsername`, `OldLabFinding`, `OldImage`, `OldBackup`). Copy the field names from the old types listed above.
- `readBackup(text: string): Promise<{ ok: true; backup: OldBackup; version: '2.0.0' | '3.0.0' } | { ok: false; error: string }>`:
  - strips a BOM;
  - rejects encrypted files with the exact Global Constraints message;
  - accepts `version` `"3.0.0"`, `"2.0.0"`, or a missing version (treated as `"2.0.0"`), plus the `{data:{…}}` wrapper and a bare machines array, as `validateWorkspacePayload` does;
  - if a 3.0.0 `checksum` is present, verifies it the way `utils/backupChecksum.ts` does (SHA-256 over canonical JSON with recursively sorted keys, minus `checksum`) using WebCrypto, and on a mismatch returns "This backup is damaged (checksum mismatch).";
  - strips `__proto__`, `constructor` and `prototype` keys;
  - other errors: "Not an old-Raven backup."
- `listImportable(b: OldBackup): ImportCandidate[]`, with `ImportCandidate = { id: string; name: string; kind: 'lab' | 'standalone'; engagementKind: EngagementKind; hostCount: number; logCount: number; firstAt: number | null; lastAt: number | null; createdAt: number }`:
  - a lab is a genuinely custom machine (`id` starting with `custom-`, or platform `Custom`) tagged `pro-lab` (case-insensitive);
  - a standalone is a genuinely custom machine with no `labId`, or a dangling `labId`, or `labId` equal to its own id, and is not a lab;
  - lab boxes are not listed separately, and catalog (HTB/THM) machines are never listed;
  - dates: `firstAt`/`lastAt` are the min and max log `at` of the container, and `createdAt` comes from the machine.

- [ ] **Step 1: Failing tests:**
  - `encrypted backup is rejected with the export-unencrypted message`;
  - `2.0.0 and 3.0.0 and a wrapped payload are read`;
  - `a 3.0.0 checksum mismatch is rejected; a correct one passes`;
  - `prototype keys are stripped`;
  - `lists labs and standalones with dates, never catalog machines or lab boxes`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/test/engines/import`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(import): read and list old-Raven backups`.

### Task 4: Import mapping: engagements, hosts, services, log, screenshots, flags, notes

**Files:**
- Create: `src/engines/import/plan.ts` (first half)
- Test: `src/test/engines/import/plan.test.ts`

**Interfaces (Produces):**
- `ImportPlan` holds `{ engagements, hosts, services, logEntries (with hostIds, content, attachment?), notes, … }`, using the new-model input shapes plus explicit ids. Task 5 extends it with the remaining fields. Every record keeps its old id, with these exceptions:
  - a standalone's engagement id is `<machineId>#e`, so it never equals the host's checklist owner id;
  - service ids are `<hostId>:<proto>/<port>`;
  - screenshot and flag log-entry ids are `<machineId>:shot:<id>` and `<machineId>:flag:local|proof`.
- `buildImportPlan(b: OldBackup, selectedIds: string[], now: number): ImportPlan`.
- **Engagements:**
  - name: from the machine;
  - kind: mapped per Global Constraints;
  - `scopeCidrs`: `scope ?? []`;
  - `domain`: copied;
  - `status`: `active`;
  - dates and timebox: none.
- **Hosts:**
  - a lab's hosts are its boxes; a standalone has itself as its one host;
  - os: Windows → `windows`; Linux, BSD, Android or macOS → `linux`; Other → `other`;
  - `dualHomed` and `accessReviewedAt` (ISO → ms) are copied;
  - board column from `status`: backlog or recon → enumerate; foothold → foothold; root → loot; completed → done. `boardManual` is false.
- **Services:** come from `services[]` (port, protocol, state, service → `nmapService`, version → `nmapVersion`). `openPorts` without a matching service row become an open service with an empty name.
- **Log entries:**
  - Read the container's `logEntries`, plus the legacy `commandOutputs` and `rawScanOutput` folded in the same way as old `migrateLegacyLogs`, skipping `deletedLogEntryIds`.
  - Kind: `command` when any block has a non-empty command, else `note` (text = the outputs joined by blank lines).
  - Copied fields: `title`, `ranOn`, `observations` and `at`. `private` is false.
  - `hostIds` are mapped. A standalone's own entries with empty `hostIds` get that one host.
- **Screenshots:** each `Machine.screenshots[]` entry whose `imageId` exists in `indexedDb.images` becomes a screenshot entry. The title is the screenshot title, the caption its notes, the attachment `{mime, dataBase64}` from the image, and `at` its `createdAt`. A missing image is skipped and counted.
- **Flags:** `userFlag` becomes a local flag and `rootFlag` a proof flag, on that host, at `userPwnedAt`/`rootPwnedAt`, or `now` if those are missing.
- **Notes:** follow the Global Constraints mapping. A lab container's `nextMove` becomes a thread in the engagement notes. `portTriage` notes are appended to the host's notes under `## Port triage` as `- <port>: <status> — <note>` (Ruling: there is no per-service notes field).

- [ ] **Step 1: Failing tests,** one per bullet above. Include:
  - `quickNotes "? " lines are escaped so they are not threads`;
  - `nextMove becomes one open thread`;
  - `legacy commandOutputs fold into entries`;
  - `a missing screenshot image is skipped and counted`;
  - `standalone engagement id differs from its host id`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/test/engines/import`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(import): map engagements, hosts, services, log, screenshots, flags and notes`.

### Task 5: Import mapping: checklist, hops, tunnels, findings, credentials

**Files:**
- Modify: `src/engines/import/plan.ts`
- Test: `src/test/engines/import/plan.test.ts`

**Behaviour, extending `ImportPlan` and `buildImportPlan`:**
- **Checklist:**
  - Map `checklist.itemsState` per host to checklist items with `ownerId` = host id, and the container's engagement-goal items to `ownerId` = engagement id.
  - Keep only goal ids that exist in the current goal data (`HOST_GOALS`, `ENGAGEMENT_SETUP`, the playbooks) or are `cred-routine-*`. Skip and count the others.
  - Evidence: `{entryId, commandId}` for entries that are imported.
  - `completedAt`: ISO → ms.
- **Hops and tunnels:** come from the container, skipping `deleted*Ids`. Host ids must be imported hosts, or the record is skipped and counted. ISO → ms.
- **Findings:** `LabFinding` becomes a finding:
  - title and severity are copied, and `cvssScore` is kept;
  - `repro` becomes the description, with `affectedService` prepended as `Affected: <service>` when present;
  - `remediation` is copied, and `cweCve` becomes `refs`;
  - the host link is the machine, status is `draft`, and lessons are empty.
- **Credentials** (top-level arrays) are kept when `engagementId` maps to a selected engagement (the lab id, or a standalone's machine id becoming `<id>#e`), or when `sourceMachineId` is an imported host.
  - `redacted` or `"[REDACTED]"` secrets are skipped and counted.
  - The legacy migrations are applied: `verifications` become attempts, `tried` becomes `errored`, `invalid` becomes `failed`, and a missing `authMode` comes from the scope.
  - Attempts: `machineId` becomes `hostId`, and attempts whose credential or host isn't imported are skipped.
  - Usernames come with their access grants, respecting `deletedAccessIds`.
  - ISO → ms throughout.

- [ ] **Step 1: Failing tests:**
  - `legacy verifications become attempts`;
  - `tried/invalid results are migrated`;
  - `a missing authMode follows the scope`;
  - `a redacted credential is skipped and counted`;
  - `unknown goal ids are skipped and counted`;
  - `evidence keeps only imported entries`;
  - `a hop to a non-imported host is skipped`;
  - `a LabFinding maps to a draft finding`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/test/engines/import`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(import): map checklist, network, findings and credentials`.

### Task 6: `import_apply` (Rust): backup first, one transaction, add-only

**Files:**
- Create: `src-tauri/src/import.rs`
- Modify: `commands.rs`, `lib.rs`, `src/lib/api.ts`, `src/types/import.ts`

**Interfaces (Produces):**
- `ImportPlanInput`, the serde mirror of the TS `ImportPlan`.
- `ImportSummary`, a `Record<type, {added, present}>` for each record type.
- **`import_apply(plan) -> ImportSummary`:**
  - takes an automatic backup first, through the existing `backup` module, as the migration hook does;
  - then, in one transaction, inserts each record with `INSERT OR IGNORE` by primary key, counting what was added and what was already present;
  - checks every foreign reference (host, entry or engagement ids) inside the plan or against existing rows, and fails the whole import with `AppError::Validation` on a dangling one;
  - decodes and size-checks attachments as `log.rs` does.
- **Reuse:** use the existing insert helpers where they accept explicit ids. Otherwise use direct SQL matching the 0002–0004 schemas.

- [ ] **Step 1: Failing Rust tests:**
  - `import_adds_everything_and_counts`;
  - `reimport_is_add_only_and_reports_present` (Review Focus 1);
  - `import_takes_a_backup_first`;
  - `a dangling reference rolls back everything` (Review Focus 3);
  - `import_respects_existing_rows` (a pre-existing host with the same id is untouched).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cargo test`, clippy and typecheck. Expected: green.
- [ ] **Step 5: Commit** `feat(import): apply an import plan add-only after a backup`.

### Task 7: Settings → Import UI

**Files:**
- Create: `src/features/settings/ImportSection.tsx`
- Modify: `src/features/settings/SettingsPage.tsx`
- Test: `src/test/import.test.tsx`

**Behaviour:**
- **Choosing a file:** an Import section in Settings with "Choose backup…" (a hidden file input behind a Button). It reads the file as text and calls `readBackup`. Errors show in `role="alert"`, using the exact encrypted message.
- **The picker:**
  - shows `listImportable` rows with name, kind (lab or standalone), the engagement kind, host and log counts, and dates (first–last activity, or created);
  - each row has an Ink toggle, and nothing is selected by default;
  - Import is disabled until at least one row is selected.
- **Importing:** Import builds the plan and calls `import_apply`, showing "Backing up and importing…".
  - **Summary:** per type, "N added · M already present", plus skipped counts from the plan (redacted credentials, missing images, unknown goals, dangling hops).
  - **Afterwards:** invalidate all queries, so the dashboard shows the engagements.

- [ ] **Step 1: Failing tests:**
  - `an encrypted file shows the export-unencrypted message`;
  - `the picker starts with nothing selected and Import disabled`;
  - `importing a selected standalone calls import_apply with its plan and shows the summary`;
  - `the summary lists skipped redacted credentials`;
  - `a second import shows everything already present`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full checks. Expected: green.
- [ ] **Step 5: Commit** `feat(import): Settings import with picker and summary`.

---

## Rulings in this plan (for the user to check)

1. **Formats:** both 3.0.0 (the old app's current backup) and 2.0.0 (the legacy workspace export) are accepted, and a 3.0.0 checksum is verified.
2. **Ids:** the old ids are kept, which makes re-import add-only by id. A standalone's engagement id is `<machineId>#e`.
3. **Board column** comes from the old status: backlog or recon → Enumerate, foothold → Foothold, root → Loot/Pivot, completed → Done.
4. **Old log entries** become `command` entries, or `note` when they have no command text. None are private.
5. **Port-triage notes** go into the host's field notes under "## Port triage", since services have no notes field.
6. **Old screenshots** become screenshot log entries when their image is in the backup.
7. **Old flags** (`userFlag`/`rootFlag`) become flag log entries.
8. **Checklist goal ids** that no longer exist (pre-rework `p0x-*` ids) are skipped and counted.
9. **Redacted credentials** are skipped and counted.
10. **Clipboard on lock:** Raven clears the clipboard on lock only when the last thing it copied was a secret.
11. **AD set:** automatic (the DC is detected by ports 88 and 389), or set by hand per host. Exam sims count the AD set as one target and one flag.
