import { Plus } from "@phosphor-icons/react";
import { useId, useMemo, type ReactNode } from "react";
import { useMatch, useNavigate } from "react-router";
import { logRows, noteRows, serviceRows, type ScopeRow } from "../../../engines/explorer/index";
import { sortFindingsBySeverity } from "../../../engines/findings/index";
import { cx } from "../../../lib/cx";
import { shortHostName } from "../../../lib/hostName";
import { SHORTCUTS, type Keys } from "../../../lib/shortcuts";
import type { Host } from "../../../types/host";
import { Chip, Collapse, DisclosureCaret, IconButton, labelClass } from "../../../ui/index";
import { useCaptureStore } from "../../capture/useCaptureStore";
import { sectionPath } from "../../engagements/sections/sections";
import { useFindings } from "../../findings/queries";
import { COLUMN_LABELS } from "../../hosts/columns";
import { HostGlyph } from "../../hosts/HostGlyph/HostGlyph";
import { useHosts } from "../../hosts/queries";
import { useLog } from "../../log/queries";
import { useNotes } from "../../notes/queries";
import { useNotesStore, type NotesScope } from "../../notes/useNotesStore";
import { useEngagementServices } from "../../services/queries";
import { useExplorerStore } from "../useExplorerStore";
import { useTargetStore } from "../useTargetStore";
import "./Explorer.scss";

const NO_HOSTS: Host[] = [];
/** Rows name a host by its short name, as the host rows do ("forge", not "forge.lab.local"). */
const shortName = (h: Host) => shortHostName(h.name);

/** Opens the field notes drawer on `scope`, or moves an open one there. Editor tabs replace the drawer (RAV-76). */
function showNotes(scope: NotesScope) {
  const notes = useNotesStore.getState();
  if (notes.open) notes.setScope(scope);
  else notes.toggle(scope);
}

/** One group: its label with a count, the Plus button on the right edge, then its rows. */
function Group({ label, count, add, addKeys, onAdd, children }: {
  label: string; count: number; add: string; addKeys?: Keys; onAdd: () => void; children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="explorer__group">
      <div className="explorer__group-head">
        <h3 id={id} className={labelClass}>
          {label} ({count})
        </h3>
        <IconButton icon={Plus} label={add} {...(addKeys ? { shortcut: addKeys } : {})} onClick={onAdd} />
      </div>
      <ul className="explorer__rows">{children}</ul>
    </section>
  );
}

/** A one-line row (a note, finding or log): its first track is blank, so its text lines up past the caret. */
function ItemRow({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="explorer__item" title={label} onClick={onOpen}>
        <span className="explorer__item-text">{label}</span>
      </button>
    </li>
  );
}

function HostRow({ host, services, selected, onSelect }: {
  host: Host; services: ReturnType<typeof serviceRows>; selected: boolean; onSelect: () => void;
}) {
  const open = useExplorerStore((s) => s.expanded[host.id] === true);
  const toggleHost = useExplorerStore((s) => s.toggleHost);
  const servicesId = useId();
  const name = shortName(host) || host.ip || host.id;
  // Named name first ("forge, 10.10.11.42, Privilege escalation, user access"), not by the glyph that leads the row.
  const label = [name, host.ip, COLUMN_LABELS[host.boardColumn], host.access !== "none" && `${host.access} access`]
    .filter(Boolean)
    .join(", ");
  return (
    <li className="explorer__host" data-selected={selected || undefined}>
      <div className="explorer__host-row">
        <button
          type="button"
          className="explorer__caret"
          aria-label={open ? `Hide ${name}'s services` : `Show ${name}'s services`}
          aria-expanded={open}
          aria-controls={servicesId}
          onClick={() => toggleHost(host.id)}
        >
          <DisclosureCaret open={open} />
        </button>
        <button
          type="button"
          className="explorer__host-button"
          aria-current={selected ? "true" : undefined}
          aria-label={label}
          title={host.name}
          onClick={onSelect}
        >
          <HostGlyph column={host.boardColumn} />
          <span className="explorer__host-text">
            <span className="explorer__host-name">{name}</span>
            {host.ip && <span className="explorer__host-ip">{host.ip}</span>}
          </span>
          {host.access !== "none" && <Chip variant="accent">{host.access}</Chip>}
        </button>
      </div>
      <Collapse open={open} as="div" contentClassName="explorer__services">
        <ul id={servicesId} aria-label={`${name} services`} className="explorer__service-list">
          {services.length === 0 ? (
            <li className="explorer__service explorer__service--none">No services yet</li>
          ) : (
            services.map((s) => (
              <li key={s.id} className={cx("explorer__service", s.filtered && "explorer__service--filtered")}>
                <span className="explorer__port">{s.port}</span>
                <span className="explorer__service-name">{s.label}</span>
              </li>
            ))
          )}
        </ul>
      </Collapse>
    </li>
  );
}

