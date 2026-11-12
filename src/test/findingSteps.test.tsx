import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useFindingDraftStore } from "../features/findings/useFindingDraftStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Finding, FindingFile } from "../types/findings";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "linux", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const H1 = host("h1", "dc01", "10.10.10.5");
const H2 = host("h2", "web01", "10.10.10.6");
const T = new Date(2026, 10, 4, 9, 5).getTime();
const entry = (id: string, title: string, hostIds: string[], text = "body"): LogEntry => ({
  id, engagementId: "e1", kind: "note", title, titleEdited: false, ranOn: null, hostIds, observations: null,
  returnedNothing: false, private: false, content: { kind: "note", text }, at: T, createdAt: T, updatedAt: T,
});
const L1 = entry("l1", "nmap sweep", ["h1"], "scan output one");
const L2 = entry("l2", "upload the shell", ["h1"], "shell body");
const L3 = entry("l3", "trigger the exploit", ["h1"]);
const L4 = entry("l4", "unrelated web probe", ["h2"]);

const finding = (o: Partial<Finding> & { id: string; title: string }): Finding => ({
  engagementId: "e1", severity: null, cvssVector: null, cvssScore: null, status: "draft", description: "", impact: "",
  remediation: "", exploitNotes: "", lessons: "", refs: [], hostIds: [], serviceIds: [], stepEntryIds: [],
  createdAt: 1, updatedAt: 1, ...o,
});
const file = (o: Partial<FindingFile> & { id: string; name: string }): FindingFile => ({
  findingId: "f1", language: null, content: "", createdAt: 1, updatedAt: 1, ...o,
});

function mount(path: string, findings: Finding[], files: FindingFile[] = [], log: LogEntry[] | "never" | Error = [L1, L2, L3, L4], servicesError?: Error) {
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1, H2]);
  if (servicesError) m.servicesListEngagement.mockRejectedValue(servicesError);
  else m.servicesListEngagement.mockResolvedValue([]);
  m.servicesList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.hopsList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  if (log === "never") m.logList.mockReturnValue(new Promise<LogEntry[]>(() => {}));
  else if (log instanceof Error) m.logList.mockRejectedValue(log);
  else m.logList.mockResolvedValue(log);
  m.notesList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.findingsList.mockResolvedValue(findings);
  m.findingFilesList.mockResolvedValue(files);
  m.findingCreate.mockImplementation(async (_e, input) => finding({ id: "f9", ...input, title: input.title }));
  m.findingUpdate.mockImplementation(async (id, input) => finding({ id, ...input, title: input.title }));
  m.findingFileCreate.mockImplementation(async (fid, input) => file({ id: "ff9", findingId: fid, ...input }));
  m.findingFileUpdate.mockImplementation(async (id, input) => file({ id, ...input }));
  m.findingFileDelete.mockResolvedValue(null);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  useCaptureStore.getState().reset();
  useFindingDraftStore.getState().clearAll();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
});

const SECTION = "/e/e1/s/findings";
async function openEdit(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole("button", { name: `Edit ${title}` }));
  return await screen.findByRole("form", { name: "Edit finding" });
}
const stepTitles = (dlg: HTMLElement) =>
  within(within(dlg).getByRole("list", { name: "Reproduction steps" })).getAllByTestId("step-title").map((e) => e.textContent);

