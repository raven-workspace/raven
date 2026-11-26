/**
 * UI tests on the checked in-browser fake (`src/audit/fakeApi.ts`) instead of `vi.mock` return values scripted per
 * test. The fake passes the same store scenarios as the real store (`src/test/storeScenarios`), so a test that seeds
 * it, drives the screen and reads the result back sees what the app would: deletes cascade, IPs stay unique, the
 * Metasploit lock clears with its host. New UI tests start here; an older test moves over when it is next touched.
 *
 * ```tsx
 * // In the test file itself: vi.mock is hoisted per file, so a helper can't do it for you.
 * vi.mock("../lib/api", () => import("../audit/fakeApi"));
 *
 * beforeEach(() => resetFake());
 *
 * it("locks a host", async () => {
 *   const eng = await fake.engagementCreate({ name: "Mock exam", kind: "exam-sim" });
 *   const host = await fake.hostCreate(eng.id, { name: "ms01", ip: "192.0.2.10" });
 *   renderApp(`/e/${eng.id}`);
 *   // ...drive the screen...
 *   await waitFor(async () => expect((await fake.engagementGet(eng.id)).msfHostId).toBe(host.id));
 * });
 * ```
 *
 * - Seed through `fake`, the same commands the app calls, so the data is shaped as the store shapes it.
 * - Assert on the screen, and on the store through `fake` reads, rather than on which command was called.
 * - To hold a command (a load that never settles) or make it fail, spy on it: `vi.spyOn(fake, "hostsList")`.
 * - Keep data synthetic: RFC 5737 addresses (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) and invented names.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import App from "../../App";
import { api, resetAuditState, setAuditScenario } from "../../audit/fakeApi";
import { EMPTY_FIXTURES, FIXTURES } from "../../audit/fixtures";
import { makeQueryClient } from "../../lib/queryClient";

/** The fake store. Its commands are the app's `api`, once the test file mocks `lib/api` with the fake. */
export const fake = api;

/**
 * Starts the fake afresh: empty but for Settings (the default), or with the audit fixtures the visual audits use.
 * Also undoes any `vi.spyOn(fake, ...)` from the test before.
 */
export function resetFake(from: "empty" | "fixtures" = "empty"): void {
  vi.restoreAllMocks();
  setAuditScenario("full");
  resetAuditState(from === "empty" ? EMPTY_FIXTURES : FIXTURES);
}

/** Mounts the whole app at `path`, with a fresh query cache, as `main.tsx` does past the vault. */
export function renderApp(path: string): RenderResult {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
