import { inlineMarkdown } from "./findingText";
import { testedLine, testedNotExploited } from "./coverage";
import { stamp } from "./stamp";
import { findingRows, scopeRows } from "./tables";
import { para, text, textTable } from "./nodes";
import { hostName } from "./prove";
import { capitalize } from "./wording";
import { reportTargets } from "./targets";
import { msfHosts, msfModules } from "./tools";
import type { ReportData, ReportMeta, ReportNode } from "./types";

/** The generated tables and lines of the report-level pages, as plain blocks: ordinary tables and paragraphs, each
 *  top-level block carrying its `source` ("table:<kind>", "msf") and a `gen` hash for Refresh. */
export const PLAIN_TABLE_KINDS = ["findings", "scope-table", "tested", "cleanup", "references"] as const;
export type PlainTableKind = (typeof PLAIN_TABLE_KINDS)[number];

/** An empty paragraph that shows `hint` in the editor only; it prints nothing. */
export const hintPara = (hint: string, source?: string): ReportNode => ({ type: "paragraph", attrs: { hint, ...(source ? { source } : {}) } });

/** One report-level table's blocks. With no rows, only a hint paragraph that prints nothing. */
export function plainTable(kind: PlainTableKind, data: ReportData, meta: ReportMeta): ReportNode[] {
  const source = `table:${kind}`;
  const targets = () => reportTargets(data, meta);
  const blocks = ((): ReportNode[] | string => {
    switch (kind) {
      case "findings": {
        const rows = findingRows(data, targets());
        if (rows.length === 0) return "No findings recorded yet";
        return [textTable(["#", "Host", "Finding", "Severity", "Result"], rows.map((r) => [String(r.n), r.host, r.title, r.severity ? capitalize(r.severity) : "Not set", r.result]), source)];
      }
      case "scope-table": {
        const rows = scopeRows(data, targets());
        if (rows.length === 0) return "No targets in the report yet";
        return [textTable(["Host", "IP address", "OS", "Set"], rows.map((r) => [r.host, r.ip, r.os, r.set]), source)];
      }
      case "tested": {
        const rows = testedNotExploited(data, null);
        if (rows.length === 0) return "Services you tested that led nowhere appear here as you log them";
        return [textTable(["Tested", "Why it went nowhere"], rows.map((r) => [testedLine({ ...r, reason: "" }), r.reason]), source)];
      }
      case "cleanup": {
        const rows = data.cleanup.filter((c) => c.status !== "dismissed");
        if (rows.length === 0) return "No clean-up items recorded";
        return [textTable(["Item", "Host", "Kind", "Status"], rows.map((c) => [c.target, hostName(data, c.hostId), c.kind, c.status === "removed" ? "Removed" : "Still to remove"]), source)];
      }
      case "references": {
        // Only findings on the report's targets: a host or a service of one.
        const onTargets = new Set(targets().flatMap((t) => t.hostIds));
        const linked = data.findings.filter(
          (f) => f.hostIds.some((id) => onTargets.has(id)) || f.serviceIds.some((id) => onTargets.has(data.services.find((s) => s.id === id)?.hostId ?? "")),
        );
        const refs = [...new Set(linked.flatMap((f) => f.refs))];
        if (refs.length === 0) return "References from your findings appear here";
        return refs.map((r): ReportNode => ({ type: "paragraph", attrs: { source }, content: inlineMarkdown(r) }));
      }
    }
  })();
  return typeof blocks === "string" ? [hintPara(blocks, source)] : stamp(blocks);
}

/** The Metasploit line: where it was used and with which modules, or that it was not used. */
export function msfLine(data: ReportData): ReportNode {
  const rows = msfModules(data.log, data.engagement, data.hosts);
  // A Meterpreter session or payload is Metasploit use too, though it names no module.
  const hostIds = [...new Set([...rows.map((r) => r.hostId), ...msfHosts(data.log, data.engagement, data.hosts)])];
  let line: string;
  if (hostIds.length === 0) line = "Metasploit was not used.";
  else {
    const named = hostIds.map((id) => {
      const h = data.hosts.find((x) => x.id === id);
      return h?.ip ? `${h.name} (${h.ip})` : hostName(data, id);
    });
    const modules = [...new Set(rows.map((r) => r.module))];
    line = `Metasploit was used on ${named.join(" and ")}${modules.length > 0 ? `: ${modules.join(", ")}.` : "."}`;
  }
  return stamp([para([text(line)], "msf")])[0];
}
