# Raven Reports rework (steps, tables, tabs, appendix pages, guide notes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the log-dump target pages with short numbered-step pages (evidence as chips), add the mock report's generated tables, swap the outline for a tab row, bring appendices back as first-class pages with + Page, and add dismissable guide notes.

**Architecture:** The pure engine (`src/engines/report/`) builds a new draft layout (4) where each finding's walkthrough is a `steps` node of `step` nodes and machines open with generated `result` and `ports` blocks. New pure table builders live in `tables.ts`. The editor (`src/features/report/editor/`) gains the `steps`/`step` schema, chip-mode evidence views and new generated views. `ReportSection.tsx` swaps `ReportOutline` for a `ReportTabs` tab row and a To do panel. The rail is regrouped by phase and inserts into the current step. A `page` section kind (Rust + TS) carries owner-written appendix and free pages. Guide notes are a fixed catalog rendered by the editor and hidden through a new Settings field.

**Tech Stack:** React 19 + TypeScript, ProseKit/ProseMirror, TanStack Query, Tauri 2 + Rust (rusqlite), Vitest + Testing Library, Tailwind (Ink tokens), Phosphor icons.

**Spec:** `docs/superpowers/specs/2026-11-11-raven-reports-design.md`. **§10 is the rework and overrides earlier sections where they disagree.** The model report is `docs/Mock exam A — model report.md`; the target-page mock is `.impeccable/mocks/decision/report-target-rethink.html` (option A). Rulings carried over: `docs/superpowers/followups/2026-11-12-raven-reports-a.md`.

## Global Constraints

