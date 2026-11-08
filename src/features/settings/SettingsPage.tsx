import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import type { BackupInfo } from "../../types/backup";
import type { SettingsPatch } from "../../types/settings";
import { Button, Chip, Dialog, EmptyState, Field, Input, Panel, SETTINGS_COLUMN, queryState } from "../../ui";
import { FieldManualSection } from "./FieldManualSection";
import { ImportSection } from "./ImportSection";

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
  max,
  error,
  onSave,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  error?: string | undefined;
  onSave: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Field label={label} error={error} className="w-40">
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        mono
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (!Number.isInteger(n) || n < min || n > max) setText(String(value));
          else if (n !== value) onSave(n);
        }}
      />
    </Field>
  );
}

function TextSetting({
  label,
  value,
  placeholder,
  hint,
  error,
  className,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  error?: string | undefined;
  className?: string;
  onSave: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <Input
        mono
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = text.trim();
          if (v !== value) onSave(v);
        }}
      />
    </Field>
  );
}

/** The NVD API key: write-only. The stored key is never shown; only whether one is set. */
function NvdKeySetting({
  set,
  error,
  pending,
  onSave,
}: {
  set: boolean;
  error?: string | undefined;
  pending: boolean;
  onSave: (key: string, done: () => void) => void;
}) {
  const [text, setText] = useState("");
  const save = () => {
    const v = text.trim();
    if (v !== "") onSave(v, () => setText(""));
  };
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[minmax(0,22rem)_auto_auto] items-end justify-start gap-3">
        <Field label="NVD API key" error={error}>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            mono
            value={text}
            placeholder={set ? "Paste a new key to replace it" : "Paste your key"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
        </Field>
        <Button disabled={pending || text.trim() === ""} onClick={save}>
          Save key
        </Button>
        <Button disabled={pending || !set} onClick={() => onSave("", () => setText(""))}>
          Clear key
        </Button>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
        <Chip variant={set ? "accent" : "default"}>{set ? "Set" : "Not set"}</Chip>
        <p className="m-0 text-meta text-muted">
          Looks up CVEs you add to findings. Only the CVE ID and this key are sent, to NIST NVD. Without a key, use the
          CVSS builder.
        </p>
      </div>
    </div>
  );
}

