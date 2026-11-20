import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TestGrid } from "../../../features/credentials/TestGrid/TestGrid";
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
  it("a new onSelect function with the same selection does not scroll again", () => {
    const into = vi.spyOn(Element.prototype, "scrollIntoView");
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const r = this.tagName === "TR" ? { top: 500, bottom: 550 } : { top: 0, bottom: 0 };
      return { ...r, left: 0, right: 0, width: 0, height: r.bottom - r.top, x: 0, y: r.top, toJSON: () => ({}) };
    });
    const client = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    try {
      const ui = (onSelect: () => void) => (
        <QueryClientProvider client={makeQueryClient()}>
          <TestGrid eid="eng1" hosts={[h1.host]} creds={creds} attempts={[]} servicesByHost={byHost(h1)} selectedId="c2" onSelect={onSelect} />
        </QueryClientProvider>
      );
      const { rerender } = render(ui(() => {}));
      const scroller = document.querySelector("table")!.parentElement!;
      // Only the grid's own scroller moves, and never through scrollIntoView (which would scroll every ancestor too).
      expect(scroller.scrollTop).toBe(350);
      for (let e = scroller.parentElement; e; e = e.parentElement) expect(e.scrollTop).toBe(0);
      expect(into).not.toHaveBeenCalled();
      scroller.scrollTop = 0;
      rerender(ui(() => {}));
      expect(scroller.scrollTop).toBe(0);
    } finally {
      into.mockRestore();
      rect.mockRestore();
      client.mockRestore();
    }
  });

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
    expect(row.querySelector("th")).toHaveClass("test-grid__row-head--selected"); // the inset accent bar
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
