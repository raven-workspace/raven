# Network Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tunnels and hops their own Network section (a visual attack path), and nudge on the host page when logged interface output shows an unreached subnet.

**Architecture:** Two pure engines (interface parsing/suggestions in `src/engines/facts/interfaces.ts`, path layout in `src/engines/network/path.ts`) feed two UI surfaces (`src/features/network/NetworkSection.tsx`, `src/features/network/InterfaceNudge.tsx`). Nudge dismissals persist in a new SQLite table via the existing Tauri command pattern. The tree is a recursive CSS-grid component with elbow connectors drawn by borders: no measuring, no SVG geometry.

**Tech Stack:** React + TypeScript, TanStack Query, Tailwind (tokens in the project), Vitest + Testing Library, Tauri 2 + Rust + rusqlite.

**Spec:** `docs/superpowers/specs/2026-11-11-raven-network-section-design.md`

## Global Constraints

- No new dependencies (npm or cargo).
- CSS grid by default; flex only for single-line runs.
- Icons are Phosphor (`@phosphor-icons/react`); row/control actions are icon buttons (`IconButton`), not rows of text buttons.
- Text sizes use existing tokens (`text-body`, `text-meta`, `text-code`, `text-label`); nothing smaller than `text-label`.
- Migrations append only (`0014_…`, version 14); never edit a shipped migration. Backup-before-migrate is automatic in `src-tauri/src/migrations/mod.rs`.
- Commit messages: conventional (`feat(network): …`), **no** `Co-Authored-By` or other AI attribution lines (owner rule, enforced by a hook).
- Before any UI edit, read `DESIGN.md` and the impeccable craft floor (`.claude/skills/impeccable/reference/craft-floor.md`).
- Every task ends green on: `npm run typecheck`, `npm run lint`, `npm test`, and (Rust tasks) `cd src-tauri && cargo test`.
- Exact copy (use verbatim):
  - Section label: `Network`
  - Empty path: `Your first foothold records your first hop.`
  - Tray heading: `Not reached`
  - Marker: `Needs tunnel`
  - Unrecorded edge label: `not recorded`
  - Nudge line: `{iface} {ip}/{prefix} reaches {subnet}.`
  - Nudge action: `Mark dual-homed and add tunnel` (host not dual-homed) / `Add tunnel` (already dual-homed)
  - Virtual line: `Also seen: {iface} {ip}/{prefix} (virtual)` (several joined with ` · `)
  - Checklist pointer: `Tunnels and hops are in Network (5).`

## Review Focus

1. **Host with no IP** → the nudge shows nothing and does not throw. Test in Task 2.
2. **`ip a` output with IPv4 and IPv6 on one interface, and the same subnet logged twice** → exactly one suggestion; IPv6 ignored. Test in Task 2.
3. **Hop chain with an unrecorded start** (A→B logged, no Kali→A) → A sits under Kali with a `not recorded` edge, B under A; neither in Not reached. Test in Task 5.
4. **Hop cycle** (A→B and B→A, plus Kali→A) → terminates; each host appears once; the extra hop is in `alsoVia`. Test in Task 5.
5. **Windows `ipconfig` with `(Preferred)` suffixes and an Autoconfiguration 169.254 address** → parses the real address with the right prefix; drops 169.254. Test in Task 1.

---

### Task 1: Interface parser

**Files:**
- Create: `src/engines/facts/interfaces.ts`
- Modify: `src/engines/facts/index.ts` (export it), `src/engines/parse/scope.ts` (add `networkOf`, `maskToPrefix`)
- Test: `src/test/engines/facts/interfaces.test.ts`

**Interfaces:**
- Produces:
  - `interface NetInterface { name: string; ip: string; prefix: number; virtual: boolean }`
  - `parseInterfaces(output: string): NetInterface[]`: IPv4 only, first-seen order, deduped by `ip`; drops 127.0.0.0/8, 169.254.0.0/16, 0.0.0.0.
  - `isVirtualInterface(name: string): boolean`: spec's list; prefix match, case-insensitive. Windows names match anywhere in the adapter name.
  - In `scope.ts`: `networkOf(ip: string, prefix: number): string` (e.g. `"172.16.5.0/24"`), `maskToPrefix(mask: string): number | null` (`"255.255.255.0"` → 24; non-contiguous → null).

