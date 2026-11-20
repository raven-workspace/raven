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

### Follow-up
- Unit 2: form primitives.
