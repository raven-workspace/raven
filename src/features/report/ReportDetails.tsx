import { useState } from "react";
import { isValidOsid, type ReportMeta } from "../../engines/report";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { Report, ReportPatch } from "../../types/report";
import { Field, Input, labelClass } from "../../ui";
import { fromDateTimeInput, toDateTimeInput } from "../engagements/format";
import "./ReportDetails.scss";

/** The backend's cap on a details field (characters). */
const MAX_FIELD = 2000;

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
  const meta = report.meta;
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
  /** Only the changed keys: the view merges them over the latest stored meta. */
  const saveMeta = (patch: Partial<ReportMeta>) => onSave({ meta: patch });
  const toggleHost = (id: string, on: boolean) => {
    const next = on ? [...includedHostIds, id] : includedHostIds.filter((x) => x !== id);
    saveMeta({ includedHostIds: hosts.map((h) => h.id).filter((h) => next.includes(h)) });
  };

  return (
    <section aria-label="Report details" className="report-details">
      <h2 className="report-details__title">Report details</h2>
      <div className="report-details__fields">
        <Field label="Your name">
          <Input maxLength={MAX_FIELD} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => saveText("candidateName", name)} />
        </Field>
        <Field label="Email">
          <Input type="email" maxLength={MAX_FIELD} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => saveText("email", email)} />
        </Field>
        <Field label="OSID" error={osidTrimmed !== "" && !isValidOsid(osidTrimmed) ? "OSIDs look like OS-12345" : undefined}>
          <Input mono maxLength={MAX_FIELD} placeholder="OS-12345" value={osid} onChange={(e) => setOsid(e.target.value)} onBlur={() => saveText("osid", osid)} />
        </Field>
        <Field label="Report title">
          <Input maxLength={MAX_FIELD} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => saveText("title", title)} />
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
        <fieldset className="report-details__hosts">
          <legend className={labelClass}>Hosts in this report</legend>
          {hosts.length === 0 ? (
            <p className="report-details__empty">No hosts in this engagement yet.</p>
          ) : (
            <ul className="report-details__host-list">
              {hosts.map((h) => (
                <li key={h.id}>
                  <label className="report-details__host">
                    <input
                      type="checkbox"
                      checked={includedHostIds.includes(h.id)}
                      onChange={(e) => toggleHost(h.id, e.target.checked)}
                      className="report-details__check"
                    />
                    <span className="report-details__host-name">{h.name}</span>
                    <span className="report-details__host-ip">{h.ip}</span>
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
