import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestGrid } from "../../../features/credentials/TestGrid/TestGrid";
import { makeQueryClient } from "../../../lib/queryClient";
import { att, byHost, cred, hostWith, NT } from "../../engines/credentials/fixtures";

vi.mock("../../../lib/api");

const h1 = hostWith("h1", "10.10.10.5", [22, 445]);

const grid = (props: Partial<React.ComponentProps<typeof TestGrid>>) =>
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <TestGrid eid="eng1" hosts={[h1.host]} creds={[]} attempts={[]} servicesByHost={byHost(h1)} {...props} />
    </QueryClientProvider>,
  );

const legend = () => within(screen.getByRole("list", { name: "Legend" }));

describe("TestGrid legend lists only the states the grid shows", () => {
  it("a password row on SMB and SSH: untested only, no N/A and no dashed entry", () => {
    grid({ creds: [cred({ id: "c1", username: "jay", domain: "ACME" })] });
    expect(legend().getByText("Untested")).toBeInTheDocument();
    expect(legend().queryByText("Not applicable")).toBeNull();
    expect(legend().queryByText("Other mode untried")).toBeNull();
    expect(legend().queryByText("Admin")).toBeNull();
    expect(legend().queryByText("Errored, retry")).toBeNull();
  });

  it("an NTLM hash has no SSH cell: N/A appears with the hatched cell", () => {
    grid({ creds: [cred({ id: "c2", type: "hash", secret: NT, username: "svc", domain: "ACME" })] });
    expect(screen.getByRole("img", { name: /SSH: not applicable/ })).toBeInTheDocument();
    expect(legend().getByText("Not applicable")).toBeInTheDocument();
  });

  it("shows admin and failed entries when attempts produce them, and each has a cell", () => {
    grid({
      creds: [cred({ id: "c1", username: "jay", domain: "ACME" })],
      attempts: [att({ credId: "c1", service: "smb", result: "admin" }), att({ credId: "c1", service: "ssh", result: "failed", authMode: "domain" })],
    });
    expect(legend().getByText("Admin")).toBeInTheDocument();
    expect(legend().getByText("Failed")).toBeInTheDocument();
    expect(legend().queryByText("Untested")).toBeNull();
  });

  it("the dashed entry appears exactly when a partial cell is rendered", () => {
    grid({
      creds: [cred({ id: "c1", username: "jay", domain: "ACME" })],
      attempts: [att({ credId: "c1", service: "smb", result: "failed", authMode: "domain" })],
    });
    const partial = screen.queryAllByTestId("untried-marker").length > 0;
    expect(legend().queryByText("Other mode untried") !== null).toBe(partial);
    expect(partial).toBe(true);
  });

  it("a tried row counts: failed and N/A come from its cells", () => {
    grid({
      tried: [{ id: "t1", engagementId: "eng1", username: "sam", domain: null, secret: "x", secretKind: "password", hostId: "h1", service: "ssh", authMode: "domain", logEntryId: null, at: 1 }],
      creds: [cred({ id: "c1", username: "jay" })],
    });
    expect(legend().getByText("Failed")).toBeInTheDocument();
    expect(legend().getByText("Not applicable")).toBeInTheDocument();
  });
});
