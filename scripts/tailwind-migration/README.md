# Tailwind → SCSS migration helpers

Temporary tools for the migration in [docs/tailwind-to-css-plan.md](../../docs/tailwind-to-css-plan.md). They go when
Tailwind does (unit 26). Run them from the repo root.

- `node scripts/tailwind-migration/twcss.mjs "<classes>"` prints the CSS Tailwind emits for those classes under Raven's
  theme, in emitted order. Convert from this, not from memory: `hover:` sits in `@media (hover: hover)`, `leading-none`
  overrides a type role's line height, a reset scale (`shadow-lg`, `rounded-xl`) emits nothing.
- `node scripts/tailwind-migration/twdead.mjs "<component classes>" "<caller classes>"` lists caller classes that are
  dead: a component class sets the same property under the same condition later in Tailwind's order, so it won. Under
  the SCSS layering the caller's utility would start winning, so a dead class must be removed, not kept.
- `python3 scripts/tailwind-migration/callers.py Button,Chip` prints, as JSON, every `className` passed to those
  components (brace-aware, with the variant/size/tone props seen on the same tag).
- `python3 scripts/tailwind-migration/prune_imports.py` removes imports `tsc -b` reports as unused (TS6133), then
  prints what `tsc -b` still reports.
