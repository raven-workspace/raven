import { CheckIcon, PlusIcon, QuestionIcon } from "@phosphor-icons/react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { effectiveVerdict, foldServices, serviceIdentity, sortServices, type EffectiveVerdict } from "../../../../engines/facts/index";
import { cx } from "../../../../lib/cx";
import { isFreeKey } from "../../../../lib/keys";
import type { ServiceVerdict } from "../../../../types/hostFacts";
import type { LogEntry } from "../../../../types/log";
import type { Service } from "../../../../types/service";
import { Button, Chip, Collapse, DisclosureCaret, Input, Tooltip, type ChipVariant } from "../../../../ui/index";
import { ToggleGroup, ToggleGroupItem } from "../../../../ui/shadcn/toggle-group";
import { useServiceMutations, useServices } from "../../../services/queries";
import { ConfirmServiceDialog } from "../../ConfirmServiceDialog/ConfirmServiceDialog";
import { ServiceDialog } from "../../ServiceDialog/ServiceDialog";
import { FactGroup, SummaryCell } from "../FactGroup/FactGroup";
import { ConfirmDelete } from "../../../checklist/ConfirmDelete/ConfirmDelete";
import "./ServicesFacts.scss";

const VERDICT_LABEL: Record<EffectiveVerdict, string> = {
  candidate: "candidate",
  identify: "identify",
  untested: "untested",
  dead_end: "dead end",
};
const VERDICT_CHIP: Record<EffectiveVerdict, ChipVariant> = {
  candidate: "accent",
  identify: "default",
  untested: "default",
  dead_end: "default",
};
const ROW = "services-facts__row";

/** What the folded Services line counts: confirmed identities, the first candidate (the entry), and unidentified ones. */
export function servicesSummaryParts(services: Service[]) {
  const confirmed = services.filter((s) => serviceIdentity(s).confirmed).length;
  const unknown = services.filter((s) => !serviceIdentity(s).confirmed && serviceIdentity(s).unidentified).length;
  const entry = sortServices(services).find((s) => s.verdict === "candidate");
  return {
    confirmed,
    unknown,
    entry: entry ? `${entry.confirmedProduct?.trim() || entry.nmapService || "unknown"} on ${entry.port}` : undefined,
    total: services.length,
  };
}

/** The folded Services line: how many, how many confirmed, the entry point, how many unidentified. */
function ServicesSummary({ services }: { services: Service[] }) {
  if (services.length === 0) return <span>none yet</span>;
  const { confirmed, unknown, entry, total } = servicesSummaryParts(services);
  return (
    <>
      <SummaryCell count={total} label={total === 1 ? "service" : "services"} />
      {confirmed > 0 && <SummaryCell count={confirmed} label="confirmed" tone="accent" />}
      {entry && <SummaryCell label="entry">{entry}</SummaryCell>}
      {unknown > 0 && <SummaryCell count={unknown} label="unidentified" />}
    </>
  );
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
    // A dead end holds the user's typed reason: a stray C or U must not delete it. Leave it from the verdict menu.
    if (verdict === "dead_end" && (key === "c" || key === "u")) {
      e.preventDefault();
      return;
    }
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
        title={verdict === "dead_end" ? `${proto}: dead end. Change it from the verdict menu` : `${proto}: C candidate, U untested, D dead end`}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        className="services-facts__service"
      >
        <span className="services-facts__port">
          {s.port}
          {s.protocol === "udp" && <span className="services-facts__udp">u</span>}
        </span>
        <span className="services-facts__ident">
          <span className={id.confirmed ? "services-facts__mark services-facts__mark--confirmed" : "services-facts__mark"}>
            {id.confirmed && <CheckIcon size={16} weight="regular" aria-hidden />}
            {id.confirmed && <span className="services-facts__sr-only">confirmed</span>}
            {!id.confirmed && id.unidentified && <QuestionIcon size={16} weight="regular" aria-hidden />}
            {!id.confirmed && id.unidentified && <span className="services-facts__sr-only">unidentified</span>}
          </span>
          <span
            className={cx("services-facts__label", id.confirmed && "services-facts__label--confirmed")}
            title={id.confirmed && guess ? `nmap: ${guess}` : id.label || undefined}
          >
            {id.label || "unidentified"}
          </span>
          {s.state !== "open" && <span className="services-facts__state">{s.state}</span>}
        </span>
      </button>
      {/* A status chip as a toggle (DESIGN.md Chips): a 28px target, its action in a tooltip. */}
      <Tooltip content="Set the verdict (C, U or D on the row)">
        <button
          type="button"
          aria-label={`Verdict for ${proto}: ${VERDICT_LABEL[verdict]}`}
          aria-expanded={asking === "menu"}
          onClick={() => setAsking(asking === "menu" ? undefined : "menu")}
          className="services-facts__verdict"
        >
          <Chip variant={VERDICT_CHIP[verdict]} className={verdict === "dead_end" ? "services-facts__chip--dead" : undefined}>
            {VERDICT_LABEL[verdict]}
          </Chip>
        </button>
      </Tooltip>
      {asking === "menu" && (
        <div className="services-facts__menu">
          <ToggleGroup
            type="single"
            aria-label={`Verdict for ${proto}`}
            value={s.verdict ?? ""}
            onValueChange={(v) => {
              if (v === "candidate" || v === "untested") {
                onVerdict(v);
                setAsking(undefined);
              } else if (v === "dead_end") askReason();
              // The pressed item was clicked again: a dead end is edited (its reason asked again), others just close.
              else if (s.verdict === "dead_end") askReason();
              else setAsking(undefined);
            }}
          >
            <ToggleGroupItem value="candidate">Candidate</ToggleGroupItem>
            <ToggleGroupItem value="untested">Untested</ToggleGroupItem>
            <ToggleGroupItem value="dead_end">Dead end…</ToggleGroupItem>
          </ToggleGroup>
          {s.verdict !== null && <Button size="sm" onClick={() => { onVerdict(null); setAsking(undefined); }}>Clear</Button>}
        </div>
      )}
      {asking === "reason" && (
        <form
          className="services-facts__reason"
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
          />
        </form>
      )}
    </li>
  );
}

