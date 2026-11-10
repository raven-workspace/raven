import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardMeta } from "../../../engines/library/store";
import { parseNote, type ManualNote } from "../../../engines/manual";
import { useArsenalStore } from "../../../features/arsenal/useArsenalStore";
import { logCommand } from "../../../features/capture/logCommand";
import { NoteTable } from "../../../features/manual/NoteTable";
import { NoteView } from "../../../features/manual/NoteView";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";

vi.mock("../../../lib/api");
vi.mock("../../../features/capture/logCommand", () => ({ logCommand: vi.fn(() => Promise.resolve({})) }));
const m = vi.mocked(api, true);

// Synthetic fixtures only (RFC 5737 addresses, invented names).
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "zzdc01.example.test", ip: "198.51.100.20", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const CARDS: CardMeta[] = [{ id: "some-card", title: "Some Card", stage: "initial-foothold", category: "Active-Directory", os: "windows", file: "02-Cards/AD/Some-Card.md" }];

const BODY = [
  "# Zz Tool",
  "Read [[Zz-Errors#Core Concept|the concept]], then [[Some-Card]] or [[Missing Page]].",
  "## Usage",
  "```bash title:\"Kali\"",
  "zzscan -t {TARGET_IP}",
  "```",
  "```",
  "plain output line",
  "```",
  "## Banned",
  "```",
  "sqlmap -u http://{TARGET_IP}/zz",
  "```",
  "## Meterpreter",
  "```",
  "msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST={LHOST} -f exe",
  "```",
  "## Usage",
  "**Table 1 — Zz codes**",
  "| A | B |",
  "| - | - |",
  "| x | y |",
  "**Table 1 — Zz codes**",
  "#### Usage",
  "```text",
  "sqlmap output {TARGET_IP} zz",
  "```",
].join("\n");
const NOTE = parseNote("03-Tools/Zz Tool.md", BODY)!;
const ERRORS = parseNote("04-Foundations/Zz-Errors.md", "# Zz Errors\n## Core Concept\n")!;
const NOTES: ManualNote[] = [NOTE, ERRORS];

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.hash}</p>;
}
function mount(note: ManualNote = NOTE) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/manual/zz-tool"]}>
        <Routes>
          <Route path="*" element={<><Where /><NoteView note={note} notes={NOTES} cards={CARDS} hostId="h1" engagementId="e1" /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const cmdGroup = (name: string) => screen.findByRole("group", { name: `Note command: ${name}` });

beforeEach(() => {
  vi.resetAllMocks();
  useArsenalStore.setState({ open: false, cardId: null, blockId: null, solo: null });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["kali"], attackerIp: "192.0.2.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "/v/fm", nvdKeySet: false,
  });
  m.engagementGet.mockResolvedValue(E1);
  // On /manual the fill scope waits for the engagement list (exam rules fail closed until it loads).
  m.engagementsList.mockResolvedValue([E1]);
  m.hostsList.mockResolvedValue([H1]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
});

describe("NoteView links", () => {
  it("a note link navigates to the note with the heading hash", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("link", { name: "the concept" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/manual/zz-errors#core-concept");
  });

  it("a card link opens the card in the Arsenal drawer", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Some-Card" }));
    expect(useArsenalStore.getState()).toMatchObject({ open: true, cardId: "some-card" });
    expect(screen.getByTestId("where")).toHaveTextContent("/manual/zz-tool");
  });

  it("an unresolved link is muted text, not a link", () => {
    mount();
    const el = screen.getByText("Missing Page");
    expect(el.closest("a,button")).toBeNull();
    expect(el).toHaveClass("text-muted");
  });
});

describe("NoteView anchors", () => {
  it("renders an element for every outline id", () => {
    const { container } = mount();
    expect(NOTE.outline.map((o) => o.id)).toEqual(["usage", "banned", "meterpreter", "usage-2", "table-1", "table-1-2"]);
    for (const o of NOTE.outline) expect(container.querySelector(`[id="${o.id}"]`), o.id).not.toBeNull();
  });

  it("has no duplicate element ids (h1 and h4 never take an outline id)", () => {
    const { container } = mount();
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelector('[id="usage"]')?.tagName).toBe("H2");
  });
});

