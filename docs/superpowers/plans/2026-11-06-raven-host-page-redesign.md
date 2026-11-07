# Host Page Redesign and In-Place Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Raven's host page around phase-aware host facts and next steps, replace the finding modal with an in-place split editor that fills itself from the host and from NIST NVD, and fix the sidebar.

**Architecture:**
- **Pure TS engines:**
  - facts: phase, service folding and sorting, identity parsing;
  - CVSS 3.x and 4.0;
  - NVD fill rules;
  - reference suggestions.
- **One migration (`0010`) plus Rust commands:**
  - service verdicts;
  - host identity;
  - privesc vectors;
  - ruled-out source links;
  - the NVD cache and key.
- **React components** on a CSS grid with container queries. Every user-visible behaviour is pinned by a hard check in `audit/regressions.spec.ts`.

**Tech Stack:** React 19, TypeScript, Tailwind 4 (container queries), Zustand, TanStack Query, Tauri 2 + Rust (rusqlite/SQLCipher, `ureq` with rustls), Vitest, Playwright, `@phosphor-icons/react`.

**Spec:** `docs/superpowers/specs/2026-11-06-raven-host-page-redesign-design.md`. Read it first. Section numbers below (§4.4 and so on) refer to it. `PRODUCT.md` holds the product principles.

## Global Constraints

- **Layout:** CSS grid with explicit tracks (`minmax(0,1fr)`, fixed action tracks). Flexbox only for single-line runs that cannot wrap.
- **Naming:**
  - "Story" becomes "Log" in UI copy, tab ids and tests;
  - the fact group is named exactly **"Host Credentials"**;
  - the sidebar heading is exactly **"Engagement"**.
- **Real data:** schema changes only through `src-tauri/src/migrations/mod.rs` (append `(10, include_str!("../../migrations/0010_host_facts.sql"))`); never edit a shipped migration. Migration SQL must not contain `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` or `VACUUM`.
- **Network:** the NVD lookup is the ONLY network call, it runs in Rust only, and the CSP in `src-tauri/tauri.conf.json` is NOT changed. Only the CVE ID and the API key leave the machine. The key is never returned to the frontend.
- **Motion:** 150–250ms ease-out, only to show a state change; instant under `prefers-reduced-motion: reduce`.
- **Icons:** `@phosphor-icons/react` at weight `light`, imported per icon (`import { PencilSimple } from "@phosphor-icons/react"`). Use them only for edit, delete, copy, close, add, expand/collapse and the sidebar toggle. Every icon-only button needs an `aria-label` and a `title` that includes its shortcut. Delete keeps `variant="danger"` and its confirmation.
- **Keys:** must not clash with these existing ones:

  | Key | Action |
  |---|---|
  | `L` | capture |
  | `N` | notes |
  | `A` | Arsenal |
  | `H` | stuck view |
  | `1`–`6` | sections |
  | `[` `]` | move a board card |
  | `Esc` | close |
  | ⌘K | search |
  | ⌘L | lock |
  | ⌘N | new engagement |
  | ⌘E | notes scope |
  | ⌥H | host picker |
  | ⌘P | private |
  | ⌘↵ | save |
  | ⌘. | returned nothing, inside capture |

  This plan adds:

  | Key | Action |
  |---|---|
  | `S` | toggle the Services fact group |
  | `F` | add finding |
  | ⌥1 / ⌥2 / ⌥3 | Next / Log / Findings tabs (match by `e.code` `Digit1..3`) |
  | ⌘B | toggle the sidebar |
  | ⌘\ | flip the finding split's panes when narrow |
  | `D` | dead end on a focused service row |
  | `C` | candidate on a focused service row |
  | `U` | untested on a focused service row |

  Plain-letter keys use `isFreeKey` from `src/lib/keys.ts`.
- **Breakpoints:**
  - the host page root is a container (`@container/host`); two columns at `@min-[760px]/host` (about 1000px of window with the sidebar), stacked below that;
  - the sidebar starts collapsed when `window.innerWidth < 1000` and nothing is stored.
- **Done means:** `npm test`, `npm run typecheck`, `npm run lint`, `(cd src-tauri && cargo test)` and `npm run audit:visual` all pass, and the new checks in `audit/regressions.spec.ts` fail without the change. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Audit fake:** every new `api` command is added to `src/audit/fakeApi.ts` (it is `satisfies Api`, so typecheck enforces this).

## Review Focus

