import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NodeSelection, TextSelection } from "prosekit/pm/state";
import { useMemo, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "prosekit/core";
import {
  numberAppendices,
  REPRODUCE_LABEL,
  STEP_HINT,
  subsectionNumbers,
  targetHeadings,
  type AppendixIndex,
  type ReportData,
  type ReportNode,
} from "../engines/report";
import { insertIntoCurrentStep } from "../features/report/editor/commands";
import { ReportDataContext } from "../features/report/editor/ReportDataContext";
import {
  insertAdded,
  insertEvidenceAtCursor,
  insertNodesAt,
  removeExact,
  removeNodeAt,
  ReportEditor,
  setNodeAttrs,
} from "../features/report/editor/ReportEditor";
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
    credentials: [], credAttempts: [],
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

  it("shows the shell a pasted block ran in as its prompt", async () => {
    const blocks = [
      { command: "evil-winrm -i 10.0.0.5 -u bob -p x", output: "Evil-WinRM shell v3.5", shell: "kali@kali" },
      { command: "whoami", output: "corp\\bob", shell: "evil-winrm" },
      { command: "hostname", output: "DC01", shell: "powershell" },
      { command: "id", output: "uid=0", shell: "sh" },
      { command: "whoami", output: "nt authority\\system", shell: "cmd" },
      { command: "id", output: "uid=0(root)", shell: "root@web01" },
      { command: "id", output: "uid=1000(dev)", shell: "dev@web01" },
    ];
    const { container } = setup(doc(ev("e1", { block: null })), data({ log: [entry({ content: { kind: "command", blocks } })] }));
    await waitFor(() => expect(container.querySelectorAll(".report-cmd")).toHaveLength(7));
    // The attacker's machines come from Settings, so the entry's own prompt settles once they load.
    await waitFor(() => expect(container.querySelectorAll(".report-cmd")[3]).toHaveTextContent("kali$ id"));
    expect([...container.querySelectorAll(".report-cmd")].map((n) => n.textContent)).toEqual([
      // The attacker's own shell reads as the entry prompt does ("Kali (VM)" in Settings names kali).
      "kali$ evil-winrm -i 10.0.0.5 -u bob -p x",
      "*Evil-WinRM* PS> whoami",
      "PS> hostname",
      // A plain shell prompt says nothing more than the entry's machine.
      "kali$ id",
      "C:\\> whoami",
      "root@web01# id",
      "dev@web01$ id",
    ]);
  });

  it("ends a root block's prompt in #: a bare # prompt, or root output with no prompt captured", async () => {
    const blocks = [
      { command: "sudo rsync -e sh 127.0.0.1:/dev/null", output: "", shell: "svc_backup@xfer03" },
      { command: "id", output: "uid=0(root) gid=0(root)", shell: "sh", root: true as const },
      { command: "whoami", output: "nt authority\\system" },
      { command: "whoami", output: "dev" },
      { command: "ls -l /etc", output: "drwxr-xr-x 2 root root 4096 x\nroot" },
      { command: "sudo id", output: "uid=0(root) gid=0(root)" },
    ];
    const { container } = setup(doc(ev("e1", { block: null })), data({ log: [entry({ ranOn: "xfer03", content: { kind: "command", blocks } })] }));
    await waitFor(() => expect(container.querySelectorAll(".report-cmd")).toHaveLength(6));
    expect([...container.querySelectorAll(".report-cmd")].map((n) => n.textContent)).toEqual([
      "svc_backup@xfer03$ sudo rsync -e sh 127.0.0.1:/dev/null",
      "xfer03# id",
      "xfer03# whoami",
      "xfer03$ whoami",
      // A bare "root" line with no whoami is a listing, not a root shell.
      "xfer03$ ls -l /etc",
      "xfer03# sudo id",
    ]);
  });

  it("captions an uncaptioned screenshot with the step it tags along with", async () => {
    const shot = entry({ id: "s1", kind: "screenshot", title: "Screenshot", content: { kind: "screenshot", attachmentId: "a1", caption: "", fileName: "x.png" } });
    const { container } = setup(doc(ev("e1"), ev("s1", { block: null })), data({ log: [entry({}), shot] }));
    await waitFor(() => expect(container.querySelector(".report-figure figcaption")).toBeTruthy());
    const caption = container.querySelector<HTMLInputElement>(".report-figure .report-caption-input");
    expect(caption?.value ?? container.querySelector(".report-figure figcaption")?.textContent).toBe("Full port scan");
  });

  it("keeps the fallback caption true after the blocks above change, and never shows a private step's title", async () => {
    const shot = entry({ id: "s1", kind: "screenshot", title: "Screenshot", content: { kind: "screenshot", attachmentId: "a1", caption: "", fileName: "x.png" } });
    const login = entry({ id: "e2", title: "Login page" });
    const { container, editor } = setup(doc(ev("e2"), ev("e1"), ev("s1", { block: null })), data({ log: [login, entry({}), shot] }));
    const caption = () => container.querySelector<HTMLInputElement>(".report-figure .report-caption-input")?.value;
    await waitFor(() => expect(caption()).toBe("Full port scan"));
    // The step it tagged along with is removed: it now follows the login page.
    act(() => void removeNodeAt(editor(), editor().state.doc.child(0).nodeSize));
    await waitFor(() => expect(caption()).toBe("Login page"));
    cleanup();
    const hidden = setup(doc(ev("e1"), ev("s1", { block: null })), data({ log: [entry({ private: true }), shot] }));
    await waitFor(() => expect(hidden.container.querySelector(".report-figure")).toBeTruthy());
    expect(hidden.container.textContent).not.toContain("Full port scan");
    expect(hidden.container.querySelector<HTMLInputElement>(".report-caption-input")?.value).not.toBe("Full port scan");
  });

  it("marks text copied from an entry that is now private or deleted in amber, and only those", async () => {
    const para = (fromEntry: string, text: string): ReportNode => ({ type: "paragraph", attrs: { fromEntry }, content: [{ type: "text", text }] });
    const code: ReportNode = { type: "codeBlock", attrs: { language: "", fromEntry: "e1" }, content: [{ type: "text", text: "whoami" }] };
    const hidden = entry({ id: "n1", kind: "note", private: true, content: { kind: "note", text: "kept" } });
    const { container } = setup(doc(para("n1", "now private"), para("n9", "deleted note"), para("e1", "still here"), code), data({ log: [hidden, entry({})] }));
    await waitFor(() => expect(container.querySelector("[data-source-gone]")).toBeTruthy());
    const marked = [...container.querySelectorAll("[data-source-gone]")].map((el) => [el.getAttribute("data-source-gone"), el.textContent]);
    expect(marked).toEqual([
      ["private", "now private"],
      ["deleted", "deleted note"],
    ]);
  });

  it("lists the references of findings on the report's targets only", async () => {
    const web = { ...host, id: "h2", name: "WEB09", ip: "10.0.0.9" } as Host;
    const finding = (id: string, o: Record<string, unknown>) => ({ id, title: id, hostIds: [], serviceIds: [], refs: [], ...o }) as unknown as Finding;
    const flagged = entry({ id: "fl", kind: "flag", content: { kind: "flag", flagKind: "local", value: "x" } });
    const d = data({
      engagement: { id: "eng", kind: "lab" } as never,
      hosts: [host, web],
      services: [{ id: "sv", hostId: "h1", port: 80, protocol: "tcp" }] as never,
      log: [flagged],
      findings: [
        finding("f1", { hostIds: ["h1"], refs: ["https://ref.example/on-target"] }),
        finding("f2", { hostIds: ["h2"], refs: ["https://ref.example/off-report"] }),
        finding("f3", { serviceIds: ["sv"], refs: ["https://ref.example/by-service"] }),
      ],
    });
    const { container } = setup(doc({ type: "generated", attrs: { kind: "references", hostId: null, appendix: "inline" } }), d);
    await waitFor(() => expect(container.textContent).toContain("https://ref.example/on-target"));
    expect(container.textContent).toContain("https://ref.example/by-service");
    expect(container.textContent).not.toContain("off-report");
  });

  it("prints Methodologies' facts: the exam network, the Metasploit target and the cleanup list", async () => {
    const gen = (kind: string): ReportNode => ({ type: "generated", attrs: { kind, hostId: null, appendix: "inline" } });
    const msf = entry({ id: "m1", content: { kind: "command", blocks: [{ command: "msfconsole -q\nuse exploit/windows/smb/ms17_010_eternalblue", output: "" }] } });
    const d = data({
      log: [msf],
      cleanup: [
        { id: "c1", hostId: "h1", kind: "file", target: "C:\\Users\\Public\\shell.exe", status: "removed" },
        { id: "c2", hostId: "h1", kind: "account", target: "backdoor", status: "dismissed" },
      ] as never,
    });
    const { container } = setup(doc(gen("scope"), gen("msf"), gen("cleanup")), d);
    await waitFor(() => expect(container.textContent).toContain("Exam network: 10.0.0.5"));
    expect(screen.getByText("Metasploit was used on DC01 (10.0.0.5): exploit/windows/smb/ms17_010_eternalblue.")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\Public\\shell.exe on DC01 (file, removed)")).toBeInTheDocument();
    cleanup();
    setup(doc(gen("cleanup")), data({ cleanup: [] }));
    expect(await screen.findByText("No clean-up items recorded.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("backdoor");
    cleanup();
    setup(doc(gen("msf")), data({ log: [] }));
    expect(await screen.findByText("Metasploit was not used.")).toBeInTheDocument();
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
      entries: [{ key: "s1:1", letter: "A", n: 2, title: "Full port scan", sectionId: "s1" }],
      refFor: (key) => (key === "s1:1" ? "A.2" : null),
    };
    const { container } = setup(doc(slot(), ev("e1", { appendix: "moved" })), data(), appendix);
    expect(await screen.findByText("Full output: Appendix A.2, Full port scan")).toBeInTheDocument();
    expect(container.querySelector(".report-cmd")).toBeNull();
  });

  const shot = (id: string, caption: string) =>
    entry({ id, kind: "screenshot", content: { kind: "screenshot", attachmentId: "a1", caption, fileName: "x.png" } });

  it("numbers screenshot captions across the section", async () => {
    const d = data({ log: [shot("s1", "Login page"), shot("s2", "Admin panel")] });
    setup(doc(ev("s1", { block: null }), slot(), ev("s2", { block: null })), d);
    expect(await screen.findByLabelText("Figure 1 caption")).toHaveValue("Login page");
    expect(screen.getByLabelText("Figure 2 caption")).toHaveValue("Admin panel");
  });

  it("skips moved screenshots when numbering, so figures have no gaps", async () => {
    const d = data({ log: [shot("s1", "One"), shot("s2", "Two"), shot("s3", "Three")] });
    setup(doc(ev("s1", { block: null }), ev("s2", { block: null, appendix: "moved" }), ev("s3", { block: null })), d);
    expect(await screen.findByLabelText("Figure 1 caption")).toHaveValue("One");
    expect(screen.getByLabelText("Figure 2 caption")).toHaveValue("Three");
  });

  it("continues figure numbers from the sections before", async () => {
    setup(doc(ev("s1", { block: null })), data({ log: [shot("s1", "Login page")] }), noRefs, 4);
    expect(await screen.findByLabelText("Figure 5 caption")).toHaveValue("Login page");
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

  it("prints the sample's labelled lines, and no lessons", async () => {
    const { container } = setup(doc({ type: "vuln", attrs: { findingId: "f1" } }), data({ findings: [finding] }));
    const line = (label: string) => [...container.querySelectorAll(".report-vuln p")].find((p) => p.textContent?.startsWith(label));
    await waitFor(() => expect(line("Vulnerability Explanation:")).toBeTruthy());
    expect(line("Vulnerability Explanation:")).toHaveTextContent("Vulnerability Explanation: Anyone can upload.");
    expect(line("Vulnerability Explanation:")?.querySelector("strong")).toHaveTextContent("Vulnerability Explanation:");
    expect(line("Vulnerability Fix:")).toBeTruthy();
    expect(screen.getByText("Disable anonymous login.")).toBeInTheDocument();
    expect(screen.getByText("Restrict the upload directory.")).toBeInTheDocument();
    expect(line("Severity:")).toHaveTextContent("Severity: High (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H)");
    expect(container.innerHTML).not.toContain("I forgot to check FTP first");
  });

  it("renders finding text as Markdown, and an imported Affected line as its own labelled line", async () => {
    const md = {
      ...finding,
      description: "Affected: 22/tcp OpenSSH\n\nThe server takes **password** logins as `root`. See [the manual](https://man.example.test/sshd).\n\n- one\n- two",
      remediation: "Set `PasswordAuthentication no`.",
    } as Finding;
    const { container } = setup(doc({ type: "vuln", attrs: { findingId: "f1" } }), data({ findings: [md] }));
    const line = (label: string) => [...container.querySelectorAll(".report-vuln p")].find((p) => p.textContent?.startsWith(label));
    await waitFor(() => expect(line("Vulnerability Explanation:")).toBeTruthy());
    const explain = line("Vulnerability Explanation:")!;
    expect(explain).toHaveTextContent("Vulnerability Explanation: The server takes password logins as root. See the manual (https://man.example.test/sshd).");
    expect(explain.textContent).not.toMatch(/Affected|\*\*|`/);
    expect(explain.querySelector("code")).toHaveTextContent("root");
    expect([...explain.querySelectorAll("strong")].map((b) => b.textContent)).toEqual(["Vulnerability Explanation:", "password"]);
    expect([...container.querySelectorAll(".report-vuln ul li")].map((li) => li.textContent)).toEqual(["one", "two"]);
    expect(line("Vulnerability Fix:")?.querySelector("code")).toHaveTextContent("PasswordAuthentication no");
    expect(line("Affected:")).toHaveTextContent("Affected: 22/tcp OpenSSH");
    expect(container.innerHTML).not.toContain("**");
  });

  it("renders a fix holding a code block or a table as written, not split into steps", async () => {
    const block = { ...finding, remediation: "Set this in `sshd_config`:\n\n```\nPasswordAuthentication no\nPermitRootLogin no\n```\n\n| Setting | Value |\n| --- | --- |\n| UsePAM | yes |" } as Finding;
    const { container } = setup(doc({ type: "vuln", attrs: { findingId: "f1" } }), data({ findings: [block] }));
    await waitFor(() => expect(container.querySelector(".report-vuln pre")).toBeTruthy());
    expect(container.querySelector(".report-vuln pre")).toHaveTextContent("PasswordAuthentication no PermitRootLogin no");
    expect([...container.querySelectorAll(".report-vuln td")].map((c) => c.textContent)).toEqual(["UsePAM", "yes"]);
    const fix = [...container.querySelectorAll(".report-vuln p")].find((p) => p.textContent?.startsWith("Vulnerability Fix:"));
    expect(fix).toHaveTextContent("Vulnerability Fix: Set this in sshd_config:");
    expect(container.querySelector(".report-vuln")!.innerHTML).not.toContain("```");
  });

  it("puts a one-step fix on the Vulnerability Fix line itself", async () => {
    const one = { ...finding, remediation: "Disable anonymous login." } as Finding;
    const { container } = setup(doc({ type: "vuln", attrs: { findingId: "f1" } }), data({ findings: [one] }));
    await waitFor(() => expect(container.querySelector(".report-vuln")).toBeTruthy());
    const fix = [...container.querySelectorAll(".report-vuln p")].find((p) => p.textContent?.startsWith("Vulnerability Fix:"));
    expect(fix).toHaveTextContent("Vulnerability Fix: Disable anonymous login.");
    expect(container.querySelector(".report-vuln ul")).toBeNull();
  });

  it("prints Steps to reproduce the attack as the slot's bold lead-in", async () => {
    const { container } = setup(doc({ type: "slot", attrs: { hint: "A short summary", label: "Steps to reproduce the attack:" } }));
    await waitFor(() => expect(container.querySelector(".report-slot-text")).toBeTruthy());
    expect(container.querySelector(".report-slot-text")).toHaveAttribute("data-label", "Steps to reproduce the attack:");
    expect(container.querySelector(".report-slot-hint")).toHaveTextContent("Steps to reproduce the attack: A short summary");
  });

  it("lists each fix step a line of its own when a line ends a sentence; a wrapped line stays one step", async () => {
    const steps = { ...finding, remediation: "Upgrade the CMS.\nRemove /backup from the site and\nrotate the admin password." } as Finding;
    setup(doc({ type: "vuln", attrs: { findingId: "f1" } }), data({ findings: [steps] }));
    expect(await screen.findByText("Upgrade the CMS.")).toBeInTheDocument();
    expect(screen.getByText("Remove /backup from the site and rotate the admin password.")).toBeInTheDocument();
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
function setupLive(page: ReportNode, d: ReportData = data(), canMove = true) {
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
      <ReportDataContext.Provider value={{ data: d, appendix, sectionMeta: {}, onRemoveEvidence, onImageWidth, canMove }}>
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

describe("ReportEditor generated blocks", () => {
  const gen = (kind: string): ReportNode => ({ type: "generated", attrs: { kind, hostId: null, appendix: "inline" } });
  const ad = { ...host, id: "h2", name: "dc01", ip: "10.0.0.10", adSetEffective: true } as Host;

  it("closes the AD set with its attack chain", async () => {
    const d = data({
      hosts: [host, ad],
      hops: [{ id: "hp", fromHostId: "h1", toHostId: "h2", via: "Pass the hash", logEntryId: null, at: 1 }] as never,
    });
    setup(doc(gen("attack-chain")), d);
    expect(await screen.findByRole("heading", { name: "Attack Chain" })).toBeInTheDocument();
    expect(screen.getByText("DC01 to dc01 via Pass the hash")).toBeInTheDocument();
  });

  it("prints Port Scan Results as IP Address and Ports Open, one line per protocol", async () => {
    const svc = (port: number, protocol: string, hostId = "h1") => ({ id: `${hostId}-${port}-${protocol}`, hostId, port, protocol });
    const d = data({ services: [svc(80, "tcp"), svc(21, "tcp"), svc(161, "udp"), svc(445, "tcp", "h2")] as never, hosts: [host, ad] });
    const { container } = setup(doc({ type: "generated", attrs: { kind: "port-scan", hostId: "h1", appendix: "inline" } }), d);
    await waitFor(() => expect(container.querySelector(".report-table")).toBeTruthy());
    expect(screen.getByText("Port Scan Results")).toBeInTheDocument();
    expect([...container.querySelectorAll(".report-table th")].map((th) => th.textContent)).toEqual(["IP Address", "Ports Open"]);
    const cells = [...container.querySelectorAll(".report-table tbody td")].map((td) => td.textContent);
    expect(cells).toEqual(["10.0.0.5", "TCP: 21, 80UDP: 161"]);
    expect(container.querySelector(".report-table tbody td strong")).toHaveTextContent("TCP");
  });

  it("prints one Port Scan Results row per machine of the AD set", async () => {
    const svc = (port: number, hostId: string) => ({ id: `${hostId}-${port}`, hostId, port, protocol: "tcp" });
    const ad3 = { ...ad, id: "h3", name: "ms01", ip: "10.0.0.11" } as Host;
    // In attack-path order, the domain controller (Kerberos and LDAP) last: ms01, then dc01.
    const d = data({ hosts: [host, ad, ad3], services: [svc(88, "h2"), svc(389, "h2"), svc(22, "h3")] as never });
    const { container } = setup(doc(gen("port-scan")), d);
    await waitFor(() => expect(container.querySelectorAll(".report-table tbody tr")).toHaveLength(2));
    const rows = [...container.querySelectorAll(".report-table tbody tr")].map((tr) => tr.textContent);
    expect(rows).toEqual(["10.0.0.11TCP: 22", "10.0.0.10TCP: 88, 389"]);
  });

  it("prints Also tested as slim lines, with no commands", async () => {
    const d = data({
      services: [{ id: "s80", hostId: "h1", port: 80, protocol: "tcp" }] as never,
      findings: [{ id: "f1", title: "x", hostIds: ["h1"], serviceIds: ["s80"], refs: [] }] as never,
      attempts: [{ id: "a1", hostId: "h1", findingId: "f1", title: "Apache path traversal", reasonKind: "precondition", reason: "patched", private: false, logEntryId: "e1" }] as never,
    });
    const { container } = setup(doc({ type: "generated", attrs: { kind: "tested", hostId: "h1", appendix: "inline" } }), d);
    expect(await screen.findByText("Apache path traversal on 80: precondition not met: patched")).toBeInTheDocument();
    expect(container.querySelector(".report-code")).toBeNull();
  });

  it("numbers a target page's headings from its document and names the vulnerability that opened a phase", async () => {
    const d = data({ findings: [{ id: "f1", title: "Anonymous FTP write", description: "", remediation: "", hostIds: ["h1"], serviceIds: [], refs: [] }] as never });
    const page = doc(
      { type: "generated", attrs: { kind: "facts", hostId: "h1", appendix: "inline" } },
      { type: "phase", attrs: { phase: "enum", hostId: "h1" } },
      { type: "phase", attrs: { phase: "foothold", hostId: "h1" } },
      { type: "vuln", attrs: { findingId: "f1" } },
      { type: "phase", attrs: { phase: "post", hostId: "h1" } },
    );
    const target = { key: "h1", kind: "standalone" as const, hostIds: ["h1"] };
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <ReportDataContext.Provider
          value={{ data: d, appendix: noRefs, sectionMeta: {}, onRemoveEvidence: vi.fn(), headingsOf: (x) => targetHeadings(x, d, target, "4.2", 2) }}
        >
          <ReportEditor sectionId="s1" title="Independent Challenges" titleNumber="4" doc={page} onChange={vi.fn()} onReady={vi.fn()} />
        </ReportDataContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "4.2Target #2 – 10.0.0.5" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "4.2.1Service Enumeration" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "4.2.2Initial Access – Anonymous FTP write" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "4.2.3Post-Exploitation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "4Independent Challenges" })).toBeInTheDocument();
  });

  it("numbers a report-level page's drafted sub-sections, never a heading the owner added", async () => {
    const h = (text: string): ReportNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
    const page = doc(h("Information Gathering"), h("My own notes"), h("Service Enumeration"));
    const { container } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <ReportDataContext.Provider value={{ data: data(), appendix: noRefs, sectionMeta: {}, onRemoveEvidence: vi.fn() }}>
          <ReportEditor
            sectionId="s1"
            title="Methodologies"
            titleNumber="3"
            subNumbers={(d) => subsectionNumbers("methodology", "3", d)}
            doc={page}
            onChange={vi.fn()}
            onReady={vi.fn()}
          />
        </ReportDataContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findByText("Information Gathering");
    expect([...container.querySelectorAll(".ProseMirror > h2")].map((el) => el.getAttribute("data-number"))).toEqual(["3.1", null, "3.2"]);
  });
});

describe("ReportEditor block tools", () => {
  it("outlines no block on ProseMirror's default selection until the owner clicks into the page", async () => {
    const { editor, container } = setupLive(doc(ev("e1"), slot()));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0))));
    await screen.findByText("22/tcp open ssh", { normalizer: (t) => t.replace(/\s+/g, " ") });
    expect(container.querySelector(".report-block[data-selected]")).toBeNull();
    fireEvent.pointerDown(view.dom);
    await waitFor(() => expect(container.querySelector(".report-block[data-selected]")).not.toBeNull());
  });

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

  it("trims from every line kept: a click cuts one, and leaving trim shows what was omitted", async () => {
    const d = data({ log: [longEntry("e1", "Big file", 12)] });
    const { onChange, editor, container } = setupLive(doc(ev("e1"), slot()), d);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Trim" }));
    expect(screen.getByText("12 of 12 lines kept")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep all" })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Cut line 3" }));
    fireEvent.pointerUp(window);
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toEqual([[0, 1], [3, 11]]));
    expect(screen.getByText("11 of 12 lines kept")).toBeInTheDocument();
    // Clicked again, it comes back.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Keep line 3" }));
    fireEvent.pointerUp(window);
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toBeNull());
    fireEvent.pointerDown(screen.getByRole("button", { name: "Cut line 12" }));
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole("button", { name: "Trim" }));
    await waitFor(() => expect(container.querySelectorAll(".report-line")).toHaveLength(11));
    expect(screen.getByText("… 1 line omitted")).toBeInTheDocument();
  });

  it("cuts a quarter of a 400-line output in one drag down the line numbers", async () => {
    const d = data({ log: [longEntry("e1", "winPEAS", 400)] });
    const { onChange, editor } = setupLive(doc(ev("e1", { keep: null }), slot()), d);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Trim" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Cut line 301" }));
    for (const n of [320, 360, 400]) fireEvent.pointerEnter(screen.getByRole("button", { name: `Cut line ${n}` }));
    fireEvent.pointerUp(window);
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toEqual([[0, 299]]));
    expect(screen.getByText("300 of 400 lines kept")).toBeInTheDocument();
    // A drag that starts on a cut line keeps the run again.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Keep line 391" }));
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Keep line 400" }));
    fireEvent.pointerUp(window);
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toEqual([[0, 299], [390, 399]]));
    // Hovering after the drag ended changes nothing.
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Cut line 2" }));
    expect(lastDoc(onChange).content?.[0].attrs?.keep).toEqual([[0, 299], [390, 399]]);
  });

  it("a shift-click does the same to every line from the last one clicked", async () => {
    const d = data({ log: [longEntry("e1", "Big file", 12)] });
    const { onChange, editor } = setupLive(doc(ev("e1"), slot()), d);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Trim" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Cut line 2" }));
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Cut line 6" }), { shiftKey: true });
    fireEvent.pointerUp(window);
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toEqual([[0, 0], [6, 11]]));
    // The run is picked: keep only it, then keep everything again.
    fireEvent.click(screen.getByRole("button", { name: "Keep only selection" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toEqual([[1, 5]]));
    fireEvent.click(screen.getByRole("button", { name: "Keep all" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toBeNull());
  });

  it("trims from the keyboard: ↓ moves, ⇧↓ extends, ⌫ cuts the run, Space flips it, Esc leaves", async () => {
    const d = data({ log: [longEntry("e1", "Big file", 12)] });
    const { onChange, editor } = setupLive(doc(ev("e1"), slot()), d);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Trim" }));
    const bar = screen.getByRole("toolbar", { name: /^Trim the output/ });
    expect(bar).toHaveFocus();
    const key = (k: string, shiftKey = false) => fireEvent.keyDown(bar, { key: k, shiftKey });
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowDown", true);
    key("ArrowDown", true);
    key("Backspace");
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toEqual([[0, 0], [4, 11]]));
    key(" ");
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.keep).toBeNull());
    key("Escape");
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: /^Trim the output/ })).toBeNull());
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
    expect(await screen.findByText("Full output: Appendix A.1, Full port scan")).toBeInTheDocument();
    expect(screen.queryByText("cat e1")).toBeNull();

    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Move to appendix" }));
    expect(await screen.findByText("Full output: Appendix A.1, Web scan")).toBeInTheDocument();
    expect(screen.getByText("Full output: Appendix A.2, Full port scan")).toBeInTheDocument();
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
    expect(screen.getByText("Full output: Appendix A.1, Full port scan")).toBeInTheDocument();
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
    const g: ReportNode = { type: "generated", attrs: { kind: "tested", hostId: "h1", appendix: "inline" } };
    const { onChange, editor } = setupLive(doc(g));
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Move to appendix" }));
    await waitFor(() => expect(lastDoc(onChange).content?.[0].attrs?.appendix).toBe("moved"));
    expect(await screen.findByText("Full list: Appendix A.1, Evidence")).toBeInTheDocument();
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

  it("stops picking lines when the block is deselected", async () => {
    const d = data({ log: [longEntry("e1", "Big file", 4)] });
    const { editor } = setupLive(doc(ev("e1"), slot()), d);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    fireEvent.click(await screen.findByRole("button", { name: "Trim" }));
    expect(screen.getByRole("button", { name: "Cut line 1" })).toBeInTheDocument();
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.child(0).nodeSize + 1))));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cut line 1" })).toBeNull());
    selectBlock(editor(), 0);
    await screen.findByRole("button", { name: "Trim" });
    expect(screen.queryByRole("button", { name: "Cut line 1" })).toBeNull();
  });

  it("offers no Move to appendix outside target pages", async () => {
    const g: ReportNode = { type: "generated", attrs: { kind: "scope", hostId: null, appendix: "inline" } };
    const { editor } = setupLive(doc(ev("e1"), g), data(), false);
    await waitFor(() => expect(editor()).toBeTruthy());
    selectBlock(editor(), 0);
    expect(await screen.findByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to appendix" })).toBeNull();
    selectBlock(editor(), 1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Move to appendix" })).toBeNull();
  });

  it("names a moved screenshot's reference as a screenshot", async () => {
    const d = data({ log: [entry({ id: "s1", title: "Login page", kind: "screenshot", content: { kind: "screenshot", attachmentId: "a1", caption: "Login", fileName: "x.png" } })] });
    setupLive(doc(ev("s1", { block: null, appendix: "moved" })), d);
    expect(await screen.findByText("Screenshot: Appendix A.1, Login page")).toBeInTheDocument();
  });
});

