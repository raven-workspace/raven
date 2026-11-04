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
