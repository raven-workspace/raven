import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultList } from "../features/arsenal/ResultList";

const groups = [{ key: "g", rows: [
  { id: "r1", title: "A command with a very long descriptive title", tag: "nxc", mono: true, stack: true },
  { id: "r2", title: "A plain row", tag: "card" },
] }];

describe("ResultList", () => {
  it("every option carries its full title", () => {
    render(<ResultList id="l" label="L" groups={groups} selected={0} onActivate={() => {}} />);
    expect(screen.getByRole("option", { name: /very long/ })).toHaveAttribute("title", "A command with a very long descriptive title");
    expect(screen.getByRole("option", { name: /plain row/ })).toHaveAttribute("title", "A plain row");
  });

  it("a stacked row puts the tool on its own line under the title", () => {
    render(<ResultList id="l" label="L" groups={groups} selected={0} onActivate={() => {}} />);
    const stacked = screen.getByRole("option", { name: /very long/ });
    const tool = stacked.querySelector("span.font-mono")!;
    expect(tool).toHaveTextContent("nxc");
    expect(stacked).toHaveClass("grid-cols-[minmax(0,1fr)]");
    expect(screen.getByRole("option", { name: /plain row/ })).toHaveClass("grid-cols-[minmax(0,1fr)_auto]");
  });
});
