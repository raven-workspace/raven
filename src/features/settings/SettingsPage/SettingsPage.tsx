import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../lib/api";
import type { BackupInfo } from "../../../types/backup";
import type { Settings, SettingsPatch } from "../../../types/settings";
import { isValidOsid } from "../../../engines/report/meta";
import { Button, Chip, Dialog, EmptyState, Field, Input, Panel, SETTINGS_COLUMN, Textarea, queryState } from "../../../ui/index";
import { AboutSection } from "../AboutSection/AboutSection";
import { FieldManualSection } from "../FieldManualSection/FieldManualSection";
import { settingsKey, useSettings } from "../queries";
import { RavenError } from "../../../types/errors";
import "./SettingsPage.scss";

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
    <Field label={label} error={error} className="settings-page__number">
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
    <div className="settings-page__stack">
      <div className="settings-page__key-row">
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
      <div className="settings-page__aside settings-page__aside--top">
        <Chip variant={set ? "accent" : "default"}>{set ? "Set" : "Not set"}</Chip>
        <p className="settings-page__note">
          Looks up CVEs you add to findings. Only the CVE ID and this key are sent, to NIST NVD. Without a key, use the
          CVSS builder.
        </p>
      </div>
    </div>
  );
}

/** Defaults copied into each new report's cover and methodology. Each field saves on blur. Local state is seeded once and never re-synced, so a refetch cannot discard typing in another field. */
function ReportDetails({
  settings,
  fieldError,
  onSave,
}: {
  settings: Settings;
  fieldError: { field: string; msg: string } | null;
  onSave: (patch: SettingsPatch) => void;
}) {
  const [name, setName] = useState(settings.reportName);
  const [email, setEmail] = useState(settings.reportEmail);
  const [osid, setOsid] = useState(settings.reportOsid);
  const [methodology, setMethodology] = useState(settings.reportMethodology);
  const [introduction, setIntroduction] = useState(settings.reportIntroduction);
  const err = (field: string) => (fieldError?.field === field ? fieldError.msg : undefined);
  const osidTrimmed = osid.trim();
  return (
    <div className="settings-page__stack settings-page__stack--loose">
      <div className="settings-page__fields settings-page__fields--report">
        <Field label="Your name" error={err("reportName")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== settings.reportName && onSave({ reportName: name.trim() })}
          />
        </Field>
        <Field label="Email" error={err("reportEmail")}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email.trim() !== settings.reportEmail && onSave({ reportEmail: email.trim() })}
          />
        </Field>
        <Field label="OSID" error={err("reportOsid")}>
          <Input
            mono
            placeholder="OS-12345"
            value={osid}
            onChange={(e) => setOsid(e.target.value)}
            onBlur={() => osidTrimmed !== settings.reportOsid && onSave({ reportOsid: osidTrimmed })}
          />
        </Field>
      </div>
      {osidTrimmed !== "" && !isValidOsid(osidTrimmed) && (
        <p className="settings-page__error">OSIDs look like OS-12345</p>
      )}
      <Field
        label="Default introduction, objective and requirements"
        hint="Report section 1. A line reading Introduction, Objective or Requirements starts that part."
        error={err("reportIntroduction")}
      >
        <Textarea
          rows={6}
          value={introduction}
          onChange={(e) => setIntroduction(e.target.value)}
          onBlur={() => introduction.trim() !== settings.reportIntroduction && onSave({ reportIntroduction: introduction.trim() })}
        />
      </Field>
      <Field label="Default methodology" error={err("reportMethodology")}>
        <Textarea
          rows={6}
          value={methodology}
          onChange={(e) => setMethodology(e.target.value)}
          onBlur={() => methodology.trim() !== settings.reportMethodology && onSave({ reportMethodology: methodology.trim() })}
        />
      </Field>
      <p className="settings-page__note">Raven copies these into each new report. Changing them here doesn't change reports you've already started.</p>
      <div className="settings-page__aside">
        <Button size="sm" disabled={(settings.reportGuidesHidden ?? []).length === 0} onClick={() => onSave({ reportGuidesHidden: [] })}>
          Show guide notes again
        </Button>
        <p className="settings-page__note">The notes above each part of the report, in the report editor.</p>
      </div>
    </div>
  );
}

/** `onRestored` runs whenever the backend ends up locked (after a restore, or a failed one). */
export function SettingsPage({ onRestored }: { onRestored: () => void }) {
  const qc = useQueryClient();
  const settings = useSettings();
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
      qc.setQueryData(settingsKey, s);
      void qc.invalidateQueries({ queryKey: ["backups"] }); // retention may prune
    },
    onError: (e) => {
      const field = RavenError.from(e).field;
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
    <div data-testid="settings-root" className="raven-page settings-page" style={{ maxWidth: SETTINGS_COLUMN.max, paddingInline: SETTINGS_COLUMN.inset }}>
      <h1 className="settings-page__title">Settings</h1>
      {error && <p role="alert" className="settings-page__error">{error}</p>}
      {queryState([settings], "settings")}
      {settings.data && (
        <Panel title="Security and backups">
          <div className="settings-page__fields">
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
          <div className="settings-page__fields">
            <TextSetting
              key={`ip-${settings.data.attackerIp}`}
              label="Your IP (tun0)"
              value={settings.data.attackerIp}
              placeholder="10.10.14.9"
              className="settings-page__number"
              error={fieldError?.field === "attackerIp" ? fieldError.msg : undefined}
              onSave={(v) => update.mutate({ attackerIp: v })}
            />
            <TextSetting
              key={`port-${settings.data.listenerPort}`}
              label="Listener port"
              value={settings.data.listenerPort}
              placeholder="4444"
              className="settings-page__port"
              error={fieldError?.field === "listenerPort" ? fieldError.msg : undefined}
              onSave={(v) => update.mutate({ listenerPort: v })}
            />
          </div>
          <p className="settings-page__note settings-page__note--spaced">Filled into checklist commands as LHOST and LPORT</p>
          <div className="settings-page__fields settings-page__fields--tools">
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
      {settings.data && (
        <Panel title="Report details">
          <ReportDetails
            settings={settings.data}
            fieldError={fieldError}
            onSave={(patch) => update.mutate(patch)}
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
        <ul className="settings-page__backups">
          {backups.data?.map((b) => (
            <li
              key={b.file}
              className="settings-page__backup"
            >
              <span className="settings-page__when">{new Date(b.createdAt).toLocaleString()}</span>
              <span className="settings-page__reason">
                <Chip>{b.reason}</Chip>
              </span>
              <span className="settings-page__size">{formatBytes(b.sizeBytes)}</span>
              <Button size="sm" onClick={() => setRestoreTarget(b)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
      <FieldManualSection />
      <AboutSection />
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
          <div className="settings-page__restore-target">
            <span className="settings-page__when">{new Date(restoreTarget.createdAt).toLocaleString()}</span>
            <Chip>{restoreTarget.reason}</Chip>
          </div>
        )}
        <p className="settings-page__restore-text">
          Restore this backup? Raven will save a backup of the current data first, then lock. Unlock with your password
          to continue.
        </p>
      </Dialog>
    </div>
  );
}
