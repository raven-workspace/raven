import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { NodeSelection, TextSelection } from "prosekit/pm/state";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { api, resetAuditState } from "../audit/fakeApi";
import { ReportSectionView } from "../features/report/ReportSection";
import { pruneRemoved } from "../features/report/queries";
import { CheckList } from "../features/report/ReportOutline";
import { makeQueryClient } from "../lib/queryClient";
import type { LogContent, LogEntryInput } from "../types/log";
import type { ReportDoc } from "../types/report";
import { TooltipProvider } from "../ui";

vi.mock("../lib/api", () => import("../audit/fakeApi"));

// The real editor, with a handle on its instance so a test can type into the page.
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
  vi.useRealTimers();
  editors.length = 0;
  resetAuditState();
});

function mount(eid = "e-exam", qc: QueryClient = makeQueryClient()) {
  const utils = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[`/e/${eid}/s/report`]}>
          <Routes>
            <Route path="/e/:id/s/:section" element={<ReportSectionView />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

const outline = () => screen.getByRole("navigation", { name: "Report outline" });
const targetGroup = () => within(outline()).getByRole("group", { name: "Targets, in grading order" });
const targetRows = () => [...targetGroup().querySelectorAll<HTMLElement>("[data-outline-row]")];
const row = (name: string | RegExp) => within(outline()).getByRole("button", { name });
const rowFor = (label: string) => targetRows().find((r) => r.textContent?.startsWith(label))!;

async function ready() {
  await waitFor(() => expect(targetRows().length).toBeGreaterThan(0));
}

type UpsertInput = { targetKey: string | null; draftBuiltAt: number | null };
const draftUpserts = (spy: { mock: { calls: unknown[][] } }, targetKey: string) =>
  spy.mock.calls.filter((call) => {
    const input = call[1] as UpsertInput;
    return input.targetKey === targetKey && input.draftBuiltAt !== null;
  });

describe("Report view", () => {
  it("lists the targets in grading order with the AD set last, and names the file from the OSID", async () => {
    mount();
    await ready();
    // The engagement-level "Tested, not exploited" closes the targets.
    await waitFor(() =>
      expect(targetRows().map((r) => r.textContent)).toEqual(["lnx02.21", "ms01.5", "web01.20", "AD set: ad02, dc01", "Tested, not exploited"]),
    );
    expect(screen.getByRole("group", { name: "Report OSCP-OS-48213-Exam-Report.pdf" })).toBeInTheDocument();

    fireEvent.click(row(/Report details/));
    const osid = await screen.findByLabelText("OSID");
    fireEvent.change(osid, { target: { value: "os-1" } });
    fireEvent.blur(osid);
    expect(await screen.findByRole("group", { name: "Report OSCP-OS-?????-Exam-Report.pdf" })).toBeInTheDocument();
  });

  it("builds a target's draft once, on its first open", async () => {
    const upsert = vi.spyOn(api, "reportSectionUpsert");
    mount();
    await ready();
    // The first target opens by default and gets its draft.
    await waitFor(() => expect(draftUpserts(upsert, "h-exam-lnx")).toHaveLength(1));
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));

    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(draftUpserts(upsert, "h-exam-ms01")).toHaveLength(1));
    fireEvent.click(rowFor("lnx02"));
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(editors.length).toBeGreaterThanOrEqual(3));
    expect(draftUpserts(upsert, "h-exam-lnx")).toHaveLength(1);
    expect(draftUpserts(upsert, "h-exam-ms01")).toHaveLength(1);
  });

  it("saves typed text when switching targets and when leaving mid-debounce", async () => {
    const save = vi.spyOn(api, "reportSectionSave");
    const { unmount } = mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));

    const type = (text: string) =>
      act(() => {
        const view = editors[editors.length - 1].view;
        let at = 1;
        view.state.doc.descendants((n, p) => {
          if (n.type.name === "slot" && at === 1) at = p + 1;
          return at === 1;
        });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)).insertText(text));
      });
    const savedText = () => save.mock.calls.map(([, doc]) => JSON.stringify(doc as ReportDoc));

    type("Port 22 was the way in");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(rowFor("ms01"));
    expect(savedText().some((t) => t.includes("Port 22 was the way in"))).toBe(true);

    await waitFor(() => expect(editors.length).toBe(2));
    type("Second page text");
    unmount();
    expect(savedText().some((t) => t.includes("Second page text"))).toBe(true);
  });

  it("hides a deleted host's target without errors and adds a new host's", async () => {
    const upsert = vi.spyOn(api, "reportSectionUpsert");
    const { qc } = mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(5));

    await act(async () => {
      await api.hostDelete("h-exam-web");
      await qc.invalidateQueries();
    });
    await waitFor(() => expect(targetRows().map((r) => r.textContent)).toEqual(["lnx02.21", "ms01.5", "AD set: ad02, dc01", "Tested, not exploited"]));

    let created = "";
    await act(async () => {
      created = (await api.hostCreate("e-exam", { name: "files03", ip: "10.10.30.33", os: "linux" } as never)).id;
      await qc.invalidateQueries();
    });
    await waitFor(() => expect(targetRows().some((r) => r.textContent === "files03.33")).toBe(true));
    await waitFor(() => expect(upsert.mock.calls.some(([, i]) => (i as { targetKey: string | null }).targetKey === created)).toBe(true));
    fireEvent.click(rowFor("files03"));
    await waitFor(() => expect(draftUpserts(upsert, created)).toHaveLength(1));
  });

  it("keeps a failed save queued per section and retries it until it is written", async () => {
    const real = api.reportSectionSave;
    let failA = true;
    let aId = "";
    const save = vi.spyOn(api, "reportSectionSave").mockImplementation(async (id, doc, meta) => {
      if (id === aId && failA) throw new Error("disk full");
      return real(id, doc, meta);
    });
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBe(1));
    aId = rowFor("lnx02").dataset.id!;
    const type = (text: string) =>
      act(() => {
        const view = editors[editors.length - 1].view;
        view.dispatch(view.state.tr.insertText(text, 1));
      });
    const warning = () => screen.queryByText(/Some typing isn't saved yet/);
    const writesOf = (id: string) => save.mock.calls.filter(([sid]) => sid === id);

    type("A text");
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(warning()).toBeInTheDocument());
    expect(writesOf(aId)).toHaveLength(1);

    // B saves fine, A is tried again and still fails: the warning stays.
    await waitFor(() => expect(editors.length).toBe(2));
    const bId = rowFor("ms01").dataset.id!;
    type("B text");
    fireEvent.click(rowFor("web01"));
    await waitFor(() => expect(writesOf(aId)).toHaveLength(2));
    expect(writesOf(bId).some(([, doc]) => JSON.stringify(doc).includes("B text"))).toBe(true);
    await act(async () => {});
    expect(warning()).toBeInTheDocument();

    // Once A's write goes through, the warning clears.
    failA = false;
    await waitFor(() => expect(editors.length).toBe(3));
    type("C text");
    fireEvent.click(rowFor("lnx02"));
    await waitFor(() => expect(writesOf(aId).length).toBeGreaterThanOrEqual(3));
    expect(JSON.stringify(writesOf(aId).at(-1)![1])).toContain("A text");
    await waitFor(() => expect(warning()).not.toBeInTheDocument());
  });

  it("shows a failed section setup with Retry, keeping the outline", async () => {
    const real = api.reportSectionUpsert;
    let fail = false;
    vi.spyOn(api, "reportSectionUpsert").mockImplementation(async (rid, input) => {
      if (fail && input.draftBuiltAt === null) throw new Error("db busy");
      return real(rid, input);
    });
    const { qc } = mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(5));

    fail = true;
    await act(async () => {
      await api.hostCreate("e-exam", { name: "files03", ip: "10.10.30.33", os: "linux" } as never);
      await qc.invalidateQueries();
    });
    expect(await screen.findByText(/Couldn't add the report's new sections/)).toBeInTheDocument();
    expect(targetRows()).toHaveLength(5);

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(targetRows().some((r) => r.textContent === "files03.33")).toBe(true));
    expect(screen.queryByText(/Couldn't add the report's new sections/)).not.toBeInTheDocument();
  });

  it("shows a placeholder for client engagements", async () => {
    mount("e-old");
    expect(await screen.findByText("Client reports come after the exam")).toBeInTheDocument();
  });

  it("moves a target down the grading order with ⌥↓", async () => {
    const reorder = vi.spyOn(api, "reportSectionsReorder");
    mount();
    await ready();
    await waitFor(() => expect(targetRows()).toHaveLength(5));
    const first = rowFor("lnx02");
    const lnxId = first.dataset.id!;
    const msId = rowFor("ms01").dataset.id!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown", code: "ArrowDown", altKey: true });
    await waitFor(() =>
      expect(targetRows().map((r) => r.textContent)).toEqual(["ms01.5", "lnx02.21", "web01.20", "AD set: ad02, dc01", "Tested, not exploited"]),
    );
    expect(reorder).toHaveBeenCalledTimes(1);
    const ids = reorder.mock.calls[0][1];
    expect(ids.indexOf(msId)).toBeLessThan(ids.indexOf(lnxId));
    expect(document.activeElement).toBe(rowFor("lnx02"));
  });
});

