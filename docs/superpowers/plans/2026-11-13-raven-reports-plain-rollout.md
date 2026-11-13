# Raven Reports: plain pages rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every report page (targets, the AD set, front matter, closing, owner pages) is one plain, fully editable ProseMirror document. Every block (text, code, tables, captions, figures) can be edited, moved or deleted without touching the log, findings or files.

**Architecture:** `buildPlainTarget` (already proved on `/__compare/garnet`) and a plain `buildSectionDraft` write ordinary nodes plus one `figure`. Each generated block carries hidden `source` and `gen` attrs, and empty prose is a paragraph with a `hint` attr. One schema serves every page. The page machinery (slot, generated, evidence, finding, table-block, steps/step, phase, vuln, exploit, and their views and engine code) is removed. Stored pages under an older layout are rebuilt at layout 6, and the old page stays in `meta.previousDoc`. "Restore your previous page" converts the old page with `flattenToPlain`. Checks, numbering, guide notes and the rail read the plain doc by its `source` attrs and headings. Guide notes, checks, the log column and Export sit beside the page.

**Tech Stack:** Tauri 2, Rust/rusqlite (no schema change in this plan), React 19 + TypeScript, ProseKit/ProseMirror, TanStack Query, Vitest + Testing Library, Playwright audit (`npm run dev:audit`, port 5199).

**Spec:** `docs/superpowers/specs/2026-11-11-raven-reports-design.md`. Read §10 and §10.8 for history and **§11 (this direction; it supersedes §10's page machinery and §10.8's container copies)**.

## Global Constraints

