# Tailwind inventory (src/ui and src/features)

Taken 2026-11-19, before the migration to SCSS started (`refactor/tailwind-to-scss`). Counts come from a scan of every
non-test `.ts`/`.tsx` file in scope; treat them as close, not exact.

## Setup

| Item | Value |
|---|---|
| Version | Tailwind 4.3.4 via `@tailwindcss/vite`. No `tailwind.config`, no PostCSS config. |
| Entry | `src/styles/global.css`: `@import "tailwindcss"`, `./tokens.css`, `tw-animate-css`, `shadcn/tailwind.css` |
| Theme | `src/styles/tokens.css`: `@theme inline` / `@theme static`. Every stock palette, shadow, blur, radius and font scale is reset to `initial`; only Ink tokens exist. |
| Directives | `@theme`, `@layer base` / `@layer utilities`, `@custom-variant dark` (always on: Raven is dark-only). No `@apply`. |
| Plugins / helpers | `tw-animate-css` (shadcn's `animate-in`, `fade-in-0`, `slide-in-from-*`); `shadcn/tailwind.css`; `class-variance-authority` (sidebar, button, toggle); `cn` (Tailwind conflict resolver, 13 files); `cx` (plain join, 68 files) |
| Plain CSS already | `src/features/report/page.css` (687 lines, the report page) and `src/dev/reportCompare.css` |
| Rules built on Tailwind | DESIGN.md's grid and spacing rules are written in Tailwind syntax; `src/test/conventionsRules.ts` (`tiny-type`, `feature-flex`, `unknown-color`, `off-scale-spacing`) parses Tailwind classes; 112 `toHaveClass(...)` assertions name utilities |
| Visual checks | `npm run audit:visual` (76 screens × widths, layout/a11y/ux gate); `npm run audit:baseline` / `audit:pixel` (pixel diff, added for this migration) |

## Usage

7,896 utility tokens in 202 of 274 files; about 124 template-literal class strings in 58 files build classes at runtime.

| Area | Tokens | Heaviest files |
|---|---:|---|
| features/report | 923 | TodoPanel 161, EvidenceRail 156, ReportTabs 105 |
| ui/shadcn | 730 | sidebar 329, button 98 |
| features/findings | 645 | FindingSteps 111, FindingEditor 86 |
| ui (Raven primitives) | 604 | TitleBar 79 |
| credentials, payloads, hosts, engagements, manual | 505–578 each | TestGrid 219, SqlPanel 148, ActiveCard 108 |
| arsenal, network, checklist, log | 215–434 each | PathTree 171, ArsenalBrowse 136 |
| vault, notes, stuck, capture, settings, cleanup, board, generators, palette | 65–163 each | StuckView 157 |

- **Most used:** `grid` 698, `text-meta` 388, `m-0` 356 (a no-op under preflight), `grid-cols-[…]` 254, `text-muted` 234,
  `gap-2` 228, `items-center` 198, `min-w-0` 133, `truncate` 114, `border-line` 107.
- **Variants:** `hover` 119, `focus-visible` 64, `disabled` 26, `after`/`before` 31, `first`/`last` 32, `motion-reduce`
  11; Radix/shadcn `data-[state|side|…]`, `aria-*`, `has-[…]`, `[&_svg]`, `in-data-[slot=…]`.
- **Responsive:** window `min-[1100px]` 15, `max-[1099px]` 3; `md:` 4 (shadcn only). Container queries in 10 files
  (`@container/host`, `/steps`, `/report`, `/ctx`; 26rem, 30rem, 480, 700, 760, 900px). Named groups: `group/nt` (24),
  `group/menu`, `group/toggle`, `group/sidebar`, `group/button`, `peer/menu`.
- **Arbitrary values:** 429 uses, 202 distinct; mostly grid tracks (`[minmax(0,1fr)_auto]` 52, `[minmax(0,1fr)]` 27,
  `[auto_minmax(0,1fr)]` 18), the accent bar `shadow-[inset_2px_0_0_var(--accent)]` 12, the popover shadow 6, `ch`
  widths, dialog sizes.
- **`!important` (11):** shadcn sidebar icon-collapse (6), `text-faint!`, `focus:text-fg!`,
  `group-data-[dropped=low]/nt:hidden!`, ScrollArea viewport `block!` (2).
- **Dead classes:** a class whose scale was reset (`rounded-xl`) generates nothing; a class that loses to a later
  utility in Tailwind's order does nothing. Both are dropped, not converted.

## Implied tokens

| Group | Values |
|---|---|
| Colour | `--bg --fg --fg-2 --muted --muted-2 --faint --line --line-2 --line-strong --surface --surface-hi --accent --warn` (+ shadcn aliases) |
| Spacing | 4, 8, 12, 16, 24, 32px |
| Control size | 28px (`h-7`/`min-h-7`, 62 uses), 20px key cap, 16px icon |
| Radius | 8px `--radius`, 6px `--radius-sm`; `[4px]`, `[2px]`, full |
| Type | roles `title heading body code meta label read read-title`, `--font-ui`, `--font-mono`, tracking 0.08em |
| Shadow | accent bar, popover |
| Z-index | 10, 20, 30, 40, 50, and one `5` |
| Motion | 100/150/180/200ms, `cubic-bezier(0.16,1,0.3,1)`, keyframes in global.css, JS timings in `src/ui/motion.ts` |
| Breakpoints | window 1100px; containers above |
