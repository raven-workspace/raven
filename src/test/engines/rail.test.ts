import { describe, expect, it } from "vitest";
import { RAIL_SECTIONS, railViewOf } from "../../engines/rail";
import { pageOf } from "../../engines/tabs";
import { SECTIONS } from "../../features/engagements/sections/sections";

const view = (route: string) => railViewOf(pageOf("e1", route));

describe("the rail's current view", () => {
  it("runs the sections in Raven's own order, so 1–6 count down the rail and Report keeps 7", () => {
    expect(SECTIONS.slice(0, 6).map((s) => s.id)).toEqual([...RAIL_SECTIONS]);
    expect(SECTIONS[6]!.id).toBe("report");
  });

  it("follows the route", () => {
    expect(view("/e/e1")).toBe("board");
    expect(view("/e/e1/s/log")).toBe("log");
    expect(view("/e/e1/s/checklist")).toBe("checklist");
    expect(view("/e/e1/notes")).toBe("notes");
    expect(view("/e/e1/notes/h1")).toBe("notes");
    expect(view("/e/e1/arsenal")).toBe("arsenal");
    expect(view("/e/e1/payloads?generator=x")).toBe("payloads");
    expect(view("/e/e1/manual/n1")).toBe("manual");
  });

  it("lights Explorer on the pages opened from it, and nothing on the Report", () => {
    expect(view("/e/e1/h/h1")).toBe("explorer");
    expect(view("/e/e1/f/f1")).toBe("explorer");
    expect(view("/e/e1/log-entry")).toBe("explorer");
    expect(view("/e/e1/s/report")).toBeNull();
  });

  it("an unknown section shows the board, so the board is current; another engagement's route lights nothing", () => {
    expect(view("/e/e1/s/nope")).toBe("board");
    expect(view("/e/e2/s/log")).toBeNull();
  });
});