const step = (...content: ReportNode[]): ReportNode => ({ type: "step", attrs: { entryId: null }, content });
const steps = (...list: ReportNode[]): ReportNode => ({ type: "steps", content: list });
const para = (text: string): ReportNode => ({ type: "paragraph", content: [{ type: "text", text }] });
/** The position of the first node of `type` (the nth with `nth`). */
function posOf(editor: Editor, type: string, nth = 0): number {
  let found = -1;
  let seen = 0;
  editor.state.doc.descendants((n, pos) => {
    if (found !== -1) return false;
    if (n.type.name === type && seen++ === nth) found = pos;
    return true;
  });
  return found;
}
const stepsIn = (d: ReportNode): ReportNode[] => (d.content ?? []).filter((n) => n.type === "steps");

describe("ReportEditor steps", () => {
  it("renders a steps list numbered from 1 and restarting per list", async () => {
    const { container, editor } = setup(doc(steps(step(para("a")), step(para("b"))), slot("between"), steps(step(para("c")))));
    await waitFor(() => expect(container.querySelectorAll(".report-step-num")).toHaveLength(3));
    const numbers = () => [...container.querySelectorAll(".report-step-num")].map((n) => n.textContent);
    expect(numbers()).toEqual(["1", "2", "1"]);
    expect([...container.querySelectorAll(".report-steps-label")].map((n) => n.textContent)).toEqual([REPRODUCE_LABEL, REPRODUCE_LABEL]);
    expect(REPRODUCE_LABEL).toBe("Steps to reproduce");
    // A step added at the top of the first list renumbers the ones after it.
    act(() => {
      insertNodesAt(editor(), [0, 0], [step(para("new"))]);
    });
    await waitFor(() => expect(numbers()).toEqual(["1", "2", "3", "1"]));
  });

  it("+ Step adds an empty step after the current one", async () => {
    const { onChange, editor } = setup(doc(steps(step(para("a")), step(para("b")))));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    // Inside the first step's text.
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(editor(), "paragraph") + 1))));
    fireEvent.click(await screen.findByRole("button", { name: "+ Step" }));
    await waitFor(() => expect(stepsIn(lastDoc(onChange))[0].content).toHaveLength(3));
    const list = stepsIn(lastDoc(onChange))[0].content!;
    expect(list[1]).toEqual({ type: "step", attrs: { entryId: null }, content: [{ type: "slot", attrs: { hint: STEP_HINT, label: "" } }] });
    expect(screen.getByText("Say what this step does")).toBeInTheDocument();
    // The cursor lands in the new step, so ⌘⇧↵ (Ctrl here: jsdom is not a Mac) adds the next one after it.
    act(() => {
      fireEvent.keyDown(view.dom, { key: "Enter", code: "Enter", keyCode: 13, ctrlKey: true, shiftKey: true });
    });
    await waitFor(() => expect(stepsIn(lastDoc(onChange))[0].content).toHaveLength(4));
    expect(stepsIn(lastDoc(onChange))[0].content!.map((s) => s.content?.[0].type)).toEqual(["paragraph", "slot", "slot", "paragraph"]);
  });

  it("⌘⇧↵ outside a step adds one at the end of the nearest list", async () => {
    const { onChange, editor } = setup(doc(steps(step(para("a"))), slot("after")));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(editor(), "slot", 0) + 1))));
    act(() => {
      fireEvent.keyDown(view.dom, { key: "Enter", code: "Enter", keyCode: 13, ctrlKey: true, shiftKey: true });
    });
    await waitFor(() => expect(stepsIn(lastDoc(onChange))[0].content).toHaveLength(2));
    expect(stepsIn(lastDoc(onChange))[0].content![1].content?.[0]).toMatchObject({ type: "slot", attrs: { hint: STEP_HINT } });
  });

  it("backspacing every step of a list leaves a valid document with no empty steps node", async () => {
    const { onChange, editor } = setup(doc(slot("intro"), steps(step(para("a")), step(para("b"))), slot("after")));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    for (let i = 0; i < 2; i++) {
      act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, posOf(editor(), "step")))));
      act(() => {
        fireEvent.keyDown(view.dom, { key: "Backspace", code: "Backspace", keyCode: 8 });
      });
    }
    await waitFor(() => expect(lastDoc(onChange).content?.map((n) => n.type)).toEqual(["slot", "slot"]));
    expect(() => editor().state.doc.check()).not.toThrow();
    let empty = 0;
    editor().state.doc.descendants((n) => void (n.type.name === "steps" && n.childCount === 0 && empty++));
    expect(empty).toBe(0);
  });

  it("dragging the only chip out of a step leaves the step with its sentence", async () => {
    const { onChange, editor } = setup(doc(steps(step(slot(STEP_HINT), ev("e1"))), slot("after")));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    // What a drop does with a moved block: the dragged selection goes, the block lands where it drops.
    act(() => {
      const at = posOf(editor(), "evidence");
      const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, at));
      const moved = (tr.selection as NodeSelection).node;
      tr.deleteSelection();
      tr.insert(tr.doc.content.size, moved);
      view.dispatch(tr);
    });
    await waitFor(() => expect(lastDoc(onChange).content?.map((n) => n.type)).toEqual(["steps", "slot", "evidence"]));
    expect(stepsIn(lastDoc(onChange))[0].content).toEqual([{ type: "step", attrs: { entryId: null }, content: [{ type: "slot", attrs: { hint: STEP_HINT, label: "" } }] }]);
    expect(() => editor().state.doc.check()).not.toThrow();
  });

  it("insertIntoCurrentStep returns null when the selection is in a heading or table cell", async () => {
    const table: ReportNode = {
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [para("cell")] }] }],
    };
    const { onChange, editor } = setup(doc({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] }, table, steps(step(para("a")))));
    await waitFor(() => expect(editor()).toBeTruthy());
    const view = editor().view;
    const made = [view.state.schema.nodeFromJSON(ev("e1"))];
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2))));
    expect(insertIntoCurrentStep(view.state, made)).toBeNull();
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(editor(), "paragraph", 0) + 2))));
    expect(view.state.selection.$from.parent.textContent).toBe("cell");
    expect(insertIntoCurrentStep(view.state, made)).toBeNull();
    act(() => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOf(editor(), "paragraph", 1) + 1))));
    const command = insertIntoCurrentStep(view.state, made);
    expect(command).not.toBeNull();
    act(() => void editor().exec(command!));
    await waitFor(() => expect(stepsIn(lastDoc(onChange))[0].content?.[0].content?.map((n) => n.type)).toEqual(["paragraph", "evidence"]));
  });
});

