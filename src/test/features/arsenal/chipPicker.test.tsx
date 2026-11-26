import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChipPicker } from "../../../features/arsenal/ChipPicker/ChipPicker";
import type { ChipOption } from "../../../features/arsenal/ChipPicker/ChipPicker";

const OPTIONS: ChipOption[] = [
  { id: null, name: "No credential" },
  { id: "c1", name: "admin" },
  { id: "c2", name: "j.doe" },
  { id: "c3", name: "m.okafor" },
];

const picker = (value: string | null) => (
  <ChipPicker options={OPTIONS} value={value} onPick={vi.fn()} label="Fill with credential" listLabel="Fill with credential…" title="Credential" prefix="Cred" />
);

const highlighted = () => screen.getByRole("option", { selected: true });

describe("ChipPicker", () => {
  it("an open list follows a value that arrives after it opened (RAV-60)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(picker(null));
    const chip = screen.getByRole("button", { name: "Fill with credential" });
    await user.click(chip);
    expect(highlighted()).toHaveTextContent("No credential");
    rerender(picker("c3"));
    expect(highlighted()).toHaveTextContent("m.okafor");
    expect(chip).toHaveAttribute("aria-activedescendant", highlighted().id);
  });

  it("once the user moves the highlight, a new value leaves it where they put it (RAV-60)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(picker(null));
    const chip = screen.getByRole("button", { name: "Fill with credential" });
    await user.click(chip);
    await user.keyboard("{ArrowDown}");
    expect(highlighted()).toHaveTextContent("admin");
    rerender(picker("c3"));
    expect(highlighted()).toHaveTextContent("admin");
    expect(chip).toHaveAttribute("aria-activedescendant", highlighted().id);
  });
});
