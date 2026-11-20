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
