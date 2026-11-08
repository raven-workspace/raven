# 2b-A: Output Interpreters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saving a log entry files everything Raven can prove from the pasted output, automatically. That includes credentials, usernames, failed attempts, tried pairs, privesc vectors and checklist ticks. One summary per save says what went where, and one Undo reverses it.

**Architecture:**
- **Parsers.** Pure parsers in `src/engines/interpret/` turn output text into one `Interpretation`. They are tested against anonymised real output.
- **Applying.** `saveCapture` applies an interpretation with no pre-save toggles and writes an **extraction record** per log entry: what was created, plus "before" snapshots.
- **Undo.** Rust `extraction_undo` reverses the record in one transaction; then the existing `afterEntrySaved` recomputes ticks.
- **Display.** The summary shows as a 5-second toast and as an "Extracted" line on the entry.

**Tech Stack:** Tauri 2 (Rust, rusqlite, migrations in `src-tauri/migrations` registered in `src-tauri/src/migrations/mod.rs`), React 19, TypeScript, TanStack Query, zustand, Vitest, Playwright audit.

**Spec:** `docs/superpowers/specs/2026-11-07-raven-interpreters-and-payloads-design.md` (§3 is this plan; §4 is plan 2b-B).

## Global Constraints

- **Only proven information is filed;** when in doubt, nothing is filed and the raw output stays in the log (spec §2 anti-goals).
- **The raw output is always saved unchanged.**
- **Failed attempts never create a credential.** A failed pair whose secret isn't a stored credential becomes a **tried pair**.
- **Unknown IPs create a host only when the output proves something there** (a valid or admin login, a dump, an open port); failed-only IPs never do.
- **No pre-save toggles:** `IntakePreview` and the capture form's "+ add as host" tick are removed.
- **Summary:** 5 seconds, an X to close, Undo; wins first in the accent colour, routine counts muted; stored as the entry's "Extracted" line with its own Undo. Nothing extracted means no toast and no line.
- **Undo reverses everything that save filed automatically:**
  - created hosts;
  - services and OS from scans;
  - identity (restored from its snapshot);
  - credentials (created, or upgraded by a crack);
  - usernames;
  - attempts;
  - tried pairs;
  - vectors;
  - ticks.

  It never removes something the owner edited since, or something a later save also proved.
- **Editing a saved entry doesn't re-run extraction.**
- **No new checklist steps.** Output ticks only existing goal ids.
- **Schema changes are migrations;** the app already takes a backup before migrating (`migrations::migrate_with`). Stored data is real lab data.
- **Fixtures are real output, anonymised:** IPs → `10.10.x.x`; users, hosts and domains → stock names (`jay`, `drew`, `DC01`, `corp.lan`); hashes and passwords → synthetic values of the same shape. Real data never enters the repo.
- **Fixture sources:**
  - the owner's lab notes (outside the repo) (markdown code blocks);
  - a file outside the repo (`machines[].logEntries[].blocks[].output`).
- **Unverified parsers:** lsassy, kerbrute, rpcclient/lookupsid and pspy have no real samples. Build them from each tool's documented format and add `// unverified: no real sample yet (owner collects in next lab)` above the parser.
- **UI** uses CSS grid with explicit tracks; flex only for single-line runs. Ink theme: accent `--accent`, amber `--warn`, no red.

## Review Focus

1. **The same output pasted twice** must file nothing new and say so ("Nothing new: already recorded"), with no duplicate credentials, attempts or tried pairs. Test in Task 9.
2. **Undo after the owner edited a filed credential** keeps that credential and still removes the rest. Test in Task 2.
3. **A paste mixing tools** (nxc spray, then `sudo -l` on the shell it got) files both, and each lands on the right host. Test in Task 9.
4. **Output with Windows CRLF line endings, or ANSI colour codes,** parses the same as clean LF text. Test in Task 3.
5. **Deleting a log entry that has an extraction** keeps today's behaviour for its ticks, and its extraction row goes too (FK cascade). Its filed data stays (delete isn't undo). Test in Task 2.

---

### Task 1: Tried pairs (schema, Rust, api, matrix)

**Files:**
- Create: `src-tauri/migrations/0011_tried_pairs_extractions.sql`, `src-tauri/src/tried_pairs.rs`
- Modify:
  - `src-tauri/src/migrations/mod.rs` (register 11);
  - `src-tauri/src/lib.rs` and `src-tauri/src/commands.rs` (commands);
  - `src/lib/api.ts`, `src/types/credentials.ts`;
  - `src/features/credentials/TestGrid.tsx`.
