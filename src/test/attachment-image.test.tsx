import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentImage } from "../features/log/AttachmentImage";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";

vi.mock("../lib/api");

const m = vi.mocked(api, true);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AttachmentImage", () => {
  it("is never stretched, so the screenshot keeps its aspect ratio", async () => {
    m.attachmentGet.mockResolvedValue({ mime: "image/png", dataBase64: "AAAA" } as Awaited<ReturnType<typeof api.attachmentGet>>);
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachmentImage id="a1" alt="shot" />
      </QueryClientProvider>,
    );
    const img = await screen.findByRole("img", { name: "shot" });
    for (const cls of ["self-start", "h-auto", "w-auto", "max-h-[420px]", "max-w-full"]) {
      expect(img).toHaveClass(cls);
    }
  });
});
