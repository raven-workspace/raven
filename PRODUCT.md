# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(The UI is web technology inside a Tauri 2 desktop shell on macOS. The design language is the app's own, not native macOS.)

## Users

One person: the owner. They are a penetration tester preparing for the OSCP exam (not yet booked; realistically early 2027). They work the OffSec PEN-200 challenge labs now and will do real client engagements after the exam. In the exam they work alone, against a clock, without Claude.

The user has ADHD and autism. Speed, low friction and minimal distraction come before everything else, most of all in a time-limited exam.

## Product Purpose

Raven is the user's personal work surface for penetration testing. It has four jobs:

1. Keep them organised **during** an engagement: where things stand, what's proven, what they're thinking.
2. Keep them organised **across** engagements: past ones and lookups.
3. Produce a **polished report** afterwards from what was recorded.
4. Hold the **command and technique references** needed for the exam and for real work.

It replaces an older web app and their Obsidian engagement notes. Success means recording everything by hand as it happens, fast enough that nothing is lost and nothing slows the attack.

## Positioning

The engagement is the unit of work, and Raven fills in what it can:
- commands come pre-filled with the current host, IP, ports, credentials and the user's own tool paths;
- checklists tick themselves from what was logged;
- facts get corrected as they're proven (nmap's guess versus the confirmed service and version);
- the per-host record reads as a story of steps and feeds the report directly.

## Operating Context

**Screens.** The attack VM (Kali) usually has a full screen of its own. Raven sits on another screen, rarely full screen and often sharing it with other apps. It must look good across a wide range of window widths.

**Host page needs.** The owner opens a host's page for three jobs:
- log information;
- retrieve what's known about the host;
- consult the checklist for the next commands to run.

The checklist (what they've done, what their options are next) and the host facts (what's known about the machine so far) are needed about equally. The facts decide which next steps apply and rule out others. This is a measure of how much each is needed, not a prescribed layout.

**Keyboard.** The workflow is keyboard-first:

| Key | Action |
|---|---|
| `L` | capture |
| `N` | field notes |
| ⌘K | search |
| `A` | Arsenal drawer |
| `P` | Payloads drawer |
| `M` | the Manual, at the last note read |
| `H` | stuck view (on a host) |
| number keys | engagement sections |
| `Esc` | backs out: closes an overlay, cancels an edit, leaves a mode. It never selects or does anything else. |

## Capabilities and Constraints

**Engagements**
- **Dashboard (home).** Active engagements are large cards. Each card shows:
  - kind (exam sim / lab / client);
  - the timebox or dates;
  - "Rooted x/y · flags a/b", or findings by severity for clients;
  - open threads, cleanup count and last activity.

  Past engagements sit in a searchable table. Engagements are created, archived and deleted (with confirmation).
- **Engagement view.** A left sidebar holds the sections (Board, Log, Credentials, Findings, Network, Engagement checklist, Report) and the host list, with state glyphs and open-thread dots. A status strip at the top shows the timebox, rooted/flags, open threads, cleanup and the Metasploit lock.
- **Board.** A kanban of the PEN-200 stages: Information gathering, Vulnerability detection, Initial foothold, Privilege escalation, Post-exploitation, Reporting. Hosts move automatically from checklist progress and can be placed by hand. Lateral movement is engagement-level, not a column.
- **Network.** The attack path as a tree: Kali, then hosts by hop depth, each node saying how it was reached and carrying its tunnels. Hosts not yet reached sit in a tray below. Hops and tunnels are added and edited here. When the section is too narrow for the tree, the same path reads as an indented list.

**Hosts**
- **Host view.** A header with the name, IP, OS, access, stage and open threads.
- **Services.** Nmap's guess is kept as history; a confirmed product and version, with a link to the proving log entry, takes precedence. A service can be marked **exploited** (the one that got you in); it leads the folded summary and counts as exploited in report coverage.
- **Privesc vectors.** Candidate routes to higher privileges, each untested, try, ruled out (with a reason) or **exploited**. The exploited one leads the list, and the mark survives the parser re-reading the output.
- **Now.** The open steps of the current stage.
- **Tabs:**
  - Story: this host's log;
  - Checklist;
  - Credentials: access on this host;
  - Findings.
- **Stuck view (`H`).** Before a foothold it shows skipped and N/A steps, unidentified services with filled-in nudges, unlogged services and open threads. After a foothold it shows applicable commands, notes and threads.

