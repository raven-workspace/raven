# Raven

Raven is a penetration tester's work surface: one engagement from first scan to the exam report. These are the words its code, docs and issues use for its parts.

## Report

**Report target**:
One unit of the report that gets its own page: a standalone machine, or the AD set's machines together.
_Avoid_: section (a target is one kind of section), host (an AD set target holds several)

**Placement plan**:
Raven's decision, made from the logged record alone, about where each log entry of a report target would go on a freshly drafted page. It never reads the owner's edits.
_Avoid_: draft plan, evidence map

**Role**:
What a log entry is in a placement plan: for example, it leads a step, or it isn't placed. Every entry of the target has exactly one.
_Avoid_: reason (a reason is why an entry proves something, not where it goes)

**Step**:
One numbered move in a report target's story, led by a single log entry (an access, a hop, a flag or a finding step) and followed by what illustrates it.
_Avoid_: block (a block is any piece of a page), entry (a step can hold several)

**Finding section**:
The part of a phase headed by one finding ("Initial access: <title>"), holding the steps that belong to that finding.
_Avoid_: finding group

**Draft**:
The page Raven builds from a placement plan before the owner edits it.
_Avoid_: plan (the plan is the decision; the draft is the page printed from it)

**Page**:
A report target's document as the owner has edited it. Whether an entry is "on the page" is always a question about the page, never the plan.
_Avoid_: draft (once edited, it is the owner's)

**Block source**:
Where a block on a page came from: a log entry and which part of it, a finding, a machine's facts, a phase heading, or a machine's Also tested list. It stays on the block as the owner edits, so Raven can follow the block back to what it shows.
_Avoid_: origin, ref, provenance

**Kept from the report**:
A log entry that may never reach the page, the evidence column or the PDF: a private entry, or one tied to an attempt the owner marked private or kept to themselves.
_Avoid_: hidden, private (private is one way to be kept from the report)

**Report checklist**:
The checks still open on the report tab in view, such as a missing proof screenshot or a finding with no severity, each with its fix. The app labels it "To do"; always say "report checklist", since "checklist" alone means a host's methodology checklist.
_Avoid_: To do panel, todo list, checks panel

## Engagement data

**AD set**:
The hosts that make one report target together: those switched into it by hand, else those with Kerberos (88) and LDAP (389) both `open`. The store decides it (`adSetEffective`), and nothing recomputes it; a UDP `open|filtered` never counts.
_Avoid_: AD host, domain hosts

**DC**:
The one AD set member with Kerberos (88) and LDAP (389) both `open`. An exam AD set has three machines and exactly one DC; with none or several such members, there is no DC. Domain admin means an admin result on it.
_Avoid_: AD host, domain controller host

**Store change**:
What one write did to the vault, named by the kind of thing it touched, its id and what happened: "host h1 deleted", "entry e5 saved". A write reports only its own store change; what else that makes out of date is not its business.
_Avoid_: event, mutation (a mutation is the call; the store change is what it did)

**Staleness map**:
The one place that knows what a store change makes out of date, cascades included (a deleted host takes its tunnels, hops, attempts and findings with it). It mirrors the schema's foreign keys.
_Avoid_: invalidation list, cache keys

**Checklist sync**:
Bringing the checklist and the board up to date after a store change: ticks from log entries, then fact ticks, then domain admin cover, then each host's board column, always in that order and from one read of the checklist.
_Avoid_: resync (one step of it), board sync (the last step)

**Entry change**:
What happened to one log entry: saved by a capture, edited, deleted, or its extraction undone. Every way an entry changes reports one, and one module (`src/features/log/entryChange.ts`) runs what follows, in order: the checklist sync, the exam-sim Metasploit lock, a capture save's extraction summary, then the store change, the save summary and one error after a partial save.
_Avoid_: after-save, follow-up (a follow-up is one step of it)

**Same domain**:
Two domain spellings that name one Windows domain, anchored to the engagement's own domain (an FQDN): equal ignoring case and surrounding whitespace, or the engagement's domain and its first label (`corp.lan` and `CORP`). With no engagement domain only equal spellings match, and a NetBIOS name never matches any other FQDN (`CORP` is not `corp.local`, and `WEB01` is not `web01.corp.lan`). A blank domain matches only a blank one. Decided by the store; credential, username and tried-pair identity, tried-pair promotion and undo all use it.
_Avoid_: domain match (says nothing about NetBIOS against DNS names)

**Same credential**:
Decided by the store alone: the same type, username (ignoring case), same domain and secret, in one engagement (and on one host, for a local credential). A captured Kerberoast, AS-REP or NetNTLM hash is one credential per account and kind, whatever the capture's bytes. Creating one the store already holds returns the stored one and says it existed; duplicates stored before this rule stay.
_Avoid_: duplicate key

**Username scope**:
Whether a username is a domain account, a local account on one host, or unknown. Usernames stored before scope existed are unknown, and so are those added by hand. Capture output sets it: `.\user` and `HOST\user` (HOST a host's short name) are local to that host, a name in the engagement's domain is a domain account, anything else is unknown. A local username keeps its scope when its host is deleted.
_Avoid_: account type, username kind

**Same username**:
Decided by the store alone: the same name (ignoring case) and the same username scope, in one engagement. Two unknown usernames need the same domain, where a blank domain matches only a blank one; two domain usernames need the same domain, where a blank domain stands for the engagement's own; two local usernames need the same host. Unknown, domain and local usernames never merge with each other.
_Avoid_: duplicate username

**Password reuse**:
A local account found on one host whose name and secret match a local credential already stored for another host. Capture files it as an attempt of the stored credential on the new host, with no new username or credential.
_Avoid_: spray hit (a spray hit may be any credential)

## Commands

**Filled command**:
A command with its placeholders filled for the host in view, in three forms: the text shown (secrets masked), the text copied (secrets in, shell-safe where it runs in the Kali shell) and the text typed (the real values as you would type them, which is what a log entry records). Filled once, used for all three. One module copies it (`src/features/commands`): it picks the clipboard mode, runs the copy guard and logs it with its "ran on" machine.
_Avoid_: resolved command, rendered command

**Exam verdict**:
What the exam rules say about one command in one scope (engagement kind, host in view, Metasploit lock): allowed, banned, Metasploit locked to another host, or Metasploit not yet locked. Lists hide a banned or locked-elsewhere command; reading surfaces (Manual notes, the answer card) show it with the warning and hold back its first copy. Until the engagement's kind is known, a command with an exam classification waits (pending): lists hide it and reading surfaces hold back its first copy. Only `src/engines/exam` decides it.
_Avoid_: exam rule (a rule is the policy; the verdict is its answer for one command)

**Secret tokens**:
The placeholders that hold a secret (`{PASS}`, `{HASH}`, `{CRED}`): masked in the text shown and never an editable fill field.
_Avoid_: credential tokens (a wider set)

**Credential tokens**:
The placeholders filled from the chosen credential: `{USER}`, `{DOMAIN}`, `{PASS}`, `{HASH}`, `{DC_HOST}`.
_Avoid_: secret tokens (only the secrets among them)

**Extraction**:
The record of what one saved log entry filed into the vault (hosts, services, credentials, attempts, access grants, promoted tried pairs), so the save can be undone.
_Avoid_: interpretation (an interpretation is what an output proves; the extraction is what the save did with it)

**Store scenario**:
A series of store commands and the lists expected after them, run against both the real store and the in-browser fake, so the two can't drift apart.
_Avoid_: fixture (a fixture is data, not a check)


## Layout

**Chrome bar**:
The window's title bar, carrying the Engagement and Target pickers, search and Build report.
_Avoid_: title bar, top bar, header

**Rail**:
The narrow column of view buttons at the window's left edge: Explorer, Terminals, the engagement's sections, then Field notes, Arsenal, Payloads and Manual.
_Avoid_: sidebar, nav, activity bar

**Explorer**:
The column listing the engagement's hosts, notes, findings and logs, from which any of them opens in an editor tab.
_Avoid_: sidebar, tree, file list

**Editor tab**:
One open page in the editor area: a host, a note, a finding, a section, the log entry tab. A page is open in at most one editor tab.
_Avoid_: page tab, document, view

**Target**:
The host in view, set both by the Target picker and by selecting a host; it stays on the last host picked when the page in view has no host.
_Avoid_: current host, active host, selected host

## Terminal

**Session**:
One shell and its terminal state, belonging to one engagement and pinned to the host that was Target when it opened, or to the engagement alone if there was none. It lives on through page switches, hidden panels and vault lock, and ends only when closed.
_Avoid_: terminal, shell, PTY, tab

**Terminal panel**:
The docked area under the editor that shows the engagement's sessions.
_Avoid_: console, terminal drawer

**Terminal tab**:
A tab in the terminal panel; each shows one session.
_Avoid_: session tab, terminal (a terminal tab is the label, the session is the shell)

**Pane**:
A viewport in the terminal panel showing one session: the main pane shows the selected terminal tab's session, the split pane a different one. A pane never mirrors another pane's session.
_Avoid_: split, view, window

**Capture**:
Raven filing each finished terminal command and its output as a Log entry on the host it touched, or at engagement level, while the engagement's "Capture to engagement" setting is on.
_Avoid_: recording, session log, auto-log

**Log entry tab**:
The editor tab, labelled "New log entry", where the owner pastes or types a Log entry by hand. One at a time; its draft survives closing.
_Avoid_: capture tab, capture sheet, capture panel (capture is the terminal's automatic filing)

**Engagement folder**:
The ordinary, unencrypted directory on disk where an engagement's sessions start and where tools write their own files. It is outside the vault and outside Raven's encryption promise.
_Avoid_: workspace, engagement workspace, working directory