- [ ] **Step 1: Write failing tests**, one `it` per format, using real-shaped output:
  - `ip a`: `"2: eth0: <BROADCAST…>\n    inet 10.10.5.20/24 brd …\n    inet6 fe80::1/64 scope link\n3: eth1: …\n    inet 172.16.5.10/24 …\n1: lo: …\n    inet 127.0.0.1/8"` → `[{name:"eth0",ip:"10.10.5.20",prefix:24,virtual:false},{name:"eth1",ip:"172.16.5.10",prefix:24,virtual:false}]`.
  - `ifconfig` (net-tools new): `"eth1: flags=4163<UP…>\n        inet 172.16.5.10  netmask 255.255.255.0  broadcast …"` → eth1 /24.
  - `ifconfig` (old): `"eth1      Link encap:Ethernet\n          inet addr:172.16.5.10  Bcast:…  Mask:255.255.255.0"` → eth1 /24.
  - `ipconfig /all`: `"Ethernet adapter Ethernet1:\n   IPv4 Address. . . . . . . . . . . : 172.16.5.10(Preferred)\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\nEthernet adapter Ethernet2:\n   Autoconfiguration IPv4 Address. . : 169.254.3.4(Preferred)\n   Subnet Mask . . . : 255.255.0.0"` → only `{name:"Ethernet1",ip:"172.16.5.10",prefix:24}` (Review Focus 5).
  - `docker0` at `172.17.0.1/16` → `virtual: true`; `"vEthernet (WSL)"` → `virtual: true`.
  - Non-interface output (`"Nmap scan report for 10.0.0.1"`) → `[]`.
  - `networkOf("172.16.5.10", 24) === "172.16.5.0/24"`; `maskToPrefix("255.255.240.0") === 20`; `maskToPrefix("255.0.255.0") === null`.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/facts/interfaces.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3: Implement.** Line-oriented state machine: a header line sets the current interface name (`^\d+: (\S+?)[:@]` for `ip a`; `^(\S+?):? ` + `flags=` or `Link encap` for ifconfig; `adapter (.+):$` for ipconfig). Address lines attach to the current name; ipconfig's mask comes from the following `Subnet Mask` line. Strip `(Preferred)`/`(Duplicate)`.
- [ ] **Step 4: Run** the test file again. Expect PASS.
- [ ] **Step 5: Commit** `feat(facts): parse IPv4 interfaces from ip/ifconfig/ipconfig output`

### Task 2: Interface reading for a host

**Files:**
- Modify: `src/engines/facts/interfaces.ts`, `src/types/network.ts`
- Test: `src/test/engines/facts/interfaces.test.ts`

**Interfaces:**
- Consumes: Task 1; `isIdentityEntryFor`, `isIdentityBlockFor`, `identityBlocksOf` from `src/engines/facts/identity.ts` (same "this block ran on this host" rule; reuse, do not rename); `ipInScope` from `scope.ts`.
- Produces (in `src/types/network.ts`): `interface InterfaceDismissal { engagementId: string; hostId: string; subnet: string; createdAt: number }`.
- Produces (in `interfaces.ts`):
  - `interface InterfaceSuggestion { key: string; hostId: string; iface: string; ip: string; prefix: number; subnet: string; entryId: string }`. `key = \`${hostId}|${subnet}\``.
  - `interface InterfaceReading { suggestions: InterfaceSuggestion[]; alsoSeen: { iface: string; ip: string; prefix: number; subnet: string }[] }`
  - `readInterfaces(entries: LogEntry[], host: Host, tunnels: Tunnel[], dismissals: InterfaceDismissal[]): InterfaceReading`

Rules: entries newest first; one result per subnet (newest wins). Virtual → `alsoSeen`. Non-virtual is skipped when: `host.ip` is null (everything; Review Focus 1), its subnet contains `host.ip`, any tunnel subnet contains its ip, or a dismissal matches `hostId` + `subnet`.

