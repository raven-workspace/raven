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
