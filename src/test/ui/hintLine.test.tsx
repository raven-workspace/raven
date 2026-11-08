import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HintLine, type Hint } from "../../ui";

const hints: Hint[] = [
  { keys: "↵", label: "Open", priority: 1 },
  { keys: "⌘K", label: "Search", priority: 3 },
  { keys: "⇥", label: "Next", priority: 2 },
  { keys: "⌘C", label: "Copy", priority: 4 },
  { keys: "⌥1–6", label: "Stage", priority: 5 },
  { keys: "⌘D", label: "Delete", priority: 6 },
  { keys: "Esc", label: "Close", priority: 1 },
];

const line = () => document.querySelector("[data-hint-line]") as HTMLElement;
const inLine = () => within(line());

afterEach(() => vi.restoreAllMocks());

describe("HintLine", () => {
  it("shows at most 5 hints", () => {
    render(<HintLine hints={hints} ariaLabel="Keys" />);
    expect(line().querySelectorAll("[data-hint]")).toHaveLength(5);
    expect(inLine().queryByText("Delete")).toBeNull();
  });

  it("no middot in the rendered text", () => {
    render(<HintLine hints={hints} ariaLabel="Keys" />);
    expect(line().textContent).not.toMatch(/[·•|]/);
  });

  it("drops lowest priority first when narrow", () => {
    // 100px per rendered hint plus 100 for the ? button; only 400px available.
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-hint-line") ? (this.querySelectorAll("[data-hint]").length + 1) * 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-hint-line") ? 400 : 0;
    });
    render(<HintLine hints={hints} ariaLabel="Keys" />);
    const shown = [...line().querySelectorAll("[data-hint]")].map((e) => e.textContent);
    expect(shown).toEqual(["↵Open", "⇥Next", "EscClose"]);
    expect(inLine().getByRole("button", { name: "All shortcuts" })).toBeInTheDocument();
  });

  it("? opens the full list", async () => {
    render(<HintLine hints={hints} ariaLabel="Keys" />);
    await userEvent.click(screen.getByRole("button", { name: "All shortcuts" }));
    const pop = await screen.findByRole("dialog");
    for (const h of hints) expect(within(pop).getByText(h.label)).toBeInTheDocument();
  });

  it("? key opens the list from inside the surface", async () => {
    render(
      <div data-hint-surface>
        <button>Focusable</button>
        <HintLine hints={hints} ariaLabel="Keys" />
      </div>,
    );
    await userEvent.tab();
    await userEvent.keyboard("?");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("? key ignored while typing", async () => {
    render(
      <div data-hint-surface>
        <input aria-label="Query" />
        <HintLine hints={hints} ariaLabel="Keys" />
      </div>,
    );
    await userEvent.type(screen.getByLabelText("Query"), "?");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
