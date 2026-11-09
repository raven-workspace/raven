import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useCredentialSelection } from "../features/credentials/useCredentialSelection";
import { cred } from "./engines/credentials/fixtures";

const ctx = { hosts: [], servicesByHost: new Map(), attempts: [] };
const x = cred({ id: "x", createdAt: 1 });
const y = cred({ id: "y", createdAt: 2 });

function setup(initial: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  return renderHook(
    (p: { creds: typeof x[]; ready: boolean }) => ({ sel: useCredentialSelection("e", p.creds, ctx, p.ready), loc: useLocation() }),
    { wrapper, initialProps: { creds: [] as typeof x[], ready: false } },
  );
}

describe("useCredentialSelection", () => {
  it("keeps the deep link while not ready, then keeps a present id", () => {
    const h = setup("/?cred=x");
    expect(h.result.current.loc.search).toBe("?cred=x");
    expect(h.result.current.sel.selectedId).toBe("x");
    h.rerender({ creds: [x, y], ready: true });
    expect(h.result.current.loc.search).toBe("?cred=x");
  });

  it("rewrites to the default when the id is absent once ready", () => {
    const h = setup("/?cred=x&tab=inventory");
    h.rerender({ creds: [y], ready: true });
    expect(h.result.current.loc.search).toBe("?cred=y&tab=inventory");
  });

  it("setTab and select write params and keep others", () => {
    const h = setup("/?cred=x");
    h.rerender({ creds: [x, y], ready: true });
    act(() => h.result.current.sel.setTab("inventory"));
    expect(h.result.current.loc.search).toBe("?cred=x&tab=inventory");
    act(() => h.result.current.sel.setTab("matrix"));
    act(() => h.result.current.sel.select("y"));
    expect(h.result.current.loc.search).toBe("?cred=y");
  });
});
