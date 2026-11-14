import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
import { AUDIT_NOTE_IDS, AUDIT_NOTE_SOURCES } from "../../../audit/fixtures";
import type { FieldManualSnapshot } from "../../../engines/fieldManual/merge";
import { setImported } from "../../../engines/library/store";
import { parseNote, type ManualNote } from "../../../engines/manual";
import { useArsenalStore } from "../../../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../../../features/arsenal/useFillScope";
import { useCaptureStore } from "../../../features/capture/useCaptureStore";
import { logCommand } from "../../../features/capture/logCommand";
import { useManualStore } from "../../../features/manual/useManualStore";
import { useNotesStore } from "../../../features/notes/useNotesStore";
import { usePaletteStore } from "../../../features/palette/usePaletteStore";
import { usePayloadsStore } from "../../../features/payloads/usePayloadsStore";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";

vi.mock("../../../lib/api");
vi.mock("../../../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../../../features/checklist/ticks")>()),
  resyncBoards: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../features/capture/logCommand", () => ({ logCommand: vi.fn(() => Promise.resolve({})) }));
const m = vi.mocked(api, true);

// Synthetic fixtures only: the audit's invented lookup note, RFC 5737 addresses, invented names.
const LOOKUP: ManualNote = AUDIT_NOTE_SOURCES.flatMap(([p, t]) => (p.includes("Zz-Error-Lookup") ? [parseNote(p, t)!] : []))[0]!;
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "zzfs01", ip: "198.51.100.21", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};

