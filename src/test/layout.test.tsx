import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommandList } from "../features/checklist/CommandList";
import { CredentialPicker } from "../features/checklist/CredentialPicker";
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

  it("U6: command blocks wrap at whitespace only and scroll a long token", () => {
    render(<CommandList commands={[{ id: "a", title: "Run it", text: "nxc smb 10.10.130.140 -u tom", unresolved: [], msfMarker: false }]} />);
    const pre = screen.getByText((_, el) => el?.tagName === "PRE");
    expect(pre.className).not.toMatch(/break-all|break-words|wrap-anywhere|wrap-break-word/);
    expect(pre.className).toMatch(/whitespace-pre-wrap/);
    expect(pre.className).toMatch(/overflow-x-auto/);
  });

  it("U7: a command's description wraps beside a top-aligned Copy that never shrinks", () => {
    render(<CommandList commands={[{ id: "a", title: "A long description of what this command does on the target", text: "id", unresolved: [], msfMarker: false }]} />);
    const copy = screen.getByRole("button", { name: /Copy command/ });
    expect(copy.parentElement!.className).toMatch(/items-start/);
    expect(copy.className).toMatch(/shrink-0/);
    expect(screen.getByText(/A long description/).className).not.toMatch(/truncate/);
  });
});
