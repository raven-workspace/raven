# Raven Reports: page-owned copies, rhythm, notices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every block on the report page becomes an editable copy with Refresh, pasted terminal text renders as code, blocks get visible rhythm, and notices stop hiding under the sidebar.

**Architecture:** The engine gains copy builders (`src/engines/report/copies.ts`): from a finding, entry, file or generated kind, they produce the page's own nodes. It also gains a layout-4 → 5 in-place upgrader. The editor gains two container nodes: `finding` (attrs `findingId`) holding labelled editable paragraphs and code blocks, and `table-block` (attrs `kind`, `hostId`) holding a real ProseMirror table or a paragraph. Atom evidence, exploit and flag nodes gain copy attrs that their open chip edits. Refresh lives in the block ⋯ menu. Checks read the copies.

**Tech Stack:** React 19 + TS, ProseKit/ProseMirror (table extension already in use), Vitest, Playwright WebKit.

**Spec:** `docs/superpowers/specs/2026-11-11-raven-reports-design.md`, §10.8 (binding, overrides §6.2), with §10 for the rest.

## Global Constraints

- Branch `feat/reports`. No merge, no push. No new dependencies. No AI attribution trailer in commits.
- The log, findings and finding files are never written by the report. Copies live only in the section doc.
- `DRAFT_LAYOUT` = 5. Layout-4 pages **upgrade in place** (every owner-written node kept). Pages older than 4 keep today's rebuild + "Restore your previous page".
- Private sources never copied; a block whose source went private or was deleted keeps showing the amber marker and never exports (§4.5).
- DESIGN.md: grid default, text ≥12px, 24px targets, focus rings, no red, no joined " · " strings, icon buttons with tooltips.
- Section doc + meta cap is 8 MiB (Rust `MAX_SECTION_BYTES`): copied output counts. A copy over 200 KB of text stores the first 200 KB plus a `truncated: true` attr and the chip says so; Refresh restores from the source.
- **Visual gate (owner rule):** the controller personally reads WebKit 1400×900 screenshots of every changed screen on the owner-shaped fixture (`src/audit/examFixtures.ts` web01 findings) before calling a task done. Green tests are not visual evidence.

## Review Focus

1. **The owner's existing layout-4 pages** (their real Mock exam A report) upgrade to layout 5 without losing a single owner-typed paragraph, step sentence, trim, caption, port note or appendix placement. Test owned by Task 1.
2. **Pasted terminal text in a finding** (git show/diff, commit lines, PHP, PowerShell, nmap) becomes code blocks, and normal prose with inline `code`, **bold** and real `- item` lists still renders as prose. Test owned by Task 1.
3. **Refresh after the owner edited a block** asks first and can be undone. A block whose source is gone offers no Refresh, only the amber marker. Test owned by Task 2.
4. **Checks after edits:** editing a flag's proof copy to remove the IP fails the proof-shows-IP check. Editing a finding's Fix to empty raises the empty-remediation check. Test owned by Task 3.
5. **The notice** never sits under or over the sidebar, expanded or collapsed, at 1000–1600px widths. Test owned by Task 4, with an occlusion check in the audit.

---

### Task 1: Copy builders, terminal-text detection, layout 5 upgrade (engine)

**Files:** create `src/engines/report/copies.ts`, `src/engines/report/terminal.ts`; modify `src/engines/report/{types.ts,draft.ts,frontMatter.ts,index.ts}`. Tests: create `src/test/reportCopies.test.ts`; update `src/test/reportDraft.test.ts`, `src/test/reportFrontMatter.test.ts`.

**Interfaces (produces):**
- `DRAFT_LAYOUT = 5`. `UPGRADABLE_FROM = 4`.
- `terminalBlocks(text: string): ({ kind: "prose"; text: string } | { kind: "code"; text: string })[]`: splits finding text into runs. A run is code when it is a fenced block, or a maximal run of ≥2 lines where each line matches one of: diff markers (`^diff --git `, `^index [0-9a-f]+\.\.`, `^(---|\+\+\+) `, `^@@ `, `^[+-]` followed by a non-space character or 4+ spaces), `^commit [0-9a-f]{7,40}`, `^(Author|Date):`, 4+ leading spaces or a tab, a shell prompt (`^\S*[$#>] `, `^PS [A-Z]:\\`), or is blank *between* two such lines. Everything else is prose. A single code-like line inside prose stays prose.
- `findingCopy(finding: Finding): ReportNode`: `{ type: "finding", attrs: { findingId, edited: false }, content: [...] }` with three labelled parts in order:
  - "Vulnerability Explanation:": the description's prose runs as paragraphs (inline markdown only: `code`, bold, italic, links; a line starting `- ` or `* ` followed by a non-space word **and** at least two such lines in a row becomes a bullet list), and code runs as `codeBlock` nodes.
  - "Vulnerability Fix:": `fixSteps` as a bullet list, or the remediation as above when it holds code or a table. When empty, a `slot` with hint "How to fix it", never the text "Not written yet".
  - "Severity:": severity plus the CVSS vector when set.
  - The `Affected:` line from `splitAffected` (when present) is its own labelled paragraph after Severity.
