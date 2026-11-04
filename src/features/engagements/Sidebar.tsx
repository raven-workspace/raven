import { useId, useState } from "react";
import { NavLink } from "react-router";
import { cx } from "../../lib/cx";
import { HostDialog } from "../hosts/HostDialog";
import { HostGlyph } from "../hosts/HostGlyph";
import { useHosts } from "../hosts/queries";
import { SECTIONS, sectionPath } from "./sections";

const row =
  "flex h-[30px] cursor-default items-center justify-between rounded-sm px-2 text-left text-[13px] no-underline transition-colors duration-100";
const rowState = (on: boolean) =>
  on ? "bg-surface-hi text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-muted-2 hover:bg-surface hover:text-fg";

export function Sidebar({ engagementId }: { engagementId: string }) {
  const hostsId = useId();
  const hosts = useHosts(engagementId);
  const [adding, setAdding] = useState(false);
  const list = hosts.data ?? [];

  return (
    <nav
      aria-label="Engagement"
      className="flex min-h-0 flex-col gap-px overflow-y-auto border-r border-line px-3 py-3.5"
    >
      {SECTIONS.map((s, i) => (
        <NavLink
          key={s.id}
          to={sectionPath(engagementId, s.id)}
          end
          className={({ isActive }) => cx(row, rowState(isActive))}
        >
          <span className="truncate">{s.label}</span>
          <span aria-hidden className="font-mono text-[10.5px] text-faint">
            {i + 1}
          </span>
        </NavLink>
      ))}
      <h2 id={hostsId} className="m-0 mt-5 mb-1.5 px-2 text-[10.5px] font-semibold uppercase tracking-label text-faint">
        Hosts
      </h2>
      {hosts.isSuccess && list.length === 0 && (
        <p aria-labelledby={hostsId} className="m-0 px-2 text-xs text-faint">
          No hosts yet
        </p>
      )}
      {list.map((h) => (
        <NavLink
          key={h.id}
          to={`/e/${engagementId}/h/${h.id}`}
          className={({ isActive }) => cx(row, "justify-start gap-2", rowState(isActive))}
        >
          <HostGlyph column={h.boardColumn} />
          <span className="truncate">{h.name}</span>
          {h.ip && <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">{h.ip}</span>}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={() => setAdding(true)}
        className={cx(row, "justify-start text-faint hover:bg-surface hover:text-fg")}
      >
        + Add host
      </button>
      <HostDialog open={adding} onOpenChange={setAdding} engagementId={engagementId} />
    </nav>
  );
}