- Branch `feat/reports` (HEAD after the spec commits). Do not merge or push.
- No new dependencies (owner rule: rebuild behaviour rather than add a library). ProseKit is the only editor library.
- DESIGN.md is binding: CSS grid by default, flex only for single-line runs; no text under 12px; one accent meaning one thing; no red (amber `text-warn` for gaps); Phosphor icon buttons with tooltips for row actions; focus rings; motion rules.
- Private content never reaches the page, rail, tables or checks text: private log entries, private notes, finding `lessons`, private ruled-out items and attempts, and `operator`-reason attempts.
- No AI and no suggested wording for the owner's prose. Guide notes are fixed text describing a section; they never offer sentences to paste.
- Real lab data lives in the encrypted DB: no migration is needed this round (section `kind` is free text). Do not create fixtures from real data.
- `DRAFT_LAYOUT` = 4. Stored pages of every section rebuild on next open and keep the "Restore your previous page" path.
- Copy rules: plain words, sentence case, no full stop at the end of check lines (existing convention: "outline check lines end alike, with no full stop").
- Commits: conventional `feat(reports): …` / `fix(reports): …`. **No `Co-Authored-By` or any AI attribution trailer** (a hook blocks it).
- Verify UI in WebKit at ~1400px wide (the owner's real window, WKWebView), not only Chromium.
- Tests: `npx vitest run <file>`; Rust: `cd src-tauri && cargo test <name>`; types: `npx tsc --noEmit`; lint: `npm run lint`.

## Review Focus

1. **The owner's stored layout-3 pages (every section kind, front matter included)** must rebuild to layout 4 on open and offer "Restore your previous page"; no stored text is lost without that path. Test owned by Task 1 (draft) and Task 6 (view).
2. **A step emptied or broken by editing:** deleting a step's sentence, dragging its only chip out, or backspacing the last step of a list must leave a valid document (a `steps` node never empty; a stray evidence node at top level still renders and still counts as placed). Test owned by Task 4.
3. **Rail + add with the cursor not in a step** (inside a ports Notes cell, a vuln block, a heading, or no focus) falls back to a new step at the end of the entry's phase, never into a table cell. Test owned by Task 7.
4. **Tab row overflow** at ~1400px with the sidebar expanded and 4 standalone targets + AD set + 3 appendices + 2 pages: the row scrolls, the selected tab is scrolled into view, and Export PDF stays visible. Test owned by Task 6 (selected tab `scrollIntoView` called), checked in Task 10's WebKit pass.
5. **An entry placed in a step later made private or deleted** still shows the amber placeholder chip inside its step, counts as a gap, and the step keeps its number. Test owned by Task 5.

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `src/engines/report/types.ts` | modify | `DRAFT_LAYOUT = 4`; new `GeneratedKind`s; `StepAttrs`; `PortsAttrs` notes; `PageMeta` |
| `src/engines/report/draft.ts` | modify | short draft, steps structure, placement into steps, `findingPhaseMap` |
| `src/engines/report/prove.ts` | modify | `placingEntries` (access, hop, flag, finding-step only) |
| `src/engines/report/tables.ts` | create | `portRows`, `resultLine`, `findingRows`, `scopeRows`, `attackPathRows` |
| `src/engines/report/frontMatter.ts` | modify | Scope table in introduction, findings table in summary, drop 3.1 scope line |
| `src/engines/report/checks.ts` | modify | read nested steps; new `step-replay` and `cred-finding` checks |
| `src/engines/report/appendix.ts` | modify | letters include owner appendix pages |
| `src/engines/report/guides.ts` | create | the guide-note catalog |
| `src/engines/report/index.ts` | modify | re-exports |
| `src/features/report/editor/extension.ts` | modify | `steps`/`step` node specs, keymap for + Step |
| `src/features/report/editor/nodes/StepsView.tsx` | create | numbered list chrome, + Step button |
| `src/features/report/editor/nodes/EvidenceView.tsx`, `ExploitView.tsx` | modify | chip mode, open in place, bar actions incl. Move to appendix |
| `src/features/report/editor/ChipState.tsx` | create | view-only open/closed chip state + "open all" toggle |
| `src/features/report/editor/nodes/GeneratedView.tsx` | modify | `ports`, `result`, `findings`, `scope-table`, `attack-path` views |
| `src/features/report/editor/BlockHandle.tsx` | modify | ⋯ menu with Move to appendix |
| `src/features/report/editor/GuideNote.tsx` | create | guide-note callout + decorations |
| `src/features/report/ReportTabs.tsx` | create | tab row, + Page menu, tab ⋯ menu |
| `src/features/report/TodoPanel.tsx` | create | checks + expected flags panel (replaces outline's per-target block) |
| `src/features/report/ReportOutline.tsx` | delete after moving `CheckList`, `ExpectedFlags` into `TodoPanel.tsx` |
| `src/features/report/ReportSection.tsx` | modify | compose tabs, To do panel, segmented parts, pages |
| `src/features/report/EvidenceRail.tsx` | modify | phase groups, + add / + to appendix, notes on rows |
| `src/features/report/queries.ts` | modify | create/delete/rename `page` sections |
| `src-tauri/src/reports.rs`, `commands.rs`, `lib.rs` | modify | `page` kind, `report_section_delete` |
| `src-tauri/src/settings.rs`, `src/types/settings.ts` | modify | `reportGuidesHidden` |
| `src/features/settings/…` (where the Report details group lives) | modify | "Show guide notes again" |
| `src/audit/fixtures.ts` | modify | fixture data covering steps, pages, tables |

---

### Task 1: Short draft with numbered steps (engine)

**Files:**
- Modify: `src/engines/report/types.ts`, `src/engines/report/prove.ts`, `src/engines/report/draft.ts`, `src/engines/report/index.ts`
- Test: `src/test/reportDraft.test.ts` (rewrite the expectations that assume the flat layout; keep its fixture helpers)

**Interfaces:**
- Produces (types.ts):
  - `DRAFT_LAYOUT = 4` (update the doc comment: "4: numbered steps with evidence chips, short draft, ports/result tables").
  - `GeneratedKind` adds `"ports" | "result" | "findings" | "scope-table" | "attack-path"`. `"port-scan"`, `"attack-chain"` and `"scope"` stay in the union so old pages render, but no draft creates them.
  - `interface StepAttrs { /** The entry the step was drafted from; null for a step the owner added. */ entryId: string | null }`.
  - `interface PortsAttrs extends GeneratedAttrs { notes: Record<string, string> }` (service id → owner text).
  - `interface PageMeta { title: string; placement: "appendix" | "body" }`.
- Produces (prove.ts): `placingEntries(data: ReportData, hostId: string): Set<string>`: the ids from `provingEntries` whose reasons include `"access" | "hop" | "flag" | "finding-step"` (goal and service reasons alone no longer place an entry).
- Produces (draft.ts):
  - `STEP_HINT = "Say what this step does"`.
  - `stepNode(entries: LogEntry[], extra?: ReportNode[]): ReportNode` → `{ type: "step", attrs: { entryId }, content: [sentence, ...evidence] }`, where the sentence is the entry's observations as `ownerParagraphs` when present, else `slot(STEP_HINT)`. A flag's step's sentence slot uses hint `"Say where you read the flag"`.
  - `stepsNode(steps: ReportNode[]): ReportNode` → `{ type: "steps", content: steps }`; never called with an empty list.
  - `findingPhaseMap(data: ReportData, target: ReportTarget): Map<string, { hostId: string; phase: Phase }>`: the phase each finding on the target was placed under by the draft (null-phase findings map to `"additional"`). Task 2 consumes it.
  - `buildTargetDraft`, `addNewEvidence`, `endOfPhase` keep their signatures. `endOfPhase` returns `{ at, nodes }` where `at` is now a **path** `number[]` (top-level index, then child indices) at which `nodes` (step nodes) are inserted. Update its callers (`AddEvidenceButton.tsx`, `pageActions.ts`) in this task.
- Removes: `REPRODUCE_HINT` slot from drafts (keep `REPRODUCE_LABEL` exported, now rendered as a bold "Steps to reproduce" line by the `steps` view, so drafts no longer add a labelled slot).

Draft shape for one machine (§10.2), in order:
`generated("facts")`, `generated("result")`, then `phase("enum")` + `generated("ports")` (every machine, standalone and AD), then per entry phase and finding group as built today: `phase`, `vuln`, then **one** `steps` node holding a step per placed entry (screenshots joining the step before them; exploit nodes go inside the step whose command names the file, else the step that granted access, else a new owner step `stepNode([])` holding only the exploit), the local flag as the phase's last step with its companions inside it. Post-Exploitation: one `steps` node, the proof flag step first. Additional findings and Also tested unchanged. The AD set draft: `generated("attack-path", null)` first, then each machine's block (no set-wide `port-scan`, no closing `attack-chain`).

- [ ] **Step 1: Write the failing tests** in `src/test/reportDraft.test.ts`:

```ts
it("places only access, hop, flag and finding-step entries; goal and service entries stay off the page", () => {
  // fixture: enum entry e1 is goal evidence and confirms service 80; e2 grants user access; e3 is a local flag
  const doc = buildTargetDraft(data, standalone("h1"), {});
  expect([...evidenceIdsIn(doc)].sort()).toEqual(["e2", "e3"]);
});
it("puts a finding's walkthrough in one numbered steps list, one step per placed entry", () => {
  const steps = topLevel(doc).filter((n) => n.type === "steps");
  expect(steps).toHaveLength(1);
  expect(steps[0].content!.map((s) => s.attrs!.entryId)).toEqual(["e2", "e3"]);
  expect(steps[0].content![0].content![0]).toMatchObject({ type: "slot", attrs: { hint: "Say what this step does" } });
});
it("a screenshot joins the step before it", () => {
  /* shot logged 2 min after e2 */ expect(stepOf(doc, "e2").content!.map((n) => n.attrs?.entryId)).toContain("shot1");
});
it("opens every machine with facts, result, enum heading and ports, and never emits port-scan or attack-chain", () => {
  expect(topLevel(doc).slice(0, 4).map((n) => n.attrs?.kind ?? n.attrs?.phase)).toEqual(["facts", "result", "enum", "ports"]);
  expect(JSON.stringify(adDoc)).not.toMatch(/"port-scan"|"attack-chain"/);
});
it("opens the AD set with the attack-path table", () => {
  expect(adDoc.content![0]).toMatchObject({ type: "generated", attrs: { kind: "attack-path", hostId: null } });
});
it("an exploit file sits inside the step whose command names it", () => {
  expect(stepOf(doc, "run46153").content!.some((n) => n.type === "exploit")).toBe(true);
});
it("addNewEvidence appends a new placed entry as the last step of its phase's list, before the local flag step", () => {
  const { doc: next, added } = addNewEvidence(doc, withNewGrant, standalone("h1"), {}, []);
  expect(added).toEqual(["e9"]);
  const ids = firstSteps(next).content!.map((s) => s.attrs!.entryId);
  expect(ids.indexOf("e9")).toBe(ids.indexOf("e3") - 1);
});
it("endOfPhase returns a path inside the phase's steps list", () => {
  const { at, nodes } = endOfPhase(doc, data, standalone("h1"), late);
  expect(at.length).toBe(2);
  expect(nodes[0].type).toBe("step");
});
it("evidenceIdsIn finds evidence nested in steps", () => {
  expect(evidenceIdsIn(doc).has("e2")).toBe(true);
});
```

(`topLevel`, `stepOf`, `firstSteps` are small helpers in the test file.)

- [ ] **Step 2: Run** `npx vitest run src/test/reportDraft.test.ts`. Expected: the new tests FAIL (current draft is flat).
- [ ] **Step 3: Implement** the types, `placingEntries`, `stepNode`, `stepsNode`, `findingPhaseMap` and the new `hostBlock`/AD draft, then `addNewEvidence`/`endOfPhase` placement by path (find the phase's region as `regionEnd` does; inside it the last `steps` node; insert before its flag step when the entry is not a flag; create a `steps` node after the region's `vuln` (or heading) when none exists). Keep `removedEntryIds` semantics. Update the old flat-layout tests in the file to the new shape rather than deleting their intent (phase split, finding grouping, companions, AD ordering).
- [ ] **Step 4: Run** `npx vitest run src/test/reportDraft.test.ts src/test/reportCapturedHost.test.ts`. Expected: PASS. Then `npx tsc --noEmit`. Expected: errors only in files Tasks 3–5 own (checks, editor views); list them in the commit body.
- [ ] **Step 5: Commit** `feat(reports): layout 4 short draft with numbered steps`.

### Task 2: Generated tables (engine) and front-matter drafts

**Files:**
- Create: `src/engines/report/tables.ts`
- Modify: `src/engines/report/frontMatter.ts`, `src/engines/report/index.ts`
- Test: create `src/test/reportTables.test.ts`; modify `src/test/reportFrontMatter.test.ts`

**Interfaces:**
- Consumes: `findingPhaseMap` (Task 1), `domainController`, `machineOrder`, `expectedFlags`, `reportTargets`.
- Produces (tables.ts):
  - `portRows(data, hostId): { serviceId: string; port: string; service: string; version: string }[]`: open services (`state` starting with `open`) by port; `port` = `"445/tcp"`; `service` = `confirmedProduct ?? nmapService ?? ""`; `version` = `confirmedVersion ?? nmapVersion ?? ""`.
  - `resultLine(data, target, hostId, meta): { access: string; flags: { kind: FlagKind; value: string }[] }`. `access` joins the host's grants in time order: first `"shell as `user`"` (hop-entered machines: `"<hop via> as `user`"`), then levels reached after it as `root` (linux admin/system), `SYSTEM`, or `local administrator as `user``, separated by `", then "`; empty when no grants. Flags: non-private flag entries on the host for the expected kinds, local first.
  - `findingRows(data, targets): { n: number; findingId: string; host: string; title: string; severity: Severity | null; result: string }[]`: every finding on a report target's machines, once (AD: its owner machine), sorted by the draft's severity rank, then by target grading order. `result` per §10.3: entry phase → `"Initial access"` (`"Foothold"` if hop-entered); `privesc` → `"Root"` / `"SYSTEM"` / `"Administrator"` from the highest grant level on the host; `domain` → `"Domain Admin"`; `lateral` → `"Foothold"`; additional → `"None"`. `host` is the host name (two machines: `"MS01 / DC01"`).
  - `scopeRows(data, targets): { host: string; ip: string; os: string; set: "Independent" | "AD" }[]`, grading order.
  - `attackPathRows(data, hostIds): { step: number; from: string; technique: string; to: string; access: string }[]`: hops into and grants on the set's machines, merged in time order; `from` = source host name or `"Kali"`; `technique` = `via`; `access` = for a grant `` `user` (level) ``, for a hop the grant logged with the same entry if any, else `""`.
- Front matter: the introduction draft ends with a `"1.4 Scope"` subheading node as the existing introduction parts are built, then `generated("scope-table", null)`. The summary draft gets `generated("findings", null)` after its four prose slots and before the `2.1 Recommendations` heading. The methodology draft drops its 3.1 `generated("scope")`.

- [ ] **Step 1: Write the failing tests** in `src/test/reportTables.test.ts`, one per function, using the data shapes from `reportDraft.test.ts`. They must assert at least these values:

```ts
expect(portRows(data, "h1")[0]).toEqual({ serviceId: "s-h1-21", port: "21/tcp", service: "vsftpd", version: "3.0.5" });
expect(resultLine(data, standalone("h1"), "h1", {})).toEqual({ access: "shell as `ronan`, then root", flags: [{ kind: "local", value: "860f" }, { kind: "proof", value: "ee23" }] });
expect(findingRows(data, targets).map((r) => [r.title, r.result])).toEqual([["Exposed .git", "Initial access"], ["sudo find", "Root"], ["Anonymous FTP", "None"]]);
expect(findingRows(data, targets).every((r) => !("lessons" in r))).toBe(true);
expect(scopeRows(data, targets)).toEqual([{ host: "quartz", ip: "172.31.166.144", os: "Ubuntu 22.04", set: "Independent" }, /* … */]);
expect(attackPathRows(data, ["ms01", "ms02", "dc01"])[0]).toEqual({ step: 1, from: "Kali", technique: "APS file upload", to: "ms01", access: "`jo.parker` (user)" });
```

and in `reportFrontMatter.test.ts`: the summary draft contains a `findings` generated node before the Recommendations heading; the introduction draft ends with `scope-table`; the methodology draft has no `scope` node.
- [ ] **Step 2: Run** `npx vitest run src/test/reportTables.test.ts src/test/reportFrontMatter.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `tables.ts` and the front-matter changes; export from `index.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): ports, result, findings, scope and attack-path tables`.

### Task 3: Checks read steps; step-replay and credential checks

**Files:**
- Modify: `src/engines/report/checks.ts`, `src/engines/report/appendix.ts` (`suggestMoves` walks nested nodes; keys stay node paths)
- Test: `src/test/reportChecks.test.ts`, `src/test/reportAppendix.test.ts`

**Interfaces:**
- Consumes: layout-4 docs (Task 1).
- Produces: check ids `step-replay:{sectionId}:{path}` and `cred-finding:{credentialId}:{hostId}`, both `level: "soft"`; `checkKind` maps them to `"step-replay"` and `"cred-finding"`.
- Texts (exact): `"Step {n} of {heading} has no command or output under it, so a reader can't replay it. Add it from the log column"` and `` "{user}'s credential from {source} got you onto {host}, but no finding covers it. A credential that lets you move is a finding too" ``.

The existing "every step is explained" check becomes: a `step` whose sentence (its first child) is an empty slot → the existing soft check text, anchored to the step. Flag steps are exempt only if their slot is the flag hint and the flag block prints its own label (keep today's flag exemption). "Proof present" and the other evidence checks walk evidence nodes at any depth.

- [ ] **Step 1: Write the failing tests:**

```ts
it("flags a step with owner text and no evidence", () => {
  const checks = targetChecks(input(docWith(step([para("Downloaded the repo")]))));
  expect(checks.find((c) => checkKind(c.id) === "step-replay")?.text).toBe("Step 1 of Initial Access has no command or output under it, so a reader can't replay it. Add it from the log column");
});
it("a step holding only a screenshot passes the replay check", () => { /* expect no step-replay */ });
it("an empty step sentence is the explain check, anchored to the step", () => { /* … */ });
it("flags a credential from one machine that granted access on another with no finding naming it", () => {
  // cred sam (sourceHostId ms01), grant for username sam on ms02, no finding mentions sam
  expect(texts).toContain("sam.rivera's credential from ms01 got you onto ms02, but no finding covers it. A credential that lets you move is a finding too");
});
it("no credential check when a finding on either machine names the username or has the grant's entry as a step", () => { /* both variants */ });
it("a private credential never produces a check", () => { /* … */ });
it("evidence nested in steps still satisfies proof present", () => { /* … */ });
it("suggestMoves finds long output inside a step and returns its nested path key", () => { /* … */ });
```

- [ ] **Step 2: Run** `npx vitest run src/test/reportChecks.test.ts src/test/reportAppendix.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Make the existing `visit` yield nested nodes with their full path; the credential check uses `Credential.sourceHostId`, `username`, `private` if present on the type (else non-private by default), `AccessGrant.usernameId` → `Username`, and `Hop.logEntryId`.
- [ ] **Step 4: Run** the same command plus `npx vitest run src/test/reportCoverage.test.ts src/test/reportHeadings.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): checks read numbered steps; replay and credential checks`.

### Task 4: Editor schema: steps and step

**Files:**
- Modify: `src/features/report/editor/extension.ts`, `src/features/report/editor/commands.ts`, `src/features/report/page.css`
- Create: `src/features/report/editor/nodes/StepsView.tsx`
- Test: `src/test/reportEditor.test.tsx`

**Interfaces:**
- Consumes: `StepAttrs`, `STEP_HINT`, `REPRODUCE_LABEL` (Task 1).
- Produces:
  - Node `steps`: `group: "block"`, `content: "step+"`, React view rendering the bold label `REPRODUCE_LABEL` (text "Steps to reproduce", replacing the old "Steps to reproduce the attack:" constant value), the ordered steps (CSS counter, restarting per `steps`), and a "+ Step" text button under the list (Tooltip "Add a step (⌘⇧↵)").
  - Node `step`: `content: "(slot | paragraph) block*"`, attrs `{ entryId: null }`, `defining: true`, draggable via its number.
  - Command `addStep(): Command`: inserts an empty step (slot with `STEP_HINT`) after the step holding the selection, or at the end of the nearest `steps` list; bound to ⌘⇧↵.
  - Command `insertIntoCurrentStep(nodes: PMNode[]): Command | null`: appends nodes to the end of the step that holds the selection; returns `null` when the selection is not inside a step (Task 7 then falls back to `endOfPhase`).
- The toDOM/parseDOM of both nodes use `data-report="steps|step"`, like the atoms.

- [ ] **Step 1: Write the failing tests** in `reportEditor.test.tsx`:

```ts
it("renders a steps list numbered from 1 and restarting per list", () => { /* two lists → "1","2","1" */ });
it("+ Step adds an empty step after the current one", () => { /* click, expect 3 steps, new one's slot hint "Say what this step does" */ });
it("backspacing every step of a list leaves a valid document with no empty steps node", () => { /* editor.state.doc.check() does not throw; no steps with 0 children */ });
it("dragging the only chip out of a step leaves the step with its sentence", () => { /* … */ });
it("insertIntoCurrentStep returns null when the selection is in a heading or table cell", () => { /* … */ });
```

- [ ] **Step 2: Run** `npx vitest run src/test/reportEditor.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Step number column on a grid track (`grid-template-columns: 2rem minmax(0,1fr)`); number uses the `meta` type role, not under 12px.
- [ ] **Step 4: Run** `npx vitest run src/test/reportEditor.test.tsx src/test/reportEditing.test.tsx src/test/reportEditorTools.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): steps and step nodes in the editor`.

### Task 5: Evidence chips, open in place, visible Move to appendix

**Files:**
- Create: `src/features/report/editor/ChipState.tsx`
- Modify: `src/features/report/editor/nodes/EvidenceView.tsx`, `ExploitView.tsx`, `src/features/report/editor/BlockHandle.tsx`, `src/features/report/editor/FormatToolbar.tsx`, `src/features/report/editor/ReportEditor.tsx`, `src/features/report/page.css`
- Test: `src/test/reportEditor.test.tsx`, `src/test/reportEditing.test.tsx`

**Interfaces:**
- Produces:
  - `ChipStateProvider` and `useChip(key: string): { open: boolean; setOpen(v: boolean): void }`; `useChipsAll(): { allOpen: boolean; setAll(v: boolean): void }`. State lives in React only (never stored in the doc). Key = the node's `entryId:block` (exploit: `fileId`).
  - Evidence inside a `step` renders as a chip when closed: command → `$ {command}` (mono, truncated with ellipsis on one line) + `{kept} of {total} lines`; screenshot → 40px-tall thumbnail + `Figure {n} · {caption}`; flag → `{Local|Proof}.txt · {value}`; moved/split block → `→ Appendix {ref}`; private/deleted → the amber placeholder text as a chip. Exploit → `{name}` + `modified · {n} lines changed` or `unmodified · {url}`.
  - Open: the existing full block exactly as it prints, with a bar: `{Command output | Screenshot | Exploit} · showing {kept} of {total} lines`, buttons **Trim**, **Highlight**, **Edit text**, **Move to appendix** (icon buttons with tooltips are fine where the label would crowd; Move to appendix keeps its text), close (Esc). Under the block: `{n} lines cut. The PDF prints exactly what's shown here.` when lines are cut.
  - Evidence at top level (outside a step) keeps today's full rendering.
  - Toolbar toggle "Open all evidence" / "Close all evidence" (icon button with tooltip) in `FormatToolbar`.
  - `BlockHandle` gains a ⋯ menu: Move to appendix (or Back inline), Delete. Uses the existing appendix commands in `pageActions.ts`.
