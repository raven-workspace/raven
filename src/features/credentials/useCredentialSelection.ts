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

  const select = useCallback((id: string) => write((p) => p.set("cred", id)), [write]);
  const setTab = useCallback(
    (t: "matrix" | "inventory") => write((p) => (t === "inventory" ? p.set("tab", "inventory") : p.delete("tab"))),
    [write],
  );

  useEffect(() => {
    if (!ready) return;
    if (selectedId !== (requested ?? undefined)) {
      write((p) => (selectedId ? p.set("cred", selectedId) : p.delete("cred")));
    }
  }, [ready, selectedId, requested, write]);

  return {
    selectedId,
    select,
    tab,
    setTab,
  };
}

export type InventoryKind = "passwords" | "hashes" | "tickets" | "machines" | "usernames";
const KINDS: readonly string[] = ["passwords", "hashes", "tickets", "machines", "usernames"];

/** The Inventory filter (`kind=`) lives in the URL; All is the absence of the param. Unknown values read as All. */
export function useInventoryKind(): [InventoryKind | "all", (k: InventoryKind | "all") => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("kind") ?? "";
  const kind = KINDS.includes(raw) ? (raw as InventoryKind) : "all";
  const setKind = useCallback(
    (k: InventoryKind | "all") =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (k === "all") next.delete("kind");
        else next.set("kind", k);
        return next;
      }, { replace: true }),
    [setParams],
  );
  return [kind, setKind];
}
