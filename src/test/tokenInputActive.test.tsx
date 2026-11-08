import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TokenInput } from "../features/palette/TokenInput";

describe("TokenInput suggestions", () => {
  it("the pointer moves the one active row, which looks different from the rest", async () => {
    const user = userEvent.setup();
    render(<TokenInput name="USER" value="" onChange={() => {}} suggestions={[{ value: "alice" }, { value: "bob" }]} />);
    await user.click(screen.getByRole("combobox", { name: "Value for USER" }));
    await user.keyboard("{ArrowDown}");
    const [a, b] = screen.getAllByRole("option");
    expect(a).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseMove(b!);
    expect(a).toHaveAttribute("aria-selected", "false");
    expect(b).toHaveAttribute("aria-selected", "true");
    expect(b!.className).toContain("shadow-[inset_2px_0_0_var(--accent)]");
    expect(a!.className).not.toContain("shadow-[inset");
  });
});
