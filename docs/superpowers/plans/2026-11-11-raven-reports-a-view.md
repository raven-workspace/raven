# Reports, Plan A: the Report view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The engagement's Report section becomes a working report editor: a smart draft per target, written on a light page with ProseKit, an outline with OffSec checks, an evidence rail, appendix moves, and everything Raven knows filled in. No PDF export yet.

**Architecture:** Two new tables hold the report and one ProseMirror JSON document per section; evidence and generated content are atom nodes that *reference* live rows (log entries, findings, services…) and render them at view time. All drafting, classification, checks, numbering and diffing is pure TypeScript in `src/engines/report/` (tested without a DOM); `src/features/report/` holds the ProseKit editor, node views and the three-pane view.

**Tech Stack:** Tauri 2 + rusqlite/SQLCipher (Rust), React 19, TypeScript, Tailwind 4, TanStack Query, Vitest, Playwright audit; new dependency **`prosekit@0.23.x`** (owner-approved, the only new JS dependency).

**Spec:** `docs/superpowers/specs/2026-11-11-raven-reports-design.md` (approved 2026-11-11). Read it in full before any task; section numbers below (§) refer to it.

**Plan B (separate, later):** the PDF page-style round (§4.3), PDF + .7z export with MD5, the export confirm step with "Submitted in the control panel" ticks (§6.5, §6.7). Plan A ships a provisional page stylesheet that Plan B replaces; nothing in Plan A may hard-code page styling outside `src/features/report/page.css`.

## Global Constraints

