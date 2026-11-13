# Reports Plan A — rulings, parked items, Plan B carries

Branch feat/reports. Copied from the SDD ledger on 2026-11-12 before the workspace was removed.

## Rulings made during execution
- Ruling: (1) the view component is exported as `ReportSectionView` from src/features/report/ReportSection.tsx, because `ReportSection` is the data type in src/types/report.ts — costs a rename if wrong.
- Ruling: (2) proof-web check = the flag entry's nearest preceding host entry is kind "http"; no ranOn/browser heuristic — spec §6.5 says "looks like it came from a web request" — costs a missed web-shell case.
- Ruling: (3) Unused = host entries not referenced in the doc; removedEntryIds only feeds addNewEvidence. Undo restores the node; the id stays in removedEntryIds harmlessly, and Insert from rail removes it from the list — costs only that a re-removed-then-undone entry won't be auto-re-added, which is the intent.
- Ruling: Task 5 — DC's steps are all phase "domain" even when entered by a hop — spec §5.5 names the DC's phase "Domain compromise" — costs a missing "Lateral movement" heading on the DC if wrong (owner can move headings).
- Ruling: Task 5 — screenshots must also come along when they fall between two kept entries (spec §5.1), not only ≤5 min after one; the plan brief dropped this and the spec binds — to be fixed in Task 5's loop — costs missing screenshots in drafts if skipped.
- Ruling: Task 5 — non-DC AD machines keep entry phase (foothold/lateral) + privesc where a privesc boundary exists, DC is all "domain" — spec §5.5's "replacing the split" read as renaming the entry phase; a lateral machine needing local privesc still gets that heading — costs an extra heading the owner can delete if wrong.
- Ruling: Task 6 — testedNotExploited reason = kind words + the attempt's free-text reason ("blocked by a control: <reason>") — spec §5.4 binds ("and the reason text") — costs a longer line if wrong.
- Ruling: Task 7 — suggestMoves returns node-path keys without sectionId; callers (T8 checks / T12 UI) prefix `${sectionId}:` to match numberAppendices keys — the signature has no sectionId — costs a key mismatch if a caller forgets (T8/T12 dispatch must say so).
- Ruling: Task 8 — screenshot-legibility caption check (spec §6.5) deferred to Task 9/12 where image dimensions are known — engine has no image width — costs the check being missed if T9/T12 forget (carry in their dispatch).
- Ruling: Task 9 — figures are numbered across the whole document (spec §4.3 binds over the brief's "across the section"): ReportDataContext gets `figureOffset` (figures in earlier sections); T10 supplies it — costs restart-at-1 per section if T10 forgets (carry into T10 dispatch).
- Ruling: Task 10 — target reorder is keys only (⌥↑/⌥↓), no drag this round — owner is keyboard-first and the brief listed keys — costs drag reorder (spec §4.1) as a follow-up.
- Ruling: Task 11 — Creds "works-on" = access grants on the target's hosts (ReportData has no cred attempts) — costs credentials that only validated (no grant) not listed; follow-up if owner wants.
- Ruling: Task 11 — rail credentials are read-only identity/type/host, no secret control (Credentials view owns secrets) — spec §4.1 "read-only" + DESIGN secret rule — costs a trip to Credentials to copy a secret.
- Owner request 2026-11-11: added Task 12b (block handle drag + formatting toolbar) to plan + spec §6.3; runs after Task 12's loop, before Task 13. Ruling: toolbar is fixed/sticky at top of page pane (not floating inline menu), link on ⌘⇧K since ⌘K is search — costs a different toolbar style if owner meant an inline popover.
- Ruling: Task 12b — Undo/Redo stay enabled with a block selected (needed to undo a drag) — deviation from brief text — costs nothing.
- Ruling: silent command blocks (blank output, entry not returnedNothing) are a SOFT check, not fail — downloads print nothing; spec §6.5's "has output" targets reproducibility; costs a missed real blank-paste if owner relies on readiness only.
- Ruling: on the Report section, the report strip replaces the engagement status strip — exam strip cells (LHOST, timebox) are irrelevant while writing — costs losing the timebox glance on that one section.
- Ruling: Task 13 — proof check ids become proof-*:{host}:{flag} with "The {flag}.txt proof for…" text (plan pinned proof-ip:{host}) — ids must be unique with two flags; no id is persisted — costs nothing.
- Ruling: Task 13 — an operator-reason attempt hides only the attempt itself; its (non-private) log entry may still surface in Tools/House cleaning — spec §3/§5.4 privacy covers the attempt and its reason — costs the owner marking the entry private if they want it gone.
- Ruling: Task 15 — auto appendices (proof table, tools, Metasploit, house cleaning) removed; Metasploit + house cleaning move into Methodologies 3.3/3.5; flags inline — sample has no appendices and owner kept appendices for oversized content only — costs re-adding if owner wants them (tools catalog code stays available).
- Ruling: Task 15 — Testing considerations kept, exported only if written (PEN-200 §5.2.4) — costs nothing when empty.
- Ruling: Task 15 — Introduction/Objective/Requirements are slots pre-filled from a Settings default, empty by default (no generated prose; owner pastes once) — costs one-time paste.
- Ruling: Task 15 — existing saved drafts keep rendering; "Rebuild layout" per section carries owner text over — owner has real drafts already — costs a manual click per section.
- Ruling: Task 16 — notes copy into editable paragraphs (provenance attr), command/HTTP blocks detach via explicit "Edit on page" — owner wants editing; spec §6.2 "referenced live" kept for untouched evidence — costs live-update on detached blocks.
- Ruling: Task 16 — no colour/font/align/math/mentions/collab extensions — one house style — costs nothing.
- Ruling: Task 16 — link popover keeps Copy (no "open in browser"); widening the Tauri opener beyond obsidian:// is a security-sensitive capability change — owner to decide — costs one copy-paste to open a link.
- Ruling: Task 17 — bump DRAFT_LAYOUT so existing pages (owner's MS01) rebuild with the new finding grouping and proof companions — owner confirmed 2026-11-11 nothing written needs keeping — costs any text the owner typed since (owner said it was unusable).
- Ruling: Task 17 — layout 3 rebuild of owner's saved pages stands — owner said 2026-11-11 "you don't have to worry about overwriting anything I wrote… I couldn't do much with things in this state"; reported in the handover — costs any prose typed since, owner will be told.

## Parked (not fixed)
- M1 "Keep the text" label doesn't say it stays in the report while private — Ruling: explicit owner action, one-line note is polish — costs an uninformed click.
- M2 kept note can be re-offered by Add new evidence if made public again — Ruling: rare — costs a duplicate paragraph.
- M3 mixed [+]/[-] multi-host spray output still ties a cred to the failed host — Ruling: multi-host sprays only; owner told — costs a false "used on" in that case.
- Restore doesn't restore coverage/removedEntryIds; rebuilt line has no dismiss; previousDoc doubles meta size per save (check 8 MiB cap scope) — Ruling: polish.

## Deferred minors (can wait)
- Task 1: minor (deferred): no RED run captured; section target_key not checked against engagement hosts (stale ids persist — T10 must hide them); no test for position/kind tie-break; to_text trivial wrapper; fakeApi reportUpdate loose cast
- Task 2: minor (deferred): Rust RED not captured, trimming not asserted; duplicate type import lines in SettingsPage; no negative OSID warning test / no server Validation error test; "Copied into each new report" line polish
- Task 3: minor (deferred): toggle-off + save clears stored original URL/code (up to 1 MiB) with no undo — final review should weigh fixing (send undefined to keep); missing tests: toggle-off, prefill when editing, >1MiB UI error; no RED for Rust test; original_url no length cap
- Task 4: minor (deferred): BOARD_ORDER hand-copied in engines/report/targets.ts (drift-prone; reuse board's column list or satisfies-check); same-column tie-break fixture; client-kind paths untested
- Task 5: minor (deferred): finding shared across AD machines renders vuln under each (untested); domainController recomputed per host
- Task 6: minor (deferred): no RED; test gaps (ruled-out port, msf multi-host/dedupe, toolsUsed hostIds/untagged, msf private); tools.ts counts heredoc/continuation lines and ignores piped tools; trailing blank line frontMatter.ts; _data unused
- Task 6: minor (deferred): port regex (?![\d.]) rejects "on 22." (sentence period) — use (?!\d|\.\d) both sides; port-in-IP test doesn't isolate (22 already tested by other attempt); test indentation cosmetics; fix report quoted no command output
- Task 7: minor (deferred): diff.ts myers trace slice OOB at d=N+M (correct by luck; widen v, add disjoint-input test); appendix letters past Z unguarded; only target/ad sections lettered (sections assumed in grading order, undocumented); block-null keep indexes concatenated outputs — T9 rendering must agree; test gaps for generated suggestions/split
- Task 8: minor (deferred): fix texts for details/gone/output/caption don't say how to fix; RED was import failure only; bare "hostname" word anywhere passes the soft check
- Task 9: minor (deferred): no own tests for exploit file-name fallback & lineCount export; defaultKeep param shadows lineCount; draft.ts keeps its own lineCount (different semantics)
- Task 10: minor (deferred): role=img on outline glyph SVGs; narrow mode ⌥1 → Select; tests for GAPS/READY values, details glyph, check click, flag toggles, <1000 layout; no RED
- Task 10: minor (deferred, FINAL REVIEW SHOULD WEIGH): queries.ts:196 a newer write for the same section isn't blocked while an older one is in flight → older could land last (stale text) — pre-existing race, data safety; unmount-flush failures dropped silently; draftFailed is view-wide not per section (blank page in other section); two "Retry" buttons same accessible name
- Task 11: minor (deferred): TDD order (tests after impl)
- Task 12: minor (deferred): block toolbar floats above the selected block and may overlap the previous line / clip on the first block — check in T13 WebKit pass
- Task 12b: minor (deferred): code block → slot loses original hint
- Task 13: minor (deferred): fixSteps splits on "e.g."/"etc."
- Task 14: minor (deferred): picked detail repeats row text for kinds without SHORT; .py detection case-sensitive
- Task 15: minor (deferred): plain paragraph typed right under a bullet merges into it; late-added runner step lands between fallback-placed exploit and access step
- Task 16: minor (deferred → final wave, owner-facing): slash block items fuzzy-match ("/etc"⏎ → Heading 1) — require label/alias prefix; markdown list/quote rules unguarded in numbered headings; Replace with a log match current replaces a different match (disable or label); find highlights stale after data refetch; second-word close untested; orphan CSS comment
- Task 17: minor (deferred → MUST fix in final wave: privacy): figures.ts stepTitleBefore can use a PRIVATE entry's title as a screenshot caption; fallback caption can go stale after reorder; narrow-screenshot check names "Screenshot" instead of fallback caption; requestPort absolute URL port overridden by portless Host

## Plan B (PDF export) must
- | T10 self | Export excluded (Plan B) | OK |
- Owner 2026-11-11: 'the most important thing is the RESULT' → Task 13 gains a full-report result review (every page screenshotted in WebKit, judged as a grader); controller will also review those screenshots personally before the final review; Plan B PDF must be judged the same way.
- Task 12b: deferred to Plan B: export of list nodes containing slots
- Plan B note: export must exclude .report-pick-hint, .report-cell-empty prompts, empty slots, amber placeholders, page titles render from kind.
- Plan B carry: export drops "Not written yet." markers, empty labelled slots' labels, Testing considerations only if written.

## Owner feedback after handover (2026-11-12) — next round, start here

- **Task 15 appendix ruling was wrong — reverse it.** Owner had explicitly said "we DO want appendices for large items". Restore appendices as a first-class part of the report: "Move to appendix" visible on every block (today it's buried in block tools), appendices listed as tabs beside targets, and **+ Page** on the tab row to add an appendix or a free page the owner writes. Open question to owner: also restore the auto appendices (proof table, tools list)?
- **Target pages are unusable ("THE WORST").** The draft pastes nearly the whole host log at full height with a "What you did and why" placeholder under each block (ms01 ≈ 8,700 px). Proposed fix, mocked in `.impeccable/mocks/decision/report-target-rethink.html`:
  - Shared: short draft (only proving entries: exploit run, shell, privesc, flags); the rest of the host's log in the right column grouped by phase with "+ add" into the current step; appendices back; everything editable.
  - **A · Steps (recommended):** one continuous page; "Steps to reproduce" is a numbered list, each step = owner's sentence + evidence as compact chips that open in place (trim/highlight/edit); long files become a chip pointing to the appendix.
  - **B · One step at a time:** outline of steps left with ✓/write, current step full-size centre, ⌥↑/⌥↓ to move, ⌘P whole-page preview.
  - Owner has not yet chosen A or B.

## Owner decisions on the feedback (2026-11-12, later)

Model report: `docs/Mock exam A — model report.md` (owner's Mock exam A lab written up from their vault notes, with "From your notes" callouts). Owner rates it above OffSec's sample; the next round follows its shape.

- **Target pages: A · Steps.** Numbered steps, each = owner sentence + evidence chips (command, trimmed output, screenshot) that open in place.
- **Appendices: manual only.** + Page and a visible "Move to appendix"; no auto proof table or tools list.
- **Guide notes:** dismissable callouts per section in the editor, in the mock's "From your notes" spirit (what this section is for, how to fill it, neutral voice). Hide one or all. Never exported.
- **Adopted from the mock:**
  - Generated **findings table** in the High-Level Summary (#, host, finding, severity, result), sorted by severity; plus a **scope table** (host, IP when tested, OS, set).
  - **Service enumeration as a port table** (port, service, version, notes) replacing "IP / Ports Open"; a **Result line** under each host heading (access gained + flag values).
  - **AD attack-path table opens the AD set** (step, from, technique, to, access), replacing the closing list.
  - **Checks:** a step with no command under it ("[not recorded]" gap); a credential used for a hop with no finding attached.
- **Unchanged:** failed attempts still reported as "Also tested" one-liners (the mock's "drop rabbit holes" line is not an owner ruling).

## Rework round (2026-11-12)

Layout 4 built on `feat/reports` (Tasks 1 to 10 of `docs/superpowers/plans/2026-11-12-raven-reports-rework.md`): numbered steps with evidence chips, generated ports/result/findings/scope/attack-path tables, the tab row with a To do panel, the log column by phase, appendix and free pages, dismissable guide notes. The ledger is `.superpowers/sdd/2026-11-12-raven-reports-rework/progress.md`; Task 10's report sits beside it.

### Rulings made this round (from the ledger)

- Ruling (pre-flight, T1→T4: REPRODUCE_LABEL defined in draft.ts by T1, value changed in T4): T4 owns the value change
- Ruling (pre-flight, T6→T8: ReportTabs onAddPage/onPageMenu → page sections): T6 renders + Page only when onAddPage given; T8 wires
- Ruling: between Task 1 and Tasks 3–6, suites owned by later tasks (checks, editor, section) may be red; each task must leave its own files and earlier tasks' files green — layout 4 changes doc shape across layers — costs a red full suite mid-run only.
- Ruling: Task 4 changes REPRODUCE_LABEL's value to "Steps to reproduce" — the steps view renders it — costs nothing.
- Ruling: Task 6 renders + Page only when onAddPage is passed; Task 8 wires page creation — keeps T6 shippable — costs nothing.
- Ruling: Task 1 — finding-named port scans are not steps either (spec §10.2 "port scans are not steps") — owner adds a scan from the log column — costs one manual add for the "how the port was identified" snippet.
- Ruling: Task 2 — scope table OS prints Windows/Linux (Host.os has no version) — data model has no OS version — costs a coarser OS column; owner can type over in a later round
- Ruling: Task 2 — a first grant that is already admin/SYSTEM must name its level in the Result line (reviewer rated Minor) — §10.2 Result line must say what access was gained; PtH-to-DC is the AD set's money line — costs one fix round
- Ruling: Task 3 — Credential has no private field; private-credential test replaced by a no-secret-in-text test — type has no such flag — costs nothing
- Ruling: Task 2's 4 unused-variable lint errors in tables.ts get fixed in Task 5's dispatch (one-line removals) — lint must be clean per task — costs nothing
- Ruling: Task 4 minor "refilled step sentence slot has empty hint" carried into Task 5 (owner-visible: a step with no prompt) — small editor normalisation — costs nothing
- Ruling: Task 5 — chip text uses separate spans with grid gap, not " · " strings (DESIGN.md bans middots; conventions.test enforces) — DESIGN.md binds over plan copy — costs nothing
- Ruling: Task 6 — empty-flag Edit text throw (rated Minor) fixed in round 1 — it is a silent failure of a visible action — costs nothing
- Ruling: Task 7 left a conventions.test failure (joined strings / middot in EvidenceRail.tsx rail heading/rows) — fix carried into Task 9 dispatch — DESIGN.md bans joined " · " strings; spec §10.1 copy is overridden by DESIGN.md as in Task 5 — costs nothing
- Ruling: guide notes show once per page (first match), not above every repeated section — keeps the page calm (owner priority: low distraction); spec §10.5 wording was mine, not an owner call — costs a one-line change if owner wants every repeat; ASK OWNER at handover
- Task 7 note (implementer calls, owner may correct): rail sort toggle removed (spec §10.1 time order); entries behind operator-reason attempts hidden from the rail (stricter than Plan A ruling that only hid the attempt); tab label kept "Unused (n)"
- Ruling (Task 10): the audit fixture's report now holds an appendix page and a free page, so `src/test/reportSection.test.tsx` deletes them in a `beforeEach` (its tab-order tests start from a report without owner pages).

### Deferred minors (from the ledger)

- Task 1: minor (deferred): endOfPhase inserts a tag-along screenshot as its own numbered step while addNewEvidence joins it to the previous step (paths disagree) — fix in Task 7 rail work
- Task 1: minor (deferred): addNewEvidence tag-along screenshot walks back past a removed predecessor into an earlier phase
- Task 1: minor (deferred → Task 4): ReportEditor insertAdded/removeExact nested changes untested
- Task 1: minor (deferred → Task 7): EvidenceRail.tsx:100 rail insert with cursor adds flat slot+evidence after the top-level block, lands after the whole steps list
- Task 1: minor (deferred): REPRODUCE_LABEL/DRAFT_LAYOUT test asserts constants only
- Task 1: minor (deferred → Task 3): proofCompanions still uses provingEntries
- Task 2: minor (deferred): privesc finding with no admin/system grant → result "Privilege escalation" (not in §10.3 list)
- Task 2: minor (deferred): findings tie-break inside an AD set falls back to createdAt, not machine order
- Task 2: minor (deferred): findingRows tests miss SYSTEM/Administrator/lateral/hop Foothold; lessons test near-tautological; flag type-guard repetition
- Task 2: minor (deferred → final wave, owner-visible): resultLine prints "shell as `x` (root), then root" when an elevated first grant is followed by a same-level grant — dedup compares strings; track last level word
- Task 3: minor (deferred → final wave): cred-finding `mentions` is a raw substring match (short usernames false-match) — use word boundary
- Task 3: minor (deferred): SHORT-line tests skip step-replay/cred-finding; cred-finding short form can exceed 38 chars
- Task 3: minor (deferred): caption-step (step-title fallback) is top-level only, can't fire in layout 4 — decide in Task 5
- Task 4: minor (deferred): backspace test uses NodeSelection not TextSelection at empty slot; chip-drag test checks doc only; stepNumbers recomputes per state; steps toDOM drops label; step content admits nested steps
- Task 5: minor (deferred → Task 10 WebKit check): block ⋯ menu may detach when ProseKit hides the handle popup
- Task 5: minor (deferred → final wave): block-menu Delete on a step skips onRemoveEvidence for nested evidence (same as ⌫, pre-existing) — removed entries not remembered
- Task 5: minor (deferred): Chip aria-expanded hardcoded false; "Highlight" name clash with toolbar mark; unmodified exploit chip order; stepHints walks whole doc per txn; Esc in trim mode closes whole chip
- Task 6: minor (deferred): tab "N to do" span mouse-only (strip button covers keyboard); strip To do is report-wide vs panel per-tab ("No gaps" on Closing) — reword empty state; tabs lack aria-controls/tabpanel; page ⋯ button inside tablist (fix in Task 8); Notes cell undo per keystroke; J/K wrap
- Task 6: minor (deferred → final wave): result line prints "local.txt ." for an empty flag value — skip flags with empty values
- Task 7: minor (deferred → final wave): tag-along screenshot walk ignores phase (lands in another phase than its rail group; also in addNewEvidence) — stop at phase boundary
- Task 7: minor (deferred → final wave): + to appendix splits every block of a multi-block entry, not only long ones
- Task 7: minor (deferred): rail row aria-label omits note; no vuln-cursor test; rowCache identity-keyed
- Task 8: minor (deferred): Page actions tooltip shortcut F2 misleading; dialog close always refocuses selected tab; RenameInput focus is border only (use ring); input in tablist while renaming; restorePage position collision; free page tab label lacks number in label
- Task 9: minor (deferred → final wave): "*"-hidden test passes while settings loading (20ms wait); rapid hides race in useGuideSettings.save; `?? []` new array per render; StandaloneGuide in appendix is React DOM (Plan B export must exclude [data-guide]); no clipboard test; heading-text matching

Parked: none were marked "parked" in the ledger.

### Fixed in Task 10 (found driving the fixture)

- Esc on the open Evidence drawer left the engagement for the dashboard (owner's window: 1400 wide, sidebar open, so the rail is a drawer). The drawer mounted after the engagement's Esc handler, which heard the key first. Now the drawer listens in the capture phase (`c569bc7`, regression test in `audit/regressions.spec.ts`).
- The block ⋯ menu pinned itself to the window's top-left corner when the page scrolled with it open (ProseKit hides the handle while scrolling, and Radix lost its anchor). A scroll now closes the menu (`abbe382`). With the pointer leaving the block, the menu stays attached: the Task 5 concern doesn't reproduce.
- An owner heading typed in a step (`# ` after a step's sentence) rendered 22px, above the 15px numbered sub-sections. The owner-heading sizes now cover headings in a step (`67073d7`).
- 24px targets: the ports table's Notes inputs (22px) and "Hide all guide notes" (18px). The tab row's inner strip was narrower than its tabs (the audit's `overflow`), so it now sizes to its tabs and the scroller scrolls it (`67073d7`, `8ce1337`).

### Seen in WebKit at 1400×900, sidebar open, for the owner to decide

Screenshots in `.superpowers/sdd/2026-11-12-raven-reports-rework/shots/wk-*.png`.

- **Target page height, chips closed:** ms01 2,589 px, xfer03 2,583 px, web01 2,108 px, lnx02 581 px (all under 3,000). The AD set of three machines is 3,788 px with seven guide notes showing.
- **Guide notes are heavy on a long page.** Each dark card is 96 to 114 px; the AD set shows seven (attack path, result, ports, steps, vuln, post, additional), about 730 px of dark chrome on a light page. Options: a lighter one-line style, collapse to the title after first view, or show only on the first page of each kind across the report. The open ruling above ("once per page") still needs the owner's answer.
- **Tab row overflow:** with 4 targets, the AD set, 2 free pages and 3 appendices the row is 1,475 px in a 1,160 px scroller. It scrolls and the open tab is kept in view (checked opening the first and the last tab), but there's no visual cue that it scrolls (WebKit hides the scrollbar), and **+ Page** and the open page's **⋯ Page actions** scroll off the right edge (⋯ sat at x = 1,440 in a 1,400 window). They're reachable by scrolling, and F2 or Delete on the tab still work. Options: an edge fade; or move + Page and ⋯ into the fixed slot at the right with Export.
- **Export slot:** empty until Plan B (`exportSlot={null}`), so "Export stays visible while the row scrolls" can't be checked yet. The slot sits outside the scroller, so it should hold.
- **Rename input:** 192 × 36 px in the 44 px row, accent border. Long titles scroll inside it. Fine as it is; the owner might want it as wide as the tab it replaces.
- **Chip truncation:** a long command chip (the base64 `python3 46153.py …` run) ends in an ellipsis with no tooltip or `title`. Opening the chip shows it in full. A `title` on the chip's command would let a hover show it too.
- **Open chip after Move to appendix:** the chip stays open with the bar still saying "Command output, showing 12 of 12 lines" and offering Trim and Highlight, over a body that's now only the pointer line. The bar could say "In Appendix A.1" instead.
- **Block handle beside a chip in a step** sits over the step-number column: the grip touches "1" and the ⋯ sits beside "2". It could offset left of the numbers for blocks inside steps.
- **Spacing inside a step:** `.report-step-body` asks for a 12px row gap, but ProseKit wraps the step's content in a plain block `div`, so the sentence and its chips sit 0 px apart. A selected block's 4px outline then covers the descenders of the sentence above. Applying the gap would add about 12px per block, roughly 200 to 300 px on ms01, so it's the owner's call.
- **To do panel:** a check's tooltip (side "right" on a full-width row) flips to the left and covers the sidebar. After picking a check, focus moves into the page, so Esc no longer closes the panel (it closes only while focus is in the panel). A check with no anchor ("No proof.txt for app03") puts the cursor at the page's start.
- **Target appendix view:** the guide note sits above "Appendix A: ms01" (on appendix pages it sits under the title).
- **Rail drawer:** + add with the cursor in step 2 joined step 2. With no cursor it made a new step at the end of the entry's phase (step 3 of Initial Access, before the flag step). A mouse + add drops focus from the removed row; the next row takes keyboard focus only when the row itself was focused.
- **Reorder:** ⌥→ on "2 ms01" made it "3 ms01", ⌥← put it back, and focus stayed on the tab both times.
- **Test-only, not a bug:** in Playwright a key pressed within a few milliseconds of a click acts at ProseMirror's old selection (the click's selection lands just after mouseup). People don't type that fast, but scripted checks need a short wait after the click.

### Plan B (page-style round + PDF/.7z export) must carry

- **Steps numbering in the PDF:** the numbers are view decorations (`stepNumbers`), not document content, and `steps` toDOM drops the label. Export must number each list from 1, as the page shows it.
- **Chips print open:** every evidence chip prints as its open block (trimmed and highlighted as set); a moved block prints its "Full output: Appendix X.n" line; a split one prints both.
- **Guide notes never print:** neither the editor decorations nor the React-DOM `StandaloneGuide` in the appendix view (exclude `[data-guide]`).
- **`page` sections in the PDF:** free pages numbered as body sections after the targets and before Closing; appendix pages lettered after the targets' appendices, in tab order.
- **Caption-step fallback in steps:** the caption-step check and the step-title caption fallback (`figures.ts` stepTitleBefore) are top-level only and can't fire in layout 4. Decide the fallback for chips in steps for page, checks and PDF together. The earlier privacy carry still applies: never use a private entry's title.
- **Plan B as before:** the earlier "Plan B (PDF export) must" list above still stands (no pick hints, empty-cell prompts, empty slots or amber placeholders; titles from kind).
- **Check the export like the page:** at 1400 in WebKit on this fixture (`src/audit/examFixtures.ts`: three standalone machines, an AD set of three with an unexplained credential hop, the modified exploit, the long winPEAS run, a private entry, one appendix page and one free page).

### Final review residuals (rework round)
- Final review found 8 fix-before-merge items, all fixed in 08dddea..b06b84f: step/list deletes are now remembered (one doc-diff recorder), empty flags skipped in the Result line, Result dedupes by level, credential check matches whole words, tag-along screenshots stay in their phase, + to appendix splits only long blocks, To do panel says "Nothing to do on this tab" and lists tabs that still have checks, drawer Esc ignores typing and open popups.
- Parked: a showing tooltip swallows the first Esc on the evidence drawer (exclude `[role=tooltip]` in `popupOpen`); deleting a note's paragraphs whole isn't remembered; "local administrator as x, then local administrator as y" collapses to the first; "Still to do on" also shows on tabs with their own checks.

### Owner request (2026-11-12): screenshots directly on findings
Add screenshots from a finding: paste, drop or pick a file. Each one creates a normal screenshot log entry on the finding's host, with its caption, and is appended to the finding's steps (reorderable). Also add "Link a screenshot from the log" for existing captures. The plain draft places a finding's screenshot as a figure after the step it belongs to; for an Additional finding it goes under that finding's bullet. Open question for the owner: does it also show in the log timeline? (Recommended: yes.) Build after the one-machine proof.
- Owner answer: yes, it appears in the log timeline. **Binding: never duplicated in the report.** One log entry is placed once. A screenshot linked to a finding is placed only with that finding's step. It never also tags along with a nearby step, never appears as a separate figure elsewhere, and doesn't show as "not in the report" in the log column once it's placed. "Link a screenshot from the log" links the existing entry; it never copies it. Test: one screenshot linked to a finding and taken within the tag-along window of another step appears exactly once in the draft.

## Plain pages rollout (2026-11-13, plan 2026-11-13-raven-reports-plain-rollout)

Shipped on feat/reports: every report page is a plain editable document (layout 6); old pages rebuilt with the original kept in `previousDoc` and an append-only `meta.originals` archive; Refresh from log per block; guide notes, checks and the log column beside the page; notice clear of the sidebar; 12px block rhythm; content-sized table columns. Controller WebKit 1400 gate passed after fixes.

Open for the owner:
- "Move to appendix" was removed from the block menu (appendices are owner pages; cut/paste is the manual path). Re-add as a one-click move if wanted.
- The Evidence column's open/closed state is not remembered between visits (E toggles it).
- A rebuild drops an Also tested list the owner had deleted, heading included.
- Residual: a flag added by hand as its own step, then its lead step added later, prints the value twice (both ordinary text).
- Next: screenshots on findings (exactly-once placement), then Plan B (page style, PDF/.7z export).
