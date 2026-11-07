import { CaretDown, CaretRight, Plus } from "@phosphor-icons/react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { effectiveVerdict, foldServices, serviceIdentity, sortServices, type EffectiveVerdict } from "../../../engines/facts";
import { cx } from "../../../lib/cx";
import { isFreeKey } from "../../../lib/keys";
import type { ServiceVerdict } from "../../../types/hostFacts";
import type { LogEntry } from "../../../types/log";
import type { Service } from "../../../types/service";
import { Button, Dialog, Input } from "../../../ui";
import { useServiceMutations, useServices } from "../../services/queries";
import { ConfirmServiceDialog } from "../ConfirmServiceDialog";
import { ServiceDialog } from "../ServiceDialog";
import { FactGroup } from "./FactGroup";

const VERDICT_LABEL: Record<EffectiveVerdict, string> = {
  candidate: "candidate",
  identify: "identify",
  untested: "untested",
  dead_end: "dead end",
};
const VERDICT_TONE: Record<EffectiveVerdict, string> = {
  candidate: "border-accent text-accent",
  identify: "border-warn text-warn",
  untested: "border-line-strong text-fg-2",
  dead_end: "border-line text-muted line-through",
};
const GRID = "grid grid-cols-[6ch_minmax(0,1fr)_auto] gap-x-2";
const ROW = "col-span-3 grid grid-cols-subgrid items-baseline border-b border-line";

/** "Services · 7 ✓ · entry IIS 80 · 2 ?": what's confirmed, the first candidate, and what's still unidentified. */
export function servicesSummary(services: Service[]): string {
  if (services.length === 0) return "Services · none yet";
  const confirmed = services.filter((s) => serviceIdentity(s).confirmed).length;
  const unknown = services.filter((s) => !serviceIdentity(s).confirmed && serviceIdentity(s).unidentified).length;
  const entry = sortServices(services).find((s) => s.verdict === "candidate");
  const parts = ["Services"];
  if (confirmed > 0) parts.push(`${confirmed} ✓`);
  if (entry) parts.push(`entry ${entry.confirmedProduct?.trim() || entry.nmapService || "?"} ${entry.port}`);
  if (unknown > 0) parts.push(`${unknown} ?`);
  if (parts.length === 1) parts.push(`${services.length} open`);
  return parts.join(" · ");
}

/** Arrow keys move between the rows of one services grid. */
function moveFocus(from: HTMLElement, by: 1 | -1) {
  const grid = from.closest("[data-services-grid]");
  const rows = [...(grid?.querySelectorAll<HTMLElement>("[data-service-row]") ?? [])];
  rows[rows.indexOf(from) + by]?.focus();
}

function ServiceRow({ s, onOpen, onVerdict, pending }: {
  s: Service;
  onOpen: () => void;
  onVerdict: (verdict: ServiceVerdict | null, reason?: string, onSuccess?: () => void) => void;
  pending: boolean;
}) {
  const [asking, setAsking] = useState<"reason" | "menu">();
  const [reason, setReason] = useState("");
  const id = serviceIdentity(s);
  const verdict = effectiveVerdict(s);
  const guess = [s.nmapService, s.nmapVersion].filter(Boolean).join(" ");
  const proto = `${s.port}/${s.protocol}`;
  const askReason = () => {
    setReason("");
    setAsking("reason");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(e.currentTarget, e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (!isFreeKey(e.nativeEvent)) return;
    const key = e.key.toLowerCase();
    if (key === "c") onVerdict("candidate");
    else if (key === "u") onVerdict("untested");
    else if (key === "d") askReason();
    else return;
    e.preventDefault();
  };

  return (
    <li className={ROW}>
      <button
        type="button"
        data-service-row
        aria-label={`${proto} ${id.label || "unidentified"}, ${VERDICT_LABEL[verdict]}`}
        title={`${proto}: C candidate · U untested · D dead end`}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        className="col-span-2 grid cursor-default grid-cols-subgrid items-baseline py-1 text-left hover:bg-surface focus-visible:bg-surface"
      >
        <span className="font-mono text-xs text-fg-2">
          {s.port}
          {s.protocol === "udp" && <span className="text-faint">u</span>}
        </span>
        <span className="min-w-0 truncate text-[13px]">
          {id.confirmed ? (
            <span className="text-fg" title={guess ? `nmap: ${guess}` : undefined}>
              {id.label} <span className="text-accent">✓</span>
            </span>
          ) : (
            <span className="text-muted">
              {id.label}
              {id.unidentified && <span className="text-warn">{id.label ? " ?" : "?"}</span>}
            </span>
          )}
          {s.state !== "open" && <span className="ml-1.5 font-mono text-[11px] text-muted-2">{s.state}</span>}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Verdict for ${proto}: ${VERDICT_LABEL[verdict]}`}
        aria-expanded={asking === "menu"}
        title="Set the verdict (C · U · D on the row)"
        onClick={() => setAsking(asking === "menu" ? undefined : "menu")}
        className={cx("cursor-default self-center rounded-sm border px-1.5 text-[11px] leading-4", VERDICT_TONE[verdict])}
      >
        {VERDICT_LABEL[verdict]}
      </button>
      {asking === "menu" && (
        <div role="group" aria-label={`Verdict for ${proto}`} className="col-span-3 flex gap-1.5 pb-1.5">
          <Button size="sm" onClick={() => { onVerdict("candidate"); setAsking(undefined); }}>Candidate</Button>
          <Button size="sm" onClick={() => { onVerdict("untested"); setAsking(undefined); }}>Untested</Button>
          <Button size="sm" onClick={askReason}>Dead end…</Button>
          {s.verdict !== null && <Button size="sm" onClick={() => { onVerdict(null); setAsking(undefined); }}>Clear</Button>}
        </div>
      )}
      {asking === "reason" && (
        <form
          className="col-span-3 pb-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending || reason.trim() === "") return;
            // Closes once saved: on an error the reason stays for a retry.
            onVerdict("dead_end", reason.trim(), () => setAsking(undefined));
          }}
        >
          <Input
            autoFocus
            aria-label={`Why is ${proto} a dead end?`}
            placeholder="Why is it a dead end? Enter saves, Esc cancels"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              setAsking(undefined);
            }}
            className="h-7 text-xs"
          />
        </form>
      )}
    </li>
  );
}

/** "msrpc ×7" or "17 UDP": a folded run of services that opens in place. */
function FoldedRows({ label, services, render }: { label: string; services: Service[]; render: (s: Service) => ReactNode }) {
  const [open, setOpen] = useState(false);
  if (services.length === 0) return null;
  const Caret = open ? CaretDown : CaretRight;
  return (
    <>
      <li className={ROW}>
        <button
          type="button"
          aria-expanded={open}
          title={open ? `Fold ${label}` : `Show ${label}`}
          onClick={() => setOpen(!open)}
          className="col-span-3 grid cursor-default grid-cols-subgrid items-center py-1 text-left text-[13px] text-muted hover:text-fg"
        >
          <Caret size={12} weight="light" aria-hidden />
          <span>{label}</span>
        </button>
      </li>
      {open && sortServices(services).map(render)}
    </>
  );
}

function DeleteServiceDialog({ engagementId, service, onClose }: { engagementId: string; service: Service; onClose: () => void }) {
  const { remove } = useServiceMutations(engagementId, service.hostId);
  const [error, setError] = useState<string>();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${service.port}/${service.protocol}?`}
      description={error ? <span role="alert" className="text-warn">{error}</span> : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate(service.id, { onSuccess: onClose, onError: (e) => setError(e.message) })}
          >
            Delete service
          </Button>
        </>
      }
    />
  );
}

