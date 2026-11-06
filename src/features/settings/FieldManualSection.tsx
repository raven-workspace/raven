import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import { Button, Field, Input, Panel } from "../../ui";
import { useFieldManual, useImportFieldManual } from "../fieldManual/queries";

/** Settings › Field Manual: where the vault is, import it now, and what the last import did. */
export function FieldManualSection() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const snap = useFieldManual();
  const imp = useImportFieldManual();
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
      qc.setQueryData(["settings"], await api.settingsUpdate({ fieldManualPath: v }));
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
      {error && <p className="m-0 mt-2 text-xs text-warn">{error}</p>}
      {s && (
        <p className="m-0 mt-3 text-xs text-fg-2">
          last: {new Date(s.importedAt).toLocaleString()} · {s.cards.length} cards ·{" "}
          {s.commands.filter((c) => c.source === "field-manual").length} commands
        </p>
      )}
      {r && (
        <ul className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0 text-xs text-muted">
          <li>Cards: {r.cardsAdded} added, {r.cardsChanged} changed, {r.cardsRemoved} gone from the vault</li>
          <li>Commands: {r.commandsAdded} added, {r.commandsChanged} changed</li>
          {r.commandsRemovedKept.length > 0 && (
            <li>{r.commandsRemovedKept.length} built-in commands no longer in the vault (kept)</li>
          )}
          {r.classified.length > 0 && <li>{r.classified.length} given an exam rule</li>}
        </ul>
      )}
    </Panel>
  );
}
