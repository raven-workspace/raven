# Raven: output interpreters and Payloads (phase 2, project 2b)

Status: draft for review, 2026-11-07. Branch `interpreters-payloads`.

## 1. Why

There are two halves.

**Interpreters.** During an attack, the owner pastes tool output into the log anyway, because the log has to record it. Today Raven extracts only part of that output:
- nmap and rustscan become services;
- nxc auth results and Kerberoast/AS-REP hashes become credentials;
- `whoami` and `id` set the host's identity and privesc vectors.

Everything else (secretsdump, mimikatz, cracked hashes, username lists, PEAS, `sudo -l`, SUID, capabilities and cron) stays as text that must be retyped elsewhere. The owner wants Raven to read the output and file what it proves.

**Payloads.** Mid-attack, the owner needs a working payload now: a reverse shell, a file transfer or a SQL injection payload. The old app's generator offered about 90 shells, many of which fail when pasted as-is. The owner's lab notes record those failures:
- bare `bash -i` injected without `bash -c`;
- `nc -e` with OpenBSD nc, or with a staged `nc.exe` built without `-e`;
- PowerShell one-liners whose quoting breaks in cmd or SQL;
- UTF-8 instead of UTF-16LE base64;
- SQL quotes that weren't doubled.

The owner rarely writes SQL outside the exam and often has to look SQL payloads up. Payloads becomes its own surface, separate from the Arsenal. The Arsenal is an occasional reference; a payload is needed in almost every attack, usually mid-attack.

Both halves will be tested in the PEN-200 labs straight after this round.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Saving a log entry files everything Raven is sure of, automatically:
   - credentials and usernames;
   - failed attempts (into the test matrix);
   - privesc vectors;
   - checklist ticks.
2. One summary per save says what was filed and where. It shows for 5 seconds, can be closed early, stays on the log entry afterwards, and can be undone as a whole.
3. A Payloads surface:
   - **Drawer (`P`):** the quick view.
   - **Workbench:** the full-screen view, reached from the drawer the way the Arsenal's full-screen browse is.

   It opens on the best-fit payload for the host and situation, explains every part of it, and supplies only payloads that work when pasted as-is in their stated context.
4. Generators:
   - **Reverse shell, file transfer and SQL injection:** the most used.
   - **msfvenom, PowerShell encoder and shell upgrade:** the rest.

**Non-goals**
- New interpreters beyond the list in §3.
- Network calls. Everything is offline, built from bundled lists (GTFOBins data included).
- Report generation (phase 3).

**Anti-goals.** Doing any of these makes the round a failure even if it technically works:
- **Filing anything Raven isn't sure of.** A wrong credential or vector is worse than none. When in doubt, the raw output stays in the log and nothing is filed.
- **A wall of chips or toggles before save.** That includes the current nxc pre-save preview, which this round removes.
- **Creating a credential from a failed attempt.** Today the preview offers "Add Liam.Brooks with a password on Quartz" for a failure, and that has to stop.
- **Offering a payload that would fail as pasted in its stated context,** or one whose parts aren't explained.
- **Changing the Arsenal's rules.** In the Arsenal the host only fills placeholders and never filters or ranks. Payloads is deliberately different (§5.2), and the difference must not leak into the Arsenal.

## 3. Interpreters

### 3.1 Behaviour on save (owner's decisions)

- **The raw output is always saved to the log, unchanged.**
- **Extraction applies automatically on Save.** The pre-save intake preview (`IntakePreview`, toggles per credential) goes away.
- **Only proven information is filed:**

  | Source | What gets filed |
  |---|---|
  | Successful logins | a credential with its access |
  | Dumps (secretsdump, mimikatz/lsassy) | credentials and hashes |
  | Cracked output | upgrades an existing hash credential to its password |
  | Username lists | usernames |
  | PEAS findings | only PEAS's red-on-yellow ("95% a privesc vector") findings become privesc vectors |
  | SUID, `sudo -l` and capability binaries | a privesc vector only when the binary has a GTFOBins entry for that mechanism |
  | Everything else | stays in the raw log only |

