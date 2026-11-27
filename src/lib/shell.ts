/**
 * Which shell renders, read once at startup (docs/specs/terminal.md §4). `npm run tauri:overhaul` sets
 * `VITE_RAVEN_WORKSPACE=1` for the new workspace shell; plain `npm run tauri dev` keeps the engagement shell. In audit
 * mode a `?workspace` query on the first page load turns it on too, so the audit can drive both shells. The switch
 * goes with the old shell at the cutover (RAV-90).
 */
export function readWorkspaceShell(
  env: { VITE_RAVEN_WORKSPACE?: string; MODE: string } = import.meta.env,
  search: string = typeof location === "undefined" ? "" : location.search,
): boolean {
  if (env.VITE_RAVEN_WORKSPACE === "1") return true;
  return env.MODE === "audit" && new URLSearchParams(search).has("workspace");
}

/** True when this run renders the workspace shell. */
export const WORKSPACE_SHELL = readWorkspaceShell();