1. **A service set back from dead end to candidate** must delete only the ruled-out item it created. A hand-written ruled-out item for the same host is untouched. (Task 2 test `unset verdict removes only its own ruled-out item`.)
2. **A host whose board column says Privilege escalation but whose `access` is `none`** shows the before-foothold facts. A host in Initial foothold with `access: user` shows the after-foothold facts. (Task 3 test `phase follows access, not board column`.)
3. **A finding open in the split when the vault locks** loses its draft from memory, and reopening after unlock starts clean. (Task 7 test `drafts are cleared on lock`.)
4. **NVD with no key, no network, a 403, or an unknown CVE** never blocks saving and shows one quiet line. (Task 6 Rust tests for each error mapping, plus Task 7 test `lookup failure leaves the form savable`.)
5. **A CVSS vector already typed by the user** is never overwritten by NVD; a diff is offered instead. (Task 6 test `nvdFill offers a diff for a filled vector`.)

---

### Task 1: Log rename, Log row chips, Phosphor, sidebar heading, host rows and collapse

**Files:**
- Modify: `package.json` (add `@phosphor-icons/react`)
- Modify: `src/features/hosts/HostView.tsx` (tab id and label `story` to `log`; `raven.story.order` to `raven.log.order`, falling back to reading the old key once; empty-state copy "Nothing logged on this host yet. Press L to capture.")
- Modify: `src/features/log/LogEntryRow.tsx` (new prop `currentHostId?: string`: no chip for that host; other hosts show `shortHostName(name)` in a `max-w-[16ch] truncate` chip; grid row with the title track `minmax(0,1fr)`)
- Create: `src/lib/hostName.ts`
- Modify: `src/features/engagements/Sidebar.tsx`, `src/features/engagements/EngagementShell.tsx` (grid track for the sidebar)
- Create: `src/features/engagements/useSidebarStore.ts`
- Test: `src/test/sidebar.test.tsx`, `src/test/hostName.test.ts`; update `src/test/hostView.test.tsx` and any test that mentions "Story"

**Interfaces:**
- Produces:
  - `shortHostName(name: string): string` (first DNS label; IPs and single labels unchanged);
  - `useSidebarStore: { collapsed: boolean; toggle(): void }`, persisted at `raven.sidebar.collapsed`;
  - `LogEntryRow` prop `currentHostId?: string`.

- [ ] **Step 1: Write failing tests.**
  - `shortHostName("web-finance-dmz-portal-01.dmz.finance.lumen.corp") === "web-finance-dmz-portal-01"`, `shortHostName("10.10.20.15") === "10.10.20.15"`, `shortHostName("dc01") === "dc01"`.
  - Sidebar renders a heading `Engagement` (`getByRole("heading", { name: "Engagement" })`) before the section links.
  - Each host row shows the short name and the IP as two separate text nodes; the full name is in `title`.
  - Pressing ⌘B sets `aria-expanded="false"` on the sidebar toggle button (`getByRole("button", { name: /sidebar/i })`), and pressing it again sets it back.
  - HostView has a `tab` named "Log" and none named "Story".
  - A `LogEntryRow` with `currentHostId` equal to its only host renders no chip.
- [ ] **Step 2: Run** `npx vitest run src/test/sidebar.test.tsx src/test/hostName.test.ts src/test/hostView.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The sidebar is a grid row: `grid-cols-[auto_minmax(0,1fr)]` in EngagementShell, with the sidebar width transitioning between `200px` and a `48px` rail (`transition-[width] duration-200 ease-out motion-reduce:transition-none`).
  - The rail shows Phosphor icons for sections plus number hints, and host glyphs.
  - Host rows are `grid-cols-[auto_minmax(0,1fr)_auto]`: glyph, then name over IP (IP `font-mono`, never truncated), then thread dot.
  - Toggle with ⌘B and a `SidebarSimple` icon button.
- [ ] **Step 4: Run the same tests, then** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): Log rename, sidebar heading, short host names with IP, collapsible sidebar`.

---

### Task 2: Migration 0010 and Rust commands for verdicts, identity, vectors, ruled-out links

