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
- **UI work starts from the Figma frames.** Before writing UI code, open the frames the issue or spec links in the [Raven Workspace](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace) Figma file (the frame map is in `docs/specs/terminal.md`), and match them. Read them through the Figma MCP: `create_session` with file key `Z49qXmfYnFfPxk3qhECLme`, then `get_design_context` and `get_screenshot` on the node id. Take sizes, colours and text from the design context. The Host View artboard (1-2612) renders with some text missing (the host name "forge" in the Explorer and host header, the Next work tab), because many of its text layers have zero height in the file. So use its screenshots for layout only, and check the shared areas (chrome bar, rail, Explorer, terminal panel, status bar) against the Log entry tab artboard (1-2187), which renders completely. If a UI issue links no frame, stop and ask.
- **Verify before calling work done:** typecheck, lint, `npm test`, and for UI changes `audit:pixel` and `audit:visual` (see CONTRIBUTING).
- **Skills configuration** (issue tracker, triage labels, domain docs) is in `docs/agents/`.
