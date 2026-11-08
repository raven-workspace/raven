# Raven step 3: checklist, field notes and threads, Metasploit lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build order step 3. The host and engagement checklists are ported with applicability, filled commands, auto-tick from the log and exam rules. The board moves itself as stages complete. Field notes (`N`) with open threads are added, and so is the exam-sim Metasploit lock.

**Architecture:**
- The old checklist engine is ported as pure TypeScript under `src/engines/checklist/`, adapted to Raven's `Host` / `Service` / `LogEntry` / `Engagement` types.
- Rust stores the state (checklist items, notes, ruled-out items, tunnels, hops, the Metasploit lock) behind thin commands.
- The UI derives everything else on render. Ticks are computed in TS after each log save, edit or delete, then written with `checklist_put`.
- "Tick from log" re-derives every tick from the whole log, which repairs a failed or partial write.

**Tech Stack:** Tauri 2, rusqlite (SQLCipher), React 19, TypeScript, Tailwind v4, TanStack Query, zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-raven-desktop-design.md`. This plan covers §5.2 (Engagement checklist, board movement), §5.3 (Now, Checklist tab), §6.1 (auto-tick, flag proofs), §6.2 (applicability from the confirmed identity), §6.3, §6.4 and §6.5 (Metasploit lock; the timebox shipped in step 1).

**Old engine (read-only source):** the old app's repo:
- engine: `src/utils/checklist/*`, `src/utils/variableSubstitution.ts`;
- data: `src/data/hostChecklist.ts`, `src/data/engagementChecklist.ts`;
- tests: `src/test/checklist/*.test.ts`.

Don't port `migration.ts`, `library.ts` (operator library editing is phase 2, Arsenal), sync, or anything credential-backed (step 4). Never modify pwndash.

**Branch:** `step3-checklist-notes` from `main` (b144f2f).

## Global Constraints

- **Real data:** stored data is real lab data. Storage changes go through a numbered migration, and the runner takes a backup first. Tests use synthetic data only. Never open a file outside the repo.
- **Engagement kinds** are `exam-sim` / `lab` / `client`. Old `challenge-lab` → `lab`, old `real` → `client`. Change every `kinds:` in ported data.
- **Host stage order** stays as in the spec: enumerate, foothold, stabilize, orient (`local.txt`), privesc (ending with `proof.txt`), loot, pivot, closeout.
- **Board columns:** Enumerate · Foothold · Privesc · Loot/Pivot · Done (`BoardColumn` in `src/types/host.ts`).
- **Ink design:**
  - black background, white/grey text;
  - the accent `#c6ff00` only where it carries meaning (active selection, access held, done ticks);
  - no stock component styling, and no native select/checkbox/radio;
  - reuse `src/ui/*`.
- **Keys:**
  - `L` capture and `N` field notes; `Esc` closes overlays.
  - Number keys switch sections. They must not fire while typing in an input or textarea; reuse `src/lib/keys.ts`.
  - New keys: `⌘E` switches the notes panel between host and engagement notes; `⌘/` toggles the `? ` thread prefix on the current notes line.
- **Copy:** "Observations" stays the log field name. The thread prefix is `? ` (question mark, space).
- **Private:** "Private" marks on notes and ruled-out items mean the content is never put in a client report or export.
- **Commits:** one commit per task on the branch, with the co-author trailer from the session. Never push or merge.

## Review Focus

1. **Editing a log entry** (changing its command or its hosts) moves its ticks exactly: old evidence goes, new evidence comes, `completedAt` is kept for goals it still ticks, and goals set by hand are untouched. Owned by Task 6.
2. **Status history:** a goal set to N/A or Doing by hand, then auto-ticked, then its entry deleted, goes back to N/A or Doing, not To do. Owned by Task 5 (engine) and Task 6 (wiring).
3. **Exam sims:**
   - banned commands never appear in the Checklist tab, in Now, or in any filled-command list;
   - Metasploit commands appear only on the locked host once a lock exists.

   Owned by Tasks 7 and 8.
4. **Notes are never lost:** text typed into notes survives closing the panel, switching host or engagement notes with `⌘E`, navigating away, and auto-lock. Pending text is flushed before the vault locks. Owned by Task 10.
5. **Deleting things:**
   - deleting a host removes its checklist items, notes, ruled-out items, tunnels through it and hops to or from it, so no counts or dots are orphaned;
   - deleting a log entry leaves no evidence pointing at it.

   Owned by Tasks 2 and 6.

---

## File map

**Rust (`src-tauri/`):**
- `migrations/0003_checklist_notes.sql`: new.
- `src/migrations/mod.rs`: the frozen 0002 backfill.
- `src/checklist.rs`, `src/notes.rs`, `src/network.rs`: new; `network.rs` holds tunnels and hops.
- `src/hosts.rs`, `src/engagements.rs`, `src/settings.rs`, `src/commands.rs`, `src/lib.rs`: changed.

**TS engines (`src/engines/checklist/`):**
- `data/hostChecklist.ts` and `data/engagementChecklist.ts`;
- `types.ts`, `facts.ts` (applicability, ports and DC), `template.ts` (resolveTemplate) and `fill.ts`;
- `autoTick.ts`, `examRules.ts`, `scanImport.ts`, `board.ts`, `index.ts`;
- `src/engines/notes/threads.ts`.

**TS UI:**
- `src/features/checklist/*`: queries, GoalRow, CommandList, HostChecklist, NowPanel, EngagementChecklist, TunnelsPanel, HopsPanel and the tick wiring.
- `src/features/notes/*`: NotesPanel, useNotesStore, queries and CloseThreadDialog.
- `src/features/engagements/MsfLock.tsx`.
- Changed: `src/types/*`, `src/lib/api.ts`, `src/features/capture/saveCapture.ts`, `src/features/log/*`, `src/features/hosts/*`, `src/features/board/*`, `EngagementShell` / `StatusStrip` / `Sidebar`, `Dashboard` cards and `Settings`.

**Tests:** `src-tauri` unit tests sit next to the code. UI tests go in `src/test/**`, following step 2's layout.

---

### Task 1: Freeze the 0002 backfill; migration 0003 and checklist storage

**Files:**
- Create: `src-tauri/migrations/0003_checklist_notes.sql`, `src-tauri/src/checklist.rs`
- Modify: `src-tauri/src/migrations/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src/lib/api.ts`
- Create: `src/types/checklist.ts`
- Test: in-file Rust tests

**Interfaces (Produces):**
- **Migration 0003 SQL**, exactly these objects:
  - `checklist_items(owner_id TEXT NOT NULL, engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE, goal_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('todo','in_progress','done','na')), notes TEXT, completed_at INTEGER, auto INTEGER NOT NULL DEFAULT 0, auto_from TEXT CHECK(auto_from IN ('na','in_progress')), evidence TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL, PRIMARY KEY(owner_id, goal_id))`. Here `owner_id` is a host id, or the engagement id for engagement goals.
  - `notes(owner_id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE, host_id TEXT REFERENCES hosts(id) ON DELETE CASCADE, body TEXT NOT NULL DEFAULT '', private INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`.
  - `ruled_out(id TEXT PRIMARY KEY, engagement_id … CASCADE, host_id … REFERENCES hosts(id) ON DELETE CASCADE, text TEXT NOT NULL, reason TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`.
  - `tunnels(id TEXT PRIMARY KEY, engagement_id … CASCADE, kind TEXT NOT NULL CHECK(kind IN ('ligolo','chisel','ssh','socks','other')), via_host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE, subnets TEXT NOT NULL DEFAULT '[]', callback_ip TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('up','down')), notes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`.
  - `hops(id TEXT PRIMARY KEY, engagement_id … CASCADE, from_host_id TEXT REFERENCES hosts(id) ON DELETE CASCADE, to_host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE, via TEXT NOT NULL, log_entry_id TEXT REFERENCES log_entries(id) ON DELETE SET NULL, at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`.
  - `ALTER TABLE hosts ADD COLUMN dual_homed INTEGER NOT NULL DEFAULT 0`
  - `ALTER TABLE hosts ADD COLUMN board_derived TEXT`
  - `ALTER TABLE engagements ADD COLUMN msf_host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL`

  Settings keys `attacker_ip` and `listener_port` use the existing settings key/value storage; no new table.
- **Rust** `checklist.rs`:
  - `ChecklistItem { owner_id, goal_id, status, notes: Option<String>, completed_at: Option<i64>, auto: bool, auto_from: Option<String>, evidence: Vec<Evidence>, updated_at }` and `Evidence { entry_id: String, command_id: Option<String> }`, both serde camelCase.
  - `pub fn list(conn, engagement_id) -> AppResult<Vec<ChecklistItem>>`.
  - `pub fn put(conn, engagement_id, items: &[ChecklistItemInput]) -> AppResult<Vec<ChecklistItem>>`. `ChecklistItemInput` is the same struct without `updated_at`. It runs as one transaction and upserts on `(owner_id, goal_id)`.
  - `put` rejects with `AppError::Invalid`:
    - an `owner_id` that is neither the engagement id nor a host of that engagement;
    - a status or `auto_from` outside the CHECK sets;
    - more than 500 items.
- **Commands:** `checklist_list(engagementId)` and `checklist_put(engagementId, items)`.
- **TS** in `src/types/checklist.ts`:
  - `ChecklistStatus = 'todo'|'in_progress'|'done'|'na'`;
  - `Evidence = { entryId: string; commandId?: string | null }`;
  - `ChecklistItem` mirrors the Rust struct;
  - `ItemState = { status; notes?; completedAt?; auto?; autoFrom?; evidence? }`. This is the engine's per-goal shape, the old `itemsState[goalId]`.
  - `ChecklistState = Record<string /*goalId*/, ItemState>`.
- **api.ts:** `checklistList(engagementId)` and `checklistPut(engagementId, items)`.

- [ ] **Step 1: Freeze the backfill.**
  - Write the test `migration_0002_backfill_is_frozen`: it opens a v1 database with an engagement whose scope is `["10.10.10.5","10.10.10.0/24"]`, runs the full migration to the latest version, and asserts exactly one host `10.10.10.5` with `dual_homed = 0`.
  - Then change `backfill_hosts` so it no longer calls `crate::hosts::sync_scope`. Give it its own private copy of the single-IP check, and an INSERT naming only the 0002 columns (`id, engagement_id, name, ip, created_at, updated_at`).
  - Add a doc comment: "Frozen at 0002's schema; never call live host code from a migration."
- [ ] **Step 2: Run** `cargo test migrations`. Expected: PASS. It already passes before the change, since the live code still matches; the test pins the behaviour for later.
- [ ] **Step 3: Write 0003** with exactly the objects above, and register it in the migration list.
- [ ] **Step 4: Write the failing tests in `checklist.rs`:**
  - `put_then_list_round_trips_items_and_evidence`;
  - `put_upserts_on_owner_and_goal`;
  - `put_rejects_owner_from_other_engagement`;
  - `put_rejects_bad_status_and_auto_from`;
  - `put_is_atomic`: a batch with one bad item writes nothing;
  - `deleting_host_cascades_its_items`: insert via `put` for a host owner, delete the host with `hosts::delete`, assert `list` has none for it. `checklist_items` has no FK to hosts, so `hosts::delete` must `DELETE FROM checklist_items WHERE owner_id = ?1` in its transaction.
  - `migration_0003_from_v2_keeps_data`: a v2 database with a host and a log entry migrates, and both are still there with the new columns defaulted.
- [ ] **Step 5: Run** `cargo test checklist`. Expected: FAIL.
- [ ] **Step 6: Implement** `checklist.rs`, the host-delete cleanup and the commands, following `log.rs`'s patterns (off main thread, `AppError::Invalid` field errors).
- [ ] **Step 7: Run** `cargo test && cargo clippy --all-targets -- -D warnings`. Expected: PASS and clean. Then run `npm run typecheck` for the new TS types.
- [ ] **Step 8: Commit** `feat(store): migration 0003 and checklist item storage; freeze 0002 backfill`.

### Task 2: Notes, ruled-out items, tunnels, hops, host flags, Metasploit lock and attacker settings (Rust)

**Files:**
- Create: `src-tauri/src/notes.rs`, `src-tauri/src/network.rs`
- Modify: `src-tauri/src/hosts.rs`, `src-tauri/src/engagements.rs`, `src-tauri/src/settings.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/lib/api.ts`
- Create: `src/types/notes.ts`, `src/types/network.ts`
- Modify: `src/types/host.ts`, `src/types/engagement.ts`, `src/types/settings.ts`

**Interfaces (Produces):**
- **notes.rs:**
  - `Note { owner_id, engagement_id, host_id: Option<String>, body, private: bool, updated_at }`.
  - `get(conn, engagement_id, host_id: Option<&str>) -> AppResult<Note>` returns an empty unsaved note (`updated_at` 0) when there is no row.
  - `list(conn, engagement_id) -> Vec<Note>`.
  - `save(conn, engagement_id, host_id: Option<&str>, body: &str, private: bool) -> Note`. `owner_id` is the host id, or the engagement id when `host_id` is None.
  - Body limit: 1 MiB, else `Invalid("body")`.
- **RuledOut** `{ id, engagement_id, host_id: Option, text, reason, private, created_at }`, with `ruled_out_list`, `ruled_out_create(input)` and `ruled_out_delete(id)`. `text` and `reason` must be non-blank.
- **network.rs:**
  - `Tunnel { id, engagement_id, kind, via_host_id, subnets: Vec<String>, callback_ip, status, notes: Option, created_at, updated_at }`. Each subnet must parse with the existing scope CIDR validator; `callback_ip` must be blank or an IPv4.
  - `Hop { id, engagement_id, from_host_id: Option, to_host_id, via, log_entry_id: Option, at, updated_at }`.
  - Commands: `tunnels_list|tunnel_create|tunnel_update|tunnel_delete` and `hops_list|hop_create|hop_update|hop_delete`.
  - Every host id must belong to the engagement, and `from_host_id != to_host_id`.
- **Hosts:**
  - `Host` gains `dual_homed: bool` and `board_derived: Option<BoardColumn string>`.
  - `HostInput` gains `dual_homed: Option<bool>` (absent = keep).
  - New `pub fn sync_board(conn, host_id, derived: &str) -> AppResult<Host>`:
    - if `derived != board_derived`: set `board_column = derived`, `board_manual = 0`, `board_derived = derived`;
    - else leave everything.

    This is the spec's "a hand placement holds until the next stage completes". Command: `host_sync_board(hostId, derived)`.
- **Engagements:** `Engagement` gains `msf_host_id: Option<String>`, plus `engagement_set_msf_host(engagementId, hostId: Option)`. The host must belong to the engagement.
- **Settings:** `Settings` gains `attacker_ip: String` (blank or IPv4) and `listener_port: String` (blank or 1–65535). Both default to blank.
- **TS mirrors:**
  - `src/types/notes.ts`: `Note`, `RuledOut`, `RuledOutInput`;
  - `src/types/network.ts`: `Tunnel`, `TunnelInput`, `TunnelKind`, `Hop`, `HopInput`;
  - `Host.dualHomed`, `Host.boardDerived`, `HostInput.dualHomed?`;
  - `Engagement.msfHostId`;
  - `Settings.attackerIp`, `Settings.listenerPort`.
- **api.ts:** one function per command, camelCase, following the existing pattern.

- [ ] **Step 1: Write the failing Rust tests:**
  - `note_get_missing_is_empty`;
  - `note_save_upserts_host_and_engagement_notes_separately`;
  - `note_rejects_oversize_body`;
  - `ruled_out_crud_and_blank_rejected`;
  - `tunnel_validates_subnets_and_callback`;
  - `hop_rejects_self_hop_and_foreign_host`;
  - `sync_board_moves_only_when_derived_changes`:
    - manual move to `loot`, then `sync_board("enumerate")` with `board_derived` already `enumerate` → stays `loot`, manual;
    - then `sync_board("foothold")` → `foothold`, not manual.
  - `msf_lock_set_clear_and_foreign_host_rejected`;
  - `deleting_host_clears_its_notes_tunnels_hops_and_msf_lock`;
  - `settings_attacker_ip_and_port_validated`.
- [ ] **Step 2: Run** `cargo test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the modules, columns, commands and TS mirrors.
- [ ] **Step 4: Run** `cargo test && cargo clippy --all-targets -- -D warnings && npm run typecheck`. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(store): notes, ruled-out items, tunnels, hops, board sync, msf lock, attacker settings`.

### Task 3: Port checklist data and applicability; restore the library assertions

**Files:**
- Create: `src/engines/checklist/{types.ts,data/hostChecklist.ts,data/engagementChecklist.ts,facts.ts,index.ts}`
- Modify: `src/test/engines/library/commandLibrary.test.ts`
- Test: `src/test/engines/checklist/{data,applicability}.test.ts`

**Interfaces:**
- **Consumes:** `Host`, `Service`, `Engagement` types; `BUILTIN_LIBRARY` and `LibraryCommand` from `src/engines/library`.
- **Produces** in `types.ts`:
  - `ChecklistGoal`, `ChecklistStage`, `GoalApplies`, copied from old `src/types/checklist.ts`. Drop `legacyIds`, and use `kinds?: EngagementKind[]` with the new kind names.
  - `PlaybookId = 'nocreds'|'user'|'da'`.
- **Data:** `HOST_STAGES`, `HOST_GOALS`, `ENGAGEMENT_SETUP` and `AD_PLAYBOOKS`, copied verbatim (ids, titles, `why`, applies) except:
  - `legacyIds` removed;
  - `kinds: ['real']` → `['client']`.
- **facts.ts:**
  - `HostFacts = { os: 'linux'|'windows'|null; ports: Set<number>; services: Set<string>; dualHomed: boolean; domainJoined: boolean; kind: EngagementKind }`.
  - `openPorts(services: Service[]): Set<number>`: skip `closed*` and `filtered*` states.
  - `serviceNames(services: Service[]): Set<string>`:
    - the old normalisation (http, smb, dns, mssql, rdp, rpc, winrm aliases), applied to `nmapService`;
    - except when `confirmedProduct` is set: the name comes from the confirmed product, lowercased, via `CONFIRMED_WORDS`;
    - an unknown confirmed product adds nothing, and the nmap name is then not used either.
  - `CONFIRMED_WORDS`: `[/http|apache|nginx|iis|tomcat|jetty|lighttpd|caddy|werkzeug|express/ → 'http', /samba|smb/ → 'smb', /openssh|ssh/ → 'ssh', /mysql|mariadb/ → 'mysql', /postgres/ → 'postgresql', /redis/ → 'redis', /mongo/ → 'mongodb', /mssql|sql server/ → 'mssql', /ftp/ → 'ftp', /ldap|active directory/ → 'ldap', /winrm/ → 'winrm', /rdp|terminal services/ → 'rdp', /snmp/ → 'snmp', /smtp|postfix|exim|sendmail/ → 'smtp', /nfs/ → 'nfs', /dns|bind/ → 'dns']`.
  - `hostOs(os: HostOs | null)`: `windows` → `'windows'`, `linux` → `'linux'`, `other`/null → null.
  - `adHosts(hosts: Host[], servicesByHost: Map<string, Service[]>): Host[]`: hosts with both 88 and 389 open. There is no DC pin in step 3.
  - `findDcHost(...)`: the only AD host, else null.
  - `hostFacts(host, engagement, hosts, servicesByHost): HostFacts`.
  - `goalApplies(goal, facts): boolean`.
  - `applicableGoals(host, engagement, hosts, servicesByHost): { stage: ChecklistStage; goals: ChecklistGoal[]; hint?: string }[]`.
  - `engagementFacts(engagement, hosts, servicesByHost): HostFacts`: `os` null, `domainJoined` = any AD host.

  `hostFacts`, `goalApplies` and `applicableGoals` behave exactly as the old functions in `applicability.ts`, `ports.ts` and `dc.ts`.

- [ ] **Step 1: Port the tests.**
  - Copy the old app's repo to `src/test/engines/checklist/applicability.test.ts`. Rewrite its fixtures to build `Host` + `Service[]` instead of `Machine`, and keep every assertion.
  - Add `confirmed identity drives applicability`: a service with `nmapService: 'ppp', confirmedProduct: 'Apache httpd'` makes `h-enum-web-stack` apply. A service with `nmapService: 'http', confirmedProduct: 'CouchDB'` makes it not apply.
  - Add `data.test.ts`:
    - goal ids are unique across host and engagement data;
    - every stage id is in the spec order;
    - no `kinds` names `challenge-lab` or `real`.
- [ ] **Step 2: Restore the dropped library assertions** in `commandLibrary.test.ts`, the step-2 carryover:
  - every goal a command names exists in `HOST_GOALS`, `ENGAGEMENT_SETUP` or the playbooks;
  - every host goal except `h-foot-arrived`, `h-loot-record`, `h-close-notes`, `h-orient-proof` and `h-pe-proof` has at least one command;
  - the last command for `h-foot-brute` has a title containing "last resort". Check the old `src/test/checklist/commandLibrary.test.ts` for the exact assertions dropped in step 2 and restore those verbatim; the `resolveTemplate` one comes back in Task 4.
- [ ] **Step 3: Run** `npx vitest run src/test/engines`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** the data and `facts.ts`.
- [ ] **Step 5: Run** `npx vitest run src/test/engines`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(checklist): port goals data and applicability (confirmed identity aware)`.

