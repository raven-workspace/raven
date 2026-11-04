# Raven Step 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a macOS Tauri app you can open with `npm run tauri dev`. It has:
- a password-unlocked, SQLCipher-encrypted database;
- versioned migrations with a backup taken first;
- automatic and manual encrypted backups, and restore;
- auto-lock;
- the Ink design system;
- an Engagements dashboard where engagements can be created, edited, archived and deleted.

**Architecture:**
- **Rust (`src-tauri/`):** owns the database file, the key and every query, and exposes a small set of Tauri commands.
- **React (`src/`):** talks to Rust only through one typed `api` module. That keeps UI tests free of Tauri: they mock `api`.
- **Server state:** TanStack Query.
- **UI-only state:** local React state, or a small Zustand store where it's shared.

**Tech Stack:**
- **App:** Tauri 2, React 19, TypeScript, Vite.
- **Styling:** Tailwind CSS v4 (utilities only, styled through our tokens).
- **Libraries:** TanStack Query, React Router 7, Radix UI primitives (unstyled; dialog, select).
- **Tests:** Vitest with Testing Library.
- **Rust crates:** `rusqlite` (feature `bundled-sqlcipher-vendored-openssl`), `argon2`, `rand`, `zeroize`, `serde`, `thiserror`, `uuid`, `tempfile` (dev).
- **Fonts:** `@fontsource-variable/jetbrains-mono`, bundled locally.

**Spec:** `docs/superpowers/specs/2026-11-03-raven-desktop-design.md`. This plan covers §10 build step 1, plus the §3, §4 and §8 foundations it needs.

## Global Constraints

- **Local only.** No network calls at runtime: no CDN fonts, no telemetry, no update checks. Bundle every asset.
- **Platform.** macOS (arm64) only. No browser build and no browser-mode fallback. The UI is viewed through `npm run tauri dev`.
- **Data directories.** Debug builds use `<app data dir>/raven-dev/`. Release builds use `<app data dir>/raven/`. Dev must never touch the release data.
- **Bundle identifier:** `app.raven.desktop`. **Product name:** `Raven`.
- **Encryption.**
  - The database file is unreadable without the password.
  - The key is derived with Argon2id: m = 65536 KiB, t = 3, p = 1, 32-byte output, 16-byte random salt.
  - The salt and parameters live in `vault.json` next to the database file.
  - Minimum password length: 12 characters.
  - The password can't be recovered.
- **Backups.**
  - A backup is an encrypted copy that opens only with the same password.
  - One is taken before every migration that changes an existing database, daily on unlock, and on demand.
  - Default retention is 14 (newest kept).
  - A backup taken in the current operation is never pruned by that same operation.
- **Auto-lock.** Default 30 minutes of no keyboard or pointer input. Locking drops the database connection and zeroizes the key.
- **Visual design: Ink (spec §8).**
  - Background `#000`. Text `#ffffff` / `#e8e8e8`. Secondary text `#8a8a8a`–`#a8a8a8`. Hairlines `#1f1f1f`–`#2a2a2a`.
  - The only accent is `#c6ff00`, used only for meaning (selection marker, held access, confirmed, focus).
  - Flat surfaces: no gradients, glows, glass or decorative shadows.
  - UI type: system sans (`-apple-system, "SF Pro Text", system-ui`). Monospace: JetBrains Mono for IPs, commands, timestamps.
  - Labels: small, uppercase, letter-spacing 0.12em.
  - No stock component-library styling may show through.
- **Real data.** Never open `a file outside the repo` in this step. Tests use synthetic data only.
- **Versions.** Node 22 and npm. Rust stable, installed through rustup.

## Review Focus

1. **Wrong password at unlock.** It shows an inline "Wrong password" and leaves the database file and `vault.json` byte-for-byte unchanged. Test: `unlock_wrong_password_leaves_files_untouched` (Task 2).
2. **A migration fails halfway.** The database stays at its old version with its old data, and the pre-migration backup exists and opens. Test: `failed_migration_rolls_back_and_keeps_backup` (Task 3).
3. **Auto-lock while the engagement dialog has unsaved input.** The app locks; after unlocking, nothing was saved half-way and no error appears. Test: `autolock_with_open_dialog_discards_draft_cleanly` (Task 7).
4. **Retention would delete the backup just taken,** e.g. retention set to 1 with older backups present. The new backup survives and older ones are pruned. Test: `retention_never_prunes_backup_from_current_operation` (Task 4).
5. **An invalid scope CIDR, or a timebox on a non-exam engagement.** The first is rejected with a field-level message. The second isn't offered or stored. Tests: `create_rejects_invalid_cidr` (Task 5) and `timebox_fields_only_for_exam_sim` (Task 8).

