import type { ReactNode } from "react";
import type { ReactNodeViewProps } from "prosekit/react";
import {
  attackChain,
  CHAIN_KEY,
  machineKey,
  msfModules,
  reportTargets,
  testedLine,
  testedNotExploited,
  type GeneratedAttrs,
  type HeadingLabel,
  type ReportData,
} from "../../../../engines/report";
import { useAppendixRef, usePageLayout, useReportData, type ReportDataValue } from "../ReportDataContext";
import { AppendixRef, Block, BlockTools, MoveButton } from "./parts";

/** A generated table. Columns in `fit` (ports, IPs) take their content's width and never wrap; the others take the slack. */
function Table({ head, rows, fit = [] }: { head: string[]; rows: ReactNode[][]; fit?: number[] }) {
  const cls = (j: number) => (fit.includes(j) ? "report-fit" : undefined);
  return (
    <table className="report-table">
      <thead>
        <tr>
          {head.map((h, j) => (
            <th key={h} className={cls(j)}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={cls(j)}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const List = ({ items, ordered = false }: { items: string[]; ordered?: boolean }) => {
  const children = items.map((t, i) => <li key={i}>{t}</li>);
  return ordered ? <ol>{children}</ol> : <ul>{children}</ul>;
};

const None = ({ text = "None recorded." }: { text?: string }) => <p className="report-none">{text}</p>;

const hostName = (data: ReportData, id: string | null) => (id ? (data.hosts.find((h) => h.id === id)?.name ?? id) : "");

/** "TCP: 21, 80, 135" and "UDP: 161" lines for a host's services, as the sample's Ports Open cell. */
function portsOpen(data: ReportData, hostId: string): ReactNode {
  const services = data.services.filter((s) => s.hostId === hostId);
  const lines = (["tcp", "udp"] as const).flatMap((proto) => {
    const ports = [...new Set(services.filter((s) => s.protocol.toLowerCase() === proto).map((s) => s.port))].sort((a, b) => a - b);
    return ports.length > 0 ? [{ proto: proto.toUpperCase(), ports: ports.join(", ") }] : [];
  });
  if (lines.length === 0) return "None recorded";
  return lines.map((l) => (
    <div key={l.proto}>
      <strong>{l.proto}</strong>: {l.ports}
    </div>
  ));
}

/** A numbered heading of the target page ("4.1 Target #1 – 10.0.0.5"), from the page layout. */
function NumberedHeading({ label, fallback, level }: { label: HeadingLabel | null; fallback: string; level: 2 | 3 }) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag className={level === 2 ? "report-h2" : "report-h3"}>
      {label?.number && <span className="report-num">{label.number}</span>}
      {label?.text ?? fallback}
    </Tag>
  );
}

function Content({ attrs, ctx }: { attrs: GeneratedAttrs; ctx: ReportDataValue }) {
  const { data } = ctx;
  const meta = ctx.reportMeta ?? {};
  const host = attrs.hostId ? data.hosts.find((h) => h.id === attrs.hostId) : undefined;
  const targets = reportTargets(data, meta);
  const adHosts = data.hosts.filter((h) => h.adSetEffective);
  const { heading } = usePageLayout();

  switch (attrs.kind) {
    case "facts": {
      if (!host) return <None text="This host was deleted." />;
      const fallback = host.ip ? `${host.name} – ${host.ip}` : host.name;
      return <NumberedHeading label={heading(machineKey(host.id))} fallback={fallback} level={2} />;
    }
    case "port-scan": {
      // The AD set's machines in the order the page lists them.
      const hosts = host ? [host] : adHosts.filter((h) => targets.some((t) => t.hostIds.includes(h.id))).sort((a, b) => a.name.localeCompare(b.name));
      return (
        <>
          <p className="report-label">Port Scan Results</p>
          <Table head={["IP Address", "Ports Open"]} fit={[0]} rows={hosts.map((h) => [h.ip ?? h.name, portsOpen(data, h.id)])} />
        </>
      );
    }
    case "tested": {
      const rows = testedNotExploited(data, attrs.hostId);
      if (rows.length === 0) return <None />;
      return <List items={rows.map(testedLine)} />;
    }
    case "scope": {
      const ips = targets.flatMap((t) => t.hostIds).flatMap((id) => {
        const h = data.hosts.find((x) => x.id === id);
        return h ? [h.ip || h.name] : [];
      });
      return (
        <p>
          <strong>{data.engagement.kind === "exam-sim" ? "Exam network:" : "Lab network:"}</strong> {ips.join(", ") || "None"}
        </p>
      );
    }
    case "msf": {
      const rows = msfModules(data.log, data.engagement, data.hosts);
      if (rows.length === 0) return <p>Metasploit was not used.</p>;
      const hostIds = [...new Set(rows.map((r) => r.hostId))];
      const named = hostIds.map((id) => {
        const h = data.hosts.find((x) => x.id === id);
        return h?.ip ? `${h.name} (${h.ip})` : hostName(data, id);
      });
      const modules = [...new Set(rows.map((r) => r.module))];
      return (
        <p>
          Metasploit was used on {named.join(" and ")}: {modules.join(", ")}.
        </p>
      );
    }
    case "cleanup": {
      const rows = data.cleanup.filter((c) => c.status !== "dismissed" && (!attrs.hostId || c.hostId === attrs.hostId));
      if (rows.length === 0) return <None text="Nothing was left on the targets." />;
      return <List items={rows.map((c) => `${c.target} on ${hostName(data, c.hostId)} (${c.kind}, ${c.status === "removed" ? "removed" : "still to remove"})`)} />;
    }
    case "attack-chain": {
      const hops = attackChain(data, adHosts.map((h) => h.id));
      return (
        <>
          <NumberedHeading label={heading(CHAIN_KEY)} fallback="Attack Chain" level={3} />
          {hops.length === 0 ? (
            <None />
          ) : (
            <List
              ordered
              items={hops.map((h) =>
                h.from ? `${hostName(data, h.from)} to ${hostName(data, h.to)} via ${h.via}` : `${hostName(data, h.to)}: ${h.via}`,
              )}
            />
          )}
        </>
      );
    }
    case "references": {
      const refs = [...new Set(data.findings.flatMap((f) => f.refs))];
      if (refs.length === 0) return <None />;
      return <List items={refs} />;
    }
    default:
      // A block kind from an earlier layout: nothing to render.
      return null;
  }
}

/** A generated table or list in full, as the appendix prints it. */
export function GeneratedContent({ attrs, ctx }: { attrs: GeneratedAttrs; ctx: ReportDataValue }) {
  return <Content attrs={attrs} ctx={ctx} />;
}

/** A table or list generated from live data; moved to an appendix, it leaves a one-line reference. */
export function GeneratedView({ node, selected, setAttrs }: ReactNodeViewProps) {
  const ctx = useReportData();
  const ref = useAppendixRef(node);
  const { touched } = usePageLayout();
  const attrs = node.attrs as GeneratedAttrs;
  return (
    <Block selected={selected} kind="generated">
      {selected && touched && ctx.canMove && (
        <BlockTools>
          <MoveButton place={attrs.appendix} canSplit={false} onMove={(next) => setAttrs({ appendix: next })} />
        </BlockTools>
      )}
      {attrs.appendix === "moved" ? <AppendixRef label="Full list" refText={ref} /> : <GeneratedContent attrs={attrs} ctx={ctx} />}
    </Block>
  );
}
