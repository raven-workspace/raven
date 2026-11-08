import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../ui";
import { CommandBlock } from "../../ui/CommandBlock";

vi.mock("../../lib/clipboard", () => ({
  copyPlain: vi.fn(() => Promise.reject(new Error("vault locked"))),
  copySecret: vi.fn(() => Promise.resolve()),
}));
const reportError = vi.hoisted(() => vi.fn());
vi.mock("../../lib/lockSignal", () => ({ reportError }));

describe("CommandBlock copy", () => {
  it("a failed default copy goes to reportError", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <CommandBlock text="whoami" />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "vault locked" })));
  });

  // The done check replaces the Copy glyph only once the copy succeeded.
  const glyph = () => screen.getByRole("button", { name: "Copy" }).querySelector("svg")!.innerHTML;

  it("a failed default copy never shows the done check", async () => {
    const user = userEvent.setup();
    render(<CommandBlock text="whoami" />);
    const before = glyph();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await vi.waitFor(() => expect(reportError).toHaveBeenCalled());
    expect(glyph()).toBe(before);
  });

  it("a rejected onCopyAction goes to reportError and shows no done check", async () => {
    reportError.mockClear();
    const user = userEvent.setup();
    const onCopyAction = vi.fn(() => Promise.reject(new Error("guard failed")));
    render(<CommandBlock text="whoami" onCopyAction={onCopyAction} />);
    const before = glyph();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "guard failed" })));
    expect(glyph()).toBe(before);
  });

  it("a successful copy shows the done check", async () => {
    const user = userEvent.setup();
    render(<CommandBlock text="whoami" copyText="secret" />);
    const before = glyph();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await vi.waitFor(() => expect(glyph()).not.toBe(before));
  });
});
