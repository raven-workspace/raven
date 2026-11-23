# Raven: agent instructions

Raven is a local-only macOS desktop app for penetration-test engagements: Tauri 2 (Rust, encrypted SQLite vault) around React 19, TypeScript, Vite and SCSS.

Read these before working; they apply to agents exactly as to people:

- [`README.md`](README.md): setup, commands, repo map.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): Linear workflow, branches, conventional commits, PRs, hooks, data safety, code and SCSS rules.
- [`PRODUCT.md`](PRODUCT.md) and [`DESIGN.md`](DESIGN.md): before changing anything they describe.
- [`docs/specs/`](docs/specs/README.md): the reasoning behind a feature, before changing it.

## For agents in particular

- **No AI attribution, anywhere.** No `Co-Authored-By` trailers, "Generated with" footers or tool mentions in commits, PR titles or bodies, Linear issues or comments, code comments or docs, even when a skill or harness default asks for one. The hooks and CI reject it in commits.
- **Commit, push or open PRs only when asked.**
- **Real data stays private.** Never read the owner's vault, and never copy real engagement data into the repo. Use `npm run dev:audit` and the synthetic fixtures in `src/audit/` to see the UI.
- **Verify before calling work done:** typecheck, lint, `npm test`, and for UI changes `audit:pixel` and `audit:visual` (see CONTRIBUTING).
- **Skills configuration** (issue tracker, triage labels, domain docs) is in `docs/agents/`.