- [ ] **Step 1: Write failing tests:**
  - host `ip:"10.10.5.20"`, an entry whose command block `ip a` shows eth0 10.10.5.20/24 + eth1 172.16.5.10/24 + docker0 172.17.0.1/16 → `suggestions` = one `{iface:"eth1", subnet:"172.16.5.0/24", key:"h1|172.16.5.0/24"}`; `alsoSeen` = docker0.
  - Same plus a second, older entry with the same eth1 output → still one suggestion, `entryId` = newer entry (Review Focus 2).
  - Tunnel with `subnets:["172.16.5.0/24"]` → no suggestions.
  - Dismissal `{hostId:"h1", subnet:"172.16.5.0/24"}` → no suggestions.
  - `host.ip = null` → `{ suggestions: [], alsoSeen: [...] }`, no throw (Review Focus 1).
  - Entry linked to two hosts → ignored (follows `isIdentityEntryFor`).
- [ ] **Step 2: Run** the test file. Expect FAIL.
- [ ] **Step 3: Implement** `readInterfaces` per the rules.
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(facts): read a host's interfaces into tunnel suggestions`

### Task 3: Persist nudge dismissals

**Files:**
- Create: `src-tauri/migrations/0014_interface_dismissals.sql`
- Modify: `src-tauri/src/migrations/mod.rs` (append `(14, include_str!(…))`), `src-tauri/src/network.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (register beside `cleanup_dismiss`), `src/lib/api.ts`, `src/audit/fakeApi.ts`, `src/features/checklist/queries.ts`
- Test: `src-tauri/src/network.rs` `mod tests`; `src/test/api.test.ts` if it enumerates commands

**Interfaces:**
- SQL:
  ```sql
  CREATE TABLE interface_dismissals (
    engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    subnet TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (host_id, subnet)
  );
  CREATE INDEX idx_interface_dismissals_engagement ON interface_dismissals(engagement_id);
  ```
- Rust (`network.rs`): `pub struct InterfaceDismissal { engagement_id, host_id, subnet, created_at }` (serde camelCase like `Tunnel`); `pub fn interface_dismissals_list(conn, engagement_id) -> AppResult<Vec<InterfaceDismissal>>`; `pub fn interface_dismiss(conn, engagement_id, host_id, subnet) -> AppResult<()>`. Validates that the host belongs to the engagement (`invalid("hostId", …)`) and that `subnet` is a valid CIDR (`invalid("subnet", …)`, reuse the subnet check in `clean_tunnel`). Idempotent: `INSERT OR IGNORE`.
- Tauri commands `interface_dismissals_list(engagement_id)`, `interface_dismiss(engagement_id, host_id, subnet)`.
- TS: `api.interfaceDismissalsList(engagementId): Promise<InterfaceDismissal[]>`, `api.interfaceDismiss(engagementId, hostId, subnet): Promise<null>`; matching in-memory `fakeApi`.
- Hooks in `src/features/checklist/queries.ts` (beside `useTunnels`): `useInterfaceDismissals(eid)` → `{ dismissals, query }` with key `["interfaceDismissals", eid]`; `useInterfaceDismiss(eid)` mutation whose `onSuccess` returns the invalidation promise (cleanup's pattern, so a dismissed row never flashes back).

- [ ] **Step 1: Write failing Rust tests:** dismiss then list returns one row; dismissing twice still one row; a host from another engagement → `AppError` with field `hostId`; `"nope"` subnet → field `subnet`; deleting the host cascades the row away.
- [ ] **Step 2: Run** `cd src-tauri && cargo test network::`. Expect FAIL.
- [ ] **Step 3: Implement** migration, Rust, commands, registration, TS api, fakeApi, hooks.
- [ ] **Step 4: Run** `cargo test` (whole crate, so the migration test suite runs) and `npm run typecheck && npm test`. Expect PASS.
- [ ] **Step 5: Commit** `feat(network): persist dismissed interface nudges`

### Task 4: Move the forms; strip the checklist panels

**Files:**
- Create: `src/features/network/TunnelForm.tsx`, `src/features/network/HopForm.tsx`
- Delete: `src/features/checklist/TunnelsPanel.tsx`, `src/features/checklist/HopsPanel.tsx`
- Modify: `src/features/checklist/EngagementChecklist.tsx`
- Test: `src/test/network/forms.test.tsx` (move the tunnel/hop cases out of `src/test/engagementChecklist.test.tsx`)

**Interfaces:**
- Produces:
  - `TunnelForm({ engagementId, hosts, tunnel?, initial?, onClose }: { …; initial?: { viaHostId?: string; subnets?: string[] } })`: body as today's `TunnelForm` in `TunnelsPanel.tsx`; `initial` prefills a new tunnel. When editing, the footer gains a destructive **Delete tunnel** button (left-aligned) that confirms with the existing `ConfirmDelete` (import from `../checklist/ConfirmDelete`).
  - `HopForm({ engagementId, hosts, hop?, onClose })`: as today's, plus the same Delete pattern (**Delete hop**).
- Checklist: remove both panels and their `useTunnels`/`useHops` calls if no longer used; add inside the Lateral movement `PlaybookSection`, after the goals, a `text-meta text-muted` line `Tunnels and hops are in Network (5).` where "Network" is a router `Link` to `sectionPath(id, "network")`. (Task 6 adds the section id. Until then, add `"network"` to `SECTIONS` in this task with a temporary `EmptyState`, so typecheck passes. Task 6 replaces it.)

- [ ] **Step 1: Write failing tests:** add-tunnel validation and listing (moved), edit tunnel → Delete tunnel → confirm calls `api.tunnelDelete`, hop add/edit/delete equivalents, `initial` prefills subnets and via host, and the checklist renders the pointer link and no "Tunnels" panel.
- [ ] **Step 2: Run** `npx vitest run src/test/network src/test/engagementChecklist.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full `npm test` (update `dashboard.test.tsx` number-key test: Report is now `7`). Expect PASS.
- [ ] **Step 5: Commit** `refactor(network): tunnel and hop forms own their delete; checklist points to Network`

