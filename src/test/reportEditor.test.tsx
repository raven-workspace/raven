import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NodeSelection, TextSelection } from "prosekit/pm/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "prosekit/core";
import type { AppendixIndex, ReportData, ReportNode } from "../engines/report";
import { ReportDataContext } from "../features/report/editor/ReportDataContext";
import { insertEvidenceAtCursor, removeNodeAt, ReportEditor, setNodeAttrs } from "../features/report/editor/ReportEditor";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Finding, FindingFile } from "../types/findings";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { Settings } from "../types/settings";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const host = { id: "h1", name: "DC01", ip: "10.0.0.5", os: "windows", access: "root", adSetEffective: false } as Host;
const entry = (o: Record<string, unknown>) =>
  ({
    id: "e1",
    kind: "command",
    title: "Full port scan",
    ranOn: "Kali (VM)",
    private: false,
    hostIds: ["h1"],
    returnedNothing: false,
    at: 1000,
    createdAt: 1000,
    content: { kind: "command", blocks: [{ command: "nmap -p- 10.0.0.5", output: "PORT   STATE SERVICE\n22/tcp open  ssh" }] },
    ...o,
  }) as unknown as LogEntry;

function data(o: Partial<ReportData> = {}): ReportData {
  return {
    engagement: { id: "eng", kind: "exam-sim" },
    hosts: [host],
    services: [],
    log: [entry({})],
    checklist: [],
    findings: [],
    findingFiles: [],
    attempts: [],
    ruledOut: [],
    grants: [],
    usernames: [],
    hops: [],
    cleanup: [],
    notes: [],
    credentials: [],
    ...o,
  } as unknown as ReportData;
}

const ev = (entryId: string, extra: Record<string, unknown> = {}): ReportNode => ({
  type: "evidence",
  attrs: { entryId, block: 0, keep: null, emphasis: [], appendix: "inline", ...extra },
});
const slot = (hint = "What this shows, and why it matters"): ReportNode => ({ type: "slot", attrs: { hint } });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });
const noRefs: AppendixIndex = { entries: [], refFor: () => null };

function setup(page: ReportNode, d: ReportData = data(), appendix: AppendixIndex = noRefs) {
  const onChange = vi.fn();
  const onRemoveEvidence = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <ReportDataContext.Provider value={{ data: d, appendix, sectionMeta: {}, onRemoveEvidence }}>
        <ReportEditor sectionId="s1" doc={page} onChange={onChange} onReady={(e) => (ref.editor = e)} />
      </ReportDataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, onChange, onRemoveEvidence, editor: () => ref.editor! };
}

const lastDoc = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as ReportNode;

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue({ machines: ["Kali (VM)"] } as Settings);
  m.attachmentGet.mockResolvedValue({ id: "a1", mime: "image/png", dataBase64: "AAAA" });
});

