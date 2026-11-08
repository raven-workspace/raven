import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import type { Engagement } from "../../types/engagement";
import { BrandIcon, Button, Dialog, labelClass } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useHosts } from "../hosts/queries";

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
      qc.setQueryData(["engagement", e.id], saved);
      void qc.invalidateQueries({ queryKey: ["engagements"] });
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
        className="grid grid-flow-col items-center gap-2 cursor-default rounded-sm text-fg-2 hover:text-fg"
      >
        <BrandIcon brand="metasploit" />
        <span className={labelClass}>Metasploit</span>{" "}
        <span className={cx("text-meta", e.msfHostId ? "text-warn" : "text-fg")}>
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
              <Button variant="danger" onClick={() => setDialog("release")}>
                Release lock
              </Button>
            )}
            <Button onClick={close}>Close</Button>
          </>
        }
      >
        {error && <p role="alert" className="m-0 mb-2 text-meta text-warn">{error}</p>}
        <ul className="m-0 grid list-none gap-1 p-0">
          {hosts.map((h) => (
            <li key={h.id}>
              <Button
                className="w-full justify-start"
                aria-pressed={h.id === e.msfHostId}
                disabled={set.isPending}
                onClick={() => (h.id === e.msfHostId ? close() : set.mutate(h.id))}
              >
                {h.name}
              </Button>
            </li>
          ))}
        </ul>
        {hosts.length === 0 && <p className="m-0 text-meta text-muted">Add a host first.</p>}
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
