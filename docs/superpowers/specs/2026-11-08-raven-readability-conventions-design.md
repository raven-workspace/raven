# Raven: readability and UI conventions round

Date: 2026-11-08. Branch: `readability-conventions`. The conventions themselves are in **`DESIGN.md`** at the repo root, and that file is binding. This document says what this round changes, in what order, and how the conventions get enforced.

## 1. Why

The owner kept finding the same faults by screenshot:
- text too small;
- keyboard hint lines that read like a base64 string;
- rows of text buttons, with the masked secret running into Reveal;
- status-strip items and short table cells wrapping;
- alternatives shown as tiny grey links;
- kanban lane headers wrapping unevenly, so lanes start at different heights;
- an "esc" cap as the dialog close button;
- the title bar's mixed controls.

The owner also holds that flexbox where grid belongs causes 70–80% of the layout problems.

A review of every screen at 900–1440px (two isolated reviews: design and mechanical) confirmed and widened this:
- 17 font sizes, with about 380 uses under 13px;
- about 200 flexbox layouts that should be grids, in 78 files;
- 5 different hint-line builds;
- 3 styles each of Delete and Copy;
- 22/40 on Nielsen's heuristics, with Consistency and Error recovery at 1/4.

The visual audit already *reports* most of these: 16,000 tiny-text findings and 9,300 small-target findings. But it never fails a run, and the design checker doesn't resolve Tailwind sizes, so nothing stopped them.

**Goal:** write the conventions once, bring the whole app up to them, and make the mechanical ones fail the build, so the owner never has to screenshot these again.

## 2. Goals

1. **`DESIGN.md`** (done in this round's first commit) holds the conventions, with exact values.
2. **Tokens.** Add the six type roles to `src/styles/tokens.css` as Tailwind utilities (`text-title` … `text-label`), each with its line height. Add the focus ring (2px accent, 2px offset; 2px `--fg` on accent-bordered elements) in `global.css`.
3. **Shared components in `src/ui`:**
   - `IconButton`, with a tooltip;
   - `HintLine`, plus a reworked `Kbd`;
   - `Row`, a grid with a `tracks` prop;
   - `ActionCell`;
   - `Toolbar` and `ChipSet`, the only homes of flexbox;
   - `Disclosure`;
   - `CommandBlock`;
   - `LoadingState` and `ErrorState`, plus a reworked `EmptyState`;
   - a reworked `Dialog` with an `X` close button;
   - a reworked `Chip` and `Select` trigger for context pickers.

   Phosphor icons come from the existing dependency. The brand logos come from `src/assets`.
4. **Apply the conventions to every screen.** Order and grouping are left to the plan; every item below must be done:
   - Title bar:
     - controls in one style;
     - order: Arsenal, Payloads, Search, Lock with the `Lock` icon, then Settings as a `Gear` icon button at the end;
     - no bordered `Kbd` inside a bordered button.
   - Status strip:
     - labelled cells in importance order;
     - nothing wraps;
     - the "1–6 sections" and "esc engagements" hints are removed.
   - Engagement and host headers: the header grid pattern; Delete moves into the Edit dialog.
   - Sidebar and collapsed rail:
     - centred icons, including a proper `Plus` for Add host;
     - hosts identifiable in the rail (short name, current marked, tooltip);
     - fixed glyph tracks.
   - Board: lane headers share one row through subgrid, so every lane's first card starts on the same line; chips stay inside cards at 900px.
   - Credentials table:
     - the column policy (fixed mask, Eye/EyeSlash reveal, icon actions in an ActionCell);
     - no wrapping in short columns;
     - "local · MS01" becomes a two-line cell.

     The same treatment goes to every other table and list with rows of text buttons: Hashes, Usernames, Finding steps, Finding files, Attempts, Services facts, Cleanup, Tunnels, Hops and Vectors.
   - Every dialog uses an `X` close button with a single hover state. Form field labels are sentence-case `text-meta`.
   - Every hint line uses `HintLine`: the Arsenal drawer, the Payloads drawer and Workbench, ⌘K, and the Stuck view.
   - Secondary options become real controls:
     - in Payloads, the fits become the visible list (option B, mock `.impeccable/mocks/decision/fit-switch.html`) and the misfit line a `Disclosure`;
     - checklist "N new credentials since done", "show ▸" and "re-check ▸" become controls;
     - context pickers become bordered, tabbable Select triggers.
   - Checklist goal rows: status control on the title's line (`items-start`), no 20px controls.
   - Log:
     - the "Oldest first ↑" sort button becomes a `SortAscending` or `SortDescending` icon button;
     - filter labels (Host, Kind, Ran on) become sentence-case and never wrap;
     - the kind column is sentence case;
     - **titles Raven generates** (auto-titles in capture, such as "Screenshot · <host>", and flag titles) never join values with "·", "—" or "→", and never repeat the host, which the row already shows as a chip. Titles stored from the old pwndash import keep their text, because stored entries are real data and are not rewritten. The owner can edit them.
   - Loading, error and empty states use the new components on every section.
   - Text glyphs used as icons (✓ ? ◐ ○ ▸ ▾ ⌄) become Phosphor icons.
   - Every `text-xs` and `text-[Npx]` becomes a type role. Every flex layout other than a single-line run becomes a grid.
5. **Enforcement:**
   - **`src/test/conventions.test.ts`** scans `src/features/**` and `src/ui/**` (excluding tests) and fails on:
     - `text-xs` or `text-[` with a px size;
     - any `flex` or `inline-flex` layout in `src/features/**`, including `flex-col`, `flex-1`, `flex-wrap`, `justify-between` and `grow`. Single-line runs use `Toolbar`, `ChipSet` or another `src/ui` primitive;
     - `" · "` inside JSX outside prose elements;
     - a hand-built hint line (a `<Kbd>` sequence outside `HintLine`);
     - an "esc" close cap.

     Each rule has an allowlist that names its exceptions with a reason.
   - **The visual audit fails the run** on these checks (names from `audit/types.ts`), on every screen and width, including the `~empty|loading|error` state screens:
     - `tiny-text` (under 12px; under 13px for non-label text);
     - `small-target` (under 24px);
     - `overlap`;
     - `page-overflow` and `overflow`;
     - `clipped`;
     - `mid-token-wrap`.

     `offscreen`, `squeezed`, `narrow-wrap`, `truncated`, `long-lines` and `off-scale-spacing` stay reported and don't fail. One element can opt out of one check with `data-audit-allow="<check>"`. It must carry a `data-audit-reason`, and the report lists every opt-out.
   - A new audit check that lane headers on the board share a top line for their first card.

## 3. Non-goals

- Payloads 2b-C breadth: the new payloads, toggles and stale-build blocking. Only the fit-list switch from option B is in this round, because it's the same "secondary options" convention. The rest is next round; see `docs/superpowers/specs/2026-11-08-raven-payloads-breadth-design.md` (draft, kept out of this branch's commits).
- A right-click context menu (owner deferred it).
- Motion design.
- Splitting long pages into tabs. Credentials is about 4000px, which breaks the page-length rule, but splitting it is an information-architecture change for its own round. This round notes it in `docs/superpowers/followups/`.
- The rest of the 2b follow-up list.

