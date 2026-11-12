import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NodeSelection, TextSelection } from "prosekit/pm/state";
import { useMemo, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "prosekit/core";
import { numberAppendices, type AppendixIndex, type ReportData, type ReportNode } from "../engines/report";
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

function setup(page: ReportNode, d: ReportData = data(), appendix: AppendixIndex = noRefs, figureOffset?: number) {
  const onChange = vi.fn();
  const onRemoveEvidence = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <ReportDataContext.Provider value={{ data: d, appendix, sectionMeta: {}, onRemoveEvidence, figureOffset }}>
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

  it("uses the machine name as the prompt when it is not one of the attacker's machines", async () => {
    const { container } = setup(doc(ev("e1")), data({ log: [entry({ ranOn: "kali-target" })] }));
    await waitFor(() => expect(container.querySelector(".report-cmd")).toHaveTextContent("kali-target$ nmap"));
  });

  it("lists the exam restrictions only for exam-sim engagements", async () => {
    const g: ReportNode = { type: "generated", attrs: { kind: "engagement-details", hostId: null, appendix: "inline" } };
    setup(doc(g));
    expect(await screen.findByText("Restrictions")).toBeInTheDocument();
    cleanup();
    setup(doc(g), data({ engagement: { id: "eng", kind: "lab" } as ReportData["engagement"] }));
    expect(await screen.findByText("Accounts created")).toBeInTheDocument();
    expect(screen.queryByText("Restrictions")).toBeNull();
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

  const shot = (id: string, caption: string) =>
    entry({ id, kind: "screenshot", content: { kind: "screenshot", attachmentId: "a1", caption, fileName: "x.png" } });

  it("numbers screenshot captions across the section", async () => {
    const d = data({ log: [shot("s1", "Login page"), shot("s2", "Admin panel")] });
    setup(doc(ev("s1", { block: null }), slot(), ev("s2", { block: null })), d);
    expect(await screen.findByText("Figure 1. Login page")).toBeInTheDocument();
    expect(screen.getByText("Figure 2. Admin panel")).toBeInTheDocument();
  });

  it("skips moved screenshots when numbering, so figures have no gaps", async () => {
    const d = data({ log: [shot("s1", "One"), shot("s2", "Two"), shot("s3", "Three")] });
    setup(doc(ev("s1", { block: null }), ev("s2", { block: null, appendix: "moved" }), ev("s3", { block: null })), d);
    expect(await screen.findByText("Figure 1. One")).toBeInTheDocument();
    expect(screen.getByText("Figure 2. Three")).toBeInTheDocument();
  });

  it("continues figure numbers from the sections before", async () => {
    setup(doc(ev("s1", { block: null })), data({ log: [shot("s1", "Login page")] }), noRefs, 4);
    expect(await screen.findByText("Figure 5. Login page")).toBeInTheDocument();
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

  it("inserts after a selected block and never replaces it", async () => {
    const { onChange, editor } = setup(doc(ev("e1"), slot("a")));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    act(() => {
      insertEvidenceAtCursor(editor(), { entryId: "e2", block: 0, keep: null, emphasis: [], appendix: "inline" });
    });
    await waitFor(() =>
      expect(lastDoc(onChange).content?.map((n) => n.attrs?.entryId ?? n.type)).toEqual(["e1", "e2", "slot"]),
    );
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

/** The editor with its appendix index recomputed from the live page, as the Report view does. */
function setupLive(page: ReportNode, d: ReportData = data()) {
  const onChange = vi.fn();
  const onRemoveEvidence = vi.fn();
  const onImageWidth = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  function Live() {
    const [current, setCurrent] = useState(page);
    const appendix = useMemo(
      () =>
        numberAppendices([{ id: "s1", kind: "target", targetKey: "h1", doc: current }], (n) => d.log.find((e) => e.id === n.attrs?.entryId)?.title ?? "Evidence"),
      [current],
    );
    return (
      <ReportDataContext.Provider value={{ data: d, appendix, sectionMeta: {}, onRemoveEvidence, onImageWidth }}>
        <ReportEditor
          sectionId="s1"
          doc={page}
          onChange={(doc) => {
            setCurrent(doc);
            onChange(doc);
          }}
          onReady={(e) => (ref.editor = e)}
        />
      </ReportDataContext.Provider>
    );
  }
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <Live />
    </QueryClientProvider>,
  );
  return { ...utils, onChange, onRemoveEvidence, onImageWidth, editor: () => ref.editor! };
}

/** Selects the page's top-level block at `index`, as clicking it does. */
function selectBlock(editor: Editor, index: number) {
  const view = editor.view;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += view.state.doc.child(i).nodeSize;
  fireEvent.pointerDown(view.dom);
  act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))));
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
const longEntry = (id: string, title: string, n: number) =>
  entry({ id, title, content: { kind: "command", blocks: [{ command: `cat ${id}`, output: lines(n) }] } });

describe("ReportEditor block tools", () => {
  it("shows no tools on ProseMirror's default selection until the owner clicks into the page", async () => {
    const { editor } = setupLive(doc(ev("e1"), slot()));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    await screen.findByText("22/tcp open ssh", { normalizer: (t) => t.replace(/\s+/g, " ") });
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    fireEvent.pointerDown(view.dom);
    expect(await screen.findByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("trims by clicking line numbers: shift-click keeps a range, and the page shows what was omitted", async () => {
    const d = data({ log: [longEntry("e1", "Big file", 12)] });
    const { onChange, editor, container } = setupLive(doc(ev("e1"), slot()), d);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Trim" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep line 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep line 5" }), { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Keep line 8" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toEqual([[2, 4], [7, 7]]));
    fireEvent.click(screen.getByRole("button", { name: "Trim" }));
    await waitFor(() => expect(container.querySelectorAll(".report-line")).toHaveLength(4));
    expect(screen.getAllByText("… 2 lines omitted")).toHaveLength(2);
    expect(screen.getByText("… 4 lines omitted")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Trim" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep all" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toBeNull());
  });

  it("emphasises lines by clicking their numbers", async () => {
    const d = data({ log: [longEntry("e1", "Big file", 4)] });
    const { onChange, editor } = setupLive(doc(ev("e1")), d);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Emphasise lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Emphasise line 2" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.emphasis).toEqual([1]));
    expect(screen.getByText("line 1")).toHaveAttribute("data-emphasis", "true");
  });

  it("moves a block to the appendix, leaving its reference, and renumbers when an earlier block moves", async () => {
    const d = data({ log: [longEntry("e1", "Full port scan", 3), longEntry("e2", "Web scan", 3)] });
    const { editor } = setupLive(doc(ev("e2"), slot(), ev("e1"), slot()), d);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 2);
    fireEvent.click(await screen.findByRole("button", { name: "Move to appendix" }));
    expect(await screen.findByText("Full output: Appendix E.1, Full port scan")).toBeInTheDocument();
    expect(screen.queryByText("cat e1")).toBeNull();

    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Move to appendix" }));
    expect(await screen.findByText("Full output: Appendix E.1, Web scan")).toBeInTheDocument();
    expect(screen.getByText("Full output: Appendix E.2, Full port scan")).toBeInTheDocument();
  });

  it("split keeps the trimmed lines inline with the reference after them; a third press brings it back inline", async () => {
    const d = data({ log: [longEntry("e1", "Full port scan", 3)] });
    const { onChange, editor } = setupLive(doc(ev("e1", { keep: [[0, 0]] })), d);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Move to appendix" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trimmed here, full output in the appendix" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.appendix).toBe("split"));
    expect(screen.getByText("line 0")).toBeInTheDocument();
    expect(screen.getByText("… 2 lines omitted")).toBeInTheDocument();
    expect(screen.getByText("Full output: Appendix E.1, Full port scan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back inline" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.appendix).toBe("inline"));
    expect(screen.queryByText(/Full output: Appendix/)).toBeNull();
  });

  it("removes a block with its Remove button, as Backspace does", async () => {
    const { onChange, onRemoveEvidence, editor } = setupLive(doc(ev("e1"), slot()));
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(onRemoveEvidence).toHaveBeenCalledWith("e1");
    await waitFor(() => expect(lastDoc(onChange).content?.map((n) => n.type)).toEqual(["slot"]));
  });

  it("moves a generated table to the appendix", async () => {
    const g: ReportNode = { type: "generated", attrs: { kind: "tools", hostId: null, appendix: "inline" } };
    const { onChange, editor } = setupLive(doc(g));
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Move to appendix" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.appendix).toBe("moved"));
    expect(await screen.findByText("Full list: Appendix E.1, Evidence")).toBeInTheDocument();
  });

  it("reports a screenshot's natural width once its image loads", async () => {
    const d = data({ log: [entry({ id: "s1", kind: "screenshot", content: { kind: "screenshot", attachmentId: "a1", caption: "Login", fileName: "x.png" } })] });
    const { onImageWidth, container } = setupLive(doc(ev("s1", { block: null })), d);
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    const img = container.querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: 420 });
    fireEvent.load(img);
    expect(onImageWidth).toHaveBeenCalledWith("s1", 420);
  });
});