---

### Task 0: Toolchain and scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src-tauri/**` (Tauri 2 scaffold), `eslint.config.js`, `vitest.config.ts`, `src/test/setup.ts`.
- Modify: `.gitignore` (add `node_modules/`, `dist/`, `src-tauri/target/`; keep `.superpowers/`), `README.md` (one paragraph plus dev commands).

**Interfaces:**
- Produces:
  - npm scripts `dev`, `build`, `tauri`, `test` (`vitest run`), `lint`, `typecheck` (`tsc -b`);
  - `cargo test` runs from `src-tauri/`.

- [ ] **Step 1: Install the Rust toolchain.**
  - Run: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`.
  - Expected: `rustc --version` prints a stable version.
  - Xcode Command Line Tools are already installed at `/Library/Developer/CommandLineTools`.
- [ ] **Step 2: Scaffold Tauri 2 with React + TS into the existing repo.**
  - Generate into a temp dir with `npm create tauri-app@latest raven -- --template react-ts --manager npm --yes`, then move the contents into the repo root.
  - Keep the existing `README.md`, `docs/` and `.gitignore` entries.
  - Set `productName: "Raven"`, `identifier: "app.raven.desktop"`, window title `Raven`, min size 1100×700, `titleBarStyle: "Overlay"` with `hiddenTitle: true`.
- [ ] **Step 3: Add the libraries.**
  - npm: Tailwind v4 (`@tailwindcss/vite`), Vitest, jsdom, Testing Library (`react`, `user-event`, `jest-dom`), TanStack Query, React Router 7, `@radix-ui/react-dialog`, `@radix-ui/react-select`, Zustand, `@fontsource-variable/jetbrains-mono`, ESLint (typescript-eslint, react-hooks).
  - Rust crates as listed in the Tech Stack.
- [ ] **Step 4: Write a smoke test** in `src/test/smoke.test.tsx`: `renders app root` renders `<App />` and expects `screen.getByTestId('app-root')`.
- [ ] **Step 5: Verify everything runs.**
  - Run: `npm test && npm run typecheck && npm run lint && (cd src-tauri && cargo test)`. Expected: all pass. The first cargo build takes several minutes.
  - Run: `npm run tauri dev`. Expected: a native window titled Raven opens.
- [ ] **Step 6: Commit.**
  - `git add -A && git commit -m "chore: scaffold Tauri 2 + React app"`

### Task 1: Error type and data paths (Rust)

**Files:**
- Create: `src-tauri/src/error.rs`, `src-tauri/src/paths.rs`.
- Test: inline `#[cfg(test)]` modules.

**Interfaces:**
- Produces:
  - `pub enum AppError { Locked, WrongPassword, VaultExists, NoVault, NotFound, Validation { field: String, message: String }, Io(String), Db(String) }`.
  - It serializes to JSON `{ "code": "locked" | "wrong_password" | "vault_exists" | "no_vault" | "not_found" | "validation" | "io" | "db", "message": string, "field"?: string }`.
  - `pub type AppResult<T> = Result<T, AppError>`.
  - `pub struct DataPaths { pub root: PathBuf, pub db: PathBuf, pub vault_meta: PathBuf, pub backups: PathBuf }`
  - `DataPaths::for_root(root: PathBuf) -> DataPaths` returns `db = root/raven.db`, `vault_meta = root/vault.json`, `backups = root/backups/`.
  - `DataPaths::resolve(app: &AppHandle) -> AppResult<DataPaths>` uses `app_data_dir()/raven-dev` in debug and `/raven` in release, and creates the dirs.

- [ ] **Step 1: Write failing tests.**
  - `error_serializes_with_code`: serializing `AppError::Validation{field:"scope".into(), message:"bad".into()}` gives `{"code":"validation","message":"bad","field":"scope"}`.
  - `paths_for_root_layout`: `DataPaths::for_root("/x".into()).db == "/x/raven.db"`.