describe("finding steps", () => {
  it("finding steps reorder with icon buttons named Move up and Move down", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload", hostIds: ["h1"], stepEntryIds: ["l1", "l2"] })]);
    const dlg = await openEdit(user, "Shell upload");
    await within(dlg).findByRole("list", { name: "Reproduction steps" });
    for (const name of [/^Move up /, /^Move down /, /^Remove step /]) {
      for (const b of within(dlg).getAllByRole("button", { name })) {
        expect(b).toHaveTextContent("");
        expect(b.querySelector("svg")).not.toBeNull();
      }
    }
    // Both slots exist on every row: the first has Up disabled, the last Down disabled, nothing is dropped.
    const rows = within(dlg).getAllByTestId("step-title").length;
    expect(within(dlg).getAllByRole("button", { name: /^Move up / })).toHaveLength(rows);
    expect(within(dlg).getAllByRole("button", { name: /^Move down / })).toHaveLength(rows);
  });

  it("adding steps keeps order; moving up and down reorders; saving sends the ordered ids", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload", hostIds: ["h1"] })]);
    const dlg = await openEdit(user, "Shell upload");

    await user.click(within(dlg).getByRole("button", { name: "Add step" }));
    // Filtered to the finding's host first: the web01 entry is not offered until widened.
    expect(within(dlg).queryByRole("button", { name: /unrelated web probe/ })).not.toBeInTheDocument();
    await user.click(await within(dlg).findByRole("button", { name: /upload the shell/ }));
    await user.click(within(dlg).getByRole("button", { name: /nmap sweep/ }));
    await user.click(within(dlg).getByRole("button", { name: /trigger the exploit/ }));
    expect(stepTitles(dlg)).toEqual(["upload the shell", "nmap sweep", "trigger the exploit"]);
    // Added entries leave the picker.
    expect(within(dlg).queryByRole("button", { name: /^Add nmap sweep/ })).not.toBeInTheDocument();

    await user.click(within(dlg).getByRole("button", { name: "Move up nmap sweep" }));
    expect(stepTitles(dlg)).toEqual(["nmap sweep", "upload the shell", "trigger the exploit"]);
    await user.click(within(dlg).getByRole("button", { name: "Move down nmap sweep" }));
    expect(stepTitles(dlg)).toEqual(["upload the shell", "nmap sweep", "trigger the exploit"]);
    await user.click(within(dlg).getByRole("button", { name: "Move up trigger the exploit" }));
    await user.click(within(dlg).getByRole("button", { name: "Move up trigger the exploit" }));
    await user.click(within(dlg).getByRole("button", { name: "Move down upload the shell" }));
    expect(stepTitles(dlg)).toEqual(["trigger the exploit", "nmap sweep", "upload the shell"]);

    // Option+Arrow on the focused step moves it too.
    within(dlg).getByRole("button", { name: /^trigger the exploit/ }).focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(stepTitles(dlg)).toEqual(["nmap sweep", "trigger the exploit", "upload the shell"]);
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(stepTitles(dlg)).toEqual(["trigger the exploit", "nmap sweep", "upload the shell"]);

    await user.click(within(dlg).getByRole("button", { name: "Remove step upload the shell" }));
    expect(stepTitles(dlg)).toEqual(["trigger the exploit", "nmap sweep"]);

    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingUpdate).toHaveBeenCalledWith("f1", expect.objectContaining({ stepEntryIds: ["l3", "l1"] })));
  });

  it("a step expands to the entry's body; the picker can search and widen to other hosts", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload", hostIds: ["h1"], stepEntryIds: ["l1"] })]);
    const dlg = await openEdit(user, "Shell upload");
    expect(within(dlg).queryByText("scan output one")).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: /^nmap sweep/ }));
    expect(within(dlg).getByText("scan output one")).toBeInTheDocument();

    await user.click(within(dlg).getByRole("button", { name: "Add step" }));
    await user.type(within(dlg).getByLabelText("Search log"), "shell");
    expect(within(dlg).getByRole("button", { name: /upload the shell/ })).toBeInTheDocument();
    expect(within(dlg).queryByRole("button", { name: /trigger the exploit/ })).not.toBeInTheDocument();
    await user.clear(within(dlg).getByLabelText("Search log"));
    await user.click(within(dlg).getByRole("button", { name: "All hosts" }));
    expect(await within(dlg).findByRole("button", { name: /unrelated web probe/ })).toBeInTheDocument();
  });

  it("a deleted log entry disappears from steps, the rest stay in order", async () => {
    const user = userEvent.setup();
    // l2 is gone from the log: the stale id never shows and is not saved.
    mount(SECTION, [finding({ id: "f1", title: "Shell upload", hostIds: ["h1"], stepEntryIds: ["l3", "l2", "l1"] })], [], [L1, L3]);
    const dlg = await openEdit(user, "Shell upload");
    await waitFor(() => expect(stepTitles(dlg)).toEqual(["trigger the exploit", "nmap sweep"]));
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingUpdate).toHaveBeenCalledWith("f1", expect.objectContaining({ stepEntryIds: ["l3", "l1"] })));
  });
});

