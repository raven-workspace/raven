import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLogEntryStore } from "../features/capture/useLogEntryStore";
import { useNotesStore } from "../features/notes/useNotesStore";
import { EXPLORER_KEY, useExplorerStore } from "../features/workspace/useExplorerStore";
import { useTargetStore } from "../features/workspace/useTargetStore";
import { WorkspaceShell } from "../features/workspace/WorkspaceShell/WorkspaceShell";
import { api } from "../lib/api";
import type { Engagement } from "../types/engagement";
import type { Finding } from "../types/findings";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { Note } from "../types/notes";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const host = (id: string, name: string, ip: string, over: Partial<Host> = {}) =>
  ({ id, name, ip, engagementId: "e1", boardColumn: "information-gathering", access: "none", ...over }) as Host;
const service = (id: string, hostId: string, port: number, nmapService: string, state = "open") =>
  ({ id, hostId, port, protocol: "tcp", state, nmapService }) as Service;
const finding = (id: string, title: string, severity: Finding["severity"]) =>
  ({ id, title, severity, cvssScore: null, hostIds: [] }) as unknown as Finding;

/** Shows the route in view, so a test can see where a click went. */
function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<WorkspaceShell />}>
            <Route path="e/:id" element={<Where />} />
            <Route path="e/:id/s/:section" element={<Where />} />
            <Route path="e/:id/h/:hostId" element={<Where />} />
            <Route path="e/:id/f/:findingId" element={<Where />} />
            <Route path="e/:id/notes/:hostId?" element={<Where />} />
            <Route path="e/:id/log-entry" element={<Where />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const explorer = () => within(screen.getByRole("complementary", { name: "Explorer" }));
const group = (name: RegExp) => within(explorer().getByRole("region", { name }));
const where = () => screen.getByTestId("where");

beforeEach(() => {
  localStorage.clear();
  useExplorerStore.setState({ open: true, expanded: {}, addingHost: false });
  m.engagementsList.mockResolvedValue([{ id: "e1", name: "OSCP exam sim 2", status: "active", kind: "lab" } as Engagement]);
  m.engagementGet.mockResolvedValue({ id: "e1", name: "OSCP exam sim 2", status: "active", kind: "lab" } as Engagement);
  m.hostsList.mockResolvedValue([
    host("h1", "forge", "10.10.11.42", { access: "user", boardColumn: "privilege-escalation" }),
    host("h2", "web02", "10.10.11.51", { access: "root" }),
    host("h3", "db01", "10.10.11.60"),
  ]);
  m.servicesListEngagement.mockResolvedValue([
    service("s2", "h1", 80, "http"),
    service("s1", "h1", 21, "ftp", "filtered"),
    service("s3", "h1", 22, "ssh"),
  ]);
  m.notesList.mockResolvedValue([
    { ownerId: "e1", engagementId: "e1", hostId: null, body: "scope", private: false, updatedAt: 1 },
    { ownerId: "h1", engagementId: "e1", hostId: "h1", body: "admin panel", private: false, updatedAt: 1 },
  ] as Note[]);
  m.logList.mockResolvedValue([{ id: "l1", hostIds: ["h2"] }, { id: "l2", hostIds: [] }] as LogEntry[]);
  m.findingsList.mockResolvedValue([finding("f1", "Sudo rule allows script edit", "medium"), finding("f2", "SSRF in upload URL fetch", "high")]);
});

afterEach(() => {
  useTargetStore.getState().reset();
  useExplorerStore.getState().reset();
  useLogEntryStore.getState().reset();
  useNotesStore.setState({ open: false });
});

describe("Explorer (design §1.4)", () => {
  it("lists Hosts, Notes, Findings and Logs in that order, each with its count", async () => {
    renderAt("/e/e1");
    await explorer().findByText("Hosts (3)");
    await explorer().findByText("Findings (2)");
    expect(explorer().getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Hosts (3)",
      "Notes (2)",
      "Findings (2)",
      "Logs (2)",
    ]);
    expect(group(/^Notes/).getAllByRole("button", { name: /^(?!Add)/ }).map((b) => b.textContent)).toEqual(["Engagement", "forge"]);
    expect(group(/^Findings/).getAllByRole("button", { name: /^(?!Add)/ }).map((b) => b.textContent)).toEqual([
      "SSRF in upload URL fetch",
      "Sudo rule allows script edit",
    ]);
    expect(group(/^Logs/).getAllByRole("button", { name: /^(?!Add)/ }).map((b) => b.textContent)).toEqual(["Engagement", "web02"]);
  });

  it("a host row shows name over IP and its access chip; none when no access is held", async () => {
    renderAt("/e/e1");
    const forge = await group(/^Hosts/).findByRole("button", { name: /^forge/ });
    expect(forge).toHaveTextContent("forge10.10.11.42user");
    expect(forge).toHaveAccessibleName("forge, 10.10.11.42, Privilege escalation, user access");
    expect(within(forge).getByRole("img", { name: "Privilege escalation" })).toBeInTheDocument();
    expect(group(/^Hosts/).getByRole("button", { name: /^web02/ })).toHaveTextContent("root");
    const db = group(/^Hosts/).getByRole("button", { name: /^db01/ });
    expect(db).toHaveTextContent(/^db0110\.10\.11\.60$/);
    expect(db).toHaveAccessibleName("db01, 10.10.11.60, Information gathering");
  });

  it("the caret shows an open host's services, port first, with a filtered port muted", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1");
    const caret = await explorer().findByRole("button", { name: "Show forge's services" });
    expect(caret).toHaveAttribute("aria-expanded", "false");
    await user.click(caret);
    expect(caret).toHaveAttribute("aria-expanded", "true");
    expect(caret).toHaveAccessibleName("Hide forge's services");
    const list = explorer().getByRole("list", { name: "forge services" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["21ftp, filtered", "22ssh", "80http"]);
    expect(rows[0]).toHaveClass("explorer__service--filtered");
    expect(rows[1]).not.toHaveClass("explorer__service--filtered");
    await user.click(caret);
    await waitFor(() => expect(explorer().queryByRole("list", { name: "forge services" })).toBeNull());
  });

  it("selecting a host makes it Target, marks it selected and opens its page", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1");
    await user.click(await group(/^Hosts/).findByRole("button", { name: /^web02/ }));
    expect(where()).toHaveTextContent("/e/e1/h/h2");
    expect(useTargetStore.getState().byEngagement.e1).toBe("h2");
    expect(group(/^Hosts/).getByRole("button", { name: /^web02/ })).toHaveAttribute("aria-current", "true");
    expect(group(/^Hosts/).getByRole("button", { name: /^web02/ }).closest("li")).toHaveAttribute("data-selected");
    expect(group(/^Hosts/).getByRole("button", { name: /^forge/ })).not.toHaveAttribute("aria-current");
  });

  it("the Target picker selects its host in the Explorer", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1");
    await user.click(await screen.findByRole("button", { name: "Target" }));
    await user.click(within(screen.getByRole("listbox", { name: "Hosts" })).getByRole("option", { name: /forge/ }));
    expect(group(/^Hosts/).getByRole("button", { name: /^forge/ })).toHaveAttribute("aria-current", "true");
  });

  it("note, finding and log rows open their page: notes and findings in their own tab", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1");
    await user.click(await group(/^Findings/).findByRole("button", { name: "SSRF in upload URL fetch" }));
    expect(where().textContent).toBe("/e/e1/f/f2");
    await user.click(group(/^Logs/).getByRole("button", { name: "web02" }));
    expect(where()).toHaveTextContent("/e/e1/s/log?host=h2");
    await user.click(group(/^Logs/).getByRole("button", { name: "Engagement" }));
    expect(where().textContent).toBe("/e/e1/s/log");
    await user.click(group(/^Notes/).getByRole("button", { name: "forge" }));
    expect(where().textContent).toBe("/e/e1/notes/h1");
    // A host's notes make it Target, as its page does.
    expect(useTargetStore.getState().byEngagement.e1).toBe("h1");
    await user.click(group(/^Notes/).getByRole("button", { name: "Engagement" }));
    expect(where().textContent).toBe("/e/e1/notes");
    expect(useNotesStore.getState().open).toBe(false);
  });

  it("the Plus buttons add a host, a note, a finding and a log entry", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1/h/h3");
    await user.click(await group(/^Hosts/).findByRole("button", { name: "Add host" }));
    expect(useExplorerStore.getState().addingHost).toBe(true);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    useExplorerStore.getState().setAddingHost(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Add log entry opens the log entry tab, Target linked to start (design §2.5).
    await user.click(group(/^Logs/).getByRole("button", { name: "Add log entry" }));
    await waitFor(() => expect(where().textContent).toBe("/e/e1/log-entry"));
    expect(useLogEntryStore.getState()).toMatchObject({ open: false, engagementId: "e1", hostId: "h3", returnRoute: "/e/e1/h/h3" });
    useLogEntryStore.getState().reset();
    await user.click(group(/^Hosts/).getByRole("button", { name: /^db01/ }));
    expect(where().textContent).toBe("/e/e1/h/h3");

    // On a host's page, Add note opens that host's notes tab.
    await user.click(group(/^Notes/).getByRole("button", { name: "Add note" }));
    expect(where().textContent).toBe("/e/e1/notes/h3");

    await user.click(group(/^Findings/).getByRole("button", { name: "Add finding" }));
    expect(where()).toHaveTextContent("/e/e1/s/findings?finding=new");
  });

  it("⌘B toggles the column and remembers it; ⌘N adds a host even while it's closed", async () => {
    const user = userEvent.setup();
    const { container } = renderAt("/e/e1");
    await explorer().findByText("Hosts (3)");
    await user.keyboard("{Meta>}b{/Meta}");
    expect(screen.queryByRole("complementary", { name: "Explorer" })).toBeNull();
    expect(container.querySelector(".workspace-shell__frame-body")).toHaveClass("workspace-shell__frame-body--no-explorer");
    expect(localStorage.getItem(EXPLORER_KEY)).toBe("0");
    await user.keyboard("{Meta>}n{/Meta}");
    expect(useExplorerStore.getState().addingHost).toBe(true);
    useExplorerStore.getState().setAddingHost(false);
    await user.keyboard("{Meta>}b{/Meta}");
    expect(await screen.findByRole("complementary", { name: "Explorer" })).toBeInTheDocument();
    expect(localStorage.getItem(EXPLORER_KEY)).toBe("1");
  });

  it("the Plus buttons' tooltips carry their keys: Add host ⌘N, Add log entry L", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1");
    await user.hover(await group(/^Hosts/).findByRole("button", { name: "Add host" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Add host⌘N");
    await user.unhover(group(/^Hosts/).getByRole("button", { name: "Add host" }));
    await user.hover(group(/^Logs/).getByRole("button", { name: "Add log entry" }));
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("Add log entryL"));
  });
});

