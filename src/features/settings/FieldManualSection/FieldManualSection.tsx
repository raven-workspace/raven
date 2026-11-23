import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { api } from "../../../lib/api";
import { Button, Disclosure, Field, Input, Panel } from "../../../ui/index";
import type { Drift } from "../../../engines/fieldManual/drift";
import { useFieldManual, useImportFieldManual } from "../../fieldManual/queries";
import { settingsKey, useSettings } from "../queries";
import "./FieldManualSection.scss";

/** Settings › Field Manual: where the vault is, import it now, and what the last import did. */
export function FieldManualSection() {
  const qc = useQueryClient();
  const settings = useSettings();
  const snap = useFieldManual();
  const imp = useImportFieldManual();
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["fieldManualMtime"] });
  }, [qc]);
  // The Manual's empty state links here: `/settings#field-manual` brings this panel into view.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === "#field-manual") document.getElementById("field-manual")?.scrollIntoView?.({ block: "start" });
  }, [hash]);
  const saved = settings.data?.fieldManualPath;
  const [draft, setPath] = useState<string | null>(null);
  const path = draft ?? saved ?? "";
  const [error, setError] = useState<string | null>(null);

  const savePath = async (): Promise<boolean> => {
    const v = path.trim();
    if (v === saved) {
      setPath(null);
      return true;
    }
    try {
      qc.setQueryData(settingsKey, await api.settingsUpdate({ fieldManualPath: v }));
      setPath(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const importNow = async () => {
    setError(null);
    if (!(await savePath())) return;
    imp.mutate(path.trim(), { onError: (e) => setError(e.message) });
  };

  const s = snap.data;
  const r = s?.report;
  return (
    <Panel
      id="field-manual"
      title="Field Manual"
      actions={
        <Button size="sm" onClick={() => void importNow()} disabled={imp.isPending || !settings.data} aria-busy={imp.isPending}>
          {imp.isPending ? "Importing…" : "Import now"}
        </Button>
      }
    >
      <Field label="Vault folder">
        <Input mono value={path} placeholder="~/…/Field-Manual" onChange={(e) => setPath(e.target.value)} onBlur={() => void savePath()} />
      </Field>
      {error && <p role="alert" className="field-manual-section__error">{error}</p>}
      {s && (
        <p className="field-manual-section__summary">
          Last import {new Date(s.importedAt).toLocaleString()}: {s.cards.length} cards,{" "}
          {Object.keys(s.overlay ?? {}).length + (s.added?.length ?? 0)} commands
          {s.notes ? `, ${s.notes.length} notes` : ""}.
        </p>
      )}
      {r && (
        <ul className="field-manual-section__report">
          {r.warnings?.map((w) => <li key={w} className="field-manual-section__warning">{w}</li>)}
          <li>Cards: {r.cardsAdded} added, {r.cardsChanged} changed, {r.cardsRemoved} gone from the vault</li>
          <li>Commands: {r.commandsAdded} added, {r.commandsChanged} changed</li>
          {r.commandsRemovedKept.length > 0 && (
            <li>{r.commandsRemovedKept.length} built-in commands no longer in the vault (kept)</li>
          )}
          {(r.addedRemoved?.length ?? 0) > 0 && (
            <li>{r.addedRemoved?.length} added commands no longer in the vault (kept)</li>
          )}
          {r.classified.length > 0 && <li>{r.classified.length} given an exam rule</li>}
        </ul>
      )}
      {r?.drift && <DriftReport drift={r.drift} />}
    </Panel>
  );
}

function Lines({ label, lines }: { label: string; lines: string[] }) {
  const [open, setOpen] = useState(false);
  // An empty group is one plain line, indented to the Disclosure labels (4px pad + 16px caret + 8px gap).
  if (lines.length === 0) return <li className="field-manual-section__empty-group"><span className="field-manual-section__empty-label">{label} (0)</span></li>;
  return (
    <li>
      <Disclosure label={label} count={lines.length} open={open} onOpenChange={setOpen}>
        <ul className="field-manual-section__lines">
          {lines.map((l, i) => (
            <li key={`${i}-${l}`} className="field-manual-section__line">
              {l}
            </li>
          ))}
        </ul>
      </Disclosure>
    </li>
  );
}

/** Arsenal-import spec §5 drift: where the vault and Raven disagree. */
function DriftReport({ drift: d }: { drift: Drift }) {
  return (
    <div className="field-manual-section__drift">
      <h3 className="field-manual-section__drift-title">Drift</h3>
      <ul className="field-manual-section__drift-groups">
        <Lines label="Playbook items with no Raven step" lines={d.noStep.map((i) => `${i.file.split("/").pop()}: ${i.text}`)} />
        <Lines label="Steps whose playbook item is gone or reworded" lines={d.reworded.map((x) => `${x.goalId}: ${x.text}`)} />
        <Lines label="Raven-only steps" lines={d.ravenOnlySteps} />
        <Lines
          label="Placeholders Raven can't fill"
          lines={d.unfillable.map((u) => `{${u.token}} ×${u.count}${u.manual ? " (fine: you type these)" : ""}`)}
        />
        <Lines label="Raven-only commands (in no card)" lines={d.ravenOnlyCommands} />
        <Lines label="Toolkit files no card mentions" lines={d.toolkitUnused} />
      </ul>
    </div>
  );
}