/**
 * "msrpc ×7" or "17 UDP": a folded run of services that opens in place. Shared by the Facts column and the
 * finding's service picker; the grid's first track holds the caret and the label spans the next two.
 */
export function FoldedRows({ label, services, render, defaultOpen = false }: {
  label: string;
  services: Service[];
  render: (s: Service) => ReactNode;
  /** Open from the start (the picker opens a run that holds a picked service). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (services.length === 0) return null;
  return (
    <>
      <li className={ROW}>
        <button
          type="button"
          aria-expanded={open}
          title={open ? `Fold ${label}` : `Show ${label}`}
          onClick={() => setOpen(!open)}
          className="services-facts__fold"
        >
          <DisclosureCaret open={open} />
          <span className="services-facts__fold-label">{label}</span>
        </button>
      </li>
      {/* The folded rows sit in their own list item so they can open and close as one; subgrid keeps the columns. */}
      <Collapse open={open} as="li" className="services-facts__folded">
        <ul aria-label={label} className="services-facts__folded-list">{sortServices(services).map(render)}</ul>
      </Collapse>
    </>
  );
}

function DeleteServiceDialog({ engagementId, service, onClose }: { engagementId: string; service: Service; onClose: () => void }) {
  const { remove } = useServiceMutations(engagementId, service.hostId);
  return (
    <ConfirmDelete
      title={`Delete ${service.port}/${service.protocol}?`}
      error={remove.error?.message}
      pending={remove.isPending}
      label="Delete service"
      onCancel={onClose}
      onConfirm={() => remove.mutate(service.id, { onSuccess: onClose })}
    />
  );
}

type Open = { id: string; mode: "confirm" | "edit" | "delete" };

/** The host's services: port, identity (confirmed beats nmap's guess) and the user's verdict, in port order. */
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
      summary={services.isError ? <span>couldn't load</span> : services.data ? <ServicesSummary services={services.data} /> : undefined}
      open={open}
      onToggle={onToggle}
      shortcut="S"
      actions={
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon size={16} weight="regular" aria-hidden /> Add service
        </Button>
      }
    >
      {services.isError ? (
        <p role="alert" className="fact-group__error">Couldn't load services: {services.error.message}</p>
      ) : services.data?.length === 0 ? (
        <p className="fact-group__note">No services yet. Paste an nmap scan to capture them.</p>
      ) : (
        <ul data-services-grid className="services-facts">
          {sortServices(rows).map(row)}
          <FoldedRows label={`msrpc ×${rpc.length}`} services={rpc} render={row} />
          <FoldedRows label={`${udp.length} UDP`} services={udp} render={row} />
        </ul>
      )}
      {setVerdict.error && <p role="alert" className="fact-group__error">Couldn't set the verdict: {setVerdict.error.message}</p>}
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