### Task 4: Port resolveTemplate and command fill

**Files:**
- Create: `src/engines/checklist/template.ts`, `src/engines/checklist/fill.ts`
- Test: `src/test/engines/checklist/{template,fill}.test.ts`; the restored `resolveTemplate` assertion goes in `commandLibrary.test.ts`

**Interfaces:**
- **Consumes:** `findDcHost` and the facts inputs from Task 3; `Tunnel` from Task 2; `Settings.attackerIp` / `listenerPort`; `ipInScope` from `src/engines/parse/scope`.
- **Produces:**
  - `template.ts`: `SubstitutionContext`, `VariableRange` and `resolveTemplate(template, ctx, opts?)`, ported verbatim from old `variableSubstitution.ts`, keeping the old token aliases. `contextFromGlobalVars` is not ported.
  - `fill.ts`:
    - `FillInput = { host: Host; engagement: Engagement; hosts: Host[]; servicesByHost: Map<string, Service[]>; tunnels: Tunnel[]; attackerIp: string; listenerPort: string }`;
    - `FillResult = { text: string; unresolved: string[]; viaTunnel?: { tunnel: Tunnel; viaHostName: string; down: boolean } }`;
    - `tunnelFor(host, tunnels): Tunnel | null`;
    - `fillCommand(template, input): FillResult`.
  - Context rules, as in old `commandContext`, minus credentials:
    - `TARGET_IP` = host ip; `DOMAIN` = engagement domain;
    - `DC_IP` and `DC_HOST` from `findDcHost`;
    - `SUBNET` / `SUBNET_PREFIX` from the pivot tunnel or the single other scope range;
    - `TUNNEL_IP` = tunnel callback;
    - `LHOST` = tunnel callback when a tunnel applies, else `attackerIp`; `LPORT` = `listenerPort`;
    - `USER`, `PASS` and `HASH` always stay unresolved in step 3 (credentials are step 4).

    Empty known fields stay as their `{TOKEN}` text and are listed in `unresolved`. `INTERFACE` keeps its `tun0` default and is never listed.

