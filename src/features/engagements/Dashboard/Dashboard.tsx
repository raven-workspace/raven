import { useId, useState } from "react";
import { isDialogOpen, isTypingTarget, useKeydown, useNow } from "../../../lib/keys";
import { Button, DASHBOARD_COLUMN, EmptyState, Input, Kbd, labelClass, queryState } from "../../../ui/index";
import { ActiveCard } from "../ActiveCard/ActiveCard";
import { EngagementDialog } from "../EngagementDialog/EngagementDialog";
import { PastTable, matchesSearch } from "../PastTable/PastTable";
import { useEngagements } from "../queries";
import "./Dashboard.scss";

export function Dashboard() {
  const list = useEngagements();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const now = useNow();
  const activeId = useId();
  const pastId = useId();

  useKeydown((e) => {
    if (!e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "n") return;
    // Same rules as the number keys: not while typing, not over a dialog.
    if (!e.defaultPrevented && !isTypingTarget(e.target) && !isDialogOpen()) {
      e.preventDefault();
      setCreating(true);
    }
  });

  const all = list.data ?? [];
  const active = all.filter((e) => e.status === "active");
  const past = all.filter((e) => e.status === "archived");
  const shown = past.filter((e) => matchesSearch(e, q));

  return (
    <div data-testid="app-root" className="dashboard"
      style={{ maxWidth: DASHBOARD_COLUMN.max, paddingInline: DASHBOARD_COLUMN.inset }}>
      <header className="dashboard__head">
        <h1 className="dashboard__title">Engagements</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New engagement <Kbd variant="inline" aria-hidden>⌘N</Kbd>
        </Button>
      </header>

      {queryState([list], "engagements")}

      {list.isSuccess && all.length === 0 ? (
        <EmptyState
          title="No engagements yet"
          body="An engagement holds one exam sim, lab or client job: its scope, hosts, log and findings."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              New engagement
            </Button>
          }
        />
      ) : (
        list.isSuccess && (
          <>
            <section aria-labelledby={activeId} className="dashboard__section">
              <h2 id={activeId} className={labelClass}>
                Active
              </h2>
              {active.length === 0 ? (
                <p className="dashboard__note">Nothing active. Archived engagements are below.</p>
              ) : (
                <div className="dashboard__cards">
                  {active.map((e) => (
                    <ActiveCard key={e.id} engagement={e} now={now} />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby={pastId} className="dashboard__section dashboard__section--past">
              <div className="dashboard__head">
                <h2 id={pastId} className={labelClass}>
                  Past
                </h2>
                <div className="dashboard__search">
                  <Input
                    type="search"
                    aria-label="Search past engagements"
                    placeholder="Search name or client"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>
              {past.length === 0 ? (
                <p className="dashboard__note">Archived engagements show here.</p>
              ) : (
                <>
                  <PastTable engagements={shown} now={now} />
                  {shown.length === 0 && (
                    <p className="dashboard__note dashboard__note--inset">No matches for “{q.trim()}”.</p>
                  )}
                </>
              )}
            </section>
          </>
        )
      )}

      <EngagementDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