### Task 5: Path model

**Files:**
- Create: `src/engines/network/path.ts`
- Test: `src/test/engines/network/path.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PathNode { host: Host; hop: Hop | null; recorded: boolean; children: PathNode[]; alsoVia: Hop[] }
  export interface NetworkPath { roots: PathNode[]; unreached: Host[]; columns: number }
  export function buildPath(hosts: Host[], hops: Hop[]): NetworkPath
  ```
  `roots` are Kali's children. `hop` is the inbound hop used as tree parent (null only when `recorded` is false). `columns` = deepest level + 1 (Kali excluded; 0 when no roots).

Algorithm (not determined by the signature):
1. Sort hops by `at`, then `id`. Ignore hops whose ends are not in `hosts`.
2. Breadth-first from Kali: a hop whose `from` is null or an already placed host places its `to` once (first hop wins). Every later hop into a placed host goes to that node's `alsoVia`.
3. When the queue empties and an unplaced host still has an outbound hop, place it under Kali with `recorded: false, hop: null`. Choose the earliest such host. Continue step 2. Repeat.
4. Hosts never placed → `unreached` (name order). Children are ordered by their hop's `at`.

- [ ] **Step 1: Write failing tests:** empty hops → `{roots:[], unreached: all, columns:0}`; Kali→A, A→B → depth 2, `columns:2`; Review Focus 3 (A→B only → A `recorded:false` under Kali, B under A, unreached excludes both); Review Focus 4 (Kali→A, A→B, B→A → A once, B once, B→A in A's `alsoVia`); two hops into B from A and Kali → earliest is parent, other in `alsoVia`; hop to a deleted host ignored.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/network/path.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(network): build the attack path from hops`

### Task 6: Network section

**Files:**
- Create: `src/features/network/NetworkSection.tsx`, `src/features/network/PathTree.tsx`, `src/lib/useWidth.ts` (move `useWidth` out of `HostView.tsx`; HostView imports it)
- Modify: `src/features/engagements/sections.tsx`
- Test: `src/test/network/networkSection.test.tsx`, `src/test/dashboard.test.tsx`

**Interfaces:**
- Consumes: `buildPath` (Task 5); `TunnelForm`, `HopForm` (Task 4); `useHosts`, `useTunnels`, `useHops`; `HostGlyph`; `Chip`; `queryState`; `useLocation().state?.hostId` for focus.
- Produces: `NetworkSection()` (reads `id` from route params like the other sections). `SECTIONS` gains `{ id: "network", label: "Network", empty: "" }` between `findings` and `checklist`; `SectionView` renders `NetworkSection`.

Behaviour:
- Header matches the other sections' header pattern (look at `CredentialsSection`): title `Network`, actions **Add hop** and **Add tunnel**.
- `PathTree` is recursive. Each subtree is a 2-column grid: `[node] [children stack]`. The children stack draws a vertical spine on its left from the first child's middle to the last child's middle, and each child has a horizontal stub carrying its edge label. `hop.via` is a text button that opens `HopForm` for that hop. A `not recorded` stub is dashed and muted. `alsoVia` shows as a `title` on the label ("Also via: …").
- Node: `HostGlyph`, host name (mono, a `Link` to `/e/:id/h/:hostId`), IP (`text-meta text-muted`). Each tunnel whose `viaHostId` is the node is a `Chip` button: `{Kind} · {subnets joined ", "} · {status}`, `variant="warn"` when down, `title` = callback IP. It opens `TunnelForm` for that tunnel. `host.dualHomed` with no tunnel via it → `Chip variant="warn"` button `Needs tunnel` → `TunnelForm` with `initial={{ viaHostId: host.id }}`.
- Kali root node: label `Kali`, settings `attackerIp` under it when set.
- No hops → Kali node plus `Your first foothold records your first hop.`
- `Not reached` tray below the tree: dimmed nodes (same node component, with tunnel chips and Needs tunnel), wrapping in a grid.
- Width: measure the section with `useWidth`. Tree when `width >= (columns + 1) * 240`, else an indented list (`variant="list"`: the same recursion, each level indented, edge label inline before the name: `via creds → WEB01`).
- Focus: when `location.state.hostId` is set, scroll that node into view (`block: "center"`) and set `data-focused` on it for 2 s (accent outline; respect reduced motion).

- [ ] **Step 1: Write failing tests:** pressing `5` opens Network; tree shows `Kali`, `WEB01` under it with edge `creds`; clicking `creds` opens "Edit hop"; tunnel chip text `Ligolo · 172.16.5.0/24 · up` opens "Edit tunnel"; dual-homed host without tunnel shows `Needs tunnel`, which opens "Add tunnel" with via preselected; unreached host under `Not reached`; empty copy; mocked width below threshold renders the list variant (`via creds`); navigating with `state: { hostId }` marks that node `data-focused`. Update the dashboard number-key test (Report = `7`, Network = `5`).
- [ ] **Step 2: Run** `npx vitest run src/test/network src/test/dashboard.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expect PASS.
- [ ] **Step 5: Commit** `feat(network): Network section with the attack path`

### Task 7: Host-page nudge

**Files:**
- Create: `src/features/network/InterfaceNudge.tsx`
- Modify: `src/features/hosts/facts/FactsColumn.tsx` (render above the fact groups)
- Test: `src/test/network/interfaceNudge.test.tsx`

**Interfaces:**
- Consumes: `readInterfaces` (Task 2); `useInterfaceDismissals`, `useInterfaceDismiss` (Task 3); `TunnelForm` with `initial` (Task 4); `useLog`, `useTunnels`; `useHostMutations(eid).update` for `dualHomed: true` (send the host's current fields; check `HostInput`).
- Produces: `InterfaceNudge({ engagementId, host }: { engagementId: string; host: Host })`. Renders nothing when there are no suggestions and no `alsoSeen`.

Behaviour: one row per suggestion, using the exact copy from Global Constraints. Action button: when `!host.dualHomed`, update the host to dual-homed first; on success, open `TunnelForm` with `initial={{ viaHostId: host.id, subnets: [s.subnet] }}`. Dismiss is an `IconButton` (Phosphor `X`) labelled `Dismiss {subnet} on {host.name}`. Hide the row optimistically while the mutation is in flight (cleanup's `flyingKeys` pattern). `alsoSeen` is one `text-meta text-muted` line. The row links its source: the subnet text opens the entry via `onOpenEntry` if FactsColumn passes it (it does for other groups).

- [ ] **Step 1: Write failing tests:** a logged `ip a` with a second subnet → the row text `eth1 172.16.5.10/24 reaches 172.16.5.0/24.`; clicking **Mark dual-homed and add tunnel** calls `hostUpdate` with `dualHomed: true`, then the "Add tunnel" dialog shows `172.16.5.0/24` and the via host; a dual-homed host shows **Add tunnel**; dismiss calls `interfaceDismiss("e1","h1","172.16.5.0/24")` and the row disappears; docker0 shows `Also seen: docker0 172.17.0.1/16 (virtual)`; a host with no IP shows no rows.
- [ ] **Step 2: Run** `npx vitest run src/test/network/interfaceNudge.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expect PASS.
- [ ] **Step 5: Commit** `feat(network): nudge for a tunnel when a host shows a new subnet`

### Task 8: Links into Network

**Files:**
- Modify: `src/features/checklist/goalCommands.ts`, `src/features/checklist/CommandList.tsx`, `src/engines/checklist/fill.ts` (only if `viaTunnel` lacks the host id), `src/features/stuck/StuckView.tsx`
- Test: `src/test/nextStepKey.test.tsx` or the existing via-tunnel chip test (`grep -rn "via tunnel on" src/test`), `src/test/stuck.test.tsx`

**Interfaces:**
- `viaTunnel` becomes `{ viaHostId: string; viaHostName: string; down: boolean }` through `goalCommands.ts` → `CommandList.tsx`.
- `CommandList` renders the chip as a router `Link` to `sectionPath(engagementId, "network")` with `state={{ hostId: viaHostId }}` (engagement id from `useParams().id`), styled as the same `Chip` (wrap it, or give `Chip` an `asChild`-free wrapper `<Link className=…>`; keep the visual identical plus a hover underline).
- `StuckView.go`: for `PIVOT_IDS` lines, navigate to `sectionPath(engagementId, "network")` with `{ state: { hostId: l.hostId } }`.

- [ ] **Step 1: Write failing tests:** the chip `via tunnel on WEB01` is a link and clicking it lands on Network with WEB01 focused; the stuck line `dual-homed, no tunnel recorded` navigates to Network with that host focused.
- [ ] **Step 2: Run** those test files. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expect PASS.
- [ ] **Step 5: Commit** `feat(network): via-tunnel chips and stuck lines open Network`

### Task 9: Look at it

**Files:** none new (fixes go into the owning files)

- [ ] **Step 1:** Seed the audit fixtures (`src/audit/fixtures.ts`) with a lab-sized engagement: about 15 hosts, depth 3, 2 tunnels (one down), 1 dual-homed host without a tunnel, 1 unrecorded chain start, and an `ip a` entry showing eth1 + docker0 on a host.
- [ ] **Step 2:** Run the app in WebKit (Safari / the Tauri window) at about 1,400 px and about 1,000 px wide. Screenshot Network (tree and list), the host page nudge, and the checklist pointer. Check: there's no horizontal scroll; labels don't truncate the host names; the dimmed tray is still readable; the focus highlight is visible; nothing uses text smaller than `text-label`.
- [ ] **Step 3:** Fix what one look shows, then look once more.
- [ ] **Step 4:** `npm run typecheck && npm run lint && npm test && (cd src-tauri && cargo test)`. Expect all green.
- [ ] **Step 5: Commit** `chore(network): lab-sized fixtures; visual fixes`
