import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HopForm } from "../../features/network/HopForm/HopForm";
import { TunnelForm } from "../../features/network/TunnelForm/TunnelForm";
import { api } from "../../lib/api";
import { makeQueryClient } from "../../lib/queryClient";
import type { Host } from "../../types/host";
import type { Hop, Tunnel } from "../../types/network";

vi.mock("../../lib/api");
const m = vi.mocked(api, true);

const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "linux", boardColumn: "information-gathering", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const H1 = host("h1", "dc01", "10.10.10.5");
const H2 = host("h2", "web07", "10.10.10.6");
const tunnel: Tunnel = { id: "t1", engagementId: "e1", kind: "chisel", viaHostId: "h1", subnets: ["10.20.0.0/24"], callbackIp: "", status: "up", notes: null, createdAt: 1, updatedAt: 1 };
const hop: Hop = { id: "hp1", engagementId: "e1", fromHostId: null, toHostId: "h1", via: "creds", logEntryId: null, at: 1, updatedAt: 1 };

function wrap(ui: React.ReactElement) {
  return render(<QueryClientProvider client={makeQueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("TunnelForm", () => {
  it("validates subnets, then creates", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    m.tunnelCreate.mockResolvedValue({ ...tunnel, kind: "ligolo", callbackIp: "10.10.14.9" });
    wrap(<TunnelForm engagementId="e1" hosts={[H1, H2]} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: "Add tunnel" });
    await user.type(within(dialog).getByLabelText("Subnets"), "10.20.0.0/24, nonsense");
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(await within(dialog).findByText(/Not a valid subnet: nonsense/)).toBeInTheDocument();
    expect(m.tunnelCreate).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText("Subnets"));
    await user.type(within(dialog).getByLabelText("Subnets"), "10.20.0.0/24");
    await user.type(within(dialog).getByLabelText("Callback IP"), "10.10.14.9");
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(m.tunnelCreate).toHaveBeenCalledWith("e1", {
      kind: "ligolo", viaHostId: "h1", subnets: ["10.20.0.0/24"], callbackIp: "10.10.14.9", status: "up",
    });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows a server field error", async () => {
    const user = userEvent.setup();
    m.tunnelCreate.mockRejectedValue(Object.assign(new Error("Not an IPv4 address"), { field: "callbackIp" }));
    wrap(<TunnelForm engagementId="e1" hosts={[H1, H2]} onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Add tunnel" });
    await user.type(within(dialog).getByLabelText("Subnets"), "10.20.0.0/24");
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(await within(dialog).findByText("Not an IPv4 address")).toBeInTheDocument();
  });

  it("initial prefills the subnets and the via host of a new tunnel", async () => {
    const user = userEvent.setup();
    m.tunnelCreate.mockResolvedValue(tunnel);
    wrap(<TunnelForm engagementId="e1" hosts={[H1, H2]} initial={{ viaHostId: "h2", subnets: ["10.30.0.0/24", "10.31.0.0/24"] }} onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Add tunnel" });
    expect(within(dialog).getByLabelText("Subnets")).toHaveValue("10.30.0.0/24, 10.31.0.0/24");
    expect(within(dialog).queryByRole("button", { name: "Delete tunnel" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add tunnel" }));
    expect(m.tunnelCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ viaHostId: "h2", subnets: ["10.30.0.0/24", "10.31.0.0/24"] }));
  });

  it("editing offers Delete tunnel, which asks first", async () => {
    const user = userEvent.setup();
    m.tunnelDelete.mockResolvedValue(null);
    const onClose = vi.fn();
    wrap(<TunnelForm engagementId="e1" hosts={[H1, H2]} tunnel={tunnel} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: "Edit tunnel" });
    await user.click(within(dialog).getByRole("button", { name: "Delete tunnel" }));
    expect(m.tunnelDelete).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("dialog", { name: "Delete the Chisel tunnel via dc01?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete tunnel" }));
    expect(m.tunnelDelete).toHaveBeenCalledWith("t1");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Esc in the delete confirm closes only the confirm; the next Esc closes the form", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    wrap(<TunnelForm engagementId="e1" hosts={[H1, H2]} tunnel={tunnel} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: "Edit tunnel" });
    await user.click(within(dialog).getByRole("button", { name: "Delete tunnel" }));
    await screen.findByRole("dialog", { name: "Delete the Chisel tunnel via dc01?" });
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: /^Delete the/ })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Edit tunnel" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(m.tunnelDelete).not.toHaveBeenCalled();
  });
});

describe("HopForm", () => {
  it("a hop cannot go from a host to itself", async () => {
    const user = userEvent.setup();
    wrap(<HopForm engagementId="e1" hosts={[H1, H2]} onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Add hop" });
    await user.click(within(dialog).getByRole("combobox", { name: /^From/ }));
    await user.click(await screen.findByRole("option", { name: "dc01" }));
    await user.type(within(dialog).getByLabelText("Via"), "creds");
    await user.click(within(dialog).getByRole("button", { name: "Add hop" }));
    expect(await within(dialog).findByText("A hop needs two different hosts")).toBeInTheDocument();
    expect(m.hopCreate).not.toHaveBeenCalled();
  });

  it("adds a hop from Kali", async () => {
    const user = userEvent.setup();
    m.hopCreate.mockResolvedValue(hop);
    const onClose = vi.fn();
    wrap(<HopForm engagementId="e1" hosts={[H1, H2]} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: "Add hop" });
    await user.type(within(dialog).getByLabelText("Via"), "creds");
    await user.click(within(dialog).getByRole("button", { name: "Add hop" }));
    expect(m.hopCreate).toHaveBeenCalledWith("e1", { fromHostId: null, toHostId: "h1", via: "creds" });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("edits a hop", async () => {
    const user = userEvent.setup();
    m.hopUpdate.mockResolvedValue(hop);
    wrap(<HopForm engagementId="e1" hosts={[H1, H2]} hop={hop} onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Edit hop" });
    await user.clear(within(dialog).getByLabelText("Via"));
    await user.type(within(dialog).getByLabelText("Via"), "exploit");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(m.hopUpdate).toHaveBeenCalledWith("hp1", { fromHostId: null, toHostId: "h1", via: "exploit" });
  });

  it("editing offers Delete hop, which asks first", async () => {
    const user = userEvent.setup();
    m.hopDelete.mockResolvedValue(null);
    const onClose = vi.fn();
    wrap(<HopForm engagementId="e1" hosts={[H1, H2]} hop={hop} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: "Edit hop" });
    expect(within(dialog).getByRole("button", { name: "Delete hop" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete hop" }));
    expect(m.hopDelete).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("dialog", { name: "Delete the hop to dc01?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete hop" }));
    expect(m.hopDelete).toHaveBeenCalledWith("hp1");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
