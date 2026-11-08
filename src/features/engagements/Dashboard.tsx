import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../../lib/api";
import { isDialogOpen, isTypingTarget, useKeydown, useNow } from "../../lib/keys";
import { Button, DASHBOARD_COLUMN, EmptyState, Input, Kbd, labelClass } from "../../ui";
import { ActiveCard } from "./ActiveCard";
import { EngagementDialog } from "./EngagementDialog";
import { PastTable, matchesSearch } from "./PastTable";

export function Dashboard() {
  const list = useQuery({ queryKey: ["engagements"], queryFn: api.engagementsList });
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
    <div data-testid="app-root" className="mx-auto flex w-full flex-col gap-7 pt-6 pb-10"
      style={{ maxWidth: DASHBOARD_COLUMN.max, paddingInline: DASHBOARD_COLUMN.inset }}>
      <header className="flex items-center justify-between gap-4">
        <h1 className="m-0 text-xl font-semibold tracking-[-0.01em] text-fg">Engagements</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New engagement <Kbd>⌘N</Kbd>
        </Button>
      </header>

      {list.isError && <p className="m-0 text-xs text-warn">Couldn't load engagements: {list.error.message}</p>}

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
            <section aria-labelledby={activeId} className="flex flex-col gap-3">
              <h2 id={activeId} className={`${labelClass} m-0`}>
                Active
              </h2>
              {active.length === 0 ? (
                <p className="m-0 text-[13px] text-muted">Nothing active. Archived engagements are below.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
                  {active.map((e) => (
                    <ActiveCard key={e.id} engagement={e} now={now} />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby={pastId} className="flex flex-col gap-3 border-t border-line pt-8">
              <div className="flex items-center justify-between gap-4">
                <h2 id={pastId} className={`${labelClass} m-0`}>
                  Past
                </h2>
                <div className="w-64">
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
                <p className="m-0 text-[13px] text-muted">Archived engagements show here.</p>
              ) : (
                <>
                  <PastTable engagements={shown} now={now} />
                  {shown.length === 0 && (
                    <p className="m-0 px-3 text-[13px] text-muted">No matches for “{q.trim()}”.</p>
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