/** `onRestored` runs whenever the backend ends up locked (after a restore, or a failed one). */
export function SettingsPage({ onRestored }: { onRestored: () => void }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.backupsList });
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; msg: string } | null>(null);

  const update = useMutation({
    mutationFn: (patch: SettingsPatch) => {
      setFieldError(null);
      return api.settingsUpdate(patch);
    },
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      void qc.invalidateQueries({ queryKey: ["backups"] }); // retention may prune
    },
    onError: (e) => {
      const field = (e as { field?: string }).field;
      if (field) setFieldError({ field, msg: e.message });
      else setError(e.message);
    },
  });
  const backupNow = useMutation({
    mutationFn: api.backupNow,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["backups"] }),
    onError: (e) => setError(e.message),
  });
  const restore = useMutation({
    mutationFn: (file: string) => api.backupRestore(file),
    onSuccess: () => {
      setRestoreTarget(null);
      onRestored();
    },
    onError: async (e) => {
      setRestoreTarget(null);
      // A restore can fail after the backend has already locked; never leave the UI unlocked then.
      const st = await api.vaultStatus().catch(() => null);
      if (st && !st.unlocked) onRestored();
      else setError(e.message);
    },
  });

  return (
    <div data-testid="settings-root" className="mx-auto grid gap-4 py-6" style={{ maxWidth: SETTINGS_COLUMN.max, paddingInline: SETTINGS_COLUMN.inset }}>
      <h1 className="m-0 text-title text-fg">Settings</h1>
      {error && <p role="alert" className="m-0 text-meta text-warn">{error}</p>}
      {queryState([settings], "settings")}
      {settings.data && (
        <Panel title="Security and backups">
          <div className="grid grid-flow-col justify-start gap-6">
            <NumberSetting
              key={settings.data.autoLockMinutes}
              label="Auto-lock (minutes)"
              value={settings.data.autoLockMinutes}
              min={1}
              max={240}
              error={fieldError?.field === "autoLockMinutes" ? fieldError.msg : undefined}
              onSave={(n) => update.mutate({ autoLockMinutes: n })}
            />
            <NumberSetting
              key={settings.data.backupRetention}
              label="Backups to keep"
              value={settings.data.backupRetention}
              min={1}
              max={200}
              error={fieldError?.field === "backupRetention" ? fieldError.msg : undefined}
              onSave={(n) => update.mutate({ backupRetention: n })}
            />
          </div>
        </Panel>
      )}
      {settings.data && (
        <Panel title="Attacker">
          <div className="grid grid-flow-col justify-start gap-6">
            <TextSetting
              key={`ip-${settings.data.attackerIp}`}
              label="Your IP (tun0)"
              value={settings.data.attackerIp}
              placeholder="10.10.14.9"
              className="w-44"
              error={fieldError?.field === "attackerIp" ? fieldError.msg : undefined}
              onSave={(v) => update.mutate({ attackerIp: v })}
            />
            <TextSetting
              key={`port-${settings.data.listenerPort}`}
              label="Listener port"
              value={settings.data.listenerPort}
              placeholder="4444"
              className="w-28"
              error={fieldError?.field === "listenerPort" ? fieldError.msg : undefined}
              onSave={(v) => update.mutate({ listenerPort: v })}
            />
          </div>
          <p className="m-0 mt-3 text-meta text-muted">Filled into checklist commands as LHOST and LPORT</p>
          <div className="mt-4 grid grid-cols-[minmax(0,11rem)_minmax(0,16rem)_minmax(0,16rem)] justify-start gap-6">
            <TextSetting
              key={`ku-${settings.data.kaliUser}`}
              label="Kali user"
              value={settings.data.kaliUser}
              placeholder="kali"
              error={fieldError?.field === "kaliUser" ? fieldError.msg : undefined}
              onSave={(v) => update.mutate({ kaliUser: v })}
            />
            <TextSetting
              key={`wt-${settings.data.windowsToolsDir}`}
              label="Windows tools folder (on Kali)"
              value={settings.data.windowsToolsDir}
              placeholder="~/tools/windows"
              error={fieldError?.field === "windowsToolsDir" ? fieldError.msg : undefined}
              onSave={(v) => update.mutate({ windowsToolsDir: v })}
            />
            <TextSetting
              key={`lt-${settings.data.linuxToolsDir}`}
              label="Linux tools folder (on Kali)"
              value={settings.data.linuxToolsDir}
              placeholder="~/tools/linux"
              error={fieldError?.field === "linuxToolsDir" ? fieldError.msg : undefined}
              onSave={(v) => update.mutate({ linuxToolsDir: v })}
            />
          </div>
        </Panel>
      )}
      {settings.data && (
        <Panel title="CVE lookup">
          <NvdKeySetting
            set={settings.data.nvdKeySet}
            pending={update.isPending}
            error={fieldError?.field === "nvdApiKey" ? fieldError.msg : undefined}
            onSave={(key, done) => update.mutate({ nvdApiKey: key }, { onSuccess: done })}
          />
        </Panel>
      )}
      <Panel
        title="Backups"
        actions={
          <Button
            size="sm"
            onClick={() => backupNow.mutate()}
            disabled={backupNow.isPending}
            aria-busy={backupNow.isPending}
          >
            {backupNow.isPending ? "Backing up…" : "Back up now"}
          </Button>
        }
      >
        {queryState([backups], "backups")}
        {backups.data && backups.data.length === 0 && (
          <EmptyState title="No backups yet" body="Raven backs up daily when you unlock. Use Back up now any time." />
        )}
        <ul className="m-0 grid list-none p-0">
          {backups.data?.map((b) => (
            <li
              key={b.file}
              className="grid grid-cols-[max-content_minmax(0,1fr)_max-content_auto] items-center gap-3 border-b border-line py-2 last:border-b-0"
            >
              <span className="font-mono text-code text-fg-2">{new Date(b.createdAt).toLocaleString()}</span>
              <span className="grid justify-items-start">
                <Chip>{b.reason}</Chip>
              </span>
              <span className="font-mono text-code text-muted tabular-nums">{formatBytes(b.sizeBytes)}</span>
              <Button size="sm" onClick={() => setRestoreTarget(b)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
      <FieldManualSection />
      <ImportSection />
      <Dialog
        open={restoreTarget !== null}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="Restore backup"
        footer={
          <>
            <Button onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={restore.isPending}
              onClick={() => restoreTarget && restore.mutate(restoreTarget.file)}
            >
              Restore
            </Button>
          </>
        }
      >
        {restoreTarget && (
          <div className="mb-3 grid grid-cols-[max-content_minmax(0,1fr)] items-center justify-items-start gap-3">
            <span className="font-mono text-code text-fg-2">{new Date(restoreTarget.createdAt).toLocaleString()}</span>
            <Chip>{restoreTarget.reason}</Chip>
          </div>
        )}
        <p className="m-0 text-body text-fg-2">
          Restore this backup? Raven will save a backup of the current data first, then lock. Unlock with your password
          to continue.
        </p>
      </Dialog>
    </div>
  );
}
