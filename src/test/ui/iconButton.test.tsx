import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copy, Trash } from "@phosphor-icons/react";
import { describe, expect, it } from "vitest";
import { IconButton, Row, TooltipProvider } from "../../ui";

function renderBtn(ui: React.ReactNode) {
  return render(<TooltipProvider delayDuration={300}>{ui}</TooltipProvider>);
}

describe("IconButton", () => {
  it("icon button names its action", () => {
    renderBtn(<IconButton icon={Copy} label="Copy" />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("tooltip shows on keyboard focus with the shortcut", async () => {
    renderBtn(<IconButton icon={Copy} label="Copy" shortcut="⌘C" />);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Copy" })).toHaveFocus();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Copy · ⌘C");
  });

  it("destructive tone is muted at rest", () => {
    renderBtn(<IconButton icon={Trash} label="Delete" tone="destructive" />);
    const b = screen.getByRole("button", { name: "Delete" });
    expect(b).toHaveClass("text-muted");
    expect(b).not.toHaveClass("text-warn");
  });
});

describe("Row", () => {
  it("Row renders the given tracks", () => {
    const { container } = render(<Row tracks="auto minmax(0,1fr) 96px">x</Row>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.gridTemplateColumns).toBe("auto minmax(0,1fr) 96px");
    expect(el.className).toMatch(/\bgrid\b/);
  });
});
