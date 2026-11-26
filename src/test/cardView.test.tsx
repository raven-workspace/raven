import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setImported } from "../engines/library/store";
import type { CardMeta } from "../engines/library/types";
import type { LibraryCommand } from "../engines/library/types";
import { CardView } from "../features/arsenal/CardView/CardView";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
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
const GUARDED = cmd("zz-guard", { title: "Delta step", template: "zzd {TARGET_IP} {SECOND_LPORT}" });
const NOTE = cmd("zz-note", { title: "Oscp note helper", template: "zznote {TARGET_IP}", source: "oscp-notes", cardId: undefined });
const RAVEN = cmd("zz-raven", { title: "Raven helper", template: "zzraven {TARGET_IP}", source: "raven", cardId: undefined });
const CARD: CardMeta = { id: "zz-card", title: "Zz Card", stage: "initial-foothold", category: "Active-Directory", os: "windows", file: "02-Cards/Zz/Zz Card.md" };

function Card({ focusBlockId }: { focusBlockId?: string }) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  return <CardView cardId="zz-card" engagementId="e1" hostId="h1" overrides={overrides} onOverrides={setOverrides} focusBlockId={focusBlockId} />;
}
function mount(focusBlockId?: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <Card focusBlockId={focusBlockId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const pre = (text: string) => screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === text);
const blockEl = (id: string) => document.getElementById(`block-${id}`)!;

beforeEach(() => {
  vi.resetAllMocks();
  setImported({ commands: [A, B, C, GUARDED, NOTE, RAVEN], cards: [CARD] });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: [], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "/v/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
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
  it("shows the title and a category and os meta line, without chips", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Zz Card" })).toBeInTheDocument();
    expect(screen.getByText("Active Directory")).toBeInTheDocument();
    expect(screen.getByText("windows")).toBeInTheDocument();
    expect(screen.queryByText("Field Manual")).not.toBeInTheDocument();
  });

  it("contents strip lists every block and jumps to it", async () => {
    const user = userEvent.setup();
    const jump = vi.spyOn(Element.prototype, "scrollIntoView");
    mount();
    await pre("zza 10.10.10.5");
    const strip = within(screen.getByRole("navigation", { name: "On this card" }));
    expect(strip.getAllByRole("button").map((b) => b.textContent)).toEqual(["Alpha step", "Bravo step", "Charlie step", "Delta step"]);
    jump.mockClear();
    await user.click(strip.getByRole("button", { name: "Charlie step" }));
    expect(jump.mock.instances).toContain(blockEl("zz-c"));
    expect(blockEl("zz-c")).toHaveAttribute("data-block");
  });

  it("focusBlockId outlines that block", async () => {
    mount("zz-b");
    await pre("zzb 10.10.10.5");
    // An outline 6px clear of the block (an outline takes no room, so the block never widens its column).
    expect(blockEl("zz-b")).toHaveClass("command-pane__block", "command-pane__block--marked");
    expect(blockEl("zz-a")).not.toHaveClass("command-pane__block--marked");
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

  it("a held-back copy focuses the field; typing then Enter copies the filled command", async () => {
    const user = userEvent.setup();
    mount();
    await pre("zzd 10.10.10.5 {SECOND_LPORT}");
    await navigator.clipboard.writeText("untouched");
    blockEl("zz-guard").focus();
    await user.keyboard("c");
    const field = await screen.findByRole("combobox", { name: "Value for SECOND_LPORT" });
    await waitFor(() => expect(field).toHaveFocus());
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("5555{Enter}");
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("zzd 10.10.10.5 5555"));
  });

  it("a held-back copy then Enter without typing copies the literal token", async () => {
    const user = userEvent.setup();
    mount();
    await pre("zzd 10.10.10.5 {SECOND_LPORT}");
    await navigator.clipboard.writeText("untouched");
    blockEl("zz-guard").focus();
    await user.keyboard("c");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Value for SECOND_LPORT" })).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("zzd 10.10.10.5 {SECOND_LPORT}"));
  });

  it("Enter in a field that was not the guard's target does nothing", async () => {
    const user = userEvent.setup();
    mount();
    await pre("zzd 10.10.10.5 {SECOND_LPORT}");
    await navigator.clipboard.writeText("untouched");
    await user.click(await screen.findByRole("combobox", { name: "Value for SECOND_LPORT" }));
    await user.keyboard("5{Enter}");
    expect(await navigator.clipboard.readText()).toBe("untouched");
  });

  it("the pane takes focus once: a later change to the list does not pull it back from a field", async () => {
    const user = userEvent.setup();
    mount();
    await pre("zza 10.10.10.5");
    const field = await screen.findByRole("combobox", { name: "Value for SECOND_LPORT" });
    await user.click(field);
    expect(field).toHaveFocus();
    act(() => setImported({ commands: [A, B, GUARDED], cards: [CARD] }));
    await waitFor(() => expect(screen.queryByText("Charlie step")).not.toBeInTheDocument());
    expect(field).toHaveFocus();
  });

  it("Also in Raven is folded and includes oscp-notes commands", async () => {
    mount();
    await pre("zza 10.10.10.5");
    const toggle = screen.getByRole("button", { name: /^Also in Raven/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Oscp note helper")).not.toBeInTheDocument();
    await userEvent.setup().click(toggle);
    expect(screen.getByText("Oscp note helper")).toBeInTheDocument();
    expect(screen.getByText("Raven helper")).toBeInTheDocument();
  });

  it("Open in Obsidian calls the API with the card's file", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Open in Obsidian" }));
    expect(m.openObsidian).toHaveBeenCalledWith("02-Cards/Zz/Zz Card.md");
  });
});

describe("CardView: the On this card strip follows the reading", () => {
  /** The IntersectionObserver the strip follows; tests say which blocks are in the reading band. */
  let observer: { cb: IntersectionObserverCallback; seen: Element[] } | null = null;
  class FakeObserver {
    constructor(cb: IntersectionObserverCallback) {
      observer = { cb, seen: [] };
    }
    observe(el: Element) { observer!.seen.push(el); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  const band = (visible: string[]) =>
    act(() => observer!.cb(
      observer!.seen.map((el) => ({ target: el, isIntersecting: visible.includes(el.id) }) as unknown as IntersectionObserverEntry),
      observer as unknown as IntersectionObserver,
    ));

  /** A stand-in for `document.fonts` (jsdom has none): the web fonts finish loading when the test says. */
  function fakeFonts(status: FontFaceSetLoadStatus) {
    const set = Object.assign(new EventTarget(), { status });
    Object.defineProperty(document, "fonts", { value: set, configurable: true });
    return {
      done: () => act(() => {
        set.status = "loaded";
        set.dispatchEvent(new Event("loadingdone"));
      }),
    };
  }

  /** The strip's scrolling row: 200px wide, its 90px labels 100px apart until `widen` spreads them as a wider font does. */
  const row = () => screen.getByRole("navigation", { name: "On this card" }).querySelector<HTMLElement>("[data-scroll-x]")!;
  let spread = 100;
  function layOutStrip() {
    Object.defineProperty(row(), "clientWidth", { configurable: true, value: 200 });
    row().querySelectorAll<HTMLElement>("button[data-for]").forEach((b, i) => {
      Object.defineProperty(b, "offsetLeft", { configurable: true, get: () => 4 + i * spread });
      Object.defineProperty(b, "offsetWidth", { configurable: true, value: 90 });
    });
  }
  const widen = (to: number) => (spread = to);

  beforeEach(() => {
    observer = null;
    spread = 100;
    globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    delete (globalThis as Partial<typeof globalThis>).IntersectionObserver;
    // jsdom has no document.fonts of its own.
    delete (document as { fonts?: FontFaceSet }).fonts;
  });

  it("scrolls the strip to an active entry out of its view", async () => {
    mount();
    await pre("zza 10.10.10.5");
    layOutStrip();
    band(["block-zz-c"]);
    expect(screen.getByRole("button", { name: "Charlie step" })).toHaveAttribute("aria-current", "location");
    expect(row().scrollLeft).toBe(196);
  });

  // RAV-58: a web font swapped in late (font-display: swap) moves the labels, so the strip lines the entry up again.
  it("lines the active entry up again once web fonts finish loading", async () => {
    const fonts = fakeFonts("loading");
    mount();
    await pre("zza 10.10.10.5");
    layOutStrip();
    band(["block-zz-c"]);
    expect(row().scrollLeft).toBe(196);
    widen(109); // Charlie step now starts at 222: still in view, but no longer lined up
    fonts.done();
    expect(row().scrollLeft).toBe(214);
  });

  it("leaves a strip scrolled by hand where it is when web fonts finish loading", async () => {
    const fonts = fakeFonts("loading");
    mount();
    await pre("zza 10.10.10.5");
    layOutStrip();
    band(["block-zz-c"]);
    act(() => {
      row().scrollLeft = 150; // the reader scrolled the strip; Charlie step is still in view
    });
    widen(109);
    fonts.done();
    expect(row().scrollLeft).toBe(150);
  });
});
