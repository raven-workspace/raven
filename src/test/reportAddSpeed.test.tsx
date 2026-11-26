import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { buildPlainTarget, sourceOf, type ReportNode, type ReportTarget } from "../engines/report";
import * as placementModule from "../engines/report/placement";
import * as plainModule from "../engines/report/plain";
import { AddEvidenceButton } from "../features/report/AddEvidenceButton/AddEvidenceButton";
import { insertEntry } from "../features/report/editor/pageActions";
import { ReportDataContext } from "../features/report/editor/ReportDataContext/ReportDataContext";
import { ReportEditor } from "../features/report/editor/ReportEditor/ReportEditor";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Settings } from "../types/settings";
import { TooltipProvider } from "../ui";

// Placing reads the placement plan (built once per data and target) and never builds a whole draft: every plan a click
// asks for is the same one, and no draft is built.
vi.mock("../engines/report/placement", async (original) => {
  const mod = await original<typeof import("../engines/report/placement")>();
  return { ...mod, placementPlan: vi.fn(mod.placementPlan) };
});
vi.mock("../engines/report/plain", async (original) => {
  const mod = await original<typeof import("../engines/report/plain")>();
  return { ...mod, buildPlainTarget: vi.fn(mod.buildPlainTarget) };
});
vi.mock("../lib/api");
const m = vi.mocked(api, true);
const plans = vi.mocked(placementModule.placementPlan);
const drafts = vi.mocked(plainModule.buildPlainTarget);
/** The distinct plans the calls since the last clear returned. */
const distinctPlans = () => new Set(plans.mock.results.map((r) => r.value)).size;

const garnet = garnetFixtures(1_700_000_000_000);
const target: ReportTarget = { key: GARNET_HOST, kind: "standalone", hostIds: [GARNET_HOST] };
const draft = buildPlainTarget(garnet, target, {});
const holdsEntry = (n: ReportNode): boolean => (sourceOf(n) ?? "").startsWith("entry:") || (n.content ?? []).some(holdsEntry);
/** The draft with every step taken off: Add new evidence has every entry to put back. */
const bare: ReportNode = { ...draft, content: draft.content!.filter((n) => !holdsEntry(n)) };

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

async function ready(content: ReportNode) {
  const ref: { editor: Editor | null } = { editor: null };
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <TooltipProvider>
        <ReportDataContext.Provider value={{ data: garnet, onRemoveEvidence: vi.fn(), target, reportMeta: {} }}>
          <ReportEditor doc={content} onChange={vi.fn()} onReady={(e) => (ref.editor = e)} />
        </ReportDataContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(ref.editor?.mounted).toBe(true));
  return ref.editor!;
}

beforeEach(() => {
  m.settingsGet.mockResolvedValue({ machines: ["Kali (VM)"] } as Settings);
  m.attachmentGet.mockResolvedValue({ id: "a1", mime: "image/png", dataBase64: "AAAA" });
});

describe("placing evidence never builds a draft", () => {
  it("Add new evidence reads one placement plan, however many entries it adds", async () => {
    const editor = await ready(bare);
    render(
      <TooltipProvider>
        <AddEvidenceButton editor={editor} data={garnet} target={target} meta={{}} removed={[]} onAdded={vi.fn()} />
      </TooltipProvider>,
    );
    plans.mockClear();
    drafts.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    expect(await screen.findByText(/^Added \d+ entries/)).toBeInTheDocument();
    expect(Number(/^Added (\d+)/.exec(screen.getByText(/^Added/).textContent!)![1])).toBeGreaterThan(5);
    expect(distinctPlans()).toBe(1);
    expect(drafts).not.toHaveBeenCalled();
  });

  it("+ add reads the same plan for the entry it places", async () => {
    const editor = await ready(bare);
    const entry = garnet.log.find((e) => e.id === "l-garnet-version")!;
    plans.mockClear();
    drafts.mockClear();
    act(() => void insertEntry(editor, garnet, target, entry, false));
    expect(distinctPlans()).toBe(1);
    expect(drafts).not.toHaveBeenCalled();
  });
});
