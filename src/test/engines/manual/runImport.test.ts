import { beforeEach, describe, expect, it, vi } from "vitest";
import { runImport } from "../../../features/fieldManual/queries";
import { api } from "../../../lib/api";
import { setImported } from "../../../engines/library/store";

vi.mock("../../../lib/api");
const m = vi.mocked(api, true);

const CARD = `---
id: zz-new-card
title: Zz New Card
type: card
---
## Zz
\`\`\`bash title:"Zz run"
zz-tool --go
\`\`\`
`;

beforeEach(() => {
  vi.resetAllMocks();
  m.fieldManualSave.mockResolvedValue(null);
});

describe("runImport notes", () => {
  it("puts Tools, Foundations and Reporting notes in the snapshot and leaves cards alone", async () => {
    m.fieldManualScan.mockResolvedValue([
      { relPath: "02-Cards/zz.md", mtimeMs: 1, text: CARD },
      { relPath: "03-Tools/Zz-Tool.md", mtimeMs: 1, text: "---\nid: tool-zz\ntitle: Zz Tool\n---\n## Use\n" },
      { relPath: "04-Foundations/Zz-Fnd.md", mtimeMs: 1, text: "---\nid: fnd-zz\ntitle: Zz Fnd\n---\n## A\n" },
      { relPath: "05-Reporting/sub/Zz-Rep.md", mtimeMs: 1, text: "---\nid: rep-zz\ntitle: Zz Rep\n---\n## B\n" },
    ]);
    const snap = await runImport("~/fm", null);
    expect(snap.cards.map((c) => c.id)).toEqual(["zz-new-card"]);
    expect(snap.notes?.map((n) => [n.id, n.folder])).toEqual([
      ["tool-zz", "tools"],
      ["fnd-zz", "foundations"],
      ["rep-zz", "reporting"],
    ]);
    setImported({ commands: [], cards: [] });
  });
});
