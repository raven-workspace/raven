import { describe, expect, it } from "vitest";
import { revealRow } from "../lib/revealRow";

const rectOf = (top: number, bottom: number) => () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
function setup(rowTop: number, rowBottom: number) {
  const scroller = document.createElement("div");
  const row = document.createElement("tr");
  scroller.getBoundingClientRect = rectOf(100, 300);
  Object.defineProperty(scroller, "clientHeight", { value: 200 });
  row.getBoundingClientRect = rectOf(rowTop, rowBottom);
  return { scroller, row };
}

describe("revealRow", () => {
  it("scrolls down just enough to show a row below the fold", () => {
    const { scroller, row } = setup(350, 400);
    revealRow(scroller, row, 40);
    expect(scroller.scrollTop).toBe(100);
  });
  it("scrolls up so a row hidden under the sticky header starts at its bottom edge", () => {
    const { scroller, row } = setup(110, 160);
    revealRow(scroller, row, 40);
    expect(scroller.scrollTop).toBe(-30);
  });
  it("leaves a visible row alone", () => {
    const { scroller, row } = setup(200, 250);
    revealRow(scroller, row, 40);
    expect(scroller.scrollTop).toBe(0);
  });
});