- [ ] **Step 2:** Run `cd src-tauri && cargo test error_ paths_`. Expected: FAIL.
- [ ] **Step 3:** Implement. `From<rusqlite::Error>` and `From<std::io::Error>` map to `Db` and `Io`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): app error type and data paths`.

### Task 2: Vault (key derivation, create, unlock, lock)

**Files:**
- Create: `src-tauri/src/vault.rs`.
- Test: `src-tauri/src/vault.rs` (tests module).

**Interfaces:**
- Consumes: `DataPaths`, `AppError` (Task 1).
- Produces:
  - `pub struct VaultMeta { version: u32 /*1*/, kdf: "argon2id", m_kib: u32, t: u32, p: u32, salt_hex: String }`, persisted as `vault.json`.
  - `pub struct Vault { paths: DataPaths, conn: Option<rusqlite::Connection>, key: Option<Zeroizing<[u8;32]>> }`.
  - `Vault::new(paths) -> Vault`
  - `vault.exists() -> bool`: both the db and `vault.json` are present.
  - `vault.is_unlocked() -> bool`
  - `vault.create(password: &str) -> AppResult<()>`
    - `Validation{field:"password"}` if the password is under 12 characters.
    - `VaultExists` if a vault exists.
    - Otherwise writes `vault.json`, creates the encrypted db, and leaves the vault unlocked.
  - `vault.unlock(password: &str) -> AppResult<()>`
    - `NoVault` if none exists.
    - `WrongPassword` if verification (`SELECT count(*) FROM sqlite_master`) fails.
  - `vault.lock()`: drops the connection and zeroizes the key.
  - `vault.conn() -> AppResult<&rusqlite::Connection>`: `Locked` when locked.
  - `vault.key_pragma() -> AppResult<String>`: for backups (Task 4).
  - The key is applied with `PRAGMA key = "x'<64 hex>'"`, a raw key, so SQLCipher doesn't run its own KDF.
  - Tests may set `VaultMeta` params to m = 8 KiB, t = 1 through a `#[cfg(test)]` constructor so they stay fast.

- [ ] **Step 1: Write failing tests** (each uses `tempfile::tempdir()`):
  - `create_then_unlock_roundtrip`: create with `"correct horse battery"`, lock, unlock with the same password; `is_unlocked()` is true.
  - `create_rejects_short_password`: `"short"` gives `Validation{field:"password"}`.
  - `create_twice_errors`: the second create gives `VaultExists`.
  - `unlock_wrong_password_leaves_files_untouched`: hash `raven.db` and `vault.json` bytes, unlock with a wrong password, expect `WrongPassword`; the hashes are unchanged.
  - `db_file_is_not_plain_sqlite`: after create, the first 16 bytes of `raven.db` are not `"SQLite format 3\0"`.
  - `locked_conn_errors`: after `lock()`, `conn()` gives `Locked`.
