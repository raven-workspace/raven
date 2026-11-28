// A screenshot saved from a finding's steps or the report editor is an entry change (GLOSSARY.md), on the checked
// in-browser fake (src/test/support/fakeStore.tsx): the checklist sync runs after the save, with no resync of its own,
// and a step after the save that fails shows on the screen while the screenshot stays saved.
//
// A screenshot entry ticks no goal itself (only flags and commands do), so the stale state the sync must bring up to
// date is written to the store behind the app's back: the host's OS (the "OS identified" fact tick) and a hand-ticked
// local.txt (which moves the host's card to Privesc).
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "prosekit/core";
import { TextSelection } from "prosekit/pm/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportData, ReportNode, ReportTarget } from "../engines/report";
import { useLogEntryStore } from "../features/capture/useLogEntryStore";
import { CHECKLIST_FAILED, resetFirstOpens } from "../features/checklist/sync";
import { useFindingDraftStore } from "../features/findings/useFindingDraftStore";
import { ReportDataContext } from "../features/report/editor/ReportDataContext/ReportDataContext";
import { ReportEditor } from "../features/report/editor/ReportEditor/ReportEditor";
import { makeQueryClient } from "../lib/queryClient";
import { RavenError } from "../types/errors";
import type { Host } from "../types/host";
import { fake, renderApp, resetFake } from "./support/fakeStore";

vi.mock("../lib/api", () => import("../audit/fakeApi"));

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "proof.png", { type: "image/png" });

/** A lab with dc01 (192.0.2.5, OS not yet known). */
async function seed() {
  const eng = await fake.engagementCreate({ name: "Lab Shots", kind: "lab", scopeCidrs: ["192.0.2.0/24"] });
  const dc01 = await fake.hostCreate(eng.id, { name: "dc01", ip: "192.0.2.5" });
  return { eng, dc01 };
}

/** Writes the store behind the app's back, so only a sync brings the checklist and board up to date. */
async function makeStale(engagementId: string, host: Host) {
  await fake.hostUpdate(host.id, { name: host.name, ip: host.ip, os: "windows" });
  await fake.checklistPut(engagementId, [{ ownerId: host.id, goalId: "h-orient-proof", status: "done", completedAt: 50 }]);
}

const row = async (engagementId: string, ownerId: string, goalId: string) =>
  (await fake.checklistList(engagementId)).find((i) => i.ownerId === ownerId && i.goalId === goalId);
const hostOf = async (engagementId: string, id: string) => (await fake.hostsList(engagementId)).find((h) => h.id === id)!;
const screenshots = async (engagementId: string) => (await fake.logList(engagementId)).filter((e) => e.kind === "screenshot");

/** The sync ran: the OS fact tick is done and the card followed the hand-ticked local.txt to Privesc. */
async function expectSynced(engagementId: string, hostId: string) {
  await waitFor(async () => expect(await row(engagementId, hostId, "h-enum-os")).toMatchObject({ status: "done", auto: true }));
  expect(await hostOf(engagementId, hostId)).toMatchObject({ boardColumn: "privilege-escalation", boardDerived: "privilege-escalation" });
}

async function expectStale(engagementId: string, hostId: string) {
  expect((await row(engagementId, hostId, "h-enum-os"))?.status ?? "todo").toBe("todo");
  expect(await hostOf(engagementId, hostId)).toMatchObject({ boardColumn: "information-gathering" });
}

/** The checklist sync's entry-tick write fails. */
const failEntryTicks = () => vi.spyOn(fake, "checklistApplyEntryTicks").mockRejectedValue(new RavenError("db", "disk I/O error"));

// jsdom has no layout for ranges: commands that scroll the selection into view measure one.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

beforeEach(() => {
  localStorage.clear();
  useLogEntryStore.getState().reset();
  useFindingDraftStore.getState().clearAll();
  resetFirstOpens();
  resetFake();
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:shot"), revokeObjectURL: vi.fn() });
});

