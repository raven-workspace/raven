# Raven Arsenal, ⌘K and Field Manual Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commands from the user's Field Manual can be reached in a few keystrokes, already filled for the host in view, through ⌘K, an Arsenal drawer and a "Transfer a file" generator. The vault becomes a live, imported source with a drift report.

**Architecture:**
- **Runtime library.** A library store replaces the static `BUILTIN_LIBRARY` reads. It holds the built-ins with imported Field Manual commands merged over them.
- **Reading the vault.** Rust scans the vault folder read-only and returns file text. TypeScript engines parse cards, playbooks and the Toolkit, merge, classify exam rules and compute drift. Imported data is stored in the encrypted DB (migration 0009).
- **UI.** The new pieces are a palette, a drawer, a browse page and a generator. They all use the existing fill engine, extended with the new tokens.

**Tech Stack:** Tauri 2 (Rust, rusqlite with SQLCipher), React 19, TypeScript, TanStack Query, zustand, Tailwind v4, Vitest with jsdom.

**Spec:** `docs/superpowers/specs/2026-11-05-raven-arsenal-import-design.md`

## Global Constraints

- **Secrets:** never open, read, cat, grep, head, stat or copy `a file outside the repo`, any `raven-workspace-*.json`, or any file whose name contains `backup`.
- **Commits:** explicit paths only, never `git add -A` or `git add .`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** synthetic fixtures only. Never run `npm run tauri dev`. Never touch localhost:3000.
- **The vault:** `~/Documents/Field Manual`. Raven code only ever reads it. Only Task 1 writes to it, and only after the controller relays the user's explicit approval.
- **Schema changes:** through `src-tauri/migrations` and `MIGRATIONS`, with the runner's backup hook. Never edit a shipped migration (0001–0008).
- **Exam rules:** everything shown in ⌘K, the drawer, browse and the generator goes through `filterForKind` (`src/engines/checklist/examRules.ts`). That means banned commands are hidden in exam sims and the Metasploit lock holds.
- **Keys:**

  | Key | Action |
  |---|---|
  | `⌘K` | palette |
  | `A` | Arsenal drawer, via `isFreeKey`, like `N` and `H` |
  | `↵` | copy |
  | `⌘↵` | copy and log |
  | `→` | open the card |
  | `⇥` | edit a fill value |

  Existing keys are unchanged: `L`, `N`, `H`, `1`–`6`, `Esc`, `⌘L`, `⌘N`.
- **No built-in command or checklist goal link is lost** by an import (spec §5).
- **Verification before each commit:**
  - `npx vitest run` for the touched tests, then the full suite once;
  - `npm run typecheck`;
  - `npm run lint`;
  - for Rust tasks, also `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`. `cargo` is at rustup's default bin folder.

## Review Focus

1. **The library must never come back empty.** A first launch with no import, an import that fails halfway, or a vault path that doesn't exist must still leave the full built-in library in place, with checklist commands and auto-ticks unchanged. Tests: Task 3 (store fallback) and Task 5 (failed import leaves the store unchanged).
2. **Removing a command from the vault doesn't remove it from Raven.** If a block is deleted from a card that a checklist step relies on, the built-in stays and the drift report flags it. Test: Task 5.
3. **Exam sims.** ⌘K, the drawer and the generator hide banned commands and lock Metasploit exactly as the checklist does. Imported Metasploit or Meterpreter blocks are classified. Tests: Tasks 4, 7 and 9.
4. **Filling commands with no host in view.** On the dashboard, ⌘K and the drawer fill LHOST and the settings tokens and leave host tokens unfilled. They don't crash or fill with the wrong host. Tests: Tasks 7 and 8.
5. **A logged transfer is suggested for cleanup.** A fetch logged from the generator is suggested for cleanup for every method that writes a file to the target, bitsadmin and UNC `copy` included. Test: Task 9.

---

### Task 1: Vault edits (prepared in a copy, applied only after the user approves)

**Files:**
- No repo files. Work in `$SCRATCH/vault-edit/`, where `$SCRATCH` is `/private/tmp/claude-501/-Users-keegan-Developer-Repos-pwndash/00add63e-b992-403f-ac7a-3564c1fd3b04/scratchpad`.
- Vault files touched after approval:
  - `00-Home/Toolkit.md` (new);
  - `00-Home/Conventions.md`;
  - `02-Cards/Shells-and-Transfers/File-Transfer-to-Windows.md` and `File-Transfer-to-Linux.md`;
  - every card or playbook with a pivot-context `{PORT}`.

