import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";
import type { Credential } from "../../types/credentials";
import { resolveSelection } from "./selection";

type Ctx = Parameters<typeof resolveSelection>[2];

/**
 * Selected credential (`cred`) and work tab (`tab=inventory`) live in the URL so back/refresh keep them.
 * While `ready` is false (data still loading) the URL is never rewritten, so a deep link survives.
 */
export function useCredentialSelection(_eid: string, creds: Credential[], ctx: Ctx, ready: boolean) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("cred");
  const selectedId = ready ? resolveSelection(requested, creds, ctx) : (requested ?? undefined);
  const tab: "matrix" | "inventory" = params.get("tab") === "inventory" ? "inventory" : "matrix";

  const write = useCallback(
    (mutate: (p: URLSearchParams) => void) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      }, { replace: true }),
    [setParams],
  );

  useEffect(() => {
    if (!ready) return;
    if (selectedId !== (requested ?? undefined)) {
      write((p) => (selectedId ? p.set("cred", selectedId) : p.delete("cred")));
    }
  }, [ready, selectedId, requested, write]);

  return {
    selectedId,
    select: (id: string) => write((p) => p.set("cred", id)),
    tab,
    setTab: (t: "matrix" | "inventory") => write((p) => (t === "inventory" ? p.set("tab", "inventory") : p.delete("tab"))),
  };
}
