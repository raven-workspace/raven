import { useRef, useState, type KeyboardEvent } from "react";
import { buildSql, SQL_ENGINES, SQL_EXEC, SQL_STEPS, sqlExecIds, type SqlEngine, type SqlPoint, type SqlValues } from "../../engines/payloads/sql";
import type { BuiltPayload } from "../../engines/payloads/types";
import { copyPlain } from "../../lib/clipboard";
import { reportError } from "../../lib/lockSignal";
import { CommandBlock, Disclosure, Input, labelClass, Toggle } from "../../ui";
import type { PayloadFit } from "./usePayloadFit";
import { lhostPlaceholder } from "./usePayloadSession";
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
/** The input each unfilled token lives in, when it lives in this panel (LHOST only with `lhostField`). */
const TOKEN_INPUT: Record<string, string> = { COLUMNS: "columns", TABLE: "table", COLUMN: "column", PATH: "path", LHOST: "lhost" };
/** Exec payloads that embed a reverse shell, so need LHOST. */
const CALLS_BACK = new Set(["mssql-xp_cmdshell", "postgres-copy-program"]);
/** Armed for one exact payload: any change to it (engine, point, values) needs a fresh confirm. */
const armKey = (id: string, b: BuiltPayload) => `${id}|${b.text}`;

/** buildSql, with its refusals (a step that has no client-session form, a bad name) as a line to show, not a crash. */
function tryBuild(id: string, title: string, engine: SqlEngine, point: SqlPoint, values: SqlValues): { built: BuiltPayload } | { error: string } {
  try {
    return { built: buildSql(id, engine, point, values) };
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).replace(id, title) };
  }
}