- [ ] **Step 1: Port the tests.**
  - Port the old `fill.test.ts` cases that don't involve credentials, with fixtures rebuilt on the new types. Port the `resolveTemplate` tests that sit inside the old fill and library tests.
  - Add `fill leaves USER/PASS/HASH unresolved`.
  - Add `LHOST comes from the tunnel callback when the host is behind a tunnel, else from the attacker IP setting`.
  - Restore the `resolveTemplate` carryover assertion in `commandLibrary.test.ts`: every built-in template resolves with no tokens outside `KNOWN_TOKENS`.
- [ ] **Step 2: Run** `npx vitest run src/test/engines`. Expected: FAIL.
- [ ] **Step 3: Implement** `template.ts` and `fill.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(checklist): port template resolution and command fill`.

### Task 5: Port auto-tick, exam rules, scan import, flag ticks and board derivation

**Files:**
- Create: `src/engines/checklist/{autoTick.ts,examRules.ts,scanImport.ts,board.ts}`
- Test: `src/test/engines/checklist/{autoTick,examRules,scanImport,board}.test.ts`

**Interfaces:**
- **Consumes:** `namedHostsInLine`, `shellHost` and `HOST_IP` from `src/engines/attribution.ts` (already ported in step 2; do not duplicate); `matchLine` and `firstBinary` from the library matcher; Task 3's facts.
- **Produces:**
  - `Tick = { ownerId: string; goalId: string; commandId: string; entryId: string }`.
  - `ticksForEntry(entry: LogEntry, ctx: TickContext): Tick[]`, where `TickContext = { engagement: Engagement; hosts: Host[]; servicesByHost: Map<string, Service[]>; library: LibraryCommand[] }`. It covers:
    - **commands:** the old `autoTicksForEntry` over `content.blocks` (`shell` per block, `entry.ranOn`), plus `scanCommandLines(block.output)` lines treated as attacker lines;
    - **flags:** a flag entry ticks `h-orient-proof` (`flagKind` local) or `h-pe-proof` (proof) on each of `entry.hostIds`, with `commandId` `'flag'`, where the goal applies;
    - **other kinds:** tick nothing.

    Engagement goals tick with `ownerId = engagement.id`.
  - `applyTicks(state: ChecklistState | undefined, ticks: Tick[], now: number): ChecklistState`, `removeEntryTicks(state, entryId)` and `replaceEntryTicks(state, entryId, ticks, now)`: the old semantics exactly, on the per-owner `ChecklistState`. They return the same object when nothing changes. The old `activeItemId` handling is dropped, since Raven has no active item.
  - `examRules.ts`:
    - `filterForKind(cmds, kind, { hostId, msfHostId })`;
    - `isMetasploitLine(line)`;
    - `metasploitHostIds(entry, engagement, hosts)`;
    - `metasploitWarning(entry, engagement, hostIds)`.

    Ported verbatim, reading `engagement.msfHostId` and `engagement.kind`.
  - `scanImport.ts`: `scanCommandLines(scanText): string[]`, ported verbatim.
  - `board.ts`: `derivedColumn(host, state: ChecklistState, applicable: { stage; goals }[]): BoardColumn`. A goal is closed when its status is `done` or `na`. The rule:
    - `done` if `h-pe-proof` is done and every applicable loot, pivot and closeout goal is closed;
    - else `loot` if `h-pe-proof` is done;
    - else `privesc` if any of `h-foot-shell`, `h-foot-creds`, `h-foot-arrived`, `h-orient-proof` is done;
    - else `foothold` if every applicable enumerate goal is closed and at least one exists;
    - else `enumerate`.
  - `currentStage(state, applicable)`: the first applicable stage with an open goal, or null. Used by Now.

