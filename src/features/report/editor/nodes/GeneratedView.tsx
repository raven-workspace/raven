import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { ReactNodeViewProps } from "prosekit/react";
import {
  attackChain,
  domainController,
  expectedFlags,
  exploitedSystems,
  msfModules,
  reportTargets,
  serviceCoverage,
  testedNotExploited,
  toolsUsed,
  type CoverageResult,
  type FlagKind,
  type GeneratedAttrs,
  type ReportData,
  type ReportTarget,
} from "../../../../engines/report";
import { api } from "../../../../lib/api";
import type { Host } from "../../../../types/host";
import { useAppendixRef, usePageLayout, useReportData, type ReportDataValue } from "../ReportDataContext";
import { AppendixRef, Block, BlockTools, capitalize, MoveButton } from "./parts";

const COVERAGE_WORDS: Record<CoverageResult, string> = {
  exploited: "exploited",
  tested: "tested, no exploitable issue found",
  untested: "not tested",
};

const SEVERITY_LEGEND: [string, string][] = [
  ["Critical", "Direct compromise of a system with no preconditions."],
  ["High", "Compromise of a system or its data with few preconditions."],
  ["Medium", "A weakness that helps an attacker toward a compromise."],
  ["Low", "A weakness with limited impact on its own."],
  ["Info", "An observation with no direct security impact."],
];

const RESTRICTIONS = [
  "Metasploit used on one target only",
  "No spoofing or poisoning",
  "No AI tools",
];

const OS_WORDS = { windows: "Windows", linux: "Linux", other: "Other" } as const;

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
const accessWords = (h: Host) => (h.access === "none" ? "none" : h.access === "user" ? "user" : h.os === "windows" ? "SYSTEM" : "root");

/** The non-private flag value of a kind on a host, or what stands in for it. */
function flagValue(data: ReportData, host: Host, kind: FlagKind, expected: FlagKind[]): string {
  const flag = data.log.find(
    (e) => !e.private && e.hostIds.includes(host.id) && e.content.kind === "flag" && e.content.flagKind === kind,
  );
  if (flag && flag.content.kind === "flag") return flag.content.value;
  return expected.includes(kind) ? "Not found" : "N/A";
}

function targetOf(targets: ReportTarget[], host: Host): ReportTarget {
  return (
    targets.find((t) => t.hostIds.includes(host.id)) ??
    (host.adSetEffective ? { key: "ad-set", kind: "ad-set", hostIds: [host.id] } : { key: host.id, kind: "standalone", hostIds: [host.id] })
  );
}

/**
 * One editable cell of the Tools appendix: page text (wrapping, so a long URL reads whole) until clicked, then a field
 * in place; Enter, Esc or leaving it ends the edit. An empty cell says what it wants, on screen only.
 */
function CellInput({ label, empty, value, onChange }: { label: string; empty: string; value: string; onChange(value: string): void }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button type="button" className="report-cell-edit" aria-label={label} onClick={() => setEditing(true)}>
        {value || <span className="report-cell-empty">{empty}</span>}
      </button>
    );
  }
  return (
    <input
      className="report-input"
      aria-label={label}
      value={value}
      spellCheck={false}
      autoFocus
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          setEditing(false);
        }
      }}
    />
  );
}