describe("a screenshot added from a finding's steps", () => {
  async function addScreenshot(user: ReturnType<typeof userEvent.setup>, engagementId: string, hostId: string) {
    renderApp(`/e/${engagementId}/s/findings`);
    // The engagement's first-open sync has run (it derives dc01's column), so what follows is the save's own.
    await waitFor(async () => expect((await hostOf(engagementId, hostId)).boardDerived).toBe("information-gathering"));
    await user.click(await screen.findByRole("button", { name: "Edit Weak SMB signing" }));
    const dlg = await screen.findByRole("form", { name: "Edit finding" });
    await user.click(within(dlg).getByRole("button", { name: "Add screenshot" }));
    const zone = within(dlg).getByLabelText(/^Screenshot: paste/);
    const file = png();
    await act(async () => {
      fireEvent.paste(zone, { clipboardData: { items: [{ kind: "file", type: file.type, getAsFile: () => file }], files: [file], types: ["Files"], getData: () => "" } });
    });
    await within(dlg).findByAltText("The screenshot to add");
    return dlg;
  }

  async function seedFinding() {
    const { eng, dc01 } = await seed();
    await fake.findingCreate(eng.id, { title: "Weak SMB signing", hostIds: [dc01.id] });
    return { eng, dc01 };
  }

  it("runs the checklist sync: the host's fact tick and its card are brought up to date", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seedFinding();
    const dlg = await addScreenshot(user, eng.id, dc01.id);
    await makeStale(eng.id, dc01);
    await expectStale(eng.id, dc01.id);
    await user.type(within(dlg).getByLabelText("Caption"), "signing not required{Enter}");

    await waitFor(() => expect(within(dlg).getAllByTestId("step-title").map((e) => e.textContent)).toEqual(["signing not required"]));
    await expectSynced(eng.id, dc01.id);
    expect(within(dlg).queryByRole("alert")).toBeNull();
  });

  it("a failed sync shows under the steps, and the screenshot stays saved and added", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seedFinding();
    const dlg = await addScreenshot(user, eng.id, dc01.id);
    failEntryTicks();
    await user.type(within(dlg).getByLabelText("Caption"), "signing not required{Enter}");

    expect(await within(dlg).findByRole("alert")).toHaveTextContent(CHECKLIST_FAILED);
    expect(within(dlg).getAllByTestId("step-title").map((e) => e.textContent)).toEqual(["signing not required"]);
    expect((await screenshots(eng.id)).map((e) => e.title)).toEqual(["signing not required"]);
  });
});

describe("a screenshot pasted into the report editor", () => {
  async function mountEditor(engagementId: string, host: Host) {
    const target: ReportTarget = { key: host.id, kind: "standalone", hostIds: [host.id] };
    const data = { engagement: await fake.engagementGet(engagementId), hosts: [host], log: [], services: [], checklist: [], findings: [], findingFiles: [] } as unknown as ReportData;
    const ref: { editor: Editor | null } = { editor: null };
    const page: ReportNode = { type: "doc", content: [{ type: "paragraph" }] };
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <ReportDataContext.Provider value={{ data, onRemoveEvidence: vi.fn(), target }}>
          <ReportEditor doc={page} onChange={vi.fn()} onReady={(e) => (ref.editor = e)} />
        </ReportDataContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(ref.editor?.mounted).toBe(true));
    const editor = ref.editor!;
    fireEvent.focusIn(editor.view.dom);
    act(() => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1))));
    return editor;
  }

  function paste(editor: Editor) {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [png()], items: [], types: ["Files"], getData: () => "" } });
    act(() => void editor.view.dom.dispatchEvent(event));
  }

  const figures = (editor: Editor) => ((editor.getDocJSON() as ReportNode).content ?? []).filter((n) => n.type === "figure");

  it("runs the checklist sync: the host's fact tick and its card are brought up to date", async () => {
    const { eng, dc01 } = await seed();
    await fake.hostSyncBoard(dc01.id, "information-gathering");
    await makeStale(eng.id, dc01);
    const editor = await mountEditor(eng.id, dc01);
    await expectStale(eng.id, dc01.id);
    paste(editor);

    await waitFor(() => expect(figures(editor)).toHaveLength(1));
    await expectSynced(eng.id, dc01.id);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed sync shows in the editor's alert line, and the screenshot stays saved, on the page", async () => {
    const { eng, dc01 } = await seed();
    const editor = await mountEditor(eng.id, dc01);
    failEntryTicks();
    paste(editor);

    expect(await screen.findByRole("alert")).toHaveTextContent(CHECKLIST_FAILED);
    expect(screen.getByRole("alert")).not.toHaveTextContent("Couldn't save the image");
    const [saved] = await screenshots(eng.id);
    expect(saved).toBeDefined();
    await waitFor(() => expect(figures(editor).map((f) => f.attrs?.entryId)).toEqual([saved!.id]));
  });
});
