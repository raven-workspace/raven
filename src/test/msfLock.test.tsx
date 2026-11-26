// Runs on the checked in-browser fake (src/test/support/fakeStore.tsx): the data is seeded through the store's own
// commands, and what the screen changes is read back from the store.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import type { EngagementKind } from "../types/engagement";
import { fake, renderApp, resetFake } from "./support/fakeStore";

vi.mock("../lib/api", () => import("../audit/fakeApi"));

/** An engagement with two hosts: SRV11 (Windows, SMB open) and web07 (Linux). */
async function seed(kind: EngagementKind = "exam-sim") {
  const eng = await fake.engagementCreate({ name: "Lab A", kind, scopeCidrs: ["192.0.2.0/24"] });
  const srv11 = await fake.hostCreate(eng.id, { name: "SRV11", ip: "192.0.2.5", os: "windows" });
  const web07 = await fake.hostCreate(eng.id, { name: "web07", ip: "192.0.2.6", os: "linux" });
  await fake.serviceCreate(srv11.id, { port: 445, nmapService: "microsoft-ds" });
  return { eng, srv11, web07 };
}

const lockOf = async (engagementId: string) => (await fake.engagementGet(engagementId)).msfHostId;

beforeEach(() => {
  localStorage.clear();
  useCaptureStore.getState().reset();
  resetFake();
});

describe("metasploit lock", () => {
  it("strip shows the msf lock only in exam sims", async () => {
    const exam = await seed();
    const view = renderApp(`/e/${exam.eng.id}`);
    expect(await screen.findByRole("button", { name: /Metasploit unused/ })).toBeInTheDocument();
    view.unmount();
    const lab = await fake.engagementCreate({ name: "Lab B", kind: "lab" });
    renderApp(`/e/${lab.id}`);
    await screen.findByRole("status", { name: "Engagement status" });
    expect(screen.queryByText(/Metasploit/)).not.toBeInTheDocument();
  });

  it("shows the locked host name in warn", async () => {
    const { eng, srv11 } = await seed();
    await fake.engagementSetMsfHost(eng.id, srv11.id);
    renderApp(`/e/${eng.id}`);
    const btn = await screen.findByRole("button", { name: /Metasploit SRV11/ });
    expect(within(btn).getByText("SRV11")).toHaveClass("msf-lock__host--locked");
  });

  it("shows locked, not unused, while the locked host's name is unresolved", async () => {
    const { eng, srv11 } = await seed();
    await fake.engagementSetMsfHost(eng.id, srv11.id);
    vi.spyOn(fake, "hostsList").mockReturnValue(new Promise(() => {}));
    renderApp(`/e/${eng.id}`);
    const btn = await screen.findByRole("button", { name: /Metasploit locked/ });
    expect(within(btn).getByText("locked")).toHaveClass("msf-lock__host--locked");
  });

  it("locks a host from the dialog", async () => {
    const user = userEvent.setup();
    const { eng, web07 } = await seed();
    renderApp(`/e/${eng.id}`);
    await user.click(await screen.findByRole("button", { name: /Metasploit unused/ }));
    const dialog = await screen.findByRole("dialog", { name: "Metasploit host" });
    await user.click(within(dialog).getByRole("button", { name: "web07" }));
    await waitFor(async () => expect(await lockOf(eng.id)).toBe(web07.id));
    expect(await screen.findByRole("button", { name: /Metasploit web07/ })).toBeInTheDocument();
  });

  it("release asks first and clears the lock", async () => {
    const user = userEvent.setup();
    const { eng, srv11 } = await seed();
    await fake.engagementSetMsfHost(eng.id, srv11.id);
    renderApp(`/e/${eng.id}`);
    await user.click(await screen.findByRole("button", { name: /Metasploit SRV11/ }));
    const release = await screen.findByRole("button", { name: "Release lock" });
    // Neutral at rest, amber on hover and focus: the quiet-danger button, not the amber danger one.
    expect(release).toHaveClass("button--quiet-danger");
    expect(release).not.toHaveClass("button--danger");
    await user.click(release);
    expect(await lockOf(eng.id)).toBe(srv11.id);
    const confirm = await screen.findByRole("dialog", { name: /Release the Metasploit lock/ });
    await user.click(within(confirm).getByRole("button", { name: "Release" }));
    await waitFor(async () => expect(await lockOf(eng.id)).toBeNull());
    expect(await screen.findByRole("button", { name: /Metasploit unused/ })).toBeInTheDocument();
  });

  it("deleting the locked host frees the lock", async () => {
    const { eng, srv11 } = await seed();
    await fake.engagementSetMsfHost(eng.id, srv11.id);
    await fake.hostDelete(srv11.id);
    renderApp(`/e/${eng.id}`);
    expect(await screen.findByRole("button", { name: /Metasploit unused/ })).toBeInTheDocument();
  });
});

describe("dual-homed flag", () => {
  it("dual-homed toggle saves, and the pivot goals live on the engagement view, not the host", async () => {
    const user = userEvent.setup();
    const { eng, srv11 } = await seed("lab");
    renderApp(`/e/${eng.id}/h/${srv11.id}`);
    await user.click(await screen.findByRole("button", { name: "Full checklist" }));
    await within(await screen.findByRole("tabpanel")).findByText("Check SMB shares and null/guest access");
    expect(screen.queryByText("Tunnel into the next network")).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("region", { name: "Host" })).getByRole("button", { name: "Edit host" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit host" });
    await user.click(within(dialog).getByRole("button", { name: "Dual-homed (reaches another network)" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit host" })).not.toBeInTheDocument());
    expect((await fake.hostsList(eng.id)).find((h) => h.id === srv11.id)?.dualHomed).toBe(true);
    expect(screen.queryByText("Tunnel into the next network")).not.toBeInTheDocument();
    expect(screen.queryByText("Sweep the new network for hosts")).not.toBeInTheDocument();

    // Positive proof the flag took effect: the engagement checklist lists the pivot steps behind this host.
    await user.click(await screen.findByRole("link", { name: /Engagement checklist/ }));
    const section = within(await screen.findByRole("region", { name: "Lateral movement" }));
    expect(await section.findByRole("heading", { name: "Behind SRV11" })).toBeInTheDocument();
    expect(document.querySelector('li[data-goal-id="h-pivot-tunnel"]')).not.toBeNull();
    expect(document.querySelector('li[data-goal-id="h-pivot-sweep"]')).not.toBeNull();
  });
});

describe("listener on the strip", () => {
  it("shows LHOST:LPORT from settings, and links to Settings", async () => {
    const user = userEvent.setup();
    const { eng } = await seed("lab");
    await fake.settingsUpdate({ attackerIp: "192.0.2.10", listenerPort: "4444" });
    renderApp(`/e/${eng.id}`);
    const link = await screen.findByRole("link", { name: /LHOST 192\.0\.2\.10:4444/ });
    await user.click(link);
    expect(await screen.findByLabelText("Your IP (tun0)")).toBeInTheDocument();
  });

  it("says LHOST is not set when the IP is blank, and shows the port alone when only it is set", async () => {
    const { eng } = await seed();
    await fake.settingsUpdate({ attackerIp: "", listenerPort: "" });
    const view = renderApp(`/e/${eng.id}`);
    expect(await screen.findByRole("link", { name: /LHOST not set/ })).toBeInTheDocument();
    view.unmount();
    await fake.settingsUpdate({ listenerPort: "443" });
    renderApp(`/e/${eng.id}`);
    expect(await screen.findByRole("link", { name: /LHOST not set, LPORT 443/ })).toBeInTheDocument();
  });
});
