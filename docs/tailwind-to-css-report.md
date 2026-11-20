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
- Dead caller classes removed (they lost to the primitive in Tailwind's order and would now win): `h-7` on 8 Inputs,
  Selects and FilePicker/TokenInput uses (FindBar ×2, FormatToolbar ×2, CodeBlockView, PortChip, FileChip, FillBar,
  LogSection, HostChips, VectorsFacts, ServicesFacts), `w-64` on TransferGenerator's file picker (lost to `w-full`), and
  `resize-none` on the notes Textarea (lost to `resize-y`). These controls render 32px high and the notes field stays
  resizable, exactly as before; if 28px was the intent, that is a separate, visible change.

### Verification
- [x] Unit tests (three tests moved from utility names to the semantic classes and the Select.scss rule)
- [x] Type check and lint
- [x] Pixel diff: 297/297 identical (the first run caught HostChips' dead `h-7`)
- [x] Audit gate: 660/660; the state runs' 2s navigation cap is fixed separately
- [ ] Hover, disabled and invalid states are not in the pixel screens; they follow Tailwind's emitted CSS rule for rule

### Follow-up
- Unit 3: Button, IconButton, Chip, ChipSet, Toolbar, Row, ActionCell.
