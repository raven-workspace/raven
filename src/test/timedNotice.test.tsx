import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TimedNotice } from "../ui";

function addGap(right: number) {
  const gap = document.body.appendChild(document.createElement("div"));
  gap.dataset.slot = "sidebar-gap";
  gap.getBoundingClientRect = () => ({ right }) as DOMRect;
  return gap;
}

afterEach(() => {
  document.querySelector('[data-slot="sidebar-gap"]')?.remove();
});

describe("TimedNotice", () => {
  it("renders into document.body, outside the tree that opened it", () => {
    const { container } = render(<TimedNotice onClose={() => {}}>Saved</TimedNotice>);
    const status = screen.getByRole("status");
    expect(container.contains(status)).toBe(false);
    expect(status.parentElement).toBe(document.body);
    expect(status).toHaveClass("timed-notice");
  });

  it("sits 16px right of the sidebar, expanded and collapsed", () => {
    const gap = addGap(240);
    render(<TimedNotice onClose={() => {}}>Saved</TimedNotice>);
    expect(screen.getByRole("status").style.left).toBe("256px");
    gap.getBoundingClientRect = () => ({ right: 56 }) as DOMRect;
    act(() => {
      gap.dispatchEvent(new Event("transitionend"));
    });
    expect(screen.getByRole("status").style.left).toBe("72px");
  });

  it("with no sidebar it sits 16px from the left edge", () => {
    render(<TimedNotice onClose={() => {}}>Saved</TimedNotice>);
    expect(screen.getByRole("status").style.left).toBe("16px");
  });
});