describe("NoteView commands", () => {
  it("fills a placeholder command for the host and copies it on Enter", async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzscan -t 198.51.100.20")).toBeInTheDocument();
    await navigator.clipboard.writeText("untouched");
    const group = await cmdGroup("Usage: zzscan -t {TARGET_IP}");
    act(() => group.focus());
    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("zzscan -t 198.51.100.20"));
  });

  it("a plain block copies as is", async () => {
    const user = userEvent.setup();
    mount();
    await navigator.clipboard.writeText("untouched");
    await user.click(screen.getByRole("button", { name: "Copy command: Usage: plain output line" }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("plain output line"));
  });

  it("⌘↵ copies and logs the command for the host", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzscan -t 198.51.100.20");
    const group = await cmdGroup("Usage: zzscan -t {TARGET_IP}");
    act(() => group.focus());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("zzscan -t 198.51.100.20"));
    await waitFor(() => expect(logCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      engagementId: "e1", host: expect.objectContaining({ id: "h1" }), command: "zzscan -t 198.51.100.20", title: "Usage", ranOn: "kali",
    })));
  });

  it("a Target block logs as run on the host, a Kali block on the Kali machine, each titled by its section", async () => {
    const note = parseNote("03-Tools/Zz Where.md", [
      "# Zz Where",
      "## Find the `zz` service",
      "```powershell title:\"Target — PowerShell\"",
      "Get-ZzThing -Name {TARGET_IP}",
      "```",
      "### Scan from **Kali**",
      "```bash title:\"Kali\"",
      "zzscan {TARGET_IP}",
      "```",
    ].join("\n"))!;
    const user = userEvent.setup();
    mount(note);
    const target = await cmdGroup("Find the zz service: Get-ZzThing -Name {TARGET_IP}");
    await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "Get-ZzThing -Name 198.51.100.20");
    act(() => target.focus());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(logCommand).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      command: "Get-ZzThing -Name 198.51.100.20", title: "Find the zz service", ranOn: "zzdc01.example.test",
    })));
    act(() => screen.getByRole("group", { name: "Note command: Scan from Kali: zzscan {TARGET_IP}" }).focus());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(logCommand).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      command: "zzscan 198.51.100.20", title: "Scan from Kali", ranOn: "kali",
    })));
  });

  it("each command is one labelled group (no group nested inside it)", async () => {
    mount();
    const group = await cmdGroup("Usage: zzscan -t {TARGET_IP}");
    expect(within(group).queryAllByRole("group")).toHaveLength(0);
  });

  it("does not mark a banned command outside an exam", async () => {
    mount();
    await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "sqlmap -u http://198.51.100.20/zz");
    expect(screen.queryByText("Not allowed in the exam")).not.toBeInTheDocument();
  });

  it("in an exam sim a banned command shows the amber line and its first copy is held", async () => {
    m.engagementGet.mockResolvedValue({ ...E1, kind: "exam-sim" });
    const user = userEvent.setup();
    mount();
    const line = await screen.findByText("Not allowed in the exam");
    expect(line).toHaveClass("text-warn");
    // The note text is never hidden.
    expect(screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === "sqlmap -u http://198.51.100.20/zz")).toBeInTheDocument();
    await navigator.clipboard.writeText("untouched");
    const copy = screen.getByRole("button", { name: "Copy command: Banned: sqlmap -u http://{TARGET_IP}/zz" });
    await user.click(copy);
    expect(await screen.findByRole("status")).toHaveTextContent("Not allowed in the exam. Press ↵ again to copy anyway");
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.click(copy);
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("sqlmap -u http://198.51.100.20/zz"));
  });

  it("in an exam sim a Meterpreter command shows the Metasploit lock wording", async () => {
    m.engagementGet.mockResolvedValue({ ...E1, kind: "exam-sim" });
    mount();
    expect(await screen.findByText("Using Meterpreter here makes this your Metasploit machine")).toBeInTheDocument();
  });
});