- **Failed attempts never create a credential.** They are recorded in the test matrix as Failed for that user, service and host, so they aren't sprayed again, and they appear in the summary as a count only.
  - **When the secret isn't stored as a credential** (a spray of a guessed password), the failure is kept as a **tried pair**: username plus secret, service, host, Failed. This is a schema change, because today every attempt needs a stored credential (`cred_attempts.cred_id` is NOT NULL). Tried pairs show muted in the test matrix and are never offered as credentials. When a later save proves the same pair valid, it becomes a real credential and its tried-pair row goes away. *(Owner's decision.)*
- **Unknown IPs.** When output proves something real on an IP that isn't a host yet (a valid login, a dump, an open port), Save **creates the host automatically** and lists it in the summary ("New host 10.10.20.31"). A failed-only IP never creates a host. The capture form's per-IP "+ add as host" tick goes away with the other pre-save toggles. *(Owner's decision; dropping the tick is my call.)*
- **IP changes** (a host answered on a new IP) are applied as today and reported in the summary.
- **Auto-ticks.** Parsed output ticks the checklist steps it proves, with the log entry as evidence, through the existing auto-tick and evidence mechanism. Examples:
  - secretsdump NTDS from the DC ticks the hash-dump step and the domain-admin cover;
  - a valid login ticks the credential-reuse step on that host;
  - `whoami` showing SYSTEM/root ticks privesc.

  Ticks are listed in the summary.
  - **No new checklist steps this round.** Parsed output ticks only steps that already exist (for example the engagement-level reuse/spray step, the hash-dump step and the DA cover). Where no step exists ("whoami shows SYSTEM"), it ticks nothing; Raven records the identity and moves on. Ticks from parsed output don't need a matched library command. The plan lists the exact output-to-step mapping. *(My call.)*

### 3.2 Save summary

- **Toast.** A toast appears after Save and stays **5 seconds**, with an **X** to close it early and an **Undo**.
- **Order.** Wins come first, in the accent colour: a new working credential ("ronan:CopperKite71 works on SSH, Quartz"), a new privesc vector, a domain-admin credential. Routine counts follow in muted text: "3 failed attempts recorded · 41 usernames added · ticked 'Dump NTDS' on DC01". During a long session the owner has to notice a win among failures, and this toast is their summary of the run.
- **Extracted line.** The same summary is stored on the log entry as an **"Extracted"** line under the output, so it can be read later. It carries its own **Undo**, because a mistake can be noticed after the toast is gone.
- **Undo** reverses everything that save filed automatically: hosts it created, services and OS from scans, identity (restored to its previous value, so it needs a snapshot), credentials, usernames, attempts and tried pairs, vectors and ticks, including today's command-matched ticks. The summary lists all of the same things. *(My call: one Undo for everything automatic, matching "what went where".)*
- **Editing** a saved entry's output doesn't re-run extraction; only Save does. *(My call.)*
- Undo never touches the log entry itself. It must be exact. A credential the owner has edited since, or one that a later save also proved, must not be destroyed: undo removes only this entry's contribution. *Builder's call:* how provenance is tracked (a per-entry extraction record is the obvious shape).
- **Nothing extracted.** No toast and no Extracted line.

### 3.3 Interpreters in scope

**Credentials and usernames**
| Tool | Input | Files |
|---|---|---|
| secretsdump | SAM, LSA, cached and NTDS sections | local or domain credentials (NT hash; LM ignored when empty); machine accounts (`$`) as their own credentials or skipped (builder's call, stated in the plan); the owning host from the target or "ran on" |
| mimikatz | `sekurlsa::logonpasswords`, `lsadump::sam`, `lsadump::dcsync` | NT hashes and cleartext passwords (skip `(null)`), with user and domain |
| lsassy | default output | as mimikatz |
| hashcat | `--show` output and the final status lines | cracked password matched to an existing hash credential, which is upgraded |
| john | `--show` output and cracked lines | as hashcat |
| kerbrute | `userenum` "VALID USERNAME" lines | usernames |
| nxc | `--users` and `--rid-brute` | usernames (nxc login results are already parsed and stay) |
| rpcclient / lookupsid | `enumdomusers`, `(SidTypeUser)` lines | usernames |
| GetUserSPNs / GetNPUsers | roast hashes | already parsed; keep |

**Privesc (Linux and Windows)**
| Tool | Files |
|---|---|
| linPEAS / winPEAS | only red-on-yellow findings (ANSI colour codes when present, otherwise the PEAS text markers for 95% findings; builder confirms against fixtures) |
| SUID `find` output | binaries with a GTFOBins SUID entry |
| `sudo -l` | entries whose binary has a GTFOBins sudo entry, plus `NOPASSWD` and `(ALL : ALL) ALL` cases |
| `getcap` | `cap_setuid`/`cap_dac_read_search` etc. on binaries with a GTFOBins capabilities entry |
| cron (`/etc/crontab`, `crontab -l`, pspy `CMD: UID=0`) | root jobs running a script the current user can write, only when the output proves it is writable; otherwise nothing |
| `whoami /priv` | already parsed (SeImpersonate etc.); keep |

**Verification status.** Real output exists for nearly every tool:
- the owner's PEN-200 lab notes: the owner's lab notes (outside the repo);
- old Raven backups: a file outside the repo, a file outside the repo.

**No real samples yet:** lsassy, kerbrute, rpcclient/lookupsid and pspy. Their parsers are built from each tool's documented format and marked unverified. The owner will capture real output in the next lab, and those parsers are fixed against it.

### 3.4 Test fixtures

Every parser is tested against **real output taken from the sources above**, anonymised before it enters the repo:
- IPs → 10.10.x.x;
- names and domains → stock values;
- hashes and passwords → synthetic values of the same shape.

Real data never enters the repo (PRODUCT.md). Each parser also needs negative fixtures that must file nothing:
- PEAS's non-highlighted findings;
- a SUID binary with no GTFOBins entry;
- a failed nxc line.

## 4. Payloads surface

### 4.1 Layout (owner's decision)

The layout mirrors the Arsenal: a drawer for quick use and a full-screen view.

- **Drawer (`P` from anywhere unlocked).** A right-edge drawer; the host page stays visible.
  - Generator tabs across the top: Reverse shell · Transfer · SQL · msfvenom · Encode · Upgrade.
  - Context chips: host, "where you paste it", port. Each says where it came from ("From nmap (IIS 10) and your 14:02 log entry").
  - Then: best fit, listener, payload, "what each part does", and "also fits / N don't fit here: show".
  - Hint line: ↵ copy payload · `⌥L` copy listener · ⇥ next fit · generator switch · Esc.
- **Workbench (full screen).**
  - **Left column, "Raven's read":** target, OS, where you paste it (as buttons), LHOST/LPORT, exam rules, and the generator list.
  - **Right column:** best fit as numbered steps (1 listener on Kali, 2 the payload with its context named), what each part does, and the folded "doesn't fit" line.
- **Reference sketches:** `.impeccable/mocks/decision/drawer.html` and `workbench.html` (1440×900). They fix structure and hierarchy, not exact values.
- **Visual system:** the Ink theme as it stands, with grid layouts.

### 4.2 Context and fit

Payloads reads the engagement to choose and rank what fits. This is deliberately unlike the Arsenal.

**Inputs:**
- host OS;
- services (IIS → ASPX, Tomcat → WAR, Apache/PHP → PHP, MSSQL 1433 / MySQL 3306 / Postgres 5432 → that engine);
- the prompt seen in the host's latest pasted output (`PS C:\>`, `C:\>`, `$`, `#`) or a logged web-shell URL;
- tools proven present or absent by parsed output (python3, nc, powershell);
- payloads that failed on this host before. Copy-and-log (⌘↵) stamps the payload's id on the log entry, and that entry counts as failed when it's marked "returned nothing" or its output shows the payload erroring. Raven doesn't guess failures from command text. *(My call.)*
- tools on the box, taken only from parsed output that proves them (PEAS's tool list, `which` output);
- exam rules (raw stageless shells only; no meterpreter);
- LHOST/LPORT from settings, editable.

**Output:**
- one best fit, open and ready to copy;
- other fitting payloads one key away (⇥);
- payloads Raven *knows* won't work, folded behind one line ("2 don't fit here: show") with the reason on each ("OpenBSD nc has no -e", "returned instantly here at 14:05"). They are never hidden completely, in case Raven is wrong.

The owner can override every inferred value. The override sticks for that host until changed.

### 4.3 The "works as pasted" contract

Each payload declares its **context**:
- Linux shell prompt;
- a command injected into a program or exploit argument;
- URL parameter / form field;
- PHP `system()`;
- Windows cmd.exe;
- PowerShell prompt;
- web shell `?cmd=`;
- SQL string (`xp_cmdshell`, `COPY … FROM PROGRAM`);
- macro.

The generator produces it already wrapped and encoded for that context. Rules from the owner's lab evidence and the Field Manual card `02-Cards/Shells-and-Transfers/Reverse-Shells.md`, which is this generator's design contract:
- **Linux, outside a real bash prompt:** wrap in `bash -c '…'`; in a URL, encode `>` and `&`. The fallback is mkfifo plus nc, never `nc -e`.
- **Reaped parent processes** (UDF, `popen`): a backgrounded `( … ) &` variant.
- **Windows:** `powershell -nop -w hidden -e <UTF-16LE base64>` is the default. Raven does the encoding itself (no `iconv` step for the owner). `nc.exe -e` only as an alternative, with a note that the `nc.exe` must be a build that has `-e`.
- **Layered contexts:** double single quotes inside SQL strings; in a URL, `-` becomes `%2d`, `+` stands for a space, and `%26` for `&`. The injected part stays small; large payloads are hosted and fetched with an IEX cradle (powercat or a Nishang one-liner), with the serve command supplied too.
- **Listener:** the matching `penelope -O -p PORT` (the owner's default), with `rlwrap nc -lvnp` as the fallback.
- **Ports:** 443 and 80 are suggested first, as egress-safe.
- **Stale IPs:** payload files with LHOST baked in (`rev.ps1`, exe, lnk) warn when LHOST has changed since they were generated.

Every payload has a **"what each part does"** list: one line per flag or part, saying what it does and any trap ("-e must be UTF-16LE base64; plain UTF-8 silently fails").

**Tests:**
- every generated payload, for every context, has a test asserting its exact output;
- encoders are tested round-trip (UTF-16LE base64 decodes back to the command; URL encoding matches what the lab used);
- each failure in the owner's lab notes has a regression test proving Raven never produces the failing form for that context.

### 4.4 Generators

Payload content (templates, wrapping rules, explanations and the SQL walkthrough) is **written in code**, not imported from the vault. "Works as pasted" needs exact tests, and vault edits could break the wrapping. The Field Manual cards named here are the sources it is written from. *(My call.)*


1. **Reverse shell.** The contract in §4.3.
   - **Linux:** `bash -c` with `/dev/tcp`, mkfifo plus nc, python3, PHP.
   - **Windows:** `powershell -e`, powercat cradle, Nishang cradle, `nc.exe`.
2. **File transfer.** Moves here from the Arsenal (the existing `transfer.ts` engine and `TransferGenerator`). It takes on the same context and fit logic: OS, tools present, PowerShell available. The Arsenal's "Transfer a file" entry becomes a link that opens Payloads on Transfer.
3. **SQL injection.** The owner uses SQL rarely and needs all three of:
   - **Walkthrough:** the attack as steps, each building on the last:
     1. detect (error, boolean and time-based);
     2. column count (`ORDER BY` / `UNION SELECT NULL…`);
     3. find which columns are reflected;
     4. extract version, then databases/tables/columns, then rows.
   - **Shells and files:**
     - MSSQL: enable and use `xp_cmdshell`;
     - Postgres: `COPY … FROM PROGRAM`;
     - MySQL: `INTO OUTFILE` to write a web shell, and `LOAD_FILE` to read.
   - **Engine syntax:** MSSQL, MySQL, PostgreSQL, Oracle and SQLite, chosen from the port or a logged error message. Every payload is written in that engine's syntax: comments, string joining, sleep, version, `LIMIT`/`TOP`.
   - **Injection point:** URL parameter (encoded), form field, or a direct client session (`impacket-mssqlclient`, `mysql`, `psql`), which needs no injection wrapping.
   - **Field Manual sources:** `02-Cards/Web/SQL-Injection.md`, `MSSQL-Error-Based-SQLi.md` and `SQLi-to-Code-Execution.md`, plus the Module 10 labs.
   - **Explanations are a first-class part,** since they double as SQL teaching: what `UNION` requires, why `NULL`, what `--` and `#` do.
4. **msfvenom.** Stageless `shell_reverse_tcp` only, because of the exam: exe, elf, aspx, war, dll and hta. The architecture comes from the host, with a note that Veil and Shellter need x86. The serve or upload step comes from Transfer.
5. **Encode PowerShell.** Any command to `powershell -e <UTF-16LE base64>`, with the decoded text shown beside it.
6. **Upgrade a shell.** The python3 PTY, `script`, `stty raw -echo; fg` and `stty rows/cols` steps (Linux), and a note that penelope does this automatically. Includes the `export HOME=…` fix the owner hit on Vega.

### 4.5 Keyboard

- **`P`:** opens or closes the drawer from any unlocked screen. In the Workbench it focuses the generator list.
- **↵:** copies the payload.
- **`⌥L`:** copies the listener. (`L` is capture; `⌥L` matches `⌥H` and `⌥C`.) Single-letter keys inside Payloads must never shadow global keys (`L`, `N`, `A`, `H`, number keys).
- **⇥:** next fit.
- **⌥H / ⌥C:** host and credential pickers, as in the Arsenal.
- **Generator switch:** the builder chooses the keys, without clashing with existing bindings.
- **Copy guard:** the Arsenal's guard applies to every payload with an unfilled placeholder.
- **Copy and log:** copying a payload offers ⌘↵ "copy and log" on a host, as in ⌘K.

## 5. Constraints

- **Stack:** Tauri 2, React 19, TypeScript, Tailwind 4 and zustand. The UI uses CSS grid first.
- **Data safety:** any schema change (for example, extraction provenance for Undo) needs a migration, and a backup is taken before migrating. Stored data is real lab data.
- **Offline:** GTFOBins data is bundled as a static list (binary → mechanisms: suid, sudo, capabilities), with its source and date recorded.
- **Exam rules:** banned techniques stay hidden, and Payloads never offers meterpreter.
- **Audit:** `npm run audit:visual` must cover the drawer and the Workbench (layout, focus and no sideways scroll at 900, 1100, 1280 and 1440 wide), plus regression tests for the save summary.

## 6. Decided in conversation (owner)

- Credential interpreters are part of this round.
- Extraction applies automatically, with a summary and Undo; the pre-save chips go away.
- Failed attempts go to the test matrix and never become credentials.
- The summary shows for 5 seconds, can be closed early, and is kept on the log entry.
- PEAS and privesc filing means signal over noise: red-on-yellow findings and GTFOBins matches only.
- Auto-ticks come from parsed output.
- Payloads is its own surface, with an Arsenal-style drawer and a Workbench full-screen view, and opens on the best-fit payload.
- Generator use is led by reverse shells and file transfers.
- Fit is a middle ground: the best match first, and known misfits folded, never hidden.
- Every payload works as pasted and explains every part.
- SQL payloads are in scope, covering the walkthrough, shells and files, and engine syntax.
- A failed pair whose secret isn't a stored credential is kept as a tried pair (schema change), never as a credential.
- Output that proves something on an unknown IP creates that host automatically; failed-only IPs never do.

## 7. Left to the builder

- How extraction provenance and Undo are stored.
- Whether machine accounts from secretsdump are kept or skipped (state it in the plan).
- Key choices for switching generators.
- How PEAS highlights are detected without ANSI codes (confirm against fixtures).
- The visual details beyond the reference sketches.
