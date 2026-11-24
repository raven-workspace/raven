import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { HostChip, isHostPickKey } from "../features/arsenal/HostChip/HostChip";
import { HostChips } from "../features/capture/HostChips/HostChips";
import type { HostChipHandle } from "../features/arsenal/HostChip/HostChip";
import type { Host } from "../types/host";

const host = (id: string, name: string, ip: string | null): Host => ({
  id, engagementId: "e1", name, ip, os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const HOSTS = [host("h1", "dc01.corp.local", "10.10.10.5"), host("h2", "web07", "10.10.10.6"), host("h3", "sql03", null)];

function setup(value: string | null = "h1") {
  const onChange = vi.fn();
  const ref = createRef<HostChipHandle>();
  render(
    <form>
      <input aria-label="first" />
      <HostChip ref={ref} hosts={HOSTS} value={value} onChange={onChange} />
      <input aria-label="last" />
    </form>,
  );
  return { onChange, ref, chip: () => screen.getByRole("button", { name: /^Fill for host/ }) };
}

describe("HostChip", () => {
  it("host and credential pickers are tabbable triggers: labelled with the short host name, in the Tab order", async () => {
    const user = userEvent.setup();
    const { chip } = setup();
    expect(chip()).toHaveAccessibleName("Fill for host dc01");
    expect(chip()).toHaveAttribute("aria-haspopup", "listbox");
    expect(chip()).not.toHaveAttribute("tabindex", "-1");
    expect(chip()).toHaveTextContent(/^Host\s*dc01/);
    await user.click(screen.getByLabelText("first"));
    await user.tab();
    expect(chip()).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("last")).toHaveFocus();
  });

  it("host chip with no host reads \"No host\" with no Host prefix, and is named for what picking does (RAV-21)", () => {
    render(<HostChip hosts={HOSTS} value={null} onChange={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Fill for host" });
    expect(chip).toHaveTextContent(/^No host$/);
  });

  it("with a host the accessible name says what picking does and holds the visible text (RAV-21)", () => {
    setup("h2");
    const chip = screen.getByRole("button", { name: "Fill for host web07" });
    expect(chip).toHaveTextContent(/^Host\s*web07$/);
    expect(chip.getAttribute("aria-label")!.toLowerCase()).toContain("host web07");
  });

  it("the list is at least as wide as the trigger", async () => {
    const user = userEvent.setup();
    const { chip } = setup();
    await user.click(chip());
    // ChipPicker.scss: the list is at least as wide as the trigger (min-width: max(100%, 12rem)) unless `wide`.
    expect(screen.getByRole("listbox")).toHaveClass("chip-picker__list");
    expect(screen.getByRole("listbox")).not.toHaveClass("chip-picker__list--wide");
  });

  it("typing while focus is elsewhere never changes the host", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.type(screen.getByLabelText("first"), "sq");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the handle opens the list; arrows and Enter pick; onChange gets the id", async () => {
    const user = userEvent.setup();
    const { onChange, ref, chip } = setup();
    await user.click(screen.getByLabelText("first"));
    act(() => ref.current?.open());
    const list = screen.getByRole("listbox", { name: "Fill for host" });
    expect(chip()).toHaveFocus();
    expect(chip()).toHaveAttribute("aria-expanded", "true");
    expect([...list.querySelectorAll("[role=option]")].map((o) => o.textContent)).toEqual(["No host", "dc01.corp.local10.10.10.5", "web0710.10.10.6", "sql03"]);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("h2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("first")).toHaveFocus();
  });

  it("Esc closes only the list and returns focus; typeahead works inside the list", async () => {
    const user = userEvent.setup();
    const { onChange, ref } = setup();
    await user.click(screen.getByLabelText("first"));
    act(() => ref.current?.open());
    await user.keyboard("sq");
    expect(screen.getByRole("option", { name: /sql03/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("first")).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a click opens it and a click on an option picks, including No host", async () => {
    const user = userEvent.setup();
    const { onChange, chip } = setup();
    await user.click(chip());
    await user.click(screen.getByRole("option", { name: "No host" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("flashes on change, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { chip } = setup();
      expect(chip()).not.toHaveAttribute("data-flash");
      await user.click(chip());
      await user.click(screen.getByRole("option", { name: /web07/ }));
      expect(chip()).toHaveAttribute("data-flash");
      act(() => void vi.advanceTimersByTime(700));
      expect(chip()).not.toHaveAttribute("data-flash");
    } finally {
      vi.useRealTimers();
    }
  });

  it("⌥H is recognised by key code", () => {
    expect(isHostPickKey({ altKey: true, metaKey: false, ctrlKey: false, code: "KeyH", key: "˙" })).toBe(true);
    expect(isHostPickKey({ altKey: false, metaKey: false, ctrlKey: false, code: "KeyH", key: "h" })).toBe(false);
  });
});

describe("host pickers when hosts fail to load (RAV-22)", () => {
  it("HostChip says Couldn't load hosts with Retry, offers no list, and ⌥H's open() retries", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const ref = createRef<HostChipHandle>();
    render(<HostChip ref={ref} hosts={[]} value={null} onChange={vi.fn()} loadError={{ retry }} />);
    expect(screen.getByText("Couldn't load hosts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Fill for host/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    act(() => ref.current!.open());
    expect(retry).toHaveBeenCalledTimes(2);
    act(() => ref.current!.focus());
    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
  });

  it("with no error and no hosts, the chip still reads No host", () => {
    render(<HostChip hosts={[]} value={null} onChange={vi.fn()} loadError={null} />);
    expect(screen.getByRole("button", { name: "Fill for host" })).toHaveTextContent(/^No host$/);
    expect(screen.queryByText("Couldn't load hosts")).toBeNull();
  });

  it("Capture's HostChips says Couldn't load hosts with Retry instead of No host", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = render(<HostChips hosts={[]} linked={[]} onLinked={vi.fn()} loadError={{ retry }} />);
    expect(screen.getByText("Couldn't load hosts")).toBeInTheDocument();
    expect(screen.queryByText("No host")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<HostChips hosts={[]} linked={[]} onLinked={vi.fn()} />);
    expect(screen.getByText("No host")).toBeInTheDocument();
  });
});

