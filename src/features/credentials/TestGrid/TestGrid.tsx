import { useEffect, useMemo, useRef, useState } from "react";
import { cellFor, cellModes, credLabel, credName, hostSprayServices, isSprayable, type CellState, type SprayService } from "../../../engines/credentials/index";
import type { Cell } from "../../../engines/credentials/index";
import type { CredAttempt, Credential, TriedPair } from "../../../types/credentials";
import type { Host } from "../../../types/host";
import type { Service } from "../../../types/service";
import { ChipSet, IconButton, Tooltip, labelClass } from "../../../ui/index";
import { Trash } from "@phosphor-icons/react";
import { ConfirmDelete } from "../../checklist/ConfirmDelete/ConfirmDelete";
import { useForgetTried } from "../queries";
import { CellPopover } from "../CellPopover/CellPopover";
import { revealRow } from "../../../lib/revealRow";
import { MaskedSecret } from "../MaskedSecret/MaskedSecret";
import { hostLabel } from "../../../lib/hostName";
import { cx } from "../../../lib/cx";
import "./TestGrid.scss";

const META: Record<CellState, { glyph: string; label: string; aria: string }> = {
  admin: { glyph: "A", label: "Admin", aria: "admin" },
  valid: { glyph: "V", label: "Valid", aria: "valid" },
  failed: { glyph: "✕", label: "Failed", aria: "failed" },
  untested: { glyph: "·", label: "Untested", aria: "untested" },
  errored: { glyph: "!", label: "Errored, retry", aria: "errored, retry" },
  na: { glyph: "", label: "Not applicable", aria: "not applicable" },
};

const HATCH = { backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 5px)", opacity: 0.45 };
/** A state glyph's box and tone (TestGrid.scss). */
const glyphClass = (state: CellState) => `test-grid__glyph test-grid__glyph--${state}`;

function Glyph({ state }: { state: CellState }) {
  const meta = META[state];
  return (
    <span aria-hidden="true" className={glyphClass(state)} style={state === "na" ? HATCH : undefined}>
      {meta.glyph}
    </span>
  );
}

/** "domain failed, local untried": spelled out when a failed cell still has an untried mode. */
function partialLabel(cred: Credential, service: SprayService, cell: Cell): string | null {
  if (cell.state !== "failed" || cell.untriedModes.length === 0) return null;
  return cellModes(cred, service, cell)
    .map((m) => `${m} ${cell.untriedModes.includes(m) ? (cell.byMode[m] ? "errored" : "untried") : cell.byMode[m]!.result}`)
    .join(", ");
}

type LegendKey = CellState | "other";
const LEGEND_ORDER: CellState[] = ["admin", "valid", "failed", "untested", "errored", "na"];

/** Exactly the cell states the rendered grid shows: a legend entry exists only while a cell wears it. */
function Legend({ present }: { present: ReadonlySet<LegendKey> }) {
  const states = LEGEND_ORDER.filter((s) => present.has(s));
  return (
    <ChipSet as="ul" gap={6} aria-label="Legend" className="test-grid__legend">
      {states.map((s) => (
        <li key={s} className="test-grid__legend-item">
          <span aria-hidden="true" className={`${glyphClass(s)} test-grid__glyph--legend`} style={s === "na" ? HATCH : undefined}>{META[s].glyph}</span>
          {META[s].label}
        </li>
      ))}
      {present.has("other") && (
        <li className="test-grid__legend-item">
          <span aria-hidden="true" className={`${glyphClass("failed")} test-grid__glyph--legend`}>
            {META.failed.glyph}
            <span className="test-grid__untried" />
          </span>
          Other mode untried
        </li>
      )}
    </ChipSet>
  );
}

/** A hash shown by its ends: enough to tell tried hashes apart without the whole value. */
const truncatedHash = (h: string) => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);

type TriedRow = ReturnType<typeof triedRows>[number];

