import { Link } from "react-router";
import { cellFor, cellModes, credLabel, type SprayService } from "../../engines/credentials";
import type { AttemptResult, AuthMode, CredAttempt, Credential } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { Button, ChipSet, Dialog, labelClass } from "../../ui";
import { sectionPath } from "../engagements/sections";
import { useCredAttemptMutations } from "./queries";
import { hostLabel } from "../../lib/hostName";

const MODE_LABEL: Record<AuthMode, string> = { domain: "Domain auth", local: "Local auth (--local-auth)" };
const MANUAL: AttemptResult[] = ["admin", "valid", "failed"];

const formatAt = (ms: number) =>
  new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Read a cell's latest result per auth mode and set or clear it by hand. */
export function CellPopover({ eid, cred, host, services, service, attempts, onClose }: {
  eid: string;
  cred: Credential;
  host: Host;
  services: Service[];
  service: SprayService;
  attempts: CredAttempt[];
  onClose: () => void;
}) {
  const { upsert, remove } = useCredAttemptMutations(eid);
  const cell = cellFor(cred, host, services, service, attempts);
  const error = upsert.error ?? remove.error;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${credLabel(cred)} on ${hostLabel(host)} ${service.toUpperCase()}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="grid gap-3">
        {cellModes(cred, service, cell).map((mode) => {
          const latest = cell.byMode[mode];
          return (
            <div key={mode} className="grid gap-2 border-b border-line pb-3 last:border-b-0 last:pb-0">
              <h4 className={`m-0 ${labelClass}`}>{MODE_LABEL[mode]}</h4>
              {latest ? (
                <p className="m-0 text-meta text-fg-2">
                  <span className={`mr-2 ${latest.result === "errored" ? "text-warn" : "text-fg"}`}>{latest.result}</span>
                  <span className="mr-2 tabular-nums text-muted">{formatAt(latest.at)}</span>
                  {latest.detail && <span className="mr-2">{latest.detail}</span>}
                  {latest.logEntryId && (
                    <Link to={sectionPath(eid, "log")} className="text-accent underline">Proof in log</Link>
                  )}
                </p>
              ) : (
                <p className="m-0 text-meta text-muted">Not tried</p>
              )}
              <ChipSet>
                {MANUAL.map((result) => (
                  <Button
                    key={result}
                    size="sm"
                    aria-label={`Set ${mode} result: ${result}`}
                    disabled={upsert.isPending}
                    onClick={() =>
                      upsert.mutate({ credId: cred.id, hostId: host.id, service, result, authMode: mode, detail: "set by hand" })
                    }
                  >
                    {result}
                  </Button>
                ))}
                {latest && (
                  <Button size="sm" variant="quiet-danger" aria-label={`Clear ${mode} result`} disabled={remove.isPending} onClick={() => remove.mutate(latest.id)}>
                    Clear
                  </Button>
                )}
              </ChipSet>
            </div>
          );
        })}
        {error && <p role="alert" className="m-0 text-meta text-warn">{error.message}</p>}
      </div>
    </Dialog>
  );
}
