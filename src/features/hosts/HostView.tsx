import { useState } from "react";
import { Link } from "react-router";
import { EmptyState, Panel } from "../../ui";
import { useLog } from "../log/queries";
import { LogEntryRow } from "../log/LogEntryRow";
import { OrderButton } from "../log/OrderButton";
import { byOrder, usePersistedOrder } from "../log/usePersistedOrder";
import { HostHeader } from "./HostHeader";
import { ServicesColumn } from "./ServicesColumn";
import { useHosts } from "./queries";

const TABS = [
  { id: "story", label: "Story" },
  { id: "checklist", label: "Checklist" },
  { id: "credentials", label: "Credentials" },
  { id: "findings", label: "Findings" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const STEPS: Record<TabId, number> = { story: 2, checklist: 3, credentials: 4, findings: 4 };

export function HostView({ engagementId, hostId }: { engagementId: string; hostId: string }) {
  const hosts = useHosts(engagementId);
  const log = useLog(engagementId);
  const [tab, setTab] = useState<TabId>("story");
  const [order, setOrder] = usePersistedOrder("raven.story.order", "oldest");
  const host = hosts.data?.find((h) => h.id === hostId);

  if (hosts.isError) return <EmptyState title="Couldn't load this host" body={hosts.error.message} />;
  if (!hosts.data) return null;
  if (!host) {
    return (
      <EmptyState
        title="Host not found"
        body="It may have been deleted."
        action={<Link to={`/e/${engagementId}`} className="text-[13px] text-fg-2 hover:text-fg">Back to the board</Link>}
      />
    );
  }
  const entries = (log.data ?? []).filter((e) => e.hostIds.includes(hostId)).sort(byOrder(order));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <HostHeader host={host} />
      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-6">
        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto pr-1">
          <ServicesColumn engagementId={engagementId} hostId={hostId} entries={entries} />
          <Panel title="Now" aria-label="Now">
            <p className="m-0 text-xs text-muted">
              The current stage's open steps arrive with the checklist (build step 3).
            </p>
          </Panel>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3">
            <div role="tablist" className="inline-flex gap-0.5 rounded-[var(--radius)] border border-line-2 bg-surface p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`h-7 cursor-default rounded-[var(--radius-sm)] px-3 text-[13px] ${
                    tab === t.id ? "bg-surface-hi text-fg shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-muted hover:text-fg"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "story" && <OrderButton order={order} onChange={setOrder} />}
          </div>
          <div role="tabpanel" className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-line">
            {tab === "story" ? (
              log.isError ? (
                <p role="alert" className="text-xs text-warn">Couldn't load the log: {log.error.message}</p>
              ) : entries.length === 0 && log.data ? (
                <p className="text-[13px] text-muted">Nothing logged on this host yet. Press L to capture.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {entries.map((e) => <LogEntryRow key={e.id} entry={e} hosts={hosts.data} />)}
                </ul>
              )
            ) : (
              <p className="text-[13px] text-muted">
                {TABS.find((t) => t.id === tab)?.label} arrives with build step {STEPS[tab]}.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