describe("NoteView output blocks", () => {
  it("a text fence is output: no fill, no exam line, copies at once and ⌘↵ never logs", async () => {
    m.engagementGet.mockResolvedValue({ ...E1, kind: "exam-sim" });
    const user = userEvent.setup();
    mount();
    await screen.findByText("Not allowed in the exam");
    expect(screen.getAllByText("Not allowed in the exam")).toHaveLength(1);
    await navigator.clipboard.writeText("untouched");
    const group = await cmdGroup("Usage: sqlmap output {TARGET_IP} zz");
    act(() => group.focus());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("sqlmap output {TARGET_IP} zz"));
    expect(logCommand).not.toHaveBeenCalled();
  });
});

describe("NoteView tables", () => {
  afterEach(() => vi.restoreAllMocks());
  /** jsdom has no layout: the table is `table` px wide in a pane `room` px wide. */
  function widths(table: number, room: number) {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "TABLE" ? table : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "DIV" ? room : 0;
    });
  }

  it("a table wider than the pane stacks and stays a table to screen readers, each cell named with its column", () => {
    widths(900, 600);
    const { container } = mount();
    const table = container.querySelector("table")!;
    expect(table).toHaveAttribute("data-stacked");
    const t = within(screen.getAllByRole("table")[0]);
    expect(t.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["A", "B"]);
    const cells = t.getAllByRole("cell");
    expect(cells).toHaveLength(2);
    // The column name comes first (a block of its own when stacked, so read apart from the value).
    expect(cells[0]).toHaveAccessibleName(/^A\s*x$/);
    expect(cells[1]).toHaveAccessibleName(/^B\s*y$/);
  });

  it("new content while stacked is measured afresh: widened, it unstacks", () => {
    const fits: (() => void)[] = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb: () => void) { fits.push(cb); }
      observe() {}
      disconnect() {}
    });
    let room = 600;
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "TABLE" ? 900 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "DIV" ? room : 0;
    });
    const head = [[{ text: "A" }], [{ text: "B" }]];
    const cell = (parts: { text: string }[]) => parts.map((p) => p.text).join("");
    const { container, rerender } = render(<NoteTable head={head} rows={[[[{ text: "x" }], [{ text: "y" }]]]} cell={cell as never} />);
    const table = container.querySelector("table")!;
    expect(table).toHaveAttribute("data-stacked");
    rerender(<NoteTable head={head} rows={[[[{ text: "z" }], [{ text: "w" }]]]} cell={cell as never} />);
    expect(table).toHaveAttribute("data-stacked");
    room = 1000;
    act(() => fits.at(-1)!());
    expect(table).not.toHaveAttribute("data-stacked");
    vi.unstubAllGlobals();
  });

  it("a table that fits stays a table", () => {
    widths(500, 600);
    const { container } = mount();
    expect(container.querySelector("table")).not.toHaveAttribute("data-stacked");
  });

  it("a short inline code token never wraps inside; a long or spaced one may", () => {
    const note = parseNote("04-Foundations/Zz-Codes.md", "# Zz Codes\nSee `\\\\zzfs01.example.test\\pipe\\zz` and `zz --flag value`.\n")!;
    mount(note);
    expect(screen.getByText("\\\\zzfs01.example.test\\pipe\\zz")).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("zz --flag value")).not.toHaveClass("whitespace-nowrap");
  });
});

describe("safe Markdown", () => {
  it("the Manual never injects HTML", () => {
    const root = join(__dirname, "..", "..", "..", "..");
    for (const f of ["src/engines/manual/anchors.ts", "src/engines/manual/markdown.ts", "src/engines/manual/links.ts", "src/features/manual/NoteView.tsx", "src/features/manual/NoteTable.tsx", "src/features/manual/ManualCommand.tsx"]) {
      expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/);
    }
  });
});
