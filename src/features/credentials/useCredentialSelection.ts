import { useEffect } from "react";
import { useSearchParams } from "react-router";
import type { Credential } from "../../types/credentials";
import { resolveSelection } from "./selection";

type Ctx = Parameters<typeof resolveSelection>[2];

/** Selected credential (`cred`) and work tab (`tab=inventory`) live in the URL so back/refresh keep them. */
export function useCredentialSelection(eid: string, creds: Credential[], ctx: Ctx) {
  void eid;
  const [params, setParams] = useSearchParams();
  const requested = params.get("cred");
  const selectedId = resolveSelection(requested, creds, ctx);
  const tab: "matrix" | "inventory" = params.get("tab") === "inventory" ? "inventory" : "matrix";

  const write = (mutate: (p: URLSearchParams) => void) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      mutate(next);
      return next;
    }, { replace: true });

  useEffect(() => {
    if (selectedId !== (requested ?? undefined)) {
      write((p) => (selectedId ? p.set("cred", selectedId) : p.delete("cred")));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, requested]);

  return {
    selectedId,
    select: (id: string) => write((p) => p.set("cred", id)),
    tab,
    setTab: (t: "matrix" | "inventory") => write((p) => (t === "inventory" ? p.set("tab", "inventory") : p.delete("tab"))),
  };
}
