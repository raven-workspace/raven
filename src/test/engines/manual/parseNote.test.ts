import { describe, expect, it } from "vitest";
import { parseNote, slug } from "../../../engines/manual";

const NOTE = `---
id: fnd-zz-errors
title: Zz Errors
type: foundation
---
# Heading One

Intro.

## Symptoms
text
\`\`\`bash title:"x"
## not a heading
**Table 9 — Fenced**
\`\`\`

**Table 2 — Kerberos**

| a | b |

### Detail
## Symptoms
`;

describe("parseNote", () => {
  it("reads id, title, folder and body", () => {
    const n = parseNote("04-Foundations/Zz-Errors.md", NOTE)!;
    expect(n).toMatchObject({ id: "fnd-zz-errors", title: "Zz Errors", folder: "foundations", file: "04-Foundations/Zz-Errors.md" });
    expect(n.body.startsWith("# Heading One")).toBe(true);
  });

  it("maps the three folders, nested too", () => {
    expect(parseNote("03-Tools/a.md", "x")!.folder).toBe("tools");
    expect(parseNote("05-Reporting/sub/a.md", "x")!.folder).toBe("reporting");
  });

  it("falls back to the first # heading, then the file stem", () => {
    expect(parseNote("03-Tools/Zz.md", "---\nid: t\n---\n# From Heading\n")!.title).toBe("From Heading");
    expect(parseNote("03-Tools/Zz-Stem.md", "plain")!.title).toBe("Zz-Stem");
  });

  it("outlines h2, h3 and table captions in order, ignoring fenced code", () => {
    const n = parseNote("04-Foundations/Zz-Errors.md", NOTE)!;
    expect(n.outline).toEqual([
      { id: "symptoms", text: "Symptoms", kind: "h2" },
      { id: "table-2", text: "Table 2 · Kerberos", kind: "table" },
      { id: "detail", text: "Detail", kind: "h3" },
      { id: "symptoms-2", text: "Symptoms", kind: "h2" },
    ]);
  });

  it("returns null outside the Manual folders", () => {
    expect(parseNote("02-Cards/a.md", NOTE)).toBeNull();
    expect(parseNote("00-Home/Toolkit.md", NOTE)).toBeNull();
  });

  it("slugs text", () => {
    expect(slug("Kerberos: AS-REP roasting!")).toBe("kerberos-as-rep-roasting");
  });
});
