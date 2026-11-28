import { beforeEach, describe, expect, it } from "vitest";
import { useLogEntryStore } from "../features/capture/useLogEntryStore";

const draft = () => useLogEntryStore.getState().drafts.e1;

describe("capture draft asNote", () => {
  beforeEach(() => useLogEntryStore.getState().reset());

  it("resets when the pasted text changes, and holds while it does not", () => {
    const { update } = useLogEntryStore.getState();
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