- `tableCopy(kind, hostId, data, target, meta): ReportNode`: `{ type: "table-block", attrs: { kind, hostId }, content: [table | paragraph] }`, built from the existing `tables.ts` rows. The ports Notes column takes the old node's `attrs.notes`. `result` becomes a single paragraph with a bold "Result:" lead.
- `evidenceCopy(entry: LogEntry, block: number | null): { copy: { command: string | null; output: string } | null; truncated: boolean }`: the attrs added to the evidence atoms. Flag nodes copy value and proof text. Exploit nodes get `copy: { content: string }` from the finding file.
- `buildTargetDraft` and `buildSectionDraft` emit copies (no `vuln` atoms, no `generated` atoms for these kinds).
- `upgradeDoc(doc: ReportNode, data: ReportData, target: ReportTarget | null, meta: ReportMeta): ReportNode`: converts a layout-4 doc in place.
  - `vuln` → `findingCopy`; each `generated` of a copied kind → `tableCopy`, keeping ports notes.
  - Each evidence, exploit or flag atom gains its copy attrs from the source, keeping `keep`, `emphasis`, `caption`, `width` and `appendix`.
  - Everything else is untouched.
- `refreshNode(node: ReportNode, data, target, meta): ReportNode | null`: the source's current copy for one block, or `null` when the source is gone or private.

- [ ] **Step 1: Failing tests** (`reportCopies.test.ts`):
  - `terminalBlocks` on the fixture's `grafana-repo` description gives prose, code (from `commit 4be1…` through `+} +?>`), then prose ("Affected: …").
  - Prose with two `- item` lines gives a list; a lone `-    private $x` stays code, never a list.
  - `findingCopy` with empty remediation has a `slot` with hint "How to fix it", and `JSON.stringify` does not contain "Not written yet".
  - `upgradeDoc` on a layout-4 doc (owner paragraphs in a step, a trimmed evidence with `keep`, a ports node with `notes`, a moved block) keeps every owner paragraph byte-for-byte, keeps `keep`/`notes`/`appendix`, and has no `vuln` node left.
  - `refreshNode` on an evidence whose entry went private gives `null`.
  - `evidenceCopy` of a 300 KB output gives `truncated: true` and 200 KB of text.
- [ ] **Step 2:** Run `npx vitest run src/test/reportCopies.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Update the draft and front-matter tests to the copy shapes, keeping their intent.
- [ ] **Step 4:** Run `npx vitest run src/test/reportCopies.test.ts src/test/reportDraft.test.ts src/test/reportFrontMatter.test.ts src/test/reportTables.test.ts` and `npm run typecheck`. Expected: PASS (suites owned by Tasks 2–3 may be red; list them).
- [ ] **Step 5:** Commit `feat(reports): page-owned copies and layout 5 upgrade in the engine`.

### Task 2: Editor: editable copies and Refresh

**Files:**
- Modify: `src/features/report/editor/{extension.ts,nodes/EvidenceView.tsx,nodes/ExploitView.tsx,nodes/parts.tsx,BlockHandle.tsx,pageActions.ts,ReportEditor.tsx}` and `src/features/report/ReportSection.tsx` (upgrade path: a layout-4 page runs `upgradeDoc` on open and saves; no "previous page" banner for an upgrade).
- Create: `src/features/report/editor/nodes/FindingView.tsx`, `nodes/TableBlockView.tsx`.
- Tests: `src/test/reportEditor.test.tsx`, `src/test/reportSection.test.tsx`.

**Interfaces:**
- Node `finding`: `content: "block+"`, attrs `{ findingId, edited }`, `defining`, `isolating`.
- Node `table-block`: `content: "(table | paragraph)+"`, attrs `{ kind, hostId, edited }`.
- Both are plain editable ProseMirror content. A container shows a thin left rule only while focused, so it reads as one block. `edited` flips true on the first user change inside it (one appendTransaction).
- Open chips edit their copy in a textarea-style code field: command and output for evidence, content for exploit, value and proof for a flag. Trim and highlight keep line indices into the copy. Editing the text resets `keep` to `null` when lines are added or removed.
- Block ⋯ menu gains **Refresh from log**, **Refresh from finding** or **Refresh from Raven**, by source. It calls `refreshNode` and replaces the node in one undoable transaction. When `edited` is true, it first asks "Replace your edits with the log's current text?" (the existing confirm dialog pattern). With no source (`null`), the item is absent.

- [ ] **Step 1: Failing tests:**
  - Typing in a finding's explanation paragraph changes the doc and never calls any finding API.
  - A table-block cell is editable.
  - Editing an open command chip's output updates `attrs.copy.output` and leaves the log entry unchanged; the fake API saw no log update.
  - Refresh on an unedited block replaces it with no dialog; on an edited one it asks first, and Undo restores the edit.
  - A gone source shows no Refresh item.
  - The reportSection layout-4 page upgrades on open: owner text kept, no restore banner, saved as layout 5.
- [ ] **Step 2:** Run `npx vitest run src/test/reportEditor.test.tsx src/test/reportSection.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/test/report*`, `npm run typecheck`, `npm run lint`. Expected: PASS apart from the Task 3 checks suite (list it).
- [ ] **Step 5:** Commit `feat(reports): every placed block is an editable copy with Refresh`.

### Task 3: Checks, rail and placement read copies

**Files:**
- Modify: `src/engines/report/{checks.ts,draft.ts (evidenceIdsIn, addNewEvidence),appendix.ts}`, `src/features/report/EvidenceRail.tsx`.
- Tests: `src/test/reportChecks.test.ts`, `src/test/reportRail.test.tsx`, `src/test/reportAppendix.test.ts`.

**Interfaces:**
- `evidenceIdsIn` also counts `finding` and `table-block` containers: placed findings via `findingId`.
- Proof checks read the flag atom's copy (value, proof text) and the copies of its companions.
- The finding checks (empty description or remediation, no severity) read the page's `finding` container: an empty Fix slot counts as empty.
- `suggestMoves` measures copies.
- **Add new evidence** never re-adds a finding already placed as a `finding` container.

- [ ] **Step 1: Failing tests (Review Focus 4):**
  - Editing a proof copy to drop the IP makes `proof-ip` fail.
  - Emptying a Fix raises the remediation check.
  - A placed `finding` container is counted as placed.
  - `suggestMoves` flags a copied 3,000-line output.
- [ ] **Step 2:** Run `npx vitest run src/test/reportChecks.test.ts src/test/reportRail.test.tsx src/test/reportAppendix.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run` (whole suite), `npm run typecheck`, `npm run lint`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(reports): checks and placement read the page's copies`.

