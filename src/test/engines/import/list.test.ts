import { describe, expect, it } from "vitest";
import { listImportable } from "../../../engines/import/list";
import { engagementKindFor } from "../../../engines/import/types";
import { catalog, lab, labBox, logEntry, machine, standalone } from "./fixtures";
import type { OldBackup } from "../../../engines/import/types";

const bk = (machines: OldBackup["machines"]): OldBackup => ({ version: "3.0.0", machines });

describe("listImportable", () => {
  it("lists labs and standalones with dates, never catalog machines or lab boxes", () => {
    const list = listImportable(
      bk([
        lab({ logEntries: [logEntry(2000), logEntry(1000)] as never, engagementKind: "exam-sim", createdAt: "2024-02-01T00:00:00.000Z" }),
        labBox({ id: "custom-lab-1-b1" }),
        labBox({ id: "custom-lab-1-b2", logEntries: [logEntry(9)] as never }),
        standalone({ id: "custom-solo", name: "Solo", engagementKind: "real", logEntries: [logEntry(5000)] as never }),
        standalone({ id: "custom-dangling", labId: "custom-gone" }),
        standalone({ id: "custom-self", labId: "custom-self" }),
        catalog(),
        machine({ id: "thm-1", platform: "THM", isCustom: false, tags: ["pro-lab"] }),
        machine({ id: "other-1", platform: "Custom", tags: ["PRO-LAB"], name: "Platform custom lab" }),
      ]),
    );
    expect(list.map((c) => c.id)).toEqual([
      "custom-lab-1", "custom-solo", "custom-dangling", "custom-self", "other-1",
    ]);
    const l = list[0];
    expect(l).toMatchObject({
      kind: "lab", engagementKind: "exam-sim", hostCount: 2, logCount: 2, firstAt: 1000, lastAt: 2000,
      createdAt: Date.parse("2024-02-01T00:00:00.000Z"),
    });
    expect(list[1]).toMatchObject({ kind: "standalone", engagementKind: "client", hostCount: 1, logCount: 1, firstAt: 5000, lastAt: 5000 });
    expect(list[2]).toMatchObject({ kind: "standalone", engagementKind: "lab", logCount: 0, firstAt: null, lastAt: null });
    expect(list[4].kind).toBe("lab");
  });

  it("maps engagement kinds", () => {
    expect(engagementKindFor(undefined)).toBe("lab");
    expect(engagementKindFor("challenge-lab")).toBe("lab");
    expect(engagementKindFor("real")).toBe("client");
    expect(engagementKindFor("exam-sim")).toBe("exam-sim");
  });

  it("malformed machines are skipped without throwing, duplicates collapse", () => {
    const bad = [
      { id: 5, name: "num id", platform: "Custom", tags: [] },
      null,
      machine({ id: "custom-a", name: "A", tags: "pro-lab" as never, logEntries: { x: 1 } as never }),
      machine({ id: "custom-b", name: "B", logEntries: [null, 7, logEntry(10), { id: "x", at: "late" }] as never }),
      machine({ id: "custom-b", name: "B dup" }),
    ] as never;
    const list = listImportable(bk(bad));
    expect(list.map((c) => c.id)).toEqual(["custom-a", "custom-b"]);
    expect(list[0]).toMatchObject({ kind: "standalone", logCount: 0, firstAt: null });
    expect(list[1]).toMatchObject({ logCount: 2, firstAt: 10, lastAt: 10 });
  });
});
