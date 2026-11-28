# Raven

Raven is a local-only desktop app for penetration testers, on macOS and on Linux (Kali). You keep one engagement in it from start to finish: hosts and services, every command and screenshot as you take it, checklists that tick themselves from what you logged, credentials, findings, a command library with your values filled in, and the exam report written from that record.

It's built for one person preparing for the OSCP and doing lab and client work afterwards, so it's keyboard-first, fast to capture into, and quiet on screen. `PRODUCT.md` describes who it's for and every feature in detail.

Everything stays on the machine. Data lives in an encrypted SQLite vault unlocked by a password, and the only network call is an optional NIST NVD lookup for CVE details.

## Getting started

You need Node 22 with npm and Rust stable (through rustup), on macOS or Linux. On macOS, also the Xcode Command Line Tools. On Kali or another Debian-based Linux, also Tauri's WebKitGTK build packages:

```sh
sudo apt install build-essential file libayatana-appindicator3-dev librsvg2-dev libssl-dev libwebkit2gtk-4.1-dev libxdo-dev
```

```sh
npm install            # also points git at the repo's hooks in .githooks/
npm run tauri dev      # build and open the desktop app
npm run tauri:overhaul # the new workspace shell, with its own vault and port (1430), so it runs beside tauri dev
```

On first launch Raven asks you to create a vault password. The vault lives under `~/Library/Application Support/app.raven.desktop/` on macOS and `~/.local/share/app.raven.desktop/` on Linux: in `raven-dev/` for `tauri dev`, `raven-overhaul/` for `tauri:overhaul`, and `raven/` for a release build. It's yours and never leaves the machine. A newer schema can't be opened by older code, so run work in progress with `tauri:overhaul`, never against the vault you use for real work.

### Installing on Kali

CI builds a `.deb` for amd64 and arm64 on every push to `develop` (pull requests only check that the app builds). For another branch, start CI by hand from the Actions tab (CI, Run workflow). Open the run in the repo's Actions tab, download `raven-deb-amd64` or `raven-deb-arm64` (arm64 for Kali in a VM on Apple Silicon; `dpkg --print-architecture` tells you which), unzip it, and install it with apt, which pulls in WebKitGTK:

```sh
cp raven-workspace_*.deb /tmp/   # apt's _apt user can't read your home folder on Kali
sudo apt install /tmp/raven-workspace_*.deb
raven-workspace        # or Raven Workspace in the applications menu
```

On Linux the package, the program and its menu entry are all `raven-workspace`, because `raven` is already taken on Kali. To build the `.deb` yourself, run `npx tauri build` on the Linux machine; it lands in `src-tauri/target/release/bundle/deb/`. On Linux, Raven keeps the desktop's own title bar.

You don't need the desktop app or a vault to work on most of the UI:

```sh
npm run dev:audit      # the UI in a browser at http://localhost:5199, with a fake backend and synthetic data
```

Audit mode serves the same React app against an in-memory backend (`src/audit/fakeApi.ts`) filled with stress fixtures (`src/audit/fixtures.ts`). In any dev build, `/__ui` shows the shared UI primitives.

The fake and the real store must pass the same [store scenarios](src/test/storeScenarios/README.md), so the fake can't drift from the store. New UI tests run on the fake through [`src/test/support/fakeStore.tsx`](src/test/support/fakeStore.tsx).

## Checking your work

```sh
npm test                        # Vitest, including the convention tests
npm run typecheck               # tsc -b
npm run lint                    # ESLint
(cd src-tauri && cargo test)    # Rust tests
npm run audit:visual            # Playwright audit of every screen at four widths
npm run audit:baseline          # record a local pixel baseline (before a UI change)
npm run audit:pixel             # pixel diff against that baseline (after it)
npm run notices                 # rewrite THIRD_PARTY_NOTICES after a dependency change (needs cargo-about)
```

The visual audit and its pass/fail rules are described in [`audit/README.md`](audit/README.md).

## Repo map

```text
src/
├── features/<feature>/   # screens and their parts; each component in its own folder with its .scss
├── ui/                   # shared primitives: Button, IconButton, Chip, Dialog, Kbd, …
├── engines/              # pure logic with no React: payloads, report drafting, parsers, checklist rules
├── styles/               # tokens.css (the one source of design tokens) and shared SCSS
├── audit/                # fake backend and synthetic fixtures for audit mode
└── test/                 # Vitest tests, including conventions.test.ts
src-tauri/
├── src/                  # Rust backend: one module per domain, the vault, migrations
├── migrations/           # numbered SQL migrations
└── about.toml            # the licence allow-list for every dependency, Rust and npm
audit/                    # Playwright visual audit
third-party/              # licences of built-in code no package manager lists, for THIRD_PARTY_NOTICES
docs/
├── specs/                # design specs per feature round, with the reasoning behind them
├── design/               # design hand-offs: the plan for a layout, not the app as it is
└── agents/               # issue tracker and triage conventions
```

## Documentation

| Read | For |
|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How work is tracked, branched, committed and reviewed; code, style and data-safety rules |
| [`PRODUCT.md`](PRODUCT.md) | Who Raven is for, what each feature does, the rules marked binding that the code must keep, and the product principles |
| [`DESIGN.md`](DESIGN.md) | The Ink design system: tokens, type roles, layout rules, do's and don'ts (full version in `.impeccable/design-full.md`) |
| [`docs/specs/`](docs/specs/README.md) | Why features work the way they do |
| [`docs/design/workspace-ide/`](docs/design/workspace-ide/README.md) | The IDE layout's design hand-off: Specs 1–3 (design spec §), mockups, and `rendered/` for visual checks |
| [`AGENTS.md`](AGENTS.md) | Instructions for AI coding agents working in the repo |

## Licence

Raven Workspace Community Edition is licensed under the [GNU AGPL-3.0](LICENSE) (`AGPL-3.0-only`). Copyright (C) 2026 Keegan Techentin. Trademark and third-party notices are in [`NOTICE`](NOTICE), and the licences of every dependency Raven ships are in [`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES), which the app also shows under Settings, About. Before contributing, read [Licence and ownership](CONTRIBUTING.md#licence-and-ownership).
