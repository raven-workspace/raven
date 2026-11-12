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
  reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "",
};

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
});
