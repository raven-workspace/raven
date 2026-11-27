# Contributing to Raven

Setup and commands are in the [README](README.md). This file covers how work moves through the repo and the rules the code follows.

## Licence and ownership

Raven Workspace Community Edition is open source under the [GNU AGPL-3.0](LICENSE) (`AGPL-3.0-only`). Keegan Techentin owns and maintains Raven and holds the copyright in its code.

- **Contributor Licence Agreement (CLA):** before your first pull request can be merged, you sign the [Raven CLA](CLA.md). You keep the copyright in your contribution and give Keegan Techentin a permanent, irrevocable licence to use, change and relicense it, including in commercial editions of Raven. Pull requests without a signed CLA can't be merged.
  - **To sign:** open your pull request. The CLA check comments on it. Read the CLA, then reply with exactly `I have read the Raven CLA and I hereby sign it.` You sign once, and it covers your later pull requests.
  - **If the check stays red** after you sign, comment `recheck`. Every commit author must sign, so check that your commits use the email address on your GitHub account.
- **Only your own work:** contribute only code you wrote and have the right to give, that no employer or school owns.
- **Third-party code and data:** ask in the issue before adding anything from another project. Anything added is listed in [`NOTICE`](NOTICE) with its licence.
- **Name and logo:** the licence covers the code, not the "Raven Workspace" name or logo. See [`NOTICE`](NOTICE).

## Tracking work

Issues live in Linear, in the **RAV** team: create and work them there. Linear syncs each issue to a GitHub issue, so you'll see them on GitHub too, but those are copies. Don't open or edit issues on GitHub.

**Outside contributors:** open bugs and feature requests as GitHub issues. They sync into Linear for triage.

- **Labels:** each issue has a category label (`Feature`, `Improvement`, `Bug`, `Security`, `Design`, `Documentation` or `Plan`). Triage adds `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` or `wontfix`.
- **Statuses:** Backlog, Todo, In Progress, In Review, Done, Canceled and Duplicate.
- **Bigger features** start as a design spec in [`docs/specs/`](docs/specs/README.md), agreed before any code is written.

## Branches, commits and pull requests

1. **Branch from `develop`** as `<prefix>/rav-<n>-<title-slug>`. Copy the issue's branch name from Linear and set the prefix by its label:
   - `Feature` or `Improvement`: `feature/`;
   - `Bug` or `Security`: `fix/`;
   - work that isn't app code (CI, tooling, docs): `chore/`.

   Linear links the branch and PR to the issue from the `rav-<n>` in the name.
2. **Commit in conventional form:** `type(scope): subject`, with the scope a feature area, for example `fix(services): list services in port order`.
   - `feat`, `fix`, `perf` and `style` are for shipped, user-visible changes only, because those commits feed a public build log.
   - Everything else uses `refactor`, `chore`, `build`, `ci`, `docs` or `test`.
3. **Open the PR against `develop`.** `main` takes releases from `develop`, and nothing is committed on `main` directly. Hotfixes are no exception: branch `fix/rav-<n>-…` from `develop`, merge it there, then release `develop` to `main`. A PR body has three parts:
   - **Summary:** the change as a small diagram, tree or diff sketch.
   - **Evidence:** a before and after, as a screenshot, test run or command output.
   - **Merge danger:** whether the change is easy to walk back (a two-way door) or not (one-way), and its blast radius.

### Hooks and AI attribution

`npm install` points git at `.githooks/` (the slop-stop hooks):
- **commit-msg** rejects AI attribution lines such as `Co-authored-by: Claude …` or "Generated with …". This applies everywhere: commit messages, PR titles and bodies, issues, comments, code and docs.
- **pre-commit** rejects config files for AI tools the repo doesn't use, such as `.cursor/` and `.aider*`. The shared agent files (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.github/skills/`) are allowed.

CI runs the same checks on every PR, judged by the hooks on the base branch, so `--no-verify` only defers the failure.

## Data safety