const LNX = "h-exam-lnx";
const logInput = (title: string, content: LogContent, at: number): LogEntryInput => ({
  title,
  ranOn: null,
  hostIds: [LNX],
  observations: null,
  returnedNothing: false,
  private: false,
  content,
  at,
});
const evNode = (entryId: string) => ({ type: "evidence", attrs: { entryId, block: 0, keep: null, emphasis: [], appendix: "inline" } });

/** lnx02's page: a foothold heading, a scan with `outputLines` lines of output, a slot, the proof heading. */
async function seedLnx(outputLines = 3, meta: Record<string, unknown> = {}) {
  const output = Array.from({ length: outputLines }, (_, i) => `line ${i}`).join("\n");
  const scan = await api.logCreate("e-exam", logInput("nmap scan", { kind: "command", blocks: [{ command: "nmap -sV 10.10.30.21", output }] }, 1_000));
  const report = await api.reportGetOrCreate("e-exam");
  const doc = {
    type: "doc",
    content: [
      { type: "phase", attrs: { phase: "foothold", hostId: LNX } },
      evNode(scan.id),
      { type: "slot", attrs: { hint: "What this shows" } },
      { type: "phase", attrs: { phase: "proof", hostId: LNX } },
      { type: "slot", attrs: { hint: "Proof" } },
    ],
  };
  await api.reportSectionUpsert(report.id, { kind: "target", targetKey: LNX, position: 0, doc: doc as unknown as ReportDoc, meta, draftBuiltAt: Date.now() });
  return scan;
}

