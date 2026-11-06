import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandList } from "../features/checklist/CommandList";
import { GoalRow } from "../features/checklist/GoalRow";
import { goalCommands } from "../features/checklist/goalCommands";
import { PortChip } from "../features/checklist/PortChip";
import { usePortPickStore } from "../features/checklist/portPick";
import { setImported } from "../engines/library/store";
import type { FillInput } from "../engines/checklist";
import type { Engagement } from "../types/engagement";

const labels = Array.from({ length: 7 }, (_, i) => `CORP\\svc_${i}`);
const row = (cmds = []) => (
  <ul>
    <GoalRow goal={{ id: "g", title: "Scan all 65,535 TCP ports", why: "" }} state={{ status: "done" }} commands={cmds} evidence={[]} newCredLabels={labels} onStatus={vi.fn()} onNotes={vi.fn()} />
  </ul>
);

describe("new credential notice", () => {
  it("is a collapsed count; opening lists labels one per line; never widens the row", async () => {
    render(row());
    const btn = screen.getByRole("button", { name: /7 new credentials since this was done/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("CORP\\svc_3")).toBeNull();
    expect(btn.closest("div")!.className).toMatch(/min-w-0/);
    expect(btn.closest("div")!.className).not.toMatch(/whitespace-nowrap/);
    await userEvent.click(btn);
    const items = screen.getAllByRole("listitem").filter((li) => li.textContent?.startsWith("CORP"));
    expect(items).toHaveLength(7);
  });
  it("title column is min-w-0 and the status group stays shrink-0", () => {
    render(row());
    const col = screen.getByTestId("goal-title-col");
    expect(col.className).toMatch(/min-w-0/);
    expect(col.className).not.toMatch(/whitespace-nowrap/);
    expect(screen.getByTestId("goal-head").className).toMatch(/min-w-0/);
    expect(screen.getByRole("group", { name: /Status/ }).className).toMatch(/shrink-0/);
    expect(screen.getByText("Scan all 65,535 TCP ports").className).not.toMatch(/whitespace-nowrap/);
  });
});

describe("CommandList spacing", () => {
  it("separates commands with gap-4 and mutes the description", () => {
    render(<CommandList commands={[{ id: "a", title: "Desc A", text: "id", unresolved: [], msfMarker: false }, { id: "b", title: "Desc B", text: "ls", unresolved: [], msfMarker: false }]} />);
    const ul = screen.getAllByRole("list")[0];
    expect(ul.className).toMatch(/gap-4/);
    expect(ul.firstElementChild!.className).toMatch(/gap-1\b/);
    const d = screen.getAllByTestId("command-desc")[0];
    expect(d.className).toMatch(/text-xs/);
    expect(d.className).toMatch(/text-muted/);
  });
});

describe("{PORT} on checklist steps", () => {
  const host = { id: "h1", engagementId: "e1", name: "t", ip: "10.0.0.5", os: "linux" } as never;
  const svc = (port: number) => ({ id: `s${port}`, hostId: "h1", port, protocol: "tcp", state: "open", name: "x" }) as never;
  const input = (): FillInput => ({
    host, engagement: { id: "e1", kind: "pentest", scopeCidrs: [], excludedCidrs: [] } as never, hosts: [host],
    servicesByHost: new Map([["h1", [svc(8080), svc(22), svc(80)]]]), tunnels: [], attackerIp: "10.10.14.1", listenerPort: "4444",
  });
  it("fills the lowest port, offers all, and a pick refills", () => {
    setImported({ cards: [], commands: [{ id: "nc", title: "Banner", template: "nc -nv {TARGET_IP} {PORT}", goals: ["h-enum-identified"], os: "any", runFrom: "attacker" } as never] });
    usePortPickStore.setState({ picks: {} });
    const eng = { id: "e1", kind: "pentest" } as unknown as Engagement;
    let c = goalCommands("h-enum-identified", input(), eng).commands.find((x) => x.id === "nc")!;
    expect(c.text).toContain("10.0.0.5 22");
    expect(c.portToken?.choices).toEqual([22, 80, 8080]);
    render(<PortChip commands={[c]} />);
    expect(screen.getByRole("combobox", { name: "Port" })).toHaveTextContent("22");
    usePortPickStore.getState().set(c.portToken!.key, 8080);
    c = goalCommands("h-enum-identified", input(), eng).commands.find((x) => x.id === "nc")!;
    expect(c.text).toContain("10.0.0.5 8080");
    void within;
  });
  it("offers no fake port: a UDP open|filtered port makes no chip and leaves {PORT} unresolved", () => {
    setImported({ cards: [], commands: [{ id: "nc", title: "Banner", template: "nc -nv {TARGET_IP} {PORT}", goals: ["h-enum-identified"], os: "any", runFrom: "attacker" } as never] });
    usePortPickStore.setState({ picks: {} });
    const eng = { id: "e1", kind: "pentest" } as unknown as Engagement;
    const base = input();
    const udp = { id: "s7", hostId: "h1", port: 7, protocol: "udp", state: "open|filtered", name: "echo" } as never;
    const inp = { ...base, servicesByHost: new Map([["h1", [udp, svc(80), svc(22)]], ["h2", [svc(9)]]]) } as FillInput;
    const c = goalCommands("h-enum-identified", inp, eng).commands.find((x) => x.id === "nc")!;
    expect(c.portToken?.choices).toEqual([22, 80]);
    const none = { ...base, servicesByHost: new Map([["h1", [udp]]]) } as FillInput;
    const n = goalCommands("h-enum-identified", none, eng).commands.find((x) => x.id === "nc")!;
    expect(n.portToken).toBeUndefined();
    expect(n.text).toContain("{PORT}");
    expect(n.unresolved).toContain("PORT");
    const { container } = render(<PortChip commands={[n]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows no chip when no displayed command uses {PORT}", () => {
    setImported({ cards: [], commands: [{ id: "snmp", title: "SNMP", template: "snmpwalk -v2c -c public {TARGET_IP}", goals: ["h-enum-identified"], os: "any", runFrom: "attacker" } as never] });
    const eng = { id: "e1", kind: "pentest" } as unknown as Engagement;
    const cmds = goalCommands("h-enum-identified", input(), eng).commands.filter((x) => x.id === "snmp");
    expect(cmds).toHaveLength(1);
    expect(cmds[0].portToken).toBeUndefined();
    const { container } = render(<PortChip commands={cmds} />);
    expect(container).toBeEmptyDOMElement();
  });
});
