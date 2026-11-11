import { describe, expect, it } from "vitest";
import { isVirtualInterface, parseInterfaces, readInterfaces } from "../../../engines/facts/interfaces";
import { maskToPrefix, networkOf } from "../../../engines/parse/scope";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";
import type { Tunnel } from "../../../types/network";

const IP_A = `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN
    inet 127.0.0.1/8 scope host lo
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP
    inet 10.10.5.20/24 brd 10.10.5.255 scope global eth0
    inet6 fe80::1/64 scope link
3: eth1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP
    inet 172.16.5.10/24 brd 172.16.5.255 scope global eth1`;

describe("parseInterfaces", () => {
  it("reads ip a, skipping loopback and IPv6", () => {
    expect(parseInterfaces(IP_A)).toEqual([
      { name: "eth0", ip: "10.10.5.20", prefix: 24, virtual: false },
      { name: "eth1", ip: "172.16.5.10", prefix: 24, virtual: false },
    ]);
  });

  it("reads new-style ifconfig", () => {
    const out = "eth1: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 172.16.5.10  netmask 255.255.255.0  broadcast 172.16.5.255";
    expect(parseInterfaces(out)).toEqual([{ name: "eth1", ip: "172.16.5.10", prefix: 24, virtual: false }]);
  });

  it("reads old-style ifconfig", () => {
    const out = "eth1      Link encap:Ethernet  HWaddr 00:0c:29:aa:bb:cc\n          inet addr:172.16.5.10  Bcast:172.16.5.255  Mask:255.255.255.0";
    expect(parseInterfaces(out)).toEqual([{ name: "eth1", ip: "172.16.5.10", prefix: 24, virtual: false }]);
  });

  it("reads ipconfig /all and drops the link-local adapter", () => {
    const out = `Ethernet adapter Ethernet1:

   IPv4 Address. . . . . . . . . . . : 172.16.5.10(Preferred)
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
Ethernet adapter Ethernet2:

   Autoconfiguration IPv4 Address. . : 169.254.3.4(Preferred)
   Subnet Mask . . . : 255.255.0.0`;
    expect(parseInterfaces(out)).toEqual([{ name: "Ethernet1", ip: "172.16.5.10", prefix: 24, virtual: false }]);
  });

  it("flags virtual adapters", () => {
    const docker = "4: docker0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500\n    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0";
    expect(parseInterfaces(docker)).toEqual([{ name: "docker0", ip: "172.17.0.1", prefix: 16, virtual: true }]);
    const wsl = "Ethernet adapter vEthernet (WSL):\n   IPv4 Address. . . . . . . . . . . : 172.20.0.1\n   Subnet Mask . . . . . . . . . . . : 255.255.240.0";
    expect(parseInterfaces(wsl)).toEqual([{ name: "vEthernet (WSL)", ip: "172.20.0.1", prefix: 20, virtual: true }]);
    expect(isVirtualInterface("DOCKER0")).toBe(true);
    expect(isVirtualInterface("eth0")).toBe(false);
  });

  it("returns nothing for output that is not an interface listing", () => {
    expect(parseInterfaces("Nmap scan report for 10.0.0.1")).toEqual([]);
  });
});

describe("isVirtualInterface", () => {
  it.each([
    "docker0", "br-1a2b3c", "veth12ab", "virbr0", "vmnet8", "vboxnet0", "lxcbr0", "lxdbr0", "podman0", "cni0", "flannel.1", "cali123", "tun0", "tap0",
    "wg0", "tailscale0", "zt0abcd", "lo", "lo0", "vEthernet (WSL)", "VMware Network Adapter VMnet1", "VirtualBox Host-Only Network",
    "Hyper-V Virtual Ethernet Adapter", "Loopback Pseudo-Interface 1", "Bluetooth Network Connection",
  ])("treats %s as virtual", (name) => expect(isVirtualInterface(name)).toBe(true));
  it.each(["Local Area Connection", "Ethernet0", "ens33", "eth1", "Wi-Fi"])("treats %s as real", (name) => expect(isVirtualInterface(name)).toBe(false));
});

describe("networkOf / maskToPrefix", () => {
  it("masks an address down to its network", () => {
    expect(networkOf("172.16.5.10", 24)).toBe("172.16.5.0/24");
    expect(networkOf("10.1.2.3", 8)).toBe("10.0.0.0/8");
  });
  it("converts contiguous masks and rejects others", () => {
    expect(maskToPrefix("255.255.255.0")).toBe(24);
    expect(maskToPrefix("255.255.240.0")).toBe(20);
    expect(maskToPrefix("255.0.255.0")).toBeNull();
  });
});

describe("readInterfaces", () => {
  const host = { id: "h1", name: "WEB01", ip: "10.10.5.20" } as Host;
  const OUT = `2: eth0: <BROADCAST,UP> mtu 1500\n    inet 10.10.5.20/24 brd 10.10.5.255 scope global eth0\n3: eth1: <BROADCAST,UP> mtu 1500\n    inet 172.16.5.10/24 brd 172.16.5.255 scope global eth1\n4: docker0: <BROADCAST,UP> mtu 1500\n    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0`;
  const entry = (id: string, at: number, over: Partial<LogEntry> = {}): LogEntry => ({
    id, engagementId: "e1", kind: "command", title: id, titleEdited: false, ranOn: "WEB01", hostIds: ["h1"], observations: null,
    returnedNothing: false, private: false, content: { kind: "command", blocks: [{ command: "ip a", output: OUT }] },
    at, createdAt: at, updatedAt: at, ...over,
  });
  const tunnel = (subnets: string[]): Tunnel => ({
    id: "t1", engagementId: "e1", kind: "ligolo", viaHostId: "h1", subnets, callbackIp: "", status: "up", notes: null, createdAt: 1, updatedAt: 1,
  });
  const docker = { iface: "docker0", ip: "172.17.0.1", prefix: 16, subnet: "172.17.0.0/16" };

  it("suggests the second subnet and lists virtual adapters apart", () => {
    const r = readInterfaces([entry("l1", 1)], host, [], []);
    expect(r.suggestions).toEqual([
      { key: "h1|172.16.5.0/24", hostId: "h1", iface: "eth1", ip: "172.16.5.10", prefix: 24, subnet: "172.16.5.0/24", entryId: "l1" },
    ]);
    expect(r.alsoSeen).toEqual([docker]);
  });

  it("gives one suggestion per subnet, from the newest entry", () => {
    const r = readInterfaces([entry("old", 1), entry("new", 2)], host, [], []);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].entryId).toBe("new");
    expect(r.alsoSeen).toHaveLength(1);
  });

  it("stays quiet for a subnet a tunnel already covers", () => {
    expect(readInterfaces([entry("l1", 1)], host, [tunnel(["172.16.5.0/24"])], []).suggestions).toEqual([]);
  });

  it("stays quiet for a dismissed subnet", () => {
    const d = { engagementId: "e1", hostId: "h1", subnet: "172.16.5.0/24", createdAt: 1 };
    expect(readInterfaces([entry("l1", 1)], host, [], [d]).suggestions).toEqual([]);
  });

  it("suggests nothing when the host has no IP, without throwing", () => {
    const r = readInterfaces([entry("l1", 1)], { ...host, ip: null }, [], []);
    expect(r).toEqual({ suggestions: [], alsoSeen: [docker] });
  });

  it("ignores an entry linked to two hosts", () => {
    const r = readInterfaces([entry("l1", 1, { hostIds: ["h1", "h2"] })], host, [], []);
    expect(r).toEqual({ suggestions: [], alsoSeen: [] });
  });
});