**Capture and log**
- **Capture.** One step per entry. Kinds: command (terminal paste parsed into command and output), screenshot, HTTP (Burp), note, and flag proof.
- **Auto-filled fields:** title, host and "ran on". Also available: Observations, "returned nothing", and a report/private marker.
- **Auto-tick.** Saving ticks checklist goals, with evidence links and exact undo.
- **Log.** The engagement-wide story, filterable by host, kind and machine.
- **What Save files (binding).** Saving a pasted output runs Raven's interpreters over it:
  - The raw output is always saved to the log, unchanged.
  - Only proven information is filed. A successful login becomes a credential with its access, and dumps (secretsdump, mimikatz, lsassy) become credentials and hashes. Cracked output upgrades an existing hash to its password, and username lists become usernames. Only PEAS's red-on-yellow findings become privesc vectors, and SUID, `sudo -l` and capability binaries only when GTFOBins has an entry for that mechanism. Everything else stays in the raw log.
  - A failed attempt never creates a credential. It's marked Failed in the test matrix, or kept as a tried pair (username plus secret) when the secret isn't stored, so it isn't sprayed again. A later proven success turns a tried pair into a real credential.
  - An IP that isn't a host yet becomes one when the output proves something real on it (a login, a dump, an open port); a failed-only IP never does.
  - The save summary lists what was filed, ticked and created.

**Field notes and threads**
- **Field notes (`N`).** A slide-out panel with Markdown notes per host and per engagement, auto-saved.
- **Open threads.** Any line can be marked as an open thread. Closing one asks for an outcome; a dead end becomes a ruled-out item that feeds the report.

**Checklists**
- **Host checklist.** Goals per PEN-200 stage with applicability, filled commands, auto-tick, exam rules, and "N new credentials since this was done".
- **Engagement checklist.** Setup goals, AD playbooks, lateral movement, access flags, tunnels and hops.

**Credentials**
- **Engagement credentials:**
  - the test matrix (credential × host × protocol);
  - half-credentials (usernames, hashes, cracking);
  - access grants;
  - the credential routine with test commands;
  - intake from captured output.

**Findings**
- **Findings.** Each holds:
  - title, severity, CVSS (3.0, 3.1 or 4.0, with a local metric builder), status;
  - affected hosts and services;
  - references;
  - description, impact and remediation;
  - exploit notes and files;
  - ordered steps linked to log entries;
  - private lessons.
- **CVE lookup.** A CVE in a finding's references is looked up in NIST NVD (the one network call: only the CVE ID and the user's API key leave the machine, from Rust). Empty fields fill in; filled ones get a "use NVD" diff. Answers are cached in the vault.
- **Attempts.** Failed attempts are recorded with reported or private reasons.

**Cleanup**
- **Cleanup list.** Artifacts left on targets. They are suggested from logged commands that write to targets, or added by hand, and can be marked removed. The list feeds the report.

**Exam sims**
- **Timebox:** shown on the status strip and the dashboard card.
- **Metasploit lock:** one host only. Metasploit modules (exploit, auxiliary and post: any module but `multi/handler`) and Meterpreter payloads count. msfvenom, multi/handler and raw shells, staged or stageless, are unrestricted and never warned about (binding). A command that counts, with no lock yet, says "Using Metasploit here makes this your Metasploit machine"; locked to another host, it warns "Metasploit is locked to <host>" and copying goes through the copy guard.
- **Banned techniques:** hidden.

**Arsenal and search**
- **Arsenal.** The command library: built-in commands plus the owner's Field Manual vault (cards by stage and category), imported read-only. Decided by the owner (binding):
  - It's a full reference. The host only fills values in; nothing ranks or hides by host fit.
  - Search results are grouped by category, cards and commands together. Category aliases match like names: "lateral movement" finds Pivoting.
  - In full-screen browse, cards come first, then built-in commands under tool headings. Field Manual commands are reached through their card; search still returns them one by one.
  - **Copy guard:** with a placeholder still unfilled, ↵ or Copy moves focus to the first empty field instead of copying. A second ↵ in that empty field copies anyway.
