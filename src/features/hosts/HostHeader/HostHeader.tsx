import { PencilSimple } from "@phosphor-icons/react";
import { useState } from "react";
import type { Host } from "../../../types/host";
import { BrandIcon, Chip, ChipSet, IconButton } from "../../../ui/index";
import { threadsLabel, useThreadCounts } from "../../notes/useThreadCounts";
import { HostDialog } from "../HostDialog/HostDialog";
import { COLUMN_LABELS, OS_LABELS } from "../columns";
import { useEngagement } from "../../engagements/queries";
import "./HostHeader.scss";

/**
 * The host's name with its Edit pencil right beside it, so it reads as "edit this host". Stuck? lives at the end of the
 * work column's tab row and the full key list under the title bar's shortcuts button.
 */
export function HostHeader({ host }: { host: Host }) {
  const [editing, setEditing] = useState(false);
  const threads = useThreadCounts(host.engagementId).byHost.get(host.id) ?? 0;
  // The AD set only means something in an exam sim (it counts as one target there).
  const engagement = useEngagement(host.engagementId);
  const examSim = engagement.data?.kind === "exam-sim";
  return (
    <section aria-label="Host" className="host-header">
      {/* Its own grid: the details row below must not widen the name's track and push the pencil away from it. */}
      <div className="host-header__name-row">
        <h1 title={host.name} className="host-header__name">
          {host.name}
        </h1>
        <IconButton icon={PencilSimple} label="Edit host" onClick={() => setEditing(true)} />
      </div>
      <ChipSet className="host-header__details">
        {host.ip && <span className="host-header__ip">{host.ip}</span>}
        {host.os && (
          <span className="host-header__os">
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
