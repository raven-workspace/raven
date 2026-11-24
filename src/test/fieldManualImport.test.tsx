import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldManualSection } from "../features/settings/FieldManualSection/FieldManualSection";
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

const settings = { autoLockMinutes: 30, backupRetention: 14, machines: [], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [] };

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
    expect(await screen.findByText(/1 cards, /)).toBeInTheDocument();
    expect(m.fieldManualScan).toHaveBeenCalledWith("~/fm");
    expect(m.fieldManualSave).toHaveBeenCalledTimes(1);
    expect(getLibrary().some((c) => c.id === "fm-zz-new-card-v0")).toBe(true);
  });

  it("the report counts the imported notes", async () => {
    const user = userEvent.setup();
    m.fieldManualScan.mockResolvedValue([
      { relPath: "02-Cards/zz.md", mtimeMs: 5, text: CARD },
      { relPath: "03-Tools/Zz-Tool.md", mtimeMs: 5, text: "---\nid: tool-zz\ntitle: Zz Tool\n---\n## Use\n" },
      { relPath: "04-Foundations/Zz-Fnd.md", mtimeMs: 5, text: "---\nid: fnd-zz\ntitle: Zz Fnd\n---\n## A\n" },
    ]);
    m.fieldManualSave.mockResolvedValue(null);
    mount(<FieldManualSection />);
    await user.click(await screen.findByRole("button", { name: "Import now" }));
    expect(await screen.findByText(/1 cards, \d+ commands, 2 notes\./)).toBeInTheDocument();
  });

  it("drift lists a Manual note's unfillable placeholder as coming from the Manual; output fences don't count (RAV-21)", async () => {
    const user = userEvent.setup();
    m.fieldManualScan.mockResolvedValue([
      { relPath: "02-Cards/zz.md", mtimeMs: 5, text: CARD },
      { relPath: "03-Tools/Zz-Tool.md", mtimeMs: 5, text: "---\nid: tool-zz\ntitle: Zz Tool\n---\n## Use\n```bash\nzzrun {TARGET_IP} {ZZNEWTOKEN}\n```\n```text\nsaw {ZZOUTTOKEN}\n```\n" },
    ]);
    m.fieldManualSave.mockResolvedValue(null);
    mount(<FieldManualSection />);
    await user.click(await screen.findByRole("button", { name: "Import now" }));
    await user.click(await screen.findByRole("button", { name: /Placeholders Raven can't fill/ }));
    expect(await screen.findByText("{ZZNEWTOKEN} Manual ×1")).toBeInTheDocument();
    expect(screen.queryByText(/ZZOUTTOKEN/)).toBeNull();
  });

  it("the report shows an import warning (notes kept from the last import)", async () => {
    m.fieldManualLoad.mockResolvedValue({
      importedAt: 100, cards: [], overlay: {}, added: [], playbook: [], toolkit: [], notes: [],
      report: { cardsAdded: 0, cardsChanged: 0, cardsRemoved: 0, commandsAdded: 0, commandsChanged: 0, commandsRemovedKept: [], classified: [], warnings: ["No notes found; kept the last import's 3 notes. Check iCloud has downloaded the vault."] },
    } as never);
    mount(<FieldManualSection />);
    expect(await screen.findByText(/kept the last import's 3 notes/)).toHaveClass("field-manual-section__warning");
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
