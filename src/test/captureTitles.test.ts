import { describe, expect, it } from "vitest";
import { buildDraft, flagTitle } from "../engines/capture";
import { resolveCapture } from "../features/capture/resolve";
import { EMPTY_DRAFT } from "../features/capture/useCaptureStore";
import type { Host } from "../types/host";

const host: Host = {
  id: "h1", engagementId: "e1", name: "web07", ip: "192.0.2.7", os: null, boardColumn: "information-gathering",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
  access: "none", createdAt: 1, updatedAt: 1,
};
const ctx = { hosts: [host], scope: ["192.0.2.0/24"], domain: "", machines: [], lastRanOn: null, presetHostId: "h1" };
const JOINER = / · | — | → /;

describe("generated titles", () => {
  it("auto titles contain no joiners or host name", () => {
    const shot = resolveCapture({ ...EMPTY_DRAFT, kind: "screenshot", image: { mime: "image/png", dataBase64: "", objectUrl: "" } }, ctx);
    expect(shot.selectedHost?.name).toBe("web07");
    expect(shot.autoTitle).toBe("Screenshot");
    const flag = resolveCapture({ ...EMPTY_DRAFT, kind: "flag", text: "0123456789abcdef0123456789abcdef" }, ctx);
    expect(flag.autoTitle).toBe("proof.txt".replace("proof", flag.flagKind));
    const cmd = buildDraft({
      text: "nmap -p- -Pn 192.0.2.7", image: null, kind: "command", hosts: [{ id: "h1", name: "web07", ip: "192.0.2.7", column: "information-gathering" }],
      scope: ["192.0.2.0/24"], domain: "", machines: [], lastRanOn: null,
    });
    for (const t of [shot.autoTitle, flag.autoTitle, cmd.title, flagTitle("local"), flagTitle("proof")]) {
      expect(t).not.toMatch(JOINER);
      expect(t).not.toContain("web07");
      expect(t).not.toContain("192.0.2.7");
    }
  });
});