- [ ] **Step 2:** Run `cargo test vault`. Expected: FAIL.
- [ ] **Step 3:** Implement `vault.rs`.
- [ ] **Step 4:** Run `cargo test vault`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): encrypted vault with argon2id key`.

### Task 3: Migrations with backup-first

**Files:**
- Create: `src-tauri/src/migrations/mod.rs`, `src-tauri/migrations/0001_init.sql`.
- Modify: `src-tauri/src/vault.rs`. `create` and `unlock` run migrations after opening.

**Interfaces:**
- Consumes: `Vault`, and `backup::take(vault, reason) -> AppResult<BackupInfo>` from Task 4. In this task, call it through a `BackupHook` closure parameter so the task can be tested before Task 4 exists. Task 4 wires in the real function.
- Produces:
  - `pub const MIGRATIONS: &[(u32, &str)]`: version and embedded SQL via `include_str!`.
  - `pub fn migrate(conn: &mut Connection, hook: &mut dyn FnMut(u32, u32) -> AppResult<()>) -> AppResult<MigrationOutcome>`, where `MigrationOutcome { from: u32, to: u32 }`.
    - Reads `PRAGMA user_version`.
    - If it's behind and the db already has user tables (an existing database), it calls `hook(from, to)` first, so the backup happens before any change.
    - Then it applies every pending migration plus `PRAGMA user_version = n` inside **one** transaction.
  - **Schema `0001_init.sql`:**
    - `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`
    - `engagements(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('exam-sim','lab','client')), client TEXT, sub_label TEXT, scope_cidrs TEXT NOT NULL DEFAULT '[]', domain TEXT, starts_at INTEGER, ends_at INTEGER, timebox_start INTEGER, timebox_minutes INTEGER, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_activity_at INTEGER)`
    - Times are Unix milliseconds (UTC).

- [ ] **Step 1: Write failing tests.**
  - `fresh_db_migrates_to_latest_without_backup`: on a new db, the hook isn't called and `user_version == MIGRATIONS.last().0`.
  - `existing_db_calls_backup_hook_before_change`: start from a db at version 1 with a row, plus a test-only migration 2. The hook is called exactly once, with (1, 2), and at that moment `user_version` is still 1.
  - `failed_migration_rolls_back_and_keeps_backup`: a test-only migration 2 with invalid SQL gives `Db`. `user_version` stays 1, the row is still there, and the hook was called.
  - `migrate_is_idempotent`: a second `migrate` returns `from == to` and doesn't call the hook.
- [ ] **Step 2:** Run `cargo test migrat`. Expected: FAIL.
- [ ] **Step 3:** Implement. Allow tests to pass a custom migration list (`migrate_with(conn, list, hook)`).
- [ ] **Step 4:** Run `cargo test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): versioned migrations with backup-first hook`.

### Task 4: Backups (take, list, retention, daily, restore)

**Files:**
- Create: `src-tauri/src/backup.rs`.
- Modify: `src-tauri/src/vault.rs` (connect the migration hook to `backup::take(.., "pre-migration")`; take a daily backup in `unlock`).

**Interfaces:**
- Consumes: `Vault`, `DataPaths`, settings key `backup_retention` (default 14).
- Produces:
  - `pub struct BackupInfo { file: String, reason: String, created_at: i64, size_bytes: u64 }`. `reason` is one of `"manual" | "daily" | "pre-migration" | "pre-restore"`; later steps add `"pre-import"`.
  - The file name pattern is `raven-<yyyyMMdd-HHmmss>-<reason>.db`, in `backups/`.
  - `take(vault: &Vault, reason: &str) -> AppResult<BackupInfo>`
    - Writes an encrypted copy with the same key. `VACUUM INTO` or the online backup API with the key set on the destination; the builder picks whichever passes `backup_is_encrypted_and_opens_with_key`.
    - Then prunes to the retention count. The file just written is never pruned.
  - `list(paths) -> AppResult<Vec<BackupInfo>>`: newest first. Parsed from file names and metadata, so it works while locked.
  - `take_daily_if_due(vault) -> AppResult<Option<BackupInfo>>`: takes a backup if the newest backup with any reason is older than 24h, or none exists.
  - `restore(vault: &mut Vault, file: &str) -> AppResult<()>`
    - Requires the vault to be unlocked.
    - Takes a `"pre-restore"` backup.
    - Locks.
    - Copies the chosen backup over `raven.db` atomically (write a temp file, then rename).
    - Leaves the vault locked. The user unlocks with their password, and the backup's own migrations run on unlock.
    - A `file` containing a path separator or `..` gives `Validation{field:"file"}`.

- [ ] **Step 1: Write failing tests.**
  - `backup_is_encrypted_and_opens_with_key`: the backup's header isn't plain SQLite. Opening it with the vault key reads the engagement row. Opening it with a wrong key fails.
  - `retention_never_prunes_backup_from_current_operation`: with retention 1 and 3 older backups, `take` leaves exactly one file, the new one.
  - `daily_backup_only_when_due`: with a backup created 1h ago, `None`. With 25h ago (set the mtime, or inject a clock), `Some`.
  - `restore_replaces_db_and_locks`:
    1. Create row A.
    2. Back up.
    3. Create row B.
    4. Restore the backup.
    5. The vault is locked.
    6. Unlock.
    7. Only row A exists, and a `pre-restore` backup is listed.
  - `restore_rejects_path_traversal`: `"../x.db"` gives `Validation`.
- [ ] **Step 2:** Run `cargo test backup`. Expected: FAIL.
- [ ] **Step 3:** Implement. Inject a clock (`now_ms: impl Fn() -> i64`) for the tests.
- [ ] **Step 4:** Run `cargo test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): encrypted backups, retention, daily and restore`.

### Task 5: Settings and engagements repositories plus Tauri commands

**Files:**
- Create: `src-tauri/src/settings.rs`, `src-tauri/src/engagements.rs`, `src-tauri/src/commands.rs`.
- Modify: `src-tauri/src/lib.rs` (state `Mutex<Vault>`, register commands).

**Interfaces:**
- Produces Rust:
  - `Settings { auto_lock_minutes: u32 /*default 30, 1..=240*/, backup_retention: u32 /*default 14, 1..=200*/ }`, with `get`/`update`.
  - `Engagement` with serde `camelCase`, fields matching the `engagements` columns, plus `scope_cidrs: Vec<String>`.
  - `EngagementInput { name, kind, client?, sub_label?, scope_cidrs, domain?, starts_at?, ends_at?, timebox_start?, timebox_minutes? }`.
  - **Validation:**
    - `name` trimmed and non-empty, at most 120 characters;
    - each CIDR is a valid IPv4 CIDR (`a.b.c.d/0-32`) or a bare IPv4, otherwise `Validation{field:"scopeCidrs"}`;
    - `ends_at >= starts_at`;
    - the timebox fields are forced to null unless `kind == "exam-sim"`;
    - `timebox_minutes` is in 1..=4320.
  - `list() -> Vec<Engagement>` is ordered by `status` (active first), then `coalesce(last_activity_at, updated_at)` descending.
  - `create`, `update(id, input)`, `set_status(id, status)`, and `delete(id)` (`NotFound` if missing).
  - Ids are UUID v4 strings.
- **Tauri commands** (all names snake_case; every one returns `Result<_, AppError>`):

  | Command | Notes |
  |---|---|
  | `vault_status -> { exists, unlocked }` | |
  | `vault_create(password)` | |
  | `vault_unlock(password) -> { migratedFrom: u32, migratedTo: u32, dailyBackup: Option<BackupInfo> }` | |
  | `vault_lock` | |
  | `settings_get`, `settings_update(patch)` | |
  | `backup_now`, `backups_list`, `backup_restore(file)` | |
  | `engagements_list`, `engagement_get(id)`, `engagement_create(input)`, `engagement_update(id, input)`, `engagement_set_status(id, status)`, `engagement_delete(id)` | |

- [ ] **Step 1: Write failing Rust tests.**
  - `create_and_list_engagement`
  - `create_rejects_invalid_cidr`: `["10.0.0.0/33"]` gives `Validation{field:"scopeCidrs"}`; `["10.0.0.0/24","10.0.0.5"]` passes.
  - `timebox_dropped_for_non_exam_kinds`: a `lab` with `timebox_minutes = 60` is stored with null.
  - `list_orders_active_first`
  - `delete_missing_is_not_found`
  - `settings_defaults_and_bounds`: defaults are 30 and 14; `auto_lock_minutes = 0` gives `Validation`.
  - `commands_error_when_locked`: `engagements_list` on a locked vault gives `Locked`. Test the inner function, not through Tauri.
- [ ] **Step 2:** Run `cargo test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Command functions are thin wrappers around testable `fn`s that take `&mut Vault`.
- [ ] **Step 4:** Run `cargo test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): settings, engagements and tauri commands`.

