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
- **Move your issue to In Progress when you start.** Before anything else, set it with `orca linear status set --current --to "In Progress"` (outside a linked Orca worktree, pass `RAV-<n>` instead of `--current`). Do this only from Backlog or Todo; if the issue is already started, done or canceled, leave it.
- **Real data stays private.** Never read the owner's vault, and never copy real engagement data into the repo. Use `npm run dev:audit` and the synthetic fixtures in `src/audit/` to see the UI.
- **UI work starts from the design hand-off** in [`docs/design/workspace-ide/`](docs/design/workspace-ide/README.md). Read the spec section the issue cites first (the folder's README maps each design spec § to its spec file and heading); the specs win any conflict. Then read the matching `.dc.html` mockup for structure. Build with the repo's own `src/ui` components and tokens, never by copying the mockup's markup. For the PR's Evidence, screenshot the `rendered/` mockup beside `audit:visual` at 1440px. Compare screenshots at 1440px only: the rendered mockups only squeeze at 1100px, so 1100px behaviour comes from the spec text (Spec 1, "At 1100px, the minimum"). The folder is the plan, not the app as it is. If a UI issue cites no spec section, stop and ask.
- **File open questions; don't decide them.** When you find a question your issue doesn't settle and it doesn't block the work, leave the behaviour as it is and file it as its own RAV issue: one question per issue, labelled `needs-triage` and `open-question`, related to the issue you're working on. The body gives the question, how the app behaves now, what the spec and the mockup say or leave out, and the options if there are any; [RAV-98](https://linear.app/raven-workspace-app/issue/RAV-98) and [RAV-99](https://linear.app/raven-workspace-app/issue/RAV-99) are the model. List the filed issues in the PR body and keep going. A question that does block the work still stops you: ask the owner.
- **Verify before calling work done:** typecheck, lint, `npm test`, and for UI changes `audit:pixel` and `audit:visual` (see CONTRIBUTING).
- **Skills configuration** (issue tracker, triage labels, domain docs) is in `docs/agents/`.
