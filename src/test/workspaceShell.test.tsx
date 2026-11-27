import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "../features/workspace/WorkspaceShell/WorkspaceShell";
import { useTargetStore } from "../features/workspace/useTargetStore";
import { usePaletteStore } from "../features/palette/usePaletteStore";
import { api } from "../lib/api";
import { readWorkspaceShell } from "../lib/shell";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const engagement = (id: string, name: string, status: Engagement["status"] = "active") =>
  ({ id, name, status, kind: "lab" }) as Engagement;
const host = (id: string, name: string, ip: string) => ({ id, name, ip, engagementId: "e1" }) as Host;

/** Shows the route in view, so a test can see where a click went. */
function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<WorkspaceShell />}>
            <Route index element={<Where />} />
            <Route path="e/:id" element={<Where />} />
            <Route path="e/:id/s/:section" element={<Where />} />
            <Route path="e/:id/h/:hostId" element={<Where />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.engagementsList.mockResolvedValue([engagement("e1", "OSCP exam sim 2"), engagement("e2", "Lab B"), engagement("e3", "Old", "archived")]);
  m.engagementGet.mockImplementation(async (id: string) => engagement(id, id === "e1" ? "OSCP exam sim 2" : "Lab B"));
  m.hostsList.mockResolvedValue([host("h1", "forge", "10.10.11.42"), host("h2", "web01", "10.10.11.43")]);
});

afterEach(() => {
  useTargetStore.getState().reset();
  usePaletteStore.getState().close();
  delete window.__RAVEN_OS__;
});

describe("the startup switch", () => {
  it("VITE_RAVEN_WORKSPACE=1 turns the workspace shell on; otherwise the engagement shell renders", () => {
    expect(readWorkspaceShell({ VITE_RAVEN_WORKSPACE: "1", MODE: "development" }, "")).toBe(true);
    expect(readWorkspaceShell({ MODE: "development" }, "")).toBe(false);
    expect(readWorkspaceShell({ VITE_RAVEN_WORKSPACE: "0", MODE: "development" }, "")).toBe(false);
  });

  it("?workspace turns it on in audit mode only", () => {
    expect(readWorkspaceShell({ MODE: "audit" }, "?workspace")).toBe(true);
    expect(readWorkspaceShell({ MODE: "audit" }, "")).toBe(false);
    expect(readWorkspaceShell({ MODE: "development" }, "?workspace")).toBe(false);
  });

  it("tauri:overhaul sets it; plain tauri dev doesn't", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    expect(scripts["tauri:overhaul"]).toMatch(/\bVITE_RAVEN_WORKSPACE=1\b/);
    expect(scripts.dev).not.toMatch(/VITE_RAVEN_WORKSPACE/);
    expect(readFileSync("src-tauri/tauri.conf.json", "utf8")).not.toMatch(/VITE_RAVEN_WORKSPACE/);
  });
});

describe("workspace shell", () => {
  it("inside an engagement: chrome bar over the rail and the frame, with the Explorer, editor, terminal and status bar slots", async () => {
    const { container } = renderAt("/e/e1");
    const bar = container.querySelector(".chrome-bar")!;
    expect(bar).toHaveAttribute("data-tauri-drag-region");
    expect(bar.querySelector(".chrome-bar__controls")).toHaveAttribute("data-tauri-drag-region");
    for (const slot of ["rail", "explorer", "editor-tabs", "terminal", "status-bar"]) {
      expect(container.querySelector(`[data-slot="${slot}"]`), slot).not.toBeNull();
    }
    const frame = container.querySelector(".workspace-shell__frame")!;
    expect(frame).toContainElement(screen.getByTestId("where"));
    expect(await screen.findByRole("button", { name: "Engagement: OSCP exam sim 2" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Target" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Build report" })).toBeVisible();
  });

  it("outside an engagement: the chrome bar has only search, and the page has no frame", () => {
    const { container } = renderAt("/");
    expect(container.querySelector(".workspace-shell__frame")).toBeNull();
    expect(container.querySelector("[data-slot]")).toBeNull();
    expect(screen.getByRole("button", { name: "Search hosts, notes and commands" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Engagement/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Build report" })).toBeNull();
  });

  it("on Linux the chrome bar has no controls track", () => {
    window.__RAVEN_OS__ = "linux";
    const { container } = renderAt("/e/e1");
    const bar = container.querySelector(".chrome-bar")!;
    expect(bar).toHaveClass("chrome-bar--below-native");
    expect(bar.querySelector(".chrome-bar__controls")).toBeNull();
  });

  it("search opens the ⌘K palette", async () => {
    renderAt("/e/e1");
    const search = screen.getByRole("button", { name: "Search hosts, notes and commands" });
    expect(search).toHaveAttribute("aria-keyshortcuts", "Meta+K");
    await userEvent.click(search);
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it("Build report opens the Report section", async () => {
    renderAt("/e/e1/h/h1");
    await userEvent.click(screen.getByRole("button", { name: "Build report" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/e/e1/s/report");
  });

  it("the Engagement picker lists active engagements and opens the one picked", async () => {
    renderAt("/e/e1");
    await userEvent.click(await screen.findByRole("button", { name: "Engagement: OSCP exam sim 2" }));
    const list = screen.getByRole("listbox", { name: "Engagements" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["OSCP exam sim 2", "Lab B"]);
    await userEvent.click(within(list).getByRole("option", { name: "Lab B" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/e/e2");
  });

  it("Target is the host in view, and stays on it on a page with no host", async () => {
    renderAt("/e/e1/h/h1");
    expect(await screen.findByRole("button", { name: "Target: forge" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Build report" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/e/e1/s/report");
    expect(screen.getByRole("button", { name: "Target: forge" })).toBeVisible();
  });

  it("picking a host in Target opens its page", async () => {
    renderAt("/e/e1");
    await userEvent.click(await screen.findByRole("button", { name: "Target" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "Hosts" })).getByRole("option", { name: /web01/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/e/e1/h/h2");
    expect(await screen.findByRole("button", { name: "Target: web01" })).toBeVisible();
  });
});
