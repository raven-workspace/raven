import type { ReasonKind } from "../../types/findings";
import { httpParts } from "../capture/http";
import { isPortScan } from "./tools";
import type { ReportData, CoverageOverride, CoverageResult } from "./types";

export interface CoverageRow {
  serviceId: string;
  port: number;
  protocol: string;
  product: string;
  /** False when the product is only nmap's guess. */
  proven: boolean;
  result: CoverageResult;
  via: string | null;
}

const REASON_WORDS: Record<Exclude<ReasonKind, "operator">, string> = {
  control: "blocked by a control",
  precondition: "precondition not met",
  access: "no access",
};

const joinWords = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ");

/**
 * Services an access step names by tool or protocol rather than by port: a service is in a family by its port or its
 * nmap name, and an access step names the family with one of its words ("evil-winrm" is WinRM on 5985).
 */
const ACCESS_FAMILIES: { ports: number[]; names: string[]; words: RegExp }[] = [
  { ports: [22], names: ["ssh"], words: /\b(ssh|scp|sftp)\b/i },
  { ports: [21], names: ["ftp"], words: /\bftp\b/i },
  { ports: [23], names: ["telnet"], words: /\btelnet\b/i },
  { ports: [445], names: ["microsoft-ds"], words: /\b(psexec|smbexec|atexec|smbclient|smb)\b/i },
  { ports: [5985, 5986], names: ["wsman", "winrm"], words: /\b(evil-winrm|winrm)\b/i },
  { ports: [3389], names: ["ms-wbt-server", "rdp"], words: /\b(rdp|xfreerdp|rdesktop)\b/i },
  { ports: [1433], names: ["ms-sql-s", "mssql"], words: /\b(mssql|mssqlclient)\b/i },
  { ports: [3306], names: ["mysql"], words: /\bmysql\b/i },
  { ports: [5432], names: ["postgresql"], words: /\b(psql|postgres|postgresql)\b/i },
  { ports: [135], names: ["msrpc"], words: /\b(wmiexec|dcomexec)\b/i },
  { ports: [5900], names: ["vnc"], words: /\bvnc(viewer)?\b/i },
];

/** A port in a note: not inside a number, an IP or a decimal; a sentence's full stop after it ("on 22.") is fine. */
const portPattern = (port: number) => new RegExp(`(?<!\\d\\.?)${port}(?!\\.?\\d)`);
/**
 * A port standing alone in a command or title ("on 8080", ":8080/", "on 8080."): not inside a word, an IP or a base64
 * payload.
 */
const barePort = (port: number) => new RegExp(`(?<!\\w\\.?)${port}(?!\\.?\\w)`);

/**
 * What the steps into a host say: `words` is each access grant's and hop's `via` with its linked entry's title, where a
 * port may be named outright; `commands` are that entry's commands (never a private entry's), read for tool and
 * protocol words only, since their numbers are as often the attacker's listener or callback port as the target's.
 */
function accessSteps(data: ReportData, hostId: string): { via: string; words: string; commands: string }[] {
  const step = (via: string, entryId: string | null) => {
    const e = entryId ? data.log.find((l) => l.id === entryId) : undefined;
    const shown = e && !e.private ? e : undefined;
    const commands = shown?.content.kind === "command" ? shown.content.blocks.map((b) => b.command ?? "").join("\n") : "";
    return { via, words: `${via}\n${shown?.title ?? ""}`, commands };
  };
  return [
    ...data.grants.filter((g) => g.hostId === hostId).map((g) => step(g.via, g.logEntryId)),
    ...data.hops.filter((h) => h.toHostId === hostId).map((h) => step(h.via, h.logEntryId)),
  ];
}

/** Whether an access step names this service: its port outright in the via or title, or its family's tool or protocol anywhere. */
function namesService(st: { words: string; commands: string }, port: number, nmapService: string | null): boolean {
  if (barePort(port).test(st.words)) return true;
  const name = (nmapService ?? "").toLowerCase();
  return ACCESS_FAMILIES.some((f) => (f.ports.includes(port) || f.names.includes(name)) && (f.words.test(st.words) || f.words.test(st.commands)));
}

