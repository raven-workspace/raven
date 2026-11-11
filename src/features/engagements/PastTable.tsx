import { Link, useNavigate } from "react-router";
import { cx } from "../../lib/cx";
import type { Engagement } from "../../types/engagement";
import { labelClass } from "../../ui";
import { useProgress } from "../hosts/queries";
import { EMPTY_PROGRESS, KIND_LABEL, dateRange } from "./format";

/** Case-insensitive match on name and client. */
export function matchesSearch(e: Engagement, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") return true;
  return e.name.toLowerCase().includes(needle) || (e.client ?? "").toLowerCase().includes(needle);
}

const COLS = ["Engagement", "Kind", "Dates", "Result", "Report"] as const;
const cell = "px-3 text-left align-baseline";

/** How it ended: hosts rooted and flags found, as on the active cards. Nothing to show without hosts. */
function Result({ id }: { id: string }) {
  const p = useProgress().data?.[id] ?? EMPTY_PROGRESS;
  if (p.hostsTotal === 0) return <span className="text-faint">—</span>;
  return (
    <span className="grid grid-flow-col justify-start gap-4 text-meta">
      {(
        [
          ["Rooted", `${p.hostsRooted}/${p.hostsTotal}`],
          ["Flags", `${p.flagsFound}/${p.flagsTotal}`],
        ] as const
      ).map(([label, value]) => (
        <span key={label} className="grid grid-flow-col items-baseline gap-1">
          <span className="text-muted-2">{label}</span>
          <span className={cx("font-mono text-code tabular-nums", label === "Rooted" && p.hostsRooted === p.hostsTotal ? "text-accent" : "text-fg-2")}>
            {value}
          </span>
        </span>
      ))}
    </span>
  );
}

export function PastTable({ engagements, now }: { engagements: Engagement[]; now: number }) {
  const navigate = useNavigate();
  return (
    <table className="w-full table-fixed border-collapse text-body">
      <colgroup>
        <col className="w-[36%]" />
        <col className="w-[12%]" />
        <col className="w-[20%]" />
        <col className="w-[22%]" />
        <col className="w-[10%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-line-2">
          {COLS.map((c) => (
            <th key={c} scope="col" className={cx(cell, labelClass, "pb-2")}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {engagements.map((e) => (
          <tr
            key={e.id}
            onClick={() => void navigate(`/e/${e.id}`)}
            className="cursor-default border-b border-line text-fg-2 transition-colors duration-100 hover:bg-surface"
          >
            {/* The link carries half the cell's padding, so it is a 28px target and the row keeps its height. */}
            <td className={cx(cell, "py-1")}>
              <Link
                to={`/e/${e.id}`}
                title={e.name}
                className="block truncate py-1 text-fg no-underline"
                onClick={(ev) => ev.stopPropagation()}
              >
                {e.name}
              </Link>
              {e.client && <span className="block truncate text-meta text-muted">{e.client}</span>}
            </td>
            <td className={cx(cell, "py-2", "text-muted-2")}>{KIND_LABEL[e.kind]}</td>
            <td className={cx(cell, "py-2", "truncate text-muted-2")}>{dateRange(e.startsAt, e.endsAt, now)}</td>
            <td className={cx(cell, "py-2")}>
              <Result id={e.id} />
            </td>
            <td className={cx(cell, "py-2", "text-faint")}>—</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