**Interfaces:**
- Produces the vault contract that Tasks 4, 6 and 9 rely on:
  - `{DEST_DIR}` replaces the destination folder in target-side writes;
  - in both transfer cards, each `**Sub-method:**` group holds its own Kali serve block(s) and the Target blocks that use them. On Linux, "Host on Kali" and "Pull from the target" merge into one group, `**Sub-method: HTTP (default)**`;
  - `{TARGET_PORT}` means a pivot or forward's internal port;
  - `Toolkit.md` follows the format in spec §4, with every file name in full.

- [ ] **Step 1: Copy the vault to `$SCRATCH/vault-edit/Field-Manual`** with `cp -R`. Don't touch the original.

- [ ] **Step 2: Rename pivot `{PORT}`s in the copy.** Use a reviewed script, `$SCRATCH/vault-edit/rename-port.py`. It changes `{PORT}` to `{TARGET_PORT}` only on lines that also contain `socat`, `plink`, `ssh -L`, `ssh -R`, `netsh interface portproxy`, `chisel`, `ligolo` or `listener_add`. Print every changed line for the report. A `{PORT}` on any other line is left alone and listed under "kept, service port".

- [ ] **Step 3: Add `{DEST_DIR}` in the two transfer cards.** In the copy, replace the literal destination folder in target-side writes with `{DEST_DIR}`:
  - in File-Transfer-to-Windows, `C:\Windows\Temp\` before `{FILE}` or a literal file name becomes `{DEST_DIR}\`;
  - in File-Transfer-to-Linux, `/tmp/` in `-O`, `-o` or `>` destinations becomes `{DEST_DIR}/`.

  Kali-side paths (`~/tools/...`) and prose stay as they are.

- [ ] **Step 4: Restructure the Linux card.** Merge "Host on Kali" and "Pull from the target" into one `**Sub-method: HTTP (default)**` group, in this order: Kali serve block(s), then the target pull blocks. Every block's text stays unchanged.

- [ ] **Step 5: Write `00-Home/Toolkit.md`.**
  - Use the vault's note frontmatter style. Copy it from an existing `00-Home` note.
  - Add the two tables from spec Appendix A, with file names written out in full: `GodPotato-NET4.exe` / `GodPotato-NET35.exe` / `GodPotato-NET2.exe`, `pspy64` / `pspy32`, `nc.exe` / `nc64.exe`.
  - Add a `## Staging script` section with one ```` ```bash ```` block that meets spec §8.3. It must:
    - create both folders;
    - copy the `/usr/share/...` files;
    - fetch GitHub latest-release assets via `api.github.com/repos/<owner>/<repo>/releases/latest` with `curl` and `jq`, picking assets by name pattern;
    - unzip or extract archives;
    - check each file with `file` (PE32+ x86-64 or PE32 Intel 80386 for Windows; ELF 64-bit x86-64 or ELF 32-bit 80386 for Linux, matching the name);
    - skip files that are already present and verified, unless `--force`;
    - print a final ✅/❌ table;
    - use no hard-coded versions and never install packages.
  - Verify it with `bash -n` and `shellcheck` if it's on PATH. Don't run it, because it downloads.

- [ ] **Step 6: Extend Conventions.md.** In the copy, add three short sections: "Toolkit format", "Transfer cards (generator contract)" and the `{DEST_DIR}` / `{TARGET_PORT}` placeholders.

- [ ] **Step 7: Produce the review package.**
  - Run `diff -ruN` from the original vault to the copy, excluding `.obsidian/` and `.trash/`, into `$SCRATCH/vault-edit/vault.diff`.
  - Write a summary to `$SCRATCH/vault-edit/summary.md`: files changed, the count of `{PORT}` renames, the `{PORT}`s kept, and the script's line count.
  - Report `NEEDS_CONTEXT` with both paths. **STOP. Don't write to the vault.**

