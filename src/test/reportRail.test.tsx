import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { TextSelection, type Selection } from "prosekit/pm/state";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, resetAuditState } from "../audit/fakeApi";
import { DRAFT_LAYOUT, sourceOf, type ReportNode } from "../engines/report";
import { ReportSectionView } from "../features/report/ReportSection/ReportSection";
import { useNotesStore } from "../features/notes/useNotesStore";
import { makeQueryClient } from "../lib/queryClient";
import type { LogContent, LogEntryInput } from "../types/log";
import { TooltipProvider } from "../ui";

vi.mock("../lib/api", () => import("../audit/fakeApi"));

const editors: Editor[] = [];
vi.mock("../features/report/editor/ReportEditor/ReportEditor", async (importOriginal) => {
  const real = await importOriginal<typeof import("../features/report/editor/ReportEditor/ReportEditor")>();
  return {
    ...real,
    ReportEditor: (props: ComponentProps<typeof real.ReportEditor>) => (
      <real.ReportEditor
        {...props}
        onReady={(e) => {
          editors.push(e);
          props.onReady(e);
        }}
      />
    ),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  editors.length = 0;
  resetAuditState();
});

const LNX = "h-exam-lnx";
const cmd = (title: string, command: string, over: Partial<LogEntryInput> = {}, output = "ok"): LogEntryInput => ({
  title,
  ranOn: null,
  hostIds: [LNX],
  observations: null,
  returnedNothing: false,
  private: false,
  content: { kind: "command", blocks: [{ command, output }] } satisfies LogContent,
  ...over,
});
const shot = (title: string, at: number): LogEntryInput => ({
  title,
  ranOn: null,
  hostIds: [LNX],
  observations: null,
  returnedNothing: false,
  private: false,
  at,
  content: { kind: "screenshot", attachmentId: "", caption: "", fileName: "shot.png" },
});

const NMAP_OUT = "Nmap scan report for 10.10.30.21\nPORT     STATE SERVICE VERSION\n22/tcp   open  ssh     OpenSSH 7.6p1\n8080/tcp open  http    Jetty 9.4\n";
const WINPEAS_OUT = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n");

/**
 * lnx02 (standalone), a plain page at the current layout: an ssh login granted user access and is step 1 of Initial
 * access, step 2 is the owner's own step. Not on the page: the nmap scan (its ports are the port table's), hydra, a failed anonymous
 * FTP attempt, a screenshot that came along with the ssh login, smbclient and a 3,000-line winPEAS after the access
 * (privilege escalation), a private entry, and an entry behind an operator-reason attempt. Plus a note, ruled-out
 * items, credentials and an admin grant.
 */
async function seed() {
  const nmap = await api.logCreate("e-exam", cmd("nmap scan", "nmap -sV 10.10.30.21", { at: 1_000 }, NMAP_OUT));
  const hydra = await api.logCreate("e-exam", cmd("hydra login", "hydra -L users.txt -P rockyou.txt ssh://10.10.30.21", { at: 2_000 }, "\n[22][ssh] host: 10.10.30.21 login: svc_web password: Summer2026\n"));
  const ftp = await api.logCreate("e-exam", cmd("ftp anonymous", "ftp 10.10.30.21", { at: 2_200, observations: "anonymous login refused" }, ""));
  const lazy = await api.logCreate("e-exam", cmd("lazy guess", "ssh root@10.10.30.21", { at: 2_300 }));
  const ssh = await api.logCreate("e-exam", cmd("ssh login", "ssh svc_web@10.10.30.21", { at: 2_500 }));
  const screenshot = await api.logCreate("e-exam", shot("ssh shell screenshot", 2_600));
  const smb = await api.logCreate("e-exam", cmd("smbclient list", "smbclient -L //10.10.30.21", { at: 3_000 }));
  const winpeas = await api.logCreate("e-exam", cmd("winpeas run", "./winpeas.sh", { at: 3_500 }, WINPEAS_OUT));
  await api.logCreate("e-exam", cmd("private scratch", "secret-thing", { private: true, at: 4_000 }));
  await api.failedAttemptCreate("e-exam", { hostId: LNX, title: "Anonymous FTP login", reasonKind: "precondition", reason: "Anonymous login disabled", logEntryId: ftp.id });
  await api.failedAttemptCreate("e-exam", { hostId: LNX, title: "Root guess", reasonKind: "operator", reason: "ran out of time", logEntryId: lazy.id });
  const shell = await api.usernameCreate("e-exam", { username: "svc_web" });
  await api.accessGrantCreate("e-exam", { usernameId: shell.id, hostId: LNX, level: "user", via: "ssh with hydra's password", logEntryId: ssh.id, at: 2_500 });

  const report = await api.reportGetOrCreate("e-exam");
  const t = (text: string) => [{ type: "text", text }];
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1, source: `facts:${LNX}` }, content: t("lnx02 (10.10.30.21)") },
      { type: "heading", attrs: { level: 2, source: `phase:${LNX}:enum` }, content: t("Service enumeration") },
      { type: "paragraph", content: t("Two ports open.") },
      { type: "heading", attrs: { level: 2, source: `phase:${LNX}:foothold` }, content: t("Initial access") },
      { type: "paragraph", attrs: { source: `phase-steps:${LNX}` }, content: [{ type: "text", text: "Steps to reproduce:", marks: [{ type: "bold" }] }] },
      {
        type: "list",
        attrs: { kind: "ordered" },
        content: [
          { type: "paragraph", attrs: { source: `entry:${ssh.id}:title` }, content: t("Ssh login:") },
          { type: "codeBlock", attrs: { language: "", source: `entry:${ssh.id}:0:command` }, content: t("ssh svc_web@10.10.30.21") },
          { type: "codeBlock", attrs: { language: "", source: `entry:${ssh.id}:0:output` }, content: t("ok") },
        ],
      },
      { type: "list", attrs: { kind: "ordered" }, content: [{ type: "paragraph", content: t("Then the owner's own step.") }] },
      { type: "heading", attrs: { level: 2, source: `phase:${LNX}:tested` }, content: t("Also tested") },
    ],
  };
  await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: doc, meta: { removedEntryIds: [hydra.id], layout: DRAFT_LAYOUT }, draftBuiltAt: Date.now() });
  await api.noteSave("e-exam", LNX, "Port 22 open\n? why is 8080 filtered\n", false);
  await api.noteSave("e-exam", null, "Private engagement text", true);
  await api.ruledOutCreate({ engagementId: "e-exam", hostId: LNX, text: "Anonymous FTP", reason: "Not enabled", private: false });
  await api.ruledOutCreate({ engagementId: "e-exam", hostId: LNX, text: "Hidden theory", reason: "operator only", private: true });
  await api.credentialCreate("e-exam", { type: "password", username: "bob", secret: "hunter2", scope: "local", localHostId: LNX, sourceHostId: LNX });
  const sam = await api.usernameCreate("e-exam", { username: "sam" });
  await api.accessGrantCreate("e-exam", { usernameId: sam.id, hostId: LNX, level: "admin", via: "sudo misconfiguration" });
  await api.credentialCreate("e-exam", { type: "password", username: "alice", secret: "pw", sourceHostId: "h-exam-ms01" });
  return { nmap, hydra, ftp, ssh, screenshot, smb, winpeas };
}