describe("Target works both ways (design §1.3)", () => {
  const picker = (name: string) => screen.findByRole("button", { name });
  const selected = () => group(/^Hosts/).getAllByRole("button", { current: true }).map((b) => b.textContent);
  const tab = (name: string) => screen.getByRole("tab", { name });

  it("selecting a host in the Explorer sets the Target picker", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1");
    expect(await picker("Target")).toBeVisible();
    await user.click(await group(/^Hosts/).findByRole("button", { name: /^web02/ }));
    expect(await picker("Target: web02")).toBeVisible();
    await user.click(group(/^Hosts/).getByRole("button", { name: /^db01/ }));
    expect(await picker("Target: db01")).toBeVisible();
    expect(selected()).toEqual([expect.stringMatching(/^db01/)]);
  });

  it("picking a host in the Target picker selects it in the Explorer and opens its page", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1/s/log");
    await user.click(await picker("Target"));
    await user.click(within(screen.getByRole("listbox", { name: "Hosts" })).getByRole("option", { name: /web02/ }));
    expect(where().textContent).toBe("/e/e1/h/h2");
    expect(selected()).toEqual([expect.stringMatching(/^web02/)]);
    expect(await picker("Target: web02")).toBeVisible();
  });

  it("the menu lists each host's name with its IP", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1");
    await user.click(await picker("Target"));
    const options = within(screen.getByRole("listbox", { name: "Hosts" })).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["forge10.10.11.42", "web0210.10.11.51", "db0110.10.11.60"]);
  });

  it("on a page with no host, the picker and the Explorer keep the last host picked", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1/h/h1");
    expect(await picker("Target: forge")).toBeVisible();
    await user.click(await group(/^Findings/).findByRole("button", { name: "SSRF in upload URL fetch" }));
    expect(where().textContent).toBe("/e/e1/f/f2");
    await user.click(group(/^Logs/).getByRole("button", { name: "web02" }));
    expect(where().textContent).toBe("/e/e1/s/log?host=h2");
    await user.click(group(/^Notes/).getByRole("button", { name: "Engagement" }));
    expect(where().textContent).toBe("/e/e1/notes");
    expect(screen.getByRole("button", { name: "Target: forge" })).toBeVisible();
    expect(selected()).toEqual([expect.stringMatching(/^forge/)]);
  });

  it("switching tabs moves Target to the host in view, and a tab with no host leaves it", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1/h/h1");
    await user.click(await group(/^Hosts/).findByRole("button", { name: /^web02/ }));
    await user.click(group(/^Findings/).getByRole("button", { name: "Sudo rule allows script edit" }));
    await user.click(group(/^Notes/).getByRole("button", { name: "forge" }));
    expect(await picker("Target: forge")).toBeVisible();

    await user.click(tab("web02"));
    expect(where().textContent).toBe("/e/e1/h/h2");
    expect(await picker("Target: web02")).toBeVisible();
    expect(selected()).toEqual([expect.stringMatching(/^web02/)]);

    await user.click(tab("Sudo rule allows script edit"));
    expect(where().textContent).toBe("/e/e1/f/f1");
    expect(screen.getByRole("button", { name: "Target: web02" })).toBeVisible();

    // A host's notes are about that host, so its tab makes it Target as the host's page does.
    await user.click(tab("Notes: forge"));
    expect(where().textContent).toBe("/e/e1/notes/h1");
    expect(await picker("Target: forge")).toBeVisible();
    expect(selected()).toEqual([expect.stringMatching(/^forge/)]);
  });

  it("picking the host that already is Target, from a page with no host, opens its page from the keyboard", async () => {
    const user = userEvent.setup();
    renderAt("/e/e1/h/h3");
    await user.click(await group(/^Findings/).findByRole("button", { name: "SSRF in upload URL fetch" }));
    const trigger = await picker("Target: db01");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(within(screen.getByRole("listbox", { name: "Hosts" })).getByRole("option", { name: /db01/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(where().textContent).toBe("/e/e1/h/h3");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("each engagement keeps its own Target", async () => {
    useTargetStore.getState().pick("e2", "h9");
    const user = userEvent.setup();
    renderAt("/e/e1");
    await user.click(await group(/^Hosts/).findByRole("button", { name: /^forge/ }));
    expect(useTargetStore.getState().byEngagement).toEqual({ e1: "h1", e2: "h9" });
  });
});
