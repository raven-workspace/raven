import { readFileSync } from "node:fs";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import { RavenError } from "../types/errors";
import type { LogEntryInput } from "../types/log";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1",
  name: "Lab A",
  kind: "lab",
  client: null,
  subLabel: null,
  scopeCidrs: ["10.10.10.0/24"],
  domain: null,
  startsAt: null,
  endsAt: null,
  timeboxStart: null,
  timeboxMinutes: null,
  status: "active",
  createdAt: 1,
  updatedAt: 1,
  lastActivityAt: null,
  lastRanOn: "Kali (VM)", msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};

function host(over: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    engagementId: "e1",
    ip: null,
    os: null,
    boardColumn: "information-gathering",
    boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
    access: "none",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const NMAP_NEW = [
  "kali@kali:~$ nmap -sCV -p 22,80 10.10.10.9",
  "Nmap scan report for 10.10.10.9",
  "PORT   STATE SERVICE VERSION",
  "22/tcp open  ssh     OpenSSH 8.9",
  "80/tcp open  http    Apache httpd 2.4.52",
  "Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel",
].join("\n");

const NMAP = [
  "kali@kali:~$ nmap -sCV -p 22,80,3003 10.10.10.5",
  "Starting Nmap 7.94",
  "Nmap scan report for 10.10.10.5",
  "PORT     STATE SERVICE VERSION",
  "22/tcp   open  ssh     OpenSSH 8.9",
  "80/tcp   open  http    Apache httpd 2.4.52",
  "3003/tcp open  http    Node.js",
  "Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel",
].join("\n");

function pngFile() {
  return new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
}

async function pasteImage(target: HTMLElement, file: File) {
  await act(async () => {
    fireEvent.paste(target, {
      clipboardData: {
        items: [{ kind: "file", type: file.type, getAsFile: () => file }],
        files: [file],
        types: ["Files"],
        getData: () => "",
      },
    });
  });
}

function mount(path = "/e/e1") {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <input aria-label="probe" />
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function ready() {
  await screen.findByRole("region", { name: "Vulnerability detection" });
  await within(screen.getByRole("region", { name: "Vulnerability detection" })).findByRole("link", { name: /dc01/ });
}

async function openCapture(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("l");
  return screen.findByRole("dialog", { name: "Add to log" });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30,
    backupRetention: 14,
    machines: ["Kali (VM)", "Docker build", "Mac"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
  });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([
    host({ id: "h1", name: "dc01", ip: "10.10.10.5", boardColumn: "vulnerability-detection" }),
    host({ id: "h2", name: "web07", ip: "10.10.10.6", boardColumn: "privilege-escalation" }),
  ]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesUpsertScan.mockResolvedValue([]);
  m.logCreate.mockImplementation(async (_e, input: LogEntryInput) => ({
    id: "l1",
    engagementId: "e1",
    kind: input.content.kind,
    title: input.title,
    titleEdited: input.titleEdited ?? false,
    ranOn: input.ranOn,
    hostIds: input.hostIds,
    observations: input.observations,
    returnedNothing: input.returnedNothing,
    private: input.private,
    content: input.content,
    at: 1,
    createdAt: 1,
    updatedAt: 1,
  }));
});

describe("capture panel", () => {
  it("L opens capture with focus in paste area", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    expect(within(dialog).getByLabelText("Paste")).toHaveFocus();
    expect(within(dialog).getByRole("radio", { name: "Other" })).toBeChecked();
  });

  it("hosts that fail to load: the Hosts field says so, and Retry brings the picker back (RAV-22)", async () => {
    const user = userEvent.setup();
    const hosts = await m.hostsList("e1");
    m.hostsList.mockRejectedValue(new Error("vault busy"));
    mount();
    await screen.findByRole("navigation", { name: "Engagement" });
    await user.keyboard("l");
    const dialog = within(await screen.findByRole("dialog", { name: "Add to log" }));
    expect(await dialog.findByText("Couldn't load hosts")).toBeInTheDocument();
    expect(dialog.queryByText("No host")).toBeNull();
    m.hostsList.mockResolvedValue(hosts);
    await user.click(dialog.getByRole("button", { name: "Retry" }));
    expect(await dialog.findByText("No host")).toBeInTheDocument();
    expect(dialog.queryByText("Couldn't load hosts")).toBeNull();
  });

  it("pasting nmap output fills title, host and services line", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.paste(NMAP);
    expect(within(dialog).getByRole("radio", { name: "Command" })).toBeChecked();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Versions and default scripts on the open ports");
    const hosts = within(dialog).getByRole("group", { name: "Hosts" });
    expect(within(hosts).getByText("dc01")).toBeInTheDocument();
    expect(within(dialog).getByText("Updates services on dc01: 22, 80, 3003. OS: Linux.")).toBeInTheDocument();
  });

  it("services line leaves out the OS when the host already has one", async () => {
    m.hostsList.mockResolvedValue([
      host({ id: "h1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "vulnerability-detection" }),
      host({ id: "h2", name: "web07", ip: "10.10.10.6", boardColumn: "privilege-escalation" }),
    ]);
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.paste(NMAP);
    expect(within(dialog).getByText("Updates services on dc01: 22, 80, 3003.")).toBeInTheDocument();
  });

  it("multi-host scan of new boxes lists each box's own ports", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.paste(
      [
        "kali@kali:~$ nmap -sV 10.10.10.9 10.10.10.8",
        "Nmap scan report for 10.10.10.9",
        "PORT   STATE SERVICE VERSION",
        "22/tcp open  ssh     OpenSSH 8.9",
        "",
        "Nmap scan report for 10.10.10.8",
        "PORT    STATE SERVICE       VERSION",
        "135/tcp open  msrpc         Microsoft Windows RPC",
        "Service Info: OS: Windows; CPE: cpe:/o:microsoft:windows",
      ].join("\n"),
    );
    // Each new box gets only its own section's ports; both become hosts on save.
    expect(within(dialog).getByText("Updates services on 10.10.10.9: 22. Updates services on 10.10.10.8: 135. OS: Windows.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "+ 10.10.10.9" })).not.toBeInTheDocument();
  });

  it("Enter saves and focus returns", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const card = within(screen.getByRole("region", { name: "Vulnerability detection" })).getByRole("link", { name: /dc01/ });
    card.focus();
    const dialog = await openCapture(user);
    await user.paste(NMAP);
    await user.click(within(dialog).getByLabelText("Observations"));
    await user.keyboard("node on 3003");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(m.logCreate).toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({
        title: "Versions and default scripts on the open ports",
        hostIds: ["h1"],
        ranOn: "Kali (VM)",
        observations: "node on 3003",
        private: false,
      }),
    );
    expect(m.servicesUpsertScan).toHaveBeenCalledWith("h1", expect.arrayContaining([expect.objectContaining({ port: 3003 })]));
    expect(card).toHaveFocus();
    // The draft is gone.
    await openCapture(user);
    expect(screen.getByLabelText("Paste")).toHaveValue("");
  });

  it("edited title is kept when kind changes", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.paste("nmap -p- 10.10.10.5");
    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "My scan");
    await user.keyboard("{Meta>}4{/Meta}");
    expect(within(dialog).getByRole("radio", { name: "Other" })).toBeChecked();
    expect(title).toHaveValue("My scan");
    expect(within(dialog).queryByText("Private, not in reports")).not.toBeInTheDocument();
    // Only ⌘ shortcuts: Ctrl, or ⌘ with Shift, does nothing.
    within(dialog).getByRole("button", { name: /^Private/ }).focus();
    await user.keyboard("{Control>}p{/Control}{Control>}1{/Control}{Meta>}{Shift>}p{/Shift}{/Meta}");
    expect(within(dialog).queryByText("Private, not in reports")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Other" })).toBeChecked();
    await user.keyboard("{Meta>}p{/Meta}");
    expect(within(dialog).getByText("Private, not in reports")).toBeInTheDocument();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate.mock.calls[0]![1]).toMatchObject({
      title: "My scan",
      titleEdited: true,
      private: true,
      content: { kind: "note", text: "nmap -p- 10.10.10.5" },
    });
  });

  it("Esc keeps the draft for next open", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await openCapture(user);
    await user.paste("remember the vhost");
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const dialog = await openCapture(user);
    expect(within(dialog).getByLabelText("Paste")).toHaveValue("remember the vhost");
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(within(dialog).getByLabelText("Paste")).toHaveValue("");
  });

  it("the Other kind explains what it is for", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.click(within(dialog).getByRole("radio", { name: "Other" }));
    expect(within(dialog).getByLabelText("Paste")).toHaveAttribute("placeholder", expect.stringMatching(/isn't a command, screenshot, request or flag/));
  });

  it("L is ignored while typing in an input", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    await user.click(screen.getByLabelText("probe"));
    await user.keyboard("l");
    expect(screen.getByLabelText("probe")).toHaveValue("l");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("kind chips are 28px and keep their shortcuts", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h2");
    await screen.findByRole("navigation", { name: "Engagement" });
    const dialog = await openCapture(user);
    const group = within(dialog).getByRole("radiogroup", { name: "Kind" });
    expect(group).toHaveClass("toggle-group");
    expect(readFileSync("src/ui/shadcn/toggle-group.scss", "utf8")).toMatch(/\.toggle-group \{[^}]*height: 1\.75rem;/);
    const names = ["Command", "Screenshot", "HTTP", "Other", "Flag"];
    names.forEach((name, i) => {
      const chip = within(group).getByRole("radio", { name });
      expect(chip).toHaveAttribute("aria-keyshortcuts", `Meta+${i + 1}`);
      expect(chip).toHaveTextContent(`⌘${i + 1}`);
    });
    await user.keyboard("{Meta>}3{/Meta}");
    expect(within(group).getByRole("radio", { name: "HTTP" })).toBeChecked();
  });

  it("flag takes its host and local/proof from the host selection", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h2");
    await screen.findByRole("navigation", { name: "Engagement" });
    const dialog = await openCapture(user);
    await user.paste("0123456789abcdef0123456789abcdef");
    expect(within(dialog).getByRole("radio", { name: "Flag" })).toBeChecked();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("proof.txt");
    expect(within(dialog).getByRole("button", { name: "proof.txt" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(dialog).getByRole("button", { name: "Remove web07" }));
    expect(within(dialog).getByLabelText("Title")).toHaveValue("local.txt");
    expect(within(dialog).getByRole("button", { name: "local.txt" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a pasted proof block saves the flag value, its file's kind and the block as proof", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    const block = "whoami; hostname; ip a\nweb07\n    inet 10.10.10.6/24 brd 10.10.10.255 scope global ens3\ncat /home/web/local.txt\n0123456789abcdef0123456789abcdef";
    await user.paste(block);
    expect(within(dialog).getByRole("radio", { name: "Flag" })).toBeChecked();
    // web07 sits in Privesc (default proof.txt), but the block read local.txt.
    expect(within(dialog).getByLabelText("Title")).toHaveValue("local.txt");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate).toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({
        hostIds: ["h2"],
        content: expect.objectContaining({ kind: "flag", flagKind: "local", value: "0123456789abcdef0123456789abcdef", proof: block }),
      }),
    );
  });

  it("an unknown in-scope IP with nothing proven there makes no host", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.paste("ping -c 1 10.10.10.9");
    // No "+ add as host" tick: the output must prove the host.
    expect(within(dialog).queryByRole("button", { name: "+ 10.10.10.9" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("Paste"));
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.hostCreate).not.toHaveBeenCalled();
    expect(m.logCreate.mock.calls[0]![1].hostIds).toEqual([]);
  });

  it("first scan of a new box makes the host and updates its services", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    m.hostCreate.mockImplementation(async (_e, input) => {
      order.push("host");
      return host({ id: "h9", name: input.name, ip: input.ip ?? null });
    });
    m.logCreate.mockImplementationOnce(async () => {
      order.push("log");
      throw new Error("never mind");
    });
    m.servicesUpsertScan.mockImplementation(async () => {
      order.push("services");
      return [];
    });
    m.hostUpdate.mockImplementation(async (hid, input) => host({ id: hid, name: input.name }));
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.paste(NMAP_NEW);
    expect(within(dialog).getByText("Updates services on 10.10.10.9: 22, 80. OS: Linux.")).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("Observations"));
    await user.keyboard("{Enter}");
    // The first attempt made the host, then the entry failed; the retry must not make it again.
    expect(await within(dialog).findByText("never mind")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(m.hostCreate).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["host", "log", "services"]);
    expect(m.logCreate).toHaveBeenLastCalledWith("e1", expect.objectContaining({ hostIds: ["h9"] }));
    expect(m.servicesUpsertScan).toHaveBeenCalledWith("h9", expect.arrayContaining([expect.objectContaining({ port: 80 })]));
    expect(m.hostUpdate).toHaveBeenCalledWith("h9", { name: "10.10.10.9", ip: "10.10.10.9", os: "linux", access: "none" });
  });

  it("Kali's two-line prompt pastes as a command and Enter saves it run on Kali", async () => {
    m.engagementGet.mockResolvedValue({ ...E1, lastRanOn: "Mac" });
    m.engagementsList.mockResolvedValue([{ ...E1, lastRanOn: "Mac" }]);
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.paste("┌──(kali㉿kali)-[~]\n└─$ whoami\nkali");
    expect(within(dialog).getByRole("radio", { name: "Command" })).toBeChecked();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate.mock.calls[0]![1]).toMatchObject({
      ranOn: "Kali (VM)",
      content: { kind: "command", blocks: [{ shell: "kali@kali", command: "whoami", output: "kali" }] },
    });
  });

  it("Enter saves a one-line note; a multi-line note keeps Enter as newline", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.paste("line one\nline two");
    await user.keyboard("{Enter}");
    expect(within(dialog).getByLabelText("Paste")).toHaveValue("line one\nline two\n");
    expect(m.logCreate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    await user.paste("check the vhost");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate.mock.calls[0]![1]).toMatchObject({ title: "check the vhost", content: { kind: "note", text: "check the vhost" } });
  });

  it("a locked vault during save moves to unlock (I4)", async () => {
    m.logCreate.mockRejectedValue(new RavenError("locked", "vault is locked"));
    const user = userEvent.setup();
    mount();
    await ready();
    await openCapture(user);
    await user.paste("remember the vhost");
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it("a locked vault after the entry saved (services step) also moves to unlock (I4)", async () => {
    m.servicesUpsertScan.mockRejectedValue(new RavenError("locked", "vault is locked"));
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.paste(NMAP);
    await user.click(within(dialog).getByLabelText("Observations"));
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it("private chip is the plain chip, not the accent (M2)", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const dialog = await openCapture(user);
    await user.click(within(dialog).getByRole("button", { name: /^Private/ }));
    expect(within(dialog).getByText("Private, not in reports")).not.toHaveAttribute("data-variant", "accent");
  });

  it("lock discards capture drafts", async () => {
    const user = userEvent.setup();
    m.vaultLock.mockResolvedValue(null);
    m.vaultUnlock.mockResolvedValue({ migratedFrom: 3, migratedTo: 3, dailyBackup: null, dailyBackupError: null });
    mount();
    await ready();
    await openCapture(user);
    await user.paste("remember the vhost");
    await user.keyboard("{Meta>}l{/Meta}");
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Password"), "correct horse battery{Enter}");
    await ready();
    const dialog = await openCapture(user);
    expect(within(dialog).getByLabelText("Paste")).toHaveValue("");
  });

  it("flag keeps a pasted image as a removable thumbnail", async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:flag"), revokeObjectURL: vi.fn() });
    const user = userEvent.setup();
    mount("/e/e1/h/h2");
    await screen.findByRole("navigation", { name: "Engagement" });
    const dialog = await openCapture(user);
    await user.paste("0123456789abcdef0123456789abcdef");
    await pasteImage(within(dialog).getByLabelText("Paste"), pngFile());
    await vi.waitFor(() => expect(within(dialog).getByRole("img", { name: "Pasted image" })).toHaveAttribute("src", "blob:flag"));
    expect(within(dialog).getByRole("radio", { name: "Flag" })).toBeChecked();
    expect(within(dialog).getByLabelText("Paste")).toHaveValue("0123456789abcdef0123456789abcdef");
    await user.click(within(dialog).getByRole("button", { name: "Remove image" }));
    expect(within(dialog).queryByRole("img")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:flag");
    await user.click(within(dialog).getByLabelText("Paste"));
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    expect(m.logCreate.mock.calls[0]![1]).toMatchObject({
      title: "proof.txt",
      content: { kind: "flag", flagKind: "proof", value: "0123456789abcdef0123456789abcdef" },
      attachment: null,
    });
  });

  it("image paste becomes a screenshot with generated file name", async () => {
    const createUrl = vi.fn(() => "blob:shot");
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("navigation", { name: "Engagement" });
    const dialog = await openCapture(user);
    await pasteImage(within(dialog).getByLabelText("Paste"), pngFile());
    await vi.waitFor(() =>
      expect(within(dialog).getByRole("radio", { name: "Screenshot" })).toBeChecked(),
    );
    expect(within(dialog).getByRole("img", { name: "Pasted screenshot" })).toHaveAttribute("src", "blob:shot");
    expect(within(dialog).getByText("10.10.10.5_vulns_shot.png")).toHaveClass("kind-fields__file-name");
    await user.type(within(dialog).getByLabelText("Caption"), "login page :8080");
    expect(within(dialog).getByText("10.10.10.5_vulns_port8080.png")).toBeInTheDocument();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalled());
    const input = m.logCreate.mock.calls[0]![1];
    expect(input.hostIds).toEqual(["h1"]);
    expect(input.content).toMatchObject({ kind: "screenshot", caption: "login page :8080", fileName: "10.10.10.5_vulns_port8080.png" });
    expect(input.attachment).toEqual({ mime: "image/png", dataBase64: "iVBORw==" });
  });
});
