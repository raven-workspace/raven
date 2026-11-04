import { useState } from "react";
import type { LogEntry } from "../../types/log";
import type { Service } from "../../types/service";
import { Button, Dialog, labelClass } from "../../ui";
import { useServiceMutations, useServices } from "../services/queries";
import { ConfirmServiceDialog } from "./ConfirmServiceDialog";
import { ServiceDialog } from "./ServiceDialog";

function ServiceRow({ s, onOpen }: { s: Service; onOpen: () => void }) {
  const guess = [s.nmapService, s.nmapVersion].filter(Boolean).join(" ");
  const confirmed = s.confirmedProduct !== null;
  const unidentified = !confirmed && (!s.nmapService || s.nmapService.endsWith("?"));
  return (
    <li className="border-b border-line">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-baseline gap-3 px-1 py-1.5 text-left cursor-default hover:bg-surface"
      >
        <span className="w-[62px] shrink-0 font-mono text-xs text-fg-2">
          {s.port}/{s.protocol}
        </span>
        {s.state !== "open" && <span className="shrink-0 font-mono text-[11px] text-muted-2">{s.state}</span>}
        <span className="min-w-0 flex-1 text-[13px]">
          {confirmed ? (
            <>
              <span className="block text-fg">
                {[s.confirmedProduct, s.confirmedVersion].filter(Boolean).join(" ")} <span className="text-accent">✓</span>
              </span>
              {guess && <span className="block text-xs text-faint">{guess}</span>}
            </>
          ) : unidentified ? (
            <span className="text-warn">unidentified</span>
          ) : (
            <span className="text-muted">{guess}</span>
          )}
        </span>
      </button>
    </li>
  );
}

type Open = { id: string; mode: "confirm" | "edit" | "delete" };

function DeleteServiceDialog({ service, onClose }: { service: Service; onClose: () => void }) {
  const { remove } = useServiceMutations(service.hostId);
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

export function ServicesColumn({ hostId, entries }: { hostId: string; entries: LogEntry[] }) {
  const services = useServices(hostId);
  const [open, setOpen] = useState<Open>();
  const [adding, setAdding] = useState(false);
  const current = services.data?.find((s) => s.id === open?.id);
  const close = () => setOpen(undefined);
  return (
    <section aria-label="Services">
      <div className="mb-1 flex items-center justify-between">
        <h2 className={`${labelClass} m-0`}>Services</h2>
        <Button size="sm" onClick={() => setAdding(true)}>
          + Add service
        </Button>
      </div>
      {services.isError ? (
        <p role="alert" className="text-xs text-warn">Couldn't load services: {services.error.message}</p>
      ) : services.data?.length === 0 ? (
        <p className="text-xs text-muted">No services yet. Paste an nmap scan to capture them.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {services.data?.map((s) => <ServiceRow key={s.id} s={s} onOpen={() => setOpen({ id: s.id, mode: "confirm" })} />)}
        </ul>
      )}
      {current && open?.mode === "confirm" && (
        <ConfirmServiceDialog
          service={current}
          entries={entries}
          onClose={close}
          onEdit={() => setOpen({ id: current.id, mode: "edit" })}
          onDelete={() => setOpen({ id: current.id, mode: "delete" })}
        />
      )}
      {current && open?.mode === "edit" && <ServiceDialog hostId={hostId} service={current} onClose={close} />}
      {current && open?.mode === "delete" && <DeleteServiceDialog service={current} onClose={close} />}
      {adding && <ServiceDialog hostId={hostId} onClose={() => setAdding(false)} />}
    </section>
  );
}
