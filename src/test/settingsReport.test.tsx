import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../features/settings/SettingsPage";
import { api } from "../lib/api";
import type { Settings } from "../types/settings";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const settings: Settings = {
  autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali",
  windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
  reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
};

const INTRO = "Default introduction, objective and requirements";

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SettingsPage onRestored={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue(settings);
  m.backupsList.mockResolvedValue([]);
});

describe("report details settings", () => {
  it("renders the group and saves the OSID on blur", async () => {
    const user = userEvent.setup();
    m.settingsUpdate.mockResolvedValue({ ...settings, reportOsid: "OS-12345" });
    mount();
    expect(await screen.findByText("Report details")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Default methodology")).toBeInTheDocument();
    await user.type(screen.getByLabelText("OSID"), "OS-12345");
    await user.tab();
    expect(m.settingsUpdate).toHaveBeenCalledWith({ reportOsid: "OS-12345" });
  });

  it("warns, without blocking, when the OSID does not look like OS-12345", async () => {
    const user = userEvent.setup();
    m.settingsUpdate.mockResolvedValue({ ...settings, reportOsid: "12345" });
    mount();
    await user.type(await screen.findByLabelText("OSID"), "12345");
    expect(screen.getByText("OSIDs look like OS-12345")).toBeInTheDocument();
    await user.tab();
    expect(m.settingsUpdate).toHaveBeenCalledWith({ reportOsid: "12345" });
  });

  it("shows no warning for a valid OSID", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText("OSID"), "OS-12345");
    expect(screen.queryByText("OSIDs look like OS-12345")).not.toBeInTheDocument();
  });

  it("keeps text typed in the next field when the save of the previous one resolves", async () => {
    const user = userEvent.setup();
    let resolve!: (s: Settings) => void;
    m.settingsUpdate.mockReturnValue(new Promise<Settings>((r) => (resolve = r)));
    mount();
    await user.type(await screen.findByLabelText("OSID"), "OS-12345");
    await user.tab();
    const intro = screen.getByLabelText(INTRO);
    expect(intro).toHaveFocus();
    await user.type(intro, "Scoped");
    resolve({ ...settings, reportOsid: "OS-12345" });
    await vi.waitFor(() => expect(m.settingsUpdate).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByLabelText(INTRO)).toHaveValue("Scoped");
    expect(screen.getByLabelText(INTRO)).toHaveFocus();
  });

  it("saves the default introduction, objective and requirements on blur", async () => {
    const user = userEvent.setup();
    m.settingsUpdate.mockResolvedValue({ ...settings, reportIntroduction: "Introduction\nAll efforts." });
    mount();
    await user.type(await screen.findByLabelText(INTRO), "Introduction{enter}All efforts.");
    await user.tab();
    expect(m.settingsUpdate).toHaveBeenCalledWith({ reportIntroduction: "Introduction\nAll efforts." });
  });

  it("shows hidden guide notes again, and is off while none are hidden", async () => {
    const user = userEvent.setup();
    m.settingsGet.mockResolvedValue({ ...settings, reportGuidesHidden: ["ports", "vuln"] });
    m.settingsUpdate.mockResolvedValue({ ...settings, reportGuidesHidden: [] });
    mount();
    const button = await screen.findByRole("button", { name: "Show guide notes again" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(m.settingsUpdate).toHaveBeenCalledWith({ reportGuidesHidden: [] });
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Show guide notes again" })).toBeDisabled());
  });

  it("keeps Show guide notes again off when none are hidden", async () => {
    mount();
    expect(await screen.findByRole("button", { name: "Show guide notes again" })).toBeDisabled();
  });
});
