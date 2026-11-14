import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "prosekit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GARNET_HOST, garnetFixtures } from "../audit/examFixtures";
import { buildPlainTarget, sourceOf, type ReportNode, type ReportTarget } from "../engines/report";
import * as draftModule from "../engines/report/draft";
import { AddEvidenceButton } from "../features/report/AddEvidenceButton";
import { insertEntry } from "../features/report/editor/pageActions";
import { ReportDataContext } from "../features/report/editor/ReportDataContext";
import { ReportEditor } from "../features/report/editor/ReportEditor";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Settings } from "../types/settings";
import { TooltipProvider } from "../ui";

// Every machine of a draft is written once per build (`machineBlock` reads `findingPhaseMap` once): counting its calls
// counts the drafts a click builds, the builds inside the engine included.
vi.mock("../engines/report/draft", async (original) => {
  const mod = await original<typeof import("../engines/report/draft")>();
  return { ...mod, findingPhaseMap: vi.fn(mod.findingPhaseMap) };
});
vi.mock("../lib/api");
const m = vi.mocked(api, true);
const builds = vi.mocked(draftModule.findingPhaseMap);

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

describe("placing evidence builds the draft once per click", () => {
  it("Add new evidence builds the target's draft once, however many entries it adds", async () => {
    const editor = await ready(bare);
    render(
      <TooltipProvider>
        <AddEvidenceButton editor={editor} data={garnet} target={target} meta={{}} removed={[]} onAdded={vi.fn()} />
      </TooltipProvider>,
    );
    builds.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Add new evidence" }));
    expect(await screen.findByText(/^Added \d+ entries/)).toBeInTheDocument();
    expect(Number(/^Added (\d+)/.exec(screen.getByText(/^Added/).textContent!)![1])).toBeGreaterThan(5);
    expect(builds).toHaveBeenCalledTimes(1);
  });

  it("+ add builds it once for the entry it places", async () => {
    const editor = await ready(bare);
    const entry = garnet.log.find((e) => e.id === "l-garnet-head")!;
    builds.mockClear();
    act(() => void insertEntry(editor, garnet, target, entry, false));
    expect(builds).toHaveBeenCalledTimes(1);
  });
});
