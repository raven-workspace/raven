import { useQuery } from "@tanstack/react-query";
import { LinuxLogo, Question, WindowsLogo, type Icon } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../lib/api";
import type { Host, HostOs } from "../../types/host";
import { Button, Chip, ChipSet, Kbd, Toolbar } from "../../ui";
import { threadsLabel, useThreadCounts } from "../notes/useThreadCounts";
import { HostDialog } from "./HostDialog";
import { COLUMN_LABELS, OS_LABELS } from "./columns";

const OS_ICONS: Record<HostOs, Icon> = { windows: WindowsLogo, linux: LinuxLogo, other: Question };

export function HostHeader({ host, onStuck }: { host: Host; onStuck?: () => void }) {
  const [editing, setEditing] = useState(false);
  const threads = useThreadCounts(host.engagementId).byHost.get(host.id) ?? 0;
  // The AD set only means something in an exam sim (it counts as one target there).
  const engagement = useQuery({ queryKey: ["engagement", host.engagementId], queryFn: () => api.engagementGet(host.engagementId) });
  const examSim = engagement.data?.kind === "exam-sim";
  const OsIcon = host.os ? OS_ICONS[host.os] : null;
  return (
    <section
      aria-label="Host"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-b border-line pb-3"
    >
      <h1 title={host.name} className="m-0 min-w-0 truncate text-title text-fg">
        {host.name}
      </h1>
      <Toolbar>
        {onStuck && (
          <Button size="sm" onClick={onStuck}>
            Stuck? <Kbd variant="inline" aria-hidden>H</Kbd>
          </Button>
        )}
        <Button size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </Toolbar>
      <ChipSet className="col-span-2 items-center gap-x-4 gap-y-1.5">
        {host.ip && <span className="font-mono text-code text-fg-2">{host.ip}</span>}
        {host.os && OsIcon && (
          <span className="grid grid-flow-col items-center gap-1.5 text-meta text-fg-2">
            <OsIcon aria-hidden size={16} />
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
