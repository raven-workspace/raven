import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { InventoryList } from "../features/credentials/InventoryList";
import { makeQueryClient } from "../lib/queryClient";
import type { CredAttempt, Credential, Username } from "../types/credentials";
import type { Host } from "../types/host";
import type { Service } from "../types/service";

vi.mock("../lib/api");

const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const SMB: Service = {
  id: "s1", hostId: "h1", port: 445, protocol: "tcp", state: "open", nmapService: "microsoft-ds", nmapVersion: null, confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
};
const cred = (o: Partial<Credential> & { id: string }): Credential => ({
  engagementId: "e1", type: "password", username: "", domain: null, secret: "", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...o,
});
const NT = "8846f7eaee8fb117ad06bdd830b7586c";
const user = (id: string, username: string): Username => ({ id, engagementId: "e1", username, domain: null, sourceHostId: null, source: null, createdAt: 1 });

const BASE: Credential[] = [
  cred({ id: "p1", username: "alice", secret: "Winter2024!" }),
  cred({ id: "p2", username: "bob", secret: "Summer2024!" }),
  cred({ id: "h1", type: "hash", username: "svc", secret: NT, hashType: "NTLM", crackStatus: "uncracked" }),
  cred({ id: "h2", type: "hash", username: "krbtgt", secret: "aad3b435b51404eeaad3b435b51404ee", hashType: "NTLM", crackStatus: "uncracked" }),
  cred({ id: "h3", type: "hash", username: "WS01$", secret: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", hashType: "NTLM", crackStatus: "uncracked" }),
  cred({ id: "t1", type: "ticket", username: "admin", secret: "ticket-data" }),
];

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function mount(over: { initial?: string; creds?: Credential[]; selectedId?: string; onSelect?: (id: string) => void; attempts?: CredAttempt[] } = {}) {
  const creds = over.creds ?? BASE;
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[`/${over.initial ?? ""}`]}>
        <Search />
        <InventoryList
          eid="e1" creds={creds} all={creds} hosts={[H1]} servicesByHost={new Map([["h1", [SMB]]])}
          attempts={over.attempts ?? []} usernames={[user("u1", "carol"), user("u2", "drew")]} grants={[]}
          selectedId={over.selectedId} onSelect={over.onSelect ?? (() => {})}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InventoryList", () => {
  const bar = () => within(screen.getByRole("radiogroup", { name: "Show kind" }));
  const headings = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.replace(/\s+/g, " ").trim());

  it("the filter bar lists All and only the kinds present, each with its count", () => {
    mount({ creds: BASE.filter((c) => c.type !== "ticket") });
    const items = bar().getAllByRole("radio");
    expect(items.map((i) => i.firstChild?.textContent)).toEqual(["All", "Passwords", "Hashes", "Machine accounts", "Usernames"]);
    expect(bar().getByRole("radio", { name: "All" })).toBeChecked();
    expect(within(bar().getByRole("radio", { name: /^Passwords/ })).getByText("2")).toHaveClass("tabular-nums");
    expect(bar().queryByRole("radio", { name: /Tickets/ })).toBeNull();
  });

  it("picking Hashes shows only that group and writes ?kind=hashes; All restores", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(bar().getByRole("radio", { name: /^Hashes/ }));
    expect(headings()).toEqual(["Hashes 2"]);
    expect(screen.getByTestId("search")).toHaveTextContent("?kind=hashes");
    await user.click(bar().getByRole("radio", { name: "All" }));
    expect(headings()).toHaveLength(5);
    expect(screen.getByTestId("search").textContent).toBe("");
  });

  it("a stale ?kind falls back to All", () => {
    const { unmount } = mount({ initial: "?kind=bogus" });
    expect(headings()).toHaveLength(5);
    expect(bar().getByRole("radio", { name: "All" })).toBeChecked();
    unmount();
    mount({ initial: "?kind=tickets", creds: BASE.filter((c) => c.type !== "ticket") });
    expect(screen.getAllByRole("radio", { name: "All", checked: true })).toHaveLength(1);
    expect(headings()).toEqual(["Passwords 2", "Hashes 2", "Machine accounts 1", "Usernames 2"]);
  });

  it("shows a Type column only where the group is mixed; hashes show their hash type", () => {
    mount();
    const headers = (group: string) => within(screen.getByRole("region", { name: group })).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers("Passwords")).not.toContain("Type");
    expect(headers("Hashes")).toContain("Hash type");
    expect(headers("Hashes")).not.toContain("Type");
    expect(headers("Tickets, keys and tokens")).toContain("Type");
    expect(headers("Machine accounts")).not.toContain("Type");
    expect(within(screen.getByRole("region", { name: "Hashes" })).getAllByText("NTLM")).toHaveLength(2);
  });

  it("groups by kind with counts, in order", () => {
    mount();
    const heads = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.replace(/\s+/g, " ").trim());
    expect(heads).toEqual(["Passwords 2", "Hashes 2", "Tickets, keys and tokens 1", "Machine accounts 1", "Usernames 2"]);
  });

  it("an empty group renders no heading", () => {
    mount({ creds: BASE.filter((c) => c.type !== "ticket") });
    expect(screen.queryByText(/Tickets, keys and tokens/)).toBeNull();
  });

  it("hash rows show state and crack status as separate columns", () => {
    const attempt: CredAttempt = {
      id: "a1", engagementId: "e1", credId: "h1", usernameId: null, hostId: "h1", service: "smb", port: null,
      result: "valid", authMode: "domain", detail: null, logEntryId: null, at: 1,
    };
    mount({ attempts: [attempt] });
    const row = screen.getByText("svc").closest("tr")!;
    expect(within(row).getByText("valid")).toBeInTheDocument();
    expect(within(row).getByText("uncracked")).toBeInTheDocument();
  });

  it("a hash with no crack status reads uncracked; cracked and uncracked are not accent, uncrackable is warn", () => {
    mount({
      creds: [
        cred({ id: "n1", type: "hash", username: "nullstatus", secret: "cccccccccccccccccccccccccccccccc", hashType: "NTLM", crackStatus: null }),
        cred({ id: "n2", type: "hash", username: "done", secret: "dddddddddddddddddddddddddddddddd", hashType: "NTLM", crackStatus: "cracked" }),
        cred({ id: "n3", type: "hash", username: "never", secret: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", hashType: "NTLM", crackStatus: "uncrackable" }),
      ],
    });
    const chip = (who: string, text: string) => within(screen.getByText(who).closest("tr")!).getByText(text);
    expect(chip("nullstatus", "uncracked")).toBeInTheDocument();
    expect(chip("nullstatus", "uncracked").className).not.toMatch(/accent|warn/);
    expect(chip("done", "cracked").className).not.toMatch(/accent|warn/);
    expect(chip("never", "uncrackable").className).toMatch(/warn/);
  });

  it("rows show no secret and no row actions", () => {
    mount();
    const group = screen.getByRole("region", { name: "Passwords" });
    expect(group).not.toHaveTextContent("Winter2024!");
    for (const el of group.querySelectorAll("[aria-label]")) {
      expect(el.getAttribute("aria-label")).not.toMatch(/^(Reveal|Copy|Edit|Delete|Crack)/);
    }
  });

  it("clicking a row selects it; the selected row is marked", async () => {
    const onSelect = vi.fn();
    const { unmount } = mount({ onSelect });
    await userEvent.click(screen.getByText("alice"));
    expect(onSelect).toHaveBeenCalledWith("p1");
    unmount();
    mount({ selectedId: "p2" });
    const row = screen.getByText("bob").closest("tr")!;
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(row).toHaveAttribute("data-state", "selected");
    expect(screen.getByText("alice").closest("tr")).toHaveAttribute("aria-selected", "false");
  });

  it("Enter selects and arrows move focus without selecting", async () => {
    const onSelect = vi.fn();
    mount({ onSelect });
    screen.getByText("alice").closest("tr")!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByText("bob").closest("tr")).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("scope renders value and host on two lines, not a middot string", () => {
    mount({ creds: [cred({ id: "l1", username: "admin", scope: "local", localHostId: "h1", secret: "Winter2024!" })] });
    const row = screen.getByTitle("admin").closest("tr")!;
    expect(row.textContent).not.toContain(" · ");
    const scope = within(row).getByText("local");
    const host = within(row).getByText("dc01");
    expect(scope).not.toBe(host);
    expect(host.parentElement).toBe(scope.parentElement);
    expect(host.className).toMatch(/(^|\s)block(\s|$)/);
  });

  it("a 60-character name truncates with a title", () => {
    const long = "a".repeat(60);
    mount({ creds: [cred({ id: "p9", username: long, secret: "x" })] });
    const el = screen.getByTitle(long);
    expect(el).toHaveClass("truncate");
  });
});