describe("ReportEditor evidence", () => {
  it("renders a command as prompt$ command over its output", async () => {
    const { container } = setup(doc(ev("e1"), slot()));
    await waitFor(() => expect(container.querySelector(".report-cmd")).toHaveTextContent("kali$ nmap -p- 10.0.0.5"));
    expect(screen.getByText("22/tcp open ssh", { normalizer: (s) => s.replace(/\s+/g, " ") })).toBeInTheDocument();
  });

  it("shows only the kept lines with the omitted count", async () => {
    const output = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const d = data({ log: [entry({ content: { kind: "command", blocks: [{ command: "cat big", output }] } })] });
    const { container } = setup(doc(ev("e1", { keep: [[0, 39]] })), d);
    await waitFor(() => expect(container.querySelectorAll(".report-line")).toHaveLength(40));
    expect(screen.getByText("… 60 lines omitted")).toBeInTheDocument();
    expect(screen.queryByText("line 40")).toBeNull();
  });

  it("counts kept lines across every block when the node covers the whole entry", async () => {
    const d = data({
      log: [entry({ content: { kind: "command", blocks: [{ command: "a", output: "a0\na1" }, { command: "b", output: "b0\nb1" }] } })],
    });
    const { container } = setup(doc(ev("e1", { block: null, keep: [[1, 2]] })), d);
    await waitFor(() => expect(container.querySelectorAll(".report-line")).toHaveLength(2));
    expect(screen.getByText("a1")).toBeInTheDocument();
    expect(screen.getByText("b0")).toBeInTheDocument();
    expect(screen.queryByText("a0")).toBeNull();
    expect(screen.queryByText("b1")).toBeNull();
  });

  it("shows an amber placeholder for a deleted entry", async () => {
    setup(doc(ev("gone")));
    expect(await screen.findByText("This entry was deleted")).toBeInTheDocument();
  });

  it("shows an amber placeholder for a private entry and none of its content", async () => {
    const d = data({ log: [entry({ private: true, content: { kind: "command", blocks: [{ command: "secret-cmd", output: "secret-out" }] } })] });
    const { container } = setup(doc(ev("e1")), d);
    expect(await screen.findByText("This entry is now private")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("secret-cmd");
    expect(container.innerHTML).not.toContain("secret-out");
    expect(container.innerHTML).not.toContain("Full port scan");
  });

  it("leaves a reference to its appendix entry when moved", async () => {
    const appendix: AppendixIndex = {
      entries: [{ key: "s1:1", letter: "E", n: 2, title: "Full port scan", sectionId: "s1" }],
      refFor: (key) => (key === "s1:1" ? "E.2" : null),
    };
    const { container } = setup(doc(slot(), ev("e1", { appendix: "moved" })), data(), appendix);
    expect(await screen.findByText("Full output: Appendix E.2, Full port scan")).toBeInTheDocument();
    expect(container.querySelector(".report-cmd")).toBeNull();
  });

  it("numbers screenshot captions across the section", async () => {
    const shot = (id: string, caption: string) =>
      entry({ id, kind: "screenshot", content: { kind: "screenshot", attachmentId: "a1", caption, fileName: "x.png" } });
    const d = data({ log: [shot("s1", "Login page"), shot("s2", "Admin panel")] });
    setup(doc(ev("s1", { block: null }), slot(), ev("s2", { block: null })), d);
    expect(await screen.findByText("Figure 1. Login page")).toBeInTheDocument();
    expect(screen.getByText("Figure 2. Admin panel")).toBeInTheDocument();
  });
});

describe("ReportEditor slots", () => {
  it("shows the hint while empty; typing updates the doc and hides it", async () => {
    const { onChange, editor } = setup(doc(slot("Explain each change")));
    expect(await screen.findByText("Explain each change")).toBeInTheDocument();
    await waitFor(() => expect(editor()).toBeTruthy());
    act(() => {
      const view = editor().view;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)).insertText("Port 22 is open"));
    });
    await waitFor(() => expect(screen.queryByText("Explain each change")).toBeNull());
    expect(lastDoc(onChange).content?.[0]).toMatchObject({ type: "slot", content: [{ type: "text", text: "Port 22 is open" }] });
  });
});

describe("ReportEditor removing evidence", () => {
  it("Backspace on a selected evidence node removes it and reports the entry; undo brings it back", async () => {
    const { onChange, onRemoveEvidence, editor } = setup(doc(ev("e1"), slot()));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    act(() => {
      fireEvent.keyDown(view.dom, { key: "Backspace", code: "Backspace", keyCode: 8 });
    });
    expect(onRemoveEvidence).toHaveBeenCalledWith("e1");
    await waitFor(() => expect(lastDoc(onChange).content?.some((n) => n.type === "evidence")).toBe(false));
    // jsdom's navigator is not a Mac, so Mod-z is Ctrl-z here (⌘Z in the app).
    act(() => {
      fireEvent.keyDown(view.dom, { key: "z", code: "KeyZ", keyCode: 90, ctrlKey: true });
    });
    await waitFor(() => expect(lastDoc(onChange).content?.[0]).toMatchObject({ type: "evidence", attrs: { entryId: "e1" } }));
  });
});

