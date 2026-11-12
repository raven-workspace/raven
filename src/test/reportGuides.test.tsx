import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "prosekit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportData, ReportNode } from "../engines/report";
import { GUIDES, guideFor, sectionGuide, type GuideId } from "../engines/report/guides";
import { ReportDataContext } from "../features/report/editor/ReportDataContext";
import { ReportEditor } from "../features/report/editor/ReportEditor";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { SectionKind } from "../types/report";
import type { Settings } from "../types/settings";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const settings = (reportGuidesHidden: string[] = []) => ({ machines: ["Kali (VM)"], reportGuidesHidden }) as unknown as Settings;

const data = {
  engagement: { id: "eng", kind: "exam-sim" },
  hosts: [{ id: "h1", name: "DC01", ip: "10.0.0.5", os: "windows", access: "root", adSetEffective: false }],
  services: [],
  log: [],
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
  credAttempts: [],
} as unknown as ReportData;

const ports: ReportNode = { type: "generated", attrs: { kind: "ports", hostId: "h1", appendix: "inline", notes: {} } };
const vuln = (findingId = "f1"): ReportNode => ({ type: "vuln", attrs: { findingId } });
const para = (text: string): ReportNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string): ReportNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });

function setup(page: ReportNode, sectionKind: SectionKind = "target") {
  const onChange = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <ReportDataContext.Provider value={{ data, appendix: { entries: [], refFor: () => null }, sectionMeta: {}, onRemoveEvidence: vi.fn() }}>
        <ReportEditor sectionId="s1" sectionKind={sectionKind} doc={page} onChange={onChange} onReady={(e) => (ref.editor = e)} />
      </ReportDataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, onChange, editor: () => ref.editor! };
}

const note = (id: GuideId) => screen.findByRole("note", { name: GUIDES[id].title });

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue(settings());
  m.settingsUpdate.mockImplementation(async (patch) => ({ ...settings(), ...patch }) as Settings);
});