/** One muted row per (username, domain, secret): the failed sprays kept without becoming credentials. */
function triedRows(tried: TriedPair[]) {
  const rows = new Map<string, { key: string; username: string; domain: string | null; secret: string; kind: TriedPair["secretKind"]; cells: Set<string>; ids: string[] }>();
  for (const t of tried) {
    const key = `${t.username.toLowerCase()}\0${(t.domain ?? "").toLowerCase()}\0${t.secret}`;
    const row = rows.get(key) ?? { key, username: t.username, domain: t.domain, secret: t.secret, kind: t.secretKind, cells: new Set<string>(), ids: [] };
    row.cells.add(`${t.hostId}:${t.service}`);
    row.ids.push(t.id);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** ArrowUp/Down move focus between the row-select buttons of one table; they never select. */
function moveRowFocus(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const buttons = [...(e.currentTarget.closest("table")?.querySelectorAll<HTMLButtonElement>("button[data-row-select]") ?? [])];
  const next = buttons[buttons.indexOf(e.target as HTMLButtonElement) + (e.key === "ArrowDown" ? 1 : -1)];
  e.preventDefault();
  next?.focus();
}

export function TestGrid({ eid, hosts, creds, attempts, servicesByHost, tried = [], selectedId, onSelect, fill = false, note }: {
  eid: string;
  hosts: Host[];
  creds: Credential[];
  attempts: CredAttempt[];
  servicesByHost: Map<string, Service[]>;
  tried?: TriedPair[];
  /** With onSelect, credential row headers are buttons and the selected row is marked. */
  selectedId?: string;
  onSelect?: (credId: string) => void;
  /** Fill the parent's height: the grid box takes what the header and legend leave and scrolls inside itself. */
  fill?: boolean;
  /** With fill: shown right of the legend, on the same row. */
  note?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    setFade(el.scrollWidth - el.scrollLeft - el.clientWidth > 1);
    // Snap and scroll-into-view stop below the sticky header, never under it.
    el.style.setProperty("--head-h", `${el.querySelector("thead")?.getBoundingClientRect().height ?? 0}px`);
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
  // Snap proximity does not re-run when the scroller itself resizes (the dock folding): realign a row cut by the header.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const head = el.querySelector("thead")?.getBoundingClientRect().bottom ?? 0;
      const cut = [...el.querySelectorAll("tbody tr")].find((tr) => {
        const r = tr.getBoundingClientRect();
        return r.top < head - 0.5 && r.bottom > head + 0.5;
      });
      if (cut) el.scrollTop += cut.getBoundingClientRect().top - head;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The selected row stays in view inside the grid's own scroller (never the page): on mount and when the selection moves.
  const selectable = !!onSelect;
  useEffect(() => {
    if (!selectable || !selectedId) return;
    const box = scroller.current;
    const row = box?.querySelector("tr[aria-selected='true']");
    if (box && row) revealRow(box, row, box.querySelector("thead")?.getBoundingClientRect().height ?? 0);
  }, [selectable, selectedId]);
  const [open, setOpen] = useState<{ credId: string; hostId: string; service: SprayService }>();
  const rows = useMemo(() => creds.filter(isSprayable), [creds]);
  const triedList = useMemo(() => triedRows(tried), [tried]);
  const [forgetting, setForgetting] = useState<TriedRow>();
  const forget = useForgetTried(eid);
  const groups = useMemo(
    () => hosts.map((host) => ({ host, services: hostSprayServices(host, servicesByHost.get(host.id) ?? []) })).filter((g) => g.services.length > 0),
    [hosts, servicesByHost],
  );
  const present = useMemo(() => {
    const out = new Set<LegendKey>();
    for (const cred of rows) {
      for (const { host, services } of groups) {
        for (const service of services) {
          const cell = cellFor(cred, host, servicesByHost.get(host.id) ?? [], service, attempts);
          out.add(cell.state);
          if (partialLabel(cred, service, cell)) out.add("other");
        }
      }
    }
    for (const t of triedList) {
      for (const { host, services } of groups) for (const service of services) out.add(t.cells.has(`${host.id}:${service}`) ? "failed" : "na");
    }
    return out;
  }, [rows, groups, servicesByHost, attempts, triedList]);

  // As the master list of the credentials page the tab already names it: no section label, and the legend shares a row with the note.
  const docked = fill && !!onSelect;
  const header = docked ? null : <h3 className={labelClass}>Test matrix</h3>;
  if ((rows.length === 0 && triedList.length === 0) || groups.length === 0) {
    return (
      <section aria-label="Test matrix" className="test-grid">
        {header}
        <p className="test-grid__empty">
          {rows.length === 0
            ? "No sprayable credentials yet. Hashes appear here once cracked (NTLM hashes are tested as-is)."
            : "No host has scanned services yet. Import an nmap scan to fill the grid."}
        </p>
        {note}
      </section>
    );
  }

  const openCred = open && creds.find((c) => c.id === open.credId);
  const openHost = open && hosts.find((h) => h.id === open.hostId);

  return (
    <section aria-label="Test matrix" className={cx("test-grid", docked && "test-grid--docked")}>
      {docked ? (
        <div className="test-grid__bar">
          <Legend present={present} />
          {note}
        </div>
      ) : (
        <>
          {header}
          <Legend present={present} />
        </>
      )}
      <div className={cx("test-grid__box", docked && "test-grid__box--docked")}>
        <div ref={scroller} onScroll={measure} className="test-grid__scroller">
        <table aria-label="Test grid" className="test-grid__table">
          <thead className="test-grid__head">
            <tr>
              <th rowSpan={2} scope="col" className={`test-grid__corner ${labelClass}`}>Credential</th>
              {groups.map(({ host, services }) => (
                <th key={host.id} colSpan={services.length} scope="colgroup" className="test-grid__host">
                  <span className="test-grid__host-name" title={host.ip && host.ip !== hostLabel(host) ? `${hostLabel(host)} ${host.ip}` : hostLabel(host)}>{hostLabel(host)}</span>
                  {host.ip && host.ip !== hostLabel(host) && <span className="test-grid__host-ip">{host.ip}</span>}
                </th>
              ))}
            </tr>
            <tr>
              {groups.flatMap(({ host, services }) =>
                services.map((s, i) => (
                  <th key={`${host.id}-${s}`} scope="col" className={cx("test-grid__service", i === 0 && "test-grid__service--first")}>
                    {s.toUpperCase()}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((cred) => {
              const selected = !!onSelect && cred.id === selectedId;
              const lines = (
                <>
                  <div className="test-grid__cred" title={credName(cred)}>{credName(cred)}</div>
                  <div className="test-grid__cred-meta">
                    <span>{cred.type}</span>
                    {cred.scope !== "domain" && <span className="test-grid__cred-scope">{cred.scope}</span>}
                  </div>
                </>
              );
              return (
                <tr key={cred.id} data-cred-id={cred.id} className="test-grid__row" {...(selected ? { "data-state": "selected", "aria-selected": true } : {})}>
                  <th scope="row" className={cx("test-grid__row-head", onSelect && "test-grid__row-head--select", selected && "test-grid__row-head--selected")}>
                    {onSelect ? (
                      <button
                        type="button"
                        data-row-select=""
                        aria-pressed={selected}
                        aria-label={`Select ${credLabel(cred)}`}
                        onClick={() => onSelect(cred.id)}
                        onKeyDown={moveRowFocus}
                        className="test-grid__select"
                      >
                        {lines}
                      </button>
                    ) : lines}
                  </th>
                  {groups.flatMap(({ host, services }) =>
                    services.map((service, i) => {
                      const cell = cellFor(cred, host, servicesByHost.get(host.id) ?? [], service, attempts);
                      const partial = partialLabel(cred, service, cell);
                      const label = `${credLabel(cred)} on ${hostLabel(host)} ${service.toUpperCase()}: ${partial ?? META[cell.state].aria}${cell.modesDiffer ? " (domain and local differ)" : ""}`;
                      return (
                        <td key={`${host.id}-${service}`} className={cx("test-grid__cell", selected && "test-grid__cell--selected", i === 0 && "test-grid__cell--first")}>
                          {cell.state === "na" ? (
                            <span role="img" aria-label={label} title={label} className="test-grid__static"><Glyph state="na" /></span>
                          ) : (
                            <Tooltip content={label}>
                              <button
                                type="button"
                                aria-label={label}
                                aria-haspopup="dialog"
                                onClick={() => setOpen({ credId: cred.id, hostId: host.id, service })}
                                className="test-grid__open"
                              >
                                <Glyph state={cell.state} />
                                {partial && <span data-testid="untried-marker" aria-hidden="true" className="test-grid__untried test-grid__untried--cell" />}
                                {cell.modesDiffer && <span aria-hidden="true" className="test-grid__differ" />}
                              </button>
                            </Tooltip>
                          )}
                        </td>
                      );
                    }),
                  )}
                </tr>
              );
            })}
            {triedList.map((t) => {
              const who = `${t.domain ? `${t.domain}\\` : ""}${t.username}`;
              return (
                <tr key={t.key} data-tried="" className="test-grid__row test-grid__row--tried">
                  <th scope="row" className="test-grid__row-head">
                    <div className="test-grid__tried-name" title={who}>{t.username}</div>
                    <div data-testid="tried-secret">
                      {t.kind === "hash" ? (
                        <span className="test-grid__tried-hash" aria-label={`tried hash for ${who}`}>{truncatedHash(t.secret)}</span>
                      ) : (
                        <MaskedSecret secret={t.secret} label={`secret tried for ${who}`} />
                      )}
                    </div>
                    <div className="test-grid__tried-foot">
                      <span className="test-grid__tried-kind" title={`${t.domain ? `${t.domain}: ` : ""}tried ${t.kind}, not a credential`}>tried {t.kind}</span>
                      <IconButton icon={Trash} tone="destructive" label={`Forget the tried ${t.kind} for ${who}`} onClick={() => setForgetting(t)} />
                    </div>
                  </th>
                  {groups.flatMap(({ host, services }) =>
                    services.map((service, i) => {
                      const hit = t.cells.has(`${host.id}:${service}`);
                      const label = `${who} on ${hostLabel(host)} ${service.toUpperCase()}: ${hit ? "failed (tried)" : "not tried"}`;
                      return (
                        <td key={`${host.id}-${service}`} className={cx("test-grid__cell", i === 0 && "test-grid__cell--first")}>
                          <span role="img" aria-label={label} title={label} className="test-grid__static">
                            <Glyph state={hit ? "failed" : "na"} />
                          </span>
                        </td>
                      );
                    }),
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {fade && <div aria-hidden className="test-grid__fade" />}
      </div>
      {forgetting && (
        <ConfirmDelete
          title={`Forget the tried ${forgetting.kind} for ${forgetting.domain ? `${forgetting.domain}\\` : ""}${forgetting.username}?`}
          detail={`Its row goes from the matrix (${forgetting.cells.size} ${forgetting.cells.size === 1 ? "cell" : "cells"}). The log keeps the commands that tried it.`}
          label="Forget"
          pending={forget.isPending}
          error={forget.error?.message}
          onCancel={() => setForgetting(undefined)}
          onConfirm={() => forget.mutate(forgetting.ids, { onSuccess: () => setForgetting(undefined) })}
        />
      )}
      {open && openCred && openHost && (
        <CellPopover
          eid={eid}
          cred={openCred}
          host={openHost}
          services={servicesByHost.get(openHost.id) ?? []}
          service={open.service}
          attempts={attempts}
          onClose={() => setOpen(undefined)}
        />
      )}
    </section>
  );
}