- [ ] **Step 1: Port the tests.**
  - Port the old `autoTick.test.ts`, `examRules.test.ts` and `scanImport.test.tsx` engine cases, rewriting fixtures to `LogEntry` with `content: { kind: 'command', blocks }` and `Host`/`Service`. Keep every assertion that doesn't need credentials.
  - Add:
    - `flag local ticks h-orient-proof on its host; proof ticks h-pe-proof`;
    - `N/A goal auto-ticked then entry removed returns to N/A` (Review Focus 2);
    - `replaceEntryTicks keeps completedAt for goals still ticked and drops evidence for goals no longer ticked` (Review Focus 1);
    - `pasted nmap output with an "as:" header ticks the scan goal for the scanned host`;
    - a `board.test.ts` case for each branch of `derivedColumn`, plus `local.txt alone moves to privesc even with enumeration open`.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/checklist`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(checklist): port auto-tick, exam rules, scan import; flag ticks and board derivation`.

### Task 6: Checklist queries and tick wiring on log save, edit and delete; board sync; Metasploit lock on save

**Files:**
- Create: `src/features/checklist/queries.ts`, `src/features/checklist/ticks.ts`
- Modify: `src/features/capture/saveCapture.ts`, `src/features/log/queries.ts` (edit and delete paths), `src/features/capture/CaptureForm.tsx` (Metasploit warning line)
- Test: `src/test/checklistTicks.test.tsx`