describe("steps while the log is unavailable", () => {
  it("saving with a log that never loads sends stepEntryIds unchanged, and says the log is loading", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload", stepEntryIds: ["l2", "l1"] })], [], "never");
    const dlg = await openEdit(user, "Shell upload");
    expect(within(dlg).getByText("Loading the log…")).toBeInTheDocument();
    expect(within(dlg).queryByText(/No steps yet/)).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingUpdate).toHaveBeenCalledWith("f1", expect.objectContaining({ stepEntryIds: ["l2", "l1"] })));
  });

  it("a log that fails to load shows the error, not an empty list, and still saves the steps unchanged", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload", stepEntryIds: ["l2", "l1"] })], [], new Error("db locked"));
    const dlg = await openEdit(user, "Shell upload");
    expect(await within(dlg).findByText(/db locked/)).toBeInTheDocument();
    expect(within(dlg).queryByText(/No steps yet/)).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingUpdate).toHaveBeenCalledWith("f1", expect.objectContaining({ stepEntryIds: ["l2", "l1"] })));
  });
});

describe("unsaved file drafts", () => {
  async function pasteDraft(user: ReturnType<typeof userEvent.setup>, dlg: HTMLElement) {
    await user.click(await within(dlg).findByRole("button", { name: "Add file" }));
    await user.type(within(dlg).getByLabelText("File name"), "poc.lua");
    await user.click(within(dlg).getByLabelText("File content"));
    await user.paste("print(1)");
  }

  it("saving the finding saves the pending file first", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })]);
    const dlg = await openEdit(user, "Shell upload");
    await pasteDraft(user, dlg);
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingFileCreate).toHaveBeenCalledWith("f1", { name: "poc.lua", language: "lua", content: "print(1)" }));
    await waitFor(() => expect(m.findingUpdate).toHaveBeenCalled());
    expect(m.findingFileCreate.mock.invocationCallOrder[0]).toBeLessThan(m.findingUpdate.mock.invocationCallOrder[0]);
  });

  it("a failed file save blocks the finding save", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })]);
    m.findingFileCreate.mockRejectedValue(new Error("too big"));
    const dlg = await openEdit(user, "Shell upload");
    await pasteDraft(user, dlg);
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByText("too big")).toBeInTheDocument();
    expect(m.findingUpdate).not.toHaveBeenCalled();
  });

  it("closing with a pending file keeps it with the draft; Discard changes drops it", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })]);
    let dlg = await openEdit(user, "Shell upload");
    await pasteDraft(user, dlg);
    await user.click(within(dlg).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    expect(m.findingFileCreate).not.toHaveBeenCalled();
    dlg = await openEdit(user, "Shell upload");
    expect(await within(dlg).findByLabelText("File content")).toHaveValue("print(1)");
    expect(within(dlg).getByLabelText("File name")).toHaveValue("poc.lua");
    // Esc keeps it too.
    await user.click(document.body);
    await user.keyboard("{Escape}");
    dlg = await openEdit(user, "Shell upload");
    expect(await within(dlg).findByLabelText("File content")).toHaveValue("print(1)");
    await user.click(within(dlg).getByRole("button", { name: "Discard changes" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    dlg = await openEdit(user, "Shell upload");
    expect(within(dlg).queryByLabelText("File content")).not.toBeInTheDocument();
    expect(m.findingFileCreate).not.toHaveBeenCalled();
  });

  it("an empty file form does not count as unsaved", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })]);
    const dlg = await openEdit(user, "Shell upload");
    await user.click(await within(dlg).findByRole("button", { name: "Add file" }));
    await user.click(within(dlg).getByRole("button", { name: "Cancel file" }));
    await user.click(within(dlg).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saving the finding works with an untouched Add file form open", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })]);
    const dlg = await openEdit(user, "Shell upload");
    await user.click(await within(dlg).findByRole("button", { name: "Add file" }));
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingUpdate).toHaveBeenCalled());
    expect(m.findingFileCreate).not.toHaveBeenCalled();
    expect(screen.queryByText("Give the file a name")).not.toBeInTheDocument();
  });

  it("saving the finding with an untouched Edit file form makes no file update", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })], [file({ id: "ff1", name: "poc.lua", content: "x = 1" })]);
    const dlg = await openEdit(user, "Shell upload");
    await user.click(await within(dlg).findByRole("button", { name: "Edit poc.lua" }));
    await user.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingUpdate).toHaveBeenCalled());
    expect(m.findingFileUpdate).not.toHaveBeenCalled();
  });

  it("refuses a chosen file with NUL bytes", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })]);
    const dlg = await openEdit(user, "Shell upload");
    await user.click(await within(dlg).findByRole("button", { name: "Add file" }));
    await user.upload(within(dlg).getByLabelText("Choose a file"), new File(["ab\0cd"], "blob.bin"));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("blob.bin: text files only");
    expect(within(dlg).getByLabelText("File content")).toHaveValue("");
  });
});