describe("ReportEditor nested insertion helpers", () => {
  it("Add new evidence's insertAdded fills a nested steps list, and removeExact (its Undo) takes exactly those off", async () => {
    const before = doc(slot("intro"), steps(step(slot(STEP_HINT), ev("e1")), step(para("own"))));
    const { onChange, editor } = setup(before);
    await waitFor(() => expect(editor()).toBeTruthy());
    const after = doc(
      slot("intro"),
      steps(step(slot(STEP_HINT), ev("e1"), ev("e2")), step(para("own")), { type: "step", attrs: { entryId: "e3" }, content: [slot(STEP_HINT), ev("e3")] }),
    );
    let added: ReturnType<typeof insertAdded> = [];
    act(() => {
      added = insertAdded(editor(), before, after);
    });
    expect(added.map((n) => n.type.name)).toEqual(["evidence", "step"]);
    await waitFor(() => expect(lastDoc(onChange)).toEqual(editor().getDocJSON()));
    expect(JSON.parse(JSON.stringify(stepsIn(lastDoc(onChange))[0].content!.map((s) => s.content!.map((n) => n.attrs?.entryId ?? n.type))))).toEqual([
      ["slot", "e1", "e2"],
      ["paragraph"],
      ["slot", "e3"],
    ]);
    act(() => {
      removeExact(editor(), added);
    });
    await waitFor(() => expect(stepsIn(lastDoc(onChange))[0].content).toHaveLength(2));
    expect(stepsIn(lastDoc(onChange))[0].content!.map((s) => s.content!.map((n) => n.attrs?.entryId ?? n.type))).toEqual([["slot", "e1"], ["paragraph"]]);
  });

  it("removeExact leaves an added step the owner has since edited", async () => {
    const before = doc(steps(step(para("own"))));
    const { onChange, editor } = setup(before);
    await waitFor(() => expect(editor()).toBeTruthy());
    let added: ReturnType<typeof insertAdded> = [];
    act(() => {
      added = insertAdded(editor(), before, doc(steps(step(para("own")), step(slot(STEP_HINT)))));
    });
    const view = editor().view;
    act(() => view.dispatch(view.state.tr.insertText("Typed", posOf(editor(), "slot") + 1)));
    act(() => {
      expect(removeExact(editor(), added)).toBe(false);
    });
    await waitFor(() => expect(stepsIn(lastDoc(onChange))[0].content).toHaveLength(2));
  });

  it("the rail's insertNodesAt puts a step into a nested list at its path, and refuses a path past the end", async () => {
    const { onChange, editor } = setup(doc(slot("intro"), steps(step(para("a")), step(para("b")))));
    await waitFor(() => expect(editor()).toBeTruthy());
    act(() => {
      expect(insertNodesAt(editor(), [1, 1], [{ type: "step", attrs: { entryId: "e1" }, content: [slot(STEP_HINT), ev("e1")] }])).toBe(true);
    });
    await waitFor(() => expect(stepsIn(lastDoc(onChange))[0].content?.map((s) => s.attrs?.entryId)).toEqual([null, "e1", null]));
    act(() => {
      expect(insertNodesAt(editor(), [1, 0, 1], [ev("e2")])).toBe(true);
    });
    await waitFor(() => expect(stepsIn(lastDoc(onChange))[0].content?.[0].content?.map((n) => n.attrs?.entryId ?? n.type)).toEqual(["paragraph", "e2"]));
    expect(insertNodesAt(editor(), [1, 5], [step(para("x"))])).toBe(false);
  });
});