- **Manual.** The Field Manual's Foundations, Tools and Reporting notes as a full-screen reader (`M`): a filterable rail, the note with its commands filled for the host, and an outline; it reopens at the last note and scroll position.
- **Ways in:**
  - a drawer (`A`);
  - full-screen browse with stage and category filters;
  - card links from checklist steps.
- **Generators:** "Transfer a file".
- **Payloads (`P`).** A right-edge drawer, with a full-screen workbench, that builds payloads for the host in view. Generators: Shell, Transfer, SQL injection, msfvenom, Encode and Upgrade. Each fits the payload to the host's OS, the paste context (bash prompt, injected command, URL parameter, PHP `system()`, cmd.exe, PowerShell, web shell, SQL string, Office macro), whether callbacks are blocked, filters and the tools on the target. Values Raven doesn't know are flagged in amber. Exam-sim rules (the Metasploit lock) apply.
  - **Works as pasted (binding).** Every payload comes already wrapped and encoded for its paste context: `bash -c '…'` outside a real bash prompt, mkfifo plus nc as the Linux fallback (never `nc -e`), `powershell -nop -w hidden -e <UTF-16LE base64>` as the Windows default (Raven does the encoding), quotes doubled inside SQL strings, and URL encoding in URLs. Large payloads are hosted and fetched with a cradle, with the serve command supplied. Each payload lists what every part does. 443 and 80 are suggested first, the listener defaults to `penelope -O -p <port>` (fallback `rlwrap nc -lvnp`), and a file with LHOST baked in warns when LHOST has changed since it was built.
  - **The owner stays in control (binding).** The reliable payloads (Linux `bash-tcp`, `mkfifo-nc`, `mkfifo-nc-bg`, `python3`, `php-exec`; Windows `ps-b64`, `powercat-cradle`, `nishang-cradle`, `nc-exe`) are never folded away when they work in the chosen OS and paste context. Toggles (callbacks blocked, filter, tools) are the owner's: Raven never flips one, and only turns the chip amber with the clue it saw. Inference only pre-fills OS, paste context, port and toggles, and an override sticks for that host. Payloads are organised by where you paste them.
- **Placeholders** fill from the host, the engagement, settings and the Toolkit.
- **⌘K search.** Commands, generators, cards and engagement items, with these keys:
  - ↵ copy;
  - ⌘↵ copy and log;
  - → open the card;
  - ⇥ edit fill values;
  - ⌥H pick a host.

