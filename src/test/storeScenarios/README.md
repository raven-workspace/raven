# Store scenarios

A store scenario is a series of store commands and the lists expected after them. Every `*.json` file here runs twice, and both runs must pass:

- on the real store: `src-tauri/tests/store_scenarios.rs` runs it on a migrated in-memory SQLite database, calling the same domain module functions the Tauri commands call (`cd src-tauri && cargo test --test store_scenarios`);
- on the in-browser fake: `storeScenarios.test.ts` runs it on `src/audit/fakeApi.ts`, from an empty store (`npx vitest run src/test/storeScenarios`).

When a scenario fails only on the fake, fix the fake. When it shows the real store is wrong, raise it in Linear instead of changing the store to suit the scenario.

## Format

```json
{
  "name": "The Metasploit lock clears when its host goes",
  "steps": [
    { "do": "engagementCreate", "args": [{ "name": "Mock exam", "kind": "exam-sim" }], "as": "exam" },
    { "do": "hostCreate", "args": ["$exam", { "name": "ms01", "ip": "192.0.2.30" }], "as": "ms01" },
    { "do": "engagementSetMsfHost", "args": ["$exam", "$ms01"], "expect": { "msfHostId": "$ms01" } },
    { "do": "engagementSetMsfHost", "args": ["$exam", "no-such-host"], "error": { "code": "not_found" } },
    { "do": "hostDelete", "args": ["$ms01"] },
    { "do": "engagementGet", "args": ["$exam"], "expect": { "msfHostId": null } }
  ]
}
```

Each step runs one command:

| Key | Meaning |
|---|---|
| `do` | The command, named as in `api` (`src/lib/api.ts`). |
| `args` | Its arguments, in the order the `api` function takes them. Leave it out for none. |
| `expect` | What the command returns. See matching below. |
| `ordered` | With `true`, a top-level list in `expect` must come back in that order. Otherwise order is free. |
| `error` | The command must fail, with an error matching this (`code`, and `field` for validation errors). The codes are the app's own: `src/types/errors.ts`. |
| `as` | Binds the result's `id` to a name. |
| `bind` | Binds other parts of the result: `{ "name": "dotted.path" }`, where a number picks a list item (`"0.id"`). |

A step with neither `expect` nor `error` only has to succeed. Any string starting with `$` is a name bound by an earlier step, in `args`, `expect` and `error` alike.

Matching:

- An object names only the fields it checks. A field the result leaves out counts as `null`.
- A list must have exactly as many items, each matching a different item, in any order unless `ordered`. Nested lists (a finding's `hostIds`) match in any order too.
- Anything else must be equal.

IDs and timestamps differ between the two stores, so check them through bound names, not literal values.

## Writing one

- Keep each scenario to one rule of the store, named in plain words in `name`.
- Use only synthetic data: RFC 5737 addresses (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) and invented names. Never real engagement data.
- Expect lists after the change, not only the command's own result: the drift is usually in what a command leaves elsewhere.
- A command the Rust runner doesn't map yet fails loudly. Add it to `call()` in `src-tauri/tests/store_scenarios.rs`, beside the others.

## What's covered

| File | The rule |
|---|---|
| `host-delete-cascade.json` | A host delete removes or unlinks everything that refers to the host, across every table; a local credential left with no host stays editable. |
| `engagement-delete-cascade.json` | An engagement delete removes everything in it, and nothing in another engagement. |
| `record-delete-cascades.json` | Deleting a service, log entry, credential, username or finding cleans up what refers to it. |
| `scope-hosts.json` | Single IPs in the scope become hosts on create, and only newly added ones on save. |
| `duplicate-ip.json` | A host's IP is one IPv4 address, unique in its engagement. |
| `ad-set.json` | The AD set: the switch, else open 88 and 389. |
| `msf-lock.json` | The Metasploit lock holds only its own engagement's host, and clears when the host goes. |
| `checklist-conditional-writes.json` | The cover and fact writes only touch untouched items, and only revert their own marks. |
| `checklist-entry-ticks.json` | Entry ticks are re-derived on the rows as the store holds them, so a status set by hand is never overwritten. |
| `board-sync.json` | A new derived column moves the card and ends a hand placement, unless the card was placed by hand before any was derived. |
| `extraction-undo.json` | Undoing a save restores the tried pairs its new credential took over, and removes what it filed. |
| `error-codes.json` | Missing records are `not_found`; bad input is `validation` on its field. |
| `username-scope.json` | A username's scope decides its identity: domain, unknown and local never merge. |
| `username-host-delete.json` | Deleting a host keeps its local usernames, local and with no host. |
| `capture-username-scope.json` | Capture output sets a username's scope (`.\user`, `HOST\user`, the engagement's domain). |
| `password-reuse.json` | A local account stored for another host with the same secret is an attempt of that credential, not a new username. |
