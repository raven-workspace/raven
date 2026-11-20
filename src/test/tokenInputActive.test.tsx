import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TokenInput } from "../features/palette/TokenInput/TokenInput";

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
    // jsdom applies no stylesheets: the active option's rule carries the accent marker (TokenInput.scss).
    expect(b).toHaveClass("token-input__option");
    const scss = readFileSync("src/features/palette/TokenInput/TokenInput.scss", "utf8");
    const option$ = scss.slice(scss.indexOf(".token-input__option {"));
    expect(option$.slice(option$.indexOf('&[aria-selected="true"]'))).toMatch(/^&\[aria-selected="true"\] \{[^}]*box-shadow: inset 2px 0 0 var\(--accent\);/);
  });
});
