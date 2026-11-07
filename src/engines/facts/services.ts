import type { Service } from "../../types/service";
import type { ServiceVerdict } from "../../types/hostFacts";

export interface ServiceIdentity {
  label: string;
  confirmed: boolean;
  unidentified: boolean;
}

export type EffectiveVerdict = ServiceVerdict | "identify";

function joinParts(a: string | null, b: string | null): string {
  return [a, b].filter((p) => p && p.trim()).join(" ").trim();
}

export function serviceIdentity(s: Service): ServiceIdentity {
  const nmap = s.nmapService?.trim() ?? "";
  const unidentified = nmap === "" || nmap.endsWith("?") || nmap.toLowerCase() === "unknown";
  if (s.confirmedProduct && s.confirmedProduct.trim()) {
    return { label: joinParts(s.confirmedProduct, s.confirmedVersion), confirmed: true, unidentified };
  }
  return { label: joinParts(s.nmapService, s.nmapVersion), confirmed: false, unidentified };
}

export function effectiveVerdict(s: Service): EffectiveVerdict {
  if (s.verdict) return s.verdict;
  return serviceIdentity(s).unidentified ? "identify" : "untested";
}

/** Dynamic RPC noise (msrpc on high TCP ports) and UDP without a call fold away from the main rows. */
export function foldServices(services: Service[]): { rows: Service[]; rpc: Service[]; udp: Service[] } {
  const rows: Service[] = [];
  const rpc: Service[] = [];
  const udp: Service[] = [];
  for (const s of services) {
    if (s.verdict === null) {
      if (s.protocol === "udp") {
        udp.push(s);
        continue;
      }
      if (s.protocol === "tcp" && s.port >= 49152 && s.port <= 65535 && s.nmapService === "msrpc") {
        rpc.push(s);
        continue;
      }
    }
    rows.push(s);
  }
  return { rows, rpc, udp };
}

const ORDER: Record<EffectiveVerdict, number> = { candidate: 0, identify: 1, untested: 2, dead_end: 3 };

export function sortServices(rows: Service[]): Service[] {
  return [...rows].sort((a, b) => ORDER[effectiveVerdict(a)] - ORDER[effectiveVerdict(b)] || a.port - b.port);
}
