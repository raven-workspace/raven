import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportButton, megabytes } from "../features/report/ExportButton/ExportButton";
import { api } from "../lib/api";
import type { ExportResult, Report } from "../types/report";
import { TooltipProvider } from "../ui";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const report = (over: Partial<Report> = {}): Report => ({
  id: "r1", engagementId: "e1", candidateName: "Sam Rivera", email: "sam@example.com", osid: "OS-48213", title: "OSCP Exam Report",
  meta: {}, createdAt: 1, updatedAt: 1, exportedAt: null, ...over,
});
const RESULT: ExportResult = {
  pdfPath: "/Users/sam/Exam/OSCP-OS-48213-Exam-Report.pdf", pdfBytes: 1_400_000,
  archivePath: "/Users/sam/Exam/OSCP-OS-48213-Exam-Report.7z", archiveBytes: 1_200_000,
  md5: "01acb7c43e87b389274aa329a728cbc7", pages: 30, tooLarge: false,
};
const build = vi.fn(() => ({ source: "#[report]", attachmentIds: ["a1"] }));

function mount(r: Report, gaps = 0) {
  const onSaveReport = vi.fn();
  render(
    <TooltipProvider>
      <ExportButton report={r} build={build} gaps={gaps} onSaveReport={onSaveReport} />
    </TooltipProvider>,
  );
  return onSaveReport;
}

beforeEach(() => {
  vi.resetAllMocks();
  build.mockReturnValue({ source: "#[report]", attachmentIds: ["a1"] });
  m.reportExport.mockResolvedValue(RESULT);
  m.pickFolder.mockResolvedValue("/Users/sam/Exam");
  m.revealInFinder.mockResolvedValue();
});

describe("Export PDF", () => {
  it("the first export asks for a folder once and remembers it, then writes OSCP-<OSID>-Exam-Report there", async () => {
    const user = userEvent.setup();
    const onSaveReport = mount(report());
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(m.reportExport).toHaveBeenCalledTimes(1));
    expect(m.pickFolder).toHaveBeenCalledTimes(1);
    expect(onSaveReport).toHaveBeenCalledWith({ meta: { exportFolder: "/Users/sam/Exam" } });
    expect(m.reportExport).toHaveBeenCalledWith("r1", { source: "#[report]", attachmentIds: ["a1"], folder: "/Users/sam/Exam", fileStem: "OSCP-OS-48213-Exam-Report" });
  });

  it("a remembered folder is used without asking", async () => {
    const user = userEvent.setup();
    mount(report({ meta: { exportFolder: "/Users/sam/Exam" } }));
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(m.reportExport).toHaveBeenCalled());
    expect(m.pickFolder).not.toHaveBeenCalled();
  });

  it("cancelling the folder picker exports nothing", async () => {
    const user = userEvent.setup();
    m.pickFolder.mockResolvedValue(null);
    mount(report());
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(m.pickFolder).toHaveBeenCalled());
    expect(m.reportExport).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows what it wrote: the archive to upload, the PDF inside, sizes, the MD5 to copy, and Reveal in Finder", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    mount(report({ meta: { exportFolder: "/Users/sam/Exam" } }), 3);
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    const panel = await screen.findByRole("dialog", { name: "Exported" });
    expect(within(panel).getByText("30 pages, in /Users/sam/Exam")).toBeInTheDocument();
    expect(within(panel).getByText("OSCP-OS-48213-Exam-Report.7z")).toBeInTheDocument();
    expect(within(panel).getByText("OSCP-OS-48213-Exam-Report.pdf")).toBeInTheDocument();
    expect(within(panel).getByText("1.1 MB")).toBeInTheDocument();
    expect(within(panel).getByText("01acb7c43e87b389274aa329a728cbc7")).toBeInTheDocument();
    expect(within(panel).getByText(/3 checks are still open in To do/)).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Copy the MD5" }));
    expect(writeText).toHaveBeenCalledWith("01acb7c43e87b389274aa329a728cbc7");
    expect(within(panel).getByRole("button", { name: "Copy the MD5" })).toHaveTextContent("Copied");
    await user.click(within(panel).getByRole("button", { name: "Reveal in Finder" }));
    expect(m.revealInFinder).toHaveBeenCalledWith(RESULT.archivePath);
  });

  it("warns loudly over OffSec's 200 MB limit", async () => {
    const user = userEvent.setup();
    m.reportExport.mockResolvedValue({ ...RESULT, archiveBytes: 210 * 1024 * 1024, tooLarge: true });
    mount(report({ meta: { exportFolder: "/x" } }));
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("over OffSec's 200 MB limit");
  });

  it("a failed export says why and offers to try again or change the folder", async () => {
    const user = userEvent.setup();
    m.reportExport.mockRejectedValueOnce(new Error("the export folder doesn't exist any more: pick it again"));
    mount(report({ meta: { exportFolder: "/gone" } }));
    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    const panel = await screen.findByRole("dialog", { name: "Couldn't export the report" });
    expect(within(panel).getByRole("alert")).toHaveTextContent("pick it again");
    await user.click(within(panel).getByRole("button", { name: "Change folder" }));
    await waitFor(() => expect(m.reportExport).toHaveBeenLastCalledWith("r1", expect.objectContaining({ folder: "/Users/sam/Exam" })));
    expect(await screen.findByRole("dialog", { name: "Exported" })).toBeInTheDocument();
  });

  it("is off until the OSID is valid, and says where to add it", () => {
    mount(report({ osid: "48213" }));
    const button = screen.getByRole("button", { name: "Export PDF" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Add your OSID (OS-12345) in Report details to export");
  });

  it("sizes read in MB", () => {
    expect(megabytes(1_200_000)).toBe("1.1 MB");
    expect(megabytes(210 * 1024 * 1024)).toBe("210 MB");
  });
});
