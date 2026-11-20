# Tailwind to SCSS migration report

## Unit 0: pixel baseline and SCSS foundation

- `npm run audit:baseline` / `npm run audit:pixel` (audit/pixel.spec.ts): 297 shots, stable over repeated runs.
- `sass-embedded` added; `src/styles/abstracts/` (`_index`, `_layers`, `_mixins` with `type($role)`); spacing tokens
  `--space-xs` … `--space-2xl` in tokens.css.

## Unit 1: text primitives

### Changes
- `Kbd` → `.kbd`, `.kbd--cap`, `.kbd--inline` (Kbd.scss).
- `labelClass` → `.section-label`, `fieldLabelClass` → `.field-label` (Label.scss).
- `EmptyState`, `ErrorState`, `LoadingState` → `.state`, `.state--empty`, `.state--error`, `.state__title`,
  `.state__body`, `.state__action`, `.state__details`, `.state__detail-text`, `.loading-state` (states.scss).
- FindingsSection's header row dropped a dead `text-faint` (it lost to the label's `text-muted`; in the new layering it
  would have won and changed the colour).
- The audit's tiny-text check also accepts `.section-label` as the 12px label role.

### Verification
- [x] Relevant tests pass (one test now asserts the semantic label classes)
- [x] Type check and lint pass
- [x] Pixel diff: 297/297 identical
- [x] Audit gate: 660/660 (with `--retries=1` for cold-start timeouts)
- [x] Keyboard focus unchanged (no focus styles in this unit)

### Differences and risks
- `PayloadView` passes `h-7 px-2 text-code` to `Kbd`; those utilities still win. The key's line height becomes 20px
  instead of 1 inside a centred single-line box; no pixel changed.

## Unit 2: form primitives

### Changes
- `controlBase` → `.control` (+ `.control--mono`), with `.input`, `.textarea` (controls.scss); `.field`,
  `.field__label|hint|error` (Field.scss); `.toggle` with `[aria-pressed="true"]` (Toggle.scss); `.select-trigger`,
  `.select-menu`, `.select-item` (Select.scss).
- State order kept from Tailwind's output: hover, then disabled, then invalid. Hover stays inside `@media (hover: hover)`.
  The select item's disabled rule uses `:where()`, as Tailwind did, so a checked item stays `--fg`.
- `Input`'s `width` prop no longer defaults to `w-full`: `.input` is full width and a `width` class rides on top.
  `Select` no longer sniffs `className` for `w-*`.
