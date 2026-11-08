import { useState } from "react";
import { buildSql, SQL_ENGINES, SQL_EXEC, SQL_STEPS, sqlExecIds, type SqlEngine, type SqlPoint, type SqlValues } from "../../engines/payloads/sql";
import type { BuiltPayload } from "../../engines/payloads/types";
import { copyPlain } from "../../lib/clipboard";
import { reportError } from "../../lib/lockSignal";
import { Button, Input, labelClass, Toggle } from "../../ui";
import type { PayloadFit } from "./usePayloadFit";
import { usePayloadsStore, type PayloadOverride } from "./usePayloadsStore";

const ENGINE_LABEL: Record<SqlEngine, string> = { mssql: "MSSQL", mysql: "MySQL", postgres: "PostgreSQL", oracle: "Oracle", sqlite: "SQLite" };
const POINTS: { id: SqlPoint; label: string }[] = [
  { id: "url-param", label: "URL parameter" },
  { id: "form-field", label: "Form field" },
  { id: "client-session", label: "Client session" },
];
const SHELLS = [
  { id: "ps-b64", label: "PowerShell base64" },
  { id: "nishang-cradle", label: "Nishang cradle" },
  { id: "nc-exe", label: "nc.exe" },
];
type CarryKey = "columns" | "reflected" | "table" | "column";
/** The value each step finds, typed once in that step and carried into every later one. */
const STEP_INPUT: Partial<Record<(typeof SQL_STEPS)[number]["id"], { key: CarryKey; label: string; placeholder: string; numeric?: boolean }>> = {
  "column-count": { key: "columns", label: "Columns", placeholder: "count that worked", numeric: true },
  "reflected-columns": { key: "reflected", label: "Shown column", placeholder: "1", numeric: true },
  tables: { key: "table", label: "Table", placeholder: "users" },
  columns: { key: "column", label: "Column", placeholder: "username,password" },
};
const PRE = "m-0 max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded-sm border border-line bg-bg px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg";

/** buildSql, with its refusals (a step that has no client-session form, a bad name) as a line to show, not a crash. */
function tryBuild(id: string, title: string, engine: SqlEngine, point: SqlPoint, values: SqlValues): { built: BuiltPayload } | { error: string } {
  try {
    return { built: buildSql(id, engine, point, values) };
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).replace(id, title) };
  }
}

