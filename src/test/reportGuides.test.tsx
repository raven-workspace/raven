import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "prosekit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { buildPlainTarget, buildSectionDraft, type ReportData, type ReportNode } from "../engines/report";
import { GUIDES, guideFor, guidesOf, sectionGuide, type GuideId } from "../engines/report/guides";
import { ReportDataContext } from "../features/report/editor/ReportDataContext";
import { GuidePanel } from "../features/report/GuidePanel";
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

function setup(page: ReportNode) {
  const onChange = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <ReportDataContext.Provider value={{ data, appendix: { entries: [], refFor: () => null }, sectionMeta: {}, onRemoveEvidence: vi.fn() }}>
        <ReportEditor sectionId="s1" doc={page} onChange={onChange} onReady={(e) => (ref.editor = e)} />
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

describe("guidesOf", () => {
  const src = (type: string, source: string, extra: Record<string, unknown> = {}): ReportNode => ({ type, attrs: { source, ...extra } });
  const h = (text: string, source?: string): ReportNode => ({ type: "heading", attrs: { level: 2, ...(source ? { source } : {}) }, content: [{ type: "text", text }] });

  it("reads the garnet draft's guides in page order", () => {
    const garnet = buildPlainTarget(garnetFixtures(1_700_000_000_000), { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] }, {});
    expect(guidesOf(garnet, "target").slice(0, 4)).toEqual(["result", "ports", "vuln", "steps"]);
  });

  it("reads the summary draft: the page's guide, the findings table, the Recommendations heading", () => {
    const summary = buildSectionDraft("summary", data, settings(), {});
    expect(guidesOf(summary, "summary")).toEqual(["summary", "findings-table", "recommendations"]);
  });

  it("maps every source to its guide, without repeats", () => {
    const page: ReportNode = {
      type: "doc",
      content: [
        src("paragraph", "result:h1"),
        src("table", "ports:h1"),
        src("paragraph", "finding:f1:explanation"),
        src("paragraph", "finding:f1:fix"),
        src("paragraph", "file:x1"),
        src("paragraph", "phase-steps:h1"),
        h("Post-exploitation", "phase:h1:post"),
        h("Additional findings", "phase:h1:additional"),
        h("Also tested", "phase:h1:tested"),
        h("Finding", "phase:h1:additional:f1"),
        src("paragraph", "attack-path"),
        src("table", "table:findings"),
        src("table", "table:scope-table"),
        src("table", "table:tested"),
        src("table", "table:cleanup"),
        src("paragraph", "result:h2"),
      ],
    };
    expect(guidesOf(page, "target")).toEqual(["result", "ports", "vuln", "exploit", "steps", "post", "additional", "tested", "attack-path", "findings-table", "scope", "house-cleaning"]);
    // The report-level Also tested table has its guide only on its own page.
    expect(guidesOf(page, "engagement-tested")).toContain("tested");
  });

  it("starts with the page's own guide, then takes a heading's from the page kind", () => {
    const page: ReportNode = { type: "doc", content: [h("Scope"), h("House cleaning")] };
    expect(guidesOf(page, "methodology")).toEqual(["methodology", "house-cleaning"]);
    expect(guidesOf(page, "introduction")).toEqual(["scope"]);
    expect(guidesOf({ type: "doc", content: [] }, "page", "appendix")).toEqual(["appendix"]);
  });
});

