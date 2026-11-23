# Raven

Raven is a local-only macOS desktop app (Tauri 2, React, TypeScript) for managing penetration-test engagements. Data is stored in an encrypted local database; the app makes no network calls at runtime.

## Development

```sh
npm install
npm run tauri dev      # run the desktop app
npm test               # frontend tests (Vitest)
npm run typecheck      # tsc -b
npm run lint           # ESLint
(cd src-tauri && cargo test)   # Rust tests
```

Requires Node 22, npm, and Rust stable (via rustup).

`npm install` also points git at the hooks in `.githooks/` (slop-stop): they reject AI attribution in commit
messages and other AI tools' files (`.cursor/`, `.aider*` and the like) in commits. Claude Code and Codex files
(`.claude/`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`) are allowed: they carry the shared agent instructions. The same check
runs on every pull request, so `--no-verify` only defers the failure.
