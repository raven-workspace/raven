import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThreadsList } from "../features/notes/ThreadsList/ThreadsList";

describe("ThreadsList", () => {
  it("renders nothing when the note has no open threads", () => {
    const { container } = render(<ThreadsList body={"just notes\n- a list"} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each open thread under a labelled section and closes by line", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ThreadsList body={"intro\n? is 445 reachable from the DMZ\nmiddle\n? \n? who owns svc_sql"} onClose={onClose} />);
    const section = screen.getByRole("region", { name: "3 open threads" });
    expect(within(section).getByRole("heading", { name: /Open threads 3/ })).toBeInTheDocument();
    expect(within(section).getByText("(empty)")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Close thread: who owns svc_sql" }));
    expect(onClose).toHaveBeenCalledWith(4, "who owns svc_sql");
  });

  it("does not count a thread inside a code fence, and names one thread in the singular", () => {
    render(<ThreadsList body={"```\n? not a thread\n```\n? real one"} onClose={() => {}} />);
    expect(screen.getByRole("region", { name: "1 open thread" })).toBeInTheDocument();
    expect(screen.queryByText("not a thread")).not.toBeInTheDocument();
  });
});
