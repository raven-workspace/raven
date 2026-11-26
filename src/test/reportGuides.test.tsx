import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "prosekit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { buildPlainTarget, buildSectionDraft, refreshBlocks, type ReportData, type ReportNode } from "../engines/report";
import { GUIDES, guidesOf, sectionGuide, type GuideId } from "../engines/report/guides";
import { ReportDataContext } from "../features/report/editor/ReportDataContext/ReportDataContext";
import { GuidePanel } from "../features/report/GuidePanel/GuidePanel";
import { ReportEditor } from "../features/report/editor/ReportEditor/ReportEditor";
import { useGuideSettings } from "../features/report/editor/GuideNote/GuideNote";
import { settingsKey } from "../features/settings/queries";
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

const para = (text: string): ReportNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string): ReportNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const doc = (...content: ReportNode[]): ReportNode => ({ type: "doc", content });

function setup(page: ReportNode) {
  const onChange = vi.fn();
  const ref: { editor: Editor | null } = { editor: null };
  const utils = render(
    <QueryClientProvider client={makeQueryClient()}>
      <ReportDataContext.Provider value={{ data, onRemoveEvidence: vi.fn() }}>
        <ReportEditor doc={page} onChange={onChange} onReady={(e) => (ref.editor = e)} />
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

  it("matches each page to its guide", () => {
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
    expect(guidesOf(garnet, "target").slice(0, 4)).toEqual(["result", "ports", "vuln", "exploit"]);
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

  it("keeps a drafted heading's guide through a rename: it follows the heading's source", () => {
    const rename = (doc: ReportNode, from: string, to: string): ReportNode => ({
      ...doc,
      content: doc.content!.map((n) => (n.type === "heading" && n.content?.[0]?.text === from ? { ...n, content: [{ type: "text", text: to }] } : n)),
    });
    const draft = (kind: "introduction" | "summary" | "methodology") => buildSectionDraft(kind, data, settings(), {});
    expect(guidesOf(rename(draft("summary"), "Recommendations", "Remediation"), "summary")).toContain("recommendations");
    expect(guidesOf(rename(draft("introduction"), "Introduction", "About this report"), "introduction")).toContain("introduction");
    // Scope and House Cleaning without the tables that carry the same guide: the heading alone keeps it.
    const headingsOnly = (d: ReportNode) => ({ ...d, content: d.content!.filter((n) => n.type === "heading") });
    expect(guidesOf(headingsOnly(rename(draft("introduction"), "Scope", "Targets")), "introduction")).toContain("scope");
    expect(guidesOf(headingsOnly(rename(draft("methodology"), "House Cleaning", "Clean-up")), "methodology")).toContain("house-cleaning");
  });

  it("a drafted heading's source says nothing when renamed: no Refresh, no generated-block hash to mark it edited", () => {
    for (const kind of ["introduction", "summary", "methodology"] as const) {
      for (const n of buildSectionDraft(kind, data, settings(), {}).content!.filter((x) => String(x.attrs?.source ?? "").startsWith("heading:"))) {
        expect(n.attrs?.gen).toBeUndefined();
        expect(refreshBlocks(String(n.attrs!.source), data, null, {})).toBeNull();
      }
    }
  });

  it("finds a heading with no source (a report saved before headings carried one) by its text", () => {
    const old = (d: ReportNode): ReportNode => ({
      ...d,
      content: d.content!.map((n) => (n.type === "heading" ? { ...n, attrs: { level: n.attrs?.level } } : n)).filter((n) => n.type === "heading"),
    });
    expect(guidesOf(old(buildSectionDraft("summary", data, settings(), {})), "summary")).toEqual(["summary", "recommendations"]);
    expect(guidesOf(old(buildSectionDraft("introduction", data, settings(), {})), "introduction")).toEqual(["introduction", "scope"]);
    expect(guidesOf(old(buildSectionDraft("methodology", data, settings(), {})), "methodology")).toEqual(["methodology", "house-cleaning"]);
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
    const { container } = setup(doc(heading("Scope"), para("In scope: 10.0.0.5")));
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

  it("shows Hide all guide notes once, after the fold toggle, and each note keeps its own Hide this note", async () => {
    panel();
    const list = await screen.findByRole("list", { name: "Guide notes" });
    const notes = within(list).getAllByRole("note");
    expect(within(list).queryByRole("button", { name: "Hide all guide notes" })).not.toBeInTheDocument();
    for (const n of notes) expect(within(n).getByRole("button", { name: "Hide this note" })).toBeInTheDocument();
    const hideAll = screen.getAllByRole("button", { name: "Hide all guide notes" });
    expect(hideAll).toHaveLength(1);
    const fold = screen.getByRole("button", { name: /^Show \d+ more notes$/ });
    expect(fold.compareDocumentPosition(hideAll[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Hide all guide notes writes '*' and the panel goes", async () => {
    const user = userEvent.setup();
    panel();
    await screen.findByRole("list", { name: "Guide notes" });
    await user.click(screen.getByRole("button", { name: "Hide all guide notes" }));
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
    screen.getByRole("button", { name: "Hide all guide notes" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("list", { name: "Guide notes" })).not.toBeInTheDocument());
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("hiding guide notes: saves in order", () => {
  type Call = { list: string[]; resolve(): void; reject(e: Error): void };
  let calls: Call[];
  beforeEach(() => {
    calls = [];
    m.settingsUpdate.mockImplementation(
      (patch) =>
        new Promise<Settings>((resolve, reject) => {
          const list = patch.reportGuidesHidden ?? [];
          calls.push({ list, resolve: () => resolve(settings(list)), reject });
        }),
    );
  });
  async function mountHook(stored: Settings = settings()) {
    m.settingsGet.mockResolvedValue(stored);
    const qc = makeQueryClient();
    const hook = renderHook(() => useGuideSettings(), { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    // Settings loaded, as on a page the owner reads before hiding a note.
    await waitFor(() => expect(hook.result.current.hidden).not.toBeNull());
    const cached = () => qc.getQueryData<Settings>(settingsKey)?.reportGuidesHidden;
    return { ...hook, cached };
  }
  /** Settles every save sent so far, the newest first (as a slower reply to an older save lands last), until none waits. */
  async function settleNewestFirst(how: (c: Call) => void = (c) => c.resolve()) {
    // Let the first save go out.
    await act(async () => {});
    expect(calls.length).toBeGreaterThan(0);
    for (let done = 0; done < calls.length; ) {
      const open = calls.slice(done).reverse();
      done = calls.length;
      await act(async () => {
        for (const c of open) how(c);
      });
      await act(async () => {});
    }
  }

  it("two hides back to back both stay hidden, whatever order the replies land in", async () => {
    const { result, cached } = await mountHook();
    act(() => result.current.hide("ports"));
    act(() => result.current.hide("steps"));
    expect(cached()).toEqual(["ports", "steps"]);
    await settleNewestFirst();
    expect(cached()).toEqual(["ports", "steps"]);
    // What was stored last holds both.
    expect(calls.at(-1)!.list).toEqual(["ports", "steps"]);
  });

  it("a failed save undoes only its own hide, and a later hide that saved stays", async () => {
    const { result, cached } = await mountHook();
    act(() => result.current.hide("ports"));
    act(() => result.current.hide("steps"));
    // The first save (hiding ports) fails; the next one succeeds.
    await settleNewestFirst((c) => (c === calls[0] ? c.reject(new Error("db busy")) : c.resolve()));
    expect(cached()).toEqual(["steps"]);
    expect(calls.at(-1)!.list).toEqual(["steps"]);
  });

  it("keeps the same hidden list from one render to the next while Settings doesn't change", async () => {
    // Settings saved before the list existed: none stored.
    const { result, rerender } = await mountHook({ machines: ["Kali (VM)"] } as unknown as Settings);
    expect(result.current.hidden).toEqual([]);
    const first = result.current.hidden;
    rerender();
    expect(result.current.hidden).toBe(first);
  });
});
