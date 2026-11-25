import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../lib/api";
import { cx } from "../../../lib/cx";
import type { Engagement } from "../../../types/engagement";
import { BrandIcon, Button, Dialog, labelClass } from "../../../ui/index";
import { ConfirmDelete } from "../../checklist/ConfirmDelete/ConfirmDelete";
import { useHosts } from "../../hosts/queries";
import { engagementSaved } from "../queries";
import "./MsfLock.scss";

/** Exam-sim only: the one host allowed to use Metasploit. Click to change or release it. */
export function MsfLock({ engagement: e, step }: { engagement: Engagement; step?: number }) {
  const qc = useQueryClient();
  const hosts = useHosts(e.id).data ?? [];
  const [dialog, setDialog] = useState<"pick" | "release" | null>(null);
  const [error, setError] = useState<string | undefined>();
  const locked = hosts.find((h) => h.id === e.msfHostId);

  const set = useMutation({
    mutationFn: (hostId: string | null) => api.engagementSetMsfHost(e.id, hostId),
    onSuccess: (saved) => {
      void engagementSaved(qc, saved);
      setDialog(null);
    },
    onError: (err) => setError(err.message),
  });
  const close = () => {
    setDialog(null);
    setError(undefined);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setDialog("pick")}
        data-drop={step}
        className="msf-lock"
      >
        <BrandIcon brand="metasploit" />
        <span className={labelClass}>Metasploit</span>{" "}
        <span className={cx("msf-lock__host", e.msfHostId && "msf-lock__host--locked")}>
          {e.msfHostId ? (locked?.name ?? "locked") : "unused"}
        </span>
      </button>
      <Dialog
        open={dialog === "pick"}
        onOpenChange={(o) => !o && close()}
        title="Metasploit host"
        description="The exam allows Metasploit against one machine only."
        footer={
          <>
            {locked && (
              <Button variant="quiet-danger" onClick={() => setDialog("release")}>
                Release lock
              </Button>
            )}
            <Button onClick={close}>Close</Button>
          </>
        }
      >
        {error && <p role="alert" className="msf-lock__error">{error}</p>}
        <ul className="msf-lock__hosts">
          {hosts.map((h) => (
            <li key={h.id}>
              <Button
                className="msf-lock__pick"
                aria-pressed={h.id === e.msfHostId}
                disabled={set.isPending}
                onClick={() => (h.id === e.msfHostId ? close() : set.mutate(h.id))}
              >
                {h.name}
              </Button>
            </li>
          ))}
        </ul>
        {hosts.length === 0 && <p className="msf-lock__empty">Add a host first.</p>}
      </Dialog>
      {dialog === "release" && (
        <ConfirmDelete
          title="Release the Metasploit lock?"
          label="Release"
          pending={set.isPending}
          {...(error ? { error } : {})}
          onConfirm={() => set.mutate(null)}
          onCancel={close}
        />
      )}
    </>
  );
}
