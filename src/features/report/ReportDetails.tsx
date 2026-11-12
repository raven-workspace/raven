import { useState } from "react";
import { isValidOsid, type ReportMeta } from "../../engines/report";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { Report, ReportPatch } from "../../types/report";
import { Field, Input, labelClass } from "../../ui";
import { fromDateTimeInput, toDateTimeInput } from "../engagements/format";

/**
 * The "Report details" page: the cover's facts, in an Ink form (not paper). Each field saves on blur. Local state is
 * seeded once and never re-synced, so a save's refetch can't discard typing in another field.
 */
export function ReportDetails({
  report,
  engagement,
  hosts,
  includedHostIds,
  onSave,
}: {
  report: Report;
  engagement: Engagement;
  hosts: Host[];
  /** The lab hosts in the report now (the stored pick, or the default: hosts with a flag). */
  includedHostIds: string[];
  onSave(patch: ReportPatch): void;
}) {
  const meta = report.meta as ReportMeta;
  const [name, setName] = useState(report.candidateName);
  const [email, setEmail] = useState(report.email);
  const [osid, setOsid] = useState(report.osid);
  const [title, setTitle] = useState(report.title);
  const [examDate, setExamDate] = useState(meta.examDate ?? "");
  const [reportDate, setReportDate] = useState(meta.reportDate ?? "");
  const [examEnd, setExamEnd] = useState(toDateTimeInput(meta.examEndAt ?? null));
  const lab = engagement.kind === "lab";
  const osidTrimmed = osid.trim();

  const saveText = (key: "candidateName" | "email" | "osid" | "title", value: string) => {
    const v = value.trim();
    if (v !== report[key] && !(key === "title" && v === "")) onSave({ [key]: v });
  };
  const saveMeta = (patch: Partial<ReportMeta>) => onSave({ meta: { ...report.meta, ...patch } });
  const toggleHost = (id: string, on: boolean) => {
    const next = on ? [...includedHostIds, id] : includedHostIds.filter((x) => x !== id);
    saveMeta({ includedHostIds: hosts.map((h) => h.id).filter((h) => next.includes(h)) });
  };

  return (
    <section aria-label="Report details" className="grid content-start gap-6 px-6 py-6">
      <h2 className="m-0 text-title text-fg">Report details</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
        <Field label="Your name">
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => saveText("candidateName", name)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => saveText("email", email)} />
        </Field>
        <Field label="OSID" error={osidTrimmed !== "" && !isValidOsid(osidTrimmed) ? "OSIDs look like OS-12345" : undefined}>
          <Input mono placeholder="OS-12345" value={osid} onChange={(e) => setOsid(e.target.value)} onBlur={() => saveText("osid", osid)} />
        </Field>
        <Field label="Report title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => saveText("title", title)} />
        </Field>
        <Field label="Exam date">
          <Input
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
            onBlur={() => examDate !== (meta.examDate ?? "") && saveMeta({ examDate: examDate || undefined })}
          />
        </Field>
        <Field label="Report date">
          <Input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            onBlur={() => reportDate !== (meta.reportDate ?? "") && saveMeta({ reportDate: reportDate || undefined })}
          />
        </Field>
        {lab && (
          <Field label="Exam ended at" hint="The report is due 24 hours later.">
            <Input
              type="datetime-local"
              value={examEnd}
              onChange={(e) => setExamEnd(e.target.value)}
              onBlur={() => {
                const at = fromDateTimeInput(examEnd) ?? undefined;
                if (at !== meta.examEndAt) saveMeta({ examEndAt: at });
              }}
            />
          </Field>
        )}
      </div>
      {lab && (
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className={labelClass}>Hosts in this report</legend>
          {hosts.length === 0 ? (
            <p className="m-0 text-meta text-muted-2">No hosts in this engagement yet.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0">
              {hosts.map((h) => (
                <li key={h.id}>
                  <label className="grid min-h-7 cursor-default grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 hover:bg-surface">
                    <input
                      type="checkbox"
                      checked={includedHostIds.includes(h.id)}
                      onChange={(e) => toggleHost(h.id, e.target.checked)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="truncate text-body text-fg-2">{h.name}</span>
                    <span className="font-mono text-code text-faint">{h.ip}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
    </section>
  );
}