type Open = { id: string; mode: "confirm" | "edit" | "delete" };

/** The host's services: port, identity (confirmed beats nmap's guess) and the user's verdict, candidates first. */
export function ServicesFacts({ engagementId, hostId, entries, open, onToggle }: {
  engagementId: string;
  hostId: string;
  /** This host's log entries, offered as proof when confirming. */
  entries: LogEntry[];
  open: boolean;
  onToggle: () => void;
}) {
  const services = useServices(hostId);
  const { setVerdict } = useServiceMutations(engagementId, hostId);
  const [dialog, setDialog] = useState<Open>();
  const [adding, setAdding] = useState(false);
  const list = services.data ?? [];
  const current = list.find((s) => s.id === dialog?.id);
  const close = () => setDialog(undefined);
  const { rows, rpc, udp } = foldServices(list);

  const row = (s: Service) => (
    <ServiceRow
      key={s.id}
      s={s}
      pending={setVerdict.isPending}
      onOpen={() => setDialog({ id: s.id, mode: "confirm" })}
      onVerdict={(verdict, reason, onSuccess) => setVerdict.mutate({ id: s.id, verdict, reason }, { onSuccess })}
    />
  );

  return (
    <FactGroup
      title="Services"
      summary={services.isError ? "Services · couldn't load" : services.data ? servicesSummary(services.data) : "Services"}
      open={open}
      onToggle={onToggle}
      shortcut="S"
      actions={
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus size={12} weight="light" aria-hidden /> Add service
        </Button>
      }
    >
      {services.isError ? (
        <p role="alert" className="m-0 text-xs text-warn">Couldn't load services: {services.error.message}</p>
      ) : services.data?.length === 0 ? (
        <p className="m-0 text-xs text-muted">No services yet. Paste an nmap scan to capture them.</p>
      ) : (
        <ul data-services-grid className={cx(GRID, "m-0 list-none p-0")}>
          {sortServices(rows).map(row)}
          <FoldedRows label={`msrpc ×${rpc.length}`} services={rpc} render={row} />
          <FoldedRows label={`${udp.length} UDP`} services={udp} render={row} />
        </ul>
      )}
      {setVerdict.error && <p role="alert" className="m-0 text-xs text-warn">Couldn't set the verdict: {setVerdict.error.message}</p>}
      {current && dialog?.mode === "confirm" && (
        <ConfirmServiceDialog
          engagementId={engagementId}
          service={current}
          entries={entries}
          onClose={close}
          onEdit={() => setDialog({ id: current.id, mode: "edit" })}
          onDelete={() => setDialog({ id: current.id, mode: "delete" })}
        />
      )}
      {current && dialog?.mode === "edit" && <ServiceDialog engagementId={engagementId} hostId={hostId} service={current} onClose={close} />}
      {current && dialog?.mode === "delete" && <DeleteServiceDialog engagementId={engagementId} service={current} onClose={close} />}
      {adding && <ServiceDialog engagementId={engagementId} hostId={hostId} onClose={() => setAdding(false)} />}
    </FactGroup>
  );
}