**Interfaces:**
- **Consumes:** Tasks 1, 2 and 5.
- **Produces:**
  - `useChecklist(engagementId)` → `{ byOwner: Map<string, ChecklistState>, items }` (query key `['checklist', engagementId]`).
  - `useChecklistMutations(engagementId)` → `setStatus(ownerId, goalId, status)`, `setNotes(ownerId, goalId, notes)`, `putStates(changes: Map<string, ChecklistState>)`.
    - A manual status change sets `auto: false`, clears `autoFrom`, and sets or clears `completedAt` (done = now).
  - `ticks.ts`:
    - `syncEntryTicks(engagementId, entry: LogEntry | null, entryId, ctx): Promise<void>`:
      - computes the ticks with `ticksForEntry` (none when `entry` is null, i.e. deleted);
      - applies `replaceEntryTicks` to every owner's state that has evidence for `entryId` or gets a tick;
      - writes only the changed owners with one `checklistPut`;
      - then calls `syncBoards`.
    - `syncBoards(engagementId, ctx)`: for each host whose `derivedColumn` differs from `host.boardDerived`, calls `hostSyncBoard`.
    - `tickFromLog(engagementId, ctx)`: rebuilds every owner's evidence from the whole log, keeping manual statuses and notes, then writes and syncs boards.
  - **Save path:** `saveCapture` calls `syncEntryTicks` after the entry and services save. A failure throws the existing `PartialSaveError` with the message "Saved the entry, but the checklist didn't update. Use Tick from log on the Engagement checklist." Edit and delete in the log call `syncEntryTicks` too.
  - **Metasploit lock:**
    - For an exam-sim engagement with no lock, saving an entry where `metasploitHostIds` returns exactly one host calls `engagementSetMsfHost` with it.
    - When a lock exists, `CaptureForm` shows the `metasploitWarning` text in the `text-warn` style above Save. Saving is still allowed.

