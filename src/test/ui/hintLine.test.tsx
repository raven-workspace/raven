import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
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
  it("renders a two-key hint as two caps in one unit", () => {
    render(<HintLine hints={[{ keys: "⌥H ⌥C", label: "host, credential", priority: 1 }]} ariaLabel="Keys" />);
    const unit = line().querySelector("[data-hint]")!;
    expect(unit.querySelectorAll("kbd")).toHaveLength(2);
    expect(unit).toHaveTextContent("host, credential");
  });

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

  it("? key ignored in a select", async () => {
    render(
      <div data-hint-surface>
        <select aria-label="Pick"><option>a</option></select>
        <HintLine hints={hints} ariaLabel="Keys" />
      </div>,
    );
    screen.getByLabelText("Pick").focus();
    await userEvent.keyboard("?");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nested surfaces: only the innermost opens", async () => {
    render(
      <div data-hint-surface>
        <HintLine hints={[{ keys: "A", label: "Outer", priority: 1 }]} ariaLabel="Outer keys" />
        <div data-hint-surface>
          <button>Inner</button>
          <HintLine hints={[{ keys: "B", label: "Inner hint", priority: 1 }]} ariaLabel="Inner keys" />
        </div>
      </div>,
    );
    screen.getByRole("button", { name: "Inner" }).focus();
    await userEvent.keyboard("?");
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  });

  it("never drops priority-1 hints", () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(999);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(10);
    render(<HintLine hints={hints} ariaLabel="Keys" />);
    expect([...line().querySelectorAll("[data-hint]")].map((e) => e.textContent)).toEqual(["↵Open", "EscClose"]);
  });

  it("hints reappear when the container widens (observer on the parent)", () => {
    let cb: () => void = () => {};
    let observed: Element | null = null;
    const Orig = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(c: () => void) { cb = c; }
      observe(el: Element) { observed = el; }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    let avail = 300;
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-hint-line") ? (this.querySelectorAll("[data-hint]").length + 1) * 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-hint-line") ? avail : 0;
    });
    try {
      render(<div data-testid="parent"><HintLine hints={hints} ariaLabel="Keys" /></div>);
      expect(observed).toBe(screen.getByTestId("parent"));
      expect(line().querySelectorAll("[data-hint]")).toHaveLength(2);
      avail = 600;
      act(() => cb());
      expect(line().querySelectorAll("[data-hint]")).toHaveLength(5);
    } finally {
      globalThis.ResizeObserver = Orig;
    }
  });
});
