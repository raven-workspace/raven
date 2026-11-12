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