function mount() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/e/e-exam/s/report"]}>
          <Routes>
            <Route path="/e/:id/s/:section" element={<ReportSectionView />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const logColumn = () => screen.getByRole("group", { name: "Unused log entries" });
const rowTitles = (el: HTMLElement) => within(el).queryAllByRole("listitem").map((li) => li.getAttribute("aria-label")!.split(",")[0]);
const titles = () => rowTitles(logColumn());
const group = (label: string) => within(logColumn()).getByRole("list", { name: label });
const row = (title: string) => within(logColumn()).getByRole("listitem", { name: new RegExp(`^${title},`) });
/** Each entry title a block's sources name, in order (a figure by its entry). */
async function titlesIn(n: ReportNode): Promise<string[]> {
  const title = new Map((await api.logList("e-exam")).map((e) => [e.id, e.title]));
  const out: string[] = [];
  const walk = (b: ReportNode) => {
    const m = /^entry:([^:]+)/.exec(sourceOf(b) ?? "");
    const id = m?.[1] ?? (b.type === "figure" ? (b.attrs?.entryId as string | undefined) : undefined);
    if (id && out.at(-1) !== title.get(id)) out.push(title.get(id) ?? "?");
    b.content?.forEach(walk);
  };
  walk(n);
  return out;
}
/** The page's top-level blocks: a heading as `h:<text>`, a numbered step as the entries it holds, `[ssh login]`. */
async function shapeOf(editor: Editor) {
  const out: string[] = [];
  for (const n of (editor.getDocJSON() as ReportNode).content ?? []) {
    const text = (b: ReportNode): string => (b.text ?? "") + (b.content ?? []).map(text).join("");
    if (n.type === "heading") out.push(`h:${text(n)}`);
    else if (n.type === "list" && n.attrs?.kind === "ordered") out.push(`[${(await titlesIn(n)).join(",")}]`);
    else out.push((await titlesIn(n)).length > 0 ? `${n.type}:${(await titlesIn(n)).join(",")}` : n.type);
  }
  return out;
}
/** Focuses the page (the owner has a cursor on it) and selects with `pick`. */
function cursor(editor: Editor, pick: (doc: Editor["state"]["doc"]) => Selection) {
  act(() => {
    editor.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    editor.view.dispatch(editor.state.tr.setSelection(pick(editor.state.doc)));
  });
}
/** The position inside the textblock whose text is `text`, after its first character. */
function textPos(doc: Editor["state"]["doc"], text: string) {
  let at = -1;
  doc.descendants((node, pos) => void (at < 0 && node.isTextblock && node.textContent === text && (at = pos + 2)));
  expect(at).toBeGreaterThan(0);
  return at;
}
/** The position of the top-level step holding an entry's blocks. */
function listPos(doc: Editor["state"]["doc"], entryId: string) {
  let at = -1;
  doc.forEach((node, offset) => void (at < 0 && node.type.name === "list" && JSON.stringify(node.toJSON()).includes(`entry:${entryId}:`) && (at = offset)));
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

async function ready() {
  await waitFor(() => expect(editors.length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByRole("tab", { name: /Unused/ })).toBeInTheDocument());
}

describe("Evidence rail: the log column", () => {
  it("a failed attempt's row says it is in Also tested", async () => {
    await seed();
    mount();
    await ready();
    expect(within(row("ftp anonymous")).getByText("in Also tested")).toBeInTheDocument();
    expect(within(row("hydra login")).queryByText("in Also tested")).not.toBeInTheDocument();
  });

  it("private entries never appear, nor an entry behind an operator-reason attempt", async () => {
    await seed();
    mount();
    await ready();
    expect(titles()).not.toContain("private scratch");
    expect(titles()).not.toContain("lazy guess");
    expect(screen.queryByText(/secret-thing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ran out of time/)).not.toBeInTheDocument();
  });

  it("shows the notes and ruled-out items, marks open threads, and never shows private ones", async () => {
    await seed();
    mount();
    await ready();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Notes" }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(screen.getByText("Port 22 open")).toBeInTheDocument());
    expect(screen.getByText(/why is 8080 filtered/)).toBeInTheDocument();
    expect(screen.getByText("Open thread:")).toBeInTheDocument();
    expect(screen.getByText("Anonymous FTP")).toBeInTheDocument();
    expect(screen.queryByText("Hidden theory")).not.toBeInTheDocument();
    expect(screen.queryByText(/Private engagement text/)).not.toBeInTheDocument();
  });

  it("lists the credentials sourced from the host", async () => {
    await seed();
    mount();
    await ready();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Creds" }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(screen.getByText("bob")).toBeInTheDocument());
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    expect(screen.getByText(/sam on lnx02: admin/)).toBeInTheDocument();
    expect(screen.getByText("sudo misconfiguration")).toBeInTheDocument();
    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy/ })).not.toBeInTheDocument();
  });

  it("lists a credential found elsewhere that nxc showed works on the target, with no source host or grant", async () => {
    await seed();
    const found = await api.credentialCreate("e-exam", { type: "password", username: "svc_backup", secret: "Backup#2026", source: "paste" });
    await api.credAttemptsUpsert("e-exam", [{ credId: found.id, hostId: LNX, service: "ssh", port: 22, result: "valid", authMode: "local" }]);
    const failed = await api.credentialCreate("e-exam", { type: "password", username: "eve", secret: "nope" });
    await api.credAttemptsUpsert("e-exam", [{ credId: failed.id, hostId: LNX, service: "ssh", port: 22, result: "failed" }]);
    mount();
    await ready();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Creds" }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(screen.getByText("svc_backup")).toBeInTheDocument());
    expect(screen.getByText("password, works on SSH, lnx02")).toBeInTheDocument();
    expect(screen.getByText("password, local to lnx02; found on lnx02")).toBeInTheDocument();
    expect(screen.queryByText("eve")).not.toBeInTheDocument();
    expect(screen.queryByText(/^No credential/)).not.toBeInTheDocument();
  });

  it("says no credential or access only when nothing ties one to the target", async () => {
    await seed();
    const found = await api.credentialCreate("e-exam", { type: "password", username: "svc_backup", secret: "Backup#2026" });
    await api.credAttemptsUpsert("e-exam", [{ credId: found.id, hostId: "h-exam-ms01", service: "ssh", result: "valid" }]);
    for (const c of await api.credentialsList("e-exam")) if (c.localHostId === LNX || c.sourceHostId === LNX) await api.credentialDelete(c.id);
    for (const g of await api.accessGrantsList("e-exam")) if (g.hostId === LNX) await api.accessGrantDelete(g.id);
    mount();
    await ready();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Creds" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("No credential results or access recorded for this target.")).toBeInTheDocument();
  });

  it("is a drawer under 1000px, toggled by E", async () => {
    await seed();
    const width = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const w = this.getAttribute("aria-label") === "Report" ? 900 : 0;
      return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
    mount();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    expect(width).toHaveBeenCalled();
    expect(screen.queryByRole("tab", { name: /Unused/ })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "e" });
    expect(await screen.findByRole("tab", { name: /Unused/ })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Evidence" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Unused/ })).not.toBeInTheDocument());

    // The strip button does the same.
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(await screen.findByRole("tab", { name: /Unused/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Unused/ })).not.toBeInTheDocument());
    // ⌥3 opens it and puts focus on the tabs.
    fireEvent.keyDown(window, { code: "Digit3", altKey: true });
    const tab = await screen.findByRole("tab", { name: /Unused/ });
    await waitFor(() => expect(document.activeElement).toBe(tab));

    // Opening Notes slides the evidence drawer out.
    act(() => useNotesStore.setState({ open: true }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Unused/ })).not.toBeInTheDocument());
    act(() => useNotesStore.setState({ open: false }));
  });

  it("from 1000px to under 1200px docks beside the page, toggled by E, and stays when Notes opens", async () => {
    await seed();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const w = this.getAttribute("aria-label") === "Report" ? 1100 : 0;
      return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
    mount();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    expect(screen.queryByRole("tab", { name: /Unused/ })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "e" });
    expect(await screen.findByRole("tab", { name: /Unused/ })).toBeInTheDocument();
    const column = screen.getByRole("complementary", { name: "Evidence" });
    // A grid column beside the page, not the fixed drawer over it.
    expect(column).not.toHaveClass("evidence-drawer");
    expect(column).toHaveClass("report-section__rail");
    expect(screen.getByRole("button", { name: "Evidence" })).toHaveAttribute("aria-pressed", "true");

    // Notes is a drawer of its own: the docked column stays.
    act(() => useNotesStore.setState({ open: true }));
    expect(screen.getByRole("tab", { name: /Unused/ })).toBeInTheDocument();
    act(() => useNotesStore.setState({ open: false }));

    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Unused/ })).not.toBeInTheDocument());

    // ⌥3 opens it and puts focus on the column.
    fireEvent.keyDown(window, { code: "Digit3", altKey: true });
    await screen.findByRole("tab", { name: /Unused/ });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("complementary", { name: "Evidence" })));
  });

  it("Esc meant for a field, a menu, a list or a popover leaves the drawer open", async () => {
    await seed();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const w = this.getAttribute("aria-label") === "Report" ? 900 : 0;
      return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
    mount();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(await screen.findByRole("tab", { name: /Unused/ })).toBeInTheDocument();
    const drawerOpen = () => screen.queryByRole("complementary", { name: "Evidence" }) !== null;

    // Typing: a text field, a textarea, the page itself.
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    document.body.append(input, area);
    for (const target of [input, area, editors[0].view.dom]) {
      fireEvent.keyDown(target, { key: "Escape" });
      expect(drawerOpen()).toBe(true);
    }
    input.remove();
    area.remove();

    // An open menu, list or Radix popover hears it instead.
    for (const attrs of [{ role: "menu" }, { role: "listbox" }, { "data-radix-popper-content-wrapper": "" }]) {
      const popup = document.createElement("div");
      for (const [k, v] of Object.entries(attrs)) popup.setAttribute(k, v);
      document.body.append(popup);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(drawerOpen()).toBe(true);
      popup.remove();
    }

    // Nothing else open (the page's closed ProseKit menus and lists stay in the DOM, marked closed): Esc closes it.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(drawerOpen()).toBe(false));
  });
});