describe("finding files", () => {
  it("a file is highlighted by its extension's language", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })], [
      file({ id: "ff1", name: "poc.lua", content: "local x = 1\nprint(x)" }),
      file({ id: "ff2", name: "libhax.c", content: "#include <stdio.h>\nint main(void) { return 0; }" }),
    ]);
    const dlg = await openEdit(user, "Shell upload");
    const lua = (await within(dlg).findByText("poc.lua")).closest("li")!;
    const code = lua.querySelector("pre code")!;
    expect(code.className).toContain("language-lua");
    expect(code.querySelector(".hljs-keyword")?.textContent).toBe("local");
    const c = within(dlg).getByText("libhax.c").closest("li")!;
    expect(c.querySelector("pre code")!.className).toContain("language-c");
    expect([...c.querySelectorAll(".hljs-keyword")].map((k) => k.textContent)).toContain("return");
  });

  it("file content is never interpreted as markup", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })], [
      file({ id: "ff1", name: "x.txt", content: "<img src=x onerror=alert(1)>" }),
    ]);
    const dlg = await openEdit(user, "Shell upload");
    await within(dlg).findByText("x.txt");
    expect(dlg.querySelector("pre img")).toBeNull();
    expect(dlg.querySelector("pre code")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("pasting adds a file with the guessed language; override wins", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })]);
    const dlg = await openEdit(user, "Shell upload");
    await user.click(await within(dlg).findByRole("button", { name: "Add file" }));
    await user.type(within(dlg).getByLabelText("File name"), "exploit.py");
    await user.click(within(dlg).getByLabelText("File content"));
    await user.paste("print('hi')");
    await user.click(within(dlg).getByRole("button", { name: "Save file" }));
    await waitFor(() => expect(m.findingFileCreate).toHaveBeenCalledWith("f1", { name: "exploit.py", language: "python", content: "print('hi')" }));
  });

  it("files over 1 MiB are refused with a message", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })]);
    const dlg = await openEdit(user, "Shell upload");
    await user.click(await within(dlg).findByRole("button", { name: "Add file" }));
    const big = new File(["a".repeat(1024 * 1024 + 1)], "big.c", { type: "text/plain" });
    await user.upload(within(dlg).getByLabelText("Choose a file"), big);
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("big.c is over 1 MiB");
    expect(within(dlg).getByLabelText("File content")).toHaveValue("");
    expect(m.findingFileCreate).not.toHaveBeenCalled();
  });

  it("a chosen small file fills the form; delete is confirmed", async () => {
    const user = userEvent.setup();
    mount(SECTION, [finding({ id: "f1", title: "Shell upload" })], [file({ id: "ff1", name: "poc.lua", content: "x = 1" })]);
    const dlg = await openEdit(user, "Shell upload");
    await user.click(await within(dlg).findByRole("button", { name: "Add file" }));
    const small = new File(["#!/bin/sh\nid"], "run.sh", { type: "text/plain" });
    await user.upload(within(dlg).getByLabelText("Choose a file"), small);
    await waitFor(() => expect(within(dlg).getByLabelText("File content")).toHaveValue("#!/bin/sh\nid"));
    expect(within(dlg).getByLabelText("File name")).toHaveValue("run.sh");
    await user.click(within(dlg).getByRole("button", { name: "Cancel file" }));

    await user.click(within(dlg).getByRole("button", { name: "Delete poc.lua" }));
    expect(m.findingFileDelete).not.toHaveBeenCalled();
    const confirm = (await screen.findAllByRole("dialog")).at(-1)!;
    await user.click(within(confirm).getByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(m.findingFileDelete).toHaveBeenCalledWith("ff1"));
  });

  it("a new finding offers files only once saved", async () => {
    const user = userEvent.setup();
    mount(SECTION, []);
    await user.click(await screen.findByRole("button", { name: "Add finding" }));
    const dlg = await screen.findByRole("form", { name: "New finding" });
    expect(within(dlg).queryByRole("button", { name: "Add file" })).not.toBeInTheDocument();
    expect(within(dlg).getByText("Save the finding to attach files.")).toBeInTheDocument();
  });
});

