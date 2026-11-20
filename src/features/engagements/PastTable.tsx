import { Link, useNavigate } from "react-router";
import { cx } from "../../lib/cx";
import type { Engagement } from "../../types/engagement";
import { labelClass } from "../../ui";
import { useProgress } from "../hosts/queries";
import { EMPTY_PROGRESS, KIND_LABEL, dateRange } from "./format";
import "./PastTable.scss";

/** Case-insensitive match on name and client. */
export function matchesSearch(e: Engagement, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") return true;
  return e.name.toLowerCase().includes(needle) || (e.client ?? "").toLowerCase().includes(needle);
}

const COLS = ["Engagement", "Kind", "Dates", "Result", "Report"] as const;

/** How it ended: hosts rooted and flags found, as on the active cards. Nothing to show without hosts. */
function Result({ id }: { id: string }) {
  const p = useProgress().data?.[id] ?? EMPTY_PROGRESS;
  if (p.hostsTotal === 0) return <span className="past-table__none">—</span>;
  return (
    <span className="past-table__result">
      {(
        [
          ["Rooted", `${p.hostsRooted}/${p.hostsTotal}`],
          ["Flags", `${p.flagsFound}/${p.flagsTotal}`],
        ] as const
      ).map(([label, value]) => (
        <span key={label} className="past-table__stat">
          <span className="past-table__stat-label">{label}</span>
          <span className={cx("past-table__stat-value", label === "Rooted" && p.hostsRooted === p.hostsTotal && "past-table__stat-value--all")}>
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
    <table className="past-table">
      <colgroup>
        <col className="past-table__col--name" />
        <col className="past-table__col--kind" />
        <col className="past-table__col--dates" />
        <col className="past-table__col--result" />
        <col className="past-table__col--report" />
      </colgroup>
      <thead>
        <tr className="past-table__head-row">
          {COLS.map((c) => (
            <th key={c} scope="col" className={cx("past-table__th", labelClass)}>
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
            className="past-table__row"
          >
            {/* The link carries half the cell's padding, so it is a 28px target and the row keeps its height. */}
            <td className="past-table__cell past-table__cell--name">
              <Link
                to={`/e/${e.id}`}
                title={e.name}
                className="past-table__name"
                onClick={(ev) => ev.stopPropagation()}
              >
                {e.name}
              </Link>
              {e.client && <span className="past-table__client">{e.client}</span>}
            </td>
            <td className="past-table__cell past-table__cell--muted">{KIND_LABEL[e.kind]}</td>
            <td className="past-table__cell past-table__cell--muted past-table__cell--dates">{dateRange(e.startsAt, e.endsAt, now)}</td>
            <td className="past-table__cell">
              <Result id={e.id} />
            </td>
            <td className="past-table__cell past-table__cell--none">—</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