- [ ] **Step 1: Write the failing UI tests** with the mocked api, as in step 2's capture tests:
  - `saving a full nmap scan ticks h-enum-full-tcp on the host and checklistPut carries evidence for the entry`;
  - `editing the entry to a different host moves the tick`;
  - `deleting the entry removes its evidence and restores the prior status`;
  - `a local.txt flag ticks h-orient-proof and the host moves to Privesc via hostSyncBoard`;
  - `a hand-placed card is not moved by a save that does not change the derived column`;
  - `exam-sim: first "use exploit/…" entry locks Metasploit to its host; a later one on another host shows the warning`;
  - `checklist write failure shows the Tick from log message and the entry stays saved`.
- [ ] **Step 2: Run** `npx vitest run src/test/checklistTicks.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(checklist): auto-tick on log save/edit/delete, board sync, Metasploit lock on save`.

### Task 7: Host Checklist tab (GoalRow, CommandList)

**Files:**
- Create: `src/features/checklist/{GoalRow.tsx,CommandList.tsx,HostChecklist.tsx,EvidenceLinks.tsx}`
- Modify: `src/features/hosts/HostView.tsx` (Checklist tab renders `HostChecklist`)
- Test: `src/test/hostChecklist.test.tsx`

**Interfaces:**
- **Consumes:** `useChecklist` / `useChecklistMutations`, `applicableGoals`, `fillCommand`, `filterForKind`, settings and tunnels queries.
- **Produces:**
  - `GoalRow` props: `{ goal, state, commands: FilledCommand[], evidence: EvidenceLink[], emptyCommandsText?, onStatus(goalId, status), onNotes(goalId, notes), children? }`.
  - `FilledCommand = { id; title; text; unresolved: string[]; msfMarker: boolean; viaTunnel? }`.
  - `EvidenceLink = { entryId; label; exists: boolean }`. The label is the entry title.
- **Behaviour:**
  - Stages render in spec order with their titles; an empty applicable stage shows its hint.
  - **Each goal** shows:
    - a status control: an Ink segmented group with To do / Doing / Done / N/A; buttons, not radios, using the step-2 `Toggle` look;
    - the title, with done struck through in muted text and N/A muted;
    - the `why` in muted text;
    - its commands, filled, each with a Copy button. Unresolved tokens are wrapped in a `<mark>`-styled span (warn colour, no background).
    - In exam sims the "uses your one Metasploit host" marker, and a "via tunnel on X" note (warn when the tunnel is down).
    - a notes textarea that saves on blur;
    - evidence chips "↗ <entry title>". Clicking one switches to the Story tab and expands that entry; a missing entry shows "log entry removed".
  - Open goals start expanded; done and N/A goals start collapsed.
  - Goals whose commands were all removed by exam rules show "Nothing allowed in an exam sim; do it by hand".
  - **`h-foot-arrived`** shows an "Arrived from" control below its commands: pick a host or "Kali", type a "via" text, and Save. This creates a hop (`hopCreate`) and sets the goal to done.

