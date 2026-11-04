import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button, Chip, Dialog, Field, Input } from "../ui";

function DialogHarness() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen} title="New engagement" description="Create one">
      <p>dialog body</p>
    </Dialog>
  );
}

describe("ui", () => {
  it("Dialog closes on Escape", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New engagement")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Field shows error message and aria-invalid", () => {
    render(
      <Field label="Name" error="Name is required">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const msg = screen.getByText("Name is required");
    expect(input.getAttribute("aria-describedby")).toContain(msg.id);
  });

  it("Field without error is not invalid", () => {
    render(
      <Field label="Name" hint="As shown on the dashboard">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input.getAttribute("aria-describedby")).toContain(screen.getByText("As shown on the dashboard").id);
  });

  it("Button exposes its variant and defaults to type=button", () => {
    render(<Button variant="primary">Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toHaveAttribute("data-variant", "primary");
    expect(b).toHaveAttribute("type", "button");
  });

  it("Chip exposes its variant", () => {
    render(<Chip variant="accent">user · vega</Chip>);
    expect(screen.getByText("user · vega")).toHaveAttribute("data-variant", "accent");
  });
});
