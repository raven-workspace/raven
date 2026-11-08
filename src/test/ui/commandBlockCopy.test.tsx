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
});
