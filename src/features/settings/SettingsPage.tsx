import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import type { Settings } from "../../types/settings";
import { Button, Chip, Dialog, EmptyState, Field, Input, Panel } from "../../ui";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function NumberSetting({
  label,
  value,
  min,
  onSave,
}: {
  label: string;
  value: number;
  min: number;
  onSave: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Field label={label}>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        mono
        className="w-28"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (!Number.isInteger(n) || n < min) setText(String(value));
          else if (n !== value) onSave(n);
        }}
      />
    </Field>
  );
}

export function SettingsPage({ onRestored }: { onRestored: () => void }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.backupsList });
  const [restoreFile, setRestoreFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.settingsUpdate(patch),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      void qc.invalidateQueries({ queryKey: ["backups"] }); // retention may prune
    },
    onError: (e) => setError(e.message),
  });
  const backupNow = useMutation({
    mutationFn: api.backupNow,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["backups"] }),
    onError: (e) => setError(e.message),
  });
  const restore = useMutation({
    mutationFn: (file: string) => api.backupRestore(file),
    onSuccess: () => {
      setRestoreFile(null);
      onRestored();
    },
    onError: (e) => {
      setRestoreFile(null);
      setError(e.message);
    },
  });

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4 px-6 py-6">
      <h1 className="m-0 text-lg font-semibold text-fg">Settings</h1>
      {error && <p className="m-0 text-xs text-warn">{error}</p>}
      {settings.data && (
        <Panel title="Security and backups">
          <div className="flex gap-6">
            <NumberSetting
              key={settings.data.autoLockMinutes}
              label="Auto-lock (minutes)"
              value={settings.data.autoLockMinutes}
              min={1}
              onSave={(n) => update.mutate({ autoLockMinutes: n })}
            />
            <NumberSetting
              key={settings.data.backupRetention}
              label="Backups to keep"
              value={settings.data.backupRetention}
              min={1}
              onSave={(n) => update.mutate({ backupRetention: n })}
            />
          </div>
        </Panel>
      )}
      <Panel
        title="Backups"
        actions={
          <Button size="sm" onClick={() => backupNow.mutate()} disabled={backupNow.isPending}>
            Back up now
          </Button>
        }
      >
        {backups.data && backups.data.length === 0 && (
          <EmptyState title="No backups yet" body="Raven backs up daily when you unlock. Use Back up now any time." />
        )}
        <ul className="m-0 flex list-none flex-col p-0">
          {backups.data?.map((b) => (
            <li key={b.file} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
              <span className="font-mono text-xs text-fg-2">{new Date(b.createdAt).toLocaleString()}</span>
              <Chip>{b.reason}</Chip>
              <span className="ml-auto font-mono text-xs text-muted">{formatBytes(b.sizeBytes)}</span>
              <Button size="sm" onClick={() => setRestoreFile(b.file)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
      <Dialog
        open={restoreFile !== null}
        onOpenChange={(o) => !o && setRestoreFile(null)}
        title="Restore backup"
        footer={
          <>
            <Button onClick={() => setRestoreFile(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={restore.isPending}
              onClick={() => restoreFile && restore.mutate(restoreFile)}
            >
              Restore
            </Button>
          </>
        }
      >
        <p className="m-0 text-[13px] text-fg-2">
          Restore this backup? Raven will save a backup of the current data first, then lock. Unlock with your password
          to continue.
        </p>
      </Dialog>
    </div>
  );
}
