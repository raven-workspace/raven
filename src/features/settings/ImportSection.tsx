import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { buildImportPlan, listImportable, readBackup } from "../../engines/import";
import type { ImportCandidate, ImportPlan } from "../../engines/import";
import { api } from "../../lib/api";
import type { ImportRecordType, ImportSummary } from "../../types/import";
import { Button, Chip, Panel, Toggle } from "../../ui";

const TYPE_LABELS: Record<ImportRecordType, string> = {
  engagements: "Engagements",
  hosts: "Hosts",
  services: "Services",
  logEntries: "Log entries",
  notes: "Notes",
  checklist: "Checklist items",
  tunnels: "Tunnels",
  hops: "Hops",
  findings: "Findings",
  credentials: "Credentials",
  usernames: "Usernames",
  accessGrants: "Access grants",
  credAttempts: "Credential attempts",
};

/** Skipped: the record was left out. */
const SKIPPED: Record<string, string> = {
  redactedCredential: "Redacted credentials",
  redactedFlag: "Redacted flags",
  redactedLoot: "Redacted loot items",
  missingImage: "Screenshots with no image in the backup",
  badImage: "Unreadable images",
  imageTooLarge: "Images too large",
  unknownGoal: "Checklist items for goals that no longer exist",
  badHop: "Malformed pivot hops",
  hopHostMissing: "Pivot hops whose host is missing",
  attemptCredMissing: "Attempts whose credential is missing",
  attemptHostMissing: "Attempts whose host is missing",
  attemptUsernameMissing: "Attempts whose username is missing",
  badAttempt: "Malformed attempts",
  badChecklistItem: "Malformed checklist items",
  badCredential: "Malformed credentials",
  badFinding: "Malformed findings",
  badGrant: "Malformed access grants",
  badLogEntry: "Malformed log entries",
  badLoot: "Malformed loot items",
  badPortTriage: "Malformed port triage entries",
  badScreenshot: "Malformed screenshots",
  badService: "Malformed services",
  badTunnel: "Malformed tunnels",
  badUsername: "Malformed usernames",
  checklistNoOwner: "Checklist items with no owner",
  credDuplicate: "Duplicate credentials",
  credLocalHostMissing: "Local credentials whose host is missing",
  duplicate: "Duplicate records",
  emptyLogEntry: "Empty log entries",
  grantHostMissing: "Access grants whose host is missing",
  msfHostMissing: "Metasploit entries whose host is missing",
  tunnelHostMissing: "Tunnels whose host is missing",
  usernameDuplicate: "Duplicate usernames",
};

/** Adjusted: the record came in, with the detail kept in notes. */
const ADJUSTED: Record<string, string> = {
  invalidIp: "Hosts with an invalid IP",
  duplicateIp: "Hosts sharing an IP",
  noteOverflowToLog: "Long notes moved to the log",
  findingTextOverflowToLog: "Long finding text moved to the log",
  scopeInvalid: "Invalid scope entries",
  credUnassigned: "Credentials with no engagement",
  lootUnassigned: "Loot with no engagement",
  usernameUnassigned: "Usernames with no engagement",
  credLinkDropped: "Credential links dropped",
  droppedHostLink: "Host links dropped",
  droppedLogLink: "Log links dropped",
  droppedEvidence: "Evidence links dropped",
  droppedCredLink: "Credential links dropped from log entries",
  hopCredLinkDropped: "Hop credential links dropped",
};