## 4. Constraints

- **Stored data is real.** No schema changes are expected in this round. If one turns out to be needed, it gets a migration and a backup first.
- **Fixtures stay synthetic,** and no real data goes into tests or audit fixtures.
- **No behaviour regressions.** Every keyboard shortcut still works, and existing tests pass unchanged except where they assert old markup or text that this round deliberately changes. Those tests are updated, never weakened.
- **The Arsenal rule stands:** it never ranks by host and never imports payload ranking code.
- **Verification:** `npx tsc -b`, `npx eslint .`, `npx vitest run`, `npm run audit:visual` (now failing on violations) and `cd src-tauri && cargo test` all pass.

## 5. Decided with the owner

- Conventions in `DESIGN.md`, enforced by tests and the audit.
- CSS grid by default. Flexbox only for single-line runs.
- Nothing tiny: body 14px, with a 13px minimum for anything read and a 12px floor for labels, chips and key caps only. Owner: "what ships today doesn't mean I liked it."
- Icons for universal verbs:
  - Reveal and Hide use Phosphor `Eye` and `EyeSlash`;
  - Lock gets a `Lock` icon;
  - Settings moves to the end as a gear;
  - Add host uses a proper `Plus`, centred.
- Brand icons only for that exact tool or OS. Crack uses a generic icon, not hashcat.
- Hint lines are readable units; no bordered `Kbd` inside bordered buttons.
- The status strip loses "1–6 sections" (and with it "esc engagements").
- Dialogs close with an `X` icon that has a single hover state; no "esc" cap.
- Side-by-side lanes share header rows.
- The Log's sort control uses Phosphor `SortAscending` and `SortDescending`.
- The no-joined-strings rule is enforced on titles Raven generates (the owner: imported "—" and "→" titles came from pwndash, "but we should enforce it").
- Payloads fits are shown as a visible list (option B).
- A right-click context menu is deferred.
- Work happens on a branch.

## 6. My calls (the owner can overrule)

- Row actions are always visible. They are not shown on hover only, because PRODUCT.md says "what's needed stays in view", and the owner works under time pressure.
- Entity Delete for engagements and hosts moves into the Edit dialog; Archive stays in the header.
- Hint lines show at most 5 hints, drop lower-priority ones when narrow, and add a `?` hint for the full list.
- Field labels in forms are sentence case. Uppercase is kept for section labels.
- The visual audit's failure thresholds are as listed in §2.5. Truncation stays a report.
- No `.impeccable/design.json` sidecar this round; `DESIGN.md` alone is the authority.
- **Builder-check rulings:**
  - The audit checks that fail are as listed in §2.5. There is a per-element opt-out that must carry a reason.
  - Plain `flex` is banned in feature code too, as DESIGN.md says. Single-line runs go through the `src/ui` primitives.
  - The 4px spacing scale is applied only in files this round already edits. There's no test or audit failure for it; the rest goes to followups.
  - Payloads in this round gets the fit list and the misfit `Disclosure`, also used for the "Other steps" variant. ⇥ still cycles fits, and no number keys are added. Clamping the payload block is deferred to the Payloads breadth round. The hint line follows the `HintLine` rules, not the mock.
  - The `?` at the end of a hint line is clickable and opens a popover with that surface's full hint list. The `?` key opens it only when focus isn't in a text field.
  - Tooltips use `@radix-ui/react-tooltip`, matching the Radix pieces already in use. They show on hover and on keyboard focus, because native `title` tooltips don't show on focus.
  - The capture kind chips become a 28px segmented control, not interactive Chips.
- Splitting the Credentials page into tabs is deferred to its own round.

## 7. Left to the builder

- The grouping and order of tasks. Shared components come first, then the screens.
- Exact Phosphor icon choices beyond those named, within the Components rules.
- How hint priority drop-out is measured: a container query or a resize observer.
- The allowlist entries in the conventions test. Each needs a reason.
