import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entityOfTable, FOREIGN_KEYS, type ForeignKey } from "../../engines/staleness";

const MIGRATIONS = join(__dirname, "..", "..", "..", "src-tauri", "migrations");

/** Splits on commas outside parentheses: a table body's column and constraint definitions. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")") depth--;
    else if (body[i] === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out.map((d) => d.trim()).filter(Boolean);
}

const COLUMN_FK = /^(\w+)\s[^]*?\bREFERENCES\s+(\w+)\s*\(\s*\w+\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?/i;
const TABLE_FK = /^(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY\s*\(\s*(\w+)\s*\)\s*REFERENCES\s+(\w+)\s*\(\s*\w+\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?/i;

function foreignKeyOf(table: string, def: string): ForeignKey | null {
  const m = TABLE_FK.exec(def) ?? COLUMN_FK.exec(def);
  if (!m) return null;
  const action = (m[3] ?? "NO ACTION").replace(/\s+/g, " ").toLowerCase();
  return { table, column: m[1].toLowerCase(), references: m[2].toLowerCase(), onDelete: action as ForeignKey["onDelete"] };
}

/**
 * The foreign keys the migrations leave, replayed in order: CREATE TABLE, ALTER TABLE … ADD COLUMN, DROP TABLE and
 * ALTER TABLE … RENAME TO (a table rebuild).
 */
function schemaForeignKeys(): ForeignKey[] {
  const tables = new Map<string, ForeignKey[]>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8").replace(/--.*$/gm, "");
    for (const raw of sql.split(";")) {
      const stmt = raw.trim().replace(/\s+/g, " ");
      let m: RegExpExecArray | null;
      if ((m = /^CREATE TABLE (?:IF NOT EXISTS )?(\w+) ?\(([^]*)\)$/i.exec(stmt))) {
        const table = m[1].toLowerCase();
        tables.set(table, splitTopLevel(m[2]).flatMap((d) => foreignKeyOf(table, d) ?? []));
      } else if ((m = /^ALTER TABLE (\w+) ADD (?:COLUMN )?([^]*)$/i.exec(stmt))) {
        const table = m[1].toLowerCase();
        const key = foreignKeyOf(table, m[2]);
        if (key) tables.set(table, [...(tables.get(table) ?? []), key]);
      } else if ((m = /^ALTER TABLE (\w+) RENAME TO (\w+)$/i.exec(stmt))) {
        const [from, to] = [m[1].toLowerCase(), m[2].toLowerCase()];
        tables.set(to, (tables.get(from) ?? []).map((k) => ({ ...k, table: to })));
        tables.delete(from);
      } else if ((m = /^DROP TABLE (?:IF EXISTS )?(\w+)$/i.exec(stmt))) {
        tables.delete(m[1].toLowerCase());
      }
    }
  }
  return [...tables.values()].flat();
}

const id = (k: ForeignKey) => `${k.table}.${k.column} -> ${k.references} on delete ${k.onDelete}`;

describe("the staleness map mirrors the schema", () => {
  const schema = schemaForeignKeys();

  it("reads the migrations' foreign keys", () => {
    // A parse that finds nothing would pass the checks below vacuously.
    expect(schema.length).toBeGreaterThan(50);
    expect(schema.map(id)).toContain("services.host_id -> hosts on delete cascade");
    expect(schema.map(id)).toContain("engagements.msf_host_id -> hosts on delete set null");
  });

  it("has every foreign key of the schema, with its ON DELETE", () => {
    const mapped = new Set(FOREIGN_KEYS.map(id));
    expect(schema.map(id).filter((k) => !mapped.has(k))).toEqual([]);
  });

  it("has no foreign key the schema lacks", () => {
    const real = new Set(schema.map(id));
    expect(FOREIGN_KEYS.map(id).filter((k) => !real.has(k))).toEqual([]);
  });

  it("knows the entity of every table a foreign key joins", () => {
    const tables = [...new Set(schema.flatMap((k) => [k.table, k.references]))];
    expect(tables.filter((t) => entityOfTable(t) === undefined)).toEqual([]);
  });
});
