import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { labelClass } from "../../ui";

/**
 * Your listener (Settings → Your IP / Listener port) on the strip, as filled into checklist commands.
 * Links to Settings; "not set" is in the warn colour because commands then show LHOST unresolved.
 */
export function Listener({ step }: { step?: number }) {
  const s = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet }).data;
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
      className="grid grid-flow-col items-center gap-2 rounded-sm cursor-default hover:text-fg"
    >
      <span className={labelClass}>LHOST</span>
      <span className={cx("text-meta", ip ? "font-mono text-fg" : "text-warn")}>{value}</span>
    </Link>
  );
}