**Report**
- **Report.** The first target is the OSCP+ exam report (spec: `docs/specs/reports.md`). Raven does the clerical work (gathering, ordering, numbering, formatting, checking against OffSec's rules) so the owner only writes explanations.
  - A tab per page: Front matter, one per target, Closing, appendices and owner-written pages. Pages are drafted from log steps, findings, attempts, ruled-out items, cleanup and proofs, then edited in a rich-text editor (slash menu, tables, code).
  - Beside the page: guide notes, and an evidence column of host-linked log entries not yet on the page (`E` toggles it on narrow windows).
  - **To do:** plain-word checks per target, each with a fix and, where possible, a one-press action; false positives can be dismissed.
  - **Report details:** the cover's facts.
  - A report strip shows the file name, time until due, targets ready and the To do count.
  - **Export PDF:** one action writes `OSCP-<OSID>-Exam-Report.pdf` and its unpassworded `.7z` into a folder picked once, then shows the files, their sizes (a warning over 200 MB) and the `.7z`'s MD5 to compare at upload.offsec.com, with Copy and Reveal in Finder. The PDF is Typst compiled in the app with the house fonts (docs/adr/0002): US Letter, selectable text, a contents page, page numbers, figures kept with their captions, and code printed as typed (no ligatures; a long run breaks at the panel's edge rather than off the page). Unwritten pages and sub-sections are left out, and a figure prints only when its entry may reach the report.
  - Private content never reaches the page, the evidence column or the PDF.
  - **What OffSec grades (binding, from the OSCP+ Exam Guide).**
    - **File:** a PDF named `OSCP-OS-XXXXX-Exam-Report.pdf` (the OSID, case-sensitive), inside an unpassworded `OSCP-OS-XXXXX-Exam-Report.7z` of at most 200 MB, uploaded at upload.offsec.com, where the owner checks the MD5.
    - **Reproducible:** every step, command and console output, enough for a competent reader to replicate the attack. Nothing can be sent later.
    - **Exploit code:** an unmodified exploit gets its URL only. A modified one needs the modified code, the original URL, any shellcode generation command, and each change highlighted and explained. Scripts and PoCs go in the PDF as text.
    - **Proof:** each `local.txt` and `proof.txt` in a screenshot showing the file's contents (`type` or `cat` from an interactive shell, in its original location) and the target's IP. A web shell earns zero, and a missing proof screenshot means zero for that target.
    - **Order and layout:** targets are graded in the order they appear. The exam is three standalone machines (20 points each: 10 foothold, 10 privesc) and one AD set of three (40 points).
    - **Metasploit** on one target only, and the report says which. **No AI help:** LLMs are banned as third-party help.
  - **Report outline (binding, after OffSec's sample report).** Numbers come from the outline order.
    1. Report details (the cover's facts).
    2. 1 OffSec Certified Professional Exam Report: Introduction, Objective, Requirements.
    3. 2 High-Level Summary, with Recommendations.
    4. Testing Considerations (unnumbered; printed only if written).
    5. 3 Methodologies: Information Gathering (scope), Service Enumeration, Penetration (which host used Metasploit), Maintaining Access, House Cleaning (the cleanup list).
    6. 4 Independent Challenges: one page per standalone target in grading order. Each reads "<name> (<IP>)", the Result line, Service enumeration (ports table and scans), one heading per finding that enabled a phase ("Initial access: <title>", "Privilege escalation: <title>", and Lateral movement, Domain compromise, Post-exploitation), each with its numbered steps and the flags closing their phase, then "Additional findings (not on the path to root)" and "Also tested". An empty sub-section is left out.
    7. 5 Active Directory Set: the attack path, then each machine in turn.
    8. Also tested at engagement level, when there is any.
    9. Free pages the owner adds (+ Page), numbered as body sections after the targets.
    10. Further Information and References (unnumbered).
    11. Appendix pages, lettered after the targets, added by hand: nothing moves to an appendix automatically.

**Settings and data**
- **Settings:**
  - machines;
  - attacker IP and listener port;
  - tool paths;
  - auto-lock;
  - backup retention;
  - Field Manual path, import and drift report;
  - backups and restore;
  - import from old Raven.
- **Vault.** Local-only. The encrypted database is unlocked by a vault password, auto-locks, and makes no network calls at runtime except NIST NVD CVE lookups.
- **Data safety.** Since 2026-10-25, stored data is real lab data. Changes need migrations and must take a backup first.
- **Stack:** Tauri 2 (Rust backend, SQL migrations), React 19, TypeScript and Vite. Styles are SCSS, one stylesheet per feature component folder; Tailwind was removed on 2026-11-20. UI primitives are Radix, the report editor is ProseKit, data goes through TanStack Query and Zustand, and icons are Phosphor.
- **Visual audit.** `npm run audit:visual` runs the UI against synthetic stress data for layout, accessibility, keyboard and UX checks.

## Brand Commitments

- The name is Raven.
- The theme is called **Ink**: dark, with a single accent colour and no red. Destructive actions use the warning amber. The interface font is Instrument Sans; commands, code and data use JetBrains Mono.
- The incumbent visual system is the design authority for refinements.

## Evidence on Hand

- Real engagement data lives only in the owner's encrypted database. Never fabricate it or copy it into the repo.
- Synthetic stress fixtures are in `src/audit/fixtures.ts`.
- The Field Manual vault's path is set in Settings › Field Manual.
- Design specs, one per feature round, are in `docs/specs/` with an index. They record the reasoning at the time; the mockups they cite are linked from git history.
- Open work is tracked in Linear (RAV), not in the repo.

## Product Principles

1. **What's needed stays in view.** Never put it below the fold, and never make it a scroll away.
2. **Raven fills in what it can.** Never make the user retype a fact Raven already knows.
3. **Capture is one paste and a keystroke.** Every core flow is keyboard-first.
4. **Nothing competes for attention.** One accent, no duplicated information and no decorative noise.
5. **Layouts are predictable.** Use CSS grid with explicit tracks by default. Use flexbox only for single-line runs.

## Accessibility & Inclusion

- **ADHD/autism:**
  - minimise distraction, visual noise and unexpected motion;
  - keep layouts stable and predictable;
  - keep the steps in each flow few.
- **Keyboard:** every core flow works from the keyboard, and focus is always visible.
