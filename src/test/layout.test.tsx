import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandList } from "../features/checklist/CommandList";
import { CredentialPicker } from "../features/checklist/CredentialPicker";
import { GoalRow } from "../features/checklist/GoalRow";
import type { Credential } from "../types/credentials";

// jsdom has no layout: these check the classes that decide wrapping (U5–U7).
const cred: Credential = {
  id: "c1", engagementId: "e1", type: "hash", username: "tom_admin", domain: "OFFSEC.EXAM", secret: "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0",
  hashType: "ntlm", scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1,
};

describe("layout (U5–U7)", () => {
  it("U5: the Commands use label sits on its own line above a full-width picker that ellipsizes with a title", () => {
    render(<CredentialPicker credentials={[cred]} value={cred} onChange={() => {}} />);
    const label = screen.getByText("Commands use:");
    const picker = screen.getByRole("combobox", { name: "Commands use" });
    expect(label.parentElement).toBe(picker.parentElement);
    expect(label.parentElement!.className).toMatch(/flex-col/);
    expect(picker.className).toMatch(/w-full/);
    expect(picker.getAttribute("title")).toContain("tom_admin");
    expect(picker.querySelector(".truncate")).not.toBeNull();
  });

  it("U6: command blocks wrap at whitespace and never scroll sideways", () => {
    render(<CommandList commands={[{ id: "a", title: "Run it", text: "nxc smb 10.10.130.140 -u tom", unresolved: [], msfMarker: false }]} />);
    const pre = screen.getByText((_, el) => el?.tagName === "PRE");
    expect(pre.className).not.toMatch(/break-all|break-words|wrap-anywhere|wrap-break-word/);
    expect(pre.className).toMatch(/whitespace-pre-wrap/);
    expect(pre.className).toMatch(/overflow-x-hidden/);
  });

  it("Copy is an icon button in its own fixed grid track beside the block; the description is full width above", () => {
    render(<CommandList commands={[{ id: "a", title: "A long description of what this command does on the target", text: "id", unresolved: [], msfMarker: false }]} />);
    const copy = screen.getByRole("button", { name: /Copy command: A long description/ });
    const block = screen.getByTestId("command-block");
    expect(block).toContainElement(copy);
    // A fixed track for Copy, at least 8px from the text: the text never runs under it.
    expect(block.className).toMatch(/grid-cols-\[minmax\(0,1fr\)_1\.5rem\]/);
    expect(block.className).toMatch(/\bgap-2\b/);
    expect(copy.className).not.toMatch(/absolute/);
    expect(copy).toHaveAttribute("title", "Copy command");
    expect(copy.querySelector("svg")).not.toBeNull();
    const desc = screen.getByText(/A long description/);
    expect(block).not.toContainElement(desc);
    expect(desc.className).not.toMatch(/truncate/);
  });
  it("status is one small button group: four segments, exactly one pressed, a little space below", () => {
    render(
      <ul>
        <GoalRow goal={{ id: "g", title: "Scan it", why: "Because." }} state={{ status: "in_progress" }} commands={[]} evidence={[]} onStatus={vi.fn()} onNotes={vi.fn()} />
      </ul>,
    );
    const group = screen.getByRole("group", { name: "Status: Scan it" });
    const segs = within(group).getAllByRole("button");
    expect(segs.map((b) => b.textContent)).toEqual(["To do", "Doing", "Done", "N/A"]);
    expect(segs.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent)).toEqual(["Doing"]);
    expect(group.className).toMatch(/rounded-full/);
    expect(group.className).toMatch(/divide-x/);
    expect(screen.getByText("Because.").parentElement!.className).toMatch(/mt-3/);
  });

  it("a command wraps only at spaces: each word is a span that breaks only when longer than the line, the text and copy unchanged", () => {
    render(<CommandList commands={[{ id: "a", title: "Scan", text: "rustscan -a 10.10.20.15 -- -sC -sV", unresolved: [], msfMarker: false }]} />);
    const words = screen.getAllByTestId("command-word");
    expect(words.map((w) => w.textContent)).toEqual(["rustscan", "-a", "10.10.20.15", "--", "-sC", "-sV"]);
    for (const w of words) expect(w.className.split(" ")).toEqual(expect.arrayContaining(["inline-block", "max-w-full", "[overflow-wrap:anywhere]"]));
    expect(screen.getByTestId("command-block").querySelector("pre")!.textContent).toBe("rustscan -a 10.10.20.15 -- -sC -sV");
  });

  it("unresolved tokens stay marked inside their word", () => {
    render(<CommandList commands={[{ id: "a", title: "Get", text: "wget http://LHOST/x", unresolved: ["LHOST"], tokens: ["LHOST"], msfMarker: false }]} />);
    const mark = screen.getByText("LHOST");
    expect(mark.tagName).toBe("MARK");
    expect(mark.closest("[data-testid='command-word']")!.textContent).toBe("http://LHOST/x");
  });

  it("a DC picked by name is flagged on the command", () => {
    render(<CommandList commands={[{ id: "a", title: "Sync", text: "ntpdate 10.0.0.10", unresolved: [], msfMarker: false, dcByName: true }]} />);
    expect(screen.getByText("DC (by name)")).toBeInTheDocument();
  });
});
