# Issue tracker: Linear

Issues and specs for Raven live in Linear, in the **RAV** team ("Raven Workspace App"). Use the Linear MCP tools (`mcp__linear-server__*`) for every operation. The GitHub repo (`raven-workspace/raven`) holds code and pull requests only; don't file GitHub issues.

## Conventions

- **Create an issue**: `save_issue` with `team: "RAV"`, a `title` and a Markdown `description`. Check `list_issues` (`team: "RAV"`, `query: ...`) for a duplicate first. Put agent-only detail (plans, file lists, logs) in a collapsible `+++ Agent notes` section at the end of the description.
- **Read an issue**: `get_issue` with the identifier (`RAV-12`). It doesn't include the discussion, so also call `list_comments`.
- **List issues**: `list_issues` with `team: "RAV"` and `label`, `state` or `query` filters. Follow `cursor` while `hasNextPage` is true.
- **Sub-issues**: `save_issue` with `parentId: "RAV-<n>"`.
- **Blocking**: Linear's native relations, via `save_issue` `blockedBy` / `blocks`. A ticket is unblocked when every blocker is in a completed or canceled state.
- **Comment**: `save_comment` with `issueId`.
- **Apply / remove labels**: `save_issue` with `addLabels` / `removeLabels`. Never pass `labels`, which replaces the whole set.
- **Close**: comment the explanation, then `save_issue` with `state: "Done"` (shipped), `"Canceled"` (won't do) or `"Duplicate"` (with `duplicateOf`).

## Statuses and category labels

- **Statuses:** Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate.
- **Category labels:** `Bug` is the triage `bug` category. `Feature` and `Improvement` are `enhancement`. `Security`, `Design`, `Documentation` and `Plan` also exist; keep whichever applies.

## Branches and commits

- Branch from `develop` as `<prefix>/rav-<n>-<title-slug>`: take the issue's `gitBranchName` and swap the `feature/` prefix by label (Feature or Improvement: `feature/`; Bug or Security: `fix/`; not code: `chore/`).
- Commits are conventional (`feat(scope): subject`), and only shipped, user-visible work uses `feat`, `fix`, `perf` or `style`.
- Linear links the PR from the issue ID in the branch name.

## When a skill says "publish to the issue tracker"

Create a Linear issue in RAV.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one parent issue; the **tickets** are its sub-issues.

- **Map**: an issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a sub-issue of the map (`parentId`), labelled `wayfinder:<type>` (`research`, `prototype`, `grilling` or `task`). Create those labels in RAV the first time they're needed.
- **Blocking**: see **Blocking** above.
- **Frontier query**: `list_issues` with `parentId: <map>`, open states only. Drop any with an open blocker or an assignee; the first in map order wins.
- **Claim**: `save_issue` with `assignee: "me"`, the session's first write.
- **Resolve**: comment the answer, set the state to Done, then add a pointer (one-line gist and link) to the map's Decisions-so-far.
