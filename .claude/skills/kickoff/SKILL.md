---
name: kickoff
description: Start Orca workspaces, each with a Claude agent, for the RAV issues that are ready to work in parallel.
disable-model-invocation: true
---

# Kickoff

Turn the **ready** RAV issues into a **batch** of Orca workspaces, one issue per workspace, each with a Claude agent working from a standard brief. Load the `orca-cli` and `orca-linear` skills first: they say which Orca executable to run and how its commands work.

## 1. Find the ready issues

An issue in team RAV is **ready** when all of these hold:

- its state is Backlog or Todo;
- it carries `ready-for-agent`;
- every issue that blocks it is Done;
- no Orca workspace is linked to it yet (`orca reference find RAV-<n> --json`);
- memory doesn't mark it as one to skip.

Done when every open RAV issue has been checked against all five.

## 2. Propose a batch

Pick at most three ready issues, favouring those that unblock the most others. Two issues **collide** when their descriptions or Agent notes point at the same module or file; a batch holds no collisions.

Show the owner a table (issue, title, what it unblocks, collision risk), and wait for their OK. Done when the owner has approved a batch, possibly edited.

## 3. Create one workspace per approved issue

1. `git fetch origin`. Base every workspace on `origin/develop`: the shared local `develop` isn't pulled after merges, so it silently lacks merged work.
2. Branch: the issue's Linear `gitBranchName`, with the prefix set by its label as CONTRIBUTING describes (`feature/`, `fix/`, or `chore/` for CI, tooling and docs).
3. Create it:

   ```sh
   orca worktree create --name rav-<n>-<short-slug> --base-branch origin/develop \
     --branch <branch> --linear-issue RAV-<n> --agent claude --prompt "<brief>" --json
   ```

4. Check the new worktree's HEAD equals `origin/develop`. If it differs and the tree is clean, `git reset --hard origin/develop` there.

The brief, with the issue filled in:

> Implement Linear issue RAV-<n> (<title>). Read it first: `orca linear issue RAV-<n> --json`. Then read AGENTS.md, CONTRIBUTING.md, GLOSSARY.md, and any spec or ADR the issue names (docs/specs/, docs/adr/). For UI work, open the Figma frames the issue or spec links before writing code (frame map in docs/specs/terminal.md): through the Figma MCP, `create_session` with file key Z49qXmfYnFfPxk3qhECLme, then `get_design_context` and `get_screenshot` on the node id, and match them. Take sizes, colours and text from the design context. The Host View artboard (1-2612) renders with some text missing, because many of its text layers have zero height in the file, so use its screenshots for layout only and check the shared areas against the Log entry tab artboard (1-2187), which renders completely. If a UI issue links no frame, stop and ask. You are on branch <branch>; commit only there, in conventional form, with no AI attribution. See the UI through `npm run dev:audit` and the `src/audit/` fixtures, never the owner's vault. Verify before pushing: typecheck, lint, `npm test`, `cargo test` for Rust, `audit:visual` and `audit:pixel` for UI. Push, open a PR against develop in the repo's three-part format (`.claude/skills/pr`), and get CI green on every target. When only the owner can prove the work (Kali, real hardware, a live lab), end with exact steps for them to check it, and say it is unproven until they do. Attach the PR to RAV-<n> and post one short completion comment. Stop and ask when something needs the owner's decision.

Done when every approved issue has a workspace on `origin/develop` with its agent started.

## 4. Report

List each workspace's name, branch and issue, and confirm its agent launched (`launch.outcome` in the create result, or `orca agent list --json`).