- [ ] **Step 1: Write the failing tests:**
  - `renders only applicable goals for a windows smb host`;
  - `commands are filled with the host IP and the attacker IP setting`;
  - `unresolved tokens are marked, not blank`;
  - `exam-sim host shows no banned command` (Review Focus 3);
  - `metasploit commands only on the locked host once locked`;
  - `status buttons call checklistPut with auto false`;
  - `evidence chip opens the Story tab with the entry expanded`;
  - `recording arrived-from creates a hop and ticks the goal`.
- [ ] **Step 2: Run** `npx vitest run src/test/hostChecklist.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(checklist): host checklist tab with filled commands, evidence and arrived-from`.

### Task 8: Now panel and board auto-movement

**Files:**
- Create: `src/features/checklist/NowPanel.tsx`
- Modify: `src/features/hosts/HostView.tsx` (replace the placeholder Now panel), `src/features/board/*` (movement already arrives through `boardColumn`; make sure the board refetches hosts after `hostSyncBoard`)
- Test: `src/test/nowPanel.test.tsx`

**Interfaces:**
- **Consumes:** `currentStage`, `applicableGoals`, `filterForKind`, `useChecklistMutations`.
- **Behaviour:**
  - Now shows the current stage's title and its open goals (todo and in_progress), each with a one-click Done and a Doing toggle, plus its first filled command with Copy.
  - Clicking a goal title switches to the Checklist tab and scrolls to that goal.
  - With every applicable goal closed, Now says "All stages done".
  - **Exam sims:** goals with only banned commands are skipped in Now.

- [ ] **Step 1: Write the failing tests:**
  - `now lists the open goals of the first stage with open work`;
  - `marking the last open enumerate goal done moves Now to Foothold and calls hostSyncBoard with foothold`;
  - `exam-sim Now never shows a banned command`;
  - `clicking a goal opens the Checklist tab at it`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.** Manual status changes also call `syncBoards`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(checklist): Now panel and stage-driven board movement`.

### Task 9: Engagement checklist section (setup, playbooks, tunnels, hops, Tick from log)

**Files:**
- Create: `src/features/checklist/{EngagementChecklist.tsx,PlaybookSection.tsx,TunnelsPanel.tsx,HopsPanel.tsx}`
- Modify: the engagement sections map (`sections.tsx`) so section 5 renders `EngagementChecklist`
- Test: `src/test/engagementChecklist.test.tsx`

**Interfaces:**
- **Consumes:** `ENGAGEMENT_SETUP`, `AD_PLAYBOOKS`, `engagementFacts`, `adHosts`, `findDcHost`, `GoalRow`, `tickFromLog`, and the tunnels and hops api.
- **Behaviour:**
  - **Setup goals:** `e-setup-clock` only when there is an AD host. The engagement owns the setup goals (`ownerId = engagement.id`).
  - **Playbooks** render as collapsible sections with their `opensWhen` text:
    - "No credentials" is open when there is an AD host;
    - "First domain user" and "Domain admin" show "Opens automatically once credentials arrive (build step 4)" and can be expanded by hand. "Domain admin" also opens when a hop to the AD host exists.

    The playbook triggers that need credentials are step 4.
  - **Tunnels panel:** a list plus an add/edit dialog with kind, via host, subnets (comma-separated, validated), callback IP and up/down.
  - **Hops panel:** a list "from → to via …" with add, edit and delete.
  - **Tick from log:** a button that runs `tickFromLog` and reports "Updated N goals" in the `role="status"` line.
  - **Access flags:** omitted; they need credentials (step 4).

- [ ] **Step 1: Write the failing tests:**
  - `clock sync shows only with an AD host`;
  - `no-credentials playbook opens with an AD host; the others say they open with credentials`;
  - `adding a tunnel validates subnets and lists it`;
  - `a hop to the DC opens the Domain admin playbook`;
  - `Tick from log re-derives a tick that was missing and reports the count`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(checklist): engagement checklist with playbooks, tunnels, hops and Tick from log`.

### Task 10: Field notes panel (`N`)

**Files:**
- Create: `src/features/notes/{NotesPanel.tsx,useNotesStore.ts,queries.ts}`
- Modify: the engagement shell (mount the panel and the `N` key), `src/lib/lockSignal.ts` consumers (flush before lock)
- Test: `src/test/notes.test.tsx`

**Interfaces:**
- **Consumes:** `noteGet`, `noteSave` and `notesList` api (Task 2).
- **Produces:**
  - `useNotes(engagementId)`: all notes, for the thread counts in Task 11.
  - `useNotesStore`: `{ open, scope: 'host'|'engagement', width, toggle(), setScope(), setWidth() }`.
  - `flushNotes(): Promise<void>`: saves any pending text now.
- **Behaviour:**
  - **Opening:** `N` (outside inputs) toggles a panel that slides over the right side; the screen underneath stays.
  - **Scope:** it opens on the current host's notes in a host view, else the engagement's. `⌘E` and a two-button segmented control switch scope, and the title says "Notes · SRV11" or "Notes · Lab A".
  - **Editor:** a monospace Markdown textarea (raw Markdown; no preview in step 3), with a Private toggle.
  - **Saving:** auto-saves 500 ms after the last keystroke, and on close, on scope switch, on route change and before lock. `flushNotes` is awaited in the lock path before `vault_lock`.
  - **Sizing:** a drag handle on the left edge resizes it (min 320 px, max 70 % of the window). The width is remembered across launches in `localStorage` key `raven.notes.width`.
  - `Esc` closes it.