describe("ReportEditor moving blocks and helpers", () => {
  it("Alt-ArrowDown and Alt-ArrowUp move the selected block by one", async () => {
    const { onChange, editor } = setup(doc(ev("e1"), slot("a"), slot("b")));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    act(() => {
      fireEvent.keyDown(view.dom, { key: "ArrowDown", code: "ArrowDown", keyCode: 40, altKey: true });
    });
    await waitFor(() => expect(lastDoc(onChange).content?.map((n) => n.type)).toEqual(["slot", "evidence", "slot"]));
    act(() => {
      fireEvent.keyDown(view.dom, { key: "ArrowUp", code: "ArrowUp", keyCode: 38, altKey: true });
    });
    await waitFor(() => expect(lastDoc(onChange).content?.map((n) => n.type)).toEqual(["evidence", "slot", "slot"]));
  });

  it("inserts evidence after the cursor's block, sets its attrs and removes it", async () => {
    const { onChange, editor } = setup(doc(slot("a"), slot("b")));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))));
    act(() => {
      insertEvidenceAtCursor(editor(), { entryId: "e1", block: 0, keep: null, emphasis: [], appendix: "inline" });
    });
    await waitFor(() => expect(lastDoc(onChange).content?.map((n) => n.type)).toEqual(["slot", "evidence", "slot"]));
    const pos = view.state.doc.child(0).nodeSize;
    act(() => {
      setNodeAttrs(editor(), pos, { keep: [[0, 0]] });
    });
    await waitFor(() => expect(lastDoc(onChange).content?.[1].attrs).toMatchObject({ entryId: "e1", keep: [[0, 0]] }));
    act(() => {
      removeNodeAt(editor(), pos);
    });
    await waitFor(() => expect(lastDoc(onChange).content?.map((n) => n.type)).toEqual(["slot", "slot"]));
  });
});

describe("ReportEditor vulnerabilities and exploits", () => {
  const finding = {
    id: "f1",
    title: "Anonymous FTP write",
    severity: "high",
    cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    description: "Anyone can upload.",
    impact: "Code execution.",
    remediation: "Disable anonymous login.\n\nRestrict the upload directory.",
    lessons: "I forgot to check FTP first",
    refs: ["https://example.test/ftp"],
    hostIds: ["h1"],
    serviceIds: [],
    stepEntryIds: [],
  } as unknown as Finding;

  it("renders a vulnerability block without lessons", async () => {
    const { container } = setup(doc({ type: "vuln", attrs: { findingId: "f1" } }), data({ findings: [finding] }));
    expect(await screen.findByText("Anonymous FTP write")).toBeInTheDocument();
    expect(screen.getByText("Severity: High (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H)")).toBeInTheDocument();
    expect(screen.getByText("Disable anonymous login.")).toBeInTheDocument();
    expect(screen.getByText("Restrict the upload directory.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("I forgot to check FTP first");
  });

  it("marks lines a modified exploit added to its original", async () => {
    const file = {
      id: "x1",
      findingId: "f1",
      name: "exploit.py",
      content: "import os\nTARGET = '10.0.0.5'\nrun()",
      modified: true,
      originalUrl: "https://www.exploit-db.com/exploits/1",
      originalContent: "import os\nrun()",
    } as unknown as FindingFile;
    const { container } = setup(
      doc({ type: "exploit", attrs: { fileId: "x1", markedLines: [], appendix: "inline" } }),
      data({ findings: [finding], findingFiles: [file] }),
    );
    await waitFor(() => expect(container.querySelector('[data-diff="add"]')).toHaveTextContent("TARGET = '10.0.0.5'"));
    expect(container.querySelectorAll('[data-diff="add"]')).toHaveLength(1);
    expect(screen.getByText("https://www.exploit-db.com/exploits/1", { exact: false })).toBeInTheDocument();
  });

  it("marks changed lines by hand when there is no original", async () => {
    const file = { id: "x1", findingId: "f1", name: "x.py", content: "a\nb", modified: true, originalUrl: null, originalContent: null } as unknown as FindingFile;
    const { container, onChange } = setup(
      doc({ type: "exploit", attrs: { fileId: "x1", markedLines: [], appendix: "inline" } }),
      data({ findings: [finding], findingFiles: [file] }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Mark line 2 as changed" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs).toMatchObject({ markedLines: [1] }));
    expect(container.querySelector('[data-diff="add"]')).toHaveTextContent("b");
  });
});
