import { useMemo, useState } from "react";
import { cellFor, cellModes, credLabel, hostSprayServices, isSprayable, type CellState, type SprayService } from "../../engines/credentials";
import type { Cell } from "../../engines/credentials";
import type { CredAttempt, Credential, TriedPair } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { labelClass } from "../../ui";
import { hostLabel } from "./AccessGrants";
import { CellPopover } from "./CellPopover";
import { MaskedSecret } from "./MaskedSecret";

const META: Record<CellState, { glyph: string; label: string; aria: string; tone: string }> = {
  admin: { glyph: "A", label: "Admin", aria: "admin", tone: "border-accent bg-accent text-bg font-semibold" },
  valid: { glyph: "V", label: "Valid", aria: "valid", tone: "border-accent text-accent font-semibold" },
  failed: { glyph: "✕", label: "Failed", aria: "failed", tone: "border-line-2 text-fg-2" },
  untested: { glyph: "·", label: "Untested", aria: "untested", tone: "border-line text-muted" },
  errored: { glyph: "!", label: "Errored, retry", aria: "errored, retry", tone: "border-warn text-warn" },
  na: { glyph: "", label: "Not applicable", aria: "not applicable", tone: "border-line text-faint" },
};

const HATCH = { backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 5px)", opacity: 0.45 };
const BOX = "relative inline-flex h-8 w-8 items-center justify-center rounded-sm border font-mono text-xs";