const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function dateRange(c: ImportCandidate): string {
  if (c.firstAt === null) return `created ${shortDate(c.createdAt)}`;
  const a = shortDate(c.firstAt);
  const b = shortDate(c.lastAt ?? c.firstAt);
  return a === b ? a : `${a} – ${b}`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function countLine(c: { added: number; present: number; merged: number }): string {
  return `${c.added} added · ${c.present} already present${c.merged > 0 ? ` · ${c.merged} merged into existing` : ""}`;
}

function SkipGroup({ title, labels, skipped }: { title: string; labels: Record<string, string>; skipped: Record<string, number> }) {
  const rows = Object.entries(skipped).filter(([k]) => k in labels);
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-xs text-muted">{title}</div>
      <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
        {rows.map(([k, n]) => (
          <li key={k} className="flex gap-3 text-xs text-fg-2">
            <span className="font-mono">{n}</span>
            <span>{labels[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ summary, skipped }: { summary: ImportSummary; skipped: Record<string, number> }) {
  const rows = (Object.keys(TYPE_LABELS) as ImportRecordType[]).filter((t) => {
    const c = summary[t];
    return c.added + c.present + c.merged > 0;
  });
  const unknownCounts = Object.fromEntries(Object.entries(skipped).filter(([k]) => !(k in SKIPPED) && !(k in ADJUSTED)));
  const unknown = Object.fromEntries(Object.keys(unknownCounts).map((k) => [k, k]));
  return (
    <div className="mt-4 border-t border-line pt-3" aria-label="Import summary">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((t) => (
          <li key={t} className="flex items-baseline gap-3 text-xs">
            <span className="w-40 text-fg-2">{TYPE_LABELS[t]}</span>
            <span className="font-mono text-fg">{countLine(summary[t])}</span>
          </li>
        ))}
      </ul>
      <SkipGroup title="Skipped" labels={SKIPPED} skipped={skipped} />
      <SkipGroup title="Adjusted (kept in notes)" labels={ADJUSTED} skipped={skipped} />
      <SkipGroup title="Other" labels={unknown} skipped={unknownCounts} />
    </div>
  );
}

export function ImportSection() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<Parameters<typeof listImportable>[0] | null>(null);
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ summary: ImportSummary; skipped: ImportPlan["skipped"] } | null>(null);

  const candidates = backup ? listImportable(backup) : [];

  const run = useMutation({
    mutationFn: async () => {
      if (!backup) throw new Error("Choose a backup first");
      const plan = buildImportPlan(backup, [...selected], Date.now());
      const summary = await api.importApply(plan);
      return { summary, skipped: plan.skipped };
    },
    onMutate: () => setResult(null),
    onSuccess: (r) => {
      setResult(r);
      setSelected(new Set());
      void qc.invalidateQueries();
    },
  });

  async function onFile(file: File | undefined) {
    if (!file) return;
    setResult(null);
    run.reset();
    setSelected(new Set());
    setReadError(null);
    setBackup(null);
    setFileName(file.name);
    const res = await readBackup(await file.text());
    if (res.ok) setBackup(res.backup);
    else setReadError(res.error);
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <Panel
      title="Import"
      actions={
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          Choose backup…
        </Button>
      }
    >
      <input
        ref={fileRef}
        data-testid="import-file"
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <p className="m-0 text-xs text-muted">
        Import labs and standalone machines from an unencrypted old Raven backup. Existing data is never changed.
      </p>
      {readError && (
        <p role="alert" className="m-0 mt-3 text-xs text-warn">
          {readError}
        </p>
      )}
      {backup && (
        <div className="mt-3">
          <div className="mb-1 font-mono text-xs text-muted">{fileName}</div>
          {candidates.length === 0 && <p className="m-0 text-xs text-fg-2">Nothing importable in this backup.</p>}
          <ul className="m-0 flex list-none flex-col p-0">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
                <Toggle
                  on={selected.has(c.id)}
                  onChange={(on) => toggle(c.id, on)}
                  aria-label={`Select ${c.name}`}
                >
                  {selected.has(c.id) ? "Selected" : "Select"}
                </Toggle>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-fg">{c.name}</div>
                  <div className="text-xs text-muted">
                    {plural(c.hostCount, "host")} · {plural(c.logCount, "log entry").replace("entrys", "entries")} · {dateRange(c)}
                  </div>
                </div>
                <Chip>{c.kind}</Chip>
                <Chip>{c.engagementKind}</Chip>
              </li>
            ))}
          </ul>
          {candidates.length > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <Button
                variant="primary"
                disabled={selected.size === 0 || run.isPending}
                aria-busy={run.isPending}
                onClick={() => run.mutate()}
              >
                Import
              </Button>
              {run.isPending && <span className="text-xs text-muted">Backing up and importing…</span>}
            </div>
          )}
        </div>
      )}
      {run.isError && (
        <p role="alert" className="m-0 mt-3 text-xs text-warn">
          {run.error.message}
        </p>
      )}
      {result && <Summary summary={result.summary} skipped={result.skipped} />}
    </Panel>
  );
}