const snapshot = (notes: ManualNote[]): FieldManualSnapshot => ({
  importedAt: 1, cards: [], overlay: {}, added: [], playbook: [], toolkit: [], report: {} as FieldManualSnapshot["report"], notes,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

const at = (q: string) => `/manual/${AUDIT_NOTE_IDS.lookup}?q=${encodeURIComponent(q)}`;
function mount(entries: string[]) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/", ...entries]} initialIndex={entries.length}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId("where").textContent;
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });
const altDown = () => press("∂", { code: "ArrowDown", altKey: true });
const card = () => screen.findByRole("region", { name: "Answer" });
/** The card's command rows: one labelled group per command. */
const rows = (c: HTMLElement) => within(c).queryAllByRole("group", { name: /^Answer command: / });

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element["scrollIntoView"];
  useManualStore.setState({ place: null, history: [] });
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null, solo: null });
  usePayloadsStore.setState({ open: false });
  useNotesStore.setState({ open: false });
  setImported({ commands: [], cards: [] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "192.0.2.10", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
  });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1]);
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.payloadBuildsList.mockResolvedValue([]);
  m.fieldManualLoad.mockResolvedValue(snapshot([LOOKUP]));
  m.fieldManualLatestMtime.mockResolvedValue(null);
});
afterEach(() => {
  setImported({ commands: [], cards: [] });
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("answer card", () => {
  it("card shows for a lookup row hit", async () => {
    mount([at("STATUS_ZZ_EXPIRED")]);
    const c = await card();
    expect(within(c).getByText("STATUS_ZZ_EXPIRED")).toBeInTheDocument();
    expect(within(c).getByText("Zz login errors")).toBeInTheDocument();
    expect(within(c).getByText("The secret is right and has expired.")).toBeInTheDocument();
    expect(within(c).getByText("Usually: A service account nobody used for months.")).toBeInTheDocument();
    await waitFor(() => expect(rows(c)).toHaveLength(1));
    await waitFor(() =>
      expect(within(rows(c)[0]!).getByRole("button", { name: "Copy command: nxc smb 198.51.100.21 --pass-pol" })).toBeInTheDocument());
    // The action's words read as one line under the rows, without repeating the command.
    expect(c.querySelector("[data-card-action]")).toHaveTextContent(/^Check the password policy:$/);
    expect(within(c).getAllByRole("button", { name: /^Copy command: / })).toHaveLength(1);
  });

  it("a landing puts focus on the card's first command", async () => {
    mount([at("STATUS_ZZ_EXPIRED")]);
    const c = await card();
    await waitFor(() => expect(rows(c)[0]).toHaveFocus());
  });

  it("a ⌘K landing on a row the query does not match lights that row, shows its card and focuses its first command", async () => {
    // "login" is in the heading, the caption and STATUS_ZZ_NOSVC's means, never in STATUS_ZZ_EXPIRED's row (row 2).
    mount([`/manual/${AUDIT_NOTE_IDS.lookup}?q=login&row=2#table-1`]);
    const c = await card();
    expect(within(c).getByText("STATUS_ZZ_EXPIRED")).toBeInTheDocument();
    await waitFor(() => expect(rows(c)[0]).toHaveFocus());
    expect(document.querySelector("[data-table='table-1'] tr[data-current-row]")).toHaveAttribute("data-row", "2");
    // No match is current: the bar counts them without claiming one.
    expect(document.querySelector("mark[data-current]")).toBeNull();
    expect(screen.getByRole("status", { name: "Search in this note" })).toHaveTextContent(/login3 matches$/);
    // ⌥↓ goes on from the row: the next match after it is STATUS_ZZ_NOSVC's.
    altDown();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Answer" })).getByText("STATUS_ZZ_NOSVC")).toBeInTheDocument());
    expect(screen.getByRole("status", { name: "Search in this note" })).toHaveTextContent(/match 3 of 3$/);
  });

  it("with the card shown, the current match is centred again (the card took room above it)", async () => {
    // Each centring scroll, with the key the card showed at that moment.
    const calls: { el: Element; card: string | null }[] = [];
    Element.prototype.scrollIntoView = function (this: Element, opts?: boolean | ScrollIntoViewOptions) {
      if (typeof opts === "object" && opts.block === "center") {
        calls.push({ el: this, card: document.querySelector("[aria-label=Answer] p.font-mono")?.textContent ?? null });
      }
    };
    // "secret": STATUS_ZZ_LOGON's means first, then STATUS_ZZ_EXPIRED's.
    mount([at("secret")]);
    const c = await card();
    await waitFor(() => expect(rows(c)[0]).toHaveFocus());
    expect(within(c).getByText("STATUS_ZZ_LOGON")).toBeInTheDocument();
    calls.length = 0;
    altDown();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Answer" })).getByText("STATUS_ZZ_EXPIRED")).toBeInTheDocument());
    const current = document.querySelector("mark[data-current]")!;
    expect(current.closest("tr")).toHaveAttribute("data-row", "2");
    // ⌥↓ centres it while the old card still shows; once the new card is in, it is centred again.
    expect(calls.some((x) => x.el === current && x.card === "STATUS_ZZ_EXPIRED")).toBe(true);
  });

  it("the action line keeps only what is not a command, separators folded", async () => {
    mount([at("STATUS_ZZ_NOSVC")]);
    const c = await card();
    await waitFor(() => expect(rows(c)).toHaveLength(2));
    const line = c.querySelector<HTMLElement>("[data-card-action]")!;
    expect(line).toHaveTextContent(/^Restart it: then; or retry with --local-auth\.$/);
    expect(within(line).queryByRole("button")).toBeNull();
    expect(line.querySelector("code")).toHaveTextContent("--local-auth");
  });

  it("the card link opens the Arsenal drawer at that card", async () => {
    const user = userEvent.setup();
    mount([at("STATUS_ZZ_SKEW")]);
    const c = await card();
    expect(within(c).getByText("↗ Arsenal")).toBeInTheDocument();
    await user.click(within(c).getByRole("button", { name: "Kerberos Enumeration" }));
    expect(useArsenalStore.getState()).toMatchObject({ open: true, cardId: "enum-kerberos" });
  });

  it("card follows the row the current match is in", async () => {
    mount([at("status_zz_lo")]);
    const c = await card();
    expect(within(c).getByText("STATUS_ZZ_LOGON")).toBeInTheDocument();
    altDown();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Answer" })).getByText("STATUS_ZZ_LOCKED")).toBeInTheDocument());
    expect(within(screen.getByRole("region", { name: "Answer" })).queryByText("STATUS_ZZ_LOGON")).toBeNull();
  });

  it("card without commands", async () => {
    mount([at("STATUS_ZZ_LOCKED")]);
    const c = await card();
    expect(within(c).getByText("STATUS_ZZ_LOCKED")).toBeInTheDocument();
    expect(within(c).getByText("The account is locked for the lockout window.")).toBeInTheDocument();
    expect(within(c).getByText("Usually: A spray without a delay.")).toBeInTheDocument();
    expect(rows(c)).toHaveLength(0);
    expect(within(c).getByText("Stop spraying that account and wait out the window.")).toBeInTheDocument();
  });

  it("no card for prose or non-lookup tables", async () => {
    mount([at("login errors")]);
    await screen.findByRole("status", { name: "Search in this note" });
    await screen.findByText(/match 1 of/);
    expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
  });

  it("Esc closes the card first", async () => {
    mount([at("STATUS_ZZ_EXPIRED")]);
    await card();
    press("Escape");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Answer" })).toBeNull());
    expect(screen.getByRole("status", { name: "Search in this note" })).toBeInTheDocument();
    expect(where()).toContain("?q=");
    press("Escape");
    await waitFor(() => expect(screen.queryByRole("status", { name: "Search in this note" })).toBeNull());
    expect(where()).toBe(`/manual/${AUDIT_NOTE_IDS.lookup}`);
    press("Escape");
    await waitFor(() => expect(where()).toBe("/"));
  });

  it("Esc with focus in the card returns focus to the note", async () => {
    mount([at("STATUS_ZZ_EXPIRED")]);
    const c = await card();
    await waitFor(() => expect(rows(c)[0]).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Answer" })).toBeNull());
    expect(screen.getByRole("region", { name: "Note" })).toHaveFocus();
  });

  it("more than three commands collapse", async () => {
    const user = userEvent.setup();
    mount([at("STATUS_ZZ_RELAY")]);
    const c = await card();
    await waitFor(() => expect(rows(c)).toHaveLength(3));
    expect(within(c).queryByText(/zzrelay drop/)).toBeNull();
    // Only commands and commas: no action line.
    expect(c.querySelector("[data-card-action]")).toBeNull();
    await user.click(within(c).getByRole("button", { name: "+ 1 more" }));
    await waitFor(() => expect(rows(c)).toHaveLength(4));
    expect(within(c).queryByRole("button", { name: "+ 1 more" })).toBeNull();
    expect(within(rows(c)[3]!).getByRole("button", { name: "Copy command: zzrelay drop 198.51.100.21" })).toBeInTheDocument();
  });

  it("↓ ↑ move between command rows; ↓ onto + n more opens it on its first command; ↵ copies, ⌘↵ logs as table: key", async () => {
    const user = userEvent.setup();
    mount([at("STATUS_ZZ_RELAY")]);
    const c = await card();
    await waitFor(() => expect(rows(c)).toHaveLength(3));
    const [a, b, d] = rows(c);
    a!.focus();
    await user.keyboard("{ArrowDown}");
    expect(b).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(d).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    // ↓ onto "+ 1 more" opens it, focus on the first command it brought in.
    await waitFor(() => expect(rows(c)).toHaveLength(4));
    expect(within(c).queryByRole("button", { name: "+ 1 more" })).toBeNull();
    await waitFor(() => expect(rows(c)[3]).toHaveFocus());
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(b).toHaveFocus();
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("zzrelay sign 198.51.100.21"));
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(vi.mocked(logCommand)).toHaveBeenCalled());
    expect(vi.mocked(logCommand).mock.calls[0]![1]).toMatchObject({ command: "zzrelay sign 198.51.100.21", title: "Zz login errors: STATUS_ZZ_RELAY" });
  });
});
