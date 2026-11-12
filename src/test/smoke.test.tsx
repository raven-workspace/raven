import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../lib/api";

vi.mock("../lib/api");

function mount(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("smoke", () => {
  beforeEach(() => {
    vi.mocked(api.vaultStatus).mockResolvedValue({ exists: true, unlocked: true });
    vi.mocked(api.settingsGet).mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)", "Docker build", "Mac"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "" });
    vi.mocked(api.engagementsList).mockResolvedValue([]);
  });

  it("renders app root", async () => {
    mount("/");
    expect(await screen.findByTestId("app-root")).toBeInTheDocument();
  });

  it("serves the component gallery at /__ui in dev", async () => {
    mount("/__ui");
    expect(await screen.findByTestId("ui-gallery")).toBeInTheDocument();
  });
});
