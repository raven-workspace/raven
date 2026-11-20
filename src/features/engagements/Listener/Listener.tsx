import { Link } from "react-router";
import { cx } from "../../../lib/cx";
import { labelClass } from "../../../ui/index";
import { useSettings } from "../../settings/queries";
import "./Listener.scss";

/**
 * Your listener (Settings → Your IP / Listener port) on the strip, as filled into checklist commands.
 * Links to Settings; "not set" is in the warn colour because commands then show LHOST unresolved.
 */
export function Listener({ step }: { step?: number }) {
  const s = useSettings().data;
  if (!s) return null;
  const ip = s.attackerIp.trim();
  const port = s.listenerPort.trim();
  const value = ip ? (port ? `${ip}:${port}` : ip) : port ? `not set, LPORT ${port}` : "not set";
  return (
    <Link
      to="/settings"
      aria-label={`LHOST ${value}`}
      title="Filled into checklist commands as LHOST and LPORT. Change it in Settings."
      data-drop={step}
      className="listener"
    >
      <span className={labelClass}>LHOST</span>
      <span className={cx("listener__value", ip && "listener__value--set")}>{value}</span>
    </Link>
  );
}
