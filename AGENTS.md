# Raven

Raven is a local-only macOS desktop app for penetration-test engagements: a Tauri 2 shell (Rust backend, encrypted SQLite vault) around a React 19 + TypeScript + Vite frontend styled in SCSS. One user, the owner, preparing for the OSCP. Read `PRODUCT.md` for who it's for and what each feature does, and `DESIGN.md` for the visual system, before changing anything they cover.

## Commands

```sh
npm run tauri dev               # the desktop app
npm test                        # Vitest (includes the convention tests)
npm run typecheck               # tsc -b
npm run lint                    # ESLint
(cd src-tauri && cargo test)    # Rust tests
npm run audit:visual            # Playwright UI audit against synthetic stress data
npm run audit:pixel             # pixel diff against the baseline
```

Before calling UI work done, run typecheck, lint, `npm test`, `audit:pixel` and `audit:visual`.

## Layout

- `src/features/<feature>/<Component>/`: each feature component in its own folder with its `.scss`. Shared queries, hooks and helpers sit at the feature's root.
- `src/ui/`: shared primitives (Button, IconButton, Chip, Dialog, Kbd, …). Reuse them before writing new controls.
- `src/engines/`: pure logic (payloads, report, network, manual), no React.
- `src/styles/`: `tokens.css` is the single source of tokens; `abstracts/` holds shared SCSS (`@use "@/styles/abstracts" as *;`).
- `src-tauri/src/`: Rust commands, one module per domain; `src-tauri/migrations/`: numbered SQL migrations.
- `docs/superpowers/specs/` (design specs), `plans/`, `followups/`, `audits/`.

## Data safety

Since 2026-10-25 the vault holds real lab data.

- Every schema change is a new numbered migration in `src-tauri/migrations/`; never edit an applied one.
- The runner backs up an existing database before any change and runs all pending migrations in one transaction. A migration's SQL must not contain `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` or `VACUUM`. A table rebuild that needs foreign keys off starts with `-- raven:foreign-keys-off`. See the header of `src-tauri/src/migrations/mod.rs`.
- Never copy real engagement data into the repo, tests or fixtures. Use the synthetic fixtures in `src/audit/fixtures.ts`.
- The only runtime network call is the NIST NVD CVE lookup, from Rust. Don't add others.

## UI conventions

`DESIGN.md` is the authority; `src/test/conventions.test.ts` enforces the core rules. In short:

- Lay out with CSS grid and explicit tracks. No flex for feature layout.
- Only the six type roles (`@include type(role)`), nothing under 12px. Colours only from tokens, spacing only from `--space-*`.
- BEM classes named after the component (`.test-grid`, `.test-grid__cell`, `.test-grid--dense`). Feature rules go in `@layer features`, primitives in `@layer components`.
- One accent, no red: destructive actions use the warning amber.
- Keyboard first: every core flow works from the keyboard, with focus visible.
- Phosphor icon buttons for universal verbs, each with a tooltip and an `aria-label`.

## Git

- Branch from `develop`. Name branches `<prefix>/rav-<n>-<title-slug>` from the Linear issue (see `docs/agents/issue-tracker.md`).
- Conventional commits: `type(scope): subject`. Use `feat`, `fix`, `perf` or `style` only for shipped, user-visible work, since those appear in the public build log; use `refactor`, `chore`, `build`, `ci`, `docs` or `test` for everything else.
- No AI attribution anywhere: no `Co-Authored-By` trailers, "generated with" lines or tool mentions in commits, PRs, code comments or docs. The slop-stop hooks in `.githooks/` and CI reject them, and also reject AI tool files (`CLAUDE.md`, `AGENTS.md`, `.claude/`, …) in commits.
- Commit or push only when asked.

## Agent skills

The engineering skills' configuration (issue tracker, triage labels, domain docs) is in `docs/agents/`.