**Files:**
- Create: `src-tauri/migrations/0010_host_facts.sql`
- Modify: `src-tauri/src/migrations/mod.rs`, `src-tauri/src/services.rs`, `src-tauri/src/notes.rs` (ruled_out), `src-tauri/src/hosts.rs` (or create `src-tauri/src/host_facts.rs` for identity and vectors), `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (register commands)
- Modify: `src/types/service.ts`, `src/types/notes.ts`, create `src/types/hostFacts.ts`, `src/lib/api.ts`, `src/audit/fakeApi.ts`, `src/audit/fixtures.ts`
- Test: Rust unit tests in the touched modules; `src/test/audit/fakeApi.test.tsx` still passes

**Schema (0010):**
```sql
ALTER TABLE services ADD COLUMN verdict TEXT CHECK (verdict IN ('candidate','untested','dead_end'));
ALTER TABLE ruled_out ADD COLUMN source_kind TEXT CHECK (source_kind IN ('service','vector'));
ALTER TABLE ruled_out ADD COLUMN source_id TEXT;
CREATE TABLE host_identity (
  host_id    TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  username   TEXT NOT NULL,
  privileges TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  groups     TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  entry_id   TEXT REFERENCES log_entries(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE privesc_vectors (
  id         TEXT PRIMARY KEY,
  host_id    TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('try','untested','ruled_out')),
  source     TEXT NOT NULL CHECK (source IN ('auto','manual')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (host_id, title)
);
CREATE TABLE nvd_cache (
  cve_id     TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  json       TEXT NOT NULL
);
```
(Check the real log table name in `0002_hosts_log.sql` and use it in the `entry_id` reference.)

**Interfaces:**
- Produces (TS, in `src/types/hostFacts.ts` and `src/lib/api.ts`):
  - `type ServiceVerdict = "candidate" | "untested" | "dead_end"`; `Service.verdict: ServiceVerdict | null`.
  - `RuledOut.sourceKind: "service" | "vector" | null`, `RuledOut.sourceId: string | null`.
  - `interface HostIdentity { hostId: string; username: string; privileges: string[]; groups: string[]; entryId: string | null; updatedAt: number }`
  - `type VectorStatus = "try" | "untested" | "ruled_out"`; `interface PrivescVector { id: string; hostId: string; title: string; status: VectorStatus; source: "auto" | "manual"; createdAt: number; updatedAt: number }`
  - `api.serviceSetVerdict(id: string, verdict: ServiceVerdict | null, reason?: string): Promise<Service>`. Setting `dead_end` requires a non-empty `reason` and creates a `ruled_out` row (`source_kind='service'`, `source_id=id`, `text = "<port>/<proto> <identity>"`, `reason`, `private=0`). Leaving `dead_end` deletes the ruled_out rows with that source. All of this happens in one transaction.
  - `api.hostIdentityGet(hostId): Promise<HostIdentity | null>`, `api.hostIdentitySet(input: Omit<HostIdentity,"updatedAt">): Promise<HostIdentity>`
  - `api.vectorsList(hostId): Promise<PrivescVector[]>`, `api.vectorUpsert(hostId, input: { title: string; status: VectorStatus; source: "auto"|"manual" }): Promise<PrivescVector>`. Upsert on `(host_id,title)`; an `auto` upsert never downgrades a `ruled_out` set by hand.
  - `api.vectorSetStatus(id, status: VectorStatus, reason?: string): Promise<PrivescVector>`. `ruled_out` works like `dead_end`, with `source_kind='vector'`.
  - `api.vectorDelete(id): Promise<null>`.

- [ ] **Step 1: Write failing Rust tests.**
  - `migrates_9_to_10_keeps_rows`: a v9 DB with a service and a ruled_out row migrates; the old rows have `verdict` NULL and `source_kind` NULL.
  - `dead_end_requires_reason`.
  - `dead_end_creates_linked_ruled_out`.
  - `unset verdict removes only its own ruled-out item`: a hand-written ruled_out on the same host survives.
  - `vector auto upsert does not downgrade manual ruled_out`.
  - `identity set replaces previous`.
- [ ] **Step 2: Run** `(cd src-tauri && cargo test)`. Expected: FAIL (no table or column).
- [ ] **Step 3: Implement** the migration, the Rust structs (`#[serde(rename_all = "camelCase")]`, like `Service`), and the commands. Register them in `lib.rs`. Add the TS types, the `api` entries (one per command, like existing ones) and the fake implementations. Add fixtures:
  - `h-web`: verdicts on 3 services (one `dead_end` with a linked ruled_out);
  - `h-exam-ms01`: `access: "user"`, an identity `ms01\iis_apppool` with `SeImpersonatePrivilege`, and 2 vectors.
- [ ] **Step 4: Run** `(cd src-tauri && cargo test) && npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(data): service verdicts, host identity, privesc vectors, ruled-out source links (migration 10)`.

---

### Task 3: Facts engine (phase, service folding and sorting, identity parsing)

**Files:**
- Create: `src/engines/facts/phase.ts`, `src/engines/facts/services.ts`, `src/engines/facts/identity.ts`, `src/engines/facts/index.ts`
- Test: `src/test/engines/facts/*.test.ts`

**Interfaces:**
- Produces:
  - `phaseOf(host: Pick<Host,"access">): "before" | "after"` (`none` gives before; `user`/`root` give after).
  - `serviceIdentity(s: Service): { label: string; confirmed: boolean; unidentified: boolean }`. When confirmed, the label is `"<product> <version>"`; otherwise the nmap service and version. `unidentified` is true when the nmap service is null, ends with `?`, or is `unknown`.
  - `effectiveVerdict(s: Service): ServiceVerdict | "identify"` (unidentified and unset gives `identify`; unset otherwise gives `untested`).
  - `foldServices(services: Service[]): { rows: Service[]; rpc: Service[]; udp: Service[] }`. `rpc` is TCP 49152–65535 with nmap service `msrpc` and no verdict; `udp` is every UDP service without a verdict.
  - `sortServices(rows: Service[]): Service[]`, ordered candidate, identify, untested, dead_end, with port as the tie-break.
  - `parseIdentity(command: string, output: string): { username?: string; privileges: string[]; groups: string[] } | null`. It recognises `whoami`, `whoami /priv`, `whoami /groups`, `whoami /all` and `id`; anything else returns null. Privileges are names whose state column is `Enabled` or `Disabled` (all listed ones count).
  - `vectorsFromIdentity(id: { privileges: string[]; groups: string[] }): string[]`. Each `Se*` in `["SeImpersonatePrivilege","SeAssignPrimaryTokenPrivilege","SeBackupPrivilege","SeRestorePrivilege","SeDebugPrivilege","SeLoadDriverPrivilege","SeTakeOwnershipPrivilege","SeManageVolumePrivilege"]` maps to the title `"<Name> abuse"`. Each Linux group in `["sudo","wheel","docker","lxd","disk","adm"]` maps to `"<group> group"`.

- [ ] **Step 1: Write failing tests**, using real-shaped outputs as fixtures:
  - a `whoami /priv` table with `SeImpersonatePrivilege ... Enabled`;
  - `id` output `uid=1001(tom) gid=1001(tom) groups=1001(tom),27(sudo),999(docker)`.

  Assertions:
  - `phase follows access, not board column` (a host in `privilege-escalation` with access `none` gives `"before"`);
  - `foldServices` puts 7 msrpc 4966x ports in `rpc` and 17 UDP in `udp`;
  - `sortServices` order;
  - `vectorsFromIdentity` returns `["SeImpersonatePrivilege abuse"]` and `["sudo group","docker group"]`;
  - `parseIdentity("ls -la", "…")` returns null.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/facts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(facts): phase, service folding and sorting, identity parsing`.

---

### Task 4: Identity capture on save

**Files:**
- Modify: `src/features/capture/saveCapture.ts`
- Test: `src/test/saveCapture.test.ts` (extend)

**Interfaces:**
- Consumes: `parseIdentity`, `vectorsFromIdentity` (Task 3); `api.hostIdentitySet`, `api.vectorUpsert` (Task 2).
- Produces: no new exports. After a command entry saves, each command block with exactly one linked target host whose `ranOn` is that host's name is parsed, and the identity is set with `entryId` = the new entry. Each derived vector is upserted with `status:"try", source:"auto"`. Failures here never fail the save (same pattern as `PartialSaveError` for credential intake: the entry stays saved and the error message names what didn't update).

- [ ] **Step 1: Write failing tests.**
  - Saving a capture with `whoami /priv` output against `h1` calls `hostIdentitySet` with the privileges and `vectorUpsert` with `"SeImpersonatePrivilege abuse"`.
  - A capture with two hosts linked calls neither.
  - A rejected `hostIdentitySet` still resolves the saved entry and reports a partial-save error.
- [ ] **Step 2: Run** `npx vitest run src/test/saveCapture.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(capture): record host identity and privesc vectors from whoami and id output`.

---

### Task 5: Host page layout, Next tab, Facts column

**Files:**
- Modify: `src/features/hosts/HostView.tsx` (the new grid; tabs Next · Log · Findings; ⌥1–3; remove `NowPanel` and the Credentials tab)
- Create: `src/features/hosts/facts/FactsColumn.tsx`, `src/features/hosts/facts/ServicesFacts.tsx`, `src/features/hosts/facts/CoverageFacts.tsx`, `src/features/hosts/facts/IdentityFacts.tsx`, `src/features/hosts/facts/VectorsFacts.tsx`, `src/features/hosts/facts/HostCredentialsFacts.tsx`, `src/features/hosts/facts/FactGroup.tsx`, `src/features/hosts/facts/useFactFolds.ts`
- Create: `src/features/hosts/NextTab.tsx` (the current stage's open steps, then "Full checklist ▸" rendering `HostChecklist`)
- Modify: `src/features/checklist/GoalRow.tsx` (the one-line credentials notice), `src/features/checklist/CommandList.tsx` (Copy in a fixed grid track, gap ≥ 8px, Phosphor `Copy` icon)
- Delete: `src/features/checklist/NowPanel.tsx`, `src/features/hosts/ServicesColumn.tsx` once their content has moved (move `ServicesColumn`'s add, confirm and edit actions into `ServicesFacts`)
- Move: everything `src/features/credentials/HostCredentials.tsx` renders goes into `HostCredentialsFacts` (results with proof links, untested engagement credentials, access without a secret)
- Test: `src/test/hostView.test.tsx` (rewrite), `src/test/hostFacts.test.tsx`, update `src/test/nowPanel.test.tsx` (delete it, with its assertions ported to `hostFacts`/`nextTab`), `src/test/hostChecklist.test.tsx`, `src/test/credentials.test.tsx`

**Interfaces:**
- Consumes: Task 3 engines; Task 2 api and types; `shortHostName` (Task 1).
- Produces:
  - `FactsColumn({ engagementId, host, variant }: { engagementId: string; host: Host; variant: "column" | "stacked" })`, reused by Task 7's left pane;
  - `useFactFolds(hostId: string): { isOpen(group: FactGroupId): boolean; toggle(group: FactGroupId): void }`, with `type FactGroupId = "coverage" | "services" | "credentials" | "identity" | "vectors" | "accounts"`. It is persisted per host in `localStorage` key `raven.facts.<hostId>` (fold state only; no host data).

**Behaviour (from spec §4):**
- The current phase's groups are open by default; the other groups render as a one-line summary button.
  - Services summary: `Services · <n> ✓ · entry <first candidate> · <k> ?`.
  - Coverage summary: `Coverage · <stage> <done>/<applicable>`.
  - Host Credentials summary: `Host Credentials · <works> work · <untested> untested`.
- `S` toggles the services group.
- `ServicesFacts` is a grid `grid-cols-[6ch_minmax(0,1fr)_auto]` (port/proto, identity, verdict), using `foldServices` + `sortServices`. The `msrpc ×N` and `N UDP` rows expand in place.
  - A focused row accepts `C`, `U` and `D`. `D` opens a one-line reason input; Enter calls `serviceSetVerdict`.
  - Unconfirmed identities are dimmed; a confirmed one shows `✓` and nmap's guess on hover (`title`).
- **IdentityFacts** shows the username, the privileges (notable ones in the accent colour) and a link to the source log entry. An edit icon opens the inline fields for `hostIdentitySet`.
- **VectorsFacts** lists the vectors with their statuses. "+ Add vector" (with Phosphor `Plus`) calls `vectorUpsert` with `source: "manual"`. Marking one ruled out asks for one line (`vectorSetStatus(id,"ruled_out",reason)`); reopening sets `untested`.
- "Other accounts" lists engagement hashes not yet cracked and credentials whose username differs from the identity's. Its summary is `Other accounts · <n>`.
- The credentials notice in GoalRow renders as `<n> new creds since done · re-check ▸` on one line; the labels list sits in the disclosure underneath.

- [ ] **Step 1: Write failing tests.**
  - `hostView`: the tabs are exactly `["Next","Log","Findings"]`; ⌥2 selects Log; no element has text "Now".
  - `hostFacts`:
    - a host with access `none` renders the open groups Coverage, Services and Host Credentials and folded Identity summaries;
    - access `user` renders Who am I with `SeImpersonatePrivilege`, and Privesc vectors with "SeImpersonatePrivilege abuse", plus a folded `Services ·` summary;
    - pressing `S` toggles Services;
    - `D` on a focused row, then typing "patched" and pressing Enter, calls `serviceSetVerdict(id,"dead_end","patched")`;
    - 7 msrpc ports render one row containing `msrpc ×7`.
  - `goalRow`: with 12 labels the notice is one element containing `12 new creds since done`, and the labels are not in the document until it's expanded.
- [ ] **Step 2: Run** `npx vitest run src/test/hostView.test.tsx src/test/hostFacts.test.tsx src/test/hostChecklist.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The HostView root is `@container/host grid` with rows `auto minmax(0,1fr)`.
  - At `@min-[760px]/host` the body is `grid-cols-[minmax(16rem,1fr)_minmax(0,1.4fr)]` (Facts, work); below that it is one column with `FactsColumn variant="stacked"` (all groups folded to summaries) above the work column.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(host): phase-aware facts column, Next tab, Host Credentials, one-line credentials notice`.

---

### Task 6: CVSS 4.0, the local builder, and the NVD lookup

**Files:**
- Modify: `src/engines/findings/cvss.ts` (3.0/3.1 unchanged); create `src/engines/findings/cvss4.ts`, `src/engines/findings/cvss4Lookup.ts`, `src/engines/findings/nvdFill.ts`
- Create: `src/features/findings/CvssBuilder.tsx`
- Modify: `src-tauri/Cargo.toml` (`ureq = { version = "2", default-features = false, features = ["tls"] }`), create `src-tauri/src/nvd.rs`, modify `src-tauri/src/settings.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`
- Modify: `src/types/settings.ts`, `src/lib/api.ts`, `src/audit/fakeApi.ts`, `src/features/settings/SettingsPage.tsx` (the NVD API key field)
- Modify: `PRODUCT.md` (Capabilities, Vault line: "makes no network calls at runtime except NIST NVD CVE lookups") and `docs/superpowers/specs/2026-11-03-raven-desktop-design.md` §2 non-goal (append "Exception: NIST NVD CVE lookups, user decision 2026-11-06.")
- Test: `src/test/engines/findings/cvss4.test.ts`, `src/test/engines/findings/nvdFill.test.ts`, `src/test/cvssBuilder.test.tsx`, Rust tests in `nvd.rs` and `settings.rs`

**Interfaces:**
- Produces:
  - `parseCvssAny(vector: string): { version: "3.0" | "3.1" | "4.0"; metrics: Record<string,string> } | null`. Unprefixed 3.x vectors are read as `"3.1"`.
  - `scoreCvss(vector: string): number | null`, used everywhere `calculateCvssScore` is used today; keep `calculateCvssScore` as a 3.x alias.
  - `cvss4Score(metrics: Record<string,string>): number`: the official FIRST v4.0 base score (MacroVector lookup + severity distances), ported from FIRST's reference `cvss_score.js`/`cvss_lookup.js` (github.com/FIRSTdotorg/cvss-v4-calculator), with the lookup table as data in `cvss4Lookup.ts`.
  - `interface NvdRecord { cveId: string; description: string | null; vector: string | null; score: number | null; cwes: string[]; references: string[]; published: string | null; lastModified: string | null }`
  - `api.nvdLookup(cveId: string): Promise<NvdRecord>`. Errors are `RavenError` with codes `no_key`, `offline`, `key_rejected`, `not_found` (add them to `ErrorCode`).
  - `Settings.nvdKeySet: boolean`; `SettingsPatch.nvdApiKey?: string` (an empty string clears it).
  - `nvdFill(current: { cvssVector: string; description: string; refs: string[] }, records: NvdRecord[]): { apply: Partial<{ cvssVector: string; description: string; refs: string[] }>; diffs: { field: "cvssVector" | "description"; nvd: string }[] }`.
  - `CvssBuilder({ value, onChange }: { value: string; onChange(vector: string): void })`: one segmented control per base metric, a 3.1/4.0 toggle (default 4.0), and the live score.
- Rust `nvd.rs`:
  - `fn lookup(conn, key: &str, cve: &str) -> AppResult<NvdRecord>`: cache first (`nvd_cache`); otherwise `GET https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=<CVE>` with header `apiKey`, a 10s timeout, and the raw JSON cached on success.
  - `fn parse(json: &serde_json::Value) -> Option<NvdRecord>`. The vector is picked in this order: `cvssMetricV40` > `cvssMetricV31` > `cvssMetricV30`, and within a version the entry with `"type":"Primary"` first, else the first `"Secondary"`.
  - Validate the CVE ID against `^CVE-\d{4}-\d{4,}$` before any request.
  - The tauri command is `async` and runs the request in `tauri::async_runtime::spawn_blocking`.

- [ ] **Step 1: Write failing tests.**
  - `cvss4`:
    - `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N` → `9.3`;
    - `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N` → `0`;
    - plus at least 8 vectors with expected scores taken from FIRST's calculator (record the source in the test file);
    - an unprefixed `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H` parses as 3.1 → `9.8`.
  - `nvdFill`:
    - an empty vector takes the highest-scoring record's vector;
    - `nvdFill offers a diff for a filled vector`;
    - an empty description fills;
    - refs gain the URLs and `CWE-79`, deduplicated;
    - any `exploit-db.com/exploits/12345` URL also adds `EDB-12345`.
  - `cvssBuilder`: clicking AV:Network…A:High in 3.1 mode emits `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`.
  - Rust:
    - `parse` on a fixture with both a V40 Secondary and a V31 Primary entry picks the V40 vector;
    - with V40 Primary and Secondary, it picks Primary;
    - an invalid CVE ID returns a validation error without a request;
    - `settings_get` never contains the key, and `nvdKeySet` reflects it.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/findings src/test/cvssBuilder.test.tsx && (cd src-tauri && cargo test nvd settings)`. Expected: FAIL.
- [ ] **Step 3: Implement.** Map errors: no key → `no_key`; transport error → `offline`; HTTP 401/403 → `key_rejected`; empty `vulnerabilities` → `not_found`.
- [ ] **Step 4: Run** all suites. Expected: PASS. Confirm `grep -n "connect-src" src-tauri/tauri.conf.json` is unchanged.
- [ ] **Step 5: Commit** `feat(findings): CVSS 4.0 scoring, metric builder, NVD CVE lookup (the one network exception)`.

---

### Task 7: In-place finding split editor

**Files:**
- Create: `src/features/findings/FindingSplit.tsx` (the split shell), `src/features/findings/SplitLeftPane.tsx` (tabs Log · Facts · Notes plus the host switcher), `src/features/findings/useFindingDraftStore.ts`, `src/features/findings/RefSuggestions.tsx`, `src/features/findings/ServicePicker.tsx`, `src/engines/findings/refs.ts`
- Modify: `src/features/findings/FindingEditor.tsx` (from a `Dialog` to an inline form inside `FindingSplit`; uses `CvssBuilder`, `nvdFill`, `ServicePicker`; ⌘↵ saves, `Esc` closes and keeps the draft)
- Modify: `src/features/findings/HostFindings.tsx`, `src/features/findings/FindingsSection.tsx`, `src/features/hosts/HostView.tsx` (`F` opens the split for a new finding on this host)
- Create: `src/features/notes/NoteEditor.tsx`, extracted from `NotesPanel.tsx` (the textarea, autosave and thread toggle for a `NoteTarget`), used by both NotesPanel and the left pane
- Modify: `src/features/vault/VaultGate.tsx` (call `useFindingDraftStore.getState().clearAll()` when the vault locks, including via `onLockedError`)
- Test: `src/test/findingSplit.test.tsx`, `src/test/engines/findings/refs.test.ts`; update `src/test/findings.test.tsx`, `src/test/findingSteps.test.tsx`, `src/test/notesBugs.test.tsx`

**Interfaces:**
- Consumes:
  - `FactsColumn` (Task 5);
  - `nvdFill`, `CvssBuilder`, `api.nvdLookup`, `scoreCvss` (Task 6);
  - `foldServices`, `sortServices`, `serviceIdentity` (Task 3);
  - `LogEntryRow` with `currentHostId` (Task 1).
- Produces:
  - `suggestRefs(texts: string[]): string[]`: unique `CVE-YYYY-N+` and `EDB-<n>` (from `EDB-ID: <n>`, `EDB-ID <n>`, `exploit-db.com/exploits/<n>`), in order of first appearance;
  - `useFindingDraftStore: { drafts: Record<string, Draft>; get(key): Draft | undefined; set(key, d: Draft): void; drop(key): void; clearAll(): void }`, memory only (no `persist`). The key is `${eid}:${hostId ?? ""}:${findingId ?? "new"}`;
  - `FindingSplit({ eid, hostId, edit, onClose }: { eid: string; hostId: string | null; edit: Finding | "new"; onClose(): void })`.

**Behaviour (from spec §4.5):**
- **Layout:** in the host page, `FindingSplit` replaces the work column and Facts with `grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]` (left pane, editor). Below `@min-[760px]/host` only one pane shows, and ⌘\ flips between them.
- **Left pane:**
  - tabs Log · Facts · Notes;
  - the host switcher lists the draft's affected hosts;
  - with no host, it shows the engagement Log;
  - clicking a Log row (or Enter on a focused row) appends its id to `stepEntryIds`;
  - `N` while the split is open selects the Notes tab instead of opening the panel;
  - `H` closes the split (the draft is kept) and opens the stuck view.
- **ServicePicker:** shows only the services of the draft's `hostIds`, in the same grid, identity, folding and sort as `ServicesFacts`, with one checkbox per row.
- **RefSuggestions:** shows `suggestRefs` over this host's (or the selected hosts') log entry text and note bodies, minus refs already added, as one-click chips.
- **NVD:** adding a `CVE-…` ref calls `nvdLookup` (debounced 400ms). Results go through `nvdFill`: `apply` merges into the draft, and each `diffs` item renders "NVD has a different <field> · use NVD". Errors render one line under refs:

  | Error | Line |
  |---|---|
  | `no_key` | "Add an NVD API key in Settings to look up CVEs · use the builder" |
  | `offline` | "No connection · use the builder" |
  | `key_rejected` | "NVD rejected the key" |
  | `not_found` | "CVE not found on NVD" |

  Save is never blocked by a lookup.
- **Engagement Findings section:** opens `FindingSplit` with `hostId` = the single affected host, or null.

- [ ] **Step 1: Write failing tests.**
  - `refs`: `suggestRefs(["see CVE-2021-41773 and EDB-ID: 50383", "https://www.exploit-db.com/exploits/50383"])` → `["CVE-2021-41773","EDB-50383"]`.
  - `findingSplit`:
    - `F` on a host page shows a form named "New finding" and a Log tab together, and no `role="dialog"`;
    - clicking a Log row adds it to the Steps list;
    - `Esc` closes, and pressing `F` again restores the typed title;
    - `drafts are cleared on lock`;
    - the services picker lists only the selected hosts' services and shows the confirmed `IIS 10.0`, not `http`;
    - with `nvdLookup` rejecting `offline`, the "No connection" line shows and Save still calls `findingCreate`;
    - `lookup failure leaves the form savable`.
- [ ] **Step 2: Run** `npx vitest run src/test/findingSplit.test.tsx src/test/engines/findings/refs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(findings): in-place split editor with live host context, ref suggestions and NVD fill`.

---

### Task 8: Audit coverage and hard regressions

**Files:**
- Modify: `audit/regressions.spec.ts`, `audit/screens.ts`, `audit/checks/layout.ts` (the `narrow-wrap` check), `audit/fixtures/selftest-layout.html` (a `narrow-wrap` case plus a clean case), `audit/selftest.spec.ts`
- Modify: `audit/types.ts` (add `"narrow-wrap"` to `CheckId`)

**Interfaces:**
- Consumes: the fixture IDs from `src/audit/fixtures.ts` (`h-web`, `h-exam-ms01`, `e-lab`, `e-exam`); UI from Tasks 1–7.

- [ ] **Step 1: Add the hard regressions** (each must fail on `main`):
  - `host page never scrolls sideways`: for widths `[800,900,1024,1280,1440]` on `/e/e-lab/h/h-web`, `document.documentElement.scrollWidth <= innerWidth`, and every `role=tab` is fully inside the viewport.
  - `credentials notice stays one line`: on `/e/e-lab/h/h-web` at 900 with Full checklist open, the element containing `new creds since done` has height ≤ 2 × line-height.
  - `add finding opens beside the log`: `F` gives `role=dialog` count 0, the Log tab is visible, clicking the first Log row adds one step, and Escape then `F` keeps the title.
  - `finding services are the selected hosts' only`: with only `h-web` selected, no `dc01` service label is visible.
  - `sidebar collapses without sideways scroll and shows IPs`: after ⌘B, `scrollWidth <= innerWidth`; after ⌘B again, each host row contains its IP text; no host name equals `web-fin…`.
  - `log rows on a host page have no chip for that host`.
  - `post-foothold facts`: `/e/e-exam/h/h-exam-ms01` shows "Who am I" and "SeImpersonatePrivilege abuse" without scrolling at 1280×900.
- [ ] **Step 2: Add `narrow-wrap`:** a text block with ≥ 4 rendered lines and a mean of ≤ 6 characters per line (characters ÷ `Range.getClientRects()` line count), excluding `pre`/`code`. Add self-test case `narrow-wrap` (a 40px-wide paragraph of words) and a clean case.
- [ ] **Step 3: Update `audit/screens.ts`:**
  - rename `host-story` to `host-log`;
  - remove `host-credentials`;
  - add `host-next`, `host-postfoothold` (`/e/e-exam/h/h-exam-ms01`), `finding-split` (`F` on `h-web`) and `sidebar-collapsed` (⌘B on `h-web`);
  - update `SHORTCUTS` in `audit/checks/keyboard.ts` with `S`, `F`, ⌘B, ⌥2.
- [ ] **Step 4: Run** `npm run audit:visual`. Expected: all tests pass, and `report.md` has 0 `narrow-wrap` rows for the host screens. Run each new regression against `git stash` of the app code to confirm it fails, and record that in the commit message.
- [ ] **Step 5: Commit** `test(audit): host page, finding split and sidebar regressions; narrow-wrap check`.
