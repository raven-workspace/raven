import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldManualSection } from "../features/settings/FieldManualSection";
import { useVaultNewer } from "../features/fieldManual/queries";
import { getLibrary, setImported } from "../engines/library/store";
import { api } from "../lib/api";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const CARD = `---
id: zz-new-card
title: Zz
type: card
category: C
stage: s
os: linux
---

## Commands

### Do the thing
**Why:** because

\`\`\`bash title:"Kali"
echo zz
\`\`\`
`;

const settings = { autoLockMinutes: 30, backupRetention: 14, machines: [], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "~/fm", nvdKeySet: false };

function mount(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue(settings);
  m.fieldManualLoad.mockResolvedValue(null);
  m.fieldManualLatestMtime.mockResolvedValue(null);
});
afterEach(() => setImported({ commands: [], cards: [] }));

describe("Field Manual import", () => {
  it("Import now scans, saves and updates the library", async () => {
    const user = userEvent.setup();
    m.fieldManualScan.mockResolvedValue([{ relPath: "02-Cards/zz.md", mtimeMs: 5, text: CARD }]);
    m.fieldManualSave.mockResolvedValue(null);
    mount(<FieldManualSection />);
    await user.click(await screen.findByRole("button", { name: "Import now" }));
    expect(await screen.findByText(/1 cards · /)).toBeInTheDocument();
    expect(m.fieldManualScan).toHaveBeenCalledWith("~/fm");
    expect(m.fieldManualSave).toHaveBeenCalledTimes(1);
    expect(getLibrary().some((c) => c.id === "fm-zz-new-card-v0")).toBe(true);
  });

  it("a failed scan shows an error and leaves the library and snapshot unchanged", async () => {
    const user = userEvent.setup();
    const before = getLibrary();
    m.fieldManualScan.mockRejectedValue(new Error("not found"));
    mount(<FieldManualSection />);
    await user.click(await screen.findByRole("button", { name: "Import now" }));
    expect(await screen.findByText(/not found/)).toBeInTheDocument();
    expect(m.fieldManualSave).not.toHaveBeenCalled();
    expect(getLibrary()).toBe(before);
  });

  it("an import that finds no cards shows an error and saves nothing", async () => {
    const user = userEvent.setup();
    const before = getLibrary();
    // A wrong folder or an evicted iCloud vault: files come back, but no card parses.
    m.fieldManualScan.mockResolvedValue([{ relPath: "01-Playbook/00 - Off-the-Bat.md", mtimeMs: 5, text: "# Off\n- [ ] x" }]);
    m.fieldManualSave.mockResolvedValue(null);
    mount(<FieldManualSection />);
    await user.click(await screen.findByRole("button", { name: "Import now" }));
    expect(await screen.findByText(/No cards found/)).toBeInTheDocument();
    expect(m.fieldManualSave).not.toHaveBeenCalled();
    expect(getLibrary()).toBe(before);
  });

  it("the Settings link shows a dot when the vault is newer than the last import", async () => {
    m.fieldManualLoad.mockResolvedValue({ importedAt: 100, cards: [], commands: [], playbook: [], toolkit: [], report: {} } as never);
    m.fieldManualLatestMtime.mockResolvedValue(200);
    function Probe() {
      return <span>{useVaultNewer(true) ? "newer" : "current"}</span>;
    }
    mount(<Probe />);
    expect(await screen.findByText("newer")).toBeInTheDocument();
  });
});
