import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommandList } from "../features/checklist/CommandList";
import { TitleBarButton } from "../ui/TitleBar";

describe("a11y leftovers", () => {
  it("title bar button names contain their visible word; the kbd hint is hidden from the name", () => {
    render(<TitleBarButton hint="A">Arsenal</TitleBarButton>);
    const b = screen.getByRole("button", { name: "Arsenal" });
    expect(b).not.toHaveAttribute("aria-label");
    expect(b.querySelector("kbd")).toHaveAttribute("aria-hidden", "true");
  });

  it("command blocks are named and add no Tab stop", () => {
    render(<CommandList commands={[{ id: "a", title: "Run it", text: "id", unresolved: [], msfMarker: false }]} />);
    const pre = screen.getAllByTestId("command-block")[0]!.querySelector("pre")!;
    expect(pre).toHaveAccessibleName("Command: Run it");
    expect(pre.getAttribute("tabindex")).toBeNull();
  });
});
