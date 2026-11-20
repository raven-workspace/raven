import { useState } from "react";
import { parseCvssAny, scoreCvss, type CvssVersion } from "../../engines/findings/cvss4";
import { scoreToSeverity } from "../../engines/findings/cvss";
import { labelClass } from "../../ui";
import "./CvssBuilder.scss";

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
    if (next === version) return;
    // Keep only the picks that mean the same thing in the other version.
    const kept: Record<string, string> = {};
    for (const m of baseOf(next)) {
      const v = picks[m.key];
      if (v !== undefined && m.options.some(([o]) => o === v)) kept[m.key] = v;
    }
    setVersion(next);
    setPicks(kept);
    // 3.0 to 3.1 keeps every metric, so a complete vector is rewritten with the new prefix.
    const vector = buildVector(next, kept);
    if (vector !== null && vector !== value.trim()) onChange(vector);
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
    <div className="cvss-builder">
      <div className="cvss-builder__top">
        <div role="group" aria-label="CVSS version" className="cvss-builder__segments">
          {/* A stored 3.0 vector keeps its version, shown as its own pressed segment; 3.1 stays one click away. */}
          {(version === "3.0" ? (["4.0", "3.1", "3.0"] as const) : (["4.0", "3.1"] as const)).map((v) => {
            const on = v === version;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                aria-disabled={v === "3.0" ? true : undefined}
                title={v === "3.0" ? "Stored as CVSS 3.0" : undefined}
                onClick={() => (v === "3.0" ? undefined : switchTo(v))}
                className="cvss-builder__segment"
              >
                CVSS {v}
              </button>
            );
          })}
        </div>
        <output aria-label="CVSS score" className="cvss-builder__score">
          {score !== null ? (
            <>
              <span className="cvss-builder__score-value">{score.toFixed(1)}</span> {scoreToSeverity(score)}
            </>
          ) : (
            `${picked} of ${base.length} picked`
          )}
        </output>
      </div>
      {groupsFor(version).map((g) => (
        <section key={g.heading} aria-label={g.heading} className="cvss-builder__group">
          <h4 className={labelClass}>{g.heading}</h4>
          {g.metrics.map((m) => (
            <div
              key={m.key}
              role="group"
              aria-label={`${m.name} (${m.key})`}
              className="cvss-builder__metric"
            >
              <span className="cvss-builder__metric-name">
                <span className="cvss-builder__metric-key">{m.key}</span> {m.name}
              </span>
              <div className="cvss-builder__segments">
                {m.options.map(([v, label]) => {
                  const on = picks[m.key] === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick(m.key, v)}
                      className="cvss-builder__segment"
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
