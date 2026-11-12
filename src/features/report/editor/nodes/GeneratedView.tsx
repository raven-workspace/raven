import { PencilSimpleLine } from "@phosphor-icons/react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { ReactNodeViewProps } from "prosekit/react";
import type { Node as PMNode, Schema } from "prosekit/pm/model";
import { TextSelection } from "prosekit/pm/state";
import {
  attackChain,
  attackPathRows,
  CHAIN_KEY,
  findingRows,
  machineKey,
  machineOrder,
  msfHosts,
  msfModules,
  portRows,
  reportTargets,
  resultLine,
  scopeRows,
  testedLine,
  testedNotExploited,
  type GeneratedAttrs,
  type HeadingLabel,
  type PortsAttrs,
  type ReportData,
  type ReportTarget,
  type ResultLine,
} from "../../../../engines/report";
import { IconButton } from "../../../../ui";
import { useAppendixRef, usePageLayout, useReportData, type ReportDataValue } from "../ReportDataContext";
import { AppendixRef, Block, BlockTools, capitalize, MoveButton } from "./parts";

/**
 * A generated table. Columns in `fit` (IPs, host names) are as wide as their longest text and never wrap; the others
 * share the rest and wrap. The widths are set up front (fixed layout, in `ch` of tabular digits) rather than left to
 * the browser's automatic table layout: WebKit kept a column at its first width when its text grew (a late web font, a
 * value filled in after load), so a long IP (172.31.166.143) overprinted the next column.
 */
