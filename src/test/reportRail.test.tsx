import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { TextSelection } from "prosekit/pm/state";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, resetAuditState } from "../audit/fakeApi";
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
const cmd = (title: string, command: string, over: Partial<LogEntryInput> = {}): LogEntryInput => ({
  title,
  ranOn: null,
  hostIds: [LNX],
  observations: null,
  returnedNothing: false,
  private: false,
  content: { kind: "command", blocks: [{ command, output: "ok" }] } satisfies LogContent,
  ...over,
});

/** lnx02's log: nmap (already on its page), hydra and smbclient (not), and a private entry. Plus a note, ruled-out items, a credential. */
async function seed() {
  const nmap = await api.logCreate("e-exam", cmd("nmap scan", "nmap -sV 10.10.30.21", { at: 1_000 }));
  const hydra = await api.logCreate("e-exam", cmd("hydra login", "hydra -l bob ssh://10.10.30.21", { at: 2_000 }));
  await api.logCreate("e-exam", cmd("smbclient list", "smbclient -L //10.10.30.21", { at: 3_000 }));
  await api.logCreate("e-exam", cmd("private scratch", "secret-thing", { private: true, at: 4_000 }));
  const report = await api.reportGetOrCreate("e-exam");
  const doc = {
    type: "doc",
    content: [
      { type: "phase", attrs: { phase: "foothold", hostId: LNX } },
      { type: "slot", attrs: { hint: "What you do next" } },
      { type: "evidence", attrs: { entryId: nmap.id, block: 0, keep: null, emphasis: [], appendix: "inline" } },
      { type: "phase", attrs: { phase: "post", hostId: LNX } },
      { type: "slot", attrs: { hint: "Proof" } },
    ],
  };
  await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: doc as unknown as ReportDoc, meta: { removedEntryIds: [hydra.id], layout: 3 }, draftBuiltAt: Date.now() });
  await api.noteSave("e-exam", LNX, "Port 22 open\n? why is 8080 filtered\n", false);
  await api.noteSave("e-exam", null, "Private engagement text", true);
  await api.ruledOutCreate({ engagementId: "e-exam", hostId: LNX, text: "Anonymous FTP", reason: "Not enabled", private: false });
  await api.ruledOutCreate({ engagementId: "e-exam", hostId: LNX, text: "Hidden theory", reason: "operator only", private: true });
  await api.credentialCreate("e-exam", { type: "password", username: "bob", secret: "hunter2", scope: "local", localHostId: LNX, sourceHostId: LNX });
  const sam = await api.usernameCreate("e-exam", { username: "sam" });
  await api.accessGrantCreate("e-exam", { usernameId: sam.id, hostId: LNX, level: "admin", via: "sudo misconfiguration" });
  await api.credentialCreate("e-exam", { type: "password", username: "alice", secret: "pw", sourceHostId: "h-exam-ms01" });
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

const unusedList = () => screen.getByRole("list", { name: "Unused log entries" });
const titles = () => within(unusedList()).queryAllByRole("listitem").map((li) => li.getAttribute("aria-label")!.split(",")[0]);
const evidenceIds = (editor: Editor) => {
  const ids: string[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === "evidence") ids.push(n.attrs.entryId as string);
  });
  return ids;
};
const shape = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((n) => out.push(n.type.name === "phase" ? `phase:${n.attrs.phase}` : n.type.name === "evidence" ? `evidence:${n.attrs.entryId}` : n.type.name));
  return out;
};
const entryId = async (title: string) => (await api.logList("e-exam")).find((e) => e.title === title)!.id;

async function ready() {
  await waitFor(() => expect(editors.length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByRole("tab", { name: /Unused/ })).toBeInTheDocument());
}

describe("Evidence rail", () => {
  it("lists host-linked entries that are not on the page, without private ones", async () => {
    await seed();
    mount();
    await ready();
    expect(screen.getByRole("tab", { name: "Unused (2)" })).toBeInTheDocument();
    expect(titles()).toEqual(["hydra login", "smbclient list"]);
    expect(titles()).not.toContain("nmap scan");
    expect(titles()).not.toContain("private scratch");

    // The sort toggle flips the time order.
    fireEvent.click(screen.getByRole("button", { name: "Oldest first" }));
    expect(titles()).toEqual(["smbclient list", "hydra login"]);
  });

  it("inserts at the cursor, the entry leaves Unused, and a removed block comes back", async () => {
    await seed();
    mount();
    await ready();
    const editor = editors[0];
    const hydra = await entryId("hydra login");
    const nmap = await entryId("nmap scan");
    const save = vi.spyOn(api, "reportSectionSave");

    // The owner clicks into the last slot, so the entry lands right after it, its own slot first.
    act(() => {
      editor.view.dom.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      let at = 0;
      editor.state.doc.descendants((n, p) => {
        if (n.type.name === "slot") at = p + 1;
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert hydra login" }));
    expect(shape(editor)).toEqual(["phase:foothold", "slot", `evidence:${nmap}`, "phase:post", "slot", "slot", `evidence:${hydra}`]);
    await waitFor(() => expect(titles()).toEqual(["smbclient list"]));
    // The saved page holds the block, and the entry is no longer remembered as removed.
    await waitFor(
      () => {
        const [, doc, meta] = save.mock.calls.at(-1)!;
        expect(JSON.stringify(doc)).toContain(hydra);
        expect((meta as { removedEntryIds?: string[] }).removedEntryIds ?? []).not.toContain(hydra);
      },
      { timeout: 3000 },
    );
    expect(screen.getByRole("tab", { name: "Unused (1)" })).toBeInTheDocument();

    // Taking the nmap block off the page puts it back in Unused.
    act(() => {
      let pos = -1;
      editor.state.doc.descendants((n, p) => {
        if (n.type.name === "evidence" && n.attrs.entryId === nmap) pos = p;
      });
      editor.view.dispatch(editor.state.tr.delete(pos, pos + editor.state.doc.nodeAt(pos)!.nodeSize));
    });
    await waitFor(() => expect(titles()).toEqual(["nmap scan", "smbclient list"]));
  });

  it("inserts at the end of the entry's phase when the page has no cursor, from the keyboard", async () => {
    await seed();
    mount();
    await ready();
    const editor = editors[0];
    const smb = await entryId("smbclient list");
    const row = within(unusedList()).getByRole("listitem", { name: /smbclient list/ });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(evidenceIds(editor)).toContain(smb);
    // No selection was ever made on the page: it goes to the end of the foothold phase, before Post-Exploitation,
    // its slot before it.
    const nmap = await entryId("nmap scan");
    expect(shape(editor)).toEqual(["phase:foothold", "slot", `evidence:${nmap}`, "slot", `evidence:${smb}`, "phase:post", "slot"]);
    await waitFor(() => expect(titles()).toEqual(["hydra login"]));
    // Focus moved on to the next row instead of falling to the page.
    expect(document.activeElement).toBe(within(unusedList()).getByRole("listitem", { name: /hydra login/ }));
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
