# Raven Step 6: Domain Admin Cover, Stuck View and Cleanup List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish phase 1:
- once domain admin is confirmed, the privesc and loot work on domain-joined hosts is marked as covered;
- a per-host stuck view opens with one key;
- each engagement keeps a cleanup list of artifacts left on targets, suggested from the log.

**Architecture:**
- **Domain admin cover** is a pure TS engine (`engines/checklist/daCover.ts`). It is applied in the same resync pass that already syncs the board, so every trigger (host, service, checklist or attempt change, and engagement open) covers it.
- **Cleanup list** is stored in a new table (migration 0006) with a Rust CRUD module. Suggestions are computed in TS from the log and never stored until the user confirms or dismisses them.
- **Stuck view** is a pure TS engine (`engines/stuck/`) feeding an overlay opened with `H` from the host view.

**Tech Stack:** Tauri 2 (Rust, rusqlite + SQLCipher), React 19, TypeScript, TanStack Query, zustand, Tailwind v4, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-03-raven-desktop-design.md`. This plan covers §5.3 (stuck view), §6.4 (stuck check), §6.7 (cleanup list), plus the user's domain admin decision below.

## Global Constraints

- **Real backups:** never opened, read, copied or committed. These are `a file outside the repo` and any `docs/*backup*.json`. Tests use synthetic fixtures only.
- **Storage changes** go through migration `0006_cleanup.sql`. The migration runner takes a backup first, as for 0001–0005.
- **Domain admin cover:** the user's decisions, verbatim.
  - **Trigger:** only a credential attempt with result `admin` on the DC host (`findDcHost`). A hop to the DC does not count.
  - **Hosts:** domain-joined hosts by the existing `hostFacts(...).domainJoined` rule, i.e. the DC plus Windows hosts in an engagement with AD. All engagement kinds.
  - **Items:** applicable goals of the `privesc` and `loot` stages whose status is `todo` become `na`, shown as "Covered by domain admin". The proof goal `h-pe-proof` is never touched. Pivot and closeout are never touched.
  - **Never changed:** anything the user set by hand (`done`, `in_progress` or `na` with `auto` false), and item notes.
  - **Reverts:** when the trigger goes away, items marked by the cover go back to `todo`.
  - **Later hosts:** a host added after domain admin is covered on the next resync.
  - The goal `e-ad-da-loot-all` ("Loot every host with the new access") is removed from the Domain admin stage.
- **Cleanup suggestions need confirmation:** nothing is added to the list without the user confirming it (spec §12.5).
- **Ink design:** the accent `#c6ff00` is only for meaning. Use only `src/ui` controls. `cx` does not merge Tailwind classes: put width and colour on a wrapper element, never on a `src/ui` control.
- **Keys:** `L`, `N`, the number keys and `Esc` keep their meanings. `H` (help) opens the stuck view from a host view. `S` stays free for later. Use `isFreeKey` for every new key.
- **No new sidebar section:** the cleanup list lives inside the Engagement checklist section. The sidebar and number keys stay as they are.
- **Commits:** add files by explicit path only, never `git add -A` or `git add .`. End every commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push or merge. Never run `npm run tauri dev` from an agent.

## Review Focus

1. **A goal the user marked by hand while domain admin holds** stays exactly as the user left it, including when the trigger later goes away. Covered by Task 1's tests `manual statuses and notes are never changed` and `revert touches only cover-marked items`.
2. **A cover-marked item later ticked from a log command, whose evidence is then removed,** goes back to `todo` (and is re-covered while domain admin holds). It never ends up as a stuck manual N/A. Covered by Task 1's test `auto-tick on a covered item then evidence removal returns to todo`.
3. **`wget … -O linpeas.sh` run on Kali** (no target shell) is never suggested for cleanup. The same command in a target shell is. Covered by Task 3's test `a download on Kali is not suggested`.
4. **A suggestion the user dismissed or added** never shows again as a suggestion after the log is re-read. Covered by Task 3's test `dismissed and added keys are filtered`, and Task 4's test `dismissing hides the suggestion for good`.
5. **The stuck view for a host with no services, no OS and no notes** still opens and says what to do next (import a scan, set the OS), never a blank panel. Covered by Task 5's test `a bare host gets next-step hints` and Task 6's test `opens on a bare host`.

---

### Task 1: Domain admin covers the domain

**Files:**
- Create: `src/engines/checklist/daCover.ts`
- Modify:
  - `src/engines/checklist/index.ts`: export it.
  - `src/engines/checklist/data/engagementChecklist.ts`: remove the `e-ad-da-loot-all` goal.
  - `src/engines/checklist/autoTick.ts` `applyTicks`: a cover-marked item gets no `autoFrom`.
  - `src/engines/credentials/state.ts`: use the shared trigger.
  - `src/features/checklist/ticks.ts`: apply the cover inside `resyncBoards`.
  - The files that invalidate `credAttemptsKey`: also resync.
  - `src/features/checklist/GoalRow.tsx`: the "Covered by domain admin" label.
- Test:
  - `src/test/engines/checklist/daCover.test.ts`
  - `src/test/daCover.test.tsx`

**Interfaces:**
- Consumes:
  - `findDcHost(hosts, servicesByHost): Host | null` and `hostFacts(...)` from `engines/checklist/facts.ts`;
  - `applicableGoals(host, engagement, hosts, servicesByHost)` from `engines/checklist`, which returns `{ stage, goals }` groups;
  - `ChecklistState` and `ItemState` from `src/types/checklist.ts`;
  - `CredAttempt` from `src/types/credentials.ts`.
- Produces:
  - `domainAdminConfirmed(hosts: Host[], servicesByHost: ServicesByHost, attempts: CredAttempt[]): boolean`
  - `isCoverMarked(item: ItemState | undefined): boolean`. This is true when `item.auto === true && item.status === "na"`; auto-tick never produces that pair (see Step 3).
  - `daCoverChanges(input: { engagement: Engagement; hosts: Host[]; servicesByHost: ServicesByHost; attempts: CredAttempt[]; byOwner: Map<string, ChecklistState> }): Map<string, ChecklistState>`. It returns only owners whose state changes, with the full new state for each.
  - `DA_COVER_LABEL = "Covered by domain admin"`

- [ ] **Step 1: Write the failing engine tests** in `daCover.test.ts`. Use synthetic hosts:
  - DC: Windows, 88 and 389 open.
  - WS01: Windows.
  - LIN01: Linux.

  Tests:
  - `no admin result on the DC means no cover`: a `valid` attempt on the DC, or `admin` on WS01, gives `daCoverChanges(...).size === 0`.
  - `admin on the DC covers todo privesc and loot on DC and WS01`. For WS01, every applicable privesc goal except `h-pe-proof`, and every loot goal, becomes `{ status: "na", auto: true }`. `h-pe-proof` is absent or unchanged. Pivot and closeout goals are unchanged.
  - `Linux hosts are not covered`: LIN01 is not in the result.
  - `manual statuses and notes are never changed`. WS01 has `h-pe-win-privs` `{status:"done", auto:false}`, `h-pe-win-groups` `{status:"na", auto:false}`, `h-loot-sweep` `{status:"in_progress"}` and `h-loot-hashes` `{status:"todo", notes:"check SAM"}`. The first three are untouched. `h-loot-hashes` becomes `{status:"na", auto:true, notes:"check SAM"}`.
  - `revert touches only cover-marked items`: with the admin attempt removed, cover-marked items become `{status:"todo"}` with `auto` cleared and notes kept. The manual `na` from the previous test stays `na`.
  - `a host added later is covered`: a second call with a new Windows host WS02 covers WS02 only.
  - `the Domain admin stage has no loot-all goal`: `e-ad-da-loot-all` appears in no stage.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/checklist/daCover.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `daCover.ts`, and change `applyTicks`. When the existing item `isCoverMarked`, the ticked item gets `auto: true, status: "done"` and NO `autoFrom`, so removing the evidence returns it to `todo`. Add the test `auto-tick on a covered item then evidence removal returns to todo` to `daCover.test.ts`, using `applyTicks` then `removeEntryTicks`. Move the `daByAttempt` logic in `engines/credentials/state.ts` onto `domainAdminConfirmed`, so there is one definition of the trigger.
- [ ] **Step 4: Run** the engine tests again. Expected: PASS.
- [ ] **Step 5: Wire it.**
  - `resyncBoards(engagementId)` loads attempts with `api.credAttemptsList(engagementId)`, computes `daCoverChanges`, and writes the changed items with `api.checklistPut` (one batch) before `syncBoards`. `syncBoards` then sees the new states.
  - Every mutation that invalidates `credAttemptsKey(eid)` (credential queries, the matrix popover, `applyIntake`) also runs `resyncBoards(eid)`, then invalidates `checklistKey(eid)` and `["hosts", eid]`. Failures go to `reportError`.
  - On engagement open (`EngagementShell`), after `autoTickFromLog`, run `resyncBoards` once, so imported or older engagements get covered.
  - In `GoalRow`, a cover-marked item shows the muted text `DA_COVER_LABEL` beside its status.
- [ ] **Step 6: UI tests** in `src/test/daCover.test.tsx`, mocking `api` as other UI tests do:
  - `setting an admin result on the DC marks WS01 privesc as covered`: after the attempt mutation, `checklistPut` is called with WS01 items `{status:"na", auto:true}`, and the row shows "Covered by domain admin".
  - `changing a covered item by hand drops the label`: `setStatus` to `todo` sends `auto:false`, and the label is gone.
- [ ] **Step 7: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: all green.
- [ ] **Step 8: Commit** `feat(checklist): domain admin covers privesc and loot on domain-joined hosts`.

---

### Task 2: Cleanup list storage

**Files:**
- Create:
  - `src-tauri/migrations/0006_cleanup.sql`
  - `src-tauri/src/cleanup.rs`
  - `src/types/cleanup.ts`
- Modify:
  - the migration list (wherever 0005 is registered);
  - `src-tauri/src/lib.rs` and `src-tauri/src/commands.rs`: the commands;
  - `src/lib/api.ts`.
- Test: Rust unit tests in `cleanup.rs`.

**Interfaces:**
- Produces:
  - **Table `cleanup_items`:**
    - `id TEXT PRIMARY KEY`
    - `engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE`
    - `host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL`
    - `kind TEXT NOT NULL CHECK (kind IN ('file','account','service','other'))`
    - `target TEXT NOT NULL`
    - `notes TEXT`
    - `source_entry_id TEXT REFERENCES log_entries(id) ON DELETE SET NULL`
    - `suggestion_key TEXT`
    - `status TEXT NOT NULL CHECK (status IN ('open','removed','dismissed'))`
    - `removed_at INTEGER`
    - `created_at INTEGER NOT NULL`
    - `updated_at INTEGER NOT NULL`
    - `UNIQUE (engagement_id, suggestion_key)`

    Plus an index on `engagement_id`.
  - **Rust commands:**
    - `cleanup_list(engagement_id) -> Vec<CleanupItem>`, all statuses, oldest first;
    - `cleanup_create(engagement_id, input: CleanupInput) -> CleanupItem`;
    - `cleanup_update(id, input: CleanupInput) -> CleanupItem`;
    - `cleanup_set_removed(id, removed: bool) -> CleanupItem`, which sets `status` `removed`/`open` and stamps or clears `removed_at`;
    - `cleanup_dismiss(engagement_id, suggestion_key) -> ()`, which inserts a `dismissed` row with `kind='other'` and `target=suggestion_key`;
    - `cleanup_delete(id) -> ()`;
    - `cleanup_counts() -> HashMap<String, i64>`: open items per engagement.
  - **`CleanupInput`:** `{ hostId: Option<String>, kind, target, notes: Option<String>, sourceEntryId: Option<String>, suggestionKey: Option<String> }`, camelCase.
  - **Validation:** `target` is trimmed, 1–500 chars; `notes` is at most 2000 chars; `host_id`, if set, belongs to the same engagement. Both create and update enforce these. Violations return `AppError::Validation` with the field name. A duplicate `suggestion_key` is a Validation error on `suggestionKey`.
  - **TS:**
    - `src/types/cleanup.ts` mirrors `CleanupItem` and `CleanupInput`;
    - `api.cleanupList`, `cleanupCreate`, `cleanupUpdate`, `cleanupSetRemoved`, `cleanupDismiss`, `cleanupDelete` and `cleanupCounts`.

- [ ] **Step 1: Write failing Rust tests** in `cleanup.rs`:
  - `create_list_update_roundtrip`;
  - `set_removed_stamps_and_clears_removed_at`;
  - `dismiss_inserts_a_dismissed_row_and_a_second_dismiss_or_create_with_the_same_key_is_rejected`;
  - `host_from_another_engagement_is_rejected`;
  - `blank_or_long_target_is_rejected`;
  - `counts_only_open_items_per_engagement`;
  - `deleting_the_engagement_deletes_its_items_and_deleting_the_entry_keeps_the_item`.
- [ ] **Step 2: Run** `cd src-tauri && cargo test cleanup`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration, module, commands and TS API.
- [ ] **Step 4: Run** `cargo test`, `cargo clippy --all-targets -- -D warnings`, `npm run typecheck`. Expected: all green, with the migration tests that already exist still passing.
- [ ] **Step 5: Commit** `feat(cleanup): cleanup list storage (migration 0006)`.

---

### Task 3: Cleanup suggestions from the log

**Files:**
- Create: `src/engines/cleanup/suggest.ts` and `src/engines/cleanup/index.ts`
- Test: `src/test/engines/cleanup/suggest.test.ts`

**Interfaces:**
- Consumes:
  - `LogEntry`, `CommandBlock` from `src/types/log.ts`;
  - `shellHost(shell, ranOn, hosts, domain)` and `namedHostsInLine` from `src/engines/attribution.ts` and the checklist engine;
  - `CleanupItem` from Task 2.
- Produces:
  - `interface CleanupSuggestion { key: string; entryId: string; hostId: string | null; kind: "file" | "account" | "service"; target: string; command: string }`
  - `suggestCleanup(entries: LogEntry[], hosts: Host[], domain: string, known: CleanupItem[]): CleanupSuggestion[]`
    - `key` is `${entryId}:${blockIndex}:${target}`.
    - Suggestions whose key matches any `known[].suggestionKey` (open, removed or dismissed) are dropped.
    - Only `kind === "command"` entries are read, newest entry first.

**Patterns.** One suggestion per match, read line by line from each block's `command`.
- **Target-side writes** count only when `shellHost(block.shell, entry.ranOn, …)` resolves a host, and that host becomes `hostId`:
  - `wget … -O <path>` / `-O<path>` / `--output-document=<path>` → file;
  - `curl … -o <path>` / `--output <path>` → file;
  - `certutil … -urlcache … <url> <path>`, where the last argument is the path → file;
  - `iwr` / `Invoke-WebRequest` / `wget` (PowerShell alias) `… -OutFile <path>` → file;
  - `net user <name> … /add` → account `<name>`;
  - `useradd … <name>` / `adduser <name>`, where the last non-flag argument is the name → account;
  - `sc create <name>` / `sc config <name>` / `New-Service -Name <name>` → service `<name>`.
- **Pushes from Kali** count in any shell. `hostId` is the host named in the line, else `entry.hostIds[0]`, else null:
  - `scp <src> <user@host-or-ip>:<path>` (remote destination only) → file `<path>`;
  - `smbclient … -c 'put <src> [<dest>]'` or a line `put <src> [<dest>]` in an smbclient block → file `<dest ?? basename(src)>`;
  - evil-winrm or meterpreter `upload <src> [<dest>]` → file `<dest ?? basename(src)>`.
- **Quotes:** a quoted path keeps its spaces, without the quotes.

- [ ] **Step 1: Write failing tests** with synthetic entries, one per pattern above asserting `kind`, `target` and `hostId`. Plus:
  - `a download on Kali is not suggested`: `wget http://x/linpeas.sh -O linpeas.sh` with no shell and null `ranOn` gives `[]`. The same command with the shell `www-data@web01:/tmp$` (web01 is a host) gives one file suggestion `linpeas.sh` on web01.
  - `scp from the target to Kali is not suggested`: `scp user@10.0.0.5:/etc/passwd .` gives `[]`.
  - `dismissed and added keys are filtered`: `known` holds one dismissed and one open item carrying two of three keys, and only the third is returned.
  - `keys are stable`: the same input gives the same keys twice.
  - `non-command entries are ignored`: note, screenshot, http and flag entries.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/cleanup`. Expected: FAIL.
- [ ] **Step 3: Implement** `suggest.ts`.
- [ ] **Step 4: Run** the tests again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cleanup): suggest cleanup items from logged commands`.

---

### Task 4: Cleanup panel and counts

**Files:**
- Create:
  - `src/features/cleanup/CleanupPanel.tsx`
  - `src/features/cleanup/CleanupDialog.tsx` (add or edit by hand)
  - `src/features/cleanup/queries.ts`
- Modify:
  - `src/features/checklist/EngagementChecklist.tsx`: render `CleanupPanel` as a "Cleanup" section after the playbooks. No sidebar section is added.
  - `src/features/engagements/StatusStrip.tsx`: the cleanup count.
  - `src/features/engagements/ActiveCard.tsx`: the cleanup count.
  - `src/features/hosts/queries.ts` `useHostMutations().remove`: also invalidate the cleanup keys.
- Test: `src/test/cleanup.test.tsx`

**Interfaces:**
- Consumes: the Task 2 API and Task 3 `suggestCleanup`.
- Produces:
  - `cleanupKey(eid) = ["cleanup", eid]`
  - `cleanupCountsKey = ["cleanupCounts"]`
  - `useCleanup(eid)` and `useCleanupMutations(eid)`. Every mutation invalidates both keys.

**Behaviour:**
- **Suggested.** Shown at the top when non-empty. Each row shows the kind chip, target (mono), host name and the source command (mono, truncated). Each row has two buttons:
  - **Add**: `cleanupCreate` with `suggestionKey`, `sourceEntryId`, `hostId`, `kind` and `target`;
  - **Dismiss**: `cleanupDismiss`.
- **On target.** Open items. Each row has kind, target, host, notes, a "Mark removed" toggle, Edit and Delete. Delete asks for confirmation.
- **Removed.** Items marked removed, dimmed, with the date removed. The toggle sets them back to open.
- **Dismissed** rows are never shown.
- **"Add item"** opens `CleanupDialog`, with kind (Select), target, host (Select, optional) and notes.
- **Counts.** The status strip shows `Cleanup <n>` when n > 0, and so does the dashboard active card. n is the open items from `cleanupCounts`.
- **Empty state.** "Nothing left on targets yet. Uploads, created accounts and services you log will be suggested here."

- [ ] **Step 1: Write failing tests:**
  - `suggestions from the log show and Add creates the item`;
  - `dismissing hides the suggestion for good`: after dismiss and refetch, it's not shown;
  - `marking removed moves the item to Removed and back`;
  - `add by hand validates the target`: a blank target keeps the dialog open with an error;
  - `the strip and card show the open count`;
  - `the Engagement checklist shows the Cleanup panel and the sidebar is unchanged`: still 6 sections, with Report on key 6.
- [ ] **Step 2: Run** `npx vitest run src/test/cleanup.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: green.
- [ ] **Step 5: Commit** `feat(cleanup): cleanup panel with suggestions and counts`.

---

### Task 5: Stuck engine

**Files:**
- Create: `src/engines/stuck/hostStuck.ts`, `src/engines/stuck/engagementStuck.ts` and `src/engines/stuck/index.ts`
- Test: `src/test/engines/stuck/hostStuck.test.ts` and `src/test/engines/stuck/engagementStuck.test.ts`

**Interfaces:**
- Consumes:
  - `applicableGoals`, `hostFacts` and `goalCommands`/fill from the checklist engine;
  - `openThreads(body)` from `engines/notes/threads.ts`;
  - `accessFlags`, `cellFor`, `hostSprayServices`, `isSprayable` and `routineStepApplies` from `engines/credentials`;
  - `isCoverMarked` from Task 1.
- Produces:
  - `type StuckPhase = "before-foothold" | "after-foothold"`. A host has a foothold when `host.access !== "none"` or any of `h-foot-shell`, `h-foot-creds` or `h-foot-arrived` is `done`.
  - `interface UnidentifiedService { service: Service; reason: "guess" | "no-version"; nudges: { label: string; command: string }[] }`
  - `interface HostStuck { phase: StuckPhase; skipped: { goalId: string; title: string; status: "na" }[]; unidentified: UnidentifiedService[]; untouched: Service[]; threads: Thread[]; commands: { goalId: string; title: string; commands: string[] }[]; notes: string; hints: string[] }`
  - `hostStuck(input: { host; engagement; hosts; servicesByHost; state: ChecklistState; entries: LogEntry[]; hostNote: string; fill: FillInput }): HostStuck`
  - `type StuckLine = { area: "foothold" | "credentials" | "privesc" | "lateral"; text: string; hostId: string | null; goalId?: string }`
  - `engagementStuck(input: { engagement; hosts; servicesByHost; byOwner; credentials; attempts; usernames; tunnels }): StuckLine[]`. This is the port of old Raven's `stuckCheck` (the old app's repo), with the same lines, texts and area order, adapted to the new types. In exam sims, banned commands are already hidden by the checklist engine.

**Rules (spec §5.3):**
- **Before a foothold:**
  - `skipped`: applicable goals marked `na` by hand. Cover-marked items are excluded.
  - `unidentified`: open services with `confirmedProduct` null whose `nmapService` ends with `?` (reason "guess"), or that have no `nmapVersion` (reason "no-version"). Each gets three filled nudges for its IP and port:
    - `Talk to it`: `nc -nv <ip> <port>`, then type `help`;
    - `Rescan just these ports`: `nmap -sV --version-all -p <all unidentified ports, comma-joined> <ip>`;
    - `Grab the banner`: `echo | nc -nv -w 3 <ip> <port>`.
  - `untouched`: open services whose port number never appears as a whole word, or after `:`, in any command block of an entry tagged with this host.
  - `threads`: the host note's open threads.
- **After a foothold:**
  - `commands`: the filled commands of every applicable goal still `todo` in the privesc, loot and pivot stages, grouped by goal;
  - `notes`: the host note body;
  - `threads`: the host note's open threads.
- **`hints`, plain sentences, in any phase:**
  - "Import a scan to see service steps" when the host has no services;
  - "Set the OS to see privesc steps" when the OS is unset;
  - "Nothing obvious left on this host" when every list is empty.

- [ ] **Step 1: Write failing tests** with synthetic data:
  - `before a foothold: na goals, guessed and versionless services with filled nudges, untouched services, threads`;
  - `cover-marked items are not listed as skipped`;
  - `after a foothold: todo privesc and loot commands, notes and threads`;
  - `a bare host gets next-step hints`;
  - `a port mentioned in a logged command is not untouched`;
  - `engagementStuck`: one test per line type (no foothold with enumeration left, untested cells, never sprayed, usernames not AS-REP-checked, unreviewed access, dual-homed without a tunnel), plus `lines are ordered foothold, credentials, privesc, lateral`.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/stuck`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(stuck): host stuck view and engagement stuck check engines`.

---

### Task 6: Stuck view

**Files:**
- Create: `src/features/stuck/StuckView.tsx`
- Modify:
  - `src/features/hosts/HostView.tsx`: the `H` key, plus a "Stuck?" button in the header row showing the `H` key hint;
  - `src/features/checklist/EngagementChecklist.tsx`: an engagement "Stuck check" panel at the top, collapsed by default, showing the `engagementStuck` lines grouped by area with counts.
- Test: `src/test/stuck.test.tsx`

**Interfaces:**
- Consumes: Task 5's `hostStuck` and `engagementStuck`; the existing queries for hosts, services, checklist, log, notes, credentials and tunnels.

**Behaviour:**
- **Opening and closing.** `H` (via `isFreeKey`) in a host view opens the stuck view as an overlay on the right, like the notes panel. `Esc` or `H` closes it.
- **Layout.** All on one screen with no tabs. The headline is "Stuck on <host>", followed by the phase label: "Before a foothold" or "After a foothold".
- **Sections in order, empty ones hidden:**
  - before a foothold: Skipped steps, Unidentified services, Never touched, Open threads;
  - after a foothold: Commands to try, Notes, Open threads.
- **Rows.**
  - Each nudge and command has the existing copy button, using the same copy path as checklist commands, so secrets stay masked.
  - Each skipped step links to the host checklist on that goal, reusing the `focusGoal` mechanism.
  - Hints show as muted text.
- **Engagement panel.** Each line opens its host (and goal) when clicked.

- [ ] **Step 1: Write failing tests:**
  - `H opens the stuck view and Esc closes it`;
  - `H while typing in an input does nothing`;
  - `opens on a bare host`, which shows the hints;
  - `before a foothold shows the nudges for a guessed service`, with `nc -nv 10.0.0.5 9999` present;
  - `after a foothold shows todo privesc commands`;
  - `the engagement stuck check lists dual-homed hosts without a tunnel`.
- [ ] **Step 2: Run** `npx vitest run src/test/stuck.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`, `cd src-tauri && cargo test`. Expected: all green.
- [ ] **Step 5: Commit** `feat(stuck): stuck view on S and engagement stuck check`.

---

## Rulings in this plan (for the user to check)

1. **How a cover mark is stored:** an item with `auto: true` and status `na`. No new column is needed, and auto-tick never produces that pair. Changing the item by hand clears the mark.
2. **Re-checking the cover:** it is re-checked whenever the board resyncs (host, service, checklist or attempt changes) and once on engagement open.
3. **Cleanup patterns:** the spec's list, plus `sc create/config`, `New-Service`, evil-winrm/meterpreter `upload` and smbclient `put`. Downloads count only when run in a target shell, so tools fetched onto Kali are never suggested.
4. **Dismissed suggestions** are stored as hidden rows, so they never come back.
5. **Cleanup lives in the Engagement checklist** as its own section after the playbooks. This is the user's decision. The sidebar is unchanged.
6. **Stuck view key:** `H`, for help. This is the user's decision, and `S` is kept free. The engagement-wide stuck check from old Raven sits at the top of the Engagement checklist, collapsed.
7. **A host has a foothold** when its access is user or root, or a foothold goal is done.