- DESIGN.md is binding for all Ink UI: grid with explicit tracks (one `minmax(0,1fr)` per row), no `flex-col`/`flex-1`/`flex-wrap`/`justify-between`/`grow` in `src/features/**`, the six type roles only (`text-title|heading|body|code|meta|label`), nothing under 12px, no `text-xs`/`text-[Npx]`, spacing 4/8/12/16/24/32 only, accent `#c6ff00` only for meaning, warn `#e0a030`, **no red**, Phosphor icon buttons with `aria-label` + `Tooltip`, `HintLine`/`Kbd` rules, `Disclosure` for secondary options, focus ring rules, motion values from `src/ui/motion.ts`.
- The page itself is the one exception to Ink type roles (like the Manual's reading roles): its styles live only in `src/features/report/page.css`, scoped under `.report-page`.
- Private content never reaches the page, the rail or a check's text: private log entries, private notes, finding `lessons`, private ruled-out items, attempts with `private: true` (reason kind `operator`).
- No AI or generated prose of any kind. Generated content is data (tables, lists, facts); prose slots are empty with placeholder text that never exports.
- Data safety: schema changes only via a new migration appended to `MIGRATIONS` (backup-first runner already does this); never edit a shipped migration.
- Raven never writes to the network; the vault stays local.
- Exam facts (§2) are binding: file name `OSCP-<OSID>-Exam-Report.pdf`, OSID pattern `OS-` + digits, proof must show `ipconfig`/`ifconfig`/`ip a(ddr)` with the target IP, targets graded in report order, Metasploit on one target.
- Wording on screen: "Tested, not exploited" (never "not exploitable"); coverage value "tested, no exploitable issue found".
- Tests: Vitest files live in `src/test/` (`npm test`); Rust tests live in the module (`cargo test` in `src-tauri`). Every task ends with `npm run typecheck && npm test && npm run lint` (and `cargo test` when Rust changed) green.
- The audit fake backend (`src/audit/fakeApi.ts`) must implement every new `api` method, or the audit build breaks.

## Review Focus

1. **An entry placed on the page is later deleted or marked private.** Expect an amber placeholder in its place ("This entry was deleted" / "This entry is now private"), counted as a gap, never showing the old content. → test in Task 9.
2. **Leaving a section mid-typing** (switching target, navigating away, locking the vault). Expect the last keystrokes saved: the debounced save flushes on section change and unmount. → test in Task 10.
3. **A host is added, deleted, or changes AD-set membership after the report exists.** Expect the outline to follow the current hosts; a section whose target no longer exists is hidden (kept in the DB), never a crash; a new host gets its section on first open. → tests in Tasks 4 and 10.
4. **Huge outputs and many entries** (a 5,000-line linpeas output; a host with 150 log entries). Expect the draft to trim long output to a head by default and the page to stay responsive. → tests in Tasks 5 and 7.
5. **A malformed OSID** (`os-12345`, `OS12345`, spaces). Expect the file name cell in amber and a report-level check, never a silently wrong file name. → test in Task 4.

---

## File map

**Rust (`src-tauri/`)**
- Create `migrations/0015_reports.sql` — `reports`, `report_sections`; `finding_files` gains `modified`, `original_url`, `original_content`.
- Create `src/reports.rs` — report and section CRUD.
- Modify `src/migrations/mod.rs` (append version 15), `src/lib.rs` (module + commands), `src/commands.rs` (commands), `src/settings.rs` (report defaults), `src/findings.rs` (file fields).

**Types and API**
- Create `src/types/report.ts`. Modify `src/types/settings.ts`, `src/types/findings.ts`, `src/lib/api.ts`, `src/audit/fakeApi.ts`, `src/audit/fixtures.ts`.

**Engine (`src/engines/report/`, pure, no React)**
- `types.ts` (ReportData, ReportNode, node attr types, Check, ReportTarget, ReportMeta, SectionMeta)
- `targets.ts`, `meta.ts` (targets, expected flags, deadline, file name, OSID)
- `prove.ts`, `draft.ts` (proving entries, phase split, target draft, add new evidence)
- `frontMatter.ts` (summary, considerations, methodology, AD overview and chain, engagement-level tested list)
- `coverage.ts`, `tools.ts` (service coverage, tools list, Metasploit modules)
- `proof.ts`, `checks.ts`, `wording.ts`
- `diff.ts`, `trim.ts`, `appendix.ts`
- `index.ts` re-exports.

**Feature (`src/features/report/`)**
- `ReportSection.tsx` (the view), `ReportStrip.tsx`, `ReportOutline.tsx`, `EvidenceRail.tsx`, `ReportDetails.tsx`
- `queries.ts` (report + sections + `useReportData`)
- `editor/extension.ts` (ProseKit schema), `editor/ReportEditor.tsx`, `editor/nodes/*.tsx` (node views), `editor/ReportDataContext.tsx`
- `page.css` (provisional house style, the only page styling)

**Tests (`src/test/`)**: `reportTargets.test.ts`, `reportDraft.test.ts`, `reportFrontMatter.test.ts`, `reportCoverage.test.ts`, `reportChecks.test.ts`, `reportDiffTrim.test.ts`, `reportAppendix.test.ts`, `reportEditor.test.tsx`, `reportSection.test.tsx`, `reportRail.test.tsx`; audit screens in `audit/screens.ts`.

---

### Task 1: Report storage (migration, Rust module, commands, API)

**Files:**
- Create: `src-tauri/migrations/0015_reports.sql`, `src-tauri/src/reports.rs`, `src/types/report.ts`
- Modify: `src-tauri/src/migrations/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src/lib/api.ts`, `src/audit/fakeApi.ts`, `src/audit/fixtures.ts` (empty `reports: []`, `reportSections: []`)

**Interfaces:**
- Produces (Rust, `reports.rs`, all `pub`):
  - `struct Report { id, engagement_id, candidate_name: String, email: String, osid: String, title: String, meta: serde_json::Value, created_at: i64, updated_at: i64, exported_at: Option<i64> }` (camelCase serde)
  - `struct ReportDefaults { candidate_name: String, email: String, osid: String }`
  - `struct ReportPatch { candidate_name: Option<String>, email: Option<String>, osid: Option<String>, title: Option<String>, meta: Option<Value> }`
  - `struct ReportSection { id, report_id, kind: String, target_key: Option<String>, position: i64, doc: Option<Value>, meta: Value, draft_built_at: Option<i64>, updated_at: i64 }`
  - `struct SectionInput { kind: String, target_key: Option<String>, position: i64, doc: Option<Value>, meta: Value, draft_built_at: Option<i64> }`
  - `fn get_or_create(conn, engagement_id: &str, defaults: &ReportDefaults) -> AppResult<Report>` — one report per engagement; created with the defaults and title `"OSCP Exam Report"`, `meta = {}`.
  - `fn update(conn, id: &str, patch: ReportPatch) -> AppResult<Report>`
  - `fn sections_list(conn, report_id: &str) -> AppResult<Vec<ReportSection>>` ordered by `position, kind`.
  - `fn section_upsert(conn, report_id: &str, input: SectionInput) -> AppResult<ReportSection>` — unique on `(report_id, kind, target_key)`; an existing row keeps its id.
  - `fn section_save(conn, id: &str, doc: Value, meta: Value) -> AppResult<ReportSection>` — sets `updated_at`.
  - `fn sections_reorder(conn, report_id: &str, ids: Vec<String>) -> AppResult<()>` — `position` = index; ids not in the report → `NotFound`.
  - Section `kind` ∈ `details, summary, considerations, methodology, target, ad, engagement-tested, appendix-proof, appendix-tools, appendix-msf, appendix-cleanup, further, references` (Validation error otherwise). `target_key` is required for `target` (a host id) and must be null otherwise, except `ad` which uses `"ad-set"`.
- Commands: `report_get_or_create(engagement_id)` (reads defaults from settings, Task 2 adds them; until then empty strings), `report_update(id, patch)`, `report_sections_list(report_id)`, `report_section_upsert(report_id, input)`, `report_section_save(id, doc, meta)`, `report_sections_reorder(report_id, ids)`.
- Produces (TS): `src/types/report.ts` mirrors (`Report`, `ReportPatch`, `ReportSection`, `SectionInput`, `SectionKind` union); `api.reportGetOrCreate(engagementId)`, `api.reportUpdate(id, patch)`, `api.reportSectionsList(reportId)`, `api.reportSectionUpsert(reportId, input)`, `api.reportSectionSave(id, doc, meta)`, `api.reportSectionsReorder(reportId, ids)`.

Migration SQL (exact):
```sql
-- Reports: one per engagement for now; each section holds a ProseMirror JSON document that references evidence by id.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL UNIQUE REFERENCES engagements(id) ON DELETE CASCADE,
  candidate_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', osid TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, exported_at INTEGER);
CREATE TABLE report_sections (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, target_key TEXT, position INTEGER NOT NULL,
  doc TEXT, meta TEXT NOT NULL DEFAULT '{}', draft_built_at INTEGER, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX report_sections_unique ON report_sections (report_id, kind, COALESCE(target_key, ''));
ALTER TABLE finding_files ADD COLUMN modified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finding_files ADD COLUMN original_url TEXT;
ALTER TABLE finding_files ADD COLUMN original_content TEXT;
```

- [ ] **Step 1: Write failing Rust tests in `reports.rs`** (reuse the `unlocked()`/`eng()`/`host()` helpers pattern from `payload_builds.rs`):
  - `get_or_create_is_idempotent`: two calls return the same `id`; `candidate_name` equals the defaults given on the first call; `title == "OSCP Exam Report"`.
  - `section_upsert_keeps_id_and_updates`: upsert `target` for host H twice with different `position` → same id, new position.
  - `section_kind_and_key_validated`: `kind: "nope"` → `AppError::Validation`; `kind: "target"` with `target_key: None` → Validation; `kind: "summary"` with a key → Validation.
  - `section_save_round_trips_json`: save `{"type":"doc","content":[]}` → `sections_list` returns equal `Value`.
  - `reorder_sets_positions_and_rejects_foreign_ids`.
  - `engagement_delete_cascades`.
  - `migrates_14_to_15_keeps_finding_files`: insert a finding file at v14, migrate to v15 → row kept, `modified = 0`, `original_url IS NULL` (pattern: `payload_builds::tests::migrates_12_to_13_keeps_rows`).
- [ ] **Step 2: Run** `cd src-tauri && cargo test reports` → FAIL (module missing).
- [ ] **Step 3: Implement** the migration, `reports.rs`, register `pub mod reports;`, append `(15, include_str!("../../migrations/0015_reports.sql"))`, add the six commands with `with_vault` like `payload_builds_list`, add them to `generate_handler!`. JSON columns are stored as text; a stored value that fails to parse → `AppError::Db`.
- [ ] **Step 4: Run** `cargo test` → PASS.
- [ ] **Step 5: TS side.** Add `src/types/report.ts`, the six `api` methods, and fake implementations in `fakeApi.ts` over new `db.reports` / `db.reportSections` arrays (same upsert/validation semantics; the fake may skip validation messages but must keep the unique key). Run `npm run typecheck && npm test` → PASS.
- [ ] **Step 6: Commit** `feat(reports): report and section storage`

---

### Task 2: Report defaults in Settings

**Files:**
- Modify: `src-tauri/src/settings.rs`, `src-tauri/src/commands.rs` (`report_get_or_create` reads defaults), `src/types/settings.ts`, `src/features/settings/SettingsPage.tsx`, `src/audit/fixtures.ts`, `src/audit/fakeApi.ts`
- Test: `settings.rs` tests; `src/test/settingsReport.test.tsx`

**Interfaces:**
- Produces: `Settings.reportName: string`, `reportEmail: string`, `reportOsid: string`, `reportMethodology: string` (keys `report_candidate_name`, `report_email`, `report_osid`, `report_methodology`; each ≤ 2000 chars, methodology ≤ 20000; blank allowed). `SettingsPatch` gains the same optional fields.
- `report_get_or_create` passes `ReportDefaults { candidate_name: reportName, email: reportEmail, osid: reportOsid }`.

- [ ] **Step 1: Failing Rust test** `settings_report_defaults_round_trip`: defaults are `""`; patch all four → read back equal; a 2001-char name → `Validation { field: "reportName" }`.
- [ ] **Step 2: Failing Vitest** `src/test/settingsReport.test.tsx`: Settings page renders a "Report details" group with fields labelled "Your name", "Email", "OSID", "Default methodology"; typing an OSID and blurring calls `settingsUpdate` with `{ reportOsid: "OS-12345" }`.
- [ ] **Step 3: Run** both → FAIL.
- [ ] **Step 4: Implement.** Field labels are `text-meta` sentence case (DESIGN.md); methodology is a `Textarea`. OSID field shows an amber `text-meta` line "OSIDs look like OS-12345" when non-blank and not matching `^OS-\d+$` (use `isValidOsid` from Task 4 — if Task 4 isn't merged yet, add `isValidOsid` in `src/engines/report/meta.ts` here and Task 4 extends that file).
- [ ] **Step 5: Run** → PASS. **Commit** `feat(reports): report details defaults in Settings`

---

### Task 3: Finding files know if they're modified

**Files:**
- Modify: `src-tauri/src/findings.rs`, `src/types/findings.ts`, `src/features/findings/FindingFiles.tsx`, `src/audit/fakeApi.ts`
- Test: `findings.rs` tests; `src/test/findingFilesModified.test.tsx`

**Interfaces:**
- Produces: `FindingFile.modified: boolean`, `originalUrl: string | null`, `originalContent: string | null`; `FindingFileInput` gains the same as optional (absent keeps current on update; `originalContent` ≤ 1 MiB like `content`).

- [ ] **Step 1: Failing Rust test** `finding_file_modified_fields_round_trip` (create with `modified: true, original_url: Some("https://www.exploit-db.com/exploits/50000")`, update without them keeps them).
- [ ] **Step 2: Failing Vitest**: in the finding's Files section, a file row has a "Modified exploit" toggle; turning it on reveals "Original URL" and "Original code" fields; saving calls `findingFileUpdate` with `{ modified: true, originalUrl: … }`. Uses `Toggle`, `Input`, `Textarea` from `src/ui`.
- [ ] **Step 3–4: Run → FAIL, implement, run → PASS.**
- [ ] **Step 5: Commit** `feat(findings): mark exploit files modified, with the original`

---

### Task 4: Engine — data shape, targets, expected flags, deadline, file name

**Files:**
- Create: `src/engines/report/types.ts`, `src/engines/report/targets.ts`, `src/engines/report/meta.ts`, `src/engines/report/index.ts`
- Test: `src/test/reportTargets.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export interface ReportData {
    engagement: Engagement; hosts: Host[]; services: Service[]; log: LogEntry[]; checklist: ChecklistItem[];
    findings: Finding[]; findingFiles: FindingFile[]; attempts: FailedAttempt[]; ruledOut: RuledOut[];
    grants: AccessGrant[]; usernames: Username[]; hops: Hop[]; cleanup: CleanupItem[]; notes: Note[]; credentials: Credential[];
  }
  export type FlagKind = "local" | "proof";
  export interface ReportMeta {            // stored in reports.meta
    includedHostIds?: string[];            // labs only
    expectedFlags?: Record<string, FlagKind[]>; // per host id
    examEndAt?: number; examDate?: string; reportDate?: string; // ISO dates yyyy-mm-dd
  }
  export interface SectionMeta {           // stored in report_sections.meta
    removedEntryIds?: string[]; coverage?: Record<string, CoverageOverride>; method?: string;
  }
  export type TargetKind = "standalone" | "ad-set";
  export interface ReportTarget { key: string; kind: TargetKind; hostIds: string[] }
  export type ReportNode = { type: string; attrs?: Record<string, unknown>; content?: ReportNode[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
  ```
  (`CoverageOverride` is defined in Task 6; declare it in `types.ts` now as `{ result: CoverageResult; note?: string }` with `CoverageResult = "exploited" | "tested" | "untested"`.)
- Produces (`targets.ts`): `reportTargets(data: ReportData, meta: ReportMeta): ReportTarget[]`
  - exam-sim: hosts with `!adSetEffective` in board order then name (one `standalone` each, `key` = host id), then one `ad-set` target (`key: "ad-set"`, `hostIds` in name order) if any host has `adSetEffective`.
  - lab: `meta.includedHostIds` if set, else hosts with ≥1 non-private flag entry; each `standalone`; plus an `ad-set` target of the included hosts with `adSetEffective` (those leave the standalone list).
  - client: `[]`.
  - Hosts that no longer exist are dropped silently.
- Produces (`meta.ts`):
  - `expectedFlags(target: ReportTarget, hostId: string, meta: ReportMeta): FlagKind[]` — `meta.expectedFlags[hostId]` if set; else standalone → `["local","proof"]`; ad-set → `["proof"]`.
  - `isValidOsid(osid: string): boolean` — `/^OS-\d+$/`.
  - `reportFileName(osid: string): string` — `` `OSCP-${osid}-Exam-Report.pdf` `` when valid, else `"OSCP-OS-?????-Exam-Report.pdf"`.
  - `reportDueAt(engagement: Engagement, meta: ReportMeta): number | null` — `meta.examEndAt ?? (timeboxStart + timeboxMinutes*60_000)` plus 24 h; null for labs without `examEndAt`, and for clients.

- [ ] **Step 1: Write failing tests** (`reportTargets.test.ts`), using small object builders local to the test:
  - exam-sim with hosts ms01 (standalone), web01, lnx02, dc01/ad02 (adSet) → keys `["h-ms01","h-web","h-lnx","ad-set"]` (board order), ad-set `hostIds` `["h-ad02","h-dc01"]`.
  - lab, no meta, flags only on web01 → one target `h-web`; with `includedHostIds: ["h-ms01","h-web"]` → both.
  - client → `[]`.
  - a deleted host id in `includedHostIds` is dropped (Review Focus 3).
  - `expectedFlags` defaults and override.
  - `isValidOsid`: `"OS-57211047"` true; `"os-12345"`, `"OS12345"`, `" OS-1"` false; `reportFileName("os-1")` → `"OSCP-OS-?????-Exam-Report.pdf"` (Review Focus 5).
  - `reportDueAt`: timebox start 0, 1425 min → `(1425*60_000) + 86_400_000`; lab without `examEndAt` → null.
- [ ] **Step 2: Run** `npx vitest run src/test/reportTargets.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three files and `index.ts` re-exports.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(reports): report targets, expected flags, deadline and file name`

---

### Task 5: Engine — the smart draft

**Files:**
- Create: `src/engines/report/prove.ts`, `src/engines/report/draft.ts`, `src/engines/report/trim.ts` (only `defaultKeep` here; Task 7 adds the rest)
- Test: `src/test/reportDraft.test.ts`

**Interfaces:**
- Consumes: Task 4 types.
- Node vocabulary (the contract the editor schema in Task 9 implements; exact names):
  - `doc` → block+
  - `paragraph`, `heading` (`level` 2|3|4), `list`, `codeBlock` — ProseKit basic nodes for owner text.
  - `slot` — attrs `{ hint: string }`, content `inline*`. A prose slot; an empty one renders its hint as a placeholder and never exports.
  - `phase` — atom, attrs `{ phase: Phase; hostId: string }`, `Phase = "foothold" | "privesc" | "lateral" | "domain" | "proof" | "tested"`. Renders the sub-section heading; movable.
  - `evidence` — atom, attrs `{ entryId: string; block: number | null; keep: [number, number][] | null; emphasis: number[]; appendix: "inline" | "moved" | "split" }`. `block` indexes `content.blocks` of a command entry (null = whole entry for screenshot/http/flag/note).
  - `generated` — atom, attrs `{ kind: GeneratedKind; hostId: string | null; appendix: "inline" | "moved" }`, `GeneratedKind = "facts" | "services" | "vulns" | "tested" | "proof-table-host" | "engagement-details" | "exploited-systems" | "severity-legend" | "ad-overview" | "attack-chain" | "proof-table" | "tools" | "msf" | "cleanup" | "references"`.
  - `vuln` — atom, attrs `{ findingId: string }` (the vulnerability block of §5.4).
  - `exploit` — atom, attrs `{ fileId: string; markedLines: number[]; appendix: "inline" | "moved" }`.
- Produces (`prove.ts`):
  - `type ProofReason = "goal" | "service" | "access" | "hop" | "flag" | "finding-step"`
  - `provingEntries(data: ReportData, hostId: string): Map<string, ProofReason[]>` — host-linked, non-private entries that: appear in any checklist item's `evidence` (owner = this host or the engagement); are a service's `confirmedEntryId` for this host; are an access grant's `logEntryId` on this host; are a hop's `logEntryId` with `toHostId` = host; are `kind: "flag"`; are in `stepEntryIds` of a finding whose `hostIds` include the host.
  - `isDeadEnd(entry: LogEntry, data: ReportData): boolean` — linked from a failed attempt (`attempts[].logEntryId`) or `returnedNothing`.
- Produces (`draft.ts`):
  - `phaseSplit(entries: LogEntry[], data: ReportData, hostId: string, entry: "foothold" | "hop"): Map<string, Phase>` — §5.1 rule: entries up to and including the first user-level grant on the host (or first `local` flag) are `foothold` (or `lateral` when the host was entered by a hop, `entry: "hop"`); after it up to the root/system/admin grant → `privesc` (or `domain` for the AD set's DC, see below); flags → `proof`; if no boundary is found, everything non-flag is `foothold`.
  - `buildTargetDraft(data: ReportData, target: ReportTarget, meta: ReportMeta): ReportNode` — a `doc` in the §5.7 per-target order. Standalone: `generated{facts}`, `generated{services}`, then for each phase present: `phase`, any `vuln` nodes for findings whose steps fall in that phase (at the top), then each kept entry as `evidence` (one per command block) followed by an empty `slot{hint:"What this shows, and why it matters"}`, adjacent screenshots (≤ 5 minutes after a kept entry) brought along; `exploit` nodes for files of the host's findings (unmodified ones are rendered as a URL line by the node view); then `phase{tested}` + `generated{tested}`; then `phase{proof}` + `generated{proof-table-host}` + flag evidence. AD set: `generated{ad-overview}`, then per machine (name order) the same block, with phases named `foothold` (first machine entered without a hop), `lateral` (entered by hop), `domain` (the host named DC: `services` include port 88 and 389, else last in chain), and `generated{attack-chain}` last.
  - Output in an evidence node: `keep` = `defaultKeep(lineCount)` from `trim.ts` — `null` when ≤ 60 lines, else `[[0, 39]]` (first 40 lines), the owner picks more (Review Focus 4).
  - `evidenceIdsIn(doc: ReportNode): Set<string>`
  - `addNewEvidence(doc: ReportNode, data: ReportData, target: ReportTarget, meta: ReportMeta, removed: string[]): { doc: ReportNode; added: string[] }` — appends qualifying entries not in `evidenceIdsIn(doc)` and not in `removed` to the end of their phase (creating the `phase` node at its place in §5.7 order if missing), each followed by an empty slot; never removes or reorders anything.

- [ ] **Step 1: Write failing tests** (`reportDraft.test.ts`) with a fixture builder for one Windows host:
  - entries: nmap (ticked a goal), hydra (failed attempt), smbclient (`returnedNothing`), feroxbuster (confirmed service), screenshot 2 min after feroxbuster, curl rce (grant level `user`), winPEAS (nothing), whoami /priv (goal), PrintSpoofer (grant `system`), proof flag, a **private** note-kind entry with a goal tick.
  - `provingEntries` contains nmap, feroxbuster, curl, whoami, PrintSpoofer, flag; not hydra, smbclient, winPEAS, the private entry.
  - `buildTargetDraft` → phase order `["foothold","privesc","tested","proof"]`; foothold evidence `entryId`s `[nmap, ferox, screenshot, curl]`; privesc `[whoami, printspoofer]`; every `evidence` is followed by a `slot`; no node references the private entry.
  - command entry with 2 blocks → 2 evidence nodes with `block` 0 and 1.
  - a 5,000-line output → `keep: [[0,39]]`; a 12-line output → `keep: null`.
  - no access grants at all → all non-flag evidence under `foothold`.
  - `addNewEvidence` after logging a new proving entry → it appears at the end of `privesc`, `added` = `[id]`; an id in `removed` is not re-added; existing nodes (including owner text in slots) are unchanged (deep-equal on the prefix).
  - AD set fixture (dc01 with 88/389, ad02 entered by a hop) → ad02's first phase is `lateral`, dc01's is `domain`, last node is `generated{attack-chain}`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(reports): smart draft per target`

---

### Task 6: Engine — front matter, coverage, tools, Metasploit, AD chain

**Files:**
- Create: `src/engines/report/frontMatter.ts`, `src/engines/report/coverage.ts`, `src/engines/report/tools.ts`
- Test: `src/test/reportFrontMatter.test.ts`, `src/test/reportCoverage.test.ts`

**Interfaces:**
- Produces (`frontMatter.ts`): `buildSectionDraft(kind: SectionKind, data: ReportData, settings: Settings): ReportNode` for `summary` (`generated{engagement-details}`, slots with hints in this order: "What the engagement was", "What the targets did well", "Vulnerabilities and trends", "Wrap-up"; `generated{exploited-systems}`; heading "Recommendations"; slot "Recommendations"), `considerations` (one slot, hint "Anything that affected testing: positive, neutral or negative (VPN drops, machine reverts, time)"), `methodology` (heading per stage — "Information gathering", "Service enumeration", "Penetration", "Post-exploitation and maintaining access", "House cleaning" — with `settings.reportMethodology` text as paragraphs if set, else empty slots; then `generated{severity-legend}`), `engagement-tested` (`generated{tested, hostId: null}`), appendices (`generated{proof-table|tools|msf|cleanup}` plus a slot), `further` and `references` (one slot; `references` adds `generated{references}`).
- Produces (`coverage.ts`):
  - `serviceCoverage(data: ReportData, hostId: string, overrides: Record<string, CoverageOverride>): CoverageRow[]` with `CoverageRow { serviceId; port; protocol; product: string; proven: boolean; result: CoverageResult; via: string | null }` — `exploited` when a finding linked to the service (`serviceIds`) exists (`via` = finding title); `tested` when the service's `verdict` is `dead_end`, or a non-private attempt or ruled-out item on the host names the port (`/\b<port>\b/` in title/text) (`via` = that reason); else `untested`; override wins. Product = confirmed product+version if `confirmedProduct`, else nmap guess with `proven: false`.
  - `exploitedSystems(data, targets: ReportTarget[], sectionMeta: Record<string, SectionMeta>): { hostId; name; ip; access: "user" | "root" | "none"; method: string }[]` — method = `sectionMeta[target].method` ?? first linked finding title ?? "".
  - `attackChain(data: ReportData, hostIds: string[]): { from: string | null; to: string; via: string; entryId: string | null }[]` — hops into the AD hosts plus admin/system grants, ordered by `at`.
  - `testedNotExploited(data, hostId: string | null): { title: string; reason: string }[]` — non-private attempts (reason kind as words: `control` → "blocked by a control", `precondition` → "precondition not met", `access` → "no access") and non-private ruled-out items; `hostId: null` = engagement-level (`hostId` null rows).
- Produces (`tools.ts`):
  - `toolsUsed(log: LogEntry[], hostIds: string[]): { tool: string; count: number }[]` — first token of each command line (skip `sudo`, env assignments, prompts already stripped by `blocks`), non-private entries only, sorted by count desc.
  - `msfModules(log: LogEntry[], engagement: Engagement, hosts: Host[]): { hostId: string; module: string }[]` — modules from `use <path>` lines via `isMetasploitLine` / the `USE_MODULE` regex (export it from `src/engines/checklist/examRules.ts`), attributed with `metasploitHostIds`; `multi/handler` excluded.

- [ ] **Step 1: Failing tests** covering: summary slot hints in order; methodology uses the Settings text when set; coverage — port 80 with a finding → `exploited` (`via` finding title), port 22 with attempt "SSH brute force on 22" → `tested`, port 445 nothing → `untested`, a private attempt naming 3389 does not make 3389 `tested`, an override wins; `testedNotExploited` excludes `operator` attempts; `toolsUsed` counts `nmap` twice across two entries and ignores private entries; `msfModules` finds `exploit/windows/smb/ms17_010_eternalblue` and ignores `multi/handler`; `attackChain` ordered by `at`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(reports): front matter, coverage, tools and attack chain`

---

### Task 7: Engine — output trimming, line diff, appendix numbering

**Files:**
- Modify: `src/engines/report/trim.ts`
- Create: `src/engines/report/diff.ts`, `src/engines/report/appendix.ts`
- Test: `src/test/reportDiffTrim.test.ts`, `src/test/reportAppendix.test.ts`

**Interfaces:**
- Produces (`trim.ts`): `applyKeep(output: string, keep: [number, number][] | null): ({ kind: "line"; n: number; text: string } | { kind: "omitted"; count: number })[]` — ranges are inclusive, merged and clamped; gaps become one `omitted` item with the count (leading and trailing gaps too).
- Produces (`diff.ts`): `lineDiff(original: string, modified: string): { op: "same" | "add" | "del"; text: string; n: number | null }[]` — LCS over lines (no dependency); `n` is the line number in the modified file for `same`/`add`. Must handle 5,000 × 5,000 lines in under 1 s (use the Myers O(ND) algorithm or an LCS with common prefix/suffix trimming).
- Produces (`appendix.ts`):
  ```ts
  export interface AppendixEntry { key: string; letter: string; n: number; title: string; sectionId: string }
  export interface AppendixIndex { entries: AppendixEntry[]; refFor(key: string): string | null } // "E.2"
  export function numberAppendices(sections: { id: string; kind: SectionKind; targetKey: string | null; doc: ReportNode | null }[], titleOf: (node: ReportNode) => string): AppendixIndex
  export function suggestMoves(doc: ReportNode, data: ReportData): { key: string; reason: string }[]
  ```
  Fixed letters: A proof table, B tools and payloads, C Metasploit usage, D house cleaning; then one letter per target section (in grading order) that has moved content, starting at E; entries numbered in document order. `key` = `${sectionId}:${nodeIndexPath}` for moved `evidence`/`exploit`/`generated` nodes (`appendix` `moved` or `split`). `suggestMoves`: command output > 60 kept lines, exploit content > 60 lines, `generated` lists > 15 rows (`tools`, `tested`, `services`).

- [ ] **Step 1: Failing tests:** `applyKeep` on 10 lines with `[[0,1],[6,7]]` → `line0, line1, omitted(4), line6, line7, omitted(2)`; null keep → all lines; overlapping ranges merge; `lineDiff` marks a changed line as `del`+`add` and keeps `n` right; 5,000-line inputs run under 1,000 ms (Review Focus 4); `numberAppendices` with two targets where only the second has moved nodes → that target gets `E`, its two moved nodes `E.1`, `E.2`; moving a node earlier in the doc renumbers; `refFor` of an unknown key → null.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(reports): output trimming, exploit diff and appendix numbering`

---

### Task 8: Engine — checks

**Files:**
- Create: `src/engines/report/proof.ts`, `src/engines/report/wording.ts`, `src/engines/report/checks.ts`
- Test: `src/test/reportChecks.test.ts`

**Interfaces:**
- Consumes: `AppendixIndex`, `suggestMoves` (Task 7).
- Produces (`proof.ts`): `proofFacts(entry: LogEntry, host: Host): { showsIp: boolean; showsIdentity: boolean; showsHostname: boolean; usualPath: boolean; hasScreenshot: boolean }` from `content.proof` text: IP check = text contains an `ipconfig|ifconfig|ip a(ddr)?` command **and** the host's IP; identity = `whoami` or `\bid\b` command; hostname = `hostname` command; usual path = the `cat`/`type` argument matches `/root/`, `/home/[^/]+/`, or `C:\Users\<x>\Desktop\` (case-insensitive); screenshot = `attachmentId` set.
- Produces (`wording.ts`): `ABSOLUTE_WORDS = ["impossible", "not vulnerable", "fully secure", "completely secure", "cannot be exploited", "unexploitable"]`; `absoluteClaims(text: string): string[]` (case-insensitive, whole words).
- Produces (`checks.ts`):
  ```ts
  export type CheckLevel = "fail" | "soft";
  export interface Check { id: string; level: CheckLevel; text: string; fix?: string; anchor?: { entryId?: string; nodeIndex?: number } }
  export function targetChecks(input: { data: ReportData; target: ReportTarget; doc: ReportNode; meta: ReportMeta; appendixRefs: AppendixIndex }): Check[]
  export function reportChecks(input: { report: Report; targets: ReportTarget[] }): Check[]
  export function isReady(checks: Check[]): boolean   // no "fail"
  ```
  Checks and their exact text (`{host}` = host name; ids are stable strings):
  - `proof-missing:{host}:{flag}` fail — "No {flag}.txt for {host} on the page."
  - `proof-ip:{host}` fail — "The proof for {host} doesn't show ipconfig, ifconfig or ip addr with {ip}. Raven can't read the screenshot, so this checks the pasted proof." fix: Windows `whoami && hostname && type C:\Users\Administrator\Desktop\proof.txt && ipconfig`, Linux `id; hostname; cat /root/proof.txt; ip addr` (by host OS).
  - `proof-screenshot:{host}` fail — "The proof for {host} has no screenshot."
  - `proof-web:{host}` fail — "The proof for {host} looks like it came from a web request, not an interactive shell." (flag entry's nearest preceding command entry on the host is `kind: "http"`, or the flag entry itself has `ranOn` naming a browser — keep it to the http rule.)
  - `proof-identity:{host}`, `proof-path:{host}` soft.
  - `output:{entryId}` fail — "A command on the page has no output." (block output blank and entry not `returnedNothing`).
  - `explain:{entryId}` soft — "A step has no explanation after it." Screenshot evidence first in the list.
  - `access-shot:{host}:{level}` soft — a user/system/admin grant whose entry has no screenshot evidence within 5 min on the page.
  - `caption:{entryId}` soft — caption over 10 words.
  - `finding:{findingId}` soft — no severity / title is a single tool-like word (one token, no spaces) / no affected host or service / empty description or remediation (one check per problem).
  - `wording:{n}` soft — each absolute claim found in slot or paragraph text.
  - `exploit:{fileId}` fail — modified file with no original URL; soft — modified with no explanation slot text after it; fail — modified with no `originalContent` and empty `markedLines`.
  - `coverage:{serviceId}` soft — untested service.
  - `gone:{entryId}` fail — evidence references a deleted or private entry (Review Focus 1).
  - `appendix-ref:{key}` fail — a reference whose appendix entry no longer exists.
  - `msf-many` fail (report level) — `msfModules` attributed to more than one host.
  - Report level: `details` fail when name/email/OSID blank; `osid` fail when `!isValidOsid`; `no-targets` fail.
  - Long-content suggestions are produced by Task 7's `suggestMoves`, surfaced as soft checks with id `move:{key}`.

- [ ] **Step 1: Failing tests**, one per check id above, each asserting `id`, `level` and that `text` contains the host name/IP where specified; plus: a private entry referenced → `gone:` fail; `operator` attempts never mentioned in any check text; `isReady` true when only soft checks remain.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(reports): OffSec checks per target and report`

---

### Task 9: ProseKit editor and node views

**Files:**
- Modify: `package.json` (add `prosekit@^0.23.1`)
- Create: `src/features/report/editor/extension.ts`, `src/features/report/editor/ReportEditor.tsx`, `src/features/report/editor/ReportDataContext.tsx`, `src/features/report/editor/nodes/{EvidenceView,GeneratedView,VulnView,ExploitView,PhaseView,SlotView}.tsx`, `src/features/report/page.css`
- Test: `src/test/reportEditor.test.tsx`

**Interfaces:**
- Consumes: node vocabulary (Task 5), `applyKeep`, `lineDiff`, `serviceCoverage`, `exploitedSystems`, `attackChain`, `testedNotExploited`, `toolsUsed`, `msfModules`, `AppendixIndex` (Tasks 6, 7).
- Produces:
  - `defineReportExtension(): Extension` — `union(defineBasicExtension(), defineNodeSpec(...) for slot/phase/evidence/generated/vuln/exploit, defineReactNodeView({ name, component }) for each, defineHistory())`. Atom nodes are `draggable: true, selectable: true`.
  - `ReportDataContext` — `{ data: ReportData; appendix: AppendixIndex; sectionMeta: SectionMeta; onRemoveEvidence(entryId: string): void }`; node views read live rows from it.
  - `<ReportEditor sectionId doc onChange(doc: ReportNode) onReady(editor) />` — creates the editor with `createEditor({ extension, defaultContent: doc })`, mounts inside `.report-page`, reports changes via `useDocChange` (JSON from `editor.getDocJSON()`).
  - Editor helpers exported from `ReportEditor.tsx`: `insertEvidenceAtCursor(editor, attrs)`, `removeNodeAt(editor, pos)`, `setNodeAttrs(editor, pos, attrs)`.
- Node view behaviour:
  - `EvidenceView`: command block → `prompt$ command` (prompt = `ranOn` label: `kali$` for attacker machines in `settings.machines`, else `<host>$`) over output rendered through `applyKeep` with "… N lines omitted" rows and emphasised lines; screenshot → `AttachmentImage` + "Figure N." caption (numbered at render across the section via a counter in context); flag → value, proof text, screenshot; http → method + URL line, request/response. Missing or private entry → amber placeholder ("This entry was deleted" / "This entry is now private"). Backspace/Delete on a selected evidence node calls `onRemoveEvidence` (the section adds the id to `SectionMeta.removedEntryIds`) and deletes it; undo restores both. ⌥↑/⌥↓ moves the node by one block.
  - `GeneratedView`: renders each `GeneratedKind` from engine functions as a table or list; `appendix: "moved"` renders a one-line reference "Full list: Appendix E.2, <title>".
  - `VulnView`: title, severity chip-free text line (`Severity: High (CVSS:3.1/…)`), Affected, Description, Impact, Fix as a list (remediation split on blank lines/bullets), References; lessons never read.
  - `ExploitView`: unmodified → "Exploit used: <url>"; modified → code with `lineDiff` against `originalContent` (added lines marked), or `markedLines` toggled by clicking line numbers when there's no original; original URL line.
  - `PhaseView`: heading text from phase (`Initial access`, `Privilege escalation`, `Lateral movement`, `Domain compromise`, `Proof`, `Tested, not exploited`) plus the host name in AD sections.
  - `SlotView`: placeholder = `hint` when empty, styled as page placeholder text.
- `page.css`: provisional house style, scoped `.report-page`: paper `#f4f3ef`, ink `#16161a`, Instrument Sans 14/22 for text, JetBrains Mono 12.5/19 for code on `#e9e7e1`, headings 22/28 and 15/22, max width 760px, placeholder `#66655f` (≥ 4.5:1 on paper), amber placeholder blocks use `#7a5414` text with a dashed `#b3802a` border. Plan B replaces values, not selectors.

- [ ] **Step 1: Install** `npm i prosekit@^0.23.1`; run `npm run typecheck` → PASS.
- [ ] **Step 2: Failing tests** (`reportEditor.test.tsx`, jsdom, with a `ReportDataContext` built from a small fixture):
  - renders a `doc` with one `evidence` (command) → shows `kali$ nmap -p- …` and the output.
  - evidence for a 100-line output with `keep [[0,39]]` → 40 lines and "… 60 lines omitted".
  - evidence whose entry is missing → "This entry was deleted"; whose entry is private → "This entry is now private", and the private content is not in the DOM (Review Focus 1).
  - empty `slot` shows its hint; typing into it updates the doc JSON via `onChange` and the hint disappears.
  - selecting an evidence node and pressing Backspace → `onRemoveEvidence("e1")` and the node leaves the JSON; ⌘Z brings it back.
  - `vuln` view never renders `lessons` text.
  - modified `exploit` with `originalContent` → the added line has the "added" marker (`data-diff="add"`).
- [ ] **Step 3: Run → FAIL. Step 4: Implement. Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `feat(reports): ProseKit page editor with live evidence nodes`

---

### Task 10: The Report view (strip, outline, page, saving)

**Files:**
- Create: `src/features/report/ReportSection.tsx`, `ReportStrip.tsx`, `ReportOutline.tsx`, `ReportDetails.tsx`, `queries.ts`
- Modify: `src/features/engagements/sections.tsx` (route `report` → `<ReportSection />`)
- Test: `src/test/reportSection.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 4–9.
- Produces (`queries.ts`):
  - `useReport(eid)` → `api.reportGetOrCreate`; `useReportSections(reportId)`; `useReportData(eid): { data: ReportData | undefined; isLoading; error }` composing existing queries (hosts, services, log, checklist, findings, finding files for all findings, attempts, ruled-out, grants, usernames, hops, cleanup, notes, credentials).
  - `useSectionSaver(sectionId): { save(doc, meta): void; flush(): Promise<void> }` — debounced 600 ms, flushes on section change and unmount (Review Focus 2).
  - `ensureSections(report, targets, data, settings)` — upserts missing sections in §5.7 order (details, summary, considerations, methodology, targets in `reportTargets` order, `ad`, `engagement-tested` only if any engagement-level items, four appendices, further, references) with `doc: null`; a section's draft is built (`buildTargetDraft` / `buildSectionDraft`) and saved with `draftBuiltAt` the first time it is opened with `doc: null`.
- Layout (DESIGN.md grid; sketch `.impeccable/mocks/decision/report-page-and-rail.html`):
  - `ReportSection` = `grid-rows-[auto_minmax(0,1fr)]`: `ReportStrip` then `grid-cols-[272px_minmax(0,1fr)_320px]` (outline, page pane, rail). Container queries on the section pane: under 1200px the rail is a drawer (Task 11); under 1000px the outline becomes a target `Select` above the page and the current target's checks go in a `Disclosure` "Checks (n)" above the page.
  - `ReportStrip`: status-strip cells in order `REPORT` (file name, amber when OSID invalid), `DUE IN` (from `reportDueAt`, hidden when null), `TARGETS READY` (`n/m`), `GAPS` (count of fail checks, amber when > 0). The Export button is **not** in Plan A.
  - `ReportOutline`: groups "Report" (Report details, High-level summary, Testing considerations, Methodology), "Targets, in grading order" (each target: state glyph — accent filled when ready, warn ring when it has fails, line ring when not started — name, last IP octet in `text-code`), the current target's checks listed under it (pass/soft/fail glyphs as Phosphor `Check`/`Circle`/`WarningCircle`; clicking scrolls the page to `anchor` and focuses it), "Appendices" (each marked "auto"), "Further information", "References". Selection = surface-hi + accent bar; `J`/`K` and ↑/↓ move, ↵ opens; targets reorder with ⌥↑/⌥↓ (calls `api.reportSectionsReorder`).
  - `ReportDetails` (the "Report details" page, Ink form, not paper): name, email, OSID, title, exam date, report date, "Exam ended at" (labs), and for labs "Hosts in this report" checkboxes (writes `meta.includedHostIds`); per-target "Expected flags" lives in the outline under each target (two `Toggle`s: local.txt, proof.txt).
  - Client engagements: `EmptyState` "Client reports come after the exam".
  - Keys registered with `usePageShortcuts("Report", …)`: J/K, ⌥↑/⌥↓, ⌥1/⌥2/⌥3 (focus outline/page/rail).

- [ ] **Step 1: Failing tests** (`reportSection.test.tsx`, render with the audit fake API and the exam fixture):
  - opening Report on the exam engagement lists targets in grading order and "AD set" last; strip shows `OSCP-OS-?????-Exam-Report.pdf` until the OSID is set.
  - first open of a target builds its draft and saves it once (`reportSectionSave` called with `draftBuiltAt` set); reopening doesn't rebuild.
  - typing in a slot then switching target calls `reportSectionSave` with the typed text before the switch completes (Review Focus 2); unmounting mid-debounce also flushes.
  - deleting a host after the report exists → its target disappears from the outline without errors (Review Focus 3); adding a host → it appears and gets a section on open.
  - a client engagement shows "Client reports come after the exam".
  - ⌥↓ on the first target moves it second and calls `reportSectionsReorder`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(reports): Report view with outline, checks and autosave`

---

### Task 11: Evidence rail

**Files:**
- Create: `src/features/report/EvidenceRail.tsx`
- Modify: `ReportSection.tsx`
- Test: `src/test/reportRail.test.tsx`

**Interfaces:**
- Consumes: `evidenceIdsIn`, `isDeadEnd`, `insertEvidenceAtCursor`, `useReportData`.
- Produces: `<EvidenceRail target data doc editor />` with tabs (shared `Tabs`): **Unused (n)** — host-linked non-private entries not on the page, time order with a `SortAscending`/`SortDescending` toggle, each row: time (`text-code`), kind, title/command (one line, truncated), and an **Insert** button (↵ or ⌘↵ on the focused row) that inserts at the page cursor (end of the current phase when the page has no cursor) and removes the id from `removedEntryIds`; **Notes** — the host's note and the engagement note when non-private, read-only Markdown text with open threads (`? ` lines) marked, plus the host's non-private ruled-out items; also lists "blocked by a control" attempts under a "What the targets did well" label when the Summary is open; **Creds** — non-private credentials whose source or local host is the target, and access grants on it.
- Under 1200px container width the rail renders inside the drawer pattern (`useDrawerPresence`, slide per DESIGN.md Motion) toggled by `E` and an `IconButton` (`SidebarSimple`, tooltip "Evidence · E") in the strip.

- [ ] **Step 1: Failing tests:** Unused lists hydra and smbclient but not nmap (on the page) nor private entries; Insert puts the entry at the cursor and it leaves Unused; removing a node from the page puts it back in Unused; Notes shows ruled-out items but not private notes; Creds lists a credential sourced from the host; at 1100px width the rail is a drawer toggled by `E`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(reports): evidence rail with unused entries, notes and credentials`

---

### Task 12: Trim, emphasise, move to appendix, add new evidence

**Files:**
- Modify: `src/features/report/editor/nodes/EvidenceView.tsx`, `GeneratedView.tsx`, `ExploitView.tsx`, `ReportOutline.tsx`, `ReportSection.tsx`
- Create: `src/features/report/editor/AppendixSection.tsx` (renders moved content for appendix letters E+), `src/features/report/AddEvidenceButton.tsx`
- Test: extend `src/test/reportEditor.test.tsx`, `src/test/reportSection.test.tsx`

**Interfaces:**
- Consumes: `applyKeep`, `numberAppendices`, `suggestMoves`, `addNewEvidence`, `setNodeAttrs`.
- Behaviour:
  - A focused evidence node shows a row of `IconButton`s (DESIGN.md ActionCell order): **Trim** (`Scissors`, opens line picking: click/shift-click line numbers to set `keep` ranges; "Keep all" resets to null), **Emphasise lines** (`Highlighter`, toggles line numbers into `emphasis`), **Move to appendix** (`ArrowSquareOut`, cycles `inline` → `moved` → `split` with tooltip naming each: "Move to appendix", "Trimmed here, full output in the appendix", "Back inline"), **Remove** (`Trash`, same as Backspace).
  - `generated` and `exploit` nodes get Move to appendix.
  - The outline shows "Appendix E: <target>" entries under Appendices when moved content exists; opening one renders `AppendixSection` (read-only page listing moved nodes with their numbers, each linking back).
  - `suggestMoves` results appear as soft checks with fix action "Move to appendix" that sets the node's `appendix` to `moved`.
  - **Add new evidence** button (text button, in the target page header row) runs `addNewEvidence` with `removedEntryIds`, saves, and shows "Added 3 entries" (or "Nothing new to add") via the existing toast/notice pattern with Undo.
- [ ] **Step 1: Failing tests:** trimming via line clicks sets `keep` to the picked ranges and the view shows the omitted count; Move to appendix leaves "Full output: Appendix E.1, <title>" in place and the outline gains "Appendix E"; moving a second node earlier renumbers the first to E.2 (references update); `split` shows trimmed lines inline plus the reference; Add new evidence appends a newly logged proving entry and Undo removes it; removed entries are not re-added.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(reports): trim, emphasise, appendix moves and add new evidence`

---

### Task 12b: Block handle (drag any block) and formatting toolbar

Owner request (2026-11-11): blocks, especially screenshots, land where their timestamp puts them; the owner must be able to drag any block to its spot. And a formatting toolbar for prose.

**Files:**
- Create: `src/features/report/editor/BlockHandle.tsx`, `src/features/report/editor/FormatToolbar.tsx`
- Modify: `src/features/report/editor/ReportEditor.tsx` (mount both inside the `ProseKit` provider), `src/features/report/page.css` (handle, drop indicator, toolbar-on-page styles only), `src/features/report/ReportSection.tsx` (toolbar placement)
- Test: `src/test/reportEditorTools.test.tsx`

**Interfaces:**
- Consumes: ProseKit `prosekit/react/block-handle` (`BlockHandleRoot`, `BlockHandlePositioner`, `BlockHandlePopup`, `BlockHandleDraggable`), `prosekit/react/drop-indicator` (`DropIndicator`), the basic extension's commands (`toggleBold`, `toggleItalic`, `toggleCode`, link, `toggleList`/`wrapInList` for bullet and ordered, `toggleCodeBlock`, `undo`, `redo`) and `editor.marks/nodes.*.isActive()`.
- Produces: `<BlockHandle />` and `<FormatToolbar />`, both rendered inside `<ReportEditor>`'s ProseKit provider.

**Behaviour:**
- **Block handle:** hovering any top-level block on the page (evidence, screenshots, generated, vuln, exploit, phase headings, slots, paragraphs) shows a drag handle in the page's left gutter (Phosphor `DotsSixVertical`, 24px target, tooltip "Drag to move"). Dragging moves the block; a `DropIndicator` line shows where it will land. Moving keeps attrs, so references and figure numbers recompute. No "add block" (+) button — insertion stays in the evidence rail. The keyboard path stays ⌥↑/⌥↓ (already built). Undo reverses a drag.
- **Formatting toolbar:** a fixed toolbar pinned to the top of the page pane (sticky; Ink chrome, not paper), shown when the page has focus or a selection inside it: Bold (⌘B), Italic (⌘I), Inline code (⌘E), Link (⌘K is taken by search — use ⌘⇧K), Bulleted list, Numbered list, Code block, Undo (⌘Z), Redo (⇧⌘Z). Each is an `IconButton` (Phosphor `TextB`, `TextItalic`, `Code`, `Link`, `ListBullets`, `ListNumbers`, `CodeBlock`, `ArrowCounterClockwise`, `ArrowClockwise`) with `aria-label`, Tooltip naming action + shortcut, `aria-pressed` reflecting the active mark/node. Buttons disabled when the selection is a block (atom) node. No heading-level control (section headings are structural).
- DESIGN.md binds the toolbar: grid/`Toolbar` primitive, 28px icon buttons, groups separated by 16px space (no dividers), one hover state, focus ring.

- [ ] **Step 1: Failing tests** (`reportEditorTools.test.tsx`): the handle renders for a hovered evidence node with label "Drag to move"; simulating a drop (use ProseMirror's drag/drop or a direct `BlockHandleDraggable` dragstart + drop on a target position) moves a screenshot evidence node from after the 3rd block to after the 1st, attrs unchanged; undo restores the order. Toolbar: Bold toggles the strong mark on a text selection in a slot and `aria-pressed` follows; Numbered list wraps the slot paragraph; buttons are disabled with an evidence node selected; ⌘⇧K opens link input.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS** (full gate).
- [ ] **Step 5: WebKit look at ~1400** in `npm run dev:audit` (port 5199): handle visible in the gutter on hover, drop line visible while dragging, toolbar doesn't overlap the page's first block.
- [ ] **Step 6: Commit** `feat(reports): drag blocks with a handle, and a formatting toolbar`

---

### Task 13: Audit fixtures, audit screens and WebKit check

**Files:**
- Modify: `src/audit/fixtures.ts`, `src/audit/fakeApi.ts`, `audit/screens.ts`, `audit/ux.spec.ts`
- Test: `npm run audit:visual`

**Interfaces:**
- Fixture additions on the existing exam engagement (`e-exam`, ids `h-exam-*`): log entries for ms01 matching Task 5's scenario (nmap, hydra failed attempt, feroxbuster with a confirmed service, screenshot, curl with a user grant, whoami /priv, PrintSpoofer with a system grant, a proof flag whose proof text includes `ipconfig` and `10.10.30.5`, a 400-line linpeas output, one **private** entry); a finding on ms01 with a modified exploit file (original included); attempts of kinds `control` and `operator`; a ruled-out item; a hop into ad02 and grants to dc01; Settings with name/email/OSID `OS-48213`; a `reports` row and no sections (so the audit exercises first-open drafting).
- Screens: `report-details`, `report-target` (ms01), `report-ad` (AD set), `report-appendix` (after moving the linpeas output; use a `setup` that clicks Move to appendix), `report-narrow` (rail drawer open) — at all `WIDTHS`.
- UX spec: open Report → ms01 → the "proof" check passes; edit the OSID to `os-1` in Report details → strip file name turns amber.

- [ ] **Step 1:** Add fixtures and screens; run `npm run audit:visual` → the new screens fail until the view is right; fix any overflow/contrast/tiny-text/target-size findings in the feature code (never opt out).
- [ ] **Step 2:** Run `npm run audit:visual` → PASS, no opt-outs.
- [ ] **Step 3: WebKit at ~1400px:** run the audit's report screens once with Playwright's `webkit` project at 1400×900 (add a one-off `--project=webkit` run or a temporary config override, not committed if the config doesn't already have webkit) and look at the screenshots: hyphenation, the three-pane grid, the page width. Fix what looks wrong.
- [ ] **Step 4: Result review (owner: "the most important thing is the RESULT").** The exam fixture must read like a real exam box, not stubs: realistic commands and outputs (nmap, feroxbuster, an exploit, whoami /priv, PrintSpoofer, linpeas trimmed), real-looking screenshots from `src/audit/images`, a modified exploit with its original, failed attempts, the AD chain. With `npm run dev:audit` (port 5199) and Playwright **WebKit at 1400×900**, open every report page in outline order (details, summary, considerations, methodology, each target, AD set, every appendix, further, references) **without editing anything**, and take a full-page screenshot of each paper page. Save them under `audit-output/report-result/`. Report in the task report, page by page, what a grader would see: correct order and headings; steps in a sensible order with screenshots next to the step they show; proof present with IP; vulnerability blocks complete; tested-not-exploited lines; generated tables filled and correct; figure and appendix numbering continuous; anything dumped, duplicated, empty, mis-placed or private. Fix draft-engine or rendering defects found (with a test each) before committing.
- [ ] **Step 5:** Run `npm run typecheck && npm test && npm run lint && (cd src-tauri && cargo test)` → all PASS.
- [ ] **Step 6: Commit** `test(reports): audit fixtures, screens and a full-report result review`

---

### Task 14: Result polish (from the owner's screenshot and the controller's result review)

The result review (Task 13 screenshots, `audit-output/report-result/`) and the owner's real-app screenshot show what a grader and the owner see. Fix these; each with a test where behaviour changes, and a WebKit 1400 look at the affected pages afterwards (re-shoot `audit-output/report-result/`).

**Files:** as needed in `src/features/report/**`, `src/engines/report/**`, `src/features/engagements/StatusStrip.tsx`, `page.css`.

1. **Page titles.** Report-level pages (summary, considerations, methodology, appendices A–D, appendix pages E+, further, references) show their title at the top of the paper ("High-level summary", "Appendix A: Proof table", …), rendered from the section kind (not stored in the doc, so existing saved docs get it too). Targets keep their facts title.
2. **One strip.** On the Report section the report strip replaces the engagement status strip (no two strips stacked).
3. **Facts line.** No " | " joins. Render labelled values (label muted, value in ink; e.g. IP, OS, Ports, Access) on one wrapping row with 24px gaps, or a two-column facts list.
4. **nmap guesses.** Don't repeat "(nmap guess)" per row: unproven products render muted italic, with one line under the table: "Italic: nmap's guess, not confirmed."
5. **Coverage from access.** A port used to get in (an access grant or hop whose `via` or linked log entry names the port or the service, e.g. evil-winrm → 5985, ssh → 22, psexec/smb → 445) reads "exploited (<via>)" instead of "not tested". Engine change in `coverage.ts` with tests.
6. **Tools appendix.** Columns Tool / Purpose / URL (template 5.2). Purpose and URL come from a built-in data table of common tools (nmap, feroxbuster, gobuster, ffuf, hydra, nxc/crackmapexec, impacket-*, evil-winrm, mimikatz, rubeus, bloodhound/sharphound, printspoofer*, godpotato, winpeas*/linpeas, chisel, ligolo, rlwrap, nc/ncat, socat, msfvenom, sqlmap is banned so omit, john, hashcat, smbclient, enum4linux, kerbrute, certipy, python3 = "exploit runner" only when running a .py), editable per row (stored in that appendix section's meta). Exclude shell builtins and coreutils (whoami, type, cd, ls, dir, cat, echo, chmod, tar, cp, mv, sudo, iwr/Invoke-WebRequest, certutil as download → keep certutil? list it as "file transfer"), and fix `sudo` being counted. No "Times used" column.
7. **Outline checks.** One line per check (truncate with tooltip). Checks of the same id-kind group into one row with a count ("12 steps have no explanation"); clicking cycles through them. The fix one-liner shows only for the selected check, in a Disclosure, not inline for all.
8. **Block tools placement.** The selected block's tools sit in the page's right gutter beside the block's top, never over content (the owner's screenshot shows the Move square over the facts line).
9. **Silent commands.** Ruling: a command block with blank output on a non-"returned nothing" entry is a **soft** check ("A command on the page shows no output. Fine if it printed nothing; otherwise paste its output."), not a fail — downloads like `iwr`/`certutil` print nothing.

- [ ] Steps: failing tests for 1, 2, 4, 5, 6, 7, 9 → implement → full gate → WebKit 1400 re-shoot and look → commit `fix(reports): result polish from the owner's review`.

---

### Task 15: Match OffSec's sample report structure

OffSec's own sample report (v2.0; owner's copy at `a file outside the repo`) replaces the third-party template as the structure authority. Owner decisions (2026-11-11): appendices stay **for content too big to inline** (PEN-200 §5.2.7); "Tested, not exploited" stays in a **much slimmer form** (a client wants to know it was tested, not repro steps for a non-issue).

**Document structure (numbered headings, e.g. 4.1.3):**
1. Cover (Plan B) and table of contents (Plan B).
2. **1 OffSec Certified Professional Exam Report** — 1.1 Introduction, 1.2 Objective, 1.3 Requirements: editable slots pre-filled from a Settings default (empty by default; owner pastes their wording once). No generated prose.
3. **2 High-Level Summary** — prose slots (keep the four placeholders), then **2.1 Recommendations**. The engagement-details and exploited-systems tables go (their facts move: scope → 3.1, exploited systems are told in the targets).
4. **3 Methodologies** — 3.1 Information Gathering (generated scope line: "Exam network: <IPs>"), 3.2 Service Enumeration, 3.3 Penetration (plus one generated line naming the Metasploit target, or "Metasploit was not used"), 3.4 Maintaining Access, 3.5 House Cleaning (generated list from the cleanup items). Each stage keeps the Settings methodology text or an empty slot.
5. **Testing considerations** (PEN-200 §5.2.4) is kept but exports only if the owner wrote something (my call).
6. **4 Independent Challenges** — per target **4.N Target #N – <IP>**:
   - **4.N.1 Service Enumeration**: a compact **Port Scan Results** table (IP Address | Ports Open: "TCP: 21, 80, …" / "UDP: …"), then the scan evidence. The per-service coverage table goes.
   - **4.N.2 Initial Access – <vulnerability title>** (title from the finding that enabled it, else the phase name): labelled lines **Vulnerability Explanation** (finding description), **Vulnerability Fix** (remediation, as steps), **Severity** (with CVSS), **Steps to reproduce the attack** (an empty prose slot for a short summary); then the walkthrough; then **Local.txt value:** with its flag evidence (the local flag sits at the end of initial access).
   - **4.N.3 Privilege Escalation – <vulnerability title>**: same labelled lines and walkthrough.
   - **4.N.4 Post-Exploitation**: **Proof.txt value:** with its flag evidence, then any post-root steps (entries after the root grant that aren't the flag: credential dumps, pivots found).
   - **Also tested** (slim "Tested, not exploited"): one line per item, "<what> on <port>: <reason words>", no commands, no steps; at the end of the target before Post-Exploitation; omitted when empty.
7. **5 Active Directory Set** — one **Port Scan Results** table for all AD machines; then per machine **5.N <Name> – <IP>** with Initial Access – <technique> (or Lateral Movement / Domain Compromise naming), Privilege Escalation if any, Post-Exploitation (flags + the pivot evidence). The attack-chain list stays as a short closing subsection.
8. **Appendices**: only for moved-out content (§5.6), lettered A, B… in report order. The auto appendices (proof table, tools and payloads, Metasploit usage, house cleaning) go: flags are inline, Metasploit and house cleaning move into Methodologies (my calls). Further information and References stay optional, exported only when filled.

**Walkthrough style:** the prose slot comes **before** each step ("what you're about to do and why"), as in the sample, not after. Only steps get a slot; consecutive evidence from the same step (a command and its screenshot) shares one slot. Screenshots keep "Figure N." captions.

**Existing drafts:** the owner confirmed (2026-11-11) nothing written so far needs keeping. Store a draft layout version in SectionMeta (`layout: 2`); a section saved with an older or missing layout is rebuilt from scratch the first time it opens. No carry-over of old text, no compatibility rendering for the old layout.

- [ ] Steps: update spec §4.3/§5.2/§5.4/§5.5/§5.7 to this structure; failing engine tests for the new draft layout (numbering, phase titles from findings, local/proof placement, post-exploitation split, slim tested lines, port scan table, slot-before-step, no auto appendices); renderer tests (labelled vuln lines, port scan table, numbered headings); old-layout sections rebuild on open; full gate; re-shoot `audit-output/report-result/` in WebKit 1400 and compare page by page against the sample PDF; commit.

---

### Task 16: Editable content and the full ProseKit editing set

Owner feedback (2026-11-11): inserted blocks aren't editable, so rough in-the-moment notes are frozen on the page; and the toolbar uses almost none of ProseKit's features.

**A. Everything the owner wrote is editable on the page**
- **Notes** (note entries, observations) insert as ordinary editable paragraphs (text copied, `fromEntry` attr kept for provenance), never as atoms. Existing note atoms on saved pages convert in place (one transaction, undoable) when the page opens.
- **Screenshot captions** are edited inline on the page (stored on the node, overriding the log caption; the log is untouched).
- **Command blocks:** an **Edit on page** tool turns the block into an editable code block (prompt line + output text, language set), detached from the log entry (tooltip says so; undo restores the live block). Trim/emphasis stay for live blocks.
- HTTP blocks: same Edit on page.

**B. ProseKit features to use** (all in `prosekit` already; no new dependency)
- **Bubble menu on text selection** (`prosekit/react/inline-popover`): bold, italic, underline, strikethrough, inline code, highlight, link (with an inline link editor: open, edit, remove).
- **Slash menu** (`prosekit/react/autocomplete` + `extensions/autocomplete`): type `/` in a paragraph or slot to insert paragraph, heading (levels 3–4 only, under the section's structure), bulleted / numbered / task list, quote, code block, table, divider, image, and **evidence from the log** (fuzzy search this target's entries; Enter inserts).
- **Markdown shortcuts** (input rules): `### `, `- `, `1. `, `[ ] `, `> `, ``` `, `---`, `**x**`, `*x*`, `` `x` ``.
- **Tables** (`extensions/table` + `react/table-handle`): insert, add/remove rows and columns, header row; for owner-written tables (e.g. credentials found).
- **Code blocks with a language picker** (`extensions/code-block`): language select on the block; syntax colours via the app's existing highlight.js (no shiki).
- **Images:** paste or drop an image onto the page → saved as a screenshot log entry for this target (existing attachment storage) and inserted as live evidence with a caption to fill; **resizable** width (`react/resizable`) stored on the node.
- **Find and replace** (`extensions/search`): ⌘F on the page, with next/previous and replace.
- **Placeholder** extension for empty slots and empty paragraphs.
- **Underline, strike, highlight, subscript/superscript** marks; **horizontal rule**.
- **Toolbar** reorganised: block-type select (Paragraph / Heading 3 / Heading 4 / Quote / Code block) | marks | lists | insert (table, image, divider, evidence) | find | undo/redo; "Add new evidence" stays at the end. Shortcuts in tooltips and the Shortcuts sheet.
- Not used: text colour/background colour, font family, text-align (a report has one style), math, mentions, collaboration (yjs/loro).

**Export implication (Plan B):** every new node and mark must render in the PDF.

- [ ] Steps: failing tests per feature (note insert is editable text; caption edit persists; Edit on page detaches and undo restores; bubble menu marks; slash menu inserts each item and evidence search; markdown rules; table ops; code language persists; pasted image creates an entry + node; find/replace; old note atoms convert); implement; full gate; WebKit 1400 look at a target page in use; commit.

---

## Spec coverage map (self-review)

| Spec | Task |
|---|---|
| §4.1 regions, §4.2 keys, §4.4 narrow, §4.5 states | 10, 11, 12 |
| §4.3 house style | 9 (provisional `page.css`); final style → Plan B |
| §5.1 draft, split | 5 |
| §5.2 filled content, trimming, exploits | 3, 5, 7, 9, 12 |
| §5.3 which targets | 4, 10 |
| §5.4 real-engagement content (vulns, tested, coverage) | 6, 9 |
| §5.5 report-level sections, §5.7 outline | 6, 10 |
| §5.6 appendices | 7, 12 |
| §6.1 data | 1, 2, 3 |
| §6.2 referenced evidence | 5, 9 |
| §6.3 editor | 9, 12b |
| §6.4 rail | 11 |
| §6.5 checks | 8, 10 (export gating → Plan B) |
| §6.6 deadline | 4, 10 |
| §6.7 export | Plan B |
| §7 constraints (audit, WebKit) | 13 |
