import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { NodeSelection, TextSelection, type Selection } from "prosekit/pm/state";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, resetAuditState } from "../audit/fakeApi";
import { DRAFT_LAYOUT, STEP_HINT } from "../engines/report";
import { ReportSectionView } from "../features/report/ReportSection";
import { useNotesStore } from "../features/notes/useNotesStore";
import { makeQueryClient } from "../lib/queryClient";
import type { LogContent, LogEntryInput } from "../types/log";
import type { ReportDoc } from "../types/report";
import { TooltipProvider } from "../ui";

vi.mock("../lib/api", () => import("../audit/fakeApi"));

const editors: Editor[] = [];
vi.mock("../features/report/editor/ReportEditor", async (importOriginal) => {
  const real = await importOriginal<typeof import("../features/report/editor/ReportEditor")>();
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
 * lnx02 (standalone) in layout 4: an ssh login granted user access and is step 1 of Initial access, step 2 is the
 * owner's own empty step. Not on the page: the nmap scan (its ports are the port table's), hydra, a failed anonymous
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
  const step = (entryId: string | null, ...evidence: string[]) => ({
    type: "step",
    attrs: { entryId },
    content: [{ type: "slot", attrs: { hint: STEP_HINT } }, ...evidence.map((id) => ({ type: "evidence", attrs: { entryId: id, block: 0, keep: null, emphasis: [], appendix: "inline" } }))],
  });
  const doc = {
    type: "doc",
    content: [
      { type: "generated", attrs: { kind: "facts", hostId: LNX, appendix: "inline" } },
      { type: "generated", attrs: { kind: "result", hostId: LNX, appendix: "inline" } },
      { type: "phase", attrs: { phase: "enum", hostId: LNX } },
      { type: "generated", attrs: { kind: "ports", hostId: LNX, appendix: "inline", notes: {} } },
      { type: "phase", attrs: { phase: "foothold", hostId: LNX } },
      { type: "steps", content: [step(ssh.id, ssh.id), step(null)] },
      { type: "phase", attrs: { phase: "post", hostId: LNX } },
      { type: "slot", attrs: { hint: "Proof" } },
    ],
  };
  await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: doc as unknown as ReportDoc, meta: { removedEntryIds: [hydra.id], layout: DRAFT_LAYOUT }, draftBuiltAt: Date.now() });
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
const evidenceIds = (editor: Editor) => {
  const ids: string[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === "evidence") ids.push(n.attrs.entryId as string);
  });
  return ids;
};
/** The page's top-level blocks; a steps list as its steps' evidence entry titles, `[ssh login][]`. */
async function shapeOf(editor: Editor) {
  const title = new Map((await api.logList("e-exam")).map((e) => [e.id, e.title]));
  const out: string[] = [];
  editor.state.doc.forEach((n) => {
    if (n.type.name === "phase") out.push(`phase:${n.attrs.phase}`);
    else if (n.type.name === "generated") out.push(`generated:${n.attrs.kind}`);
    else if (n.type.name === "steps") {
      const steps: string[] = [];
      n.forEach((st) => {
        const ids: string[] = [];
        st.forEach((k) => void (k.type.name === "evidence" && ids.push(title.get(k.attrs.entryId as string) ?? "?")));
        steps.push(`[${ids.join(",")}]`);
      });
      out.push(`steps:${steps.join("")}`);
    } else out.push(n.type.name);
  });
  return out;
}
/** Focuses the page (the owner has a cursor on it) and selects with `pick`. */
function cursor(editor: Editor, pick: (doc: Editor["state"]["doc"]) => Selection) {
  act(() => {
    editor.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    editor.view.dispatch(editor.state.tr.setSelection(pick(editor.state.doc)));
  });
}
/** The position of the `n`th (from 0) node named `type`. */
function nth(doc: Editor["state"]["doc"], type: string, n = 0, where: (attrs: Record<string, unknown>) => boolean = () => true) {
  const found: number[] = [];
  doc.descendants((node, pos) => void (node.type.name === type && where(node.attrs) && found.push(pos)));
  return found[n];
}

async function ready() {
  await waitFor(() => expect(editors.length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByRole("tab", { name: /Unused/ })).toBeInTheDocument());
}

