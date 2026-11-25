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

## Engagement data

**Store change**:
What one write did to the vault, named by the kind of thing it touched, its id and what happened: "host h1 deleted", "entry e5 saved". A write reports only its own store change; what else that makes out of date is not its business.
_Avoid_: event, mutation (a mutation is the call; the store change is what it did)

**Staleness map**:
The one place that knows what a store change makes out of date, cascades included (a deleted host takes its tunnels, hops, attempts and findings with it). It mirrors the schema's foreign keys.
_Avoid_: invalidation list, cache keys

**Checklist sync**:
Bringing the checklist and the board up to date after a store change: ticks from log entries, then fact ticks, then domain admin cover, then each host's board column, always in that order and from one read of the checklist.
_Avoid_: resync (one step of it), board sync (the last step)


**Same domain**:
Two domain names that name one Windows domain: `CORP` and `corp.lan` (the NetBIOS name and the DNS name), compared without case. Credential, username and tried-pair identity all use it.
_Avoid_: domain match (says nothing about NetBIOS against DNS names)

**Same credential**:
Decided by the store alone: the same type, username, same domain and secret, in one engagement (and on one host, for a local credential). A captured Kerberoast, AS-REP or NetNTLM hash is one credential per account and kind, whatever the capture's bytes.
_Avoid_: duplicate key

## Commands

**Filled command**:
A command with its placeholders filled for the host in view, in three forms: the text shown (secrets masked), the text copied (secrets in) and the text typed into a terminal (shell-safe). Filled once, used for all three.
_Avoid_: resolved command, rendered command

**Exam verdict**:
What the exam rules say about one command in one scope (engagement kind, host in view, Metasploit lock): allowed, banned, Metasploit locked to another host, or Metasploit not yet locked. Lists hide a banned or locked-elsewhere command; reading surfaces (Manual notes, the answer card) show it with the warning and hold back its first copy.
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

