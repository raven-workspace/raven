import { adHosts, dcForFill, openPorts } from "../../engines/checklist";
import type { ToolkitEntry } from "../../engines/fieldManual/parseToolkit";
import type { Credential } from "../../types/credentials";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";

export interface Suggestion {
  value: string;
  /** Where it comes from: a host name, "DC", "staged". */
  hint?: string;
}

export interface SuggestContext {
  engagement?: Engagement | undefined;
  hosts: Host[];
  services?: Service[] | undefined;
  /** Usernames and domains only are read: a secret is never offered. */
  credentials?: Credential[] | undefined;
  /** The host being filled for, if any. */
  host?: Host | undefined;
  toolkit: ToolkitEntry[];
}

const IP_TOKENS = new Set(["TARGET_IP", "TARGET", "IP", "RHOST", "PIVOT_IP"]);
const NAME_TOKENS = new Set(["TARGET_HOST", "HOSTNAME", "PIVOT_NAME", "DC_HOST", "DC_HOST_SHORT"]);
const NOT_HOST_PORTS = new Set(["LPORT", "SOCKS_PORT"]);

function dedupe(list: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    if (!s.value || seen.has(s.value)) return false;
    seen.add(s.value);
    return true;
  });
}

/**
 * What Raven already knows that could fill `token`: credential usernames (never secrets), the domain, the DC IP,
 * the engagement's host IPs and names, the host's open ports, Toolkit files (staged first). Empty for anything
 * else: free text still works.
 */
export function tokenSuggestions(token: string, ctx: SuggestContext): Suggestion[] {
  const t = token.toUpperCase().replace(/-/g, "_");
  const servicesByHost = new Map<string, Service[]>();
  for (const s of ctx.services ?? []) servicesByHost.set(s.hostId, [...(servicesByHost.get(s.hostId) ?? []), s]);
  const domain = ctx.engagement?.domain?.trim() || "";
  const hostIps = (): Suggestion[] => ctx.hosts.filter((h) => h.ip?.trim()).map((h) => ({ value: h.ip!.trim(), hint: h.name }));
  const fqdn = (h: Host): string => (h.name.includes(".") || !domain ? h.name : `${h.name}.${domain}`);
  const hostNames = (): Suggestion[] =>
    ctx.hosts.flatMap((h) => {
      const name = h.name.trim();
      if (!name) return [];
      const full = fqdn({ ...h, name });
      const hint = h.ip?.trim() ? { hint: h.ip.trim() } : {};
      return full === name ? [{ value: name, ...hint }] : [{ value: full, ...hint }, { value: name, ...hint }];
    });

  let out: Suggestion[] = [];
  if (t === "USER" || t === "USERNAME") {
    out = (ctx.credentials ?? []).map((c) => ({ value: c.username.trim(), ...(c.domain?.trim() ? { hint: c.domain.trim() } : {}) }));
  } else if (t === "DOMAIN") {
    out = [...(domain ? [{ value: domain }] : []), ...(ctx.credentials ?? []).map((c) => ({ value: c.domain?.trim() ?? "" }))];
  } else if (t === "DC_IP") {
    const dc = dcForFill(ctx.hosts, servicesByHost);
    const ad = adHosts(ctx.hosts, servicesByHost);
    out = [
      ...(dc?.ip?.trim() ? [{ value: dc.ip.trim(), hint: `${dc.name} · DC` }] : []),
      ...ad.filter((h) => h.ip?.trim()).map((h) => ({ value: h.ip!.trim(), hint: `${h.name} · AD` })),
      ...hostIps(),
    ];
  } else if (IP_TOKENS.has(t) || t.endsWith("_IP")) {
    out = hostIps();
  } else if (NAME_TOKENS.has(t) || t.endsWith("_HOST") || t.endsWith("_NAME")) {
    out = hostNames();
  } else if ((t === "PORT" || t.endsWith("_PORT")) && !NOT_HOST_PORTS.has(t)) {
    const services = ctx.host ? (servicesByHost.get(ctx.host.id) ?? []) : [];
    out = [...openPorts(services)].sort((a, b) => a - b).map((p) => {
      const name = services.find((s) => s.port === p)?.nmapService;
      return { value: String(p), ...(name ? { hint: name } : {}) };
    });
  } else if (t === "FILE" || t === "SCRIPT" || t.endsWith("_FILE")) {
    const os = ctx.host?.os;
    out = [...ctx.toolkit]
      .sort((a, b) => Number(b.staged) - Number(a.staged) || Number(b.os === os) - Number(a.os === os))
      .map((f) => ({ value: f.file, ...(f.staged ? { hint: "staged" } : {}) }));
  }
  return dedupe(out);
}