function Table({ head, rows, fit = [] }: { head: string[]; rows: ReactNode[][]; fit?: number[] }) {
  const cls = (j: number) => (fit.includes(j) ? "report-fit" : undefined);
  const chars = (j: number) => Math.max(head[j].length, ...rows.map((r) => (typeof r[j] === "string" ? (r[j] as string).length : 0)));
  return (
    <table className="report-table" data-fixed={fit.length > 0 || undefined}>
      {fit.length > 0 && (
        <colgroup>
          {head.map((h, j) => (
            // Letters run a little wider than a digit's 1ch: 15% spare, plus the cell's 16px of padding.
            <col key={h} style={fit.includes(j) ? { width: `calc(${Math.ceil(chars(j) * 1.15)}ch + 16px)` } : undefined} />
          ))}
        </colgroup>
      )}
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

/** A run of text: plain, or `code` (mono), as the result line and the attack path's access print it. */
interface Run {
  text: string;
  code?: boolean;
}

/** Text with `backtick` spans as code runs ("shell as `ronan`"). */
function ticked(text: string): Run[] {
  return text.split(/`([^`]*)`/).flatMap((t, i) => (t === "" ? [] : [{ text: t, code: i % 2 === 1 }]));
}

const Runs = ({ runs }: { runs: Run[] }) => (
  <>
    {runs.map((r, i) => (r.code ? <code key={i}>{r.text}</code> : <span key={i}>{r.text}</span>))}
  </>
);

/** The result line after its bold "Result:": "shell as `ronan`, then root. local.txt `<value>`, proof.txt `<value>`." */
function resultRuns(line: ResultLine): Run[] {
  const out: Run[] = [];
  if (line.access) out.push({ text: " " }, ...ticked(line.access), { text: "." });
  line.flags.forEach((f, i) => {
    out.push({ text: i === 0 ? " " : ", " }, { text: `${f.kind}.txt ` }, { text: f.value, code: true });
    if (i === line.flags.length - 1) out.push({ text: "." });
  });
  return out;
}

/**
 * A port's Notes cell, typed in place on the paper and kept on the node. The field keeps its own text while focused, so
 * the node's round trip never moves the caret; an undo shows here once the field is left. ↵ or Esc goes back to the page.
 */
function NotesCell({ port, value, onChange, onDone }: { port: string; value: string; onChange(v: string): void; onDone(): void }) {
  const [text, setText] = useState(value);
  const [was, setWas] = useState(value);
  const [focused, setFocused] = useState(false);
  if (was !== value) {
    setWas(value);
    if (!focused) setText(value);
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    onDone();
  };
  return (
    <input
      className="report-cell-input"
      aria-label={`Notes for ${port}`}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(value);
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      onKeyDown={onKey}
    />
  );
}

/** The target a machine belongs to: the page's own, else the report's target holding it, else the machine alone. */
function targetOf(ctx: ReportDataValue, hostId: string): ReportTarget {
  if (ctx.target?.hostIds.includes(hostId)) return ctx.target;
  return reportTargets(ctx.data, ctx.reportMeta ?? {}).find((t) => t.hostIds.includes(hostId)) ?? { key: hostId, kind: "standalone", hostIds: [hostId] };
}

/** The result line as the owner's own paragraph: the same words, "Result:" bold and the mono parts as inline code. */
function resultParagraph(schema: Schema, runs: Run[]): PMNode {
  const bold = schema.marks.bold;
  const code = schema.marks.code;
  const text = [
    schema.text("Result:", bold ? [bold.create()] : []),
    // ProseMirror has no empty text nodes: an empty run (a flag logged with no value) is left out.
    ...runs.filter((r) => r.text !== "").map((r) => schema.text(r.text, r.code && code ? [code.create()] : [])),
  ];
  return schema.nodes.paragraph.create({ fromEntry: null }, text);
}

function Content({
  attrs,
  ctx,
  notesEdit,
}: {
  attrs: GeneratedAttrs;
  ctx: ReportDataValue;
  /** On the page, a port table's Notes are typed in place; elsewhere (the appendix page) they print as text. */
  notesEdit?: { onChange(serviceId: string, text: string): void; onDone(): void };
}) {
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
      // The AD set's machines in the order the page lists them: the attack path, the DC last.
      const inSet = adHosts.filter((h) => targets.some((t) => t.hostIds.includes(h.id)));
      const hosts = host ? [host] : machineOrder(data, inSet.map((h) => h.id)).flatMap((id) => inSet.find((h) => h.id === id) ?? []);
      return (
        <>
          <p className="report-label">Port Scan Results</p>
          <Table head={["IP Address", "Ports Open"]} fit={[0]} rows={hosts.map((h) => [h.ip ?? h.name, portsOpen(data, h.id)])} />
        </>
      );
    }
    case "ports": {
      if (!host) return <None text="This host was deleted." />;
      const rows = portRows(data, host.id);
      if (rows.length === 0) return <None text={`No open ports recorded for ${host.name}`} />;
      const notes = (attrs as PortsAttrs).notes ?? {};
      return (
        <>
          <p className="report-label">Port Scan Results</p>
          <Table
            head={["Port", "Service", "Version", "Notes"]}
            fit={[0]}
            rows={rows.map((r) => [
              r.port,
              r.service,
              r.version,
              notesEdit ? (
                <NotesCell port={r.port} value={notes[r.serviceId] ?? ""} onChange={(v) => notesEdit.onChange(r.serviceId, v)} onDone={notesEdit.onDone} />
              ) : (
                (notes[r.serviceId] ?? "")
              ),
            ])}
          />
        </>
      );
    }
    case "result": {
      if (!host) return <None text="This host was deleted." />;
      const runs = resultRuns(resultLine(data, targetOf(ctx, host.id), host.id, meta));
      return (
        <p className="report-result">
          <strong>Result:</strong>
          {runs.length > 0 ? <Runs runs={runs} /> : <span className="report-none"> No access or flags recorded yet.</span>}
        </p>
      );
    }
    case "findings": {
      const rows = findingRows(data, targets);
      if (rows.length === 0) return <None text="No findings recorded yet." />;
      return (
        <Table
          head={["#", "Host", "Finding", "Severity", "Result"]}
          fit={[0, 1]}
          rows={rows.map((r) => [String(r.n), r.host, r.title, r.severity ? capitalize(r.severity) : "Not set", r.result])}
        />
      );
    }
    case "scope-table": {
      const rows = scopeRows(data, targets);
      if (rows.length === 0) return <None text="No targets in the report yet." />;
      return <Table head={["Host", "IP address", "OS", "Set"]} fit={[0, 1]} rows={rows.map((r) => [r.host, r.ip, r.os, r.set])} />;
    }
    case "attack-path": {
      const set = ctx.target?.kind === "ad-set" ? ctx.target : targets.find((t) => t.kind === "ad-set");
      const rows = attackPathRows(data, set?.hostIds ?? []);
      if (rows.length === 0) return <None text="No hops or access recorded on the AD set yet." />;
      return (
        <>
          <p className="report-label">Attack path</p>
          <Table
            head={["Step", "From", "Technique", "To", "Access gained"]}
            fit={[0]}
            rows={rows.map((r) => [String(r.step), r.from, r.technique, r.to, <Runs key="a" runs={ticked(r.access)} />])}
          />
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
      // A Meterpreter session or payload is Metasploit use too, though it names no module.
      const hostIds = [...new Set([...rows.map((r) => r.hostId), ...msfHosts(data.log, data.engagement, data.hosts)])];
      if (hostIds.length === 0) return <p>Metasploit was not used.</p>;
      const named = hostIds.map((id) => {
        const h = data.hosts.find((x) => x.id === id);
        return h?.ip ? `${h.name} (${h.ip})` : hostName(data, id);
      });
      const modules = [...new Set(rows.map((r) => r.module))];
      return (
        <p>
          Metasploit was used on {named.join(" and ")}
          {modules.length > 0 ? `: ${modules.join(", ")}.` : "."}
        </p>
      );
    }
    case "cleanup": {
      const rows = data.cleanup.filter((c) => c.status !== "dismissed" && (!attrs.hostId || c.hostId === attrs.hostId));
      if (rows.length === 0) return <None text="No clean-up items recorded." />;
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
      // Only findings on the report's targets: a host or a service of one.
      const onTargets = new Set(targets.flatMap((t) => t.hostIds));
      const linked = data.findings.filter(
        (f) => f.hostIds.some((id) => onTargets.has(id)) || f.serviceIds.some((id) => onTargets.has(data.services.find((s) => s.id === id)?.hostId ?? "")),
      );
      const refs = [...new Set(linked.flatMap((f) => f.refs))];
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

/** A table or list generated from live data; moved to an appendix, it leaves a one-line reference. A port table's Notes
 *  cells are the owner's, typed on the page and kept on the node; a result line's Edit text makes it the owner's
 *  paragraph, which no longer follows the log. */
export function GeneratedView({ node, selected, setAttrs, view, getPos }: ReactNodeViewProps) {
  const ctx = useReportData();
  const ref = useAppendixRef(node);
  const { touched } = usePageLayout();
  const attrs = node.attrs as GeneratedAttrs;
  const host = attrs.hostId ? ctx.data.hosts.find((h) => h.id === attrs.hostId) : undefined;
  const onNotes = (serviceId: string, text: string) => {
    const notes = { ...((node.attrs as PortsAttrs).notes ?? {}) };
    if (text === "") delete notes[serviceId];
    else notes[serviceId] = text;
    setAttrs({ notes });
  };
  const detachResult = () => {
    const pos = getPos();
    if (pos === undefined || !host) return;
    const runs = resultRuns(resultLine(ctx.data, targetOf(ctx, host.id), host.id, ctx.reportMeta ?? {}));
    const para = resultParagraph(view.state.schema, runs);
    const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, para);
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + para.nodeSize - 1), -1)).scrollIntoView());
    view.focus();
  };
  const canDetach = attrs.kind === "result" && !!host && attrs.appendix !== "moved";
  return (
    <Block selected={selected} kind="generated">
      {selected && touched && (ctx.canMove || canDetach) && (
        <BlockTools>
          {canDetach && <IconButton icon={PencilSimpleLine} label="Edit text" onClick={detachResult} />}
          {ctx.canMove && <MoveButton place={attrs.appendix} canSplit={false} onMove={(next) => setAttrs({ appendix: next })} />}
        </BlockTools>
      )}
      {attrs.appendix === "moved" ? <AppendixRef label="Full list" refText={ref} /> : <Content attrs={attrs} ctx={ctx} notesEdit={{ onChange: onNotes, onDone: () => view.focus() }} />}
    </Block>
  );
}