### Task 4: Rhythm, Additional findings headings, chip counts, notices

**Files:**
- Modify: `src/features/report/page.css`, `src/engines/report/headings.ts` (number each Additional finding: `4.N.5.1`…), `src/features/report/editor/nodes/{PhaseView.tsx,parts.tsx}`, `src/ui/TimedNotice.tsx`, and the app shell file that owns the sidebar width (find it).
- Modify the audit: `audit/checks/ux.ts` (two new checks), `audit/screens.ts` (a `report-additional` screen on web01 scrolled to Additional findings, plus a `report-notice` screen after Add new evidence with nothing new).
- Tests: `src/test/reportHeadings.test.ts`, `src/test/reportEditor.test.tsx`, `src/test/ui/TimedNotice.test.tsx` (create if missing).

**Interfaces and values:**
- **Block rhythm on the page:**
  - 16px between top-level blocks.
  - 24px before every heading.
  - 12px between steps.
  - 8px between chips in a step.
  - The labelled parts of a finding have 6px between them and 20px after the last part.
  - Use margins on the page's direct children; a grid gap won't work in contenteditable.
- **Additional findings:** each finding has a numbered sub-heading (`4.3.5.1 Joomla 4.2.4 — Malicious File Upload`) at the H4 role, with 24px space before it.
- **Chip count:** `{n} lines` when `keep` is null or covers every line; `{kept} of {n} lines` only when lines are cut. `1 line` in the singular.
- **TimedNotice:**
  - Rendered through a portal into `document.body` at the top z layer.
  - Positioned `bottom: 16px; left: calc(var(--sidebar-w) + 16px)`, where `--sidebar-w` is a CSS variable the shell sets for both the expanded and collapsed widths (read the shell to find or add it).
  - It never overlaps the sidebar.
- **Audit checks:**
  - `occluded-notice`: for each `[role=status]` notice, `elementFromPoint` at its four inset corners and centre must hit the notice itself, and its rect must not intersect the sidebar's rect.
  - `block-gap`: consecutive visible top-level children of `.report-page .ProseMirror` must be at least 8px apart vertically.

- [ ] **Step 1: Failing tests:**
  - The headings test numbers Additional findings 4.3.5.1 and 4.3.5.2.
  - The chip shows "5 lines" for an untrimmed block and "3 of 5 lines" for a trimmed one.
  - `TimedNotice` renders in `document.body` with `left` offset by the sidebar width.
- [ ] **Step 2:** Run `npx vitest run src/test/reportHeadings.test.ts src/test/reportEditor.test.tsx src/test/ui/TimedNotice.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement, including the two audit checks and the two screens.
- [ ] **Step 4:** Run the whole `npx vitest run`, `npm run typecheck`, `npm run lint` and `npm run audit:visual`. Expected: PASS, with the new checks reporting 0 on the report screens.
- [ ] **Step 5:** Commit `fix(reports): block rhythm, numbered additional findings, chip counts; notices clear of the sidebar`.

### Task 5: Controller visual gate (not delegated)

- [ ] The controller runs the WebKit 1400×900 script on web01 (scrolled top to bottom), ms01, the AD set, Front matter (Summary, with its findings table), a notice with the sidebar expanded and with it collapsed, an open chip being edited, and Refresh with its confirm dialog.
- [ ] The controller Reads each PNG and writes one line per screen in the handover: what it shows and any flaw.
- [ ] Any flaw found goes back to an implementer as a fix round before handover.
