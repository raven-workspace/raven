import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CvssBuilder } from "../features/findings/CvssBuilder";

function Harness({ initial = "", onEmit }: { initial?: string; onEmit?: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <CvssBuilder
        value={v}
        onChange={(next) => {
          onEmit?.(next);
          setV(next);
        }}
      />
      <output aria-label="vector">{v}</output>
    </>
  );
}

const pick = async (user: ReturnType<typeof userEvent.setup>, metric: string, option: string) =>
  user.click(within(screen.getByRole("group", { name: metric })).getByRole("button", { name: option }));

describe("CvssBuilder", () => {
  it("defaults to 4.0", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "CVSS 4.0" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Attack Requirements (AT)" })).toBeInTheDocument();
  });

  it("clicking AV:Network…A:High in 3.1 mode emits the 3.1 vector", async () => {
    const user = userEvent.setup();
    const onEmit = vi.fn();
    render(<Harness onEmit={onEmit} />);
    await user.click(screen.getByRole("button", { name: "CVSS 3.1" }));
    await pick(user, "Attack Vector (AV)", "Network");
    await pick(user, "Attack Complexity (AC)", "Low");
    await pick(user, "Privileges Required (PR)", "None");
    await pick(user, "User Interaction (UI)", "None");
    await pick(user, "Scope (S)", "Unchanged");
    await pick(user, "Confidentiality (C)", "High");
    await pick(user, "Integrity (I)", "High");
    // Nothing is written until every metric is picked.
    expect(onEmit).not.toHaveBeenCalled();
    await pick(user, "Availability (A)", "High");
    expect(onEmit).toHaveBeenLastCalledWith("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
    expect(screen.getByLabelText("CVSS score")).toHaveTextContent("9.8");
  });

  it("reads an existing 4.0 vector, shows its score and keeps extra metrics when one changes", async () => {
    const user = userEvent.setup();
    render(<Harness initial="CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:U" />);
    expect(screen.getByLabelText("CVSS score")).toHaveTextContent("8.1");
    expect(
      within(screen.getByRole("group", { name: "Attack Vector (AV)" })).getByRole("button", { name: "Network" }),
    ).toHaveAttribute("aria-pressed", "true");
    await pick(user, "Privileges Required (PR)", "Low");
    expect(screen.getByLabelText("vector")).toHaveTextContent(
      "CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:U",
    );
  });

  it("an unprefixed 3.x vector opens in 3.1 mode", () => {
    render(<Harness initial="AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" />);
    expect(screen.getByRole("button", { name: "CVSS 3.1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("CVSS score")).toHaveTextContent("9.8");
  });
});