function Glyph({ state }: { state: CellState }) {
  const meta = META[state];
  return (
    <span aria-hidden="true" className={`${BOX} ${meta.tone}`} style={state === "na" ? HATCH : undefined}>
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

function Legend() {
  const states: CellState[] = ["admin", "valid", "failed", "untested", "errored", "na"];
  return (
    <ul aria-label="Legend" className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-[11px] text-muted">
      {states.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`${BOX} h-5 w-5 text-[10px] ${META[s].tone}`} style={s === "na" ? HATCH : undefined}>{META[s].glyph}</span>
          {META[s].label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-2 rounded-full border border-dashed border-fg-2" />
        Failed, other mode untried
      </li>
    </ul>
  );
}

/** A hash shown by its ends: enough to tell tried hashes apart without the whole value. */
const truncatedHash = (h: string) => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);

/** One muted row per (username, domain, secret): the failed sprays kept without becoming credentials. */
function triedRows(tried: TriedPair[]) {
  const rows = new Map<string, { key: string; username: string; domain: string | null; secret: string; kind: TriedPair["secretKind"]; cells: Set<string> }>();
  for (const t of tried) {
    const key = `${t.username.toLowerCase()}\0${(t.domain ?? "").toLowerCase()}\0${t.secret}`;
    const row = rows.get(key) ?? { key, username: t.username, domain: t.domain, secret: t.secret, kind: t.secretKind, cells: new Set<string>() };
    row.cells.add(`${t.hostId}:${t.service}`);
    rows.set(key, row);
  }
  return [...rows.values()];
}

export function TestGrid({ eid, hosts, creds, attempts, servicesByHost, tried = [] }: {
  eid: string;
  hosts: Host[];
  creds: Credential[];
  attempts: CredAttempt[];
  servicesByHost: Map<string, Service[]>;
  tried?: TriedPair[];
}) {
  const [open, setOpen] = useState<{ credId: string; hostId: string; service: SprayService }>();
  const rows = useMemo(() => creds.filter(isSprayable), [creds]);
  const triedList = useMemo(() => triedRows(tried), [tried]);
  const groups = useMemo(
    () => hosts.map((host) => ({ host, services: hostSprayServices(host, servicesByHost.get(host.id) ?? []) })).filter((g) => g.services.length > 0),
    [hosts, servicesByHost],
  );

  const header = <h3 className={`m-0 ${labelClass}`}>Test matrix</h3>;
  if ((rows.length === 0 && triedList.length === 0) || groups.length === 0) {
    return (
      <section aria-label="Test matrix" className="flex flex-col gap-2">
        {header}
        <p className="m-0 text-xs text-muted">
          {rows.length === 0
            ? "No sprayable credentials yet. Hashes appear here once cracked (NTLM hashes are tested as-is)."
            : "No host has scanned services yet. Import an nmap scan to fill the grid."}
        </p>
        <Legend />
      </section>
    );
  }

  const openCred = open && creds.find((c) => c.id === open.credId);
  const openHost = open && hosts.find((h) => h.id === open.hostId);

  return (
    <section aria-label="Test matrix" className="flex flex-col gap-2">
      {header}
      <Legend />
      <div className="overflow-x-auto rounded border border-line">
        <table aria-label="Test grid" className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className="min-w-36 border-b border-r border-line px-3 py-1.5 text-left font-semibold text-muted">Credential</th>
              {groups.map(({ host, services }) => (
                <th key={host.id} colSpan={services.length} scope="colgroup" className="border-b border-l border-line px-2 pb-1 pt-1.5 text-left font-semibold text-fg">
                  {hostLabel(host)}
                  {host.ip && host.ip !== hostLabel(host) && <span className="ml-1.5 font-mono text-[10px] font-normal text-muted">{host.ip}</span>}
                </th>
              ))}
            </tr>
            <tr>
              {groups.flatMap(({ host, services }) =>
                services.map((s, i) => (
                  <th key={`${host.id}-${s}`} scope="col" className={`border-b border-line px-1 pb-1 font-mono text-[10px] font-normal text-muted ${i === 0 ? "border-l" : ""}`}>
                    {s.toUpperCase()}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((cred) => (
              <tr key={cred.id} data-cred-id={cred.id}>
                <th scope="row" className="border-b border-r border-line px-3 py-1 text-left font-normal">
                  <div className="font-mono text-fg">{credLabel(cred)}</div>
                  <div className="text-[10px] text-muted">{cred.type}{cred.scope !== "domain" ? ` · ${cred.scope}` : ""}</div>
                </th>
                {groups.flatMap(({ host, services }) =>
                  services.map((service, i) => {
                    const cell = cellFor(cred, host, servicesByHost.get(host.id) ?? [], service, attempts);
                    const partial = partialLabel(cred, service, cell);
                    const label = `${credLabel(cred)} on ${hostLabel(host)} ${service.toUpperCase()}: ${partial ?? META[cell.state].aria}${cell.modesDiffer ? " (domain and local differ)" : ""}`;
                    return (
                      <td key={`${host.id}-${service}`} className={`border-b border-line p-1 text-center ${i === 0 ? "border-l" : ""}`}>
                        {cell.state === "na" ? (
                          <span role="img" aria-label={label} title={label} className="inline-block"><Glyph state="na" /></span>
                        ) : (
                          <button
                            type="button"
                            aria-label={label}
                            title={label}
                            aria-haspopup="dialog"
                            onClick={() => setOpen({ credId: cred.id, hostId: host.id, service })}
                            className="relative inline-flex cursor-default rounded-sm hover:brightness-125"
                          >
                            <Glyph state={cell.state} />
                            {partial && <span data-testid="untried-marker" aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-dashed border-fg-2 bg-bg" />}
                            {cell.modesDiffer && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-fg-2" />}
                          </button>
                        )}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
            {triedList.map((t) => {
              const who = `${t.domain ? `${t.domain}\\` : ""}${t.username}`;
              return (
                <tr key={t.key} data-tried="" className="text-muted">
                  <th scope="row" className="border-b border-r border-line px-3 py-1 text-left font-normal">
                    <div className="font-mono">{t.username} · tried</div>
                    <div data-testid="tried-secret">
                      {t.kind === "hash" ? (
                        <span className="font-mono text-[12.5px]" aria-label={`tried hash for ${who}`}>{truncatedHash(t.secret)}</span>
                      ) : (
                        <MaskedSecret secret={t.secret} label={`tried password for ${who}`} />
                      )}
                    </div>
                    <div className="text-[10px]">{t.domain ? `${t.domain} · ` : ""}{t.kind}, not a credential</div>
                  </th>
                  {groups.flatMap(({ host, services }) =>
                    services.map((service, i) => {
                      const hit = t.cells.has(`${host.id}:${service}`);
                      const label = `${who} on ${hostLabel(host)} ${service.toUpperCase()}: ${hit ? "failed (tried)" : "not tried"}`;
                      return (
                        <td key={`${host.id}-${service}`} className={`border-b border-line p-1 text-center ${i === 0 ? "border-l" : ""}`}>
                          <span role="img" aria-label={label} title={label} className="inline-block">
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