### Task 6: Typed api module and Ink design system

**Files:**
- Create:
  - `src/lib/api.ts`
  - `src/types/{engagement,settings,backup,errors}.ts`
  - `src/styles/tokens.css`, `src/styles/global.css`
  - `src/ui/{Button,Input,Textarea,Select,Chip,Label,Field,Panel,Dialog,Kbd,EmptyState}.tsx`
  - `src/ui/index.ts`
  - `src/test/ui.test.tsx`
- Modify: `src/main.tsx` (import global styles and fonts, QueryClientProvider, Router).

**Interfaces:**
- Produces:
  - `api` exposes one function per Tauri command, with camelCase names (`api.vaultStatus()`, `api.engagementCreate(input)`, …). Each calls `invoke`, and on a rejection throws `RavenError extends Error { code, field? }` built from the `AppError` JSON.
  - TS types mirror the Rust ones: `Engagement`, `EngagementInput`, `EngagementKind = 'exam-sim'|'lab'|'client'`, `Settings`, `BackupInfo`.
  - **Tokens** (CSS variables), also exposed to Tailwind v4 through `@theme`:
    - `--bg #000`, `--fg #ffffff`, `--fg-2 #e8e8e8`, `--muted #8a8a8a`, `--muted-2 #a8a8a8`, `--faint #5c5c5c`
    - `--line #1f1f1f`, `--line-2 #2a2a2a`, `--surface #0b0b0b`, `--surface-hi #111111`
    - `--accent #c6ff00`, `--warn #e0a030`
    - `--radius 8px`, `--radius-sm 6px`
    - `--font-ui -apple-system, "SF Pro Text", system-ui, sans-serif`, `--font-mono "JetBrains Mono Variable", ui-monospace, monospace`
  - **Components** (all styled only from tokens):
    - Focus rings are a 1px `--accent` outline.
    - `Button` variants: `primary` (accent text and border on black, never a filled accent block), `ghost`, `danger`.
    - `Chip` variants: `default` and `accent`.
    - `Dialog` is built on Radix: hairline border, `--surface` panel, `Esc` closes.
