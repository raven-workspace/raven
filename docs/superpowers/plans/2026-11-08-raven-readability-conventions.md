# Readability and UI Conventions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every Raven screen up to the conventions in `DESIGN.md`, and make the mechanical ones fail the build.

**Architecture:**
1. Shared pieces first. Type tokens, a focus ring, and new `src/ui` primitives (IconButton with tooltip, HintLine, Toolbar, ChipSet, Row, ActionCell, Disclosure, CommandBlock, the state components, Dialog close, Chip, picker trigger).
2. A conventions test, written early with a **pending-files baseline**. A file listed in `PENDING` may still break the rules. A file not listed must pass. A listed file that already passes fails the test, so its entry gets removed. Each screen task removes its files from `PENDING`.
3. Screen tasks, grouped by feature area.
4. Turn on audit gating last.

**Tech Stack:** React 19, TypeScript, Tailwind 4, Radix (dialog, select, plus tooltip and popover, which this plan adds), `@phosphor-icons/react`, Vitest, Playwright audit.

**Spec:**
- `docs/superpowers/specs/2026-11-08-raven-readability-conventions-design.md`;
- **`DESIGN.md`**, which is binding: every task reads the sections relevant to it.

## Global Constraints

- **`DESIGN.md` is binding.** Where the code and `DESIGN.md` disagree, the code changes.
- **Type roles only:**
  - `text-title` 20/28 600;
  - `text-heading` 15/22 600;
  - `text-body` 14/20;
  - `text-code` 13/20 mono;
  - `text-meta` 13/18;
  - `text-label` 12/16 600, uppercase, +0.08em.

  No `text-xs`, no `text-[Npx]`, and nothing under 12px. Only label, Chip and Kbd use 12px.
- **Layout:**
  - No `flex` or `inline-flex` (nor `flex-col`, `flex-1`, `flex-wrap`, `justify-between`, `grow`) in `src/features/**`.
  - Grids use explicit tracks, with exactly one `minmax(0,1fr)` slack track.
  - Single-line runs use `Toolbar` or `ChipSet`.
- **Spacing:** steps of 4, 8, 12, 16, 24 and 32, applied in every file a task touches. It is not enforced elsewhere.
- **Sizes:** inputs and toolbar buttons 32px; in-row buttons and icon buttons 28px; nothing interactive under 24px.
- **Icons:** Phosphor, regular weight, 16px in a 28px IconButton, each with an `aria-label` and a tooltip naming the action and its shortcut.
  - Named icons:
    - Copy `Copy`, Edit `PencilSimple`, Delete `Trash`;
    - Reveal `Eye`, Hide `EyeSlash`;
    - Close `X`, Add `Plus`;
    - Lock `Lock`, Settings `Gear`;
    - Expand `ArrowsOut`;
    - sort `SortAscending` (oldest first) and `SortDescending` (newest first).
  - **Brand logos** (`src/assets`) only for that exact tool or OS:
    - `metasploit.svg` for the Metasploit lock;
    - `linux.svg` and `windows11.svg` for OS;
    - `kalilinux.svg` for Kali-side steps.

    Crack uses a generic icon, never `hashcat.svg`.
- **Destructive actions:** Delete is a neutral `Trash` in `--muted`. It turns `--warn` only on hover or focus, and in its confirm step. At most one amber control at rest per screen. Entity Delete lives in the Edit dialog.
- **No joined strings:** no " · ", " — " or " → " joining structured values in JSX, or in titles Raven generates. Stored imported titles are untouched.
- **Data safety:** stored data is real. No schema changes are expected. Fixtures stay fully synthetic (RFC 5737 IPs, example.test).
- **Behaviour:**
  - Every keyboard shortcut keeps working.
  - Existing tests are updated only where they assert old markup or text that the spec deliberately changes, and never weakened.
  - The Arsenal never imports payload ranking code.