/** One step or exec payload: its text with a Copy button, the listener if it calls back, what each part does, notes. */
function SqlPayload({ id, title, result, armedKey, onCopy }: {
  id: string; title: string; result: ReturnType<typeof tryBuild>; armedKey: string | null;
  /** "guarded" when an unfilled token held the copy back. */
  onCopy: (b: BuiltPayload) => "copied" | "guarded";
}) {
  const [partsOpen, setPartsOpen] = useState(false);
  if ("error" in result) return <p className="m-0 text-meta text-muted">Skip here: {result.error}.</p>;
  const b = result.built;
  const armed = armedKey === armKey(id, b);
  return (
    <div className="grid gap-2">
      {b.prepare && <CommandBlock text={b.prepare} name={`${title} prepare on Kali`} copyLabel={`Copy ${title} prepare on Kali`} placeholders />}
      {b.listener && <CommandBlock text={b.listener} name={`${title} listener`} copyLabel={`Copy ${title} listener`} placeholders />}
      <CommandBlock text={b.text} name={`${title} payload`} copyLabel={`Copy ${title}`} onCopyAction={() => Promise.resolve(onCopy(b))} placeholders />
      {armed && <p role="status" className="m-0 text-meta text-warn">{b.unresolved.map((u) => `{${u}}`).join(" ")} not filled. Copy again to copy anyway</p>}
      {b.parts.length > 0 && (
        <Disclosure label="What each part does" open={partsOpen} onOpenChange={setPartsOpen}>
          <dl className="m-0 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 px-1 pt-1 text-meta">
            {b.parts.map((p) => (
              <div key={p.token} className="contents">
                <dt className="break-all font-mono text-code text-fg">{p.token}</dt>
                <dd className="m-0 text-muted">{p.explain}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      )}
      {b.notes.map((n) => <p key={n} className="m-0 text-meta text-muted">{n}</p>)}
    </div>
  );
}

/**
 * SQL injection (drawer and Workbench): the engine (inferred from the host's database port, overridable), where you
 * inject, then the ten steps in order. Each step builds from what earlier steps found (column count, shown column,
 * table, column), typed once in the step that finds it. The engine's exec payloads follow. Choices stick per host.
 */
export function SqlPanel({ fit, onFocusToken, lhostField }: {
  fit: PayloadFit;
  /** Focus the field for a token this panel has no input for (LHOST, LPORT): the view's own. */
  onFocusToken?: (token: string) => void;
  /** Show an LHOST field above the run commands that call back (the drawer; the Workbench has one on the left). */
  lhostField?: boolean;
}) {
  const ov = usePayloadsStore((s) => s.overrides[fit.hostKey]);
  const set = (patch: PayloadOverride) => usePayloadsStore.getState().override(fit.hostKey, patch);
  const engine: SqlEngine = fit.dbEngine ?? "mysql";
  const point: SqlPoint = ov?.sqlPoint ?? "url-param";
  const values: SqlValues = ov?.sqlValues ?? {};
  const setValues = (patch: SqlValues) => set({ sqlValues: { ...values, ...patch } });
  const [armed, setArmed] = useState<string | null>(null);
  const [status, setStatus] = useState<string>();

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const setInput = (key: string, el: HTMLInputElement | null) => {
    if (el) inputs.current.set(key, el);
    else inputs.current.delete(key);
  };
  /** Copies; an unfilled token first jumps to its field and arms, and a second copy of the same payload goes through. */
  const copy = (id: string, b: BuiltPayload): "copied" | "guarded" => {
    const key = armKey(id, b);
    if (b.unresolved.length > 0 && armed !== key) {
      setArmed(key);
      const t = b.unresolved[0]!;
      const el = TOKEN_INPUT[t] ? inputs.current.get(TOKEN_INPUT[t]) : undefined;
      if (el) el.focus();
      else onFocusToken?.(t);
      return "guarded";
    }
    setArmed(null);
    setStatus(undefined);
    copyPlain(b.text).then(() => setStatus(`Copied: ${b.def.title}`), (e: unknown) => {
      reportError(e);
      setStatus(e instanceof Error ? e.message : String(e));
    });
    return "copied";
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
          <span className="text-meta text-muted">{fit.evidence.dbEngine}</span>
        ) : (
          <span className="text-meta text-warn">Not known from the host's ports: showing MySQL; pick one</span>
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
              <Input mono aria-label="Break" value={values.prefix ?? "'"} onChange={(e) => setValues({ prefix: e.target.value })} />
              <span className="text-meta text-muted">' for a string; empty for a number</span>
            </label>
          </>
        )}
      </div>

      <ol aria-label="SQL steps" className="m-0 grid list-none gap-4 p-0">
        {SQL_STEPS.map((step, i) => {
          const input = STEP_INPUT[step.id];
          const result = tryBuild(step.id, step.title, engine, point, values);
          // ↵ in the step's own field copies the step.
          const onKey = (e: KeyboardEvent<HTMLLIElement>) => {
            if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
            if (!(e.target instanceof HTMLInputElement) || !("built" in result)) return;
            e.preventDefault();
            copy(step.id, result.built);
          };
          return (
            <li key={step.id} onKeyDown={onKey} className="grid gap-2 border-t border-line pt-3">
              <h3 className="m-0 text-heading text-fg">{i + 1}. {step.title}</h3>
              <p className="m-0 text-meta text-muted">{step.explain}</p>
              <SqlPayload id={step.id} title={step.title} result={result} armedKey={armed} onCopy={(b) => copy(step.id, b)} />
              {input && (
                <label className="grid grid-cols-[max-content_minmax(0,14rem)] items-center gap-2">
                  <span className="text-meta text-fg-2">{input.label} found</span>
                  <Input
                    mono aria-label={input.label} placeholder={input.placeholder} ref={(el) => setInput(input.key, el)}
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
        <h3 className={`${labelClass} m-0`}>Run commands for {ENGINE_LABEL[engine]}</h3>
        {lhostField && !values.cmd && execIds.some((id) => CALLS_BACK.has(id)) && (
          <label className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-2">
            <span className="font-mono text-code text-fg-2">LHOST</span>
            <Input
              mono aria-label="LHOST" ref={(el) => setInput("lhost", el)} value={fit.lhostInput} placeholder={lhostPlaceholder(fit.settingsLhost)}
              onChange={(e) => usePayloadsStore.getState().setLhost(e.target.value)}
            />
          </label>
        )}
        {(engine === "mysql" || engine === "mssql") && (
          <label className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-2">
            <span className="text-meta text-fg-2">File path</span>
            <Input mono aria-label="File path" ref={(el) => setInput("path", el)} value={values.path ?? ""} placeholder={engine === "mysql" ? "/var/www/html/zz.php" : "C:\\Windows\\win.ini"} onChange={(e) => setValues({ path: e.target.value })} />
          </label>
        )}
        {engine === "mssql" && (
          <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-2">
            <span className="text-meta text-fg-2">Shell</span>
            <div className="grid grid-cols-[repeat(3,auto)] justify-start gap-1">
              {SHELLS.map((s) => (
                <Toggle key={s.id} on={(values.shell ?? "ps-b64") === s.id} onChange={() => setValues({ shell: s.id })}>{s.label}</Toggle>
              ))}
            </div>
          </div>
        )}
        {execIds.length === 0 ? (
          <p className="m-0 text-meta text-muted">No OS command or file payloads for {ENGINE_LABEL[engine]} here.</p>
        ) : (
          <ul aria-label="Run commands" className="m-0 grid list-none gap-4 p-0">
            {execIds.map((id) => {
              const x = SQL_EXEC.find((e) => e.id === id)!;
              return (
                <li key={id} className="grid gap-2">
                  <h4 className="m-0 text-heading text-fg">{x.title}</h4>
                  <SqlPayload id={id} title={x.title} result={tryBuild(id, x.title, engine, point, execValues)} armedKey={armed} onCopy={(b) => copy(id, b)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {status && <p role="status" className="m-0 text-meta text-muted">{status}</p>}
    </section>
  );
}
