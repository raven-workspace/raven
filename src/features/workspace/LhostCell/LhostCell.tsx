import { Check, Copy, ShieldCheck } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../../../lib/api";
import { copyPlain } from "../../../lib/clipboard";
import { cx } from "../../../lib/cx";
import { useKeydown } from "../../../lib/keys";
import { reportError } from "../../../lib/lockSignal";
import { matches, SHORTCUTS } from "../../../lib/shortcuts";
import { IconButton, labelClass, Tooltip, useFlash } from "../../../ui/index";
import { setCachedSettings, useSettings } from "../../settings/queries";
import { useTun0 } from "../queries";
import "./LhostCell.scss";

/**
 * LHOST on the status bar (design §1.5): your listener from Settings, as filled into checklist commands, with Copy
 * (⌘⇧L). The value opens Settings; "not set" is amber, because commands then show LHOST unresolved. When tun0's address
 * differs from Settings, the value turns amber and offers tun0 instead: a click sets it in Settings. No tun0: no change.
 * Never drops from the bar.
 */
export function LhostCell() {
  const qc = useQueryClient();
  const s = useSettings().data;
  const tun0 = useTun0().data ?? null;
  const [copied, flash] = useFlash(1500);
  const adopt = useMutation({
    mutationFn: (ip: string) => api.settingsUpdate({ attackerIp: ip }),
    onSuccess: (saved) => setCachedSettings(qc, saved),
    onError: reportError,
  });
  const ip = s?.attackerIp.trim() ?? "";
  const copy = () => {
    if (ip) void copyPlain(ip).then(flash, reportError);
  };
  useKeydown((e) => {
    if (e.defaultPrevented || !matches(SHORTCUTS.copyLhost, e)) return;
    e.preventDefault();
    copy();
  });
  if (!s) return null;

  const port = s.listenerPort.trim();
  const value = ip ? (port ? `${ip}:${port}` : ip) : port ? `not set, LPORT ${port}` : "not set";
  const offer = tun0 !== null && tun0 !== ip ? tun0 : null;
  return (
    <span role="group" aria-label="LHOST" className="lhost-cell">
      <ShieldCheck size={16} aria-hidden className="lhost-cell__icon" />
      <span className={labelClass}>LHOST</span>
      {offer ? (
        <Tooltip content={`tun0 is ${offer}. Use it?`}>
          <button
            type="button"
            aria-label={`LHOST ${value}. tun0 is ${offer}. Use it`}
            disabled={adopt.isPending}
            onClick={() => adopt.mutate(offer)}
            className="lhost-cell__value lhost-cell__value--warn"
          >
            {value}
          </button>
        </Tooltip>
      ) : (
        <Link
          to="/settings"
          aria-label={`LHOST ${value}`}
          title="Filled into checklist commands as LHOST and LPORT. Change it in Settings."
          className={cx("lhost-cell__value", ip ? "lhost-cell__value--set" : "lhost-cell__value--warn")}
        >
          {value}
        </Link>
      )}
      <IconButton icon={copied ? Check : Copy} label="Copy LHOST" shortcut={SHORTCUTS.copyLhost} disabled={!ip} onClick={copy} />
    </span>
  );
}