describe("guide catalog", () => {
  it("keeps every note to one to three short sentences of fixed text", () => {
    for (const [id, g] of Object.entries(GUIDES)) {
      expect(g.title, id).not.toBe("");
      const sentences = g.body.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, id).toBeGreaterThanOrEqual(1);
      expect(sentences.length, id).toBeLessThanOrEqual(3);
      // Never wording to copy: no quoted report sentences.
      expect(g.body, id).not.toMatch(/["“”]/);
    }
  });

  it("uses the brief's words where it gives them", () => {
    expect(GUIDES.ports.body).toBe("Keep the ports that mattered and say why in Notes. The scan itself is in the log column if you want to show it.");
    expect(GUIDES.vuln.body).toBe("Explain why the flaw works in neutral, third-person voice: what the software does wrong and what that lets anyone do.");
    expect(GUIDES.exploit.body).toBe("List every change you made to a public exploit and why. The diff marks the lines; you explain them.");
    expect(GUIDES.tested.body).toBe("What you tried that didn't work. It shows a reader the coverage. Operator mistakes stay private.");
  });

  it("matches each part to its guide", () => {
    const gen = (kind: string): ReportNode => ({ type: "generated", attrs: { kind, hostId: "h1", appendix: "inline" } });
    const phase = (p: string, findingId: string | null = null): ReportNode => ({ type: "phase", attrs: { phase: p, hostId: "h1", findingId } });
    expect(guideFor(gen("ports"), "target")).toBe("ports");
    expect(guideFor(gen("result"), "target")).toBe("result");
    expect(guideFor(gen("findings"), "summary")).toBe("findings-table");
    expect(guideFor(gen("attack-path"), "ad")).toBe("attack-path");
    expect(guideFor(gen("tested"), "engagement-tested")).toBe("tested");
    // On a machine the Also tested heading carries it, not its table too.
    expect(guideFor(gen("tested"), "target")).toBeNull();
    expect(guideFor(phase("tested"), "target")).toBe("tested");
    expect(guideFor(phase("post"), "target")).toBe("post");
    expect(guideFor(phase("additional"), "target")).toBe("additional");
    expect(guideFor(phase("additional", "f1"), "target")).toBeNull();
    expect(guideFor(phase("foothold"), "target")).toBeNull();
    expect(guideFor(vuln(), "target")).toBe("vuln");
    expect(guideFor({ type: "steps", content: [] }, "target")).toBe("steps");
    expect(guideFor({ type: "exploit", attrs: { fileId: "x" } }, "target")).toBe("exploit");
    expect(guideFor(heading("Introduction"), "introduction")).toBe("introduction");
    expect(guideFor(heading("Scope"), "introduction")).toBe("scope");
    expect(guideFor(heading("Recommendations"), "summary")).toBe("recommendations");
    expect(guideFor(heading("House Cleaning"), "methodology")).toBe("house-cleaning");
    expect(guideFor(heading("Scope"), "summary")).toBeNull();
    expect(guideFor(para("Introduction"), "introduction")).toBeNull();
    expect(sectionGuide("summary")).toBe("summary");
    expect(sectionGuide("considerations")).toBe("considerations");
    expect(sectionGuide("methodology")).toBe("methodology");
    expect(sectionGuide("page", "appendix")).toBe("appendix");
    expect(sectionGuide("page", "body")).toBe("page");
    expect(sectionGuide("target")).toBeNull();
  });
});

describe("guide notes on the page", () => {
  it("shows the ports guide above a ports table, never in the document", async () => {
    const page = doc(ports, para("After"));
    const { editor, container } = setup(page);
    const shown = await note("ports");
    expect(shown).toHaveTextContent(GUIDES.ports.body);
    // Above the table it guides.
    const table = container.querySelector('[data-block="generated"], [data-report="generated"]') ?? container.querySelector(".ProseMirror > :not(.report-guide-slot)");
    expect(table).toBeTruthy();
    expect(shown.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Chrome only: not saved, so not copied or exported.
    expect((editor().getDocJSON() as ReportNode).content?.map((n) => n.type)).toEqual(["generated", "paragraph"]);
    expect(JSON.stringify(editor().getDocJSON())).not.toContain("Keep the ports");
  });

  it("Hide this note hides it and saves its id", async () => {
    const user = userEvent.setup();
    setup(doc(ports, vuln()));
    const shown = await note("ports");
    await user.click(within(shown).getByRole("button", { name: "Hide this note" }));
    expect(m.settingsUpdate).toHaveBeenCalledWith({ reportGuidesHidden: ["ports"] });
    await waitFor(() => expect(screen.queryByRole("note", { name: GUIDES.ports.title })).not.toBeInTheDocument());
    expect(screen.getByRole("note", { name: GUIDES.vuln.title })).toBeInTheDocument();
  });

  it("Hide all guide notes saves *", async () => {
    const user = userEvent.setup();
    setup(doc(ports, vuln()));
    const shown = await note("ports");
    await user.click(within(shown).getByRole("button", { name: "Hide all guide notes" }));
    expect(m.settingsUpdate).toHaveBeenCalledWith({ reportGuidesHidden: ["*"] });
    await waitFor(() => expect(screen.queryAllByRole("note")).toHaveLength(0));
  });

  it("leaves hidden notes out, and * leaves them all out", async () => {
    m.settingsGet.mockResolvedValue(settings(["ports"]));
    setup(doc(ports, vuln()));
    await note("vuln");
    expect(screen.queryByRole("note", { name: GUIDES.ports.title })).not.toBeInTheDocument();
  });

  it("shows nothing when every note is hidden", async () => {
    m.settingsGet.mockResolvedValue(settings(["*"]));
    const { container } = setup(doc(ports, vuln()));
    await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryAllByRole("note")).toHaveLength(0);
  });

  it("shows each guide once on a page", async () => {
    setup(doc(vuln("f1"), para("x"), vuln("f2")));
    await note("vuln");
    expect(screen.getAllByRole("note", { name: GUIDES.vuln.title })).toHaveLength(1);
  });

  it("shows a page's own guide at its top", async () => {
    const { container } = setup(doc(para("What the engagement was")), "summary");
    const shown = await note("summary");
    const first = container.querySelector(".ProseMirror p");
    expect(shown.compareDocumentPosition(first!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
