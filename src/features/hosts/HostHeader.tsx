import { useQuery } from "@tanstack/react-query";
import { Lifebuoy, PencilSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../lib/api";
import { useNarrow } from "../../lib/useNarrow";
import type { Host } from "../../types/host";
import { BrandIcon, Button, Chip, ChipSet, IconButton, Kbd, Toolbar } from "../../ui";
import { threadsLabel, useThreadCounts } from "../notes/useThreadCounts";
import { HostDialog } from "./HostDialog";
import { COLUMN_LABELS, OS_LABELS } from "./columns";

export function HostHeader({ host, onStuck }: { host: Host; onStuck?: () => void }) {
  const [editing, setEditing] = useState(false);
  // Under 1000px of pane (952 here: this section sits inside the page's 24px side padding) the actions become icons before the title truncates, at the same window width as the engagement header.
  const [headerRef, narrow] = useNarrow<HTMLElement>(952);
  const threads = useThreadCounts(host.engagementId).byHost.get(host.id) ?? 0;
  // The AD set only means something in an exam sim (it counts as one target there).
  const engagement = useQuery({ queryKey: ["engagement", host.engagementId], queryFn: () => api.engagementGet(host.engagementId) });
  const examSim = engagement.data?.kind === "exam-sim";
  return (
    <section
      ref={headerRef}
      aria-label="Host"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line pb-3"
    >
      <h1 title={host.name} className="m-0 min-w-0 truncate text-title text-fg">
        {host.name}
      </h1>
      <Toolbar>
        {narrow ? (
          <>
            {onStuck && <IconButton icon={Lifebuoy} label="Stuck?" shortcut="H" onClick={onStuck} />}
            <IconButton icon={PencilSimple} label="Edit host" onClick={() => setEditing(true)} />
          </>
        ) : (
          <>
            {onStuck && (
              <Button size="sm" onClick={onStuck}>
                Stuck? <Kbd variant="inline" aria-hidden>H</Kbd>
              </Button>
            )}
            <Button size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        )}
      </Toolbar>
      <ChipSet className="col-span-2 items-center gap-x-4 gap-y-2">
        {host.ip && <span className="font-mono text-code text-fg-2">{host.ip}</span>}
        {host.os && (
          <span className="grid grid-flow-col items-center gap-2 text-meta text-fg-2">
            {(host.os === "windows" || host.os === "linux") && <BrandIcon brand={host.os} />}
            {OS_LABELS[host.os]}
          </span>
        )}
        {host.access !== "none" && <Chip variant="accent">{host.access}</Chip>}
        <Chip>{COLUMN_LABELS[host.boardColumn]}</Chip>
        {examSim && host.adSetEffective && <Chip>AD set</Chip>}
        {threads > 0 && <Chip>{threadsLabel(threads)}</Chip>}
      </ChipSet>
      <HostDialog open={editing} onOpenChange={setEditing} engagementId={host.engagementId} host={host} />
    </section>
  );
}