- **Window chrome:** a 38px top bar acting as the drag region (`data-tauri-drag-region`), leaving space for the traffic lights on the left.

- [ ] **Step 1: Write failing tests** in `src/test/ui.test.tsx` and `src/test/api.test.ts`:
  - `api maps rejection to RavenError`: mock `@tauri-apps/api/core` `invoke` to reject with `{code:'wrong_password',message:'x'}`; `api.vaultUnlock('p')` rejects with `RavenError` where `code === 'wrong_password'`.
  - `Dialog closes on Escape`
  - `Field shows error message and aria-invalid`
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the tokens, components and `api`.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check.**
  - Run `npm run tauri dev` and open a temporary `/__ui` route (debug builds only) that renders every component.
  - Compare it against `docs/design/visual-directions.html` direction A: same contrast, hairlines and accent discipline.
  - Remove nothing. The `/__ui` route stays, debug-only.
- [ ] **Step 6:** Commit: `feat(ui): ink design system and typed api`.

### Task 7: Setup, unlock, auto-lock, settings screen

**Files:**
- Create: `src/features/vault/{SetupScreen,UnlockScreen,VaultGate,useAutoLock}.tsx`, `src/features/settings/SettingsPage.tsx`, `src/test/vault.test.tsx`, `src/test/settings.test.tsx`.
- Modify: `src/App.tsx` (routes: everything sits inside `VaultGate`; `/settings`).

**Interfaces:**
- Consumes: `api` (Task 6).
- Produces:
  - **`VaultGate`** shows SetupScreen when `!exists`, UnlockScreen when `!unlocked`, and its children otherwise.
  - On lock, it clears the TanStack Query cache and any in-memory drafts (`queryClient.clear()`) and closes all dialogs.
  - **SetupScreen copy** (exact):
    - title "Create your Raven password";
    - helper "This password encrypts everything Raven stores. It can't be recovered — if you forget it, the data is gone.";
    - a confirmation field;
    - the 12-character minimum shown inline.
  - **UnlockScreen:**
    - one password field, autofocused; `Enter` submits;
    - `wrong_password` shows "Wrong password" inline and keeps focus;
    - after a successful unlock where `migratedFrom < migratedTo`, show a one-line notice "Updated Raven's data (backup saved)".
  - **`useAutoLock(minutes)`:**
    - resets on `keydown`, `pointerdown`, `pointermove` and `wheel`;
    - when time runs out, calls `api.vaultLock()` and moves the gate to locked;
    - `⌘L` locks immediately.
  - **SettingsPage:**
    - auto-lock minutes and backup retention, saved on blur;
    - a backups list showing date, reason and size;
    - a "Back up now" button;
    - "Restore" per backup, with a confirm dialog: "Restore this backup? Raven will save a backup of the current data first, then lock. Unlock with your password to continue."

