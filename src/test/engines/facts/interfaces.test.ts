import { describe, expect, it } from "vitest";
import { isVirtualInterface, parseInterfaces } from "../../../engines/facts/interfaces";
import { maskToPrefix, networkOf } from "../../../engines/parse/scope";

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