- Keys: ↵ on a selected chip opens it; Esc inside an open chip closes it and reselects the chip.

- [ ] **Step 1: Write the failing tests:**

```ts
it("evidence inside a step shows as a chip with its command and line count", () => { expect(screen.getByText("$ nmap -p- 10.0.0.5")).toBeInTheDocument(); expect(screen.getByText("12 of 40 lines")).toBeInTheDocument(); });
it("clicking a chip opens the full block with Trim, Highlight, Edit text and Move to appendix", () => { /* … */ });
it("Escape closes an open chip", () => { /* … */ });
it("Open all evidence opens every chip; the doc JSON is unchanged", () => { /* compare editor.getDocJSON() before/after */ });
it("a private entry in a step shows the amber placeholder chip and the step keeps its number", () => { /* Review Focus 5 */ });
it("the block handle menu moves a block to the appendix", () => { /* attrs.appendix becomes "moved" */ });
```

- [ ] **Step 2: Run** `npx vitest run src/test/reportEditor.test.tsx src/test/reportEditing.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): evidence chips that open in place; Move to appendix in the bar and block menu`.

### Task 6: Generated views and the tab row

**Files:**
- Modify: `src/features/report/editor/nodes/GeneratedView.tsx`, `src/features/report/editor/extension.ts` (generated atom default attrs gain `notes: {}`), `src/features/report/ReportSection.tsx`, `src/features/report/ReportStrip.tsx`
- Create: `src/features/report/ReportTabs.tsx`, `src/features/report/TodoPanel.tsx`
- Delete: `src/features/report/ReportOutline.tsx` (move `CheckList`, `ExpectedFlags`, `CheckAction` into `TodoPanel.tsx`; keep their behaviour and tests)
- Test: `src/test/reportSection.test.tsx`, `src/test/reportEditor.test.tsx`

