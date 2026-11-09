import type { PayloadPart } from "./types";

/**
 * Teaching text for every SQL element the generator can emit. buildSql scans its statement's skeleton
 * (string literals blanked) for these, in order of appearance, so a keyword can never appear in a payload
 * without an explanation, and data (a command, base64, a path) never adds one.
 * The optional 4th entry replaces the explanation in a client session, where nothing is injected or stacked.
 */
const KW: [RegExp, string, string, string?][] = [
  [/UNION/, "UNION", "UNION glues your SELECT onto the app's own query. It only works if both SELECTs have the same number of columns and compatible types in each position, which is why you count columns first."],
  [/SELECT/, "SELECT", "SELECT reads values. After UNION it is your query, whose rows are shown in place of (or after) the app's rows."],
  [/NULL/, "NULL", "NULL fits any column type, so it is the safe filler for columns you are not using. A string in an int column is a type error; NULL never is."],
  [/ORDER BY \d/, "ORDER BY", "ORDER BY n sorts by column n. If the query has fewer than n columns it errors, so the largest n that still works is the column count."],
  [/AND 1=1/, "AND 1=1", "AND 1=1 is always true: the page must look exactly like the normal one. Then send AND 1=2 (always false): if the page changes, your SQL is running."],
  [/AND 1=2/, "AND 1=2", "AND 1=2 is always false, so the app's own row disappears and only your UNION row is left to show."],
  [/WAITFOR DELAY/, "WAITFOR DELAY", "MSSQL: pause for h:m:s ('0:0:5' = 5 seconds). A slow response proves the injection and tells you it is MSSQL. Needs a stacked query (the leading ;).", "MSSQL: pause for h:m:s ('0:0:5' = 5 seconds)."],
  [/SLEEP\(/, "SLEEP", "MySQL: sleep for 5 seconds. AND SLEEP(5) delays only when the row matches, so test on a value that exists.", "MySQL: sleep for 5 seconds."],
  [/pg_sleep/, "pg_sleep", "PostgreSQL: sleep for 5 seconds. Selected FROM so it can sit inside a WHERE-style condition.", "PostgreSQL: sleep for 5 seconds."],
  [/dbms_pipe\.receive_message/, "dbms_pipe.receive_message", "Oracle: waits up to 5 seconds for a message on pipe 'a' that never comes, which is Oracle's sleep."],
  [/RANDOMBLOB/, "RANDOMBLOB", "SQLite has no sleep. Building 300 million random bytes and hashing them takes seconds, so it is the delay."],
  [/\bLIKE\(/, "LIKE", "LIKE(pattern, text) forces SQLite to scan the huge generated value."],
  [/UPPER\(/, "UPPER", "UPPER makes SQLite process the whole generated string."],
  [/HEX\(/, "HEX", "HEX turns the random bytes into a very long string."],
  [/FROM DUAL/, "FROM DUAL", "MySQL 5.7 rejects a WHERE without a FROM; DUAL is the dummy table that makes SELECT 1 WHERE 1=1 valid (8.0 accepts it either way)."],
  [/FROM dual/, "FROM dual", "Oracle insists every SELECT has a FROM. dual is its built-in one-row dummy table."],
  [/FROM PROGRAM/, "FROM PROGRAM", "PostgreSQL: COPY reads its rows from the output of an OS command instead of a file."],
  [/\bFROM\b(?! dual| DUAL| PROGRAM)/, "FROM", "FROM names the table or view to read."],
  [/\bWHERE\b/, "WHERE", "WHERE keeps only matching rows (here: the one schema, table or type you named)."],
  [/information_schema/, "information_schema", "A standard catalogue every MySQL, MSSQL and PostgreSQL server has. It lists the database's own tables and columns, which is how you map an unfamiliar schema."],
  [/sys\.databases/, "sys.databases", "MSSQL catalogue of every database on the server."],
  [/pg_database/, "pg_database", "PostgreSQL catalogue of every database."],
  [/all_users/, "all_users", "Oracle: users are schemas, so this lists them."],
  [/all_tables/, "all_tables", "Oracle catalogue of tables you can see (no information_schema on Oracle)."],
  [/all_tab_columns/, "all_tab_columns", "Oracle catalogue of columns. Oracle stores names in UPPER CASE."],
  [/sqlite_master/, "sqlite_master", "SQLite's one catalogue table: type='table' rows are tables, and its sql column holds the CREATE statement (column names)."],
  [/pragma_database_list/, "pragma_database_list", "SQLite: lists attached databases (usually just main)."],
  [/GROUP_CONCAT/, "GROUP_CONCAT", "Squeezes many rows into one string so a page that shows a single row shows them all. MySQL cuts the result at 1024 characters by default."],
  [/string_agg/, "string_agg", "PostgreSQL: joins every row into one string (9.0+), so a page that shows a single row shows them all."],
  [/::text/, "::text", "PostgreSQL: cast to text so string_agg gets a plain string whatever the catalogue column type."],
  [/LISTAGG/, "LISTAGG", "Oracle (11gR2+): joins every row into one string, so a page that shows a single row shows them all. Errors (ORA-01489) past 4000 characters."],
  [/WITHIN GROUP \(ORDER BY/, "WITHIN GROUP (ORDER BY", "Oracle requires LISTAGG to say in which order it joins the rows."],
  [/owner=USER/, "owner=USER", "Oracle: USER is the connected account, so this keeps the tables of its own schema (the app's, usually)."],
  [/FOR XML PATH/, "FOR XML PATH", "MSSQL: FOR XML PATH('') glues a subquery's rows into one string. Works on 2005 and later; STRING_AGG needs 2017+."],
  [/SEPARATOR/, "SEPARATOR", "The text put between the rows GROUP_CONCAT joins."],
  [/\bCONCAT\(/, "CONCAT", "MySQL joins strings with CONCAT(a,':',b); + would do arithmetic."],
  [/\|\|/, "||", "PostgreSQL, Oracle and SQLite join strings with ||."],
  [/@@version/, "@@version", "System variable holding the server version string."],
  [/\bversion\(\)/, "version()", "PostgreSQL function returning the server version."],
  [/sqlite_version\(\)/, "sqlite_version()", "SQLite function returning its version."],
  [/\bbanner\b/, "banner", "Oracle: the banner column of v$version holds the full version text."],
  [/v\$version/, "v$version", "Oracle view with the version banner."],
  [/database\(\)/, "database()", "MySQL function returning the current database name."],
  [/\bAS\b/, "AS", "AS gives the OPENROWSET result an alias; MSSQL requires one."],
  [/\bEXEC\b/, "EXEC", "MSSQL: runs a stored procedure. After the ; it is a new statement, which needs stacked queries.", "MSSQL: runs a stored procedure."],
  [/sp_configure/, "sp_configure", "Changes a server setting. 'show advanced options' must be on before 'xp_cmdshell' becomes visible."],
  [/RECONFIGURE/, "RECONFIGURE", "Applies the sp_configure change now. Needed after each change."],
  [/xp_cmdshell/, "xp_cmdshell", "MSSQL: runs a Windows command as the SQL Server service account. Needs sysadmin, and the setting enabled."],
  [/CREATE TABLE/, "CREATE TABLE", "CREATE TABLE IF NOT EXISTS makes the output table on the first run and is harmless on later runs. COPY needs a table with a text column to load into."],
  [/\bCOPY\b/, "COPY", "PostgreSQL: loads rows into a table. The table must exist and have a text column."],
  [/INTO OUTFILE/, "INTO OUTFILE", "MySQL: writes the query result to a file on the DB server. Never overwrites, needs the FILE privilege and an empty secure_file_priv."],
  [/LOAD_FILE/, "LOAD_FILE", "MySQL: returns a file's content as text. Needs the FILE privilege."],
  [/OPENROWSET/, "OPENROWSET", "MSSQL: reads external data. With BULK it reads a file from the DB server (needs bulk-admin rights)."],
  [/\bBULK\b/, "BULK", "Tells OPENROWSET to read a file."],
  [/SINGLE_CLOB/, "SINGLE_CLOB", "Return the whole file as one text value."],
  [/BulkColumn/, "BulkColumn", "The fixed column name OPENROWSET(BULK ...) returns."],
  [/-- -/, "-- -", "-- starts a comment: the rest of the app's query (closing quote, other conditions) is ignored. The extra space and - matter: MySQL needs a space after --, and trailing spaces often get trimmed."],
  [/#/, "#", "# is MySQL's other comment marker. In a URL it must be sent as %23 or the browser treats it as a fragment."],
];

/** The statement with every '...' string literal blanked (same length, so positions hold): what the keyword scan reads. */
export function sqlSkeleton(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, (m) => `'${" ".repeat(m.length - 2)}'`);
}

/** Parts for the keywords in `sql` (the statement after the injection break). `session`: a client-session statement. */
export function keywordParts(sql: string, session = false): PayloadPart[] {
  const skeleton = sqlSkeleton(sql);
  const hits: { at: number; part: PayloadPart }[] = [];
  const seen = new Set<string>();
  for (const [re, token, explain, sessionExplain] of KW) {
    const m = re.exec(skeleton);
    if (m && !seen.has(token)) {
      seen.add(token);
      hits.push({ at: m.index, part: { token, explain: session && sessionExplain ? sessionExplain : explain } });
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.part);
}