describe("Evidence rail: the log column on a plain page", () => {
  it("groups the host's unplaced entries by phase in time order, each with + add only", async () => {
    await seed();
    mount();
    await ready();
    expect(screen.getByRole("heading", { name: "lnx02 log not in the report" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Unused (6)" })).toBeInTheDocument();
    expect(rowTitles(group("Service enumeration"))).toEqual(["nmap scan"]);
    expect(rowTitles(group("Initial access"))).toEqual(["hydra login", "ftp anonymous", "ssh shell screenshot"]);
    expect(rowTitles(group("Privilege escalation"))).toEqual(["smbclient list", "winpeas run"]);
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Service enumeration", "Initial access", "Privilege escalation"]);
    // Each row: time, command, then one line of what it showed (the output's first line, else the observations).
    expect(within(row("hydra login")).getByText("[22][ssh] host: 10.10.30.21 login: svc_web password: Summer2026")).toBeInTheDocument();
    expect(within(row("hydra login")).getByText(/hydra -L users.txt/)).toBeInTheDocument();
    expect(within(row("ftp anonymous")).getByText("anonymous login refused")).toBeInTheDocument();
    expect(within(row("ssh shell screenshot")).getByText("no output")).toBeInTheDocument();
    // The scan's ports are the port table's.
    expect(within(row("nmap scan")).getByText("in the port table already")).toBeInTheDocument();
    // One action per row, + add, a 3,000-line output too: no appendix action.
    for (const title of titles()) expect(within(row(title)).getAllByRole("button").map((b) => b.textContent)).toEqual(["+ add"]);
    expect(within(logColumn()).queryByText(/to appendix/)).toBeNull();
  });

  it("+ add with the cursor in step 2 puts the entry's blocks into step 2", async () => {
    const { hydra } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    const save = vi.spyOn(api, "reportSectionSave");
    cursor(editor, (doc) => TextSelection.create(doc, textPos(doc, "Then the owner's own step.")));
    fireEvent.click(screen.getByRole("button", { name: "Add hydra login" }));
    expect(await shapeOf(editor)).toEqual(["h:lnx02 (10.10.30.21)", "h:Service enumeration", "paragraph", "h:Initial access", "paragraph", "[ssh login]", "[hydra login]", "h:Also tested"]);
    await waitFor(() => expect(titles()).not.toContain("hydra login"));
    // The saved page holds it, and the entry is no longer remembered as removed.
    await waitFor(
      () => {
        const [, doc, meta] = save.mock.calls.at(-1)!;
        expect(JSON.stringify(doc)).toContain(hydra.id);
        expect((meta as { removedEntryIds?: string[] }).removedEntryIds ?? []).not.toContain(hydra.id);
      },
      { timeout: 3000 },
    );
  });

  it("+ add with the cursor in a heading adds a numbered step at the end of the entry's phase, as with no cursor", async () => {
    await seed();
    mount();
    await ready();
    const editor = editors[0];
    cursor(editor, (doc) => TextSelection.create(doc, textPos(doc, "Initial access")));
    fireEvent.click(screen.getByRole("button", { name: "Add hydra login" }));
    expect((await shapeOf(editor)).slice(3)).toEqual(["h:Initial access", "paragraph", "[ssh login]", "[]", "[hydra login]", "h:Also tested"]);
  });

  it("with no cursor on the page, ⌘↵ on a focused row adds a step at the end of its phase and focus moves on", async () => {
    await seed();
    mount();
    await ready();
    const editor = editors[0];
    const r = row("smbclient list");
    r.focus();
    fireEvent.keyDown(r, { key: "Enter", metaKey: true });
    // Privilege escalation had no heading: it comes before Also tested, with its Steps to reproduce.
    expect((await shapeOf(editor)).slice(5)).toEqual(["[ssh login]", "[]", "h:Privilege escalation", "paragraph", "[smbclient list]", "h:Also tested"]);
    await waitFor(() => expect(titles()).not.toContain("smbclient list"));
    // Focus moved on to the next row instead of falling to the page.
    expect(document.activeElement).toBe(row("winpeas run"));
  });

  it("a screenshot goes into the step holding the cursor, as a figure", async () => {
    const { screenshot } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    cursor(editor, (doc) => TextSelection.create(doc, textPos(doc, "Then the owner's own step.")));
    fireEvent.click(screen.getByRole("button", { name: "Add ssh shell screenshot" }));
    expect((await shapeOf(editor)).slice(5, 7)).toEqual(["[ssh login]", "[ssh shell screenshot]"]);
    const step = (editor.getDocJSON() as ReportNode).content![6];
    expect(step.content!.map((n) => n.type)).toEqual(["paragraph", "paragraph", "figure"]);
    expect(step.content![2].attrs?.entryId).toBe(screenshot.id);
  });

  it("a 3,000-line output is added with + add, cut to what proves the step", async () => {
    const { winpeas } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    fireEvent.click(within(row("winpeas run")).getByRole("button", { name: "Add winpeas run" }));
    expect((await shapeOf(editor)).slice(7, 10)).toEqual(["h:Privilege escalation", "paragraph", "[winpeas run]"]);
    let output = "";
    editor.state.doc.descendants((n) => void (n.attrs.source === `entry:${winpeas.id}:0:output` && (output = n.textContent)));
    expect(output.split("\n").length).toBeLessThan(20);
    expect(output).toContain("lines omitted");
    expect(output.startsWith("line 1\n")).toBe(true);
    expect(output.endsWith("line 3000")).toBe(true);
  });

  it("an entry whose blocks are taken off the page comes back to its group", async () => {
    const { ssh } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    act(() => {
      const pos = listPos(editor.state.doc, ssh.id);
      editor.view.dispatch(editor.state.tr.delete(pos, pos + editor.state.doc.nodeAt(pos)!.nodeSize));
    });
    await waitFor(() => expect(rowTitles(group("Initial access"))).toEqual(["hydra login", "ftp anonymous", "ssh login", "ssh shell screenshot"]));
  });

  it("deleting an entry's step records it as removed in the saved meta; undo un-records it", async () => {
    const { ssh } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    const save = vi.spyOn(api, "reportSectionSave");
    const lastMeta = () => (save.mock.calls.at(-1)?.[2] as { removedEntryIds?: string[] } | undefined)?.removedEntryIds ?? [];
    act(() => {
      const pos = listPos(editor.state.doc, ssh.id);
      editor.view.dispatch(editor.state.tr.delete(pos, pos + editor.state.doc.nodeAt(pos)!.nodeSize));
    });
    await waitFor(() => expect(lastMeta()).toContain(ssh.id), { timeout: 3000 });
    fireEvent.keyDown(editor.view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    await waitFor(() => expect(JSON.stringify(save.mock.calls.at(-1)?.[1])).toContain(ssh.id), { timeout: 3000 });
    expect(lastMeta()).not.toContain(ssh.id);
  });

  it("Add new evidence adds what the draft places that isn't on the page or removed, and Undo takes it off", async () => {
    const { hydra, ssh } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    const before = editor.getDocJSON();
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    const notice = await screen.findByText(/^Added /);
    const json = JSON.stringify(editor.getDocJSON());
    // hydra was removed by the owner: it stays off. The ssh login is on the page once.
    expect(json).not.toContain(hydra.id);
    expect(json.split(`entry:${ssh.id}:0:command`)).toHaveLength(2);
    fireEvent.click(within(notice.closest<HTMLElement>("[role=status]")!).getByRole("button", { name: "Undo" }));
    expect(editor.getDocJSON()).toEqual(before);
  });
});
