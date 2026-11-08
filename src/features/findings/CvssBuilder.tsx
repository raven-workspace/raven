import { useState } from "react";
import { parseCvssAny, scoreCvss, type CvssVersion } from "../../engines/findings/cvss4";
import { scoreToSeverity } from "../../engines/findings/cvss";
import { cx } from "../../lib/cx";
import { labelClass } from "../../ui";

interface MetricDef {
  key: string;
  name: string;
  options: [value: string, label: string][];
}

const HLN: MetricDef["options"] = [["H", "High"], ["L", "Low"], ["N", "None"]];

const V31: { heading: string; metrics: MetricDef[] }[] = [
  {
    heading: "Exploitability",
    metrics: [
      { key: "AV", name: "Attack Vector", options: [["N", "Network"], ["A", "Adjacent"], ["L", "Local"], ["P", "Physical"]] },
      { key: "AC", name: "Attack Complexity", options: [["L", "Low"], ["H", "High"]] },
      { key: "PR", name: "Privileges Required", options: [["N", "None"], ["L", "Low"], ["H", "High"]] },
      { key: "UI", name: "User Interaction", options: [["N", "None"], ["R", "Required"]] },
      { key: "S", name: "Scope", options: [["U", "Unchanged"], ["C", "Changed"]] },
    ],
  },
  {
    heading: "Impact",
    metrics: [
      { key: "C", name: "Confidentiality", options: HLN },
      { key: "I", name: "Integrity", options: HLN },
      { key: "A", name: "Availability", options: HLN },
    ],
  },
];

const V40: { heading: string; metrics: MetricDef[] }[] = [
  {
    heading: "Exploitability",
    metrics: [
      { key: "AV", name: "Attack Vector", options: [["N", "Network"], ["A", "Adjacent"], ["L", "Local"], ["P", "Physical"]] },
      { key: "AC", name: "Attack Complexity", options: [["L", "Low"], ["H", "High"]] },
      { key: "AT", name: "Attack Requirements", options: [["N", "None"], ["P", "Present"]] },
      { key: "PR", name: "Privileges Required", options: [["N", "None"], ["L", "Low"], ["H", "High"]] },
      { key: "UI", name: "User Interaction", options: [["N", "None"], ["P", "Passive"], ["A", "Active"]] },
    ],
  },
  {
    heading: "Vulnerable system",
    metrics: [
      { key: "VC", name: "Confidentiality", options: HLN },
      { key: "VI", name: "Integrity", options: HLN },
      { key: "VA", name: "Availability", options: HLN },
    ],
  },
  {
    heading: "Subsequent system",
    metrics: [
      { key: "SC", name: "Confidentiality", options: HLN },
      { key: "SI", name: "Integrity", options: HLN },
      { key: "SA", name: "Availability", options: HLN },
    ],
  },
];

const groupsFor = (v: CvssVersion) => (v === "4.0" ? V40 : V31);
const baseOf = (v: CvssVersion) => groupsFor(v).flatMap((g) => g.metrics);

/** The vector for `picks`, or null until every base metric is picked. Extra 4.0 metrics (threat,
 *  environmental, supplemental) read from the current value are kept after the base ones. */
function buildVector(version: CvssVersion, picks: Record<string, string>): string | null {
  const base = baseOf(version);
  if (!base.every((m) => picks[m.key] !== undefined)) return null;
  const baseKeys = new Set(base.map((m) => m.key));
  const extras = version === "4.0" ? Object.keys(picks).filter((k) => !baseKeys.has(k)) : [];
  return [`CVSS:${version}`, ...base.map((m) => `${m.key}:${picks[m.key]}`), ...extras.map((k) => `${k}:${picks[k]}`)].join("/");
}

const segment =
  "inline-grid h-7 items-center rounded-sm border px-2 text-meta cursor-default " +
  "transition-colors duration-150 ease-out motion-reduce:transition-none";
const segmentOn = "border-accent text-accent";
const segmentOff = "border-line-2 text-fg-2 hover:border-line-strong hover:text-fg";

/**
 * A compact CVSS base-metric picker for findings with no CVE, or when NVD can't be reached.
 * One segmented control per base metric; 3.1 or 4.0 (default 4.0). Writes the vector once every metric is picked.
 */
export function CvssBuilder({ value, onChange }: { value: string; onChange(vector: string): void }) {
  const initial = parseCvssAny(value);
  const [seen, setSeen] = useState(value);
  const [version, setVersion] = useState<CvssVersion>(initial?.version ?? "4.0");
  const [picks, setPicks] = useState<Record<string, string>>(initial?.metrics ?? {});

  // A vector typed or filled elsewhere becomes the picks (derived during render, not in an effect).
  if (value !== seen) {
    setSeen(value);
    const parsed = parseCvssAny(value);
    if (parsed) {
      setVersion(parsed.version);
      setPicks(parsed.metrics);
    } else if (value.trim() === "") {
      // A cleared vector clears the picks, so no stale score shows and no old vector comes back.
      setPicks({});
    }
  }

  const switchTo = (next: "3.1" | "4.0") => {
    if (next === version || (next === "3.1" && version === "3.0")) return;
    // Keep only the picks that mean the same thing in the other version.
    const kept: Record<string, string> = {};
    for (const m of baseOf(next)) {
      const v = picks[m.key];
      if (v !== undefined && m.options.some(([o]) => o === v)) kept[m.key] = v;
    }
    setVersion(next);
    setPicks(kept);
  };

  const pick = (key: string, v: string) => {
    const next = { ...picks, [key]: v };
    setPicks(next);
    const vector = buildVector(version, next);
    if (vector !== null && vector !== value.trim()) onChange(vector);
  };

  const vector = buildVector(version, picks);
  const score = vector === null ? null : scoreCvss(vector);
  const base = baseOf(version);
  const picked = base.filter((m) => picks[m.key] !== undefined).length;

  return (
    <div className="grid gap-3 rounded-sm border border-line p-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <div role="group" aria-label="CVSS version" className="grid grid-flow-col auto-cols-max gap-1">
          {(["4.0", "3.1"] as const).map((v) => {
            const on = v === "4.0" ? version === "4.0" : version !== "4.0";
            // A stored 3.0 vector keeps its version, and the 3.x button says so.
            const label = v === "3.1" && version === "3.0" ? "3.0" : v;
            return (
              <button key={v} type="button" aria-pressed={on} onClick={() => switchTo(v)} className={cx(segment, on ? segmentOn : segmentOff)}>
                CVSS {label}
              </button>
            );
          })}
        </div>
        <output aria-label="CVSS score" className="justify-self-end font-mono text-meta tabular-nums text-fg-2">
          {score !== null ? (
            <>
              <span className="text-fg">{score.toFixed(1)}</span> {scoreToSeverity(score)}
            </>
          ) : (
            `${picked} of ${base.length} picked`
          )}
        </output>
      </div>
      {groupsFor(version).map((g) => (
        <section key={g.heading} aria-label={g.heading} className="grid gap-2">
          <h4 className={cx(labelClass, "m-0")}>{g.heading}</h4>
          {g.metrics.map((m) => (
            <div
              key={m.key}
              role="group"
              aria-label={`${m.name} (${m.key})`}
              className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-2"
            >
              <span className="text-meta text-fg-2">
                <span className="font-mono text-muted">{m.key}</span> {m.name}
              </span>
              <div className="grid grid-flow-col auto-cols-max gap-1">
                {m.options.map(([v, label]) => {
                  const on = picks[m.key] === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick(m.key, v)}
                      className={cx(segment, on ? segmentOn : segmentOff)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
