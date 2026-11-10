import { beforeEach, describe, expect, it } from "vitest";
import { useCaptureStore } from "../features/capture/useCaptureStore";

const draft = () => useCaptureStore.getState().drafts.e1;

describe("capture draft asNote", () => {
  beforeEach(() => useCaptureStore.getState().reset());

  it("resets when the pasted text changes, and holds while it does not", () => {
    const { update } = useCaptureStore.getState();
    update("e1", { text: "admin:Summer2026!" });
    update("e1", { asNote: true });
    update("e1", { caption: "x" });
    expect(draft().asNote).toBe(true);
    update("e1", { text: "admin:Summer2026!" });
    expect(draft().asNote).toBe(true);
    update("e1", { text: "other:Winter2026!" });
    expect(draft().asNote).toBe(false);
  });
});
