# Tailwind to SCSS migration plan

Approved 2026-11-19. Goal: Raven's styles move from Tailwind utilities to SCSS another developer can read and change,
with every screen pixel-identical. Inventory: [tailwind-to-css-inventory.md](tailwind-to-css-inventory.md). Progress:
[tailwind-to-css-report.md](tailwind-to-css-report.md).

## Decisions

1. **SCSS**, not plain CSS: partials, mixins for the type roles and repeated patterns, and build-time values for media
   and container queries (CSS variables can't be used there).
2. **shadcn components are converted** (`src/ui/shadcn` becomes Raven code; re-adding a component from the shadcn CLI
   means converting it too).
3. **Primitives keep `className`.** It is what React developers expect; callers pass semantic classes instead of
   utilities once their own unit is migrated.
4. **DESIGN.md's grid and spacing rules and the four Tailwind convention tests are rewritten for SCSS**, keeping what
   they protect (explicit grid tracks, no flex in feature layout, the spacing scale, Ink colours only). The look of
   Raven doesn't change.
5. **Pixel diff:** every unit passes `npm run audit:pixel` against a baseline taken before the migration.

## Target architecture

- **Stylesheet type:** SCSS (`sass-embedded`, compiled by Vite).
- **Runtime tokens:** CSS custom properties in `src/styles/tokens.css`, the single source (also read by `page.css` and
  JS). SCSS never re-declares a token as a variable.
- **Shared SCSS:** `src/styles/abstracts/` (`@use "@/styles/abstracts" as *;` at the top of every component sheet):
  `_layers` (cascade layer order), `_mixins` (`type($role)`, and later `truncate`, popover surface, …), and later
  `_breakpoints` (window and container sizes).
- **Component styles:** one `.scss` next to its component (`Kbd.tsx` + `Kbd.scss`), imported by the component, all rules
  inside `@layer components`. A family of small components may share one sheet (`states.scss` for Empty/Error/Loading).
- **Layout:** each grid's tracks live in its component's sheet (DESIGN.md's explicit-tracks rule). Shared layout helpers
  only where a pattern repeats across features, added and documented in `abstracts`.
- **Cascade:** `@layer theme, base, components, features, utilities;` is declared first in `global.css`. `src/ui`
  primitives are in `components`, feature sheets in `features` (a feature's class on a primitive beats the primitive's
  own rules, whatever order the sheets load in), and Tailwind's `utilities` stay last while the migration runs, so a
  utility a not-yet-migrated caller passes through `className` still wins, as before.

## Naming conventions

- **Component (block):** `.kbd`, `.state`, `.test-grid`
- **Element:** `.state__title`
- **Modifier:** `.kbd--cap`, `.state--error`
- **State:** existing attributes first (`[data-state]`, `[aria-expanded]`, `:disabled`); `.is-*` only where none exists
- **Layout helper:** none yet; each one needs a reason in `abstracts`

## Design tokens

| Token | Value | Usage | Notes |
|---|---|---|---|
| Ink colours | unchanged | everything | already the single source |
| `--space-xs` … `--space-2xl` | 4, 8, 12, 16, 24, 32px (as rem) | gaps, padding | DESIGN.md's scale; added in unit 1 |
| `--text-<role>` | unchanged | `@include type(role)` | emitted by Tailwind's `@theme static` today; moved to `:root` at removal |
| `--radius`, `--radius-sm` | 8px, 6px | radii | same |
| control size, shadows, z-index, motion | as the inventory | added when a unit first needs them | named by role |

## Migration order

| Order | Unit | Risk | Verification | Status |
|---:|---|---|---|---|
| 0 | Pixel baseline + SCSS foundation | Med | baseline stable over repeated runs | Done |
| 1 | Text primitives: Kbd, labels, Empty/Loading/ErrorState | Low | tests, pixel diff, audit gate | Done |
| 2 | Form primitives: Input, Textarea, Field, Select, Toggle | Med | + focus/disabled/invalid states | Done |
| 3 | Controls: Button, IconButton, Chip, ChipSet, Toolbar, Row, ActionCell | Med | + callers' `className` | Done |
| 4 | Shell: Panel, Dialog, Collapse, Disclosure, TitleBar, Tooltip, CommandBlock, HintLine, the rest of src/ui | Med–High | + dialog motion, reduced motion | |
| 5–20 | Features, smallest first: palette, generators, board, cleanup, settings, capture, stuck, notes, vault, log, checklist, network, arsenal, manual, engagements, hosts | Med | tests, pixel diff at all widths | |
| 21–23 | payloads, credentials (TestGrid: sticky cells, snapping), findings | High | + manual QA of sticky/scroll | |
| 24 | report (TodoPanel, EvidenceRail, ReportTabs) | High | + page.css interplay | |
| 25 | src/ui/shadcn (sidebar, button, toggle, tabs, sheet, scroll-area, …) | High | + tw-animate replacements | |
| 26 | Remove Tailwind: preflight → `base.scss`, `@theme` → `:root`, drop packages, `cn`, `cva`, convention tests rewritten, DESIGN.md | Med | full suite, build, audit, pixel, manual QA | |

## Per-unit procedure

1. Resolve the unit's classes to the CSS Tailwind actually emits (variants, `--tw-*` interplay such as `leading-none`
   overriding a type role's line height).
2. Check every caller that passes `className` (or `width`) for utilities that used to lose to the component's own
   classes in Tailwind's emitted order; those now win. Drop such dead classes. Scan with a brace-aware parser: a
   `className` after a prop containing `{...}` is easy to miss.
3. Write the SCSS, switch the markup, drop no-op classes (`m-0`, `p-0` under preflight).
4. `npx tsc -b`, `npx eslint src`, `npx vitest run src`, `npm run audit:pixel` and `npm run audit:visual`.
5. Update the report.

## Known risks

- Convention tests and DESIGN.md are Tailwind-shaped until unit 26; until then they only guard unmigrated code.
- 112 test assertions name utilities; each is moved to a semantic class or attribute when its unit lands.
- The pixel diff covers the 76 audit screens at 900 px height, not every state; hover/focus and the `~empty|loading|error`
  states rely on the audit gate and tests.
- Preflight must be reproduced exactly before Tailwind goes (unit 26).

## Temporary Tailwind retention

Tailwind stays installed until unit 26 so migrated and unmigrated code coexist on the same tokens.

## Rollback

One commit per unit; reverting a commit restores that unit's utilities, and Tailwind is present until the end.