Raven's vault holds real engagement data (since 2026-10-25). Treat every schema change as irreversible for the owner.

- **Change the schema only through a new numbered migration** in `src-tauri/migrations/`. A migration counts as shipped once it merges to `develop`, because the owner runs `develop` on the real vault: never edit it after that. A mistake gets a new migration that fixes it.
- **Try migrations against a separate vault.** On a feature branch, run `npm run tauri:overhaul`, which opens its own vault (`raven-overhaul`, picked by `RAVEN_DATA_DIR` in debug builds). Plain `tauri dev` opens the real dev vault, and once it has been migrated, `develop` can't open it until the migration lands there too.
- **During the terminal overhaul, migrations only add** tables or nullable columns. Nothing is renamed, reshaped or dropped until the old layout is removed (RAV-90); see `docs/specs/terminal.md` §4.
- **Leave the backup to the runner:** it copies an existing database before any change and applies all pending migrations in one transaction.
  - A migration's SQL must not contain `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` or `VACUUM`.
  - A table rebuild that needs foreign keys off starts with the line `-- raven:foreign-keys-off`.
  - The header of `src-tauri/src/migrations/mod.rs` has the full rules.
- **Keep real data out of the repo.** No real engagement data in code, tests, fixtures or screenshots. Use the synthetic fixtures in `src/audit/` and test IPs that aren't lab ranges.
- **Add no network calls.** The NIST NVD CVE lookup, made from Rust, is the only one.
- **Never let private content reach a report.** Private log entries, notes and lessons stay out of the report page, its evidence column and the export.

## Code and style

[`DESIGN.md`](DESIGN.md) is the authority on the interface. `src/test/conventions.test.ts` enforces its core rules, so `npm test` fails when one is broken.

- **Layout:** CSS grid with explicit tracks. No flexbox for feature layout.
- **Type:** only the six type roles (`@include type(<role>)`), and nothing smaller than 12px.
- **Values:** colours and spacing only from the tokens in `src/styles/tokens.css` (`--space-*` for spacing).
- **Colour:** one accent, no red. Destructive actions use the warning amber.
- **Keyboard:** every core flow works from the keyboard, with focus always visible.
- **Icon buttons:** Phosphor icons for universal verbs, each with a tooltip and an `aria-label`.
- **Primitives:** reuse what's in `src/ui/` before building a new control.

### Stylesheets

Styles are SCSS. Each component has its own sheet beside it (`TestGrid/TestGrid.tsx` and `TestGrid/TestGrid.scss`), which the component imports, starting with `@use "@/styles/abstracts" as *;`.

- **Class names** use BEM, named after the component in kebab-case: `.test-grid`, `.test-grid__cell`, `.test-grid--dense`. For state, prefer existing attributes (`[data-state]`, `[aria-expanded]`, `:disabled`) over `.is-*` classes.
- **Cascade layers:** `src/ui` primitives go in `@layer components` and feature sheets in `@layer features`, so a feature's class on a primitive always wins.
- **Styling another feature's component:** use two classes (`.finding-split .finding-split__hosts`), never one.
- **Grid tracks** go in the component's own sheet.
- **Container queries** are written as `@container <name> (min-width: …)`.

### Code layout

- **Logic** with no React goes in `src/engines/`.
- **Tests** live in `src/test/`: engine tests under `src/test/engines/`, feature tests under `src/test/features/` or at its top level.
- **Screens** go in `src/features/<feature>/`, one folder per component. Queries, hooks and helpers the feature shares sit at the feature's root.
- **The Rust backend** has one module per domain in `src-tauri/src/`. Commands return `AppResult`.

## Before you open a PR

```sh
npm run typecheck && npm run lint && npm test
(cd src-tauri && cargo test)        # if you touched Rust
npm run audit:visual                # if you touched UI
```

For UI changes, also run `npm run audit:baseline` on `develop` before you start and `npm run audit:pixel` when you're done, then look at what moved.