- [ ] **Step 1: Write failing tests**, with `api` mocked through `vi.mock('../lib/api')`:
  - `shows setup when no vault`, `shows unlock when locked`.
  - `wrong password shows inline error`
  - `setup enforces 12 chars and matching confirmation`
  - `autolock_with_open_dialog_discards_draft_cleanly`:
    1. Use fake timers, auto-lock 1 minute.
    2. Open the new-engagement dialog (Task 8 component; add this test in Task 8 if that order is easier) and type a name.
    3. Advance 61s.
    4. The unlock screen shows, `api.engagementCreate` was not called, and after unlocking the dialog is closed.
  - `cmd+L locks`
  - `restore asks for confirmation then locks`
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(app): setup, unlock, auto-lock and settings`.

### Task 8: Engagements dashboard and engagement shell

**Files:**
- Create:
  - `src/features/engagements/{Dashboard,ActiveCard,PastTable,EngagementDialog,EngagementShell}.tsx`
  - `src/features/engagements/format.ts`
  - `src/test/dashboard.test.tsx`
- Modify: `src/App.tsx` (routes `/` → Dashboard, `/e/:id` → EngagementShell).

**Interfaces:**
- Consumes: `api`, the `ui` components.
- Produces:
  - **Dashboard** (spec §5.1, mockup `docs/design/engagements-dashboard.html` option A):
    - an "Active" grid of `ActiveCard`s;
    - a "Past" `PastTable` with a search input filtering by name and client (case-insensitive);
    - `⌘N` opens `EngagementDialog`;
    - empty state: "No engagements yet" with a "New engagement" button.
  - **ActiveCard** shows:
    - the name;
    - a kind chip and a sub-label chip;
    - dates (`format.ts`: `Nov 10 – Nov 14`) or, for an exam sim with a timebox, the time remaining (`14h 10m left`, or `Timebox not started` / `Time's up`) with a progress bar;
    - a progress line placeholder "Rooted 0/0 · flags 0/0". This is a pure function `progressLine(summary)` in `format.ts`, so later steps fill in real counts;
    - last activity, relative ("12m ago").

    Clicking it opens `/e/:id`.
  - **PastTable** columns: Engagement, Kind, Dates, Result (`—` for now), Report (`—`).
  - **EngagementDialog** (create and edit):
    - fields name, kind (segmented: Exam sim / Lab / Client), client (shown only for Client), sub-label, start/end dates, scope (one CIDR or IP per line), domain;
    - timebox start (datetime) and duration (default 23h 45m), shown only for Exam sim;
    - server validation errors appear on their fields.
  - **EngagementShell** (spec §5.2, mockup option B):
    - a left sidebar with the sections Board, Log, Credentials, Findings, Engagement checklist, Report, where the current one is marked by an accent left marker;
    - an empty "Hosts" group;
    - a pinned status strip showing the timebox for exam sims;
    - the main area shows `EmptyState` "Board arrives in build step 2";
    - header actions: Edit, Archive/Unarchive, Delete. Delete confirms by typing the engagement name.
  - **Shortcuts:** number keys 1–6 switch sections, and `Esc` returns to the dashboard from the shell.

- [ ] **Step 1: Write failing tests** (`api` mocked):
  - `lists active as cards and archived in past table`
  - `past search filters by name and client`
  - `timebox_fields_only_for_exam_sim`: kind Lab shows no timebox fields; Exam sim does; the submitted input for Lab has no timebox.
  - `create shows field error from server`: `engagementCreate` rejects with `{code:'validation',field:'scopeCidrs'}`, and the scope field shows the message.
  - `delete requires typing the name`
  - `timeLeft formats`: unit tests on `format.ts` for `14h 10m left`, `Time's up`, `Timebox not started`.
  - `cmd+N opens new engagement dialog`
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. `api.engagementSetStatus` drives archive and unarchive.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run lint && (cd src-tauri && cargo test)`. Expected: PASS.
- [ ] **Step 5: Run the real app** with `npm run tauri dev`:
  1. Create a password.
  2. Create an Exam sim with a 23h 45m timebox, a Lab and a Client.
  3. Archive one.
  4. Search the Past table.
  5. Lock with `⌘L` and unlock.
  6. Back up now and restore it.
  7. Confirm the data dir is `…/raven-dev/` and `raven.db` isn't readable as plain SQLite (`head -c 16`).
- [ ] **Step 6:** Commit: `feat(app): engagements dashboard and engagement shell`.
