import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setImported, type CardMeta } from "../engines/library/store";
import type { LibraryCommand } from "../engines/library/types";
import { CardView } from "../features/arsenal/CardView";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const cmd = (id: string, over: Partial<LibraryCommand>): LibraryCommand => ({
  id, title: id, tool: "zz", template: "zz", os: "any", runFrom: "attacker", goals: ["g1"], source: "field-manual", cardId: "zz-card", ...over,
});
const A = cmd("zz-a", { title: "Alpha step", template: "zza {TARGET_IP}" });
const B = cmd("zz-b", { title: "Bravo step", template: "zzb {TARGET_IP}" });
const C = cmd("zz-c", { title: "Charlie step", template: "zzc {TARGET_IP}" });
const NOTE = cmd("zz-note", { title: "Oscp note helper", template: "zznote {TARGET_IP}", source: "oscp-notes", cardId: undefined });
const RAVEN = cmd("zz-raven", { title: "Raven helper", template: "zzraven {TARGET_IP}", source: "raven", cardId: undefined });
const CARD: CardMeta = { id: "zz-card", title: "Zz Card", stage: "initial-foothold", category: "Active-Directory", os: "windows", file: "02-Cards/Zz/Zz Card.md" };

function mount(focusBlockId?: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <CardView cardId="zz-card" engagementId="e1" hostId="h1" overrides={{}} onOverrides={() => {}} focusBlockId={focusBlockId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const pre = (text: string) => screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === text);
const blockEl = (id: string) => document.getElementById(`block-${id}`)!;

beforeEach(() => {
  vi.resetAllMocks();
  setImported({ commands: [A, B, C, NOTE, RAVEN], cards: [CARD] });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: [], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "/v/fm", nvdKeySet: false,
  });
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.openObsidian.mockResolvedValue(undefined);
});

describe("CardView reading view", () => {
  it("shows the title and a category · os meta line, without chips", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    expect(screen.getByText("Active Directory · windows")).toBeInTheDocument();
    expect(screen.queryByText("Field Manual")).not.toBeInTheDocument();
  });

  it("contents strip lists every block and jumps to it", async () => {
    const user = userEvent.setup();
    const jump = vi.spyOn(Element.prototype, "scrollIntoView");
    mount();
    await pre("zza 10.10.10.5");
    const strip = within(screen.getByRole("navigation", { name: "On this card" }));
    expect(strip.getAllByRole("button").map((b) => b.textContent)).toEqual(["Alpha step", "Bravo step", "Charlie step"]);
    jump.mockClear();
    await user.click(strip.getByRole("button", { name: "Charlie step" }));
    expect(jump.mock.instances).toContain(blockEl("zz-c"));
    expect(blockEl("zz-c")).toHaveAttribute("data-block");
  });

  it("focusBlockId outlines that block", async () => {
    mount("zz-b");
    await pre("zzb 10.10.10.5");
    expect(blockEl("zz-b")).toHaveClass("ring-1", "ring-accent");
    expect(blockEl("zz-a")).not.toHaveClass("ring-accent");
  });

  it("j/k move between blocks and c copies the focused one", async () => {
    const user = userEvent.setup();
    mount();
    await pre("zza 10.10.10.5");
    await user.keyboard("j");
    expect(blockEl("zz-a")).toHaveFocus();
    await user.keyboard("j");
    expect(blockEl("zz-b")).toHaveFocus();
    await user.keyboard("k");
    expect(blockEl("zz-a")).toHaveFocus();
    await user.keyboard("jj");
    expect(blockEl("zz-c")).toHaveFocus();
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("c");
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("zzc 10.10.10.5"));
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("k{Enter}");
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("zzb 10.10.10.5"));
  });

  it("Also in Raven is folded and includes oscp-notes commands", async () => {
    mount();
    await pre("zza 10.10.10.5");
    const also = screen.getByText("Also in Raven").closest("details")!;
    expect(also).not.toHaveAttribute("open");
    expect(within(also).getByText("Oscp note helper")).toBeInTheDocument();
    expect(within(also).getByText("Raven helper")).toBeInTheDocument();
  });

  it("Open in Obsidian calls the API with the card's file", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Open in Obsidian" }));
    expect(m.openObsidian).toHaveBeenCalledWith("02-Cards/Zz/Zz Card.md");
  });
});
