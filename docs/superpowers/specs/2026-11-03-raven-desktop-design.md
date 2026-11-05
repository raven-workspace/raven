# Raven (desktop): design

Date: 2026-11-03. Status: draft for the user's approval.

## 1. Intent: what this is and why

Raven is the user's personal work surface for penetration testing. It covers the OSCP exam (not yet booked; realistically early 2027), the OffSec challenge labs before it, and real client engagements after it. It is single-user, local-only, and runs as a macOS desktop app.

It replaces two things:

1. **The old Raven** (repo the old app's repo). It is a React/IndexedDB web app that grew out of an HTB/THM box tracker. Its newest parts are good and fit engagement work: the command log, engagement credentials, the goal-based checklist with auto-tick, and the command library. Everything around them is CTF-shaped, cluttered and redundant, and browser storage is a dead end for a long-term tool.
2. **The user's Obsidian notes for engagements.** Today Claude writes up the user's pasted output into Obsidian host notes (for example a host note in Obsidian). Claude isn't available during the exam, so Raven alone has to be fast enough to record everything by hand, as it happens.

Raven has four jobs:

1. Keep the user organized **during** an engagement: where things stand, what's proven, what they're thinking.
2. Keep them organized **across** engagements: past ones and lookups.
3. Produce a **polished report** afterwards from what was recorded.
4. Hold the **command and technique references** needed for the exam and for real work.

**The user has ADHD and autism.** Speed, low friction and minimal distraction come before everything else, most of all in a time-limited exam. This is a rule for every decision below:
- what's needed stays in view, never below the fold;
- Raven fills in what it can;
- capture is one paste and a keystroke;
- nothing competes for attention.

This design builds a **new app in a new repo** (this repo), not a rework of the old one. The engines from the old repo are ported (see §9). Everything else is left behind.

## 2. Goals, non-goals, anti-goals

**Goals**
- The engagement is the unit of work. Home is a dashboard of engagements, not a list of every box.
- Capturing work is near-instant:
  - commands with output;
  - screenshots;
  - browser and Burp work;
  - observations, and "returned nothing" markers.
- Field notes and working theories are always one key away, and theories don't get lost.
- The record per host reads as a story of steps, like the user's Obsidian notes, and feeds the report directly.
- Facts get corrected as they're proven, e.g. a service nmap guessed vs. what it really is.
- Findings hold everything a report needs.
- What's private (lessons, operator mistakes) never reaches a client.
- Client data is encrypted at rest.
- The UI is sleek, high-contrast and calm (§8).

**Non-goals**
- HTB/THM tracking, tracks and catalogs, CTF difficulty and platforms, certification tracking, time-spent stats.
- Analytics, gamification, streaks, spaced repetition.
- Points or score tracking. OffSec moves to scaled scoring after 2026-12-01, and raw points don't map to a result.
- Hebrew/RTL support and i18n of any kind.
- Sync between machines and multiple users.
- A browser build. The UI is only viewed in the desktop dev window and the built app.
- Windows and Linux builds, for now.
- Any network calls, telemetry or cloud features.
- The old CPTS field manual content, the Writeup Studio, the exam simulator's extras (burndown, bio breaks, quick-action drawer), and the old global variables bar.

**Anti-goals (failure even if it "works")**
- **It looks generic.** A Tailwind/shadcn template with swapped tokens.
- **Logging a command takes more than a paste and a keystroke** in the common case, or the user has to retype titles to keep the log useful.
- **Important information sinks below the fold** or into a box nobody reopens. This is what killed the old field-notes box and the ":81 reverse proxy" theory.
- **Private content reaches a report:** lessons learned, failures from operator inexperience.
- **Raven claims a finding or a fact on its own.** Suggestions are always accepted or dismissed by the user.
- **The import or a migration loses or garbles real data.**

## 3. Platform and stack

| Choice | Decision | Whose |
|---|---|---|
| Form | macOS desktop app; dev viewed with `npm run tauri dev` (hot reload), no browser mode | user (desktop + dev window); my call (macOS only) |
| Shell | **Tauri 2** (Rust backend, system WebView) | my call, user did not object |
| UI | React + TypeScript + Vite. Tailwind is allowed as a utility layer, but the visual design is custom (§8) | user (Tailwind OK, no generic look); my call (React/TS, so engines and tests port) |
| Database | **SQLite, encrypted with SQLCipher**, one file in the app data directory, accessed from the Rust side | user (real DB, encrypted); my call (SQLCipher) |
| Evidence files | Screenshots and attachments are stored **inside the encrypted database** as blobs, so a backup is one encrypted file | my call |
| Tests | Vitest for TS engines and UI; Rust unit tests for the storage layer | my call |

**Setup:** the user's Mac needs the Rust toolchain and Xcode Command Line Tools. The builder checks for and installs these as the first task.

## 4. Security and data

- **Unlock.** A password is set on first launch, and every launch asks for it. The key is derived from the password (Argon2id) and opens the SQLCipher database. There is no recovery. A one-time warning at setup says so plainly.
- **Auto-lock** after inactivity. Default 30 minutes, adjustable in settings. Locking clears the key from memory and returns to the unlock screen.
- **Backups.** Automatic encrypted copies of the database file: daily, and before every import and every schema migration. They're kept in a backups folder, with retention N (default 14). Manual "Back up now" and "Restore from backup" are also available. A backup is the same encrypted file.
- **Migrations.** Versioned schema migrations, with a backup taken first. This is real client data, so a migration that can't be applied safely fails loudly and doesn't run.
- **Later, not in this design:** Touch ID unlock, a key per engagement (so destroying an engagement destroys its key), and retention or destruction schedules. The data model should keep the engagement as the ownership boundary for all data, so per-engagement keys stay possible.

## 5. Screens (layouts chosen by the user from mockups)

### 5.1 Engagements dashboard (home)
- **Active** engagements are large cards at the top. Each card shows:
  - name, kind chip (`exam sim` / `lab` / `client`), and a sub-chip such as "AD + 3 standalone" or "assumed breach";
  - dates, or the timebox with time remaining and a progress bar;
  - progress: **"Rooted 3/6 · flags 7/9"** (no points), or for clients a findings count by severity;
  - open-thread count, cleanup-list count, report status, and the last activity (host · stage · how long ago).
- **Past** engagements sit below in a compact, searchable table: name, kind, dates, result, report.
- Engagements can be created (name, kind, client, dates, scope CIDRs, domain, timebox for exam sims), archived (moved to Past) and deleted (with confirmation).

### 5.2 Engagement view

Superseded by 2026-11-05-raven-pen200-restructure-design.md
- A **left sidebar** lists the sections: Board, Log, Credentials, Findings, Engagement checklist, Report. Report is a placeholder until phase 3. Below them is a **Hosts** list, with each host's state glyph and an open-thread dot. Selecting a host opens its host view.
- A **status strip** is pinned at the top of every screen in the engagement:
  - timebox remaining (exam sims);
  - "Rooted x/y · flags a/b";
  - open threads and cleanup count;
  - Metasploit lock state (exam sims).
- **Board** (the landing section) is a kanban whose columns are the host stages: Enumerate · Foothold · Privesc · Loot/Pivot · Done. Stabilize, Orient and Closeout fold into the neighbouring columns.
  - **Cards** show the host name, the IP in small text, an OS chip, and an open-thread dot.
  - **Movement:** cards move automatically as checklist stages are completed, and can be dragged by hand. A hand placement holds until the next stage completes.
- **Log** is the engagement-wide story: every entry, filterable by host, kind and machine.
- **Credentials** ports the old engagement credentials feature: the matrix, half-credentials, access grants, and the credential routine.
- **Findings** lists the engagement's findings (§6.6).
- **Engagement checklist** ports the engagement layer of the checklist:
  - setup goals and AD playbooks with their triggers;
  - access flags, tunnels and hops;
  - "Tick from log".

### 5.3 Host view
- **Header:** host name, IP (monospace), OS chip, current access chip (in the accent colour when access is held), stage chip, open-thread count.
- **Pinned left column**, always visible:
  - **Services:** port, then the **confirmed identity** (e.g. "CouchDB 3.1.1 ✓") with nmap's original guess shown dimmed;
  - **Now:** the open steps of the current stage's checklist.
- **Tabs** on the right:
  - **Story:** this host's log entries in time order;
  - **Checklist:** the full host checklist, ported;
  - **Credentials:** access on this host;
  - **Findings:** findings on this host.
- **Stuck view**, one key from the host view, all on one screen:
  - **before a foothold:** checklist steps skipped or marked N/A; **unidentified services** (nmap `?` guesses or no version), each with filled-in nudges: talk to it with `nc` and send `help`, a `--version-all` rescan of just those ports, a banner grab; services with no log entry against them; open threads.
  - **after a foothold:** applicable commands for the OS, access and what's been run, the host's notes, and open threads.

### 5.4 Everywhere
- `L` opens capture (§6.1). `N` slides field notes out from the right (§6.3).
- Number keys switch engagement sections. `Esc` closes overlays.
- Every action is reachable from the keyboard. The full keymap is left to the builder, but it must not clash with the shortcuts above.

## 6. Behaviour

### 6.1 Capture (the log)
A log entry is one **step**. Every kind shares the same shape: title, the content captured, the machine it ran on, linked hosts, Observations, a report/private marker, and a timestamp.

| Kind | Content | Auto-title |
|---|---|---|
| Command | one or more command+output blocks, parsed from a pasted terminal block (prompt, command, output) | a library match names the purpose plus the key target ("Full TCP scan · 172.31.166.143"); otherwise the **full first command line**, never trimmed to the tool name |
| Screenshot | a pasted image | caption field; the file name is generated as `<ip>_<stage>_<port-or-topic>` (e.g. `172.31.166.143_enum_port81`) |
| HTTP | a raw request, or request+response pasted from Burp | method + host:port + path (`GET :81/`); the response is folded by default |
| Note | free text, e.g. an analysis like a CVE applicability table | first line |
| Flag proof | screenshot plus flag value, `local.txt` or `proof.txt` | "local.txt · Vega" |

**The common flow:**
1. Press `L`.
2. Paste.
3. Optionally type Observations.
4. Press `Enter` to save. Focus returns to wherever the user was.

**Details:**
- **Host:** detected from IPs and host names in the content, using the old auto-tick attribution rules. For commands run on a target, it comes from the shell prompt. It shows as an editable chip.
- **Ran on:** detected from the prompt where possible, otherwise the last value used. The choices are the user's machine list (Settings), seeded with Kali (VM), Docker build, Mac, plus the engagement's hosts. A label containing "kali" means the attacker.
- **Returned nothing:** one key or click marks the entry as deliberately empty, so it doesn't look like missing output.
- **Observations** is the field's name. It holds tentative notes, not proven facts.
- **Report/private marker** on every entry, note and thread. Private content never appears in any report or export meant for a client.
- **Flag proofs** tick the matching checklist goal (`h-orient-proof` / `h-pe-proof`), record the flag value, and feed the proof table.
- **Auto-tick** behaves exactly as in the old engine. Saving a command entry ticks checklist goals for the hosts it names, with evidence links and exact undo.
- Titles stay editable, and an edited title is never overwritten.

### 6.2 Services and corrected facts
- Scan import (nmap output pasted into a log entry, or the old scan-import engine) creates or updates services with nmap's service and version guess.
- Any service can be **confirmed**: the real product and version, plus a link to the log entry that proved it. The confirmed identity is shown, and nmap's guess is kept as history.
- The checklist's applicability uses the confirmed identity when there is one.

### 6.3 Field notes and open threads
- The **Field notes** panel slides out from the right on `N` and overlays the current screen.
  - It opens on the current host's notes and switches to the engagement's notes with one key.
  - Notes are Markdown, resizable, and auto-saved.
  - This replaces the old field-notes box and the old Notes workspace.
- **Open threads.** Any line or block in notes can be marked as an open thread, with a prefix (e.g. `? `) or a shortcut.
  - **Where they show:** as a count on the host header, a dot on the board card and host list, the count on the status strip and dashboard card, and in the stuck view.
  - **Links:** a thread can optionally link to the log entries it came from.
  - **Closing** asks for an outcome: panned out, or dead end with a one-line reason. A dead end becomes a **ruled-out** item, marked report or private, which feeds the report's "what was ruled out" content.

### 6.4 Checklist

Superseded by 2026-11-05-raven-pen200-restructure-design.md
Port the old host and engagement checklists as they are: goals, stages, applicability, filled commands, auto-tick, exam rules, half-credentials and stuck check. The host stage order stays:

1. enumerate
2. foothold
3. stabilize
4. orient (`local.txt`)
5. privesc (ending with `proof.txt`)
6. loot
7. pivot
8. closeout

Engagement kinds stay `exam-sim` / `lab` / `client`. Banned commands are hidden in exam sims, and the Metasploit lock holds.

### 6.5 Exam sims
An exam-sim engagement has:
- a **timebox**: a start time and duration, shown on the strip and the dashboard card;
- the **Metasploit lock**: one host, set by an identified module, never by `multi/handler`.

Nothing else from the old exam simulator comes along. There are no points.

### 6.6 Findings
A finding has:
- **title**, **severity** (Critical/High/Medium/Low/Info), optional **CVSS** vector and score (port `cvss.ts`), **status**;
- **affected hosts and services**; **references** (CVE, EDB, advisory URLs);
- **description**, **impact**, **remediation** (Markdown; the client-report fields);
- **exploit notes:** why the exploit applies (e.g. "the exploit's version gate wrongly treats the running version as patched; fixed the check") and any modifications made to it;
- **files:** code or files created or modified (e.g. `poc.lua`, `libhax.c`), stored as attachments with syntax-highlighted views;
- **steps:** an ordered list of linked log entries, which become the report's reproduction steps with their commands and screenshots;
- **lessons** (always private).

**Attempts** are recorded separately: something tried that failed, with a reason.
- **Reported** reasons: blocked by a control, missing precondition, insufficient access.
- **Private** reason: operator error or inexperience.
- Reported attempts and ruled-out items feed the report. Private ones never do.

### 6.7 Cleanup list
Each engagement keeps a list of artifacts left on targets: uploaded files and their paths, created accounts, changed services and configs. It feeds the report's house-cleaning section.
- **Suggested automatically** from logged commands that write to targets (`wget … -O`, `curl -o`, `certutil`, `iwr -OutFile`, `scp`/uploads, `net user /add`, `useradd`). The user confirms each suggestion before it's added.
- **Added by hand** as well.
- Each item can be marked as removed.

## 7. Import from old Raven
- A one-time import from an old-Raven **backup JSON**: Settings → Import.
  - **Format:** the user's backup is **plain JSON**. Its file format is `version: "2.0.0"` (top-level keys `machines`, `userNotes`, `customNotes`, …), and the machine data inside is at old-Raven `SCHEMA_VERSION = 7` (`pwndash/src/utils/schemaWriteGate.ts`).
  - **Encrypted old backups** (`raven-backup-encrypted`) are rejected with a clear message ("export an unencrypted backup from old Raven"). Supporting them isn't required.
- The user picks which engagements to import. The intent is Mock exam A and later. The picker lists the backup's labs and standalone machines with their dates, and nothing is selected by default.
  - A **standalone machine** becomes a one-host engagement.
  - **Kind mapping:** `exam-sim` stays `exam-sim`; `challenge-lab` or unset becomes `lab`; `real` becomes `client`. *(my call)*
- **Imported:** engagements, hosts, services, log entries with blocks and observations, screenshots and images, credentials, access grants and test results, checklist state (old `itemsState`, already in the v7 goal shape), hops, tunnels and findings.
- **Notes mapping** *(my call)*:
  - a host's `quickNotes` (the field-notes box) becomes that host's field notes, verbatim;
  - a non-empty `nextMove` becomes an **open thread** on that host;
  - lines in imported notes that begin with `? ` stay plain text, and are not converted to threads;
  - `writeupMarkdown`, vault and CPTS notes, and global `userNotes`/`customNotes` are **not** imported, because the Obsidian vault is the archive for those;
  - port-triage notes become the matching service's notes.
- **Re-import** of an already-imported engagement is **add-only**: records are matched by their old id; new records are added; existing records are never overwritten or deleted. Edits made in the new app always win. The summary lists counts of added and already-present records. *(my call)*
- **Not imported:** anything not selected, and all HTB/THM catalog data.
- **Safety:** the import runs in one transaction after an automatic backup. It's idempotent: re-importing the same engagement doesn't create duplicates. It ends with a summary of counts per type.
- **Fixture:** the real backup at `a file outside the repo` contains secrets. Use it only for local verification that prints counts and ids, never values. Never commit it or copy its contents. Tests use synthetic fixtures.

## 8. Visual design: direction A, "Ink" (chosen by the user from three mockups)
- **Palette:** true black `#000` background; white and light-grey text; hairline borders around `#1f1f1f`–`#2a2a2a`; secondary text `#8a8a8a`–`#a8a8a8`. **One accent, `#c6ff00`**, used sparingly and only with meaning: the active selection marker, held access, confirmed facts, focus. No other hues, except a muted warning amber for open threads, which the builder may refine.
- **Why the user chose it:** "my eye knows exactly where to look at all times and the overall contrast is just better." Every screen is judged against that sentence.
- **Surfaces:** flat. No glass, no glows, no shadows-as-decoration, no gradients. Hierarchy comes from hairlines, spacing and type weight.
- **Type:** a crisp sans for UI (SF Pro / Inter-class) and a good monospace (JetBrains Mono-class) for IPs, commands, output and timestamps. Small uppercase tracked labels for section headings.
- **Feel:** desktop-native (proper title bar, native menus, keyboard-first), minimal and quick motion, dense but calm.
- **No stock look:** stock component-library styling (default shadcn/Tailwind UI look) must not show through. Components are styled to this system.
- **Reference:** the chosen mockup, direction **A** in `docs/design/visual-directions.html`; the layout mockups are in `docs/design/` (dashboard: option A, engagement view: option B, host view: option B).

## 9. Engines to port from the old app's repo
Copy these with their tests, then adapt them to the new types (Engagement, Host, Service, LogEntry, and so on):

- **Checklist engine.** `src/utils/checklist/`: `matcher`, `library`, `applicability`, `dc`, `ports`, `fill`, `autoTick`, `examRules`, `engagementState`, `scanImport`. Plus `src/data/hostChecklist.ts`, `src/data/engagementChecklist.ts`, `src/data/commandLibrary/*` (keep the MIT attribution to oscp-notes-2026).
- **Credentials.** `credentialCommands`, `credentialIntake`, `credentialMatrix`, `credentialEngagement`, `nxcResultParser`, and the half-credentials logic.
- **Log and parsing.** `logPasteParser`, `commandOutputParser`, `scanParserUtils`, `hashIdentifier`, `hostsLine`, `cvss`.
- **Kept for phase 2:** `shellEncoders`, `payloadCrafterUtils`, `offensiveTransferUtils`, `pivotCommandUtils`, `src/data/revshellsData.ts`.
- **Not ported:** the old migration code (`checklist/migration.ts`, `legacyChecklistTitles`, `LEGACY_ITEM_TITLES`, `legacyIds`), sync (`sync*`), IndexedDB storage, and everything CTF, analytics or gamification.

The old repo's specs are background for the ported behaviour: `docs/superpowers/specs/2026-11-02-checklist-rework-design.md`, plus its ledger of rulings.

## 10. Phases
Each phase gets its own plan and must leave a usable app.

1. **Core (this design, in full).**
   - App shell, unlock, encryption, backups and migrations, the Ink design system;
   - the dashboard, engagement view and host view;
   - capture of every kind, services and confirmation, field notes and threads;
   - checklist, credentials, findings and attempts, cleanup list;
   - exam-sim timebox and Metasploit lock;
   - the stuck view, and the import.

   Target: usable for the remaining OSCP sims before mid-December 2026. Old Raven stays as a fallback until the new app has carried a full sim.

   **Build order.** Every step leaves an app the user can open and use.
   1. App shell, unlock and encryption, backups and migrations, the Ink design system, and the dashboard with engagement create/archive.
   2. Engagement and host views, capture of every kind with auto-titles, and services with confirmation.
   3. Field notes and threads, the checklist with auto-tick, and the exam-sim timebox and Metasploit lock.
   4. Findings and attempts, and credentials.
   5. Import from old Raven.
   6. The stuck view and the cleanup list.

   **Sim-ready means steps 1–4** (the user's decision). Once those are done the user runs full sims in the new app, so they come first and must not be traded away for steps 5–6.
2. **Arsenal and search** (outline).
   - A global Arsenal: command library browsing, merged with the old cheatsheets and with duplicates removed;
   - generators: reverse shells, the PowerShell encoder, msfvenom builders;
   - quick guides: TTY stabilization and file transfers;
   - everything filled from the current engagement and host, including tunnel-aware LHOST;
   - `⌘K` search across commands, generators, notes, and the current engagement's log, notes and credentials;
   - **output interpreters:** pasted SUID lists, `sudo -l`, `getcap`, cron, `whoami /priv`, and the key linpeas/winPEAS sections are scanned for anomalies (e.g. a non-standard SUID like `backupd`, GTFOBins coverage). Results appear as observation suggestions the user accepts or dismisses. Everything is offline, from built-in lists.
3. **Reporting** (outline).
   - Raven generates a draft in the layout of the OSCP report template the user likes: <https://github.com/clibetoe/pentest-report-templates/blob/master/templates/oscp/oscp-report-template.pdf>.
     - High-level summary with the exploited-systems table;
     - methodology;
     - per target: services (confirmed identities), initial access and privesc built from findings and their steps with screenshots, and proof;
     - AD overview and attack chain from hosts, hops and the credential trail;
     - house cleaning from the cleanup list;
     - appendices: proof table, tools from the log, Metasploit usage.
   - A report editor for the prose, and PDF export.
   - Client reports use the same structure, with per-finding severity, CVSS, impact and remediation.
   - Private content is excluded.
   - Must be done before the exam, so the user has practised with it.
4. **Later** (outline).
   - A reference notes library: Markdown, Obsidian import. Holds the user's future field notes, which are not the PEN-200 course diary.
   - Custom report branding: cover, logo, theme, contact details.
   - A personal findings library that reuses past descriptions and remediation.
   - Touch ID, per-engagement keys, retention and destruction reminders.

## 11. Left to the builder
- Internal module layout, the Rust↔TS boundary (commands vs. a SQL plugin), and the state library.
- The exact SQL schema, provided it expresses §5–§7 and keeps the engagement as the ownership boundary.
- The full keymap beyond `L`, `N`, number keys and `Esc`.
- Exact spacing, sizes and the amber shade, within §8.
- Auto-lock timing and backup retention defaults (14) can be tuned.
- Kanban column folding details.

## 12. Calls I made (the user should check these)
1. Tauri 2 + SQLCipher, with evidence stored inside the database.
2. macOS only; no sync.
3. Phase order: Arsenal (2) before Reporting (3), because the exam needs both and the Arsenal is used mid-attempt.
4. Output interpreters moved to phase 2, to keep phase 1 tight.
5. The cleanup list is suggested from commands, but every suggestion needs user confirmation.
6. The open-thread prefix is `? ` (plus a shortcut).
7. Board columns: Enumerate · Foothold · Privesc · Loot/Pivot · Done.
8. The import picker has nothing selected by default.
9. Auto-lock defaults to 30 minutes; backups are kept for 14 copies.