describe("guide notes beside the page", () => {
  const garnetDoc = buildPlainTarget(garnetFixtures(1_700_000_000_000), { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] }, {});
  const panel = (d: ReportNode = garnetDoc, kind: SectionKind = "target", qc = makeQueryClient()) =>
    render(
      <QueryClientProvider client={qc}>
        <aside aria-label="Evidence" tabIndex={-1}>
          <GuidePanel kind={kind} doc={d} />
        </aside>
      </QueryClientProvider>,
    );
  const titles = () => within(screen.getByRole("list", { name: "Guide notes" })).getAllByRole("note").map((n) => n.getAttribute("aria-label"));

  it("guide notes sit beside the page, never inside the paper", async () => {
    const { container } = setup(doc(ports, vuln()));
    await waitFor(() => expect(container.querySelector(".ProseMirror")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector(".report-page [data-guide], .ProseMirror [data-guide]")).toBeNull();
    panel();
    const aside = screen.getByRole("complementary", { name: "Evidence" });
    expect(await within(aside).findByRole("list", { name: "Guide notes" })).toBeInTheDocument();
  });

  it("lists the open page's guides in page order, folding the rest behind a count", async () => {
    const user = userEvent.setup();
    panel();
    await screen.findByRole("list", { name: "Guide notes" });
    const want = guidesOf(garnetDoc, "target").map((id) => GUIDES[id].title);
    expect(titles()).toEqual(want.slice(0, 2));
    await user.click(screen.getByRole("button", { name: `Show ${want.length - 2} more notes` }));
    expect(titles()).toEqual(want);
    await user.click(screen.getByRole("button", { name: "Show fewer notes" }));
    expect(titles()).toEqual(want.slice(0, 2));
  });

  it("Hide this note hides it in every report", async () => {
    const user = userEvent.setup();
    // Settings is stored: what one save writes, the next read returns.
    m.settingsUpdate.mockImplementation(async (patch) => {
      const next = { ...settings(), ...patch } as Settings;
      m.settingsGet.mockResolvedValue(next);
      return next;
    });
    const qc = makeQueryClient();
    const first = panel(garnetDoc, "target", qc);
    await user.click(within(await note("ports")).getByRole("button", { name: "Hide this note" }));
    expect(m.settingsUpdate).toHaveBeenCalledWith({ reportGuidesHidden: ["ports"] });
    await waitFor(() => expect(screen.queryByRole("note", { name: GUIDES.ports.title })).not.toBeInTheDocument());
    first.unmount();
    // Another target page, same Settings: no ports note.
    panel(garnetDoc, "target", qc);
    await screen.findByRole("list", { name: "Guide notes" });
    await user.click(screen.getByRole("button", { name: /^Show \d+ more notes$/ }));
    expect(screen.queryByRole("note", { name: GUIDES.ports.title })).not.toBeInTheDocument();
  });

  it("Hide all guide notes writes '*' and the panel goes", async () => {
    const user = userEvent.setup();
    panel();
    await user.click(within(await note("result")).getByRole("button", { name: "Hide all guide notes" }));
    expect(m.settingsUpdate).toHaveBeenCalledWith({ reportGuidesHidden: ["*"] });
    await waitFor(() => expect(screen.queryByRole("list", { name: "Guide notes" })).not.toBeInTheDocument());
  });

  it("shows nothing while Settings is hidden-all, and the Settings toggle brings them back", async () => {
    m.settingsGet.mockResolvedValue(settings(["*"]));
    const qc = makeQueryClient();
    const first = panel(garnetDoc, "target", qc);
    await waitFor(() => expect(qc.getQueryData(["settings"])).toBeTruthy());
    expect(screen.queryByRole("list", { name: "Guide notes" })).not.toBeInTheDocument();
    first.unmount();
    qc.setQueryData(["settings"], settings([]));
    panel(garnetDoc, "target", qc);
    expect(await screen.findByRole("list", { name: "Guide notes" })).toBeInTheDocument();
  });

  it("the fold starts closed on another page", async () => {
    const user = userEvent.setup();
    const qc = makeQueryClient();
    const tree = (key: string) => (
      <QueryClientProvider client={qc}>
        <GuidePanel key={key} kind="target" doc={garnetDoc} />
      </QueryClientProvider>
    );
    const { rerender } = render(tree("a"));
    await user.click(await screen.findByRole("button", { name: /^Show \d+ more notes$/ }));
    expect(screen.getByRole("button", { name: "Show fewer notes" })).toBeInTheDocument();
    rerender(tree("b"));
    expect(await screen.findByRole("button", { name: /^Show \d+ more notes$/ })).toBeInTheDocument();
  });

  it("keeps keyboard focus in the column after a hide", async () => {
    const user = userEvent.setup();
    panel();
    const first = within(await screen.findByRole("list", { name: "Guide notes" })).getAllByRole("note")[0];
    within(first).getByRole("button", { name: "Hide this note" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(screen.getByRole("complementary", { name: "Evidence" })).toContainElement(document.activeElement as HTMLElement);
    // Hide all: the panel goes, focus lands on the column (the aside takes focus when it has tabindex -1).
    const next = within(screen.getByRole("list", { name: "Guide notes" })).getAllByRole("note")[0];
    within(next).getByRole("button", { name: "Hide all guide notes" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("list", { name: "Guide notes" })).not.toBeInTheDocument());
    expect(document.activeElement).not.toBe(document.body);
  });
});