**Interfaces:**
- Consumes: `tables.ts` (Task 2).
- Produces:
  - Generated views: `ports` (table Port/Service/Version/Notes; each Notes cell is an `<input>` writing `attrs.notes[serviceId]` through a node attr update; empty table → "No open ports recorded for {host}"), `result` (bold "Result:" + access + flags in mono; an **Edit text** button replaces the node with a `paragraph` holding the same text, `fromEntry: null`), `findings` (#/Host/Finding/Severity/Result), `scope-table` (Host/IP address/OS/Set), `attack-path` (Step/From/Technique/To/Access gained). Old kinds (`port-scan`, `attack-chain`, `scope`) keep rendering.
  - `ReportTabs` props: `{ tabs: TabItem[]; openId: string; onOpen(id: string): void; onReorder(id: string, delta: -1 | 1): void; onAddPage(placement: "appendix" | "body"): void; onPageMenu?(id: string, action: "rename" | "delete"): void; exportSlot: ReactNode }` with `interface TabItem { id: string; label: string; state: "ready" | "todo" | "not-started" | "none"; todo?: number; detail?: string; reorderable?: boolean; page?: boolean }`. Tablist semantics, roving tabindex, ←/→, ↵, ⌥←/⌥→ reorder, selected tab `scrollIntoView({ block: "nearest", inline: "nearest" })`. Clicking `N to do` on a tab opens that tab and the To do panel.
  - `TodoPanel` props: `{ checks: Check[]; flags?: ReactNode; onAction(a: CheckAction): void; onClose(): void }`, rendered at the top of the page pane, Esc closes.
  - `ReportSection.tsx`: tab order **Front matter**, standalone targets, AD set, body pages (Task 8), **Closing** (further, references, engagement-level Also tested, present only if any of them is), appendices (target appendices then appendix pages). Front matter and Closing show a segmented row (`role="tablist"` of their parts) above the page. The strip's `TO DO` cell (rename of the gaps cell: label "To do") opens the panel for the open tab. Narrow (<1000px) picker and Checks disclosure are removed; the rail drawer rule (<1200px) stays.
- [ ] **Step 1: Write the failing tests:**

```ts
it("shows a tab row in grading order with Front matter first and + Page last", () => { /* names */ });
it("⌥→ on a target tab moves it later in grading order", () => { /* reorder called */ });
it("the selected tab is scrolled into view", () => { /* spy on Element.prototype.scrollIntoView */ });
it("clicking '3 to do' opens the To do panel with that target's checks; a check click focuses its block", () => { /* … */ });
it("Front matter's segmented row switches between Details, Introduction, Summary, Considerations, Methodology", () => { /* … */ });
it("a layout-3 target page and a layout-3 summary page both rebuild and offer Restore your previous page", () => { /* Review Focus 1 */ });
it("the ports table's Notes cell saves into the node", () => { /* type, flush, expect attrs.notes */ });
it("Edit text on the result line turns it into an editable paragraph", () => { /* … */ });
```

- [ ] **Step 2: Run** `npx vitest run src/test/reportSection.test.tsx src/test/reportEditor.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Tab row is a grid row of `auto` tracks inside an `overflow-x-auto` container, Export at the strip's right as now (§10.1 puts it at the row's right: place it in the tab row's last track, sticky right, so it never scrolls away).
- [ ] **Step 4: Run** `npx vitest run src/test/report*`. Expected: PASS. `npx tsc --noEmit` clean, `npm run lint` clean.
- [ ] **Step 5: Commit** `feat(reports): tab row, To do panel and generated tables on the page`.

### Task 7: Log column grouped by phase, + add into the current step

**Files:**
- Modify: `src/features/report/EvidenceRail.tsx`, `src/features/report/AddEvidenceButton.tsx`, `src/features/report/editor/pageActions.ts`
- Test: `src/test/reportRail.test.tsx`

**Interfaces:**
- Consumes: `insertIntoCurrentStep` (Task 4), `endOfPhase` with path (Task 1), `phaseSplit`, `isPortScan`, `testedNotExploited`, the appendix move action (Task 5).
- Produces: `railGroups(data, target, doc): { phase: Phase; label: string; rows: RailRow[] }[]` (exported from `EvidenceRail.tsx` for tests) with `interface RailRow { entry: LogEntry; line: string; action: "add" | "appendix"; note?: "in-ports" | "in-tested" }`. Labels: "Service enumeration", "Initial access", "Privilege escalation", "Post-exploitation" (AD: "Lateral movement", "Domain compromise" as the phases name). `line` = first non-empty output line, else the observations' first line, else "no output". `action` is `"appendix"` when the entry's longest output exceeds the appendix line threshold `suggestMoves` uses. Heading `{host} log · not in the report` (AD: one group set per machine).
- **+ add**: `insertIntoCurrentStep` with a new step's evidence (no new step), else `endOfPhase` new step. **+ to appendix**: same placement, then the inserted evidence's `appendix` set to `"split"` (trimmed inline, full in appendix). Rows for failed attempts read "in Also tested"; port scans whose ports are all in the host's services read "in the port table already". ⌘↵ on a focused row = its action.

- [ ] **Step 1: Write the failing tests:**

```ts
it("groups the host's unplaced entries by phase in time order", () => { /* labels and ids */ });
it("+ add with the cursor in step 2 appends the entry's evidence to step 2", () => { /* … */ });
it("+ add with the cursor in a ports Notes cell or a heading adds a new step at the end of the entry's phase", () => { /* Review Focus 3 */ });
it("a 3,000-line output offers + to appendix and lands split", () => { /* … */ });
it("a failed attempt's row says it is in Also tested", () => { /* … */ });
it("private entries never appear", () => { /* … */ });
```

- [ ] **Step 2: Run** `npx vitest run src/test/reportRail.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): log column by phase, + add into the current step`.

### Task 8: Appendix pages and free pages (+ Page)

**Files:**
- Modify: `src-tauri/src/reports.rs` (`KINDS` gains `"page"`; `validate`: `"page"` requires a non-empty key; new `section_delete(conn, report_id, id)`), `src-tauri/src/commands.rs` (`report_section_delete`), `src-tauri/src/lib.rs` (register), `src/lib/api.ts` (or wherever `reportSectionUpsert` is wrapped: add `reportSectionDelete`), test fake API, `src/types/report.ts` (`SectionKind` adds `"page"`), `src/features/report/queries.ts`, `src/engines/report/appendix.ts`, `src/engines/report/headings.ts`, `src/features/report/ReportSection.tsx`
- Test: Rust tests in `reports.rs`; `src/test/reportAppendix.test.ts`, `src/test/reportSection.test.tsx`

**Interfaces:**
- Produces:
  - Rust `report_section_delete(report_id: String, id: String) -> AppResult<()>`; deleting a non-`page` section is refused (`Validation { field: "kind", message: "only pages can be deleted" }`).
  - TS `createPage(report: Report, placement: "appendix" | "body", position: number): Promise<ReportSection>`: `kind: "page"`, `targetKey: crypto.randomUUID()`, `meta: { title: placement === "appendix" ? "Untitled appendix" : "Untitled page" , placement }`, `doc: { type: "doc", content: [{ type: "paragraph" }] }`, `meta.layout = DRAFT_LAYOUT`. `renamePage(section, title)`, `deletePage(section)`.
  - `numberAppendices` letters: target appendices in report order, then appendix pages by `position`. An appendix page's own entries are not numbered (it is one page, `Appendix C – <title>`).
  - Body pages are numbered as body sections after the targets (`sectionNumbers`).
  - Tab ⋯ menu on a page tab: Rename (inline input on the tab), Delete (confirm dialog "Delete <title>? Its text goes with it." with undo toast for the session that re-creates it from the kept doc).
- [ ] **Step 1: Write the failing tests:** Rust `page_kind_requires_key`, `delete_refuses_non_page`, `delete_removes_page`; TS: + Page → Appendix page creates a lettered tab after target appendices; + Page → Free page creates a numbered tab after targets; rename updates the tab and heading; delete with undo restores text.
- [ ] **Step 2: Run** `cd src-tauri && cargo test reports` and `npx vitest run src/test/reportAppendix.test.ts src/test/reportSection.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): appendix and free pages with + Page`.

### Task 9: Guide notes

**Files:**
- Create: `src/engines/report/guides.ts`, `src/features/report/editor/GuideNote.tsx`
- Modify: `src-tauri/src/settings.rs` (`reportGuidesHidden: Vec<String>`, each id ≤ 64 chars, ≤ 200 ids, default empty), `src/types/settings.ts`, the Settings page's Report details group (a "Show guide notes again" button, disabled when none are hidden), `src/features/report/editor/ReportEditor.tsx`, `src/features/report/ReportSection.tsx`
- Test: create `src/test/reportGuides.test.tsx`; Rust `settings_report_guides_round_trip_and_capped`; extend `src/test/settingsReport.test.tsx`

**Interfaces:**
- Produces: `GUIDES: Record<GuideId, { title: string; body: string }>` and `guideFor(node: ReportNode, sectionKind: SectionKind): GuideId | null`, with `GuideId` = `"introduction" | "scope" | "summary" | "findings-table" | "recommendations" | "considerations" | "methodology" | "house-cleaning" | "ports" | "result" | "vuln" | "steps" | "exploit" | "post" | "additional" | "tested" | "attack-path" | "appendix" | "page"`. `GuideNote` renders above the matching node as a widget decoration (not part of the doc, so never saved, copied or exported), with a dismiss icon button (Tooltip "Hide this note") and a "Hide all guide notes" text button. Hidden ids come from Settings; `"*"` hides all.
- Copy: write each body in 1–3 short sentences, in the mock report's "From your notes" spirit. It says what the part is for, where Raven filled it from, and one practical tip, all drawn from `docs/Mock exam A — model report.md`. Examples: ports: "Keep the ports that mattered and say why in Notes. The scan itself is in the log column if you want to show it." vuln: "Explain why the flaw works in neutral, third-person voice: what the software does wrong and what that lets anyone do." exploit: "List every change you made to a public exploit and why. The diff marks the lines; you explain them." tested: "What you tried that didn't work. It shows a reader the coverage. Operator mistakes stay private." No guide offers report sentences to copy.
- [ ] **Step 1: Write the failing tests:** a ports node shows the ports guide; Hide this note hides it and saves `reportGuidesHidden: ["ports"]`; Hide all saves `["*"]`; the doc JSON has no guide content; Settings "Show guide notes again" clears the list; Rust round trip and caps.
- [ ] **Step 2: Run** `npx vitest run src/test/reportGuides.test.tsx src/test/settingsReport.test.tsx` and `cd src-tauri && cargo test settings_report_guides`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): dismissable guide notes`.