function Content({ attrs, ctx, attackerIp, editable = false }: { attrs: GeneratedAttrs; ctx: ReportDataValue; attackerIp: string; editable?: boolean }) {
  const { data, sectionMeta } = ctx;
  const meta = ctx.reportMeta ?? {};
  const host = attrs.hostId ? data.hosts.find((h) => h.id === attrs.hostId) : undefined;
  const targets = reportTargets(data, meta);
  const adHosts = data.hosts.filter((h) => h.adSetEffective);

  switch (attrs.kind) {
    case "facts": {
      if (!host) return <None text="This host was deleted." />;
      const ports = data.services.filter((s) => s.hostId === host.id).map((s) => s.port).sort((a, b) => a - b);
      const facts: [string, string | null][] = [
        ["IP", host.ip],
        ["OS", host.os ? OS_WORDS[host.os] : null],
        ["Ports", ports.length > 0 ? ports.join(", ") : null],
        ["Access", accessWords(host)],
      ];
      // Labelled values on one row that wraps: the label muted, the value in ink.
      return (
        <>
          <h2 className="report-h2">{host.name}</h2>
          <dl className="report-facts">
            {facts.flatMap(([label, value]) =>
              value ? [
                <div key={label} className="report-fact">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>,
              ] : [],
            )}
          </dl>
        </>
      );
    }
    case "services": {
      const rows = attrs.hostId ? serviceCoverage(data, attrs.hostId, sectionMeta.coverage ?? {}) : [];
      if (rows.length === 0) return <None text="No services recorded." />;
      const guessed = (r: (typeof rows)[number]) => !r.proven && r.product !== "";
      return (
        <>
          <Table
            head={["Port", "Service", "Result"]}
            fit={[0]}
            rows={rows.map((r) => [
              `${r.port}/${r.protocol}`,
              guessed(r) ? <span className="report-guess">{r.product}</span> : r.product,
              r.via ? `${COVERAGE_WORDS[r.result]} (${r.via})` : COVERAGE_WORDS[r.result],
            ])}
          />
          {/* One note for every unconfirmed product, not one per row. */}
          {rows.some(guessed) && <p className="report-note">{"Italic: nmap's guess, not confirmed."}</p>}
        </>
      );
    }
    case "vulns": {
      const findings = data.findings.filter((f) => !attrs.hostId || f.hostIds.includes(attrs.hostId));
      if (findings.length === 0) return <None />;
      return <List items={findings.map((f) => (f.severity ? `${f.title} (${capitalize(f.severity)})` : f.title))} />;
    }
    case "tested": {
      const rows = testedNotExploited(data, attrs.hostId);
      if (rows.length === 0) return <None />;
      return <List items={rows.map((r) => (r.reason ? `${r.title}: ${r.reason}` : r.title))} />;
    }
    case "proof-table-host": {
      if (!host) return <None text="This host was deleted." />;
      const expected = expectedFlags(targetOf(targets, host), host.id, meta);
      const rows: string[][] = [
        ["local.txt", flagValue(data, host, "local", expected)],
        ["proof.txt", flagValue(data, host, "proof", expected)],
        ["IP address", host.ip ?? ""],
        ["Hostname", host.name],
      ];
      if (host.adSetEffective && domainController(data, adHosts.map((h) => h.id)) === host.id) {
        const da = data.grants.some((g) => g.hostId === host.id && (g.level === "admin" || g.level === "system"));
        rows.push(["Domain admin", da ? "yes" : "no"]);
      }
      return <Table head={["Item", "Value"]} rows={rows} />;
    }
    case "engagement-details": {
      const e = data.engagement;
      const scope = targets.flatMap((t) => t.hostIds).map((id) => {
        const h = data.hosts.find((x) => x.id === id);
        return h?.ip ? `${h.name} (${h.ip})` : (h?.name ?? id);
      });
      const start = e.timeboxStart ?? e.startsAt;
      const end = e.timeboxStart && e.timeboxMinutes ? e.timeboxStart + e.timeboxMinutes * 60_000 : e.endsAt;
      const fmt = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
      const accounts = data.cleanup.filter((c) => c.kind === "account" && c.status !== "dismissed").map((c) => c.target);
      return (
        <Table
          head={["Item", "Detail"]}
          rows={[
            ["Scope", scope.join(", ") || "None"],
            ["Test window", start && end ? `${fmt(start)} to ${fmt(end)} UTC` : "Not set"],
            ["Attacker IP", attackerIp || "Not set"],
            ...(e.kind === "exam-sim" ? [["Restrictions", RESTRICTIONS.join("; ")]] : []),
            ["Accounts created", accounts.join(", ") || "None"],
          ]}
        />
      );
    }
    case "exploited-systems": {
      const rows = exploitedSystems(data, targets, ctx.targetMeta ?? {});
      if (rows.length === 0) return <None />;
      return <Table head={["Target", "IP", "Access", "Method"]} fit={[1]} rows={rows.map((r) => [r.name, r.ip ?? "", r.access, r.method])} />;
    }
    case "severity-legend":
      return (
        <>
          <Table head={["Severity", "Meaning"]} rows={SEVERITY_LEGEND} />
          <p>Ratings are technical severity, not business risk.</p>
        </>
      );
    case "ad-overview": {
      const dc = domainController(data, adHosts.map((h) => h.id));
      return (
        <>
          <h2 className="report-h2">Active Directory set</h2>
          <p>Domain: {data.engagement.domain ?? "Not set"}</p>
          <Table
            head={["Machine", "IP", "Role", "OS"]}
            fit={[1]}
            rows={adHosts.map((h) => [h.name, h.ip ?? "", h.id === dc ? "Domain controller" : "Member", h.os ? OS_WORDS[h.os] : ""])}
          />
        </>
      );
    }
    case "attack-chain": {
      const hops = attackChain(data, adHosts.map((h) => h.id));
      return (
        <>
          <h3 className="report-h3">Attack chain</h3>
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
    case "proof-table": {
      const rows = targets.flatMap((t) =>
        t.hostIds.flatMap((id) => {
          const h = data.hosts.find((x) => x.id === id);
          if (!h) return [];
          const expected = expectedFlags(t, id, meta);
          return [[h.name, h.ip ?? "", flagValue(data, h, "local", expected), flagValue(data, h, "proof", expected)]];
        }),
      );
      if (rows.length === 0) return <None />;
      return <Table head={["Target", "IP", "local.txt", "proof.txt"]} fit={[1]} rows={rows} />;
    }
    case "tools": {
      const overrides = sectionMeta.tools ?? {};
      const rows = toolsUsed(data.log, attrs.hostId ? [attrs.hostId] : data.hosts.map((h) => h.id), { attempts: data.attempts, overrides });
      if (rows.length === 0) return <None />;
      const edit = editable ? ctx.onSectionMeta : undefined;
      const cell = (tool: string, field: "purpose" | "url", value: string, label: string) =>
        edit ? (
          <CellInput label={`${label} of ${tool}`} empty={`Add ${field === "url" ? "the URL" : "its purpose"}`} value={value} onChange={(v) => edit({ tools: { ...overrides, [tool]: { ...overrides[tool], [field]: v } } })} />
        ) : (
          value
        );
      // Template 5.2: Tool, Purpose, URL. Purpose and URL come from the catalog; the owner's edits are kept per row.
      return (
        <Table
          head={["Tool", "Purpose", "URL"]}
          fit={[0]}
          rows={rows.map((r) => [r.tool, cell(r.tool, "purpose", r.purpose, "Purpose"), cell(r.tool, "url", r.url, "URL")])}
        />
      );
    }
    case "msf": {
      const rows = msfModules(data.log, data.engagement, data.hosts).filter((r) => !attrs.hostId || r.hostId === attrs.hostId);
      if (rows.length === 0) return <None text="Metasploit was not used." />;
      return <Table head={["Target", "Module"]} rows={rows.map((r) => [hostName(data, r.hostId), r.module])} />;
    }
    case "cleanup": {
      const rows = data.cleanup.filter((c) => c.status !== "dismissed" && (!attrs.hostId || c.hostId === attrs.hostId));
      if (rows.length === 0) return <None />;
      return (
        <Table
          head={["Host", "Kind", "Item", "Status"]}
          rows={rows.map((c) => [hostName(data, c.hostId), c.kind, c.target, c.status === "removed" ? "removed" : "open"])}
        />
      );
    }
    case "references": {
      const refs = [...new Set(data.findings.flatMap((f) => f.refs))];
      if (refs.length === 0) return <None />;
      return <List items={refs} />;
    }
  }
}

/** A generated table or list in full, as the appendix prints it; `editable` (on its own page) lets the Tools rows take edits. */
export function GeneratedContent({ attrs, ctx, editable = false }: { attrs: GeneratedAttrs; ctx: ReportDataValue; editable?: boolean }) {
  const attackerIp = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet }).data?.attackerIp ?? "";
  return <Content attrs={attrs} ctx={ctx} attackerIp={attackerIp} editable={editable} />;
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
      {attrs.appendix === "moved" ? <AppendixRef label="Full list" refText={ref} /> : <GeneratedContent attrs={attrs} ctx={ctx} editable />}
    </Block>
  );
}