- **Commits:** no AI attribution and no `Co-Authored-By` line (the repo's slop-stop hook rejects them). Stage only your own files with `git add <paths>`, never `-A`. The owner's untracked files stay untouched:
  - `docs/superpowers/specs/2026-11-08-raven-payloads-breadth-design.md`;
  - `.impeccable/mocks/decision/fit-switch.html`.

## Review Focus

1. **Keyboard users must see tooltips.** An IconButton's tooltip must show on keyboard focus, not only on hover. That's the only place a shortcut appears once hint lines shrink. Test in Task 2.
2. **Hint lines in narrow containers** (the 560px drawers at 900px wide) must drop low-priority hints rather than wrap or clip. The `?` hint always stays visible. Test in Task 3.
3. **Delete moves out of the headers:** engagement and host Delete must still be reachable by keyboard from the Edit dialog, and must still confirm. Test in Task 6.
4. **Long identifiers** (a 60-character credential or host name, a 255-character FQDN) must truncate in one line, with the full value in `title`. They must never push the action column off-screen at 900px. Test in Task 9 (credentials) and Task 7 (sidebar and header).
5. **Lanes with no hosts and lanes with 20 hosts** must still share the header line, and the first card's top must be identical in every lane at 900, 1100, 1280 and 1440. Test in Task 8 (audit check).

---

### Task 1: Type tokens, focus ring, Kbd, and the conventions test with its pending baseline

**Files:**
- Modify:
  - `src/styles/tokens.css`: add `@theme` text utilities `--text-title`, `--text-heading`, `--text-body`, `--text-code`, `--text-meta` and `--text-label`, each with a `--line-height` pair (Tailwind 4 `--text-<name>--line-height`), sized as in Global Constraints;
  - `src/styles/global.css`: the focus ring is `outline: 2px solid var(--accent); outline-offset: 2px`, and `[data-accent-border]:focus-visible` gets `outline-color: var(--fg)`;
  - `src/ui/Kbd.tsx`: 20px tall, min-width 20px, 12px `font-mono`, `text-fg-2` on `bg-surface`, `border-line-strong`. Add a `variant?: "cap" | "inline"` prop; `inline` drops the border and background and uses `text-muted`, for use inside bordered buttons;
  - `src/ui/Label.tsx`: `labelClass` = `text-label uppercase tracking-[0.08em] text-muted`.
- Create:
  - `src/test/conventions.test.ts`;
  - `src/test/conventionsPending.ts` (`export const PENDING: Record<RuleId, string[]>`).

**Interfaces:**
- Produces:
  - the utilities `text-title`, `text-heading`, `text-body`, `text-code`, `text-meta` and `text-label`;
  - `Kbd({ variant?: "cap" | "inline" })`;
  - `type RuleId = "tiny-type" | "feature-flex" | "joined-strings" | "hand-hint" | "esc-close"`;
  - `PENDING` per rule, listing repo-relative paths.
- **The rules** (regexes over `.tsx` source in `src/features/**` and `src/ui/**`, excluding `src/test/**`):
  - `tiny-type`: `/\btext-xs\b|text-\[\d+(\.\d+)?px\]/`.
  - `feature-flex`: `/\b(inline-)?flex\b|\bflex-(col|1|wrap)\b|\bjustify-between\b|\bgrow\b/`, only inside class strings (`className=`, `cx(`, or a template string), in `src/features/**`.
  - `joined-strings`: a JSX text or string child containing `" · "`, `" — "` or `" → "`, except inside `<p>` prose. The test strips `<p>…</p>` blocks before matching.
  - `hand-hint`: two or more `<Kbd` in one JSX expression outside `src/ui/HintLine.tsx`.
  - `esc-close`: `<Kbd[^>]*>\s*esc\s*</Kbd>` (case-insensitive) anywhere.

- [ ] **Step 1: Write the tests** in `src/test/conventions.test.ts`:
  - `"<rule>: files not in PENDING follow it"`: every scanned file not listed for the rule has zero matches.
  - `"<rule>: every PENDING entry still breaks it"`: each listed file still has a match, so fixed files must be removed from the list.
  - `"type tokens exist"`: `tokens.css` defines all six `--text-*` with the exact sizes 20, 15, 14, 13, 13 and 12px.
- [ ] **Step 2:** Run `npx vitest run src/test/conventions.test.ts`. It should fail, because `PENDING` is empty and the tokens are missing.
- [ ] **Step 3:** Add the tokens, the focus ring, `Kbd` and `labelClass`. Generate `PENDING` by running the rules once and writing every current offender into the file, sorted. This is the baseline that later tasks shrink.
- [ ] **Step 4:** Run the test, then `npx tsc -b && npx vitest run`. All should pass. Update any test that asserts the old Kbd or label markup.
- [ ] **Step 5: Commit:** `feat(ui): type roles, focus ring, Kbd and the conventions test`.

### Task 2: IconButton with tooltip, Toolbar, ChipSet, Row, ActionCell

**Files:**
- Create:
  - `src/ui/Tooltip.tsx`: `@radix-ui/react-tooltip`, added to `package.json`, with a `TooltipProvider` mounted in `src/App.tsx`, delay 300ms;
  - `src/ui/IconButton.tsx`;
  - `src/ui/Toolbar.tsx`;
  - `src/ui/ChipSet.tsx`;
  - `src/ui/Row.tsx`;
  - `src/ui/ActionCell.tsx`;
  - `src/test/ui/iconButton.test.tsx`.
- Modify: `src/ui/index.ts`, `src/ui/Button.tsx`. Button sizes become: `md` 32px `text-body`; `sm` 28px `text-body`. There is no 24px or `text-xs` size.

**Interfaces:**
- **IconButton:**

  ```ts
  IconButton(props: {
    icon: Icon; label: string; shortcut?: string;
    tone?: "default" | "destructive"; active?: boolean;
    onClick?: () => void;
  } & ButtonHTMLAttributes)
  ```

  - 28×28, with the icon at 16px.
  - `aria-label={label}`.
  - The tooltip text is `label` or `${label} · ${shortcut}`.
  - The `destructive` tone is `text-muted` at rest and `text-warn` on hover and focus.
- `Toolbar({ gap?: 2|3, children })`: a single-line `inline-flex items-center`, `nowrap`.
- `ChipSet({ children })`: `flex flex-wrap gap-2`, the only wrapping flex.
- `Row({ tracks: string; align?: "start"|"center"; children })`: renders `display:grid` with `gridTemplateColumns: tracks`.
- `ActionCell({ children })`: `Toolbar` with a fixed width set by its children; it never wraps.

- [ ] **Step 1: Tests:**
  - `"icon button names its action"`: `getByRole('button', {name:'Copy'})`.
  - `"tooltip shows on keyboard focus with the shortcut"`: Tab to the button, then `findByRole('tooltip')` has text `"Copy · ⌘C"` (Review Focus 1).
  - `"destructive tone is muted at rest"`: has class `text-muted` and not `text-warn`.
  - `"Row renders the given tracks"`: style `grid-template-columns` equals the prop.
- [ ] **Step 2:** Run them. They should fail.
- [ ] **Step 3:** Implement. Install `@radix-ui/react-tooltip` (and `@radix-ui/react-popover`, which Task 3 uses) with `npm i`.
- [ ] **Step 4:** Run the tests, then `npx tsc -b && npx vitest run`. They should pass, with any Button-size assertions updated.
- [ ] **Step 5: Commit:** `feat(ui): IconButton with tooltip, Toolbar, ChipSet, Row, ActionCell`.

### Task 3: HintLine with priority drop-out and the `?` list

**Files:**
- Create:
  - `src/ui/HintLine.tsx`;
  - `src/test/ui/hintLine.test.tsx`.
- Modify: `src/ui/index.ts`.

**Interfaces:**
- `export interface Hint { keys: string; label: string; priority: number }` (1 = always shown).
- `HintLine({ hints: Hint[]; max?: number /* default 5 */; ariaLabel: string })`.
  - Renders a single-line grid (`grid-auto-flow: column; justify-content: start; column-gap: 20px`). Each hint is `Kbd` + label (`text-meta text-muted-2`, 6px gap, `nowrap`).
  - Shows the top `max` hints by priority, in the given order.
  - A `ResizeObserver` drops hints from lowest priority up while `scrollWidth > clientWidth`.
  - A final `?` button (always present) opens a Radix Popover listing every hint.
  - The `?` key opens the popover when the HintLine's surface contains focus, and focus is not in an input, textarea or `contenteditable`.
  - Carries `data-hint-line`.

- [ ] **Step 1: Tests:**
  - `"shows at most 5 hints"`.
  - `"no middot in the rendered text"`.
  - `"drops lowest priority first when narrow"`: mock the element widths so 3 fit. The priority-1 hints and `?` remain (Review Focus 2).
  - `"? opens the full list"`: click `?`, and the popover lists all hints.
  - `"? key ignored while typing"`.
- [ ] **Step 2:** Run them. They should fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. They should pass.
- [ ] **Step 5: Commit:** `feat(ui): HintLine`.

### Task 4: Dialog close, Disclosure, CommandBlock, states, Chip, PickerTrigger

**Files:**
- Modify:
  - `src/ui/Dialog.tsx`: the header becomes `grid-cols-[minmax(0,1fr)_auto]`; close is `IconButton icon={X} label="Close" shortcut="Esc"`, with one hover state; the `esc` Kbd is removed; the title is `text-heading`;
  - `src/ui/Chip.tsx`: 22px, `text-label` without the uppercase transform (chips keep case), variants `default | accent | warn`;
  - `src/ui/EmptyState.tsx`: title, sentence and action;
  - `src/ui/Field.tsx`: the label is `text-meta text-muted-2`, sentence case; the hint and error are `text-meta`;
  - `src/ui/Select.tsx`: no 10px text.
- Create:
  - `src/ui/Disclosure.tsx`;
  - `src/ui/CommandBlock.tsx`;
  - `src/ui/LoadingState.tsx`;
  - `src/ui/ErrorState.tsx`;
  - `src/ui/PickerTrigger.tsx`;
  - `src/test/ui/primitives.test.tsx`.

**Interfaces:**
- `Disclosure({ label: string; count?: number; open: boolean; onOpenChange; children })`:
  - a full-width button row, at least 28px tall;
  - `CaretRight` or `CaretDown` at 16px;
  - the label `${label} (${count})`;
  - `aria-expanded`.
- `CommandBlock({ text: string; label?: string; onCopy?: () => void; placeholders?: boolean })`:
  - `text-code` on `bg-surface`;
  - an IconButton `Copy` in a fixed right track;
  - `{TOKEN}` placeholders rendered in `text-warn`.
- `LoadingState({ label: string })`: renders nothing for 150ms, then `"Loading <label>…"` in `text-meta`.
- `ErrorState({ title: string; hint: string; onRetry: () => void; detail?: string })`: `detail` sits in a collapsed Disclosure "Details".
- `PickerTrigger({ prefix: string; value?: string; placeholder?: string /* "Pick one" */; icon?: ReactNode; ...ButtonHTMLAttributes })`:
  - 28px, bordered, tabbable;
  - the prefix in `text-meta`, the value in `text-body`, and a 12px `CaretDown` at full opacity;
  - an unset value renders `placeholder` in `text-warn`.

- [ ] **Step 1: Tests:**
  - `"dialog closes with an X icon button and has no esc cap"`.
  - `"disclosure toggles with Space and shows the count"`.
  - `"command block copies and marks placeholders"`.
  - `"loading state is blank for 150ms"`, using fake timers.
  - `"error state retries"`.
  - `"picker trigger is in the tab order and shows Pick one when unset"`.
- [ ] **Step 2:** Run them. They should fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, then the full `npx vitest run`. Update any assertions that depend on the dialog close or field-label text.
- [ ] **Step 5: Commit:** `feat(ui): dialog close, disclosure, command block, states, picker trigger`.

### Task 5: Title bar and status strip

**Files:**
- Modify:
  - `src/ui/TitleBar.tsx`;
  - `src/features/vault/VaultGate.tsx`: order Arsenal, Payloads, Search, Lock (`Lock` icon), then Settings as an IconButton `Gear` at the end; key hints inside these buttons use `Kbd variant="inline"`;
  - `src/features/engagements/StatusStrip.tsx`:
    - labelled cells in a grid (`grid-auto-flow: column`, 24px gap, `nowrap`);
    - order: Timebox, Rooted, Flags, Metasploit (with `metasploit.svg`), Threads, Cleanup, LHOST;
    - a container query drops "of 23h 45m", then the bar, then cells from the end;
    - the "1–6 sections" and "esc engagements" hints are removed;
  - `src/test/conventionsPending.ts`: remove these files.
- Test: `src/test/layout/statusStrip.test.tsx` (create or extend the existing test).

- [ ] **Step 1: Tests:**
  - `"status strip has no keyboard hints"`: no `kbd` inside it.
  - `"cells are labelled in priority order"`.
  - `"metasploit cell shows the brand icon"`.
  - `"settings is the last title bar control and is an icon button named Settings"`.
  - `"lock button shows a lock icon"`.
- [ ] **Step 2:** Run them. They should fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, then `npx vitest run src/test/conventions.test.ts`. They should pass.
- [ ] **Step 5: Commit:** `fix(ui): title bar and status strip follow the conventions`.

### Task 6: Engagement and host headers, with Delete moved into the Edit dialog

**Files:**
- Modify:
  - `src/features/engagements/EngagementHeader.tsx`: `grid-cols-[minmax(0,1fr)_auto]`; kind and sub-label go in the metadata line as text; actions are Edit and Archive;
  - `src/features/engagements/EngagementDialog.tsx`: a Delete engagement button in the footer's left side, opening the existing confirm; field labels sentence case through `Field`;
  - `src/features/hosts/HostHeader.tsx`: same header pattern; the host name truncates with `title`;
  - `src/features/hosts/HostDialog.tsx`: Delete host moves here;
  - `src/test/conventionsPending.ts`.

- [ ] **Step 1: Tests:**
  - `"engagement header has no Delete button"`.
  - `"Delete engagement is in the edit dialog and still confirms"`: open with E (or the Edit button), Tab to Delete, Enter, and the confirm dialog appears (Review Focus 3).
  - The same pair for hosts.
  - `"a 255-character host name truncates and keeps its title"`.
- [ ] **Step 2:** Run them. They should fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them, plus the existing engagement and host tests. They should pass.
- [ ] **Step 5: Commit:** `fix(ui): headers use the header grid; Delete moves into the edit dialogs`.

### Task 7: Sidebar and collapsed rail

**Files:**
- Modify:
  - `src/features/engagements/Sidebar.tsx`: fixed 16px glyph tracks; hosts in the rail show a short name (the first 4 characters of the name, or the last octet when there's no name) under the glyph; the current host is marked; the tooltip shows name and IP; Add host is an `IconButton icon={Plus}`, centred in its box; no 9px or 10.5px text;
  - `src/features/hosts/HostGlyph.tsx`: Phosphor icons instead of text glyphs;
  - `src/test/conventionsPending.ts`.

- [ ] **Step 1: Tests:**
  - `"collapsed rail names each host"`.
  - `"add host is an icon button named Add host"`.
  - `"a long host name truncates in the sidebar with its title"`.
- [ ] **Step 2–4:** Fail, implement, pass.
- [ ] **Step 5: Commit:** `fix(ui): sidebar and rail identify hosts and centre their icons`.

### Task 8: Board lanes share their header row

**Files:**
- Modify:
  - `src/features/board/Board.tsx`: lanes are one grid. Either each lane uses `grid-template-rows: subgrid` over a shared header row, or the board renders headers in row 1 and lane bodies in row 2. Either way, headers share a height. Lane titles wrap freely inside the shared row.
  - `src/features/board/BoardCard.tsx`: card chips use `ChipSet` and never overflow at 900px; OS shows as a brand icon with its name as text.
  - `audit/regressions.spec.ts`: a new test.
  - `src/test/conventionsPending.ts`.

- [ ] **Step 1: Tests:**
  - Vitest: `"every lane header is in the same grid row"`.
  - Audit regression: `"board: first cards share a top line at 900/1100/1280/1440"`. Measure the `top` of each lane's first card, and of each empty lane's body start; they must be equal within 1px. The fixtures must include an empty lane and a 20-host lane (Review Focus 5).
- [ ] **Step 2–4:** Fail, implement, pass. Run `npx vitest run src/test/board*.test.tsx` and `npx playwright test -c audit/playwright.config.ts regressions -g board`.
- [ ] **Step 5: Commit:** `fix(board): lanes share their header row`.

### Task 9: Credentials (table, masked secret, row actions and the lists)

**Files:**
- Modify:
  - `src/features/credentials/CredentialsSection.tsx`, using the DESIGN.md column policy:
    - identifier `minmax(16ch,2fr)`, truncating with `title`;
    - type, scope and state `max-content` with `nowrap`;
    - scope + host becomes two lines in one cell (value, then `text-meta` host);
    - source `minmax(0,3fr)` with `line-clamp-2`;
    - secret `max-content`;
    - actions in an ActionCell: Crack as text when applicable, then IconButtons Copy, Edit, Delete (destructive);
    - under 1000px, drop Source, then Scope.
  - `src/features/credentials/MaskedSecret.tsx`: a fixed 8-dot mask, `nowrap`, no `break-all`; IconButton `Eye`/`EyeSlash` ("Reveal secret" / "Hide secret") in its own track.
  - `HashesList.tsx`, `UsernamesList.tsx`, `TestGrid.tsx` (no 10px text), `CellPopover.tsx`, `RoutineSection.tsx` (commands via `CommandBlock`), `CredentialForm.tsx`, `AccessGrants.tsx`, `TestCommands.tsx`: grid layouts, icon buttons and type roles.
  - `src/test/conventionsPending.ts`: every credentials file removed.

- [ ] **Step 1: Tests:**
  - `"secret mask never wraps and reveal is an eye icon button"`: role button named "Reveal secret"; the mask text is 8 dots.
  - `"row actions are icon buttons Copy, Edit, Delete"`.
  - `"delete is muted at rest"`.
  - `"scope renders value and host on two lines, not a middot string"`: no " · " in the row's text.
  - `"a 60-character credential name truncates and the actions stay visible"`: the ActionCell is visible at 900px in the audit (Review Focus 4).
- [ ] **Step 2–4:** Fail, implement, pass (credentials tests plus conventions).
- [ ] **Step 5: Commit:** `fix(credentials): column policy, eye reveal, icon row actions`.

### Task 10: Findings

**Files:**
- Modify (grid layouts, IconButtons for Edit/Delete/Up/Down/Remove, CommandBlock for code, type roles):
  - `src/features/findings/FindingEditor.tsx`;
  - `FindingSteps.tsx`;
  - `FindingFiles.tsx`;
  - `AttemptsList.tsx`;
  - `AttemptForm.tsx`;
  - `FindingsSection.tsx`;
  - `FindingSplit.tsx`;
  - `SplitLeftPane.tsx`;
  - `ServicePicker.tsx`;
  - `CvssBuilder.tsx`;
  - `CodeView.tsx`;
  - `HostFindings.tsx`;
  - `RefSuggestions.tsx`;
  - `src/test/conventionsPending.ts`.

- [ ] **Step 1: Tests:**
  - `"finding steps reorder with icon buttons named Move up and Move down"`.
  - `"attempt row actions are icon buttons"`.
  - Existing findings tests still pass.
- [ ] **Step 2–4:** Fail, implement, pass.
- [ ] **Step 5: Commit:** `fix(findings): grid layouts and icon row actions`.

### Task 11: Checklists, tunnels, hops and cleanup

**Files:**
- Modify:
  - `src/features/checklist/GoalRow.tsx`: `items-start`; the status control is a 28px segmented control on the title's line; "N new credentials since done", "show ▸" and "re-check ▸" become `Disclosure` or `Button`;
  - `HostChecklist.tsx`, `EngagementChecklist.tsx`, `PlaybookSection.tsx`, `CommandList.tsx` (uses `CommandBlock`), `AccessFlags.tsx`, `CredentialPicker.tsx`, `EvidenceLinks.tsx`, `FileChip.tsx`, `PortChip.tsx`, `TunnelsPanel.tsx`, `HopsPanel.tsx`, `ConfirmDelete.tsx`;
  - `src/features/cleanup/CleanupPanel.tsx` and `CleanupDialog.tsx`;
  - `src/test/conventionsPending.ts`.

- [ ] **Step 1: Tests:**
  - `"goal status stays on the title line when new credentials open"`: the status control's top equals the title's top.
  - `"new-credentials line is a disclosure with a count"`.
  - `"tunnel and hop rows delete with a muted trash icon"`.
- [ ] **Step 2–4:** Fail, implement, pass.
- [ ] **Step 5: Commit:** `fix(checklist): goal rows, disclosures and icon actions`.

### Task 12: Host view, facts and Stuck view

**Files:**
- Modify:
  - `src/features/hosts/HostView.tsx`, `NextTab.tsx`, `ServiceDialog.tsx`, `ConfirmServiceDialog.tsx`;
  - `src/features/hosts/facts/*.tsx`:
    - fact summaries become labelled cells, not middot strings;
    - the ServicesFacts verdict buttons become a segmented control;
    - VectorsFacts and IdentityFacts use IconButtons and Chip;
    - ✓ and ? become Phosphor icons;
  - `src/features/stuck/StuckView.tsx`: grid; an X close IconButton; HintLine; no flexbox;
  - `src/test/conventionsPending.ts`.

- [ ] **Step 1: Tests:**
  - `"services summary has no middot string"`.
  - `"stuck view has a visible close button"`.
  - Existing host and stuck tests still pass.
- [ ] **Step 2–4:** Fail, implement, pass.
- [ ] **Step 5: Commit:** `fix(hosts): facts, stuck view and host tabs follow the conventions`.

### Task 13: Log, capture and generated titles

**Files:**
- Modify:
  - `src/features/log/OrderButton.tsx`: an IconButton with `SortAscending` ("Oldest first") or `SortDescending` ("Newest first") that toggles the order;
  - `LogSection.tsx`: filter labels in sentence case with `nowrap`;
  - `LogEntryRow.tsx`: the kind is sentence case (`text-meta`);
  - `LogEntryBody.tsx`, `ExtractedLine.tsx`, `EditEntryDialog.tsx`, `AttachmentImage.tsx`;
  - `src/features/capture/KindChips.tsx`: a 28px segmented control with an inline Kbd;
  - `Toggle.tsx`: 28px, no 9.5px text;
  - `CaptureForm.tsx`: the Save shortcut uses an inline Kbd; no esc cap;
  - `CapturePanel.tsx`, `HostChips.tsx`, `KindFields.tsx`, `PasteArea.tsx`, `SaveSummary.tsx`;
  - `src/features/capture/resolve.ts`: auto-titles never join with " · ", " — " or " → ", and never include the host. "Screenshot · host" becomes "Screenshot". `flagTitle` is checked too;
  - `src/test/conventionsPending.ts`.

- [ ] **Step 1: Tests:**
  - `"order button toggles between sort ascending and descending icons"`: its name flips between "Oldest first" and "Newest first".
  - `"auto titles contain no joiners or host name"`: for a screenshot with a selected host, `autoTitle === "Screenshot"`, and no auto-title matches `/ · | — | → /`.
  - `"stored titles are shown unchanged"`: an entry titled `"nmap → host"` renders as-is.
  - `"kind chips are 28px and keep their shortcuts"`.
- [ ] **Step 2–4:** Fail, implement, pass. Run the capture and log tests plus conventions.
- [ ] **Step 5: Commit:** `fix(log): sort icon, sentence-case filters, segmented kinds, clean auto-titles`.

### Task 14: Arsenal, ⌘K and Transfer

**Files:**
- Modify:
  - `src/features/arsenal/ArsenalDrawer.tsx` and `ArsenalBrowse.tsx`: HintLine; grid; category buttons are reachable and pass contrast;
  - `CardView.tsx`: the "On this card" strip fits, fades with scroll buttons, or becomes a Select when narrow;
  - `ResultList.tsx`, `SearchBar.tsx`, `FillBar.tsx`, `HostChip.tsx`, `CredChip.tsx` (both `PickerTrigger`), `ChipPicker.tsx`, `CommandPreview.tsx`, `WikiText.tsx`;
  - `src/features/palette/Palette.tsx`: HintLine; `TokenInput.tsx`;
  - `src/features/generators/TransferGenerator.tsx` and `FilePicker.tsx`: grid; CommandBlock; no 11px text;
  - `src/test/conventionsPending.ts`.

- [ ] **Step 1: Tests:**
  - `"arsenal drawer footer is a HintLine with at most 5 hints"`.
  - `"palette footer is a HintLine"`.
  - `"host and credential pickers are tabbable triggers"`.
  - Existing arsenal and palette tests still pass.
- [ ] **Step 2–4:** Fail, implement, pass.
- [ ] **Step 5: Commit:** `fix(arsenal): hint lines, pickers and grid layouts`.

### Task 15: Payloads switch, using the fit list

**Files:**
- Modify:
  - `src/features/payloads/PayloadView.tsx`:
    - the fits become a visible list at the top: one row per fit, showing its name and why it fits (`text-meta`), with the selected row in the accent marker style;
    - the misfit line becomes a `Disclosure` "Don't fit here (N)";
    - "Other steps" (`ordered`) uses the same list;
    - copy rows use `CommandBlock`;
  - `MisfitFold.tsx`: absorbed into the Disclosure, or rewritten on it;
  - `ContextChips.tsx`: `PickerTrigger`s, in the Tab order;
  - `PayloadsDrawer.tsx` and `PayloadsWorkbench.tsx`: HintLine, with at most 5 hints by priority and the rest under `?`;
  - `usePayloadSession.tsx`: hint data as `Hint[]` with priorities;
  - `SqlPanel.tsx` and `TransferPanel.tsx`;
  - `src/test/conventionsPending.ts`.
- Reference: the mock `.impeccable/mocks/decision/fit-switch.html` (option B, a list of fits). Do not copy the mock's payload clamp, its number keys or its 8-hint footer.

- [ ] **Step 1: Tests:**
  - `"fits are a visible list near the top and clicking one selects it"`.
  - `"⇥ still cycles fits"`.
  - `"don't-fit line is a disclosure with a count"`.
  - `"context pickers are reachable with Tab"`.
  - Existing payloads tests still pass, with only markup-coupled assertions updated.
- [ ] **Step 2–4:** Fail, implement, pass.
- [ ] **Step 5: Commit:** `fix(payloads): fit list, disclosure and pickers`.

### Task 16: Dashboard, dialogs, settings, vault, notes and the rest

**Files:**
- Modify, covering every remaining file in `PENDING`, including:
  - `src/features/engagements/Dashboard.tsx`: "New engagement" uses an inline Kbd;
  - `ActiveCard.tsx`, `PastTable.tsx`, `Listener.tsx`, `MsfLock.tsx` (metasploit logo), `EngagementShell.tsx`, `sections.tsx`;
  - `src/features/settings/*`;
  - `src/features/vault/UnlockScreen.tsx` and `SetupScreen.tsx`;
  - `src/features/notes/*`;
  - `src/App.tsx`.

  Every section gets `LoadingState` and `ErrorState` (with Retry) in place of blank panes and raw error lines. `PENDING` ends empty for every rule.
- Modify: `src/test/conventionsPending.ts` (empty).

- [ ] **Step 1: Tests:**
  - `"PENDING is empty"`: added to `conventions.test.ts` in this task.
  - `"credentials section shows a retry on load failure"`: uses the `?audit=error` fake, or an API mock.
- [ ] **Step 2–4:** Fail, implement, pass.
- [ ] **Step 5: Commit:** `fix(ui): remaining screens follow the conventions; pending list empty`.

### Task 17: The audit fails on convention breaks; full verification

**Files:**
- Modify:
  - `audit/report.ts` and `audit/checks/*`:
    - make `tiny-text` (12px floor; 13px for anything not a label, chip or kbd), `small-target` (24px), `overlap`, `page-overflow`, `overflow`, `clipped` and `mid-token-wrap` failing;
    - `offscreen`, `squeezed`, `narrow-wrap`, `truncated`, `long-lines` and `off-scale-spacing` stay reported;
    - support `data-audit-allow="<check>"` together with `data-audit-reason`, and list every opt-out in `report.md`;
  - `audit/visual.spec.ts` and `audit/ux.spec.ts`: a failing check fails the test, including the `~empty|loading|error` screens;
  - `audit/README.md`: document the gate and the opt-out.

- [ ] **Step 1:** Add `audit/selftest.spec.ts` cases:
  - `"a 10px text fixture fails the run"`;
  - `"data-audit-allow without a reason is itself an error"`.
- [ ] **Step 2:** Run `npm run audit:selftest`. It should fail.
- [ ] **Step 3:** Implement the gate. Run `npm run audit:visual`. Fix each remaining failure in the owning component, or opt it out with a reason when there's genuinely no fix.
- [ ] **Step 4: Full verification:**
  - `npx tsc -b && npx eslint . && npx vitest run && npm run audit:visual && (cd src-tauri && cargo test)`;
  - `impeccable detect --json src/features src/ui`.

  All should pass.
- [ ] **Step 5:** Update `docs/superpowers/followups/` with:
  - the off-scale spacing left in files no task touched;
  - splitting the Credentials page;
  - the right-click menu.

  Commit: `test(audit): convention breaks fail the run`.
