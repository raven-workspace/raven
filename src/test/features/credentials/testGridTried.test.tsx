import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestGrid } from "../../../features/credentials/TestGrid/TestGrid";
import { makeQueryClient } from "../../../lib/queryClient";
import type { TriedPair } from "../../../types/credentials";
import { byHost, cred, hostWith } from "../../engines/credentials/fixtures";

vi.mock("../../../lib/api");

const h1 = hostWith("h1", "10.10.10.5", [22, 445]);

const pair = (extra: Partial<TriedPair> = {}): TriedPair => ({
  id: "t1", engagementId: "eng1", username: "sam.doe", domain: null, secret: "SyntheticPw01", secretKind: "password",
  hostId: "h1", service: "ssh", authMode: "domain", logEntryId: null, at: 1, ...extra,
});

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={makeQueryClient()}>{ui}</QueryClientProvider>);

describe("TestGrid tried pairs", () => {
  it("TestGrid shows tried pairs muted under their username, never as a credential row", () => {
    wrap(
      <TestGrid
        eid="eng1"
        hosts={[h1.host]}
        creds={[cred({ id: "c1", username: "zoe", secret: "pw1" })]}
        attempts={[]}
        servicesByHost={byHost(h1)}
        tried={[pair(), pair({ id: "t2", username: "SAM.DOE", hostId: "h1", service: "smb" })]}
      />,
    );
    const label = screen.getByText("sam.doe");
    const row = label.closest("tr")!;
    expect(row).toHaveAttribute("data-tried", "");
    const ssh = within(row).getByRole("img", { name: /on h1 SSH/ });
    expect(ssh.getAttribute("aria-label")).toMatch(/failed/i);
    expect(within(row).getAllByRole("img").length).toBe(2);
    // One row for the pair, whatever the host/service or case.
    expect(document.querySelectorAll("tr[data-tried]").length).toBe(1);
    // Never a credential row, and the secret is not shown.
    expect(document.querySelectorAll("[data-cred-id]").length).toBe(1);
    expect(screen.getByText("zoe").closest("tr")).toHaveAttribute("data-cred-id", "c1");
    expect(screen.queryByText(/SyntheticPw01/)).toBeNull();
  });

  it("a tried row shows which secret was tried: a password masked with Reveal, a hash truncated", () => {
    const nt = "0123456789abcdef0123456789abcdef";
    wrap(
      <TestGrid
        eid="eng1"
        hosts={[h1.host]}
        creds={[]}
        attempts={[]}
        servicesByHost={byHost(h1)}
        tried={[pair(), pair({ id: "t2", username: "omar", secret: nt, secretKind: "hash" })]}
      />,
    );
    const pwRow = screen.getByText("sam.doe").closest("tr")!;
    expect(within(pwRow).getByTestId("secret-text")).toHaveTextContent("••••••••");
    expect(within(pwRow).queryByText(/SyntheticPw01/)).toBeNull();
    fireEvent.click(within(pwRow).getByRole("button", { name: /^Reveal secret/ }));
    expect(within(pwRow).getByTestId("secret-text")).toHaveTextContent("SyntheticPw01");
    expect(within(pwRow).getByText("tried password")).toBeInTheDocument();
    const hashRow = screen.getByText("omar").closest("tr")!;
    expect(within(hashRow).getByText("tried hash")).toBeInTheDocument();
    expect(within(hashRow).getByTestId("tried-secret")).toHaveTextContent("01234567…cdef");
    expect(within(hashRow).queryByText(nt)).toBeNull();
  });

  it("shows the grid for tried pairs alone", () => {
    wrap(<TestGrid eid="eng1" hosts={[h1.host]} creds={[]} attempts={[]} servicesByHost={byHost(h1)} tried={[pair()]} />);
    expect(screen.getByText("sam.doe")).toBeInTheDocument();
  });
});