### Task 10: Fixtures, visual audit, WebKit pass, followups

**Files:**
- Modify: `src/audit/fixtures.ts` (synthetic exam engagement: 3 standalone + AD set of 3 shaped like the mock report's hosts but with invented names/IPs/flags; a modified exploit; a long winPEAS output; a private entry; a credential carried from one AD machine to another with no finding; one appendix page and one free page), the visual-audit Report scenarios, `docs/superpowers/followups/2026-11-12-raven-reports-a.md`
- [ ] **Step 1:** Run `npm run audit:visual` and fix any finding on the Report view (tiny text, overflow, contrast).
- [ ] **Step 2:** In WebKit at 1400×900 with the sidebar expanded, drive these real tasks on the fixture and record what you saw: open a target, open a chip, trim it, move it to the appendix, add a step from the log column with the cursor in step 2 and with no cursor, add an appendix page and a free page, reorder targets with ⌥←/⌥→, open To do from a tab and jump to a check, hide a guide note. Measure the standalone target page height and confirm it is under 3,000 px with chips closed.
- [ ] **Step 3:** `npx vitest run` (whole suite), `npx tsc --noEmit`, `npm run lint`, `cd src-tauri && cargo test`. Expected: all pass.
- [ ] **Step 4:** Append a "Rework round" section to the followups doc: rulings made, parked items, what Plan B (page-style round + PDF/.7z export) must carry (steps numbering, chips print open, guide notes never print, `page` sections in the PDF).
- [ ] **Step 5: Commit** `test(reports): rework fixtures and visual audit; followups`.