const pageEditor = () => editors[editors.length - 1];
const evidenceIds = () => {
  const ids: string[] = [];
  pageEditor().state.doc.descendants((n) => {
    if (n.type.name === "evidence") ids.push(n.attrs.entryId as string);
  });
  return ids;
};
const appendixGroup = () => within(outline()).getByRole("group", { name: "Appendices" });

describe("Report view: appendices and new evidence", () => {
  it("Move to appendix adds Appendix E to the outline; its page lists the moved block and links back", async () => {
    await seedLnx();
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    // The scan is the page's second block.
    const view = pageEditor().view;
    fireEvent.pointerDown(view.dom);
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, view.state.doc.child(0).nodeSize))));
    fireEvent.click(await screen.findByRole("button", { name: "Move to appendix" }));
    expect(await screen.findByText("Full output: Appendix E.1, nmap scan")).toBeInTheDocument();
    const appendixRow = await within(appendixGroup()).findByRole("button", { name: "Appendix E: lnx02" });

    fireEvent.click(appendixRow);
    expect(await screen.findByRole("heading", { name: "Appendix E: lnx02" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "E.1 nmap scan" })).toBeInTheDocument();
    expect(screen.getByText("line 2")).toBeInTheDocument();

    const before = editors.length;
    fireEvent.click(screen.getByRole("button", { name: "Referenced from lnx02" }));
    await waitFor(() => expect(editors.length).toBe(before + 1));
    expect(rowFor("lnx02")).toHaveAttribute("aria-current", "page");
    await waitFor(() => {
      const sel = pageEditor().state.selection;
      expect(sel instanceof NodeSelection && sel.node.type.name === "evidence").toBe(true);
    });
  });

  it("a long block's soft check offers Move to appendix, which moves it", async () => {
    await seedLnx(80);
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    const checks = screen.getAllByRole("list", { name: "Checks" })[0];
    // The fix is offered for the picked check only.
    expect(within(checks).queryByRole("button", { name: "Move to appendix" })).toBeNull();
    fireEvent.click(within(checks).getByText("Long block (80 lines of output)"));
    // Picked, the check reads in full under its row.
    expect(within(checks).getByText(/This block is long \(80 lines of output\)/)).toBeInTheDocument();
    fireEvent.click(within(checks).getByRole("button", { name: "Move to appendix" }));
    await waitFor(() => expect(pageEditor().state.doc.child(1).attrs.appendix).toBe("moved"));
    expect(await within(appendixGroup()).findByRole("button", { name: "Appendix E: lnx02" })).toBeInTheDocument();
  });

  it("flags a screenshot too narrow to print legibly once its image loads", async () => {
    const shot = await api.logCreate("e-exam", {
      ...logInput("Login page", { kind: "screenshot", attachmentId: "", caption: "Login page", fileName: "x.png" }, 500),
      attachment: { mime: "image/png", dataBase64: "AAAA" },
    } as LogEntryInput);
    await seedLnx();
    const report = await api.reportGetOrCreate("e-exam");
    const sections = await api.reportSectionsList(report.id);
    const lnx = sections.find((s) => s.targetKey === LNX)!;
    const doc = lnx.doc as unknown as { content: unknown[] };
    await api.reportSectionSave(lnx.id, { ...doc, content: [...doc.content, { ...evNode(shot.id), attrs: { ...evNode(shot.id).attrs, block: null } }] } as unknown as ReportDoc, {});
    const { container } = mount();
    await ready();
    await waitFor(() => expect(container.querySelector(".report-figure img")).toBeTruthy());
    const img = container.querySelector<HTMLImageElement>(".report-figure img")!;
    Object.defineProperty(img, "naturalWidth", { value: 480 });
    fireEvent.load(img);
    const checks = screen.getAllByRole("list", { name: "Checks" })[0];
    fireEvent.click(await within(checks).findByText("Screenshot too narrow to print"));
    expect(within(checks).getByText('The screenshot "Login page" is narrower than would print legibly. Retake it larger or crop it tighter.')).toBeInTheDocument();
  });

  it("Add new evidence appends a newly proving entry, skips removed ones, and Undo takes it off again", async () => {
    const removedFlag = await api.logCreate("e-exam", logInput("proof flag", { kind: "flag", flagKind: "proof", value: "p".repeat(32) }, 3_000));
    const scan = await seedLnx(3, { removedEntryIds: [removedFlag.id] });
    const localFlag = await api.logCreate("e-exam", logInput("local flag", { kind: "flag", flagKind: "local", value: "l".repeat(32) }, 2_000));
    const save = vi.spyOn(api, "reportSectionSave");
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    expect(evidenceIds()).toEqual([scan.id]);

    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    expect(await screen.findByText("Added 1 entry")).toBeInTheDocument();
    expect(evidenceIds()).toEqual([scan.id, localFlag.id]);
    await waitFor(() => expect(save.mock.calls.some(([, doc]) => JSON.stringify(doc).includes(localFlag.id))).toBe(true));

    const writes = save.mock.calls.length;
    // The notice's Undo, not the formatting toolbar's.
    fireEvent.click(within(screen.getByText("Added 1 entry").closest<HTMLElement>("[role=status]")!).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(evidenceIds()).toEqual([scan.id]));
    await waitFor(() => expect(save.mock.calls.length).toBeGreaterThan(writes));
    expect(JSON.stringify(save.mock.calls.at(-1)![1])).not.toContain(localFlag.id);
    expect(screen.queryByText("Added 1 entry")).not.toBeInTheDocument();
  });

  it("offers no Move to appendix on a report-level page", async () => {
    mount();
    await ready();
    fireEvent.click(row(/Methodology/));
    await waitFor(() => expect(editors.length).toBeGreaterThan(1));
    const view = pageEditor().view;
    let pos = -1;
    view.state.doc.forEach((n, offset) => {
      if (pos === -1 && n.type.name === "generated") pos = offset;
    });
    expect(pos).toBeGreaterThanOrEqual(0);
    fireEvent.pointerDown(view.dom);
    act(() => view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Move to appendix" })).toBeNull();
  });

  it("Add new evidence says when there is nothing new", async () => {
    await seedLnx();
    mount();
    await ready();
    await waitFor(() => expect(editors.length).toBeGreaterThan(0));
    // One bar above the page: Add new evidence sits at the right end of the formatting bar, not on a row of its own.
    const formatting = screen.getByRole("toolbar", { name: "Formatting" });
    expect(screen.getByRole("button", { name: "Add new evidence" }).parentElement).toBe(formatting.parentElement);
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    const notice = (await screen.findByText("Nothing new to add")).closest<HTMLElement>("[role=status]")!;
    expect(within(notice).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});

describe("Report view: the result", () => {
  const paper = () => document.querySelector<HTMLElement>(".report-page")!;

  it("has one strip: the report's, in place of the engagement's", async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={["/e/e-exam/s/report"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("group", { name: "Report status" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Engagement status" })).toBeNull();
  });

  it("titles a report-level page from its kind, at the top of the paper", async () => {
    mount();
    await ready();
    fireEvent.click(row(/High-level summary/));
    await waitFor(() => expect(within(paper()).getByRole("heading", { level: 1, name: "High-level summary" })).toBeInTheDocument());
    fireEvent.click(row(/Proof table/));
    await waitFor(() => expect(within(paper()).getByRole("heading", { level: 1, name: "Appendix A: Proof table" })).toBeInTheDocument());
    expect(paper().firstElementChild?.tagName).toBe("H1");
    // A target keeps its facts title and gets none of its own.
    fireEvent.click(rowFor("lnx02"));
    await waitFor(() => expect(within(paper()).getByRole("heading", { level: 2, name: "lnx02" })).toBeInTheDocument());
    expect(within(paper()).queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("a target's proof table names the host only once a flag's proof shows its hostname", async () => {
    mount();
    await ready();
    const hostname = () => {
      const cells = within(paper()).getAllByRole("row").find((r) => r.textContent?.startsWith("Hostname"))?.querySelectorAll("td");
      return cells?.[cells.length - 1].textContent;
    };
    // lnx02 has no flag yet: nothing proves its hostname.
    await waitFor(() => expect(hostname()).toBe("Not found"));
    // ms01's proof runs `hostname`.
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(hostname()).toBe("ms01"));
  });

  it("prints a target's facts as labelled values and marks nmap's guesses once, under the table", async () => {
    mount();
    await ready();
    await waitFor(() => expect(paper().querySelector(".report-facts")).toBeTruthy());
    const facts = paper().querySelector<HTMLElement>(".report-facts")!;
    expect(facts.textContent).not.toContain("|");
    expect([...facts.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["IP", "OS", "Ports", "Access"]);
    expect([...facts.querySelectorAll("dd")].map((d) => d.textContent)).toEqual(["10.10.30.21", "Linux", "22, 8080", "none"]);
    expect(paper().textContent).not.toContain("(nmap guess)");
    expect(paper().querySelectorAll(".report-guess").length).toBe(2);
    expect(within(paper()).getAllByText("Italic: nmap's guess, not confirmed.")).toHaveLength(1);
  });

  it("groups checks of one kind into one row and cycles through them; the fix sits in a disclosure for the picked one", async () => {
    mount();
    await ready();
    fireEvent.click(rowFor("ms01"));
    await waitFor(() => expect(screen.getAllByRole("list", { name: "Checks" })[0]).toHaveTextContent(/steps have no explanation/));
    const checks = screen.getAllByRole("list", { name: "Checks" })[0];
    const explain = within(checks).getByText(/^\d+ steps have no explanation\.$/);
    expect(within(checks).queryAllByText("A step has no explanation after it.")).toHaveLength(0);
    const total = Number(explain.textContent!.split(" ")[0]);
    expect(total).toBeGreaterThan(1);
    const selectedPos = () => {
      const sel = pageEditor().state.selection;
      return sel instanceof NodeSelection ? sel.from : null;
    };
    fireEvent.click(explain);
    await waitFor(() => expect(selectedPos()).not.toBeNull());
    expect(within(checks).getByText(`1 of ${total}`)).toBeInTheDocument();
    const first = selectedPos();
    fireEvent.click(explain);
    await waitFor(() => expect(within(checks).getByText(`2 of ${total}`)).toBeInTheDocument());
    expect(selectedPos()).not.toBe(first);
    // No fix one-liners show until a check that has one is picked, and then inside a closed disclosure.
    expect(checks.querySelector("code")).toBeNull();
  });

  it("lists tools with purpose and URL, and keeps an edited purpose in the appendix section's meta", async () => {
    const save = vi.spyOn(api, "reportSectionSave");
    mount();
    await ready();
    fireEvent.click(row(/Tools and payloads/));
    await waitFor(() => expect(within(paper()).getByRole("columnheader", { name: "Purpose" })).toBeInTheDocument());
    expect(within(paper()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Tool", "Purpose", "URL"]);
    expect(within(paper()).queryByText("Times used")).toBeNull();
    // The cell reads as text until clicked, then takes typing in place.
    const cell = within(paper()).getByRole("button", { name: "Purpose of nmap" });
    expect(cell).toHaveTextContent("Port and service scanning");
    fireEvent.click(cell);
    const purpose = within(paper()).getByRole("textbox", { name: "Purpose of nmap" });
    expect(purpose).toHaveValue("Port and service scanning");
    fireEvent.change(purpose, { target: { value: "Full TCP scans" } });
    await waitFor(() =>
      expect(save.mock.calls.some(([, , meta]) => JSON.stringify(meta).includes('"nmap":{"purpose":"Full TCP scans"}'))).toBe(true),
    );
    fireEvent.keyDown(purpose, { key: "Enter" });
    expect(within(paper()).getByRole("button", { name: "Purpose of nmap" })).toHaveTextContent("Full TCP scans");
    const lastMeta = () => JSON.stringify(save.mock.calls.at(-1)![2]);

    // Esc puts back what was there.
    fireEvent.click(within(paper()).getByRole("button", { name: "Purpose of nmap" }));
    fireEvent.change(within(paper()).getByRole("textbox", { name: "Purpose of nmap" }), { target: { value: "Oops" } });
    fireEvent.keyDown(within(paper()).getByRole("textbox", { name: "Purpose of nmap" }), { key: "Escape" });
    expect(within(paper()).getByRole("button", { name: "Purpose of nmap" })).toHaveTextContent("Full TCP scans");
    await waitFor(() => expect(lastMeta()).toContain('"nmap":{"purpose":"Full TCP scans"}'));

    // Emptied, the field is dropped and the catalog's purpose returns; the field itself stays empty while typing.
    fireEvent.click(within(paper()).getByRole("button", { name: "Purpose of nmap" }));
    const field = within(paper()).getByRole("textbox", { name: "Purpose of nmap" });
    fireEvent.change(field, { target: { value: "" } });
    expect(field).toHaveValue("");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(within(paper()).getByRole("button", { name: "Purpose of nmap" })).toHaveTextContent("Port and service scanning");
    await waitFor(() => expect(lastMeta()).not.toContain('"nmap"'));
  });
});

describe("CheckList", () => {
  it("shows a check's fix only once it is picked, inside a closed Fix disclosure", () => {
    const onPick = vi.fn();
    render(
      <TooltipProvider>
        <CheckList
          checks={[
            { id: "proof-ip:ms01:proof", level: "fail", text: "The proof.txt proof for ms01 doesn't show ipconfig.", fix: "ipconfig" },
            { id: "coverage:s1", level: "soft", text: "22/tcp on ms01 is untested." },
            { id: "coverage:s2", level: "soft", text: "80/tcp on ms01 is untested." },
          ]}
          onPick={onPick}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByText("ipconfig")).toBeNull();
    expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
    // Short in the row; in full once picked.
    expect(screen.queryByText("The proof.txt proof for ms01 doesn't show ipconfig.")).toBeNull();
    fireEvent.click(screen.getByText("proof.txt proof lacks ipconfig"));
    expect(screen.getByText("The proof.txt proof for ms01 doesn't show ipconfig.")).toBeInTheDocument();
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "proof-ip:ms01:proof" }));
    const fix = screen.getByRole("button", { name: "Fix" });
    expect(fix).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fix);
    expect(screen.getByText("ipconfig").tagName).toBe("CODE");
    // A group's row names each one as it cycles, in its own words when they differ.
    fireEvent.click(screen.getByText("2 services are untested."));
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("22/tcp on ms01 is untested.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("2 services are untested."));
    expect(screen.getByText("80/tcp on ms01 is untested.")).toBeInTheDocument();
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "coverage:s2" }));
    expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
  });
});

describe("pruneRemoved", () => {
  const ev = (entryId: string) => ({ type: "evidence", attrs: { entryId } });
  it("drops removed ids whose entry is on the page again (undo) and keeps the rest", () => {
    const doc = { type: "doc", content: [ev("a")] };
    expect(pruneRemoved(doc, { removedEntryIds: ["a", "b"], method: "x" })).toEqual({ removedEntryIds: ["b"], method: "x" });
    const meta = { removedEntryIds: ["b"] };
    expect(pruneRemoved(doc, meta)).toBe(meta);
  });
});