- Cascade: a `features` layer between `components` and `utilities`, declared first in global.css.
- Dead caller classes removed (they lost to the primitive in Tailwind's order and would now win): `h-7` at 12 call sites of Input,
  Select and FilePicker/TokenInput (FindBar ×2, FormatToolbar ×2, CodeBlockView, PortChip, FileChip, FillBar,
  LogSection, HostChips, VectorsFacts, ServicesFacts), `w-64` on TransferGenerator's file picker (lost to `w-full`), and
  `resize-none` on the notes Textarea (lost to `resize-y`). These controls render 32px high and the notes field stays
  resizable, exactly as before; if 28px was the intent, that is a separate, visible change.

### Verification
- [x] Unit tests (three tests moved from utility names to the semantic classes and the Select.scss rule)
- [x] Type check and lint
- [x] Pixel diff: 297/297 identical (the first run caught HostChips' dead `h-7`)
- [x] Audit gate: 660/660; the state runs' 2s navigation cap is fixed separately
- [ ] Hover, disabled and invalid states are not in the pixel screens; they follow Tailwind's emitted CSS rule for rule

## Unit 3: controls

### Changes
- `Button` → `.button`, `.button--{primary|ghost|danger|quiet-danger}`, `.button--{sm|md}` (Button.scss); hover and
  focus rules keep `:enabled`, as Tailwind's `enabled:` variants did.
- `IconButton` → `.icon-button`, `.icon-button--destructive`, `.icon-button__shortcut` (IconButton.scss).
- `Chip`, `ChipSet` → `.chip`, `.chip--accent|warn|mono`, `.chip-set`, `.chip-set--wide` (Chip.scss).
- `Toolbar`, `Row`, `ActionCell` → `.toolbar`, `.toolbar--loose`, `.row`, `.row--top`, `.action-cell` (layout.scss).
- New shared SCSS: `mono` mixin (family + ligatures off, as the global `.font-mono` rule did), `transition-colors`
  mixin; tokens `--ease-standard`, `--duration-fast`.
- Audit: tiny-text accepts `.chip` as a 12px label role.
- Callers checked with a dead-class script (Tailwind's emitted order, shorthand-aware): none dead in this unit.

### Differences and risks
- **Existing bug kept as is:** `IconButton`'s `active` look never rendered: `bg-surface-hi` lost to the base
  `bg-transparent` and `text-fg` to `text-fg-2`/`text-muted` in Tailwind's order. The migration keeps it invisible
  (`aria-pressed` only). Making active visible is a deliberate design change for later.

### Verification
- [x] Unit tests (8 assertions moved from utility names to the BEM classes)
- [x] Type check and lint
- [x] Pixel diff: 297/297 identical
- [x] Audit gate: 660/660

## Unit 4: the rest of src/ui

### Changes
- Panel.scss, Disclosure.scss (`.disclosure-caret`, `.caret-turn`, `.disclosure__toggle`), media.scss (`.wordmark`,
  `.brand-icon`, `.match`), Dialog.scss, Tooltip.scss (`.tooltip`, `.tooltip__key`, `.popover-panel`), TabMarker.scss,
  PickerTrigger.scss, TitleBar.scss (title-bar controls keyed on `aria-current="page"` / `aria-expanded="true"`),
  TimedNotice.scss, CommandBlock.scss, HintLine.scss, and `.scroll-pane` in layout.scss.
- Exported helper strings now name classes: `SCROLL_PANE = "scroll-pane"`, `CARET_TURN = "caret-turn"`,
  `BELOW_TITLE_BAR = "below-title-bar"`, `MATCH_CLASS = "match"`.
- New shared SCSS and tokens: `truncate` mixin; `--ease-decelerate`, `--ease-emphasized`, `--duration-turn`,
  `--duration-glide`; z-index roles `--z-drawer`, `--z-popover`, `--z-dialog`.
- Dead classes dropped: `shadow-lg` on three popovers (Raven's theme resets the shadow scale, so it never rendered).
- Callers and helper-string combinations checked: none dead.

### Verification
- [x] Unit tests (15 assertions moved from utility names to the BEM classes that carry the same rules)
- [x] Type check and lint
- [x] Pixel diff: 297/297 identical
- [x] Audit gate: 660/660, 0 failing checks

### Follow-up
- src/ui outside shadcn has no utilities left. Features next (units 5–24, in parallel), then shadcn (25), then removal (26).

## Unit: report

### Changes
- One sheet per component, all in `@layer features`: ReportSection.scss (`.report-section`; the `report` container kept
  as `container-type: inline-size; container-name: report`), ReportStrip.scss, ReportTabs.scss (`.report-tabs`,
  `.report-tab`, `.report-tab__state--ready|todo|selected`, `.part-tabs`), TodoPanel.scss (`.todo-panel`, `.check-list`,
  `.expected-flags`), EvidenceRail.scss (`.evidence-rail`, `.evidence-drawer`), GuidePanel.scss, ReportDetails.scss,
  AddEvidenceButton.scss, menuItems.scss (`.report-menu`, `.report-menu__item`, `--destructive`); editor/: FindBar,
  FormatToolbar, BubbleMenu, SlashMenu, TableHandles, GuideNote, ReportEditor; editor/nodes/: CodeBlockView, FigureView.
  page.css is untouched: it is unlayered, so it still beats every layered rule exactly as before.
- `menuItems.ts` exports `MENU`, `MENU_ITEM` and `MENU_ITEM_DESTRUCTIVE` class names in place of the utility string.
- A feature-local partial, `report/_popup.scss`: `report-popup` (hairline, surface, radius and the 0 12px 32px shadow the
  six report popovers share) and `prosekit-positioner($z)` (block while open, hidden when `data-state="closed"` or unset).
- Conditional strings became attributes or modifiers: the open tab and part tab key on `aria-selected="true"` (hover only
  on the others, as before), the strip's To do on `aria-expanded="true"`, ProseKit menu items on `[data-highlighted]`.
- Tooltip shortcut spans (`ml-2 font-mono text-muted`) use src/ui's identical `.tooltip__key`.
- `toolbarClassName="-mt-6"` became `report-section__toolbar` (FormatToolbar sets only `margin-inline`, so no clash).
- Audit: tiny-text accepts `.report-tab__state` (the 12px label role on a tab's state line, formerly `.text-label`).

### Dead or no-op classes removed
- `m-0`, `p-0`, `list-none`, `border-0` on fieldset/ul/p/h* (preflight restatements); buttons keep `border: 0` and a
  transparent background, as units 3–4 did.
- Callers passing `className` to report components (ReportSection → TodoPanel, FormatToolbar): none dead.

### Verification
- [x] Unit tests (reportSection: the tab state asserts `report-tab__state--todo`; reportRail: the docked column asserts
  `report-section__rail` and not `evidence-drawer`, in place of "no `fixed`")
- [x] Type check and lint
- [x] Pixel diff: 297/297 (run over this unit and log together; one flaky screen outside both, see the log unit)
- [x] Audit gate: 660/660, 0 failing checks; the drawer regression and the `report-dock` screen now select `.evidence-drawer`

### Differences and risks
- Hover, focus and highlighted states of the menus, table grips and slash/bubble menus are not in the pixel screens; they
  follow Tailwind's emitted rules (hover inside `@media (hover: hover)`, then focus-visible, the destructive colour last).
- `focus-visible:ring-N ring-accent` became `box-shadow: 0 0 0 Npx var(--accent)` (Tailwind's composed shadow with the
  other layers empty); those elements carry no other shadow.
- The visually-hidden rule is written out in EvidenceRail.scss and LogEntryRow.scss; a shared mixin in abstracts would
  serve every feature (left out to avoid clashing with the parallel units).

## Unit: log

### Changes
- AttachmentImage.scss, LogDays.scss, LogSection.scss, LogEntryRow.scss, LogEntryBody.scss, ExtractedLine.scss,
  EditEntryDialog.scss, all in `@layer features`. OrderButton has no styles of its own (LogSection passes
  `log-section__order`, which doesn't clash with `.icon-button`).
- LogEntryRow's pick mode keeps the findings split's `ctx` container: `@container ctx (width >= 30rem)` widens the tracks
  and shows the kind, as Tailwind emitted. Track lists are copied from the arbitrary values.
- `has-[:focus-visible]:bg-surface` → `&:has(:is(:focus-visible))`.

### Dead or no-op classes removed
- `m-0`, `p-0`, `list-none` on p/ul/ol/pre/h3. No caller passes a class that lost to a log component's own.

### Verification
- [x] Unit tests (attachment-image asserts `.attachment-image` and its rule in AttachmentImage.scss; saveSummary's
  ExtractedLine cases assert `extracted-line__win` / `extracted-line__undone`)
- [x] Type check and lint
- [x] Pixel diff: 297/297 (one run over both units: 293 passed, 3 flaky, `findings@900` failed all three attempts on a
  diff inside the finding editor's focused title input, outside these units; it passed on rerun with the rest)
- [x] Audit gate: 660/660, 0 failing checks (15 load timeouts passed on rerun with `--retries=1`). The drawer regression
  and the `report-dock` screen selected the drawer by Tailwind's `fixed`; they now use `.evidence-drawer`

### Differences and risks
- The finding split's pick-mode row below 30rem of pane is not in every pixel screen; its rules are Tailwind's output.

## Unit: findings

### Changes
- One sheet per component in `@layer features`: FindingsSection, HostFindings, AttemptsList, AttemptForm, FindingSplit,
  SplitLeftPane, FindingEditor, FindingSteps, FindingFiles, CodeView, CvssBuilder, RefSuggestions, ServicePicker.
- Container queries: the `host` container (`.findings-section__split`; HostView still declares its own) drives
  FindingSplit at 760px; FindingSteps declares `steps` (480px); SplitLeftPane's panel declares `ctx` for LogEntryRow.
- FindingSplit's narrow one-pane mode keys on its existing `data-pane`; tabs, host switch and CVSS segments key on
  `aria-selected` / `aria-pressed`, with hover only on the unselected ones as before.
- New mixin `line-clamp($lines)`. FindingSteps' title keeps `display: block` after it, as `block` beat `line-clamp-2`.
- Dropped no-op utilities: `m-0`, `p-0`, `px-0`, `list-none` and `bg-transparent` that restate preflight.
- Audit: the scroll-pane padding check found the host container by its `@container/host` class; it now reads the
  computed `container-name`, so it keeps covering the finding split on the Findings page.

### Left on Tailwind
- `min-h-[16rem] py-2` on SplitLeftPane's `NoteEditor`: NoteEditor's own `min-h-0` utility would beat a feature
  class. Convert with the notes unit.
- `TAB_MARK` (src/ui/shadcn/tabs) on the context tabs' TabMarker: unit 25.

### Verification
- [x] Unit tests (no assertion named a findings utility)
- [x] Type check and lint
- [x] Pixel diff: findings, findings-list, host-findings identical at every width
- [x] Audit gate

## Unit: credentials

### Changes
- One sheet per component in `@layer features`: CredentialsSection, InventoryList, UsernamesList, AccessGrants,
  CredentialForm, CredentialDock, DockWork, TestCommands, MaskedSecret, CellPopover, TestGrid.
- TestGrid: the sticky header (`top: 0`, z 30), sticky credential column (`left: 0`, z 20 in the header, z 10 in the
  body), `scroll-snap-type: y proximity` with `scroll-padding-top: var(--head-h, 0px)` and the right-edge fade are
  reproduced rule for rule. Cell states are `.test-grid__glyph--<state>`; the selected row's header and cells take
  `--selected` modifiers.
- InventoryList's column policy is three track sets (`.inventory-list__table`, `--typed`, `--crack`) under
  `@container (min-width: 700px | 900px)`; the selected row's accent bar keys on `aria-selected`.
- CredentialDock keys its facts layout on its existing `data-layout`; `MaskedSecret`'s `hideMaskBelow` now takes
  `credential-dock__mask` (a container-query class in CredentialDock.scss) instead of utilities.
- Classes on shadcn components were converted only where the component's own classes set none of the same properties
  (Table, TableHeader/Body/Row/Head/Cell, ScrollArea, ToggleGroup, DockWork's Tabs, TabsContent, ResizablePanel and
  PanelGroup). The ScrollArea viewport override keeps its `!important`.
- Dead classes dropped: TestGrid's legend swatches had `h-5 w-5 text-label`, which lost to the box's `h-7 w-7
  text-meta` (only the label role's weight applied); the swatches stay the cells' 28px boxes in the label weight.

### Left on Tailwind
- `gap-4` on the credentials section: shadcn's Tabs (asChild) puts its own `gap-3` utility on the same element, which a
  feature class can't beat.
- The dock's three `Separator`s (`bg-line-2`, container-query display) and the inventory's `ToggleGroupItem`s
  (`text-body`, `gap-2 whitespace-nowrap`): `cn()` drops the component's own `bg-border`, `text-meta` and `gap-1` only
  for utilities. All go with unit 25.

### Verification
- [x] Unit tests (8 assertions moved from utility names to the BEM classes that carry the same rules; the audit's
  tried-pairs regression now asserts `.test-grid__row--tried`)
- [x] Type check and lint
- [x] Pixel diff: 297/297 (credentials, the dock, inventory and matrix screens identical at every width)
- [x] Audit gate

## Unit: board

### Changes
- Board.scss (`.board`, `.board__lanes`, `.board__lane` with `[data-over="true"]` for the drop edge, `.board__lane-header`
  as the 144px container, `.board__lane-heading`, `.board__lane-title`, `.board__count(--empty)`, `.board__lane-body` as
  the card container) and BoardCard.scss (`.board-card` and its elements; padding and the OS row follow the lane body
  through `@container (width >= 150px | 156px)`).
- The board test asserts `.board-card__ip` instead of `font-mono`.

### Verification
- [x] Type check, lint, unit tests
- [x] Pixel diff 297/297, audit gate (run together with cleanup, settings and vault)

## Unit: cleanup

### Changes
- CleanupPanel.scss (`.cleanup-panel__*`, `.cleanup-row` with `--suggestion` for the four-track suggestion row) and
  CleanupDialog.scss. The `font-mono` the dialog passed to `Input` becomes `.cleanup-dialog__target` (the `mono` mixin:
  family and ligatures only, body size kept, so not `Input mono`). The Mark removed button's `justify-self-end` is
  `.cleanup-row__verb`.
- Dropped preflight no-ops (`m-0`, `p-0`, `list-none`, `mt-0`).

### Verification
- [x] Type check, lint, unit tests
- [x] Pixel diff 297/297, audit gate

## Unit: settings

### Changes
- SettingsPage.scss (`.settings-page` and its elements; field widths `__number` 11rem and `__port` 7rem ride on
  `Field`'s root) and FieldManualSection.scss (`.field-manual-section__*`, including the drift report's indented lines).
- The Field Manual import test asserts `.field-manual-section__warning` instead of `text-warn`.

### Verification
- [x] Type check, lint, unit tests
- [x] Pixel diff 297/297, audit gate

## Unit: vault

### Changes
- screens.scss (`.vault-screen` and its elements, shared by SetupScreen, UnlockScreen's unlock and damaged-database
  forms and VaultGate's load error), VaultGate.scss (`.vault-gate` frame, title-bar home link and wordmark, settings dot,
  notice bar, stage/frozen copy/body), CipherBackdrop.scss (`.cipher-backdrop`, `--front`), DecodingWordmark.scss (the
  wordmark always renders `.decoding-wordmark`: block, full width; letters and glyphs as classes).
- Backup radio rows key their selected look on `[aria-checked="true"]` (the dot on `[aria-checked="true"] > …`); the
  1px accent focus ring keeps the base layer's 2px offset, as before.
- Motion untouched: CipherBackdrop and DecodingWordmark animate from script; only their static classes moved.

### Verification
- [x] Type check, lint, unit tests
- [x] Pixel diff 297/297 (manual-search@1280 failed every retry once under heavy machine load, then passed 4/4 alone)
- [x] Audit gate 660/660 (the title-bar regression timed out once under load; passed alone)

## Unit: manual

### Changes
- One sheet per component: ManualPage.scss (page, reader grid with the `@media (width >= 1100px)` outline track, host
  row keyed on `[data-pane-focused]`, match bar, status slot `--ok|--warn`, note pane with `--pane-bg`, aside), ManualRail.scss,
  ManualOutline.scss (track, sliding bar with its 150ms decelerate transition and reduced-motion off), NoteView.scss,
  NoteTable.scss, ManualCommand.scss (also used by AnswerCard's commands, `--tight` for the 2px offset), InlineCommand.scss,
  AnswerCard.scss.
- NoteTable's `group/nt` variants become `.note-table[data-stacked] …` rules; the dropped cause column keeps its
  `!important` (`.note-table[data-dropped="low"] [data-col="low"]`), so it still beats the stacked cells' grid.
- ManualRail no longer imports the Arsenal's `ON` utility string: the open note's look (accent wash, accent text, 2px bar)
  is in ManualRail.scss on `[aria-current="page"]`, so the Arsenal's own migration can't change it.
- The host chip's width (`max-w-80`) is `.manual-page__host-cell .manual-page__host-chip` (two classes: HostChip is the
  Arsenal's component).
- `--ease-out` / `duration-150` → `--ease-decelerate` / `--duration-turn` (same values).
- Tests: 17 assertions moved from utilities to the classes that carry them (noteView, manualPage, answerCard).

### Verification
- [x] Type check, lint, unit tests
- [x] Pixel diff 297/297 (findings@900 flaky on one attempt), audit gate (with engagements)

## Unit: engagements (and App.tsx)

### Changes
- Sheets for ActiveCard (also `.timebox-text--*` and `.time-bar`, shared with the status strip through `TIMEBOX_TEXT`),
  Dashboard, PastTable, EngagementShell, EngagementHeader, StatusStrip (`.status-strip`, `.status-cell` used by the
  report strip's `Cell` too), Listener, MsfLock, EngagementDialog (`.kind-picker` keyed on `aria-checked`; the empty-date
  look no longer needs `!important`: the features layer beats `.control`) and Sidebar.
- App.tsx has no classes; nothing to convert.
- **Left on Tailwind (Sidebar):** every class passed to a shadcn part (SidebarProvider, Sidebar, SidebarHeader,
  SidebarContent, SidebarSeparator, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton). shadcn merges a
  caller's classes with its own through tailwind-merge (`cn`), which removes the shadcn utility the caller's class
  replaces (`grid` drops `flex`, `px-2` trims `p-2`, `data-active:bg-transparent` drops `data-active:bg-sidebar-accent`).
  A semantic class there would sit under the surviving utility. They move with unit 25. The sidebar's own elements
  (headings, spans, the empty line, the Add host row, the sliding marker on TabMarker) are converted.
- The sliding marker uses `--surface-hi` / `--accent` (what `--sidebar-accent` / `--sidebar-primary` resolve to).
- Audit: tiny-text accepts `.engagement-sidebar__heading` (the 12px "Engagement" label lost `.text-label`).
- Tests: sidebar, hosts, dashboard, msfLock and statusStrip assertions moved to the BEM classes.

### Verification
- [x] Type check, lint, unit tests
- [x] Pixel diff 297/297 (findings@900 flaky on one attempt)
- [x] Audit gate
