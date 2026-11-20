import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FindingFiles, type FileFormDraft } from "../features/findings/FindingFiles/FindingFiles";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { FindingFile } from "../types/findings";
import { useState } from "react";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const FILE: FindingFile = {
  id: "ff1", findingId: "f1", name: "exploit.py", language: "python", content: "print(2)", modified: false,
  originalUrl: null, originalContent: null, createdAt: 1, updatedAt: 1,
};

function Host() {
  const [form, setForm] = useState<FileFormDraft | null>(null);
  return <FindingFiles findingId="f1" form={form} onForm={setForm} onDirty={() => {}} register={() => {}} />;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.findingFilesList.mockResolvedValue([FILE]);
  m.findingFileUpdate.mockImplementation(async (id, input) => ({ ...FILE, id, ...input, language: input.language ?? null, originalUrl: input.originalUrl ?? null, originalContent: input.originalContent ?? null, modified: input.modified ?? false }));
});

describe("finding files: modified exploit", () => {
  it("a file row has a Modified exploit toggle that reveals the original fields and saves them", async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={makeQueryClient()}><Host /></QueryClientProvider>);
    await user.click(await screen.findByRole("button", { name: "Edit exploit.py" }));
    const group = screen.getByRole("group", { name: "Finding files" });
    const toggle = within(group).getByRole("button", { name: "Modified exploit" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(within(group).queryByLabelText("Original URL")).not.toBeInTheDocument();
    await user.click(toggle);
    await user.type(within(group).getByLabelText("Original URL"), "https://www.exploit-db.com/exploits/50000");
    await user.click(within(group).getByLabelText("Original code"));
    await user.paste("print(1)");
    await user.click(within(group).getByRole("button", { name: "Save file" }));
    await waitFor(() => expect(m.findingFileUpdate).toHaveBeenCalledTimes(1));
    expect(m.findingFileUpdate).toHaveBeenCalledWith("ff1", expect.objectContaining({
      modified: true, originalUrl: "https://www.exploit-db.com/exploits/50000", originalContent: "print(1)",
    }));
  });

  it("turning Modified exploit off keeps the stored original URL and code", async () => {
    m.findingFilesList.mockResolvedValue([{ ...FILE, modified: true, originalUrl: "https://x.test/1", originalContent: "print(1)" }]);
    const user = userEvent.setup();
    render(<QueryClientProvider client={makeQueryClient()}><Host /></QueryClientProvider>);
    await user.click(await screen.findByRole("button", { name: "Edit exploit.py" }));
    const group = screen.getByRole("group", { name: "Finding files" });
    await user.click(within(group).getByRole("button", { name: "Modified exploit" }));
    await user.click(within(group).getByRole("button", { name: "Save file" }));
    await waitFor(() => expect(m.findingFileUpdate).toHaveBeenCalledTimes(1));
    const input = m.findingFileUpdate.mock.calls[0][1];
    expect(input.modified).toBe(false);
    // Absent means keep: the original stays stored for when the toggle goes back on.
    expect(input.originalUrl).toBeUndefined();
    expect(input.originalContent).toBeUndefined();
  });

  it("marks a modified file in its row", async () => {
    m.findingFilesList.mockResolvedValue([{ ...FILE, modified: true, originalUrl: "https://x.test/1" }]);
    render(<QueryClientProvider client={makeQueryClient()}><Host /></QueryClientProvider>);
    expect(await screen.findByText("Modified")).toBeInTheDocument();
  });
});
