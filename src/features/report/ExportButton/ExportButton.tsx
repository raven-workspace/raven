import { useState } from "react";
import { isValidOsid, type ExportSource } from "../../../engines/report/index";
import { api } from "../../../lib/api";
import { copyPlain } from "../../../lib/clipboard";
import type { ExportResult, Report, ReportPatch } from "../../../types/report";
import { Button, Dialog } from "../../../ui/index";
import "./ExportButton.scss";

/** A size as the result panel says it: "1.3 MB". */
export const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** The folder a path is in, for "in <folder>". */
const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/"))) || "/";
const fileOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Export PDF (spec §6.7, docs/adr/0002): writes `OSCP-<OSID>-Exam-Report.pdf` and its unpassworded `.7z` into the
 * folder the owner picks once (remembered in the report's meta), then shows what it wrote: the files, their sizes (a
 * warning over OffSec's 200 MB) and the archive's MD5 to compare at upload.offsec.com, with Copy and Reveal in Finder.
 * `build` turns the report into Typst at the moment of export, the open page as typed included.
 */
export function ExportButton({ report, build, gaps, onSaveReport }: {
  report: Report;
  build: () => ExportSource;
  /** Open checks across the report: said beside the result, never a block. */
  gaps: number;
  onSaveReport: (patch: ReportPatch) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const osid = report.osid.trim();
  const osidOk = isValidOsid(osid);

  const pick = async (): Promise<string | null> => {
    const folder = await api.pickFolder("Choose where to save the exam report", report.meta.exportFolder);
    if (folder) onSaveReport({ meta: { exportFolder: folder } });
    return folder;
  };
  const run = async (folder: string | null) => {
    if (!folder || busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const { source, attachmentIds } = build();
      setResult(await api.reportExport(report.id, { source, attachmentIds, folder, fileStem: `OSCP-${osid}-Exam-Report` }));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const exportNow = async () => {
    try {
      await run(report.meta.exportFolder ?? (await pick()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const changeFolder = async () => {
    try {
      await run(await pick());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const copy = async () => {
    if (!result) return;
    await copyPlain(result.md5);
    setCopied(true);
  };

  return (
    <>
      <Button
        size="sm"
        variant="primary"
        disabled={!osidOk || busy}
        title={osidOk ? undefined : "Add your OSID (OS-12345) in Report details to export"}
        onClick={() => void exportNow()}
      >
        {busy ? "Exporting…" : "Export PDF"}
      </Button>
      <Dialog
        open={result !== null || error !== null}
        onOpenChange={(o) => {
          if (o) return;
          setResult(null);
          setError(null);
        }}
        title={error ? "Couldn't export the report" : "Exported"}
        description={
          error ? (
            <span role="alert">{error}</span>
          ) : result ? (
            `${result.pages} pages, in ${folderOf(result.archivePath)}`
          ) : undefined
        }
        size="lg"
        footer={
          <div className="export-result__footer">
            <Button size="sm" disabled={busy} onClick={() => void changeFolder()}>
              Change folder
            </Button>
            {error ? (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void exportNow()}>
                Try again
              </Button>
            ) : (
              result && (
                <Button size="sm" variant="primary" onClick={() => void api.revealInFinder(result.archivePath)}>
                  Reveal in Finder
                </Button>
              )
            )}
          </div>
        }
      >
        {result && (
          <div className="export-result">
            <dl className="export-result__files">
              <dt>Upload this</dt>
              <dd>
                <span className="export-result__file">{fileOf(result.archivePath)}</span>
                <span className="export-result__size">{megabytes(result.archiveBytes)}</span>
              </dd>
              <dt>Inside it</dt>
              <dd>
                <span className="export-result__file">{fileOf(result.pdfPath)}</span>
                <span className="export-result__size">{megabytes(result.pdfBytes)}</span>
              </dd>
              <dt>MD5</dt>
              <dd>
                <code className="export-result__md5">{result.md5}</code>
                <Button size="sm" onClick={() => void copy()} aria-label="Copy the MD5">
                  {copied ? "Copied" : "Copy"}
                </Button>
              </dd>
            </dl>
            {result.tooLarge && (
              <p role="alert" className="export-result__warn">
                The .7z is over OffSec's 200 MB limit. Shrink or crop the largest screenshots and export again.
              </p>
            )}
            <p className="export-result__hint">After uploading at upload.offsec.com, check that the MD5 it shows matches this one.</p>
            {gaps > 0 && (
              <p className="export-result__warn">
                {gaps === 1 ? "1 check is" : `${gaps} checks are`} still open in To do. The report was exported anyway.
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