/** One step or exec payload: its text with a Copy button, the listener if it calls back, what each part does, notes. */
function SqlPayload({ title, result, armed, onCopy }: {
  title: string; result: ReturnType<typeof tryBuild>; armed: boolean; onCopy: (b: BuiltPayload) => void;
}) {
  if ("error" in result) return <p className="m-0 text-xs text-muted">Skip here: {result.error}.</p>;
  const b = result.built;
  return (
    <div className="grid gap-1.5">
      {b.listener && <pre aria-label={`${title} listener`} className={PRE}>{b.listener}</pre>}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <pre aria-label={`${title} payload`} className={PRE}>{b.text}</pre>
        <Button size="sm" aria-label={`Copy ${title}`} onClick={() => onCopy(b)}>Copy</Button>
      </div>
      {armed && <p role="status" className="m-0 text-xs text-warn">{b.unresolved.map((u) => `{${u}}`).join(" ")} not filled · Copy again to copy anyway</p>}
      {b.parts.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-default text-muted">What each part does</summary>
          <dl className="m-0 mt-1 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
            {b.parts.map((p) => (
              <div key={p.token} className="contents">
                <dt className="break-all font-mono text-fg">{p.token}</dt>
                <dd className="m-0 text-muted">{p.explain}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {b.notes.map((n) => <p key={n} className="m-0 text-xs text-muted">{n}</p>)}
    </div>
  );
}

/**
 * SQL injection (drawer and Workbench): the engine (inferred from the host's database port, overridable), where you
 * inject, then the ten steps in order. Each step builds from what earlier steps found (column count, shown column,
 * table, column), typed once in the step that finds it. The engine's exec payloads follow. Choices stick per host.
 */
export function SqlPanel({ fit }: { fit: PayloadFit }) {
  const ov = usePayloadsStore((s) => s.overrides[fit.hostKey]);
  const set = (patch: PayloadOverride) => usePayloadsStore.getState().override(fit.hostKey, patch);
  const engine: SqlEngine = fit.dbEngine ?? "mysql";
  const point: SqlPoint = ov?.sqlPoint ?? "url-param";
  const values: SqlValues = ov?.sqlValues ?? {};
  const setValues = (patch: SqlValues) => set({ sqlValues: { ...values, ...patch } });
  const [armed, setArmed] = useState<string | null>(null);
  const [status, setStatus] = useState<string>();

  const copy = (key: string, b: BuiltPayload) => {
    if (b.unresolved.length > 0 && armed !== key) {
      setArmed(key);
      return;
    }
    setArmed(null);
    setStatus(undefined);
    copyPlain(b.text).then(() => setStatus(`Copied: ${b.def.title}`), (e: unknown) => {
      reportError(e);
      setStatus(e instanceof Error ? e.message : String(e));
    });
  };
  const carry = (key: CarryKey, numeric: boolean | undefined, raw: string) => {
    if (!numeric) return setValues({ [key]: raw });
    const digits = raw.replace(/\D/g, "");
    setValues({ [key]: digits ? Number(digits) : undefined });
  };
  const execValues: SqlValues = { ...values, table: undefined, LHOST: fit.lhost, LPORT: fit.port };
  const execIds = sqlExecIds(engine);

  return (
    <section aria-label="SQL injection" className="grid content-start gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <span className={labelClass}>Engine</span>
        <div className="grid grid-cols-[repeat(5,auto)] justify-start gap-1">
          {SQL_ENGINES.map((e) => (
            <Toggle key={e} on={e === engine} onChange={() => set({ sqlEngine: e })}>{ENGINE_LABEL[e]}</Toggle>
          ))}
        </div>
        <span />
        {fit.evidence.dbEngine ? (
          <span className="text-xs text-muted">{fit.evidence.dbEngine}</span>
        ) : (
          <span className="text-xs text-warn">Not known from the host's ports: showing MySQL; pick one</span>
        )}
        <span className={labelClass}>Inject into</span>
        <div className="grid grid-cols-[repeat(3,auto)] justify-start gap-1">
          {POINTS.map((p) => (
            <Toggle key={p.id} on={p.id === point} onChange={() => set({ sqlPoint: p.id })}>{p.label}</Toggle>
          ))}
        </div>
        {point !== "client-session" && (
          <>
            <span className={labelClass}>Break</span>
            <label className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
              <Input mono aria-label="Break" className="h-7" value={values.prefix ?? "'"} onChange={(e) => setValues({ prefix: e.target.value })} />
              <span className="text-xs text-muted">' for a string; empty for a number</span>
            </label>
          </>
        )}
      </div>

      <ol aria-label="SQL steps" className="m-0 grid list-none gap-4 p-0">
        {SQL_STEPS.map((step, i) => {
          const input = STEP_INPUT[step.id];
          return (
            <li key={step.id} className="grid gap-1.5 border-t border-line pt-3">
              <h3 className="m-0 text-[13px] font-semibold text-fg">{i + 1}. {step.title}</h3>
              <p className="m-0 text-xs text-muted">{step.explain}</p>
              <SqlPayload title={step.title} result={tryBuild(step.id, step.title, engine, point, values)} armed={armed === step.id} onCopy={(b) => copy(step.id, b)} />
              {input && (
                <label className="grid grid-cols-[auto_minmax(0,14rem)] items-center gap-2">
                  <span className="text-xs text-fg-2">{input.label} found</span>
                  <Input
                    mono aria-label={input.label} className="h-7" placeholder={input.placeholder}
                    inputMode={input.numeric ? "numeric" : undefined}
                    value={values[input.key] === undefined ? "" : String(values[input.key])}
                    onChange={(e) => carry(input.key, input.numeric, e.target.value)}
                  />
                </label>
              )}
            </li>
          );
        })}
      </ol>

      <section aria-label={`Run commands (${ENGINE_LABEL[engine]})`} className="grid gap-3 border-t border-line-2 pt-3">
        <h3 className={`${labelClass} m-0`}>Run commands · {ENGINE_LABEL[engine]}</h3>
        {(engine === "mysql" || engine === "mssql") && (
          <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
            <span className="text-xs text-fg-2">File path</span>
            <Input mono aria-label="File path" className="h-7" value={values.path ?? ""} placeholder={engine === "mysql" ? "/var/www/html/zz.php" : "C:\\Windows\\win.ini"} onChange={(e) => setValues({ path: e.target.value })} />
          </label>
        )}
        {engine === "mssql" && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
            <span className="text-xs text-fg-2">Shell</span>
            <div className="grid grid-cols-[repeat(3,auto)] justify-start gap-1">
              {SHELLS.map((s) => (
                <Toggle key={s.id} on={(values.shell ?? "ps-b64") === s.id} onChange={() => setValues({ shell: s.id })}>{s.label}</Toggle>
              ))}
            </div>
          </div>
        )}
        {execIds.length === 0 ? (
          <p className="m-0 text-xs text-muted">No OS command or file payloads for {ENGINE_LABEL[engine]} here.</p>
        ) : (
          <ul aria-label="Run commands" className="m-0 grid list-none gap-4 p-0">
            {execIds.map((id) => {
              const x = SQL_EXEC.find((e) => e.id === id)!;
              return (
                <li key={id} className="grid gap-1.5">
                  <h4 className="m-0 text-[13px] font-semibold text-fg">{x.title}</h4>
                  <SqlPayload title={x.title} result={tryBuild(id, x.title, engine, point, execValues)} armed={armed === id} onCopy={(b) => copy(id, b)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {status && <p role="status" className="m-0 text-xs text-muted">{status}</p>}
    </section>
  );
}
