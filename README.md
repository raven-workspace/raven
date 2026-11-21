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
messages and AI tool files (`.claude/`, `CLAUDE.md`, `.cursor/` and the like) in commits. The same check runs on every
pull request, so `--no-verify` only defers the failure.
