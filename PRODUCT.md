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
| `H` | stuck view (on a host) |
| number keys | engagement sections |
| `Esc` | closes overlays |

## Capabilities and Constraints

**Engagements**
- **Dashboard (home).** Active engagements are large cards. Each card shows:
  - kind (exam sim / lab / client);
  - the timebox or dates;
  - "Rooted x/y · flags a/b", or findings by severity for clients;
  - open threads, cleanup count and last activity.

  Past engagements sit in a searchable table. Engagements are created, archived and deleted (with confirmation).
- **Engagement view.** A left sidebar holds the sections (Board, Log, Credentials, Findings, Engagement checklist, Report) and the host list, with state glyphs and open-thread dots. A status strip at the top shows the timebox, rooted/flags, open threads, cleanup and the Metasploit lock.
- **Board.** A kanban of the PEN-200 stages: Information gathering, Vulnerability detection, Initial foothold, Privilege escalation, Post-exploitation, Reporting. Hosts move automatically from checklist progress and can be placed by hand. Lateral movement is engagement-level, not a column.

**Hosts**
- **Host view.** A header with the name, IP, OS, access, stage and open threads.
- **Services.** Nmap's guess is kept as history; a confirmed product and version, with a link to the proving log entry, takes precedence.
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
- **Metasploit lock:** one host only.
- **Banned techniques:** hidden.

**Arsenal and search**
- **Arsenal.** The command library: built-in commands plus the owner's Field Manual vault (cards by stage and category), imported read-only.
- **Ways in:**
  - a drawer (`A`);
  - full-screen browse with stage and category filters;
  - card links from checklist steps.
- **Generators:** "Transfer a file".
- **Placeholders** fill from the host, the engagement, settings and the Toolkit.
- **⌘K search.** Commands, generators, cards and engagement items, with these keys:
  - ↵ copy;
  - ⌘↵ copy and log;
  - → open the card;
  - ⇥ edit fill values;
  - ⌥H pick a host.

**Report**
- **Report.** A placeholder for now (phase 3). Log steps, findings, attempts, ruled-out items, cleanup and proofs are all recorded to feed it. Private content never reaches a report.

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
- **Stack:** Tauri 2, React 19, TypeScript, Tailwind 4 and Vite.
- **Visual audit.** `npm run audit:visual` runs the UI against synthetic stress data for layout, accessibility, keyboard and UX checks.

## Brand Commitments

- The name is Raven.
- The theme is called **Ink**: dark, with a single accent colour and no red. Destructive actions use the warning amber. The font is JetBrains Mono.
- The incumbent visual system is the design authority for refinements.

## Evidence on Hand

- Real engagement data lives only in the owner's encrypted database. Never fabricate it or copy it into the repo.
- Synthetic stress fixtures are in `src/audit/fixtures.ts`.
- The Field Manual vault is at `~/Documents/Field Manual`.
- Design specs are in `docs/superpowers/specs/`, and the latest audit triage is in `docs/superpowers/audits/`.

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
