import { readFileSync } from "node:fs";
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
    expect(img).toHaveClass("attachment-image");
    // jsdom applies no stylesheets: the rule itself keeps the natural size, capped to the column and 420px tall.
    const scss = readFileSync("src/features/log/AttachmentImage.scss", "utf8");
    const rule = scss.slice(scss.indexOf(".attachment-image {"), scss.indexOf("}", scss.indexOf(".attachment-image {")));
    for (const decl of ["align-self: start;", "width: auto;", "max-width: 100%;", "height: auto;", "max-height: 420px;"]) {
      expect(rule).toContain(decl);
    }
  });
});
