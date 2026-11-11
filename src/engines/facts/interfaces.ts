import { maskToPrefix } from "../parse/scope";

export interface NetInterface {
  name: string;
  ip: string;
  prefix: number;
  virtual: boolean;
}

const VIRTUAL_PREFIXES = ["docker", "br-", "veth", "virbr", "vmnet", "vboxnet", "tun", "tap", "wg", "lo"];
const VIRTUAL_ANYWHERE = ["vethernet", "virtualbox", "vmware", "hyper-v", "wsl", "loopback"];

/** Container, VM, tunnel and loopback adapters: not a second network the host reaches. */
export function isVirtualInterface(name: string): boolean {
  const n = name.trim().toLowerCase();
  return VIRTUAL_PREFIXES.some((p) => n.startsWith(p)) || VIRTUAL_ANYWHERE.some((p) => n.includes(p));
}

const IP = String.raw`(\d{1,3}(?:\.\d{1,3}){3})`;
const IP_A_HEADER = /^\d+:\s+(\S+?)(?:@\S*)?:\s/;
const IP_A_ADDR = new RegExp(String.raw`^\s+inet\s+${IP}\/(\d{1,2})\b`);
const IFCONFIG_NEW_HEADER = /^(\S+?):\s+flags=/;
const IFCONFIG_OLD_HEADER = /^(\S+)\s+Link encap/;
const IFCONFIG_NEW_ADDR = new RegExp(String.raw`^\s+inet\s+${IP}\s+netmask\s+${IP}`);
const IFCONFIG_OLD_ADDR = new RegExp(String.raw`^\s+inet addr:${IP}\s.*?Mask:${IP}`);
const IPCONFIG_HEADER = /adapter (.+):\s*$/;
const IPCONFIG_ADDR = new RegExp(String.raw`^\s+IPv4 Address[ .]*:\s*${IP}`);
const IPCONFIG_MASK = new RegExp(String.raw`^\s+Subnet Mask[ .]*:\s*${IP}`);

function isUsable(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (octets.some((o) => o > 255)) return false;
  return !(octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || ip === "0.0.0.0");
}

/** IPv4 interfaces named in `ip a`, `ifconfig` (new and old) or `ipconfig` output, first seen first, one per address. */
export function parseInterfaces(output: string): NetInterface[] {
  const found: NetInterface[] = [];
  const seen = new Set<string>();
  const add = (name: string, ip: string, prefix: number | null) => {
    if (prefix === null || prefix > 32 || !isUsable(ip) || seen.has(ip)) return;
    seen.add(ip);
    found.push({ name, ip, prefix, virtual: isVirtualInterface(name) });
  };

  let current = "";
  // ipconfig prints the address before its mask; hold it until the mask line arrives.
  let pending: { name: string; ip: string } | null = null;
  const flush = () => {
    if (pending) add(pending.name, pending.ip, null);
    pending = null;
  };

  for (const line of output.split(/\r?\n/)) {
    let m: RegExpExecArray | null;
    if ((m = IP_A_HEADER.exec(line) ?? IFCONFIG_NEW_HEADER.exec(line) ?? IFCONFIG_OLD_HEADER.exec(line) ?? IPCONFIG_HEADER.exec(line))) {
      flush();
      current = m[1];
    }
    if (!current) continue;
    if ((m = IP_A_ADDR.exec(line))) add(current, m[1], Number(m[2]));
    else if ((m = IFCONFIG_NEW_ADDR.exec(line) ?? IFCONFIG_OLD_ADDR.exec(line))) add(current, m[1], maskToPrefix(m[2]));
    else if ((m = IPCONFIG_ADDR.exec(line))) {
      flush();
      pending = { name: current, ip: m[1] };
    } else if (pending && (m = IPCONFIG_MASK.exec(line))) {
      add(pending.name, pending.ip, maskToPrefix(m[1]));
      pending = null;
    }
  }
  return found;
}
