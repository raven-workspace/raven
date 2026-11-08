import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copy, PencilSimple } from "@phosphor-icons/react";
import { describe, expect, it } from "vitest";
import { IconButton, Tooltip, TooltipProvider } from "../../ui";

describe("Tooltip", () => {
  it("shares the app's provider, so moving along a toolbar skips the open delay", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <IconButton icon={Copy} label="Copy" />
        <IconButton icon={PencilSimple} label="Edit" />
      </TooltipProvider>,
    );
    const copy = screen.getByRole("button", { name: "Copy" });
    const edit = screen.getByRole("button", { name: "Edit" });
    await user.hover(copy);
    await screen.findByRole("tooltip");
    expect(copy).toHaveAttribute("data-state", "delayed-open");
    await user.unhover(copy);
    // Leave Copy's hover grace area (jsdom has no geometry, so move well away first), then onto Edit.
    fireEvent.pointerMove(document.body, { pointerType: "mouse", clientX: 900, clientY: 900 });
    expect(copy).toHaveAttribute("data-state", "closed");
    await user.hover(edit);
    // A per-instance provider would wait its own delay again ("closed" here, then "delayed-open").
    expect(edit).toHaveAttribute("data-state", "instant-open");
  });

  it("works with no provider ancestor (standalone component tests)", async () => {
    render(
      <Tooltip content="Hello">
        <button type="button">Target</button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Hello");
  });

  it("can open to the side and stay off", async () => {
    render(
      <>
        <Tooltip content="Right" side="right">
          <button type="button">A</button>
        </Tooltip>
        <Tooltip content="Never" disabled>
          <button type="button">B</button>
        </Tooltip>
      </>,
    );
    screen.getByRole("button", { name: "A" }).focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Right");
    screen.getByRole("button", { name: "B" }).focus();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Never")).toBeNull();
  });
});
