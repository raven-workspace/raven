import { useMatch } from "react-router";
import { WORKSPACE_SHELL } from "../../lib/shell";

/**
 * Where Arsenal, Manual and Payloads routes start: "" for their full pages (the Dashboard, and the old shell), and
 * `/e/:id` inside an engagement in the workspace shell, where they open as editor tabs (docs/specs/terminal.md §8).
 * Prefix a reference path with it: `${base}/manual/…`.
 */
export function useReferenceBase(): string {
  const engagementId = useMatch("/e/:id/*")?.params.id;
  return WORKSPACE_SHELL && engagementId ? `/e/${engagementId}` : "";
}