- [ ] **Step 8 (only after the controller relays the user's approval): apply.**
  1. Back up the real vault to `~/Documents/Field Manual`. Use `cp -R`, and fail if the target already exists.
  2. Copy the changed files from the copy into the real vault, and only those files.
  3. Re-run the diff and confirm it's empty.

  No git commit, since the vault isn't in the repo.

---

### Task 2: Settings and the new fill tokens

**Files:**
- Modify:
  - `src-tauri/src/settings.rs`: keys, `Settings`, `SettingsPatch`, `get`, `update` and tests;
  - `src/types/settings.ts`;
  - `src/features/settings/SettingsPage.tsx`;
  - `src/engines/checklist/fill.ts`: `FillInput` and `commandContext`;
  - `src/engines/checklist/template.ts`: labels and defaults;
  - every caller that builds a `FillInput` (grep for `attackerIp:`).
- Test:
  - `settings.rs` tests;
  - `src/test/engines/checklist/fill.test.ts`;
  - `src/test/settings.test.tsx`.

**Interfaces:**
- Produces:
  - **Settings fields**, with defaults: `kaliUser: string` (`"kali"`), `windowsToolsDir: string` (`"~/tools/windows"`), `linuxToolsDir: string` (`"~/tools/linux"`), `fieldManualPath: string` (`"~/Documents/Field Manual"`).
  - **`FillInput` gains:**
    - `kaliUser?: string`;
    - `portHint?: number[]`: the open ports to offer for `{PORT}`;
    - `overrides?: Record<string, string>`: explicit values for tokens such as FILE, DEST_DIR, PORT and COMMUNITY, keyed by the upper-case token name. Overrides win over everything.
  - **Exported `portChoices(input: FillInput, goal?: ChecklistGoal): number[]`.** Under a goal, it returns the host's open ports matching `goal.applies.ports`/`services`. Without a goal, every open port. Ascending order.

**Token values:**

| Token | Value |
|---|---|
| `TARGET_HOST` | `${host.name}.${engagement.domain}` when the engagement has a domain and `hostFacts(...).domainJoined`, else `host.name` |
| `HOSTNAME` | `host.name` |
| `PIVOT_IP`, `PIVOT_NAME` | the via host of the first tunnel whose reach covers the host (the same tunnel `fillCommand` reports as `viaTunnel`); unresolved when there's none |
| `KALI_USER` | `kaliUser` |
| `COMMUNITY` | `public` |
| `SOCKS_PORT` | `1080` |
| `DEST_DIR` | `C:\Windows\Temp` for Windows hosts, `/tmp` otherwise |
| `PORT` | `portHint[0]`, or unresolved when it's empty |

Every one of these can be replaced by an `overrides` entry.

- [ ] **Step 1: Write the failing tests**
  - **`fill.test.ts`:**
    - `TARGET_HOST is the FQDN for a domain-joined host and the name otherwise`;
    - `PIVOT_IP and PIVOT_NAME come from the tunnel via host`;
    - `KALI_USER, COMMUNITY and SOCKS_PORT fill from settings and defaults`;
    - `DEST_DIR follows the host OS`;
    - `PORT uses the first port hint and stays unresolved without one`;
    - `overrides win over computed values`;
    - `portChoices filters open ports by the goal's applies, ascending`.
  - **Rust:** `settings_kali_user_and_tool_dirs_round_trip`, `field_manual_path_defaults`.
  - **`settings.test.tsx`:** `Kali user and tools folders save`.

- [ ] **Step 2: Run them and check they fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** Follow the existing `attackerIp` pattern end to end. Callers pass `kaliUser` from settings. Leave `portHint` and `overrides` unset for now; Tasks 7–9 set them.

- [ ] **Step 4: Verify everything** (the commands in Global Constraints). Expected: green.

- [ ] **Step 5: Commit** with the message `feat(fill): kali user, tool dirs and the new placeholders`.

---

### Task 3: Runtime library store (built-ins plus imported, one place to read)

**Files:**
- Create: `src/engines/library/store.ts`
- Modify:
  - `src/features/checklist/goalCommands.ts`;
  - `src/features/checklist/ticks.ts:31`;
  - `src/engines/stuck/shared.ts:20`;
  - `src/engines/capture/titles.ts:12`;
  - `src/engines/capture/kind.ts:16`;
  - `src/engines/library/data/fieldManual.ts`: add card metadata.
- Test: `src/test/engines/library/store.test.ts`, plus existing suites.

**Interfaces:**
- Produces:
  - `getLibrary(): LibraryCommand[]`. It's synchronous, and returns `BUILTIN_LIBRARY` until `setImported` is called.
  - `setImported(imported: { commands: LibraryCommand[]; cards: CardMeta[] }): void`. It replaces the imported layer, and Task 5 defines the merge.
  - `getCards(): CardMeta[]`.
  - `useLibraryVersion(): number`. A zustand-backed counter that bumps on `setImported`, so React views re-render.
  - `interface CardMeta { id: string; title: string; stage: string; category: string; os: 'linux' | 'windows' | 'any'; file: string }`
  - `FIELD_MANUAL_CARDS: CardMeta[]`, exported from `fieldManual.ts`. It has one entry per distinct `cardId` already in `FIELD_MANUAL_COMMANDS`, with values read from each card's frontmatter (title from `title:`) in the vault, read-only.
  - `kind.ts`: its module-level bins set is computed from `getLibrary()` lazily, and recomputed when the library version changes.

- [ ] **Step 1: Write the failing tests** (`store.test.ts`):
  - `getLibrary returns the built-ins before any import`;
  - `setImported layers imported commands and bumps the version`;
  - `setImported with an empty layer restores exactly the built-ins`;
  - `every built-in cardId has CardMeta`.

- [ ] **Step 2: Run them and check they fail.** Expected: FAIL.

- [ ] **Step 3: Implement and switch call sites.** Replace every `BUILTIN_LIBRARY` read outside `data/` and the tests with `getLibrary()`. The layering for now is "imported commands replace built-ins with the same id, and new ids are appended". Task 5 fills `setImported`'s input.

- [ ] **Step 4: Verify everything.** The full suite must stay green with no behaviour change.

- [ ] **Step 5: Commit** with the message `refactor(library): one runtime library store`.

---

### Task 4: Vault parsers (cards, playbooks, Toolkit) and exam classification

**Files:**
- Create:
  - `src/engines/fieldManual/parseCard.ts`;
  - `src/engines/fieldManual/parsePlaybook.ts`;
  - `src/engines/fieldManual/parseToolkit.ts`;
  - `src/engines/fieldManual/classifyExam.ts`;
  - `src/engines/fieldManual/index.ts`.
- Test: `src/test/engines/fieldManual/*.test.ts`, with synthetic markdown fixtures that mirror `Conventions.md`.

**Interfaces:**
- Produces:
  - `parseCard(relPath: string, text: string): ParsedCard | null`. It returns null unless the frontmatter has `type: card`.
    - `ParsedCard { meta: CardMeta; blocks: ParsedBlock[] }`
    - `ParsedBlock { title: string; why?: string; template: string; runFrom: 'attacker' | 'target'; group?: string; note?: string; index: number }`
    - `group` is the current `**Sub-method: X**` label.
    - `runFrom` comes from the fence title: `Kali` gives attacker, `Target — …` gives target.
    - A fence with no title is skipped.
  - `parsePlaybook(relPath: string, text: string): PlaybookItem[]`
    - `PlaybookItem { file: string; heading?: string; text: string }`
    - `text` is the `- [ ]` item with the `→ [[…]]` tail, wiki-link brackets and trailing space stripped, and whitespace collapsed.
  - `parseToolkit(text: string): ToolkitEntry[]`
    - `ToolkitEntry { os: 'windows' | 'linux'; purpose: string; file: string; note: string; where: string; staged: boolean }`
    - Each backticked full name in the "File to transfer" cell is one entry.
    - A blank Purpose inherits from the row above.
    - `staged` is true when the cell contains ✅.
  - `classifyExam(template: string, cardExam?: string, note?: string): ExamRule | undefined`
    - It returns `'metasploit'` for `msfconsole`, `meterpreter`, `use (exploit|auxiliary|post)/`, or `msfvenom` with `meterpreter`.
    - It returns `'banned'` when `cardExam === 'prohibited'` or the block's note mentions that it's banned or prohibited in the exam.

- [ ] **Step 1: Write the failing tests.** Fixtures cover:
  - a card with two sub-method groups, Kali and Target fences, a `**Why:**` line, a `**Note:**` line and a fence with no title (skipped);
  - a playbook with `→ [[link]]` tails and headings;
  - a Toolkit with a blank Purpose cell, two files in one cell, and ✅ marks;
  - classification of `msfconsole -q -x "use exploit/…"` (metasploit), a staged handler with no meterpreter (none), and `exam: prohibited` (banned).

  Name the tests after the behaviour, for example `parseCard groups blocks under their sub-method`.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement.** These are pure functions with no I/O.

- [ ] **Step 4: Verify everything.**

- [ ] **Step 5: Commit** with the message `feat(fieldManual): parse cards, playbooks and the Toolkit`.

---

### Task 5: Import: scan, merge, store, and the Settings › Field Manual section

**Files:**
- Create:
  - `src-tauri/migrations/0009_field_manual.sql`;
  - `src-tauri/src/field_manual.rs`;
  - `src/engines/fieldManual/merge.ts`;
  - `src/features/settings/FieldManualSection.tsx`;
  - `src/features/fieldManual/queries.ts`.
- Modify:
  - `src-tauri/src/migrations/mod.rs`: append `(9, …)`;
  - `src-tauri/src/commands.rs` and `src-tauri/src/lib.rs`: register the commands;
  - `src/lib/api.ts`;
  - `src/features/settings/SettingsPage.tsx`;
  - `src/features/vault/VaultGate.tsx`: the Settings link dot, and loading the imported layer into the store after unlock.
- Test:
  - `field_manual.rs` tests;
  - `src/test/engines/fieldManual/merge.test.ts`;
  - `src/test/fieldManualImport.test.tsx`.

**Interfaces:**
- **Rust:**
  - `field_manual_scan(path: String) -> Vec<VaultFile>`, where `VaultFile { rel_path, mtime_ms, text }`.
    - It expands a leading `~`.
    - It reads only `00-Home/Toolkit.md`, `01-Playbook/*.md` and `02-Cards/**/*.md`.
    - It never writes.
    - A missing path is `AppError::NotFound`.
  - `field_manual_latest_mtime(path: String) -> Option<i64>`: the newest mtime among the same files.
  - `field_manual_save(snapshot: FieldManualSnapshot)`: replaces the stored snapshot in one transaction.
  - `field_manual_load() -> Option<FieldManualSnapshot>`.
- **Migration 0009:** a single-row table `field_manual (id INTEGER PRIMARY KEY CHECK (id = 1), imported_at INTEGER NOT NULL, snapshot TEXT NOT NULL)`. The snapshot is JSON: `{ cards: CardMeta[], commands: LibraryCommand[], playbook: PlaybookItem[], toolkit: ToolkitEntry[], report: ImportReport }`.
- **TypeScript:**
  - `mergeImport(builtins: LibraryCommand[], parsed: ParsedCard[], previous?: FieldManualSnapshot): { commands: LibraryCommand[]; report: ImportReport }`
  - `ImportReport { cardsAdded; cardsChanged; cardsRemoved; commandsAdded; commandsChanged; commandsRemovedKept: string[]; classified: { id: string; exam: ExamRule }[] }`
  - The drift fields come in Task 6.
  - `useFieldManual()` query and an `importFieldManual()` mutation. On success, the mutation calls `setImported` (Task 3).

**Merge rules (spec §5):**
- **Match** each parsed block to the built-in `fm-<cardId>-*` entries of the same card:
  - first by `###` title (block `title` equals the command `title`);
  - then by template, with whitespace collapsed.
- **A match** keeps the built-in's `id`, `match`, `matchExamples`, `goals`, `tool` and `exam`. It takes the vault's `title`, `why` and `template`, and is marked changed when any of those differ.
- **No match:** new id `fm-<cardId>-v<index>`. Goals are the union of goals linked to the card's other built-ins. `exam` comes from `classifyExam`, `source: 'field-manual'`.
- **Built-in blocks missing from the vault** stay, and are listed in `commandsRemovedKept`.
- **Raven-source commands** are never touched.
- **Exam rules:** an existing `exam` is never weakened. `classifyExam` can only add one.

**UI** (`FieldManualSection`, in Settings):
- the path field (saved to `fieldManualPath`);
- an "Import now" button;
- "last: <time> · N cards · M commands";
- the report counts.

The Settings link shows a dot when `field_manual_latest_mtime` is greater than `imported_at`. It's checked on window focus and on Settings mount.

- [ ] **Step 1: Write the failing tests**
  - **Rust:**
    - `scan_reads_only_cards_playbooks_and_toolkit`: a temp-dir vault with an extra `.obsidian/x.json` and a note in another folder;
    - `scan_missing_path_is_not_found`;
    - `save_then_load_round_trips_the_snapshot`;
    - a v8→v9 migration test.
  - **`merge.test.ts`:**
    - `a renamed block matches on template and keeps its id, matcher and goals`;
    - `a reworded block matches on title and is changed`;
    - `a new block gets fm-<card>-v<n>, the card's goals and a classified exam rule`;
    - `a block deleted in the vault keeps the built-in and is listed as removed-kept`;
    - `an existing exam rule is never weakened`;
    - `raven-source commands are untouched`.
  - **`fieldManualImport.test.tsx`:**
    - `Import now scans, saves and updates the library`;
    - `a failed scan shows an error and leaves the library and snapshot unchanged` (Review Focus 1);
    - `the Settings link shows a dot when the vault is newer than the last import`.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement.** After unlock, `VaultGate` loads the snapshot (if any) and calls `setImported`.

- [ ] **Step 4: Verify everything**, including cargo and clippy.

- [ ] **Step 5: Commit** with the message `feat(fieldManual): import from the vault with a merge report`.

---

### Task 6: Drift report (steps mapped to playbook items)

**Files:**
- Modify:
  - `src/engines/checklist/types.ts`: `ChecklistGoal.playbook?: { file: string; text: string }`;
  - `src/engines/checklist/data/hostChecklist.ts` and `engagementChecklist.ts`: fill `playbook` for every goal that mirrors a vault item;
  - `src/engines/fieldManual/merge.ts` or a new `drift.ts`;
  - `src/features/settings/FieldManualSection.tsx`.
- Test: `src/test/engines/fieldManual/drift.test.ts`, plus a data test.

**Interfaces:**
- Produces `computeDrift(goals: ChecklistGoal[], playbook: PlaybookItem[], commands: LibraryCommand[], cards: ParsedCard[], toolkit: ToolkitEntry[]): Drift`, where:

  ```
  Drift {
    noStep: PlaybookItem[];
    reworded: { goalId: string; text: string }[];
    ravenOnlySteps: string[];
    unfillable: { token: string; count: number; manual: boolean }[];
    ravenOnlyCommands: string[];
    toolkitUnused: string[];
  }
  ```

  `ImportReport` gains `drift: Drift`.

**Rules:**
- **`playbook.text`** is the item's exact text as `parsePlaybook` returns it. Read the vault's `01-Playbook` 00–06 files, read-only. Engagement goals map to 00 and 06.
- **Goals with no playbook field:** the Raven-only goals (`h-enum-web-source`, `h-close-notes`, `h-close-cleanup`) and the AD playbook goals.
- **Pivot goals** map to their 06 item.
- **`unfillable`** lists tokens Raven can't fill. `manual` is true for spec §7's "stay manual" list.

- [ ] **Step 1: Write the failing tests**
  - `drift.test.ts`:
    - `an unmapped playbook item is noStep`;
    - `a goal whose text left its file is reworded`;
    - `goals without playbook are ravenOnlySteps`;
    - `manual tokens are labelled manual`;
    - `a raven-source command is a ravenOnlyCommand`.
  - Data test: `every goal with playbook names a 0x playbook file and non-empty text`.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement, and show drift in `FieldManualSection`** as the spec §5 list, with counts and expandable lines.

- [ ] **Step 4: Verify everything.**

- [ ] **Step 5: Commit** with the message `feat(fieldManual): drift report`.

---

### Task 7: ⌘K palette

**Files:**
- Create:
  - `src/features/palette/Palette.tsx`;
  - `src/features/palette/search.ts`;
  - `src/features/palette/usePaletteStore.ts`.
- Modify:
  - `src/features/vault/VaultGate.tsx`: a title-bar "Search ⌘K" button and the global ⌘K listener, following the capture-phase pattern in `useAutoLock.ts`;
  - `src/features/capture/`: reuse the existing save path for ⌘↵.
- Test: `src/test/palette.test.tsx`, `src/test/engines/palette/search.test.ts`.

**Interfaces:**
- Consumes `getLibrary`, `getCards` (Task 3), the Task 2 tokens, `filterForKind` and `goalCommands`-style filling.
- Produces:
  - `searchPalette(query: string, ctx: { library; cards; generators: { id: string; title: string }[]; os?: 'linux' | 'windows'; stageId?: string; engagementItems?: EngagementItem[] }): PaletteResult[]`.
    - Results are grouped as commands, generators, cards, then engagement items.
    - Matching: every query word must word-prefix-match the title, tool, template, card title or file name.
    - Ranking: commands for the host's OS and current stage come first.
  - `usePaletteStore`: `open(hostId?)`, `close()`.
  - Generators register through a `GENERATORS` list that starts empty. Task 9 adds the first one.

**Behaviour:**
- **Host context:**
  - ⌘K opens the palette from anywhere it's unlocked.
  - A "for <host>" chip shows the host in view, taken from the route's `/h/:hostId`.
  - On the dashboard there's no host: LHOST and the settings tokens fill, and host tokens stay as tokens.
- **Keys:**
  - `↵` copies the filled command;
  - `⌘↵` copies it and logs it as a command entry against that host, through the existing capture save path, so auto-tick and cleanup suggestions run;
  - `→` opens the card in the drawer (Task 8; a no-op until then);
  - `⇥` focuses the first unresolved token's override input. Overrides apply only within the palette session.
- **Engagement items** (log titles and commands, notes, credential labels) are searched only inside an engagement. Secrets are masked and never matched.
- **Tool pre-fill:** when a query word matches a Toolkit file name (Task 9 supplies the toolkit), pre-fill `overrides.FILE` with the best staged match.
- **Exam sims** hide banned commands and show locked Metasploit commands, exactly as the checklist does.

- [ ] **Step 1: Write the failing tests**
  - **`search.test.ts`:**
    - `every query word must prefix-match`;
    - `host OS and stage commands rank first`;
    - `banned commands are excluded in exam-sim`.
  - **`palette.test.tsx`:**
    - `⌘K opens with the host chip and Enter copies the filled command` (clipboard mocked);
    - `⌘↵ copies and logs an entry for the host`;
    - `on the dashboard host tokens stay unfilled` (Review Focus 4);
    - `Escape closes and returns focus`;
    - `typing in an input does not open on K alone`.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Verify everything.**

- [ ] **Step 5: Commit** with the message `feat(palette): ⌘K search and copy`.

---

### Task 8: Arsenal drawer, full-screen browse, and card links on steps

**Files:**
- Create:
  - `src/features/arsenal/ArsenalDrawer.tsx`;
  - `src/features/arsenal/ArsenalBrowse.tsx`;
  - `src/features/arsenal/CardView.tsx`;
  - `src/features/arsenal/useArsenalStore.ts`.
- Modify:
  - `src/features/vault/VaultGate.tsx`: the title-bar "Arsenal A" button;
  - `src/features/engagements/EngagementShell.tsx`: the `A` key, following the `N` pattern;
  - the routes: `/arsenal` for full-screen browse;
  - `src/features/checklist/CommandList.tsx` or `GoalRow.tsx`: "From card X ↗ · more in Arsenal";
  - `src/features/palette/Palette.tsx`: `→` opens the card;
  - `src/features/notes/useNotesStore.ts` and `HostView.tsx`: the drawer shares the right edge, so opening one closes Notes and Stuck, and vice versa.
- Test: `src/test/arsenal.test.tsx`.

**Interfaces:**
- Produces `useArsenalStore`: `openCard(cardId?)`, `close()`, `fullScreen()`.

**`CardView` shows:**
- the card title, a Field Manual pill and its stage, category and OS;
- fill chips for its tokens (LHOST, FILE, TARGET_IP, PORT and the rest), editable as `overrides` and applied to every command shown;
- the blocks in vault order, filled, with their `why`;
- then "Also in Raven": `source: 'raven'` commands sharing a goal with the card's commands.

**Drawer:**
- It has its own search box, using `searchPalette` restricted to cards and commands.
- It fills for the host in view.
- Esc closes it.
- "⤢ full screen" navigates to `/arsenal`.

**Browse** (`/arsenal`):
- On the left: Stage (the six PEN-200 stage ids plus `lateral-movement`), Category, and a Generators list.
- On the right: `CardView`.
- It has no host by default. A host picker chip lets you choose one from the active engagement.

- [ ] **Step 1: Write the failing tests** (`arsenal.test.tsx`):
  - `A opens the drawer filled for the host in view and Esc closes it`;
  - `A does nothing while typing`;
  - `opening the drawer closes Notes and Stuck`;
  - `a step's "From card" link opens the drawer on that card`;
  - `a FILE chip edit refills every command on the card`;
  - `Also in Raven lists raven-source commands for the card's goals`;
  - `browse filters by stage and category`;
  - `banned commands are hidden in exam-sim`;
  - `on the dashboard host tokens stay unfilled`.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Verify everything.**

- [ ] **Step 5: Commit** with the message `feat(arsenal): drawer, browse and card links`.

---

### Task 9: "Transfer a file" generator, Toolkit picker and `{FILE}` chips

**Files:**
- Create:
  - `src/engines/generators/transfer.ts`;
  - `src/features/generators/TransferGenerator.tsx`;
  - `src/features/generators/FilePicker.tsx`.
- Modify:
  - `src/engines/library/data/fieldManual.ts`: add the post-Task-1 File-Transfer-to-Windows and File-Transfer-to-Linux blocks and CardMeta as built-ins, copied from the edited vault cards, with `{DEST_DIR}` and the Sub-method `group` recorded on each entry as `tags: ['group:<label>']`;
  - `src/engines/cleanup/suggest.ts`: add `bitsadmin /transfer … <dest>`, `copy|xcopy \\host\share\x <dest>` and `Start-BitsTransfer -Destination`;
  - the palette `GENERATORS` list, the Arsenal browse Generators list, and the `{FILE}` chip in `CardView` and the palette.
- Test:
  - `src/test/engines/generators/transfer.test.ts`;
  - `src/test/transferGenerator.test.tsx`;
  - `src/test/engines/cleanup/suggest.test.ts`.

**Interfaces:**
- Consumes:
  - the library store, so imported transfer cards override the built-ins;
  - the snapshot's `toolkit`, falling back to an empty list when there's no import, so the picker allows free text;
  - Task 2 settings and overrides.
- Produces `transferMethods(cards: CardMeta[], library: LibraryCommand[], os: 'windows' | 'linux'): TransferMethod[]`, where:

  ```
  TransferMethod {
    id: string;
    label: string;
    group: string;
    kali: LibraryCommand[];
    target: LibraryCommand[];
  }
  ```

  The generator's methods come from the transfer cards using the spec §4 rules:
  - **HTTP group:** one method per Target block, each with the group's Kali blocks;
  - **other groups:** one method per group, with all its blocks in card order;
  - **Kali-only groups:** `target: []`.

**UI:**
- **File:** the `FilePicker` lists the Toolkit for the target OS, grouped by purpose, with staged ✅ files first. An unstaged pick shows "not staged on Kali; get it from: <where>" plus the row's note. Free text is allowed.
- **To:** a host, defaulting to the one in view, and a folder (`overrides.DEST_DIR`). Defaults follow Task 2, and the last folder per OS is remembered in localStorage.
- **Method:** tabs.
- **Output:** "1 · On Kali" then "2 · On <host>", filled and copy-ready. ⌘↵ on a target command logs it.
- **`{FILE}` chips:** every command with a `{FILE}` or `{SCRIPT}` token (palette, drawer, checklist) gets the same picker.

- [ ] **Step 1: Write the failing tests**
  - **`transfer.test.ts`:**
    - `HTTP group yields one method per target block sharing the serve block`;
    - `SMB group is one method with share, net use and copy in order`;
    - `a Kali-only group has no target half`;
    - `imported transfer cards override the built-ins`.
  - **`transferGenerator.test.tsx`:**
    - `picking winPEASx64_ofs.exe for MS02 fills serve and fetch with LHOST, FILE and DEST_DIR`;
    - `an unstaged tool shows where to get it`;
    - `the generator hides banned methods in exam-sim`.
  - **`suggest.test.ts`:**
    - `bitsadmin, UNC copy and Start-BitsTransfer fetches are suggested for cleanup`;
    - `every generator method that writes to the target yields a cleanup suggestion when logged` (Review Focus 5). Iterate over the built-in transfer methods, filling `FILE=x.exe`, `DEST_DIR=C:\Windows\Temp` or `/tmp`, and skipping Kali-only and in-memory methods such as `IEX … DownloadString` and `curl … | bash`.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement.** Register "Transfer a file" in the palette and browse generator lists.

- [ ] **Step 4: Verify everything.**

- [ ] **Step 5: Commit** with the message `feat(generators): transfer a file`.