/**
 * The Explorer (design §1.4): the engagement's hosts, notes, findings and logs, in that order. Selecting a host makes
 * it Target and opens its page; the other rows open their page or drawer. Until editor tabs land (RAV-76) a row
 * navigates the route rather than opening a tab.
 */
export function Explorer({ engagementId }: { engagementId: string }) {
  const navigate = useNavigate();
  const routeHostId = useMatch("/e/:id/h/:hostId")?.params.hostId ?? null;
  const targetId = useTargetStore((s) => s.byEngagement[engagementId] ?? null);
  const hosts = useHosts(engagementId).data ?? NO_HOSTS;
  const notes = useNotes(engagementId).data;
  const log = useLog(engagementId).data;
  const findings = useFindings(engagementId).data;
  const { servicesByHost } = useEngagementServices(engagementId);
  const setAddingHost = useExplorerStore((s) => s.setAddingHost);
  const openCapture = useCaptureStore((s) => s.openCapture);

  const notesList = useMemo(() => noteRows(hosts, notes ?? [], shortName), [hosts, notes]);
  const logsList = useMemo(() => logRows(hosts, log ?? [], shortName), [hosts, log]);
  const findingsList = useMemo(() => sortFindingsBySeverity(findings ?? []), [findings]);
  const hostPath = (hostId: string) => `/e/${engagementId}/h/${hostId}`;

  const selectHost = (hostId: string) => {
    useTargetStore.getState().pick(engagementId, hostId);
    void navigate(hostPath(hostId));
  };
  const openNote = (row: ScopeRow) => {
    if (row.hostId) selectHost(row.hostId);
    showNotes(row.hostId ? "host" : "engagement");
  };
  const openLog = (row: ScopeRow) => {
    const path = sectionPath(engagementId, "log");
    void navigate(row.hostId ? `${path}?host=${encodeURIComponent(row.hostId)}` : path);
  };
  const openFinding = (findingId: string) =>
    void navigate(`${sectionPath(engagementId, "findings")}?finding=${encodeURIComponent(findingId)}`);

  return (
    <aside aria-label="Explorer" className="explorer">
      <div className="explorer__header">
        <h2 className={labelClass}>Explorer</h2>
      </div>
      <div className="explorer__list">
        <Group label="Hosts" count={hosts.length} add="Add host" addKeys={SHORTCUTS.addHost} onAdd={() => setAddingHost(true)}>
          {hosts.map((h) => (
            <HostRow
              key={h.id}
              host={h}
              services={serviceRows(servicesByHost.get(h.id) ?? [])}
              selected={h.id === targetId}
              onSelect={() => selectHost(h.id)}
            />
          ))}
        </Group>
        <Group label="Notes" count={notesList.length} add="Add note" onAdd={() => showNotes(routeHostId ? "host" : "engagement")}>
          {notesList.map((row) => (
            <ItemRow key={row.hostId ?? ""} label={row.label} onOpen={() => openNote(row)} />
          ))}
        </Group>
        <Group
          label="Findings"
          count={findingsList.length}
          add="Add finding"
          onAdd={() => void navigate(`${sectionPath(engagementId, "findings")}?finding=new`)}
        >
          {findingsList.map((f) => (
            <ItemRow key={f.id} label={f.title} onOpen={() => openFinding(f.id)} />
          ))}
        </Group>
        <Group
          label="Logs"
          count={logsList.length}
          add="Add log entry"
          addKeys="L"
          onAdd={() => openCapture({ engagementId, hostId: routeHostId })}
        >
          {logsList.map((row) => (
            <ItemRow key={row.hostId ?? ""} label={row.label} onOpen={() => openLog(row)} />
          ))}
        </Group>
      </div>
    </aside>
  );
}
