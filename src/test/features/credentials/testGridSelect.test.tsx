import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TestGrid } from "../../../features/credentials/TestGrid";
import { makeQueryClient } from "../../../lib/queryClient";
import type { TriedPair } from "../../../types/credentials";
import { byHost, cred, hostWith } from "../../engines/credentials/fixtures";

vi.mock("../../../lib/api");

const h1 = hostWith("h1", "10.10.10.5", [22, 445]);
const creds = [
  cred({ id: "c1", username: "jay", domain: "ACME" }),
  cred({ id: "c2", username: "svc_sql", domain: "ACME" }),
];

const grid = (props: Partial<React.ComponentProps<typeof TestGrid>> = {}) =>
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <TestGrid eid="eng1" hosts={[h1.host]} creds={creds} attempts={[]} servicesByHost={byHost(h1)} {...props} />
    </QueryClientProvider>,
  );

describe("TestGrid selection", () => {
  it("without onSelect, row headers are plain text", () => {
    grid();
    expect(screen.queryAllByRole("button", { name: /^Select / })).toHaveLength(0);
  });

  it("clicking a row header selects it", () => {
    const onSelect = vi.fn();
    grid({ onSelect });
    fireEvent.click(screen.getByRole("button", { name: /^Select ACME\\svc_sql/ }));
    expect(onSelect).toHaveBeenCalledWith("c2");
  });

  it("the selected row is marked and its header has the accent bar", () => {
    grid({ onSelect: vi.fn(), selectedId: "c2" });
    const row = document.querySelector('[data-cred-id="c2"]')!;
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(row).toHaveAttribute("data-state", "selected");
    expect(row.querySelector("th")!.className).toContain("shadow-[inset_2px_0_0_var(--accent)]");
    expect(document.querySelector('[data-cred-id="c1"]')).not.toHaveAttribute("aria-selected");
  });

  it("arrow keys move focus between row headers without selecting", async () => {
    const onSelect = vi.fn();
    grid({ onSelect });
    const [first, second] = screen.getAllByRole("button", { name: /^Select / });
    first.focus();
    const user = userEvent.setup();
    await user.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    await user.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith("c2");
  });

  it("tried rows are not selectable", () => {
    const tried: TriedPair[] = [{
      id: "t1", engagementId: "eng1", username: "drew", domain: null, secret: "SyntheticPw01", secretKind: "password",
      hostId: "h1", service: "ssh", authMode: "domain", logEntryId: null, at: 1,
    }];
    grid({ onSelect: vi.fn(), tried });
    expect(screen.getByText("drew")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select drew/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Select / })).toHaveLength(2);
  });
});