- Branch `feat/reports`. Commit after every task. No Co-Authored-By or other AI attribution in commits (owner's hook blocks it).
- The DB holds real lab data. No Rust or SQL change in this plan. Stored pages change only through the layout-6 rebuild, which keeps the old page in `meta.previousDoc`, and the open-time flatten, which also keeps the original in `previousDoc`. Never drop a stored doc.
- `DRAFT_LAYOUT = 6`. A page at layout 6 is never rebuilt.
- No new dependencies (owner rule: build our own behaviour, never add a UI library).
- DESIGN.md: CSS grid by default (flex only for single-line runs). No text under 12px (sentences, values and warnings at least 13px). Interactive targets at least 24px. Visible focus rings. No red: gaps and warnings in amber (`text-warn`). No joined " · " strings in copy. Row and block actions are Phosphor icon buttons with tooltips.
- The page holds only `PAGE_NODE_TYPES` (Task 3). `source`, `gen` and `hint` never print. A hint shows only while its paragraph is empty.
- Owner pages (kind `page`, + Page) are never rebuilt. They use the same schema.
- Screenshots on findings are out of scope (separate plan).
- Verification commands for every task: `npx vitest run`, `npm run typecheck`, `npm run lint`. **Baseline:** 32 tests in `src/test/reportSection.test.tsx` fail before this plan ("Unknown node type: table-block"). Tasks 1 to 5 must not add any failure. From Task 6 on, the whole suite is green.

## Review Focus

1. **An existing real page losing owner text on upgrade.** A layout-5 page holds owner sentences in step slots, edited finding copies, typed port Notes and captions. After the rebuild, `previousDoc` must be byte-identical to the stored page. After Restore, every owner string must be on the page. Tests: Task 3 `flattenToPlain keeps every string of a layout-5 page`; Task 6 `a layout-5 page rebuilds and keeps the old page byte for byte` and `Restore shows every owner sentence of a layout-5 page`.
2. **Saves racing the rebuild.** A queued, unsaved write of the old page (failed and retrying, or mid-debounce) can land after the rebuilt draft and overwrite it, or the rebuild can capture a stale `previousDoc`. The rebuild flushes the save queue first and reads `previousDoc` from the cache after the flush. Test: Task 6 `a queued write of the old page lands before the rebuild, never after it`.
3. **A figure whose screenshot file is missing** (attachment gone or unreadable). It must say so in amber, keep its caption editable, stay deletable and movable, and never blank the page. Test: Task 5 `a figure whose screenshot file is missing says so and stays editable`.
4. **Refresh on a block the owner edited.** Raven must ask first and replace only that block's run of same-source siblings. Cancel changes nothing, and ⌘Z restores the owner's text. A block whose source is private or gone offers no Refresh. Tests: Task 7 `Refresh on an edited block asks; Cancel keeps it; Replace swaps only its run; undo restores`.
5. **Pasted terminal text in finding fields** (a git diff in remediation, a commit in the description, an indented block). It must render as a code block, never as bullets, italics or a list, and Refresh must do the same. Test: Task 1 `a git diff pasted into a remediation is a code block, never a list or italics`.
6. **Empty sections.** A machine with nothing logged, a summary with nothing written, or a findings table with no findings must never produce an empty heading, an orphan "Steps to reproduce:", a printed "None recorded." or a blank page. Tests: Task 1 `a machine with nothing logged is its heading alone`; Task 2 `an unwritten summary prints nothing: hints and the findings hint only`; Task 6 `lnx02 never started shows the not-started line`.

---

## File structure

| File | Responsibility after this plan |
|---|---|
| `src/engines/report/plain.ts` | Target and AD-set plain draft, entry blocks, Refresh regeneration (`sourceBlocks`), `entryIdsIn`, `gen` hashing, where an entry goes (`phaseInsertAt`), `missingEntries` |
| `src/engines/report/plainTables.ts` (new) | Report-level tables and the Metasploit line as plain blocks (moved out of `copies.ts`), `hintPara` |
| `src/engines/report/frontMatter.ts` | Plain front matter and closing drafts |
| `src/engines/report/flatten.ts` (new) | `PAGE_NODE_TYPES`, `needsFlatten`, `flattenToPlain` (the only place old node names live after Task 10) |
| `src/engines/report/checks.ts` | Checks that read the plain doc |
| `src/engines/report/headings.ts` | `sectionNumbers`, `subsectionNumbers`, new `targetNumbers` |
| `src/engines/report/guides.ts` | `GUIDES`, new `guidesOf` |
| `src/engines/report/appendix.ts` | Appendix-page letters, plain `suggestMoves` |
| `src/engines/report/findingText.ts` (renamed from `copies.ts` in Task 10) | `findingBlocks`, `labelled`, `inlineMarkdown` |
| `src/engines/report/draft.ts` | Planning only: `hostPlan`, `hostEntry`, `phaseSplit`, `stepsOf`, `machinesInOrder`, `findingPhaseMap`, `entryPhase`, `severityRank`, `byTime` |
| `src/features/report/editor/extension.ts` | The one page schema |
| `src/features/report/editor/pageActions.ts` | Insert an entry, Refresh a block, Add new evidence, image paste |
| `src/features/report/editor/BlockHandle.tsx` | Drag, Refresh from log, Delete |
| `src/features/report/GuidePanel.tsx` (new) | Guide notes beside the page |
| `src/ui/TimedNotice.tsx` | Portalled notice, clear of the sidebar |
| `src/features/report/page.css` | Block rhythm |

---

### Task 1: Plain target engine: entry blocks, Refresh sources, numbering-free headings, AD attack path

**Files:**
- Modify: `src/engines/report/plain.ts`
- Modify: `src/dev/ReportCompare.tsx` (call site only)
- Test: `src/test/reportPlain.test.ts`

**Interfaces:**
- Produces (all exported from `plain.ts`, re-exported by `index.ts`):
  - `buildPlainTarget(data: ReportData, target: ReportTarget, meta: ReportMeta): ReportNode`. The `ordinal` parameter goes. A machine heading is level 1, text `"<name> (<ip>)"` (`"<name>"` with no IP), source `facts:<hostId>`. Its number comes from `targetNumbers` (Task 4). An AD set's doc opens with the attack-path blocks when `attackPathRows` has rows: a paragraph **Attack path** and a table (Step, From, Technique, To, Access gained), both with source `attack-path`.
  - `entryBlocks(data: ReportData, entry: LogEntry): ReportNode[]`. One entry's blocks exactly as a draft step holds them: its sentence (`sentenceOf`) then `evidence(...)`. A flag gets the "Read local.txt:" sentence and `flagEvidence`. Blocks are stamped (below).
  - `sourceBlocks(source: string, data: ReportData, target: ReportTarget | null, meta: ReportMeta): ReportNode[] | null`. Regenerates the blocks a source produces, stamped. It handles: `entry:<id>:title`, `entry:<id>:observations`, `entry:<id>:<i>:command`, `entry:<id>:<i>:output`, `entry:<id>:request|response|note|proof|value`, `entry:<id>` (figure, log caption), `finding:<id>:explanation|fix|severity|affected|exploit`, `finding:<id>` (Additional findings bullet), `file:<id>`, `result:<hostId>`, `ports:<hostId>`, `tested:<hostId>` (the whole bullet run), `attack-path`, `facts:<hostId>`. It returns null for `phase:*`, `phase-steps:*`, unknown prefixes, and a private or deleted entry, finding, file or host.
  - `entryIdsIn(doc: ReportNode): Set<string>`. The ids in `entry:<id>…` sources at any depth, plus every figure's `entryId`.
  - `blockHash(node: ReportNode): string`. FNV-1a 32-bit, as 8 hex digits, over a canonical form: node type, text, sorted mark type names, and children in order. **All attrs are ignored**, so a node read back from the editor (ProseMirror adds default attrs) hashes the same as the engine's.
  - `stamp(blocks: ReportNode[]): ReportNode[]`. Sets `attrs.gen = blockHash(block)` on every top-level block that has a `source`. `buildPlainTarget` output is stamped.
  - `sourceOf(node: ReportNode): string | null`
- Consumes: the existing `findingBlocks`, `labelled` and `inlineMarkdown` (`copies.ts`), `attackPathRows` (`tables.ts`), and `hostPlan` and friends (`draft.ts`).

- [ ] **Step 1: Update existing tests and write the failing tests**

In `src/test/reportPlain.test.ts`, change `buildPlainTarget(data, target, {}, "4.1")` to `buildPlainTarget(data, target, {})` and the heading expectation `"4.1 garnet (10.10.30.31)"` to `"garnet (10.10.30.31)"`. Then add:

```ts
it("a git diff pasted into a remediation is a code block, never a list or italics", () => {
  const f = { ...garnetFinding, remediation: "Remove the secret:\n\ndiff --git a/config.php b/config.php\n-$db_pass = 'Spring2024!';\n+$db_pass = getenv('DB_PASS');\n*keep* this" };
  const fix = sourceBlocks(`finding:${f.id}:fix`, { ...data, findings: [f] }, target, {})!;
  expect(fix.some((b) => b.type === "codeBlock" && b.content![0].text!.includes("-$db_pass"))).toBe(true);
  expect(JSON.stringify(fix)).not.toContain('"type":"list"');
  expect(JSON.stringify(fix)).not.toContain('"italic"');
  expect(fix.every((b) => b.attrs?.source === `finding:${f.id}:fix`)).toBe(true);
});
it("a machine with nothing logged is its heading alone", () => {
  const doc = buildPlainTarget(emptyHostData, { key: "h-empty", kind: "standalone", hostIds: ["h-empty"] }, {});
  expect(doc.content).toHaveLength(1);
  expect(doc.content![0]).toMatchObject({ type: "heading", attrs: { level: 1, source: "facts:h-empty" } });
});
it("entryBlocks gives an entry the draft's own sentence, command, trimmed output and figures", () => {
  const blocks = entryBlocks(data, logEntry("l-garnet-head"));
  expect(blocks.map((b) => [b.type, b.attrs?.source])).toEqual([
    ["paragraph", "entry:l-garnet-head:title"],
    ["codeBlock", "entry:l-garnet-head:0:command"],
    ["codeBlock", "entry:l-garnet-head:0:output"],
  ]);
});
it("sourceBlocks regenerates every block of the draft identically", () => {
  // Every top-level sourced block (and each list item's sourced children): the regenerated run equals the drafted run.
  for (const [source, run] of sourcedRuns(doc)) {
    if (source.startsWith("phase:") || source.startsWith("phase-steps:")) continue;
    expect(sourceBlocks(source, data, target, {})).toEqual(run);
  }
});
it("sourceBlocks returns null for a private or deleted source", () => {
  expect(sourceBlocks("entry:l-garnet-private:title", data, target, {})).toBeNull();
  expect(sourceBlocks("finding:nope:fix", data, target, {})).toBeNull();
  expect(sourceBlocks("phase:h-exam-garnet:foothold", data, target, {})).toBeNull();
});
it("every sourced block carries gen = blockHash, and attrs never change the hash", () => {
  for (const b of doc.content!) if (b.attrs?.source) expect(b.attrs.gen).toBe(blockHash(b));
  const p = doc.content![1];
  expect(blockHash({ ...p, attrs: { ...p.attrs, source: null, hint: null, gen: "x", level: 9 } })).toBe(blockHash(p));
});
it("entryIdsIn reads sources and figures", () => {
  expect(entryIdsIn(doc)).toEqual(new Set(expectedPlacedIds)); // the garnet draft's placed entries
});
it("an AD set opens with its attack-path table", () => {
  const ad = buildPlainTarget(examData, adTarget, {});
  expect(ad.content!.slice(0, 2).map((b) => [b.type, b.attrs?.source])).toEqual([["paragraph", "attack-path"], ["table", "attack-path"]]);
  expect(ad.content!.filter((b) => b.type === "heading" && b.attrs?.level === 1).map((b) => b.attrs!.source)).toEqual(machinesInOrder(examData, adTarget).map((id) => `facts:${id}`));
});
```

`sourcedRuns(doc)` is a test helper. It walks the doc and every list item's content and groups contiguous siblings that share a `source` into `[source, blocks]`. `emptyHostData` is the garnet data plus one host `h-empty` with no log. `examData` is `examFixtures`' ReportData; build it as `reportCapturedHost.test.ts` does.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/test/reportPlain.test.ts`
Expected: FAIL (`sourceBlocks`, `entryBlocks`, `blockHash`, `entryIdsIn` not exported; heading text mismatch)

- [ ] **Step 3: Implement in `src/engines/report/plain.ts`**

Refactor `machineBlock` so that each source is produced by one function, and `sourceBlocks` dispatches to those same functions. This guarantees the "regenerates identically" test. `tested:<hostId>` returns the whole bullet run. `facts:<hostId>` returns the heading. Apply `stamp` once at the end of `buildPlainTarget` and on every `entryBlocks`/`sourceBlocks` result. A list item (`list`) that holds a step gets no source of its own (unchanged). In `src/dev/ReportCompare.tsx`, drop the ordinal argument.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/test/reportPlain.test.ts && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engines/report/plain.ts src/dev/ReportCompare.tsx src/test/reportPlain.test.ts
git commit -m "feat(reports): plain entry blocks, Refresh sources and gen stamps; AD set opens with its attack path"
```

---

### Task 2: Plain front matter and closing pages

**Files:**
- Create: `src/engines/report/plainTables.ts`
- Modify: `src/engines/report/frontMatter.ts`, `src/engines/report/index.ts`, `src/engines/report/plain.ts` (`sourceBlocks` gains `table:*` and `msf`)
- Test: `src/test/reportFrontMatter.test.ts`

**Interfaces:**
- Produces:
  - `type PlainTableKind = "findings" | "scope-table" | "tested" | "cleanup" | "references"`
  - `plainTable(kind: PlainTableKind, data: ReportData, meta: ReportMeta): ReportNode[]`. This is the body of `copies.ts`' `tableContent` for these kinds, moved here. Every top-level block gets source `table:<kind>` and is stamped. **When there are no rows**, it returns `[hintPara(<the old "none" text without its full stop>, "table:<kind>")]`, so nothing prints and Refresh fills it later.
  - `msfLine(data: ReportData): ReportNode`. A paragraph "Metasploit was used on <host (ip)>: <modules>." or "Metasploit was not used." (GeneratedView's wording), source `msf`, stamped.
  - `hintPara(hint: string, source?: string): ReportNode`, which is `{ type: "paragraph", attrs: { hint, ...(source ? { source } : {}) } }`.
  - `buildSectionDraft(kind, data, settings, meta)` keeps its signature. Every `slot(hint)` becomes `hintPara(hint)`. `copy(k)` becomes `...plainTable(k, data, meta)`. `generated("msf")` becomes `msfLine(data)`.
- Consumes: `stamp` (Task 1).

- [ ] **Step 1: Rewrite the failing tests**

In `src/test/reportFrontMatter.test.ts`, replace the `table-block`/`slot` expectations in `describe("buildSectionDraft")` with:

```ts
const PLAIN = new Set([...PLAIN_NODE_TYPES]);
const types = (n: ReportNode): string[] => [n.type, ...(n.content ?? []).flatMap(types)];
it.each(["introduction", "summary", "considerations", "methodology", "engagement-tested", "further", "references"] as const)(
  "%s is made of plain nodes only", (kind) => {
    expect(types(buildSectionDraft(kind, data, settings, {})).every((t) => PLAIN.has(t))).toBe(true);
  });
it("an unwritten summary prints nothing: hints and the findings hint only", () => {
  const doc = buildSectionDraft("summary", { ...data, findings: [] }, settings, {});
  expect(doc.content!.filter((n) => n.type === "paragraph").every((p) => !p.content && typeof p.attrs?.hint === "string")).toBe(true);
  expect(doc.content!.find((n) => n.attrs?.source === "table:findings")).toMatchObject({ type: "paragraph", attrs: { hint: "No findings recorded yet" } });
});
it("the summary's findings table is an ordinary table with its source", () => {
  const t = buildSectionDraft("summary", data, settings, {}).content!.find((n) => n.type === "table")!;
  expect(t.attrs).toMatchObject({ source: "table:findings", gen: expect.any(String) });
  expect(t.content![0].content!.map(cellText)).toEqual(["#", "Host", "Finding", "Severity", "Result"]);
});
it("Methodologies' Penetration carries the Metasploit line as plain text", () => {
  const doc = buildSectionDraft("methodology", data, settings, {});
  expect(doc.content!.find((n) => n.attrs?.source === "msf")).toMatchObject({ type: "paragraph", content: [{ type: "text", text: expect.stringMatching(/^Metasploit was (used on|not used)/) }] });
});
it("sourceBlocks refreshes a front-matter table", () => {
  expect(sourceBlocks("table:scope-table", data, null, {})).toEqual(plainTable("scope-table", data, {}));
});
```

Keep the `introductionParts`, `sectionNumbers` and `subsectionNumbers` tests unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/test/reportFrontMatter.test.ts`
Expected: FAIL (`table-block`/`slot` nodes; `plainTable` missing)

- [ ] **Step 3: Implement `plainTables.ts` and rewire `frontMatter.ts`**

`copies.ts` keeps `tableContent` for now, because Task 10 deletes it. Export `plainTables` from `index.ts`.

- [ ] **Step 4: Run the tests to verify they pass, and check the baseline**

Run: `npx vitest run src/test/reportFrontMatter.test.ts && npx vitest run && npm run typecheck && npm run lint`
Expected: front-matter tests PASS. Suite: no failures outside the 32-test baseline in `reportSection.test.tsx`, and the count is at most 32.

- [ ] **Step 5: Commit**

```bash
git add src/engines/report/plainTables.ts src/engines/report/frontMatter.ts src/engines/report/index.ts src/engines/report/plain.ts src/test/reportFrontMatter.test.ts
git commit -m "feat(reports): front matter and closing drafts as plain pages with hint paragraphs and sourced tables"
```

---

### Task 3: `flattenToPlain`: any stored page into the plain schema, owner text kept

**Files:**
- Create: `src/engines/report/flatten.ts`
- Create: `src/test/fixtures/report-layout5-web01.json`, `src/test/fixtures/report-layout4-ms01.json`, `src/test/fixtures/report-layout3-owner.json`
- Modify: `src/engines/report/index.ts`
- Test: `src/test/reportFlatten.test.ts`

**Interfaces:**
- Produces:
  - `PAGE_NODE_TYPES: readonly string[]`. This is `PLAIN_NODE_TYPES` plus `"blockquote"` and `"horizontalRule"` (the owner's own blocks).
  - `needsFlatten(doc: ReportNode): boolean`. True when any node's type is not in `PAGE_NODE_TYPES`.
  - `flattenToPlain(doc: ReportNode, data?: ReportData, target?: ReportTarget | null, meta?: ReportMeta): ReportNode`. Pure and idempotent: `flattenToPlain(plain)` deep-equals `plain`. Rules:
    - `steps` becomes one `list` (kind `ordered`) per `step`, holding the step's flattened children.
    - `step`, `finding` and any unknown container that has `content` are unwrapped to their flattened children.
    - `slot` with text becomes a `paragraph` with the same inline content. A `label` becomes a bold lead-in run plus a space (as `labelled` does). An empty slot becomes `hintPara(attrs.hint)`.
    - `phase` becomes a level-2 heading with `PHASE_TITLES` wording ("<title> – <finding title>" when `findingId` resolves in `data`), source `phase:<hostId>:<phase>[:<findingId>]`.
    - `evidence` with `copy`: the command becomes a codeBlock and the output a codeBlock, with `keep` ranges applied via `applyKeep`; omitted runs are written as `[… N lines omitted …]`. A flag copy becomes its value or proof codeBlock. Sources are `entry:<entryId>:<block ?? 0>:command|output`.
    - `evidence` without `copy`: when `data` holds the entry, it becomes `entryBlocks(data, entry)` minus the sentence. Otherwise it is dropped.
    - A screenshot `evidence` becomes a `figure` with `attachmentId` from the log entry, the caption from `attrs.caption ?? entry caption`, and source `entry:<id>`. If the entry is not found, the figure is dropped.
    - `table-block` becomes its children (table and paragraphs), each with source `table:<kind>` or `ports:<hostId>`/`result:<hostId>` for those kinds.
    - `generated` with `data` becomes `plainTable`/`msfLine`/`sourceBlocks` for its kind. `facts` becomes the machine heading. Without `data` it is dropped.
    - `vuln` with `data` becomes the finding header blocks. Without `data` it is dropped.
    - `exploit` with `copy` becomes a codeBlock (source `file:<fileId>`). Without one, it uses `data` if given, else it is dropped.
    - `fromEntry` on a paragraph or codeBlock becomes `source: "entry:<id>:note"`. `fromField` is dropped.
    - Blocks produced by flatten get **no** `gen`, so Refresh treats them as edited and asks.
- Consumes: `entryBlocks`, `sourceBlocks`, `hintPara`, `plainTable`, `msfLine` (Tasks 1 and 2), `applyKeep` (`trim.ts`), `PHASE_TITLES` (`headings.ts`).

- [ ] **Step 1: Capture the fixtures while the old builders still exist**

Write a throwaway script, run with `npx vite-node` from the scratchpad and not committed, that writes:
- `report-layout5-web01.json`: `upgradeDoc(buildTargetDraft(exam, web01Target, {}), exam, web01Target, {})`. Then hand-edit the JSON so it holds owner text in four places: a step slot "I read the backup config through the LFI first.", a typed port Notes cell "Admin panel on 8080", an edited finding explanation sentence "The upload filter trusts the extension only.", and a screenshot caption "Root shell on web01".
- `report-layout4-ms01.json`: `buildTargetDraft(exam, ms01Target, {})` as stored at layout 4 (evidence without `copy`).
- `report-layout3-owner.json`: an owner page with a paragraph, an `evidence` node and a `slot` with text.

Commit the three JSON files with this task.

- [ ] **Step 2: Write the failing tests**

```ts
const strings = (n: ReportNode): string[] => [...(n.text ? [n.text] : []), ...(n.content ?? []).flatMap(strings)];
const types = (n: ReportNode): string[] => [n.type, ...(n.content ?? []).flatMap(types)];
it("flattenToPlain keeps every string of a layout-5 page", () => {
  const flat = flattenToPlain(layout5, exam, web01Target, {});
  const text = strings(flat).join("\n");
  for (const s of ["I read the backup config through the LFI first.", "Admin panel on 8080", "The upload filter trusts the extension only.", "Root shell on web01"]) expect(text).toContain(s);
  for (const s of strings(layout5)) expect(text).toContain(s.trim().split("\n")[0]); // every original string's first line survives
  expect(types(flat).every((t) => PAGE_NODE_TYPES.includes(t))).toBe(true);
});
it("a layout-4 page's copy-less evidence is rendered from the log when data is given, dropped without it", () => {
  expect(types(flattenToPlain(layout4, exam, ms01Target, {}))).toContain("codeBlock");
  expect(types(flattenToPlain(layout4)).every((t) => PAGE_NODE_TYPES.includes(t))).toBe(true);
});
it("an owner page's slot text becomes a paragraph and its evidence a code block or figure", () => { /* layout3-owner: paragraph text kept, slot text kept as paragraph */ });
it("an empty slot becomes a hint paragraph", () => {
  expect(flattenToPlain({ type: "doc", content: [{ type: "slot", attrs: { hint: "Wrap-up" } }] }).content).toEqual([{ type: "paragraph", attrs: { hint: "Wrap-up" } }]);
});
it("a steps list becomes one numbered item per step", () => { /* steps(step×2) → [list ordered, list ordered] */ });
it("is idempotent on plain pages", () => {
  const plain = buildPlainTarget(garnet, garnetTarget, {});
  expect(flattenToPlain(plain, garnet, garnetTarget, {})).toEqual(plain);
  expect(needsFlatten(plain)).toBe(false);
  expect(needsFlatten(layout5)).toBe(true);
});
it("flattened blocks carry no gen, so Refresh treats them as edited", () => {
  const walk = (n: ReportNode): boolean => n.attrs?.gen === undefined && (n.content ?? []).every(walk);
  expect(walk(flattenToPlain(layout5, exam, web01Target, {}))).toBe(true);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/test/reportFlatten.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 4: Implement `flatten.ts`**

Write a recursive walk with a `switch` on the node type, using the rules above. Text nodes and marks pass through unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/test/reportFlatten.test.ts && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/engines/report/flatten.ts src/engines/report/index.ts src/test/reportFlatten.test.ts src/test/fixtures/report-layout*.json
git commit -m "feat(reports): flattenToPlain converts any stored page to the plain schema, keeping owner text"
```

---

### Task 4: Engine readers over the plain doc: checks, target numbers, guides, appendix suggestions

**Files:**
- Modify: `src/engines/report/checks.ts`, `src/engines/report/headings.ts`, `src/engines/report/guides.ts`, `src/engines/report/appendix.ts`, `src/dev/ReportCompare.tsx`
- Test: `src/test/reportChecks.test.ts`, `src/test/reportHeadings.test.ts`, `src/test/reportGuides.test.tsx` (catalog part), `src/test/reportAppendix.test.ts`

**Interfaces:**
- Produces:
  - `targetChecks(input: TargetChecksInput): Check[]`. Same signature. `appendixRefs` becomes optional and is ignored; Task 10 removes it. It reads the plain doc per the table below.
  - `legibilityChecks(doc, data, widths)`. Reads `figure` nodes (`attrs.entryId`).
  - `targetNumbers(doc: ReportNode, target: ReportTarget, base: string): Map<number, string>`. Maps top-level index to number for headings with source `facts:<hostId>`: standalone gives `base` ("4.1"), and in the AD set the n-th machine heading gives `${base}.${n}`. Other headings get no number, as in the approved proof.
  - `guidesOf(doc: ReportNode, kind: SectionKind, placement?: PageMeta["placement"]): GuideId[]`. In page order, without duplicates: `sectionGuide(kind, placement)` first, then per block: `ports:` gives `ports`; `result:` gives `result`; `phase-steps:` gives `steps`; `finding:<id>:explanation` gives `vuln`; `file:` gives `exploit`; a heading `phase:<h>:post|additional|tested` gives `post`/`additional`/`tested`; `attack-path` gives `attack-path`; `table:findings` gives `findings-table`; `table:scope-table` gives `scope`; `table:tested` on an `engagement-tested` page gives `tested`; `table:cleanup` gives `house-cleaning`; a heading matching `HEADING_GUIDES[kind]` gives what it maps to today.
  - `numberAppendices(sections, titleOf)`. Keeps its signature. A target never yields entries any more, so the result is only `pages`, lettered from A.
  - `suggestMoves(doc: ReportNode): { key: string; reason: string }[]`. The `data` parameter goes. For every codeBlock at any depth with more than `MAX_INLINE_LINES` (60) lines, `key` is its index path and `reason` is `"<n> lines"`.
- Keep `targetHeadings` and `guideFor` exported but unused until Task 10 deletes them.

**Check reading rules (plain doc).** A *step* is an ordered `list` item. Its *lead* is its first sourced descendant. *Heading* means the nearest preceding level-2 heading's text, else level 1, else "this page". Anchors stay `{ entryId?, nodeIndex }` with the same pre-order `visit` count.

| Check id | Level | Reads |
|---|---|---|
| `proof-missing`, `proof-ip`, `proof-screenshot`, `proof-web`, `proof-identity`, `proof-hostname`, `proof-path`, `proof-shot` | as now | `onPage = entryIdsIn(doc)`; logic unchanged |
| `copied-private:<id>` / `copied-deleted:<id>` | fail | any block whose source is `entry:<id>…`, or a figure whose `entryId`, names a private or deleted entry; one per entry, at its first block |
| `gone:<id>` | fail | a block sourced `finding:<id>…` or `file:<id>` whose finding or file no longer exists; one per id |
| `output:<id>` | soft | the page has an `entry:<id>:<i>:command` block, no `entry:<id>:<j>:output` block, and the entry is a command with `!returnedNothing` |
| `explain:<entryId or node-N>` | soft | a step whose first child is not a paragraph with text; steps whose first sourced child is a figure sort first |
| `step-replay:<sectionId>:<path>` | soft | a step whose first paragraph has text and that holds no codeBlock or figure at any depth, and whose lead source does not end `:note`. Text: "Step N of <heading> has no command or output under it, so a reader can't replay it. Add it from the log column". N counts steps since the last level-1 or level-2 heading |
| `cred-finding` | soft | unchanged (data only) |
| `caption-weak:<entryId>` | soft | a figure whose caption `isWeakCaption` |
| `caption:<entryId>` | soft | a figure caption over 10 words |
| `legible:<entryId>` | soft | `legibilityChecks` on figures |
| `access-shot` | soft | shots on page = figures' entries (plus flag entries with an attachment that are on the page); logic unchanged |
| `finding:<id>:severity, title, affected, description, remediation` | soft | findings named by any `finding:<id>…` source; anchored at the first such block |
| `wording:<n>` | soft | every paragraph at any depth (table cells included) |
| `exploit:<fileId>:url` | fail | a `file:<id>` block whose file is modified with no `originalUrl` |
| `exploit:<fileId>:explain` | soft | a modified file whose run of `file:<id>` blocks is not followed by a sibling paragraph with text |
| `exploit:<fileId>:original` | fail | a modified file with no `originalContent` (the marked-lines escape is gone) |
| `coverage:<serviceId>` | soft | unchanged |
| `move:<path>` | soft | `suggestMoves(doc)`. Text: "This block is long (N lines). Consider moving it to an appendix page." |
| ~~`caption-step`~~, ~~`appendix-ref`~~ | removed | a figure prints only its own caption; there are no moved blocks |

Update `PLURAL`/`SHORT`: drop `caption-step` and `appendix-ref`. `gone` reads "Deleted finding or file on the page" (single) and "N blocks on the page come from a deleted finding or file" (plural). `move` reads "Long block (N lines)". Report-level checks do not change.

- [ ] **Step 1: Rewrite the failing tests**

In `reportChecks.test.ts`, rebuild every `targetChecks` fixture doc as a plain doc. Use `buildPlainTarget` on the existing check fixtures, then edit the doc to trigger each check. Write one test per row of the table, named after the check id, e.g.:

```ts
it("step-replay: a step with words and no code or figure", () => {
  const doc = plainDoc([h2("Initial access", "phase:h1:foothold"), stepsPara("h1"), step([para("I logged in over SSH as ronan.")])]);
  expect(ids(targetChecks(input(doc)))).toContain("step-replay:sec-1:2");
  expect(textOf(targetChecks(input(doc)), "step-replay")).toBe("Step 1 of Initial access has no command or output under it, so a reader can't replay it. Add it from the log column");
});
it("copied-deleted: a block from a deleted entry is a fail at that block", () => { /* source entry:gone:0:output → { id: "copied-deleted:gone", level: "fail", anchor: { nodeIndex } } */ });
it("no check reads caption-step or appendix-ref any more", () => { /* full garnet draft → no id starts with either */ });
it("the garnet draft as drafted has no fail", () => { expect(targetChecks(input(buildPlainTarget(garnet, t, {}))).filter((c) => c.level === "fail")).toEqual([]); });
```

`reportHeadings.test.ts`: `targetNumbers` gives `{0: "4.2"}` for a standalone page with base "4.2", and `{2: "5.1", 30: "5.2"}`-style numbers for the AD set (assert against the real indices of the `facts:` headings).
`reportGuides.test.tsx` (catalog): `guidesOf(garnetDraft, "target")` starts `["result", "ports", "vuln", "steps"]`. `guidesOf(summaryDraft, "summary")` equals `["summary", "findings-table", "recommendations"]`.
`reportAppendix.test.ts`: delete the moved-node tests. Keep the pages tests. Add `suggestMoves` on a 61-line codeBlock (→ one entry, `reason: "61 lines"`) and on a 60-line one (→ none).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/test/reportChecks.test.ts src/test/reportHeadings.test.ts src/test/reportGuides.test.tsx src/test/reportAppendix.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the readers**

In `ReportCompare.tsx`, pass `subNumbers={(d) => targetNumbers(d, TARGET, "4.1")}` so the compare page still prints "4.1".

- [ ] **Step 4: Run the tests to verify they pass, and check the baseline**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: the four files PASS. No failures outside the 32-test baseline.

- [ ] **Step 5: Commit**

```bash
git add src/engines/report/{checks,headings,guides,appendix}.ts src/dev/ReportCompare.tsx src/test/report{Checks,Headings,Appendix}.test.ts src/test/reportGuides.test.tsx
git commit -m "feat(reports): checks, numbering, guides and appendix suggestions read the plain page"
```

---

### Task 5: One plain schema for every page

**Files:**
- Modify: `src/features/report/editor/extension.ts`, `src/features/report/editor/ReportEditor.tsx`, `src/features/report/editor/nodes/FigureView.tsx`, `src/features/log/AttachmentImage.tsx`, `src/features/report/page.css`, `src/dev/ReportCompare.tsx`
- Test: `src/test/reportPlainEditor.test.tsx` (new)

**Interfaces:**
- Produces:
  - `defineReportExtension(numbers?: SubNumbers, held?: HeldPositions, gone?: SourceGone, guides?: GuideSlots): Extension`. The `plain` parameter goes. The figure node, the `source` and `gen` attrs (on heading, paragraph, list, codeBlock, table, figure; DOM `data-source`/`data-gen`) and the `hint` attr (paragraph; DOM `data-hint`) are always in the schema. The old atoms stay registered **until Task 10**, so stored pages still open in between.
  - Figure `toDOM`: `["figure", { "data-report": "figure", "data-attachment", "data-entry"? }, ["img", { "data-attachment": id, alt: "" }], ["figcaption", 0]]`. `parseDOM` is unchanged (`contentElement: "figcaption"`). **This is the export contract:** Export does not exist yet (`ReportStrip` says "Export arrives with the PDF round"), and the PDF round prints this HTML, filling `img[data-attachment]`.
  - A `hintPlaceholders` plugin: a node decoration `{ class: "report-hint", "data-hint": hint }` on every **empty** paragraph with a non-empty `hint`. `placeholderFor` returns `""` inside such a paragraph.
  - `sourceGoneMarks` reads `source` (`entry:<id>…`) and figure `entryId` in place of `fromEntry`.
  - `ReportEditor` loses its `plain` prop.
  - `AttachmentImage` gets `onMissing?(): void`, called when the query errors.
  - `FigureView`: on a missing file it shows `<p className="m-0 text-meta text-warn" contentEditable={false}>This screenshot's file is missing. Delete the figure, or add the screenshot again from the log.</p>` in place of the image. The caption stays editable.
  - `page.css`: `.report-page p.report-hint::before { content: attr(data-hint); color: var(--page-muted); pointer-events: none; }`, at the page's 14px.
- Consumes: `buildPlainTarget`, `buildSectionDraft`, `blockHash` (Tasks 1 and 2).

- [ ] **Step 1: Write the failing tests** (`src/test/reportPlainEditor.test.tsx`, real editor through `ReportEditor` in the same harness as `reportEditing.test.tsx`)

```ts
it("a plain target, a plain summary and an owner page all load in the one schema", () => {
  for (const doc of [garnetDraft, summaryDraft, ownerPage]) {
    const e = createEditor({ extension: defineReportExtension(), defaultContent: doc as NodeJSON });
    expect(() => e.state.doc.check()).not.toThrow();
    expect(sources(e.getDocJSON())).toEqual(sources(doc)); // every source attr survives
  }
});
it("blockHash matches after a schema round trip", () => {
  const e = createEditor({ extension: defineReportExtension(), defaultContent: garnetDraft as NodeJSON });
  e.state.doc.forEach((n, _o, i) => expect(blockHash(n.toJSON() as ReportNode)).toBe(blockHash(garnetDraft.content![i])));
});
it("editing every block type changes only the page: the log, findings and files are untouched", async () => {
  const before = JSON.stringify([await api.logList(E), await api.findingsList(E), await api.findingFilesList(E)]);
  // type "X" into: a paragraph, an ordered list item's sentence, a code block, a table cell (ports Notes), a figure caption, a hint paragraph
  for (const pos of [paraPos, listPos, codePos, cellPos, captionPos, hintPos]) typeAt(editor, pos, "X");
  expect(changedBlocks(before_doc, editor.getDocJSON())).toHaveLength(6);
  expect(JSON.stringify([await api.logList(E), await api.findingsList(E), await api.findingFilesList(E)])).toBe(before);
});
it("a hint paragraph shows its hint until typed in", async () => {
  render(page(doc([{ type: "paragraph", attrs: { hint: "What the engagement was" } }])));
  expect(document.querySelector('.report-page p.report-hint[data-hint="What the engagement was"]')).not.toBeNull();
  typeAt(editor, 1, "We tested");
  expect(document.querySelector(".report-page p.report-hint")).toBeNull();
});
it("serialises a figure with its image and caption for the PDF; source, gen and hint print no text", () => {
  const html = createEditor({ extension: defineReportExtension(), defaultContent: doc([figure("a-1", "Root shell", "l-1"), { type: "paragraph", attrs: { hint: "Wrap-up" } }]) }).getDocHTML();
  expect(html).toMatch(/<figure data-report="figure" data-attachment="a-1"[^>]*><img data-attachment="a-1" alt=""><figcaption>Root shell<\/figcaption><\/figure>/);
  expect(html).not.toContain(">Wrap-up<");
});
it("a figure whose screenshot file is missing says so and stays editable", async () => {
  vi.spyOn(api, "attachmentGet").mockRejectedValue(new RavenError("not_found", "gone"));
  render(page(doc([figure("a-missing", "Root shell", "l-1")])));
  const line = await screen.findByText("This screenshot's file is missing. Delete the figure, or add the screenshot again from the log.");
  expect(line).toHaveClass("text-warn");
  typeAt(editor, captionEnd, " on web01");
  expect(editor.getDocJSON().content[0].content[0].text).toBe("Root shell on web01");
  deleteBlockAt(editor, { node: editor.state.doc.child(0), pos: 0 });
  expect(editor.state.doc.childCount).toBe(1); // an empty paragraph remains
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/test/reportPlainEditor.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

Delete `definePlainPage` and the `plainPage` state. Move the `.list-content` rule out of `reportCompare.css` and into `page.css` (Task 9 pins it). `ReportCompare` drops `plain`.

- [ ] **Step 4: Run the tests to verify they pass, and check the baseline**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: the new file PASSES. No failures outside the 32-test baseline.

- [ ] **Step 5: Commit**

```bash
git add src/features/report/editor/{extension.ts,ReportEditor.tsx,nodes/FigureView.tsx} src/features/log/AttachmentImage.tsx src/features/report/page.css src/dev/ReportCompare.tsx src/dev/reportCompare.css src/test/reportPlainEditor.test.tsx
git commit -m "feat(reports): one plain schema for every page: figure, source, gen and hint attrs, missing-file figures"
```

---

### Task 6: The Report section runs on plain pages at layout 6

**Files:**
- Modify: `src/engines/report/types.ts` (`DRAFT_LAYOUT = 6`, rewrite the GUARD comment, delete `UPGRADABLE_FROM`), `src/features/report/ReportSection.tsx`, `src/features/report/queries.ts` (`hasCurrentPage` unchanged in logic, doc comment updated)
- Test: `src/test/reportSection.test.tsx` (rewrite to green)

**Interfaces:**
- Consumes: `buildPlainTarget(data, target, meta)`, `buildSectionDraft`, `flattenToPlain`, `needsFlatten`, `targetNumbers`, `flushReports` (`saveQueue.ts`).
- Produces (inside `ReportSection.tsx`):
  - `drafts` memo: `e.target ? buildPlainTarget(data, e.target, reportMeta) : buildSectionDraft(...)`.
  - Build effect: `await flushReports()` **before** the upsert. Then it re-reads the section from the sections cache, and `previousDoc`/`previousLayout` come from that post-flush cached section. The `building` guard is unchanged.
  - `openDoc(s: ReportSection): ReportNode` replaces `mountDoc`. It reads the cached doc. If `needsFlatten(doc)` (an owner page or a layout-6 page holding old nodes), it returns `flattenToPlain(doc, data, target, reportMeta)` and queues one save with meta `{ ...meta, previousDoc: <the original>, previousLayout: meta.layout ?? null, previousAt: Date.now() }`. This happens once per section per mount (a ref set).
  - `swapPage`: the page swapped in is `flattenToPlain(prev, data, target, reportMeta)`. The `nodeFromJSON(...).check()` guard stays as a last resort (its error line is unchanged).
  - Target pages: `subNumbers = (doc) => targetNumbers(doc, target, number)`. `headingsOf` is no longer passed (Task 10 deletes it).
  - Figure numbering (`countFigures`, `figureOffset`) is no longer computed. The page prints no figure numbers, as in the approved proof.

- [ ] **Step 1: Rewrite `src/test/reportSection.test.tsx`**

Keep every test about tabs, keys, saves, reorder, pages and To do. Retarget its page fixtures to plain docs, using the existing helpers rewritten as `plainPage(...)`, and its assertions to plain markup. The `lnxPage` helper (L616) becomes a plain doc: an `h2` with source `phase:<LNX>:foothold`, a hint paragraph, a command and output codeBlock with `entry:` sources, and an `h2` post heading. Delete "offers no Move to appendix on a report-level page" (Task 7 covers the block menu). Rewrite or add:

```ts
it("builds a target's plain draft once, on its first open", async () => {
  // upsert called once; input.meta toEqual { layout: 6 }; every node type of input.doc in PAGE_NODE_TYPES
});
it("a layout-5 page rebuilds as the plain draft and keeps the old page byte for byte", async () => {
  // store fixtures/report-layout5-web01.json at { layout: 5 } → open web01 → upsert.meta.previousDoc toEqual the fixture exactly; previousLayout 5; doc is plain
});
it("Restore shows every owner sentence of a layout-5 page, as plain blocks", async () => {
  // click "Restore your previous page" → paper text contains the four owner strings of the fixture; the saved doc has needsFlatten(doc) === false
  // click "Use the rebuilt page" → back to the plain draft
});
it("a queued write of the old page lands before the rebuild, never after it", async () => {
  // store a layout-5 page; reportSectionSave rejects once (pending write of an edited old page with meta { layout: 5 });
  // open the section: the save lands first, then the upsert; final stored doc is plain at layout 6, previousDoc holds the edited old page
  // assert the call order: [save(old), upsert(plain)], and no save of an old-layout doc after the upsert
});
it("a page already at layout 6 is never rebuilt", async () => { /* upsert not called; paper shows the stored text */ });
it("an owner page holding old evidence nodes opens flattened, its text kept and the original in previousDoc", async () => {
  // kind "page" with fixtures/report-layout3-owner.json → paper shows its text; a save carries previousDoc === original
});
it("numbers a target's machine heading from the section order and renumbers after ⌥→", async () => {
  // h1[data-number] "4.1" on the first target → ⌥→ → the same page shows "4.2"
});
it("lnx02 never started shows the not-started line and only its heading", async () => {
  // "Nothing logged on lnx02 yet. The page fills in as you work." and paper has exactly one h1
});
it("guards DRAFT_LAYOUT: it is 6, and a bump keeps every stored page in previousDoc", () => { expect(DRAFT_LAYOUT).toBe(6); /* plus the existing rebuild-keeps-previousDoc assertion */ });
it("prints a flag as the last step of its phase: Read local.txt: then its proof", async () => { /* plain markup */ });
it("prints the port table at the top of Service enumeration; typing in a Notes cell saves the page and not the services", async () => {});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/test/reportSection.test.tsx`
Expected: FAIL (old drafts and layout 5)

- [ ] **Step 3: Implement in `ReportSection.tsx` and `types.ts`**

Remove the `appendixView` path for target appendices: with plain pages, `numberAppendices` yields no target entries, so only appendix pages remain as appendix tabs. Delete the `AppendixPage` and `appendixPagesOf` code. Task 10 deletes `AppendixSection.tsx`.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS, **0 failures** (the baseline is gone from here on)

- [ ] **Step 5: Commit**

```bash
git add src/engines/report/types.ts src/features/report/{ReportSection.tsx,queries.ts} src/test/reportSection.test.tsx
git commit -m "feat(reports): every report page is a plain document at layout 6; old pages kept and restorable"
```

---

### Task 7: Page actions on plain pages: Refresh from log, the rail's + add, Add new evidence, removal tracking

**Files:**
- Modify: `src/engines/report/plain.ts`, `src/features/report/editor/pageActions.ts`, `src/features/report/editor/BlockHandle.tsx`, `src/features/report/editor/ReportEditor.tsx` (removal plugin), `src/features/report/editor/SlashMenu.tsx`, `src/features/report/EvidenceRail.tsx`, `src/features/report/AddEvidenceButton.tsx`, `src/features/report/saveQueue.ts`
- Test: `src/test/reportPageActions.test.tsx` (new), `src/test/reportRail.test.tsx`, `src/test/reportEditorTools.test.tsx` (Block handle part)

**Interfaces:**
- Produces (engine, `plain.ts`):
  - `phaseInsertAt(doc: ReportNode, data: ReportData, target: ReportTarget, entry: LogEntry): { index: number; before: ReportNode[] }`. `index` is the top-level index where a new step goes: the end of the region of the **last** heading whose source starts `phase:<hostId>:<phase>` (the region runs up to the next heading of level 1 or 2, or the end). `before` lists blocks to insert first:
    - `para([bold("Steps to reproduce:")], "phase-steps:<hostId>")` when the region has no step yet.
    - Also the phase heading itself, level 2 in `PHASE_TITLE` wording, source `phase:<hostId>:<phase>`, when the phase has no heading. It goes before the host's first later-phase heading, else before its `additional`/`tested` heading, else before the next `facts:` heading, else at the end.
    - `(hostId, phase)` comes from `entryPhase`. `enum` maps to the `ENUM_HEADING` region.
  - `missingEntries(doc: ReportNode, data: ReportData, target: ReportTarget, meta: ReportMeta, removed: readonly string[]): LogEntry[]`. Entries in `entryIdsIn(buildPlainTarget(...))` and not in `entryIdsIn(doc)` and not in `removed`, in time order.
- Produces (editor, `pageActions.ts`):
  - `insertEntry(editor: Editor, data: ReportData, target: ReportTarget, entry: LogEntry, atCursor: boolean): PMNode[]`. It returns the inserted top-level nodes. With `atCursor` (`hasPageCursor`), `entryBlocks(data, entry)` go right after the cursor's textblock, in its parent: an empty paragraph without a hint is replaced, a hint paragraph never is. Without the cursor, `before` plus one `{ type: "list", attrs: { kind: "ordered" }, content: entryBlocks }` go at `phaseInsertAt`. Each insert is one undoable step.
  - `sourceRun(doc: PMNode, pos: number): { from: number; to: number; nodes: PMNode[]; source: string } | null`. This is the contiguous siblings around `pos` that share its block's `source`.
  - `isEdited(nodes: PMNode[]): boolean`. True when any node's `blockHash(node.toJSON())` differs from its `attrs.gen`, or it has no `gen`.
  - `refreshRun(editor: Editor, run: NonNullable<ReturnType<typeof sourceRun>>, data, target: ReportTarget | null, meta): boolean`. It replaces exactly `[from, to)` with `sourceBlocks(...)` in one undoable transaction and returns false when `sourceBlocks` returns null.
  - `refreshLabel(source: string): "Refresh from log" | "Refresh from finding" | "Refresh from Raven"`. `entry:` gives log; `finding:`/`file:` give finding; everything else gives Raven.
- `BlockHandle`: the menu holds the refresh label item, shown only when `sourceBlocks(...)` is non-null for the hovered block's run, and Delete. "Move to appendix" goes. On an edited run it opens `Dialog` titled "Replace this block with the current version?". The description reads "Your edits to this block are replaced. ⌘Z brings them back." The buttons are "Cancel" and "Replace", and focus starts on Cancel. An unedited run is replaced without asking.
- `EvidenceRail`: `unusedEntries` uses `entryIdsIn`. The `"appendix"` action and its tooltip go; every row is `+ add`, calling `insertEntry(editor, data, target, row.entry, hasPageCursor(editor))`.
- `AddEvidenceButton`: it runs `missingEntries`, inserts each with `insertEntry(..., false)` in time order, and gathers the nodes for Undo (`removeExact`). Its copy is unchanged ("Nothing new to add", "Added N entries").
- Removal tracking: `removedByTransaction` and `pruneRemoved` compare `entryIdsIn` before and after (this replaces `evidenceIdsIn`).
- `SlashMenu`'s log search inserts with `insertEntry(..., true)`.

- [ ] **Step 1: Write the failing tests** (`src/test/reportPageActions.test.tsx`, real editor on the garnet draft; rail tests updated)

```ts
it("+ add with the cursor in a step puts the entry's blocks after the cursor's block, inside that step", () => {
  // cursor in step 2's sentence → insertEntry(..., true) → step 2's list now holds [..., para entry:X:title, codeBlock entry:X:0:command, codeBlock entry:X:0:output]
});
it("+ add with no cursor appends a numbered step at the end of its phase, before the next heading", () => {
  // privesc entry → new list kind ordered sits right before the "Additional findings" heading; its first block is the sentence
});
it("+ add for a phase with no heading yet adds the heading and Steps to reproduce first", () => {});
it("Refresh on an unedited block replaces it without asking", async () => { /* change the log output in data → menu → "Refresh from log" → no dialog; block text is the new trimmed output */ });
it("Refresh on an edited block asks; Cancel keeps it; Replace swaps only its run; undo restores", async () => {
  // type into an output codeBlock → Refresh from log → dialog "Replace this block with the current version?"
  // Cancel → doc unchanged; again → Replace → that codeBlock is the log's; its neighbours deep-equal before; ⌘Z → the typed text is back
});
it("Refresh replaces the whole run of an observations source, nothing else", () => {});
it("a block whose entry is private or deleted offers no Refresh", async () => { /* menu items: ["Delete"] */ });
it("a heading or an owner paragraph offers no Refresh", async () => {});
it("the block menu never offers Move to appendix", async () => {});
it("Add new evidence adds what the draft would place and isn't on the page or removed; Undo takes off exactly that", async () => {});
it("deleting every block of an entry records it as removed; undo un-records it", async () => {});
it("the log column lists entries with no block sourced from them, each with + add only", () => { /* no "+ to appendix" text */ });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/test/reportPageActions.test.tsx src/test/reportRail.test.tsx src/test/reportEditorTools.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engines/report/plain.ts src/features/report/editor/{pageActions.ts,BlockHandle.tsx,ReportEditor.tsx,SlashMenu.tsx} src/features/report/{EvidenceRail.tsx,AddEvidenceButton.tsx,saveQueue.ts} src/test/report{PageActions,Rail,EditorTools}.test.tsx
git commit -m "feat(reports): Refresh from log per block, + add and Add new evidence insert plain blocks"
```

---

### Task 8: Guide notes beside the page

**Files:**
- Create: `src/features/report/GuidePanel.tsx`
- Modify: `src/features/report/ReportSection.tsx` (rail aside and drawer), `src/features/report/editor/GuideNote.tsx` (drop `defineGuideNotes`, `GuideSlots`, `GuidePortals`; keep `GuideNote` and `useGuideSettings`), `src/features/report/editor/extension.ts` and `ReportEditor.tsx` (drop the guides plumbing)
- Test: `src/test/reportGuides.test.tsx` ("guide notes on the page" becomes "guide notes beside the page")

**Interfaces:**
- Produces: `GuidePanel({ kind, placement, doc }: { kind: SectionKind; placement?: PageMeta["placement"]; doc: ReportNode }): JSX.Element | null`. It renders `guidesOf(doc, kind, placement)` minus those Settings hides, as `GuideNote`s in a `grid gap-2` list with `aria-label="Guide notes"`. It returns null when none are left, or while Settings is loading (`hidden === null`). It is mounted at the top of the rail `<aside>` and inside `EvidenceDrawer`, above `EvidenceRail`, for every page that has an editor. `doc` is the live doc (`openLiveDoc ?? savedDocOf`).
- `defineReportExtension(numbers?, held?, gone?)`: the `guides` parameter goes.

- [ ] **Step 1: Write the failing tests**

```ts
it("guide notes sit beside the page, never inside the paper", async () => {
  // open garnet: within(screen.getByRole("complementary", { name: "Evidence" })).getByRole("list", { name: "Guide notes" }) exists;
  // document.querySelector(".report-page [data-guide]") is null
});
it("lists the open page's guides in page order", async () => { /* Result, Ports, Vulnerability, Steps … titles in order */ });
it("Hide this note hides it in every report", async () => { /* settingsUpdate called with reportGuidesHidden containing "ports"; other target page shows no ports note */ });
it("Hide all guide notes writes '*' and the panel goes", async () => {});
it("the Settings toggle brings them back", async () => {});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/test/reportGuides.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/report/GuidePanel.tsx src/features/report/ReportSection.tsx src/features/report/editor/{GuideNote.tsx,extension.ts,ReportEditor.tsx} src/test/reportGuides.test.tsx
git commit -m "feat(reports): guide notes move beside the page, still dismissable"
```

---

### Task 9: Notices clear of the sidebar; block rhythm pinned

**Files:**
- Modify: `src/ui/TimedNotice.tsx`, `src/features/report/page.css`
- Test: `src/test/timedNotice.test.tsx` (new), `src/test/reportRhythm.test.ts` (new)

**Interfaces:**
- Produces: `TimedNotice` with the same props. It renders through `createPortal(..., document.body)` with classes `fixed bottom-4 z-50` (`left-4` is gone). Its `style.left` is `${sidebarRight + 16}px`, where `sidebarRight` is `document.querySelector('[data-slot="sidebar-gap"]')?.getBoundingClientRect().right ?? 0`. It re-reads that value on a `ResizeObserver` of that element and on `transitionend`, so it follows expand and collapse.
- `page.css` holds the rhythm, one comment above each rule:
  - `.report-page .ProseMirror { row-gap: 12px }` (exists)
  - `.report-page .list-content { display: grid; grid-template-columns: minmax(0, 1fr); row-gap: 12px; }` (moved in Task 5; verify it is there)
  - `.report-page .ProseMirror > .prosemirror-flat-list + .prosemirror-flat-list { margin-top: 0 }` (items keep the 12px block gap; no collapse)
  - `.report-page figure + *, .report-page * + figure` need no extra rule because the grid gap applies. The test pins the gaps that exist.

- [ ] **Step 1: Write the failing tests**

```ts
// timedNotice.test.tsx
it("renders into document.body, outside the tree that opened it", () => {
  const { container } = render(<TimedNotice onClose={() => {}}>Saved</TimedNotice>);
  const status = screen.getByRole("status");
  expect(container.contains(status)).toBe(false);
  expect(status.parentElement).toBe(document.body);
  expect(status).toHaveClass("fixed", "bottom-4", "z-50");
});
it("sits 16px right of the sidebar, expanded and collapsed", () => {
  const gap = document.body.appendChild(Object.assign(document.createElement("div"), { dataset: { slot: "sidebar-gap" } }));
  gap.getBoundingClientRect = () => ({ right: 240 }) as DOMRect;
  render(<TimedNotice onClose={() => {}}>Saved</TimedNotice>);
  expect(screen.getByRole("status").style.left).toBe("256px");
  gap.getBoundingClientRect = () => ({ right: 56 }) as DOMRect;
  act(() => gap.dispatchEvent(new Event("transitionend")));
  expect(screen.getByRole("status").style.left).toBe("72px");
});
it("with no sidebar it sits 16px from the left edge", () => { /* style.left "16px" */ });
// reportRhythm.test.ts
import css from "../features/report/page.css?raw";
it("consecutive blocks on the page and inside a numbered step are 12px apart", () => {
  expect(css).toMatch(/\.report-page \.ProseMirror \{[^}]*row-gap: 12px/);
  expect(css).toMatch(/\.report-page \.list-content \{[^}]*display: grid;[^}]*row-gap: 12px/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/test/timedNotice.test.tsx src/test/reportRhythm.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS. Existing `SaveSummary`/report notice tests still find the notice through `screen` (it is in `document.body`).

- [ ] **Step 5: Commit**

```bash
git add src/ui/TimedNotice.tsx src/features/report/page.css src/test/{timedNotice.test.tsx,reportRhythm.test.ts}
git commit -m "fix(ui): notices portal above everything, clear of the sidebar; report block rhythm pinned"
```

---

### Task 10: Remove the page machinery

**Files:**
- Delete: `src/features/report/editor/nodes/{EvidenceView,ExploitView,FindingProse,GeneratedView,PhaseView,SlotView,StepsView,VulnView,parts}.tsx`, `src/features/report/editor/ChipState.tsx`, `src/features/report/editor/AppendixSection.tsx`, `src/test/reportCopies.test.ts` (the `terminalBlocks` and `findingBlocks` tests move to `src/test/reportFindingText.test.ts`), and the old-machinery describes in `src/test/reportDraft.test.ts` (`buildTargetDraft`, `addNewEvidence`, "AD set draft", "a screenshot that came along…"; keep `provingEntries`, `isDeadEnd`, `findingPhaseMap` and the planning tests) and `src/test/reportEditor.test.tsx` (evidence, slots, removing evidence, vulnerabilities and exploits, generated blocks, steps, nested insertion, chips; keep "moving blocks and helpers" and "block tools" rewritten on plain docs). In `reportEditing.test.tsx`, delete "Notes are the owner's text", "Screenshot captions" (evidence) and "Edit on page", and rewrite "Find in log blocks" on plain code blocks.
- Rename: `src/engines/report/copies.ts` becomes `src/engines/report/findingText.ts`, keeping only `findingBlocks`, `labelled` and `inlineMarkdown` and their helpers.
- Modify: `extension.ts` (drop `ATOMS`, `atomSpec`, `slotSpec`, `stepsSpec`, `stepSpec`, `stepNumbers`, `stepHints`, `stepsKeymap`, `fromEntryAttr`, `fromField`), `ReportEditor.tsx` (drop `ChipStateProvider`, chip keys, `insertEvidenceAtCursor`, `keepCopiedText`, `convertNoteBlocks`, `layoutOf`'s figure/step/heading parts), `ReportDataContext.tsx` (drop `useAppendixRef`, `canMove`, `headingsOf`, `figureOffset`, and the `PageLayout` fields only views used), `commands.ts` (drop `addStep`, `insertIntoCurrentStep`, `stepAt`, `nearestSteps`), `draft.ts` (drop `STEP_HINT`, `FLAG_STEP_HINT`, `REPRODUCE_LABEL`, `node`, `slot`, `generated`, `ownerParagraphs`, `evidenceBlocks`, `evidenceNodes`, `stepNode`, `stepsNode`, `buildTargetDraft`, `evidenceIdsIn`, `addNewEvidence`, `endOfPhase`, `DocPath` and placement helpers), `types.ts` (drop `UPGRADABLE_FROM` if still there, `SlotAttrs`, `PhaseAttrs`, `EvidenceAttrs`, `CommandCopy`, `FlagCopy`, `EvidenceCopy`, `GeneratedAttrs`, `GeneratedKind`, `StepAttrs`, `PortsAttrs`, `VulnAttrs`, `ExploitAttrs`, `FindingCopyAttrs`, `CopiedKind`, `COPIED_KINDS`, `TableBlockAttrs`, `AppendixPlacement`), `headings.ts` (drop `targetHeadings`, `PageHeadings`, `phaseKey`, `machineKey`, `CHAIN_KEY`), `guides.ts` (drop `guideFor`), `checks.ts` (drop `appendixRefs` from `TargetChecksInput`), `appendix.ts` (drop `movedNodes`, `keptLines`, `generatedRows`, `MOVABLE`, `AppendixEntry`, `refFor`), `figures.ts`/`trim.ts`/`diff.ts` (delete each export with no remaining importer; `applyKeep` stays while `flatten.ts` uses it), `page.css` (delete every rule whose class is no longer rendered: grep each `.report-*` class in `src/` after the deletions), `ReportSection.tsx` (drop `HINTS` entries for removed actions, `GENERATED_TITLE`, `appendixTitle`, `countFigures`, `nodeAtPath` if unused)
- Test: the suite

**Interfaces:**
- `flatten.ts` is the only non-test source that names an old node type.

- [ ] **Step 1: Grep before deleting**

For each symbol in the lists above, run `grep -rn "<symbol>" src audit` and confirm that only the file being deleted or reduced, and its tests, reference it. If anything else does, rewire that call site to its plain counterpart (named in Tasks 1 to 8) before deleting.

- [ ] **Step 2: Delete and reduce, then write the gate test**

Add to `src/test/reportFlatten.test.ts`:

```ts
it("no source file outside flatten.ts names a removed node type", async () => {
  const files = import.meta.glob("../{engines,features,dev}/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const OLD = /type:\s*"(slot|generated|evidence|finding|table-block|steps|step|phase|vuln|exploit)"|name:\s*"(slot|generated|evidence|finding|table-block|steps|step|phase|vuln|exploit)"/;
  const hits = Object.entries(files).filter(([path, src]) => !path.endsWith("/flatten.ts") && OLD.test(src)).map(([p]) => p);
  expect(hits).toEqual([]);
});
```

- [ ] **Step 3: Run the whole suite**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS. The gate test lists no file.

- [ ] **Step 4: Commit**

```bash
git add -A src
git commit -m "refactor(reports): remove the page machinery: container nodes, chips, slots, copies and their views"
```

---

### Task 11: Audit fixtures and Playwright report steps

**Files:**
- Modify: `src/audit/fixtures.ts` (garnet joins `e-exam`: a host row `host("h-exam-garnet", "e-exam", "garnet", "10.10.30.31", "linux", { boardColumn: "post-exploitation", access: "root" })`; merge `garnetFixtures(AUDIT_NOW)`'s log, services, findings, findingFiles, failedAttempts, grants, credentials and usernames as `xfer` is merged; update the `e-exam` progress fixture to `hostsTotal: 7, hostsRooted: 6, flagsFound: 10, flagsTotal: 12`, matching garnet's two flags), `src/audit/examFixtures.ts` (`reportSections` gains web01's stored **layout-5** page from `src/test/fixtures/report-layout5-web01.json` at `meta: { layout: 5 }`, so opening it shows the rebuild and Restore), `audit/screens.ts`, `audit/regressions.spec.ts`
- Test: `npm run audit:visual`

**Interfaces:**
- `audit/screens.ts`: delete `report-appendix` and `report-chip-open`, and the `moveWinPeas` helper. Update `report-target` to garnet, with ready selector `.report-page >> role=heading[name=/^4\.\d+ garnet \(10\.10\.30\.31\)$/]`. Add `report-web01` (the rebuilt notice is visible), `report-web01-restored` (after a click on "Restore your previous page"), `report-ad`, `report-front-introduction`, `report-front-summary`, `report-front-methodology`, `report-closing`, `report-refresh-confirm` (Dialog "Replace this block with the current version?" open after typing into a garnet output block and choosing Refresh from log), and `report-notice` (garnet: "Add new evidence" clicked; notice visible). Update `report-todo` to read plain anchors.
- `audit/regressions.spec.ts`: delete the chip, slot and Move-to-appendix tests (around L1177–1340). Add these three tests. Each launches WebKit at 1400×900 the way the existing "in WebKit too" test does:
  - `Report: every block type takes typing and the log stays as it was, in WebKit`. On garnet, type "X" into a paragraph, a numbered step's sentence, a code block, a ports Notes cell, a figure caption, and the summary's first hint paragraph. Assert each block's text now contains "X". Then open `/e/e-exam/s/log`, and assert the edited command's output text is unchanged.
  - `Report: consecutive blocks never touch, in WebKit at 1400`. For every pair of adjacent children of `.report-page .ProseMirror` and of each `.list-content`, assert `next.top - prev.bottom >= 8`.
  - `Report: the notice sits clear of the sidebar, expanded and collapsed`. Trigger Add new evidence. The notice's `left` must be ≥ the sidebar container's `right + 8`. Collapse the sidebar (⌘B or its trigger) and assert again.

- [ ] **Step 1: Update the fixtures and screens**

- [ ] **Step 2: Run the audit**

Run: `npm run audit:visual`
Expected: PASS. No `tiny-text`, `small-target`, `overlap`, `overflow`, `clipped`, `page-overflow`, `document-scroll` or `mid-token-wrap` failure on any report screen. All three regressions pass.

- [ ] **Step 3: Run the unit suite** (the fixtures feed vitest too)

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS. Update any fixture-count assertion that counts `e-exam` hosts.

- [ ] **Step 4: Commit**

```bash
git add src/audit audit
git commit -m "test(audit): garnet and a layout-5 web01 page in the mock exam; report screens and WebKit editing, rhythm and notice regressions"
```

---

### Task 12: Controller visual gate (controller only, not a subagent)

**Files:** none (findings go back into fix tasks)

- [ ] **Step 1:** Run `npm run dev:audit`. Open `http://localhost:5199/e/e-exam/s/report` in **WebKit at about 1400×900**: Playwright `webkit.launch()` from a scratch script, or Safari with that window size.
- [ ] **Step 2:** Open every tab in turn: Front matter (Details, Introduction, Summary, Testing considerations, Methodology), every target (garnet, ms01, web01, lnx02), the AD set, Closing (Further information, References, Also tested), and each appendix page. Screenshot each tab and **read every screenshot**. For each, check:
  - the page reads like the owner's sample: Result line, ports table, trimmed scan, labelled vuln lines, numbered steps, flags last, Additional findings bullets, Also tested;
  - no chips, slots, guide cards or containers on the paper;
  - guide notes sit in the right-hand column;
  - hints are in muted ink and only in empty paragraphs;
  - no text is under 12px, nothing is red, gaps are amber;
  - consecutive blocks never touch.
- [ ] **Step 3:** Type into one of each block type: paragraph, numbered-step sentence, list item, code block, table cell (ports Notes), figure caption, hint paragraph. Confirm the text takes and the save indicator settles. Then open the Log and confirm the source entry is unchanged.
- [ ] **Step 4:** Delete a figure with the block handle, then ⌘Z. Drag a figure below the next code block. Confirm both work.
- [ ] **Step 5:** Use Refresh from log twice: on an untouched block (no dialog), then on an edited block (the dialog asks; check Cancel, then Replace, then ⌘Z).
- [ ] **Step 6:** On web01, check the rebuilt notice, then **Restore your previous page**. Confirm the four owner strings from the layout-5 fixture are on the page. Then use **Use the rebuilt page**.
- [ ] **Step 7:** Trigger the notice ("Add new evidence") with the sidebar expanded, then collapsed. It must sit clear of the sidebar both times and above the page toolbar.
- [ ] **Step 8:** List every defect with its screenshot. Each one becomes a fix task (implementer, then reviewer) before the branch is offered for merge. Re-run the gate after the fixes.