- Test: Rust unit tests in `tried_pairs.rs`; `src/test/features/credentials/testGridTried.test.tsx`

**Interfaces:**
- Produces:
  - **SQL tables:**

    ```sql
    CREATE TABLE tried_pairs (
      id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      username TEXT NOT NULL, domain TEXT, secret TEXT NOT NULL,
      secret_kind TEXT NOT NULL CHECK (secret_kind IN ('password','hash')),
      host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
      service TEXT NOT NULL, auth_mode TEXT NOT NULL CHECK (auth_mode IN ('domain','local')),
      log_entry_id TEXT REFERENCES log_entries(id) ON DELETE SET NULL, at INTEGER NOT NULL);
    CREATE UNIQUE INDEX tried_pairs_unique ON tried_pairs (engagement_id, lower(username), lower(ifnull(domain,'')), secret, host_id, service, auth_mode);
    CREATE TABLE extractions (
      log_entry_id TEXT PRIMARY KEY REFERENCES log_entries(id) ON DELETE CASCADE,
      engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,   -- JSON ExtractionSummary
      record TEXT NOT NULL,    -- JSON ExtractionRecord
      created_at INTEGER NOT NULL, undone_at INTEGER);
    ```

    (`extractions` is used in Task 2; one migration holds both.)
  - **TS type:** `TriedPair { id, engagementId, username, domain: string | null, secret, secretKind: 'password' | 'hash', hostId, service, authMode: 'domain' | 'local', logEntryId: string | null, at: number }`.
  - **api:**
    - `triedPairsList(engagementId): Promise<TriedPair[]>`;
    - `triedPairsUpsert(engagementId, inputs: TriedPairInput[]): Promise<TriedPair[]>`, an idempotent insert-or-ignore on the unique key, returning the stored rows (existing ones included);
    - `triedPairDelete(id)`.
  - **Rust:** `tried_pair_promote(conn, engagement_id, username, domain, secret) -> AppResult<usize>` deletes the matching tried pairs when that pair becomes a real credential (used in Task 9).

- [ ] **Step 1:** Write the Rust tests:
  - `migrates_10_to_11_keeps_rows`: same pattern as `host_facts.rs` `migrates_9_to_10_keeps_rows`;
  - `upsert_is_idempotent`: two upserts of the same pair give 1 row;
  - `pair_key_ignores_case`: `JAY`/`corp.lan` vs `jay`/`CORP.LAN` is one row;
  - `promote_deletes_matching_pairs`.