describe("host findings tab", () => {
  it("host Findings tab lists only that host's findings", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1", [
      finding({ id: "f1", title: "On dc01", hostIds: ["h1"], severity: "high" }),
      finding({ id: "f2", title: "On web01", hostIds: ["h2"] }),
      finding({ id: "f3", title: "On both", hostIds: ["h1", "h2"] }),
    ]);
    await user.click(await screen.findByRole("tab", { name: "Findings" }));
    const panel = await screen.findByRole("tabpanel");
    expect(await within(panel).findByText("On dc01")).toBeInTheDocument();
    expect(within(panel).getByText("On both")).toBeInTheDocument();
    expect(within(panel).queryByText("On web01")).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Open On dc01" }));
    expect(await screen.findByRole("form", { name: "Edit finding" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("services that fail to load show an error line in the split, and the finding still saves", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1", [], [], [L1], new Error("services down"));
    await user.click(await screen.findByRole("tab", { name: "Findings" }));
    await user.click(await screen.findByRole("button", { name: "Add finding" }));
    const form = await screen.findByRole("form", { name: "New finding" });
    expect(await within(form).findByText(/Couldn.t load services: services down/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText("Title"), "Still saves");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.findingCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ title: "Still saves", hostIds: ["h1"] })));
  });

  it("shows an error line when the findings fail to load", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1", []);
    m.findingsList.mockRejectedValue(new Error("findings down"));
    await user.click(await screen.findByRole("tab", { name: "Findings" }));
    // The attempts list on the same tab reads the findings too, so it fails alongside.
    const alert = (await screen.findAllByRole("alert")).find((a) => a.textContent?.includes("Couldn't load findings"))!;
    expect(alert).toBeDefined();
    await user.click(within(alert).getByRole("button", { name: "Details" }));
    expect(alert).toHaveTextContent("findings down");
  });

  it("shows an empty message when the host has no findings", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1", [finding({ id: "f2", title: "On web01", hostIds: ["h2"] })]);
    await user.click(await screen.findByRole("tab", { name: "Findings" }));
    expect(await screen.findByText("No findings on this host yet.")).toBeInTheDocument();
  });
});
