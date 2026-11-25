// Runs every store scenario beside this file on the in-browser fake. `src-tauri/tests/store_scenarios.rs` runs the
// same files on the real store; both must pass. The format is in README.md here.
import { afterEach, describe, expect, it } from "vitest";
import { api, resetAuditState, setAuditScenario } from "../../audit/fakeApi";
import { EMPTY_FIXTURES } from "../../audit/fixtures";
import { isAppError, RavenError } from "../../types/errors";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface Step {
  do: string;
  args?: Json[];
  expect?: Json;
  ordered?: boolean;
  error?: { [k: string]: Json };
  as?: string;
  bind?: Record<string, string>;
}

interface Scenario {
  name: string;
  steps: Step[];
}

const files = import.meta.glob<Scenario>("./*.json", { eager: true, import: "default" });

/** Replaces every `"$name"` string, and every `"$name"` object key (for maps keyed by id), with the value bound to `name`. */
function resolve(v: Json, refs: Map<string, Json>, at: string): Json {
  if (typeof v === "string" && v.startsWith("$")) {
    if (!refs.has(v.slice(1))) throw new Error(`${at}: \`${v}\` is not bound by an earlier step`);
    return refs.get(v.slice(1))!;
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, refs, at));
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [resolveKey(k, refs, at), resolve(x, refs, at)]));
  }
  return v;
}

function resolveKey(k: string, refs: Map<string, Json>, at: string): string {
  if (!k.startsWith("$")) return k;
  const v = resolve(k, refs, at);
  if (typeof v !== "string") throw new Error(`${at}: the key \`${k}\` is bound to ${JSON.stringify(v)}, not a string`);
  return v;
}

/** The same match as the Rust runner: objects name only the fields they check (missing counts as null), arrays match
 *  in any order unless `ordered`, scalars are equal. */
function matches(expected: Json, actual: Json | undefined, ordered = false): boolean {
  const a = actual === undefined ? null : actual;
  if (Array.isArray(expected)) {
    if (!Array.isArray(a) || a.length !== expected.length) return false;
    if (ordered) return expected.every((x, i) => matches(x, a[i]));
    return assign(expected, a, new Array<boolean>(a.length).fill(false));
  }
  if (expected !== null && typeof expected === "object") {
    if (a === null || typeof a !== "object" || Array.isArray(a)) return false;
    return Object.entries(expected).every(([k, x]) => matches(x, a[k]));
  }
  return expected === a;
}

function assign(expected: Json[], actual: Json[], used: boolean[]): boolean {
  if (expected.length === 0) return true;
  const [first, ...rest] = expected;
  for (let i = 0; i < actual.length; i++) {
    if (!used[i] && matches(first!, actual[i])) {
      used[i] = true;
      if (assign(rest, actual, used)) return true;
      used[i] = false;
    }
  }
  return false;
}

function path(v: Json, dotted: string): Json | undefined {
  let at: Json | undefined = v;
  for (const k of dotted.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = Array.isArray(at) ? at[Number(k)] : at[k];
  }
  return at;
}

/** What the store would send over the bridge: plain JSON, with `undefined` fields gone. */
const asJson = (v: unknown): Json => (v === undefined ? null : (JSON.parse(JSON.stringify(v)) as Json));

const show = (v: unknown) => JSON.stringify(v, null, 2);

async function run(s: Scenario): Promise<void> {
  resetAuditState(EMPTY_FIXTURES);
  const refs = new Map<string, Json>();
  const commands = api as unknown as Record<string, ((...a: Json[]) => Promise<unknown>) | undefined>;
  for (const [n, step] of s.steps.entries()) {
    const at = `${s.name}, step ${n} (${step.do})`;
    const fn = commands[step.do];
    if (!fn) throw new Error(`${at}: the fake has no command ${step.do}`);
    const args = resolve(step.args ?? [], refs, at) as Json[];
    const outcome = await fn(...args).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (!outcome.ok) {
      const e = outcome.error;
      // The fake may only throw what the real store can: a RavenError with a code the app knows.
      if (!(e instanceof RavenError) || !isAppError({ code: e.code, message: e.message })) {
        throw new Error(`${at}: threw something the store never would: ${String(e)}`);
      }
      const got = asJson({ code: e.code, message: e.message, field: e.field });
      if (!step.error) throw new Error(`${at}: failed with ${show(got)}`);
      const want = resolve(step.error, refs, at);
      if (!matches(want, got)) throw new Error(`${at}: expected error ${show(want)}, got ${show(got)}`);
      continue;
    }
    const result = asJson(outcome.value);
    if (step.error) throw new Error(`${at}: expected error ${show(step.error)}, got ${show(result)}`);
    if ("expect" in step) {
      const want = resolve(step.expect!, refs, at);
      if (!matches(want, result, step.ordered)) throw new Error(`${at}: result does not match\nexpected: ${show(want)}\nactual:   ${show(result)}`);
    }
    if (step.as) {
      const id = path(result, "id");
      if (id === undefined) throw new Error(`${at}: \`as\` needs a result with an id`);
      refs.set(step.as, id);
    }
    for (const [name, p] of Object.entries(step.bind ?? {})) {
      const got = path(result, p);
      if (got === undefined) throw new Error(`${at}: no \`${p}\` in the result to bind`);
      refs.set(name, got);
    }
  }
}

afterEach(() => setAuditScenario("full"));

describe("store scenarios on the in-browser fake", () => {
  it("finds the scenario files", () => {
    expect(Object.keys(files).length).toBeGreaterThan(0);
  });

  for (const [file, scenario] of Object.entries(files)) {
    it(`${file.slice(2)}: ${scenario.name}`, async () => {
      await run(scenario);
    });
  }
});
