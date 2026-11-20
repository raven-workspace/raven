import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialForm } from "../features/credentials/CredentialForm/CredentialForm";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

beforeEach(() => {
  m.usernamesList.mockResolvedValue([]);
});

function mount() {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <CredentialForm eid="e1" hosts={[]} credentials={[]} onClose={() => {}} />
    </QueryClientProvider>,
  );
  return within(screen.getByRole("dialog"));
}

describe("pasting user:pass into the credential form", () => {
  it("fills username, domain, type and secret from a DOMAIN\\user:pass paste", async () => {
    const user = userEvent.setup();
    const dlg = mount();
    await user.click(dlg.getByLabelText("Username"));
    await user.paste("ACME\\svc_report:Winter2000!");
    expect(dlg.getByLabelText("Username")).toHaveValue("svc_report");
    expect(dlg.getByLabelText("Domain")).toHaveValue("ACME");
    expect(dlg.getByLabelText("Secret")).toHaveValue("Winter2000!");
    expect(dlg.getByRole("combobox", { name: "Type" })).toHaveTextContent("password");
  });

  it("pastes normally when the text is not a credential", async () => {
    const user = userEvent.setup();
    const dlg = mount();
    await user.click(dlg.getByLabelText("Username"));
    await user.paste("http://x:8080");
    expect(dlg.getByLabelText("Username")).toHaveValue("http://x:8080");
    expect(dlg.getByLabelText("Secret")).toHaveValue("");
  });
});
