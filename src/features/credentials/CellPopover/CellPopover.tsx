import { Link } from "react-router";
import { cellFor, cellModes, credLabel, type SprayService } from "../../../engines/credentials/index";
import type { AttemptResult, AuthMode, CredAttempt, Credential } from "../../../types/credentials";
import type { Host } from "../../../types/host";
import type { Service } from "../../../types/service";
import { Button, ChipSet, Dialog, labelClass } from "../../../ui/index";
import { sectionPath } from "../../engagements/sections/sections";
import { useCredAttemptMutations } from "../queries";
import { hostLabel } from "../../../lib/hostName";
import "./CellPopover.scss";

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
      <div className="cell-popover">
        {cellModes(cred, service, cell).map((mode) => {
          const latest = cell.byMode[mode];
          return (
            <div key={mode} className="cell-popover__mode">
              <h4 className={labelClass}>{MODE_LABEL[mode]}</h4>
              {latest ? (
                <p className="cell-popover__latest">
                  <span className={latest.result === "errored" ? "cell-popover__result cell-popover__result--errored" : "cell-popover__result"}>{latest.result}</span>
                  <span className="cell-popover__at">{formatAt(latest.at)}</span>
                  {latest.detail && <span className="cell-popover__detail">{latest.detail}</span>}
                  {latest.logEntryId && (
                    <Link to={sectionPath(eid, "log")} className="cell-popover__proof">Proof in log</Link>
                  )}
                </p>
              ) : (
                <p className="cell-popover__none">Not tried</p>
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
        {error && <p role="alert" className="cell-popover__error">{error.message}</p>}
      </div>
    </Dialog>
  );
}