- [ ] **Step 2:** Run `cd src-tauri && cargo test tried_pairs`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the migration, `tried_pairs.rs` (list, upsert, delete and promote, following `attempts.rs`'s style, with `check_scope` for the engagement), and the commands `tried_pairs_list`, `tried_pairs_upsert` and `tried_pair_delete`.
- [ ] **Step 4:** Run `cargo test`. Expected: all pass (236 + new).
- [ ] **Step 5:** Write the test `TestGrid shows tried pairs muted under their username, never as a credential row`:
  - render `TestGrid` with `tried=[{ username:'liam.brooks', secret:'CopperKite71', hostId:'h1', service:'ssh', … }]`;
  - assert the text `liam.brooks · tried` appears in a row with `data-tried=""`;
  - assert its cell for h1/ssh has `aria-label` matching `/failed/i`;
  - assert there's no row with `data-cred-id` for that pair.
- [ ] **Step 6:** Implement:
  - a `tried?: TriedPair[]` prop on `TestGrid`, rendering one muted row per (username, domain, secret) with failed cells, below the credential rows;
  - fetch through a `useTriedPairs(engagementId)` query in `src/features/credentials/queries.ts`;
  - pass it from `CredentialsSection`.
- [ ] **Step 7:** Machine accounts. Add `isMachineAccount(c: Pick<Credential,'username'>): boolean` (username ends with `$`) to `src/engines/credentials/matrix.ts`.
  - `isSprayable` returns false for machine accounts, so they never get spray-grid rows.
  - `formatCrackingList` callers in `HashesList` leave them out.
  - The credentials list groups them under a muted "Machine accounts" heading after the user credentials.

  Tests: `machine accounts are not sprayable`, `machine accounts are left out of the cracking list`, `credentials list shows a Machine accounts group`.
- [ ] **Step 8:** Run `npx vitest run src/test/features/credentials src/test/engines/credentials`. Expected: PASS.
- [ ] **Step 9:** Commit: `feat(credentials): tried pairs — failed sprays kept without becoming credentials`.

### Task 2: Extraction record and exact Undo (Rust)

**Files:**
- Create: `src-tauri/src/extractions.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src/lib/api.ts`, `src/types/log.ts`

**Interfaces:**
- Consumes: the `extractions` table (Task 1).
- Produces:
  - **TS `ExtractionSummary`:**

    ```ts
    { wins: string[]; counts: string[]; ticks: string[] }
    ```

    Display lines, already worded: `wins` are accent lines, `counts` muted, `ticks` like "Ticked 'Dump hashes' on DC01".
  - **TS `ExtractionRecord`** (all arrays default `[]`):

    ```ts
    {
      createdHostIds: string[];
      createdServiceIds: string[];
      servicesBefore: Service[];              // rows changed by a scan, as they were
      hostOsBefore: { hostId: string; os: string | null }[];
      identityBefore: { hostId: string; identity: HostIdentity | null }[];
      createdCredentialIds: string[];
      credentialsBefore: Credential[];        // rows upgraded (cracked) by this save, as they were
      createdUsernameIds: string[];
      createdAttemptIds: string[];
      attemptsBefore: CredAttempt[];          // rows whose result this save changed, as they were
      createdTriedPairIds: string[];
      createdVectorIds: string[];
    }
    ```

  - **Rust commands and api:**
    - `extraction_save(logEntryId, engagementId, summary, record)`;
    - `extraction_get(logEntryId) -> Option<Extraction>`;
    - `extractions_list(engagementId) -> Vec<Extraction>`;
    - `extraction_undo(logEntryId) -> Extraction`.

    `Extraction = { logEntryId, engagementId, summary, record, createdAt, undoneAt: number | null }`.
  - **Undo rule** (one transaction; a no-op if `undone_at` is already set):
    - delete created rows, except a created **credential** that has `updated_at > created_at` of the extraction, or that has attempts whose `log_entry_id` is a different entry. Those are kept.
    - a created **host** is kept when anything outside this record references it.
    - restore each `*Before` row only if the current row's `updated_at` (or `at` for attempts) is ≤ the extraction's `created_at`; a newer row was changed since, so leave it.
    - set `undone_at`.

- [ ] **Step 1:** Write the Rust tests:
  - `undo_deletes_created_rows`;
  - `undo_keeps_credential_edited_since` (Review Focus 2);
  - `undo_keeps_credential_proven_by_later_entry`;
  - `undo_restores_identity_and_os_snapshots`;
  - `undo_restores_attempt_result_before`;
  - `undo_twice_is_noop`;
  - `deleting_log_entry_cascades_extraction` (Review Focus 5).
- [ ] **Step 2:** Run `cargo test extractions`. Expected: FAIL.
- [ ] **Step 3:** Implement `extractions.rs` and the commands. Parse `record` with serde (camelCase), with the same field names as the TS type.
- [ ] **Step 4:** Run `cargo test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(log): extraction record with exact undo`.

### Task 3: Interpreter core and fixtures

**Files:**
- Create:
  - `src/engines/interpret/types.ts`, `src/engines/interpret/index.ts`, `src/engines/interpret/text.ts`;
  - `src/test/fixtures/interpret/README.md` (source and anonymisation rules);
  - `src/test/engines/interpret/core.test.ts`.

**Interfaces:**
- Produces (`types.ts`):

  ```ts
  export type HostRef = { ip: string } | { hostId: string } | { ranOn: true }; // ranOn = the entry's tagged/target host
  export interface FoundCredential { username: string; domain: string | null; type: 'password' | 'hash';
    secret: string; hashType: string | null; scope: 'domain' | 'local'; host: HostRef | null; source: string }
  export interface FoundAttempt { username: string; domain: string | null; secret: string; secretKind: 'password' | 'hash';
    host: HostRef; service: string; result: 'admin' | 'valid' | 'failed' | 'errored'; authMode: 'domain' | 'local' }
  export interface FoundCrack { hash: string; plaintext: string }
  export interface FoundUsername { username: string; domain: string | null; host: HostRef | null; source: string }
  export interface FoundVector { host: HostRef; title: string }
  export interface FoundTick { host: HostRef | 'engagement'; goalId: string; parser: string }
  export interface Interpretation { parsers: string[]; credentials: FoundCredential[]; attempts: FoundAttempt[];
    cracks: FoundCrack[]; usernames: FoundUsername[]; vectors: FoundVector[]; ticks: FoundTick[] }
  export interface InterpretInput { command: string; output: string }
  export interface Parser { id: string; detect(i: InterpretInput): boolean; parse(i: InterpretInput): Omit<Interpretation, 'parsers'> }
  export const EMPTY: Interpretation;
  ```

- `text.ts`: `normalize(output: string): string` strips ANSI SGR codes and turns CRLF into LF. `hasRedOnYellow(raw: string): boolean` is used by Task 7.
- `index.ts`: `PARSERS: Parser[]` (empty here; later tasks append) and `interpret(i: InterpretInput): Interpretation`. It runs every parser whose `detect` is true on the normalized output, concatenates their results, dedupes each list on its natural key, and lists the parser ids.

- [ ] **Step 1:** Write the tests:
  - `normalize strips ANSI and CRLF`: `normalize("\x1b[1;31;103mx\x1b[0m\r\ny")` → `"x\ny"`;
  - `interpret with no matching parser returns EMPTY with parsers []`;
  - `interpret dedupes credentials on username+domain+secret`, using two stub parsers registered in the test.
- [ ] **Step 2:** Run `npx vitest run src/test/engines/interpret/core.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the three files. Write the README listing the source paths and anonymisation rules from Global Constraints.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(interpret): interpreter core`.

### Task 4: Credential parsers (secretsdump, mimikatz, lsassy, hashcat, john)

**Files:**
- Create: `src/engines/interpret/{secretsdump,mimikatz,lsassy,cracked}.ts`; fixtures `src/test/fixtures/interpret/{secretsdump-sam,secretsdump-ntds,mimikatz-logonpasswords,mimikatz-dcsync,hashcat-show,john-show,lsassy}.txt`; `src/test/engines/interpret/credentials.test.ts`
- Modify: `src/engines/interpret/index.ts` (register)

**Interfaces:** Each file exports a `Parser` (ids `secretsdump`, `mimikatz`, `lsassy`, `cracked`), consumed through `interpret()`.

Rules the tests pin:
- **secretsdump:**
  - The section header decides scope: `Dumping local SAM hashes` → `scope:'local', host:{ranOn:true}`; `Dumping Domain Credentials` → `scope:'domain'`.
  - A line `user:rid:lm:nt:::` → `type:'hash', hashType:'NTLM', secret:<nt>`. The `domain\user` prefix sets the domain.
  - **Machine accounts** (names ending `$`, e.g. `DC01$`, and the `$MACHINE.ACC` line in LSA secrets, which is the dumped host's own account) are **filed**, with `machine: true` on `FoundCredential` (add the field, default false). They're never skipped: the DC's machine hash can DCSync and a server's enables silver tickets. *(Owner decision 2026-11-07.)*
  - An all-zero/empty NT hash (`31d6cfe0d16ae931b73c59d7e0c089c0`) is skipped.
  - Cached `$DCC2$` lines → `hashType:'DCC2'`.
  - LSA cleartext `DOMAIN\user:password` lines in the `Dumping LSA Secrets` section → `type:'password'`.
  - Ticks: `h-loot-hashes` on `{ranOn}`; NTDS also `h-loot-domain`.
- **mimikatz:**
  - `sekurlsa::logonpasswords` blocks → per `* Username / * Domain / * NTLM` an NTLM hash, and per `* Password` that isn't `(null)` a password.
  - `lsadump::sam` and `lsadump::dcsync` (`SAM Username` + `Hash NTLM:`) → hashes. Accounts ending `$` get `machine: true`.
  - Ticks `h-loot-hashes`; dcsync also `h-loot-domain`.
- **lsassy:** `DOMAIN\user  [NT] <hash>` / `[PWD] <password>` lines → as mimikatz (unverified).
- **cracked:**
  - hashcat `--show` lines `<hash>:<plain>`, including `$krb5tgs$…:<plain>` and `$krb5asrep$…:<plain>`;
  - john `--show` `<user>:<plain>` lines up to "N password hash(es) cracked";
  - john live lines `<plain>  (<user>)`.

  These produce `cracks` (for john, `hash` is empty and the username is used for matching in Task 9; store `{ hash: '', plaintext, username }` by adding an optional `username?: string` to `FoundCrack`).

- [ ] **Step 1:** Build the fixtures from the real sources. Search the vault labs for `Dumping local SAM hashes`, `sekurlsa::logonpasswords`, `lsadump::dcsync`, `--show`. Anonymise per Global Constraints and keep every structural line. lsassy is written from its documented format, marked unverified.
- [ ] **Step 2:** Write the tests, one per fixture, asserting exact `credentials`/`cracks`/`ticks`:
  - `secretsdump SAM gives local NTLM hashes on the target and skips machine accounts and the empty hash`;
  - `secretsdump NTDS gives domain hashes and ticks h-loot-domain`;
  - `machine accounts are filed with machine: true, including $MACHINE.ACC as the target host's account`;
  - `mimikatz logonpasswords gives NTLM and cleartext, never (null)`;
  - `mimikatz dcsync gives the domain hash`;
  - `hashcat --show pairs hash with plaintext`;
  - `john --show and live lines give user+plaintext`;
  - Review Focus 4: `a CRLF + ANSI copy of the SAM fixture parses identically`.
- [ ] **Step 3:** Run `npx vitest run src/test/engines/interpret`. Expected: FAIL.
- [ ] **Step 4:** Implement the parsers and register them.
- [ ] **Step 5:** Run again. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(interpret): credential parsers`.

### Task 5: Username parsers (kerbrute, nxc users / RID brute, rpcclient, lookupsid)

**Files:**
- Create: `src/engines/interpret/usernames.ts`; fixtures `{kerbrute,nxc-users,nxc-rid-brute,rpcclient-enumdomusers,lookupsid}.txt`; `src/test/engines/interpret/usernames.test.ts`
- Modify: `index.ts`

**Interfaces:** `Parser` id `usernames`. Patterns:
- **kerbrute:** `VALID USERNAME:\s+(\S+)@(\S+)` (unverified).
- **nxc `--users`:** rows under the `-Username-` header, `domain\user`.
- **RID brute and lookupsid:** `\d+: (\S+)\\(\S+) \(SidTypeUser\)` (lookupsid unverified).
- **rpcclient:** `user:\[(.+?)\] rid:\[` (unverified).

Username lists skip machine accounts: a bare `name$` with no secret has nothing to spray (credentials from dumps keep them, Task 4). Tick: `h-enum-ad-users` on the target host (`{ip}` from the nxc line or the command's target IP, else `{ranOn}`).

- [ ] **Step 1:** Fixtures: nxc ones from the backups/vault; the others written from documented formats, marked unverified.
- [ ] **Step 2:** Tests:
  - `each format yields its usernames with domain`;
  - `machine accounts and groups (SidTypeGroup) are skipped`;
  - `nxc login lines ([+]/[-]) are not usernames output`: the existing `credentials/nxc.ts` owns those.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement the parser.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(interpret): username lists`.

### Task 6: GTFOBins data and privesc parsers (SUID, `sudo -l`, getcap, cron/pspy)

**Files:**
- Create:
  - `src/engines/interpret/gtfobins.ts`: a bundled `GTFOBINS: Record<string, ('suid'|'sudo'|'capabilities'|'limited-suid')[]>` from GTFOBins (https://gtfobins.github.io, the `_gtfobins` repo), with a header comment giving the source and date;
  - `src/engines/interpret/privescLinux.ts`;
  - fixtures `{suid-find,sudo-l,getcap,pspy}.txt`;
  - `src/test/engines/interpret/privesc.test.ts`.
- Modify: `index.ts`

**Interfaces:** Parsers `suid`, `sudo`, `caps`, `cron`. Vector titles are exact strings:
- **SUID:** `SUID <bin> (GTFOBins)`, only when the basename is in GTFOBINS with `suid` (or `limited-suid`), and the path isn't one of the standard SUID set (`/usr/bin/{passwd,su,sudo,mount,umount,chsh,chfn,newgrp,gpasswd,pkexec,fusermount,fusermount3}`, `/usr/lib/openssh/ssh-keysign`, `/usr/lib/dbus-1.0/dbus-daemon-launch-helper`).
- **sudo:**
  - `sudo <bin> as <runas> (GTFOBins)` per `(runas) [NOPASSWD:] <path>` whose basename has `sudo`;
  - `sudo: full root (ALL : ALL)` for `(ALL : ALL) ALL` or `(ALL) ALL`; add ` NOPASSWD` when present.
  - `env_keep+=LD_PRELOAD` → `sudo LD_PRELOAD kept`.
- **caps:** `Capability <cap> on <bin> (GTFOBins)` for `cap_setuid` / `cap_dac_read_search` / `cap_sys_admin` on a binary with `capabilities`.
- **cron:** a vector only when the same paste proves the job's script is writable by others: an `ls -l` line for that exact path whose other-write bit is `w`. Title: `Writable root cron script <path>`. pspy `CMD: UID=0` lines give the candidate paths.

Ticks on `{ranOn}`: `h-pe-lin-suid`, `h-pe-lin-sudo`, `h-pe-lin-caps`, `h-pe-lin-cron`. A tick happens whenever the section was parsed, even when there are no vectors, because the step was done.

- [ ] **Step 1:** Fixtures from Module 18 labs (sudo -l, suid, getcap, crontab).
- [ ] **Step 2:** Tests:
  - `standard SUID binaries file nothing`;
  - `find with SUID gives 'SUID /usr/bin/find (GTFOBins)'` (use the exact path from the fixture);
  - `a SUID binary without a GTFOBins entry files nothing`;
  - `sudo NOPASSWD vim gives the GTFOBins vector`;
  - `(ALL : ALL) ALL gives full root`;
  - `cap_setuid on python3 gives the capability vector`;
  - `a root cron job without proof of writability files nothing`;
  - `with a world-writable ls -l line it files the vector`.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement the parsers.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(interpret): Linux privesc parsers with bundled GTFOBins`.

### Task 7: PEAS (linPEAS and winPEAS)

**Files:**
- Create: `src/engines/interpret/peas.ts`; fixtures `linpeas-ansi.txt` (when one exists with colour codes), `linpeas-plain.txt`, `winpeas-plain.txt` (trimmed to the relevant sections, ≤ 400 lines each); `src/test/engines/interpret/peas.test.ts`
- Modify: `index.ts`

**Interfaces:** Parser `peas`.
- **Detection:** linPEAS banner or `╔══════════╣`, or winPEAS banner or `ÉÍÍÍ`/`═══`.
- **Rule** (this plan's resolution of the spec's open point):
  - **ANSI present:** every line printed red-on-yellow (`\x1b[1;31;103m`) becomes a vector `PEAS: <line trimmed, ≤ 80 chars>`.
  - **ANSI absent** (the usual case for a terminal copy):
    - Linux: run the Task 6 SUID / sudo / caps rules on the matching PEAS sections;
    - winPEAS: file only `SeImpersonatePrivilege` / `SeAssignPrimaryTokenPrivilege` / `SeBackupPrivilege` / `SeDebugPrivilege` (as today's whoami vectors, same titles), `AlwaysInstallElevated set` when both registry lines show `1`, and `Unquoted service path <service>` when winPEAS prints "No quotes and Space detected" for a service.
- **Ticks:** `h-pe-lin-auto` or `h-pe-win-auto` on `{ranOn}`.

- [ ] **Step 1:** Fixtures from the backup's ~195 KB PEAS outputs and the Module 17/18 labs, trimmed.
- [ ] **Step 2:** Tests:
  - `plain linPEAS files only GTFOBins-backed vectors`, asserting the exact list for the fixture;
  - `ANSI linPEAS files the red-on-yellow lines`;
  - `plain winPEAS files SeImpersonate and the unquoted path`;
  - `a linPEAS fixture with no findings files no vectors but still ticks h-pe-lin-auto`.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement the parser.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(interpret): PEAS signal-only parsing`.

### Task 8: nxc results through the interpreter, and tick resolution

**Files:**
- Create: `src/engines/interpret/nxcResults.ts`, `src/engines/interpret/resolve.ts`, `src/test/engines/interpret/resolve.test.ts`
- Modify: `index.ts`

**Interfaces:**
- `nxcResults` parser: wraps the existing `parseNxcAuthResults` (`src/engines/credentials/nxc.ts`) into `FoundAttempt[]`, with secrets from the command via the existing `knownSecretsOf`. Tick: `h-vuln-spray` on each host with any result.
- `resolve.ts`: `resolveInterpretation(i: Interpretation, ctx: { entryHostIds: string[]; hosts: Host[] }): ResolvedInterpretation`. It turns every `HostRef` into a `hostId`, or `{ newIp: string }` when the IP is unknown **and** the item proves something (credentials, `admin`/`valid` attempts, vectors, usernames). Failed or errored attempts on unknown IPs are dropped and counted as `droppedUnknown`. `{ranOn}` resolves to the entry's first tagged host, or is dropped when there is none.
- Output: `ResolvedInterpretation = { newIps: string[]; … same lists with hostId: string | null (null = engagement) …; droppedUnknown: number }`.

- [ ] **Step 1:** Tests:
  - `a valid login on an unknown IP yields newIps`;
  - `failed-only lines on an unknown IP yield no host and count droppedUnknown`;
  - `ranOn with no tagged host drops the item`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `nxcResults.ts` and `resolve.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(interpret): nxc results and host resolution`.

### Task 9: Apply on save, with no pre-save toggles

**Files:**
- Create: `src/features/capture/applyInterpretation.ts`, `src/test/features/capture/applyInterpretation.test.ts`
- Modify:
  - `src/features/capture/saveCapture.ts`;
  - `src/features/capture/CaptureForm.tsx` (remove `IntakePreview` and the add-as-host UI);
  - `src/features/capture/resolve.ts` (drop `intakeToggles` and `addIps`);
  - `src/features/capture/useCaptureStore.ts`;
  - `src/features/checklist/ticks.ts` (accept output ticks).
- Delete: `src/features/capture/IntakePreview.tsx` and its tests.

**Interfaces:**
- Consumes:
  - `interpret` and `resolveInterpretation` (Tasks 3–8);
  - `api.triedPairsUpsert` and `tried_pair_promote` (exposed as `api.triedPairPromote`) from Task 1;
  - `api.extractionSave` (Task 2);
  - existing `api.credentialCreate`, `credentialCrack`, `usernameCreate`, `credAttemptsUpsert`, `vectorUpsert`, `hostCreate`, `servicesUpsertScan`, `hostIdentitySet`, and `afterEntrySaved`.
- Produces:
  - `applyInterpretation(engagementId, entry: LogEntry, r: ResolvedInterpretation, scanAndIdentity: {…what saveCapture already computes…}): Promise<{ summary: ExtractionSummary; record: ExtractionRecord }>`;
  - `saveCapture` returns `{ entry: LogEntry; summary: ExtractionSummary | null }` (null when nothing was filed). Update its callers.
  - `ticks.ts`: `writeEntryTicks` also takes `outputTicks: Tick[]` with `commandId: 'out:<parser>'`. `ticksForEntry` stays as is; the two lists merge with dedupe by owner and goal, and command ticks win.

**Rules:**
- **Ordering:** create the hosts for `newIps` first, then the credentials.
  - Dedupe with `findDuplicateCredential`; a duplicate isn't "created".
  - A `valid`/`admin` attempt with no stored credential creates the credential.
  - A `failed` attempt with no stored credential becomes a tried pair.
  - Every created credential calls `triedPairPromote`.
- **Cracks:** match a stored hash credential's `secret`, or for john the username plus the hash type when unique. Then `credentialCrack` and snapshot it into `credentialsBefore`.
- **Snapshots:** for scan, OS and identity, take the "before" snapshots inside the same flow.
- **Summary wording** (exact):
  - win: `${user}:${secretShown} works on ${SERVICE}, ${hostName}`, where `secretShown` is the password, or `NT hash` for hashes; append ` (admin)` for admin;
  - vector: `${title} on ${hostName}`;
  - machine account of a DC (the account name without `$` matches a host with ports 88 and 389 open, the same test as the domain-admin cover): `${NAME}$ hash: can DCSync`; other machine hashes go in counts as `${n} machine account hash(es) added`;
  - counts: `${n} failed attempt(s) recorded`, `${n} username(s) added`, `${n} hash(es) added`, `New host ${ip}`, `${n} result(s) on hosts not in this engagement`, `${hostName} answered on ${newIp}` (an IP change, applied as today by the nxc intake);
  - ticks: `Ticked '${goalTitle}' on ${ownerName}`.
- **Nothing new:**
  - If something parsed but nothing was new, the summary is `{ wins: [], counts: ['Nothing new: already recorded'], ticks: [] }` and is still saved.
  - If nothing parsed at all, the summary is null and no extraction row is written.

- [ ] **Step 1:** Write the tests (mock `api`):
  - `nxc spray: valid pair becomes a credential and win line; failed unknown-secret pairs become tried pairs and a count`, using the screenshot case: ronan valid on SSH Quartz; Liam.Brooks and reid failed;
  - `a valid pair later promotes its tried pair`;
  - `secretsdump on an unknown IP creates the host and lists 'New host'`;
  - `same paste twice files nothing new` (Review Focus 1);
  - `mixed paste: nxc spray then sudo -l files both on the right hosts` (Review Focus 3);
  - `the record lists every created id and before-snapshot`.
- [ ] **Step 2:** Run `npx vitest run src/test/features/capture`. Expected: FAIL.
- [ ] **Step 3:** Implement, and remove the preview, the toggles and add-as-host.
  - Keep the failure-reporting shape of `saveCapture` (`PartialSaveError`).
  - Delete `INTAKE_FAILED` and `VECTORS_FAILED` in favour of one `EXTRACTION_FAILED = "Saved the entry, but Raven couldn't file what it found. Paste the output again to retry."`.
  - Update the existing capture tests that asserted the preview.
- [ ] **Step 4:** Run `npx vitest run`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(capture): file extracted output automatically on save`.

### Task 10: Save summary toast, the "Extracted" line, and Undo

**Files:**
- Create:
  - `src/features/capture/SaveSummary.tsx` (toast);
  - `src/features/capture/useSaveSummaryStore.ts`;
  - `src/features/log/ExtractedLine.tsx`;
  - `src/test/features/capture/saveSummary.test.tsx`.
- Modify:
  - `src/features/vault/VaultGate.tsx` (mount `<SaveSummary />` next to `<ArsenalDrawer />`);
  - `src/features/log/LogEntryBody.tsx` (render `ExtractedLine` under the output);
  - the capture submit path (push the summary to the store);
  - `src/features/log` queries (fetch `extractionsList` per engagement and index it by entry id).

**Interfaces:**
- `useSaveSummaryStore`: `{ current: { entryId: string; summary: ExtractionSummary } | null; show(entryId, summary): void; close(): void }`.
- `undoExtraction(entryId)`: calls `api.extractionUndo`, then `afterEntrySaved(engagementId, entry, entryId)` so ticks and the board recompute (fact ticks revert on their own; the entry's output ticks are removed with `removeEntryTicks`), then invalidates the queries.
- **Toast:**
  - fixed bottom-left, `role="status"`;
  - wins in the accent colour, then counts and ticks in muted text;
  - an `X` (`aria-label="Close summary"`) and an `Undo` button;
  - closes after exactly 5000 ms, and the timer pauses while hovered or focused;
  - a new save replaces the current toast.
- **Extracted line:**
  - collapsed: `Extracted: <first win or first count> · +N more`, with an `Undo` button;
  - expanded: all lines;
  - after Undo it reads `Extracted (undone)` in muted text, with no button.

- [ ] **Step 1:** Write the tests (fake timers):
  - `toast closes after 5000ms`;
  - `hover pauses the timer`;
  - `X closes at once`;
  - `wins render with the accent class before counts`;
  - `Undo calls extractionUndo then afterEntrySaved`;
  - `ExtractedLine shows undone state`;
  - `no summary means no toast`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(log): save summary with undo`.

### Task 11: Audit coverage and full verification

**Files:**
- Modify: `src/audit/fakeApi.ts` (tried pairs, extractions, undo), `src/audit/fixtures.ts` (one entry with an extraction, one tried pair), `audit/regressions.spec.ts`

- [ ] **Step 1:** Add the regression tests:
  - `saving nxc spray output shows the win in the toast and the Extracted line, and Undo removes the credential`;
  - `the toast never covers the capture Save button or the hint line`, comparing bounding boxes at 900 and 1280 wide;
  - `tried pairs render muted in the test matrix with no sideways scroll`.
- [ ] **Step 2:** Run `npm run audit:visual`. Expected: all pass.
- [ ] **Step 3:** Run `npx tsc -b && npx eslint . && npx vitest run && (cd src-tauri && cargo test)`. Expected: all pass.
- [ ] **Step 4:** Commit: `test(audit): interpreters and save summary`.