describe("Evidence rail: the log column", () => {
  it("groups the host's unplaced entries by phase in time order", async () => {
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
  });

  it("+ add with the cursor in step 2 appends the entry's evidence to step 2", async () => {
    const { hydra } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    const save = vi.spyOn(api, "reportSectionSave");
    cursor(editor, (doc) => TextSelection.create(doc, nth(doc, "step", 1) + 2));
    fireEvent.click(screen.getByRole("button", { name: "Add hydra login" }));
    expect(await shapeOf(editor)).toEqual([
      "generated:facts",
      "generated:result",
      "phase:enum",
      "generated:ports",
      "phase:foothold",
      "steps:[ssh login][hydra login]",
      "phase:post",
      "slot",
    ]);
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

  it("+ add with the cursor in a ports Notes cell or a heading adds a new step at the end of the entry's phase", async () => {
    await seed();
    mount();
    await ready();
    const editor = editors[0];
    // The Notes cell lives in the port table's block: the page's selection is that block.
    cursor(editor, (doc) => NodeSelection.create(doc, nth(doc, "generated", 0, (a) => a.kind === "ports")));
    fireEvent.click(screen.getByRole("button", { name: "Add smbclient list" }));
    expect((await shapeOf(editor)).slice(4)).toEqual(["phase:foothold", "steps:[ssh login][]", "phase:privesc", "steps:[smbclient list]", "phase:post", "slot"]);

    // A heading: hydra goes to the end of Initial access, a step of its own.
    cursor(editor, (doc) => NodeSelection.create(doc, nth(doc, "phase", 0, (a) => a.phase === "foothold")));
    fireEvent.click(screen.getByRole("button", { name: "Add hydra login" }));
    expect((await shapeOf(editor)).slice(4)).toEqual(["phase:foothold", "steps:[ssh login][][hydra login]", "phase:privesc", "steps:[smbclient list]", "phase:post", "slot"]);
  });

  it("with no cursor on the page, ⌘↵ on a focused row adds a step at the end of its phase and focus moves on", async () => {
    await seed();
    mount();
    await ready();
    const editor = editors[0];
    const r = row("smbclient list");
    r.focus();
    fireEvent.keyDown(r, { key: "Enter", metaKey: true });
    expect((await shapeOf(editor)).slice(4)).toEqual(["phase:foothold", "steps:[ssh login][]", "phase:privesc", "steps:[smbclient list]", "phase:post", "slot"]);
    await waitFor(() => expect(titles()).not.toContain("smbclient list"));
    // Focus moved on to the next row instead of falling to the page.
    expect(document.activeElement).toBe(row("winpeas run"));
  });

  it("with no cursor, a screenshot that came along with a step joins that step", async () => {
    await seed();
    mount();
    await ready();
    const editor = editors[0];
    // No cursor: into the ssh login's step, as Add new evidence puts it, never a numbered step of its own.
    fireEvent.click(screen.getByRole("button", { name: "Add ssh shell screenshot" }));
    expect((await shapeOf(editor)).slice(4, 6)).toEqual(["phase:foothold", "steps:[ssh login,ssh shell screenshot][]"]);
  });

  it("a screenshot that came along with a step goes into the step holding the cursor", async () => {
    const { screenshot } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    cursor(editor, (doc) => TextSelection.create(doc, nth(doc, "step", 1) + 2));
    fireEvent.click(screen.getByRole("button", { name: "Add ssh shell screenshot" }));
    expect((await shapeOf(editor)).slice(4, 6)).toEqual(["phase:foothold", "steps:[ssh login][ssh shell screenshot]"]);
    expect(evidenceIds(editor).filter((id) => id === screenshot.id)).toHaveLength(1);
  });

  it("a 3,000-line output offers + to appendix and lands split", async () => {
    const { winpeas } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    expect(within(row("winpeas run")).queryByRole("button", { name: "Add winpeas run" })).not.toBeInTheDocument();
    const button = within(row("winpeas run")).getByRole("button", { name: "Add winpeas run to appendix" });
    expect(button).toHaveTextContent("+ to appendix");
    expect(within(row("smbclient list")).getByRole("button", { name: "Add smbclient list" })).toHaveTextContent("+ add");
    fireEvent.click(button);
    const placed: Record<string, unknown>[] = [];
    editor.state.doc.descendants((n) => void (n.type.name === "evidence" && n.attrs.entryId === winpeas.id && placed.push(n.attrs)));
    expect(placed).toHaveLength(1);
    expect(placed[0].appendix).toBe("split");
    // Trimmed inline: the page shows its first lines, the appendix the rest.
    expect(placed[0].keep).not.toBeNull();
    expect((await shapeOf(editor)).slice(6, 8)).toEqual(["phase:privesc", "steps:[winpeas run]"]);
  });

  it("+ to appendix splits only the blocks too long to print; the short ones stay inline", async () => {
    await seed();
    const multi = await api.logCreate("e-exam", {
      ...cmd("enum script", "id", { at: 3_600 }),
      content: { kind: "command", blocks: [{ command: "id", output: "uid=1001(svc_web)" }, { command: "./linpeas.sh", output: WINPEAS_OUT }] },
    });
    mount();
    await ready();
    const editor = editors[0];
    fireEvent.click(within(row("enum script")).getByRole("button", { name: "Add enum script to appendix" }));
    const placed: Record<string, unknown>[] = [];
    editor.state.doc.descendants((n) => void (n.type.name === "evidence" && n.attrs.entryId === multi.id && placed.push(n.attrs)));
    expect(placed.map((a) => [a.block, a.appendix])).toEqual([
      [0, "inline"],
      [1, "split"],
    ]);
  });

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

  it("an entry whose block is taken off the page comes back to its group", async () => {
    const { ssh } = await seed();
    mount();
    await ready();
    const editor = editors[0];
    act(() => {
      const pos = nth(editor.state.doc, "evidence", 0, (a) => a.entryId === ssh.id);
      editor.view.dispatch(editor.state.tr.delete(pos, pos + editor.state.doc.nodeAt(pos)!.nodeSize));
    });
    await waitFor(() => expect(rowTitles(group("Initial access"))).toEqual(["hydra login", "ftp anonymous", "ssh login", "ssh shell screenshot"]));
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

  it("is a drawer under 1200px, toggled by E", async () => {
    await seed();
    const width = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const w = this.getAttribute("aria-label") === "Report" ? 1100 : 0;
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
});