/** Whether a credential attempt was on this service: its port, else its service word in the service's family. */
function attemptOn(a: { port: number | null; service: string }, port: number, nmapService: string | null): boolean {
  if (a.port != null) return a.port === port;
  const name = (nmapService ?? "").toLowerCase();
  return ACCESS_FAMILIES.some((f) => (f.ports.includes(port) || f.names.includes(name)) && f.words.test(a.service));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HTTP_URL = /\bhttps?:\/\/([^\s/:'"]+)(?::(\d+))?/gi;

/**
 * Whether a command works this service of a host (`ip`, `name`): a URL to the host (80 or 443 unless it names a
 * port), `<host>:<port>`, a `-p`/`--port` of the port with the host named, or its family's tool or protocol word with
 * the host named. Port scans don't count: a scan finds a service, it doesn't test it.
 */
function commandWorks(command: string, hosts: string[], port: number, nmapService: string | null): boolean {
  const lc = command.toLowerCase();
  const named = hosts.filter((h) => h !== "").some((h) => new RegExp(`(?<![\\w.-])${esc(h)}(?![\\w-]|\\.\\w)`, "i").test(command));
  if (!named) return false;
  for (const m of command.matchAll(HTTP_URL)) {
    if (!hosts.some((h) => h.toLowerCase() === m[1].toLowerCase())) continue;
    const p = m[2] ? Number(m[2]) : lc.slice(m.index ?? 0).startsWith("https") ? 443 : 80;
    if (p === port) return true;
  }
  if (hosts.some((h) => h !== "" && new RegExp(`${esc(h)}:${port}(?!\\d)`, "i").test(command))) return true;
  if (new RegExp(`(?:^|\\s)(?:-p|--port)[\\s=]?${port}(?!\\d)`).test(command)) return true;
  const name = (nmapService ?? "").toLowerCase();
  return ACCESS_FAMILIES.some((f) => (f.ports.includes(port) || f.names.includes(name)) && f.words.test(command));
}

/**
 * The port a captured HTTP request went to, read as the capture parser reads it (`httpParts`): the Host header's or
 * absolute URL's port; an HTTPS request with none (an https:// URL, HTTP/2) is 443; a portless request is the host's
 * only web service when it has exactly one (`webPort`), else 80.
 */
export function requestPort(request: string, webPort: number | null = null): number {
  const parts = httpParts(request);
  if (parts.port !== null) return parts.port;
  const first = request.split(/\r?\n/)[0] ?? "";
  if (/^\S+\s+https:\/\//i.test(first) || /\bHTTP\/2(?:\.0)?\s*$/i.test(first)) return 443;
  return webPort ?? 80;
}

/** A web service: nmap names it http (http, https, ssl/http, http-proxy) or it sits on a usual web port. */
const isWeb = (s: { port: number; nmapService: string | null }) => /http/i.test(s.nmapService ?? "") || [80, 443, 8000, 8080, 8443].includes(s.port);

/** A service's coverage on one host (§5.5): exploited, tested, or untested; an override wins. Tested includes what
 *  real work shows without a ruled-out item: credentials tried on it (nxc, hydra), commands run against it, and HTTP
 *  requests captured to its port. */
export function serviceCoverage(
  data: ReportData,
  hostId: string,
  overrides: Record<string, CoverageOverride>,
): CoverageRow[] {
  const notes = [
    ...data.attempts.filter((a) => !a.private && a.reasonKind !== "operator" && a.hostId === hostId).map((a) => ({ text: a.title, via: a.title })),
    ...data.ruledOut
      .filter((r) => !r.private && r.hostId === hostId)
      .map((r) => ({ text: r.text, via: r.text })),
  ];
  const steps = accessSteps(data, hostId);
  const host = data.hosts.find((h) => h.id === hostId);
  const domain = (data.engagement?.domain ?? "").trim();
  // The host by IP, name, and name in the engagement's domain (`ms01.exam.corp`).
  const names = [host?.ip ?? "", host?.name ?? "", host?.name && domain && !host.name.includes(".") ? `${host.name}.${domain}` : ""];
  const requests = data.log.filter((e) => !e.private && e.hostIds.includes(hostId) && e.content.kind === "http");
  const web = data.services.filter((s) => s.hostId === hostId && isWeb(s));
  const webPort = web.length === 1 ? web[0].port : null;
  const commands = data.log.filter(
    (e) => !e.private && e.hostIds.includes(hostId) && e.content.kind === "command" && !isPortScan(e),
  );
  const attempts = (data.credAttempts ?? []).filter((a) => a.hostId === hostId);
  return data.services
    .filter((s) => s.hostId === hostId)
    .sort((a, b) => a.port - b.port)
    .map((s): CoverageRow => {
      const confirmed = s.confirmedProduct ? joinWords(s.confirmedProduct, s.confirmedVersion) : null;
      const product = confirmed ?? joinWords(s.nmapService, s.nmapVersion);
      let result: CoverageResult = "untested";
      let via: string | null = null;
      const finding = data.findings.find((f) => f.serviceIds.includes(s.id));
      const re = portPattern(s.port);
      const hit = notes.find((n) => re.test(n.text));
      // A port used to get in (an access grant or hop names it) was exploited, whether or not a finding says so.
      const access = finding ? undefined : steps.find((st) => namesService(st, s.port, s.nmapService));
      if (finding) {
        result = "exploited";
        via = finding.title;
      } else if (access) {
        result = "exploited";
        via = access.via;
      } else if (s.verdict === "dead_end") {
        result = "tested";
        via = "ruled out as a dead end";
      } else if (hit) {
        result = "tested";
        via = hit.via;
      } else {
        const tried = attempts.find((a) => attemptOn(a, s.port, s.nmapService));
        const ran = tried ? undefined : commands.find((e) => e.content.kind === "command" && e.content.blocks.some((b) => commandWorks(b.command ?? "", names, s.port, s.nmapService)));
        const asked = tried || ran ? undefined : requests.find((e) => e.content.kind === "http" && requestPort(e.content.request, webPort) === s.port);
        if (asked) {
          result = "tested";
          via = asked.title;
        } else if (tried) {
          result = "tested";
          via = `credentials tried on ${tried.service.toUpperCase()}`;
        } else if (ran) {
          result = "tested";
          via = ran.title;
        }
      }
      const override = overrides[s.id];
      if (override) {
        result = override.result;
        via = override.note ?? null;
      }
      return { serviceId: s.id, port: s.port, protocol: s.protocol, product, proven: confirmed !== null, result, via };
    });
}

export interface TestedItem {
  title: string;
  /** The reason in plain words: "blocked by a control: WAF", or the ruled-out item's reason. */
  reason: string;
  /** The port the item was about, when Raven knows it (a finding's service, a dead-end service verdict). */
  port: number | null;
}

/** Non-private attempts and ruled-out items on a host (null = engagement level), with why they went nowhere. */
export function testedNotExploited(data: ReportData, hostId: string | null): TestedItem[] {
  const portOf = (serviceId: string | null | undefined) => data.services.find((s) => s.id === serviceId)?.port ?? null;
  return [
    ...data.attempts
      .filter((a) => !a.private && a.reasonKind !== "operator" && (a.hostId ?? null) === hostId)
      .map((a) => ({
        title: a.title,
        reason: a.reasonKind === "operator" ? "" : [REASON_WORDS[a.reasonKind], a.reason.trim()].filter(Boolean).join(": "),
        port: portOf(data.findings.find((f) => f.id === a.findingId)?.serviceIds[0]),
      })),
    ...data.ruledOut
      .filter((r) => !r.private && (r.hostId ?? null) === hostId)
      .map((r) => ({ title: r.text, reason: r.reason, port: r.sourceKind === "service" ? portOf(r.sourceId) : null })),
  ];
}

/** One slim Also tested line: "<what> on <port>: <reason>". The port is left out when the title already names it. */
export function testedLine(item: TestedItem): string {
  const named = item.port != null && portPattern(item.port).test(item.title);
  const what = item.port != null && !named ? `${item.title} on ${item.port}` : item.title;
  return item.reason ? `${what}: ${item.reason}` : what;
}