- [ ] **Step 1: Write the failing tests:**
  - `N opens host notes in a host view and engagement notes elsewhere`;
  - `typing autosaves after 500ms`;
  - `closing, switching with ⌘E, and navigating flush pending text immediately` (Review Focus 4);
  - `lock flushes pending notes before locking`;
  - `N inside an input types the letter`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notes): field notes panel with autosave, scope switch and resize`.

### Task 11: Open threads and ruled-out items

**Files:**
- Create: `src/engines/notes/threads.ts`, `src/features/notes/{ThreadsList.tsx,CloseThreadDialog.tsx}`
- Modify:
  - the NotesPanel: the thread list above the editor, and the `⌘/` toggle;
  - `HostHeader` (count), the board card and Sidebar host list (dot);
  - `StatusStrip` ("Threads N" next to rooted/flags), the Dashboard active card (count).
- Test: `src/test/engines/notes/threads.test.ts`, `src/test/threads.test.tsx`

**Interfaces:**
- **Produces** in `threads.ts`:
  - `Thread = { line: number; text: string }`.
  - `openThreads(body: string): Thread[]`: lines whose trimmed start is `? `; `text` is the rest. Lines inside fenced code blocks are ignored.
  - `toggleThreadPrefix(body, line): string`.
  - `closeThread(body, line, outcome: 'panned'|'dead'): string`: replaces `? ` with `✓ ` (panned) or `✗ ` (dead).
- **Behaviour:**
  - **Thread list:** the notes panel shows open threads of the current scope, each with a Close button.
  - **Closing** opens a dialog with two choices: "Panned out", or "Dead end" with a one-line reason (required).
    - A dead end creates a ruled-out item (`ruledOutCreate` with text, reason, host and the Private toggle defaulting to the note's private flag).
    - Both rewrite the line via `closeThread` and save the note.
  - **Counts:** derived from `useNotes` on every render:
    - **host count:** the host's note threads, shown as a chip "N threads" on the host header, a small dot on the board card and the sidebar host;
    - **engagement count:** all notes' threads, shown on the status strip and the dashboard card.

- [ ] **Step 1: Write the failing tests:**
  - **engine:**
    - `openThreads finds "? " lines and skips fenced code`;
    - `toggleThreadPrefix adds and removes`;
    - `closeThread marks ✓ or ✗`.
  - **UI:**
    - `a "? " line shows a dot on the board card and a count on the header and strip`;
    - `closing as dead end requires a reason and creates a ruled-out item`;
    - `⌘/ toggles the prefix on the caret line`.
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notes): open threads with counts everywhere and ruled-out on dead ends`.

### Task 12: Metasploit lock display, attacker settings UI and the dual-homed flag

**Files:**
- Create: `src/features/engagements/MsfLock.tsx`
- Modify: `StatusStrip` (exam sims only), `src/features/settings/*`, `src/features/hosts/HostDialog.tsx` (dual-homed toggle)
- Test: `src/test/msfLock.test.tsx`, plus additions to the settings and hosts tests

**Behaviour:**
- **Strip:** in exam sims the status strip shows "Metasploit: unused" or "Metasploit: SRV11", with the host name in the warn colour once locked.
- **Lock dialog:** clicking it opens a small dialog to change the locked host or release it, with release confirmed.
- **Settings** gains "Your IP (tun0)" and "Listener port" fields, validated as Task 2 does, with this hint: "Filled into checklist commands as LHOST and LPORT".
- **Host dialog** gains a "Dual-homed (reaches another network)" toggle. The pivot goals apply only when it's on.

- [ ] **Step 1: Write the failing tests:**
  - `strip shows the msf lock only in exam sims`;
  - `release asks first and clears the lock`;
  - `attacker IP setting rejects a non-IP`;
  - `dual-homed toggle makes the pivot goals appear`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`, and in `src-tauri`, `cargo test && cargo clippy --all-targets -- -D warnings`. Expected: all green.
- [ ] **Step 5: Commit** `feat(exam): Metasploit lock on the strip, attacker settings and dual-homed flag`.

---

## Rulings in this plan (for the user to check)

1. **Library editing is deferred.** Operator library editing (preferred order, retire, add) waits for phase 2's Arsenal. Step 3 uses the built-in library only.
2. **Engagement checklist parts that need credentials** wait for step 4: the "First domain user" and "Domain admin" playbook triggers, access flags, and the "new credential since" badges. Step 3 shows those playbooks with an "opens with credentials" note and lets you expand them by hand.
3. **Ticks are computed in TS and written separately from the log entry.** That isn't one atomic transaction. If the checklist write fails you get an explicit message, and "Tick from log" repairs it.
4. **Board movement:** cards move to the furthest milestone reached.
   - A shell, a credential login, a recorded arrival, or `local.txt` → Privesc.
   - `proof.txt` → Loot/Pivot.
   - All loot, pivot and closeout goals closed → Done.
   - Enumeration closed → Foothold.

   A hand placement holds until that derived column changes.
5. **Notes:** raw Markdown in a monospace editor, with no preview in step 3. Threads can't be linked to log entries yet.
6. **No DC pin or extra IPs per host.** The DC is the single host with 88+389 open.
7. **LHOST/LPORT** come from new Settings fields: "Your IP (tun0)" and "Listener port".
