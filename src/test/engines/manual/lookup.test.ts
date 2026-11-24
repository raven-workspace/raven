import { describe, expect, it } from "vitest";
import { isInlineCommand, lookupColumns, lookupRows, shortTitle } from "../../../engines/manual";
import { leftover, plain } from "../../../engines/manual/lookup";
import { parseNote } from "../../../engines/manual";
import { parseInline } from "../../../engines/manual/markdown";

const cellsOf = (...c: string[]) => c.map(parseInline);

const NOTE = parseNote(
  "04-Foundations/Zz Errors.md",
  [
    "# Zz Errors",
    "",
    "**Table 3 — Kerberos errors**",
    "",
    "| Error | Means | Usually caused by | Do this | Card |",
    "| --- | --- | --- | --- | --- |",
    "| `KRB_AP_ERR_SKEW` | Clock off. | VM tools. | `sudo ntpdate {DC_IP}`; or `faketime`. | [[Zz-Clock]] |",
    "",
    "| Error | Do this |",
    "| --- | --- |",
    "| `ZZ_NO_CAPTION` | `zzscan {TARGET}` |",
  ].join("\n"),
)!;

describe("isInlineCommand", () => {
  it("accepts placeholders and whitespace, rejects bare tokens", () => {
    expect(isInlineCommand("nxc smb {DC_IP} --pass-pol")).toBe(true);
    expect(isInlineCommand("ip -br addr")).toBe(true);
    expect(isInlineCommand("--local-auth")).toBe(false);
    expect(isInlineCommand("-m MODE")).toBe(false);
    expect(isInlineCommand("STATUS_LOGON_FAILURE")).toBe(false);
  });
});

describe("lookupColumns", () => {
  const keyRows = [cellsOf("`ZZ_A`", "x", "y", "z", "w")];
  it("finds the columns by header", () => {
    expect(lookupColumns(cellsOf("Error", "Means", "Usually caused by", "Do this", "Card"), keyRows)).toEqual({ key: 0, means: 1, cause: 2, action: 3, card: 4 });
  });
  it("is null without an action header", () => {
    expect(lookupColumns(cellsOf("Probe result", "nmap state", "Meaning"), [cellsOf("`ZZ_A`", "a", "b")])).toBeNull();
  });
  it("is null when the first column holds prose", () => {
    expect(lookupColumns(cellsOf("Probe result", "Do this"), [cellsOf("Nothing back, or ICMP unreachable", "retry")])).toBeNull();
  });
});

describe("lookupRows", () => {
  it("returns the rows of captioned lookup tables only", () => {
    const rows = lookupRows(NOTE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      noteId: NOTE.id, anchor: "table-3", tableName: "Kerberos errors", row: 0, key: "KRB_AP_ERR_SKEW",
      commands: ["sudo ntpdate {DC_IP}"], card: { target: "Zz-Clock" },
    });
    expect(lookupRows(NOTE)).toBe(rows);
  });
});

describe("lookupRows caption reach", () => {
  const table = ["| Error | Do this |", "| --- | --- |", "| `ZZ_A` | `zzscan {TARGET}` |"];
  const note = (mid: string[]) => parseNote("04-Foundations/Zz Reach.md", ["# Zz", "", "**Table 2 — Zz codes**", "", ...mid, "", ...table].join("\n"))!;
  it("keeps the caption across a code block", () => {
    expect(lookupRows(note(["```text", "sample", "```"])).map((r) => r.anchor)).toEqual(["table-2"]);
  });
  it("keeps the caption across a paragraph", () => {
    expect(lookupRows(note(["Some words."])).map((r) => r.anchor)).toEqual(["table-2"]);
  });
  it("loses the caption at a heading", () => {
    expect(lookupRows(note(["## Next"]))).toEqual([]);
  });
});

describe("shortTitle", () => {
  it("strips a trailing Reference", () => {
    expect(shortTitle("Networking Basics — Reference")).toBe("Networking Basics");
    expect(shortTitle("Zz Scanner")).toBe("Zz Scanner");
  });
});

describe("leftover (RAV-21)", () => {
  /** The action cell's text left besides `commands`, as plain text (null when nothing is left). */
  const left = (cell: string, ...commands: string[]) => {
    const out = leftover(parseInline(cell), commands);
    return out && plain(out);
  };

  it("folds the separators left where commands were taken out", () => {
    expect(left("or `zz a b`, then go", "zz a b")).toBe("or, then go");
    expect(left("Restart it: `zz stop x`, then `zz start x`; or retry", "zz stop x", "zz start x")).toBe("Restart it: then; or retry");
    expect(left("it: `zz a b`, then go", "zz a b")).toBe("it: then go");
  });

  it("keeps every other comma, semicolon and space as written", () => {
    expect(left("Scan TCP,UDP;then `zz a b`  twice", "zz a b")).toBe("Scan TCP,UDP;then twice");
    expect(left("Ports 80,443 then `zz a b`.", "zz a b")).toBe("Ports 80,443 then .");
    // A stray separator the author wrote, away from any removed command, is theirs.
    expect(left("Try `zz a b` first; or , then `zz c d`", "zz a b")).toBe("Try first; or , then zz c d");
  });

  it("drops separators at either end, and gives null for punctuation only", () => {
    expect(left("`zz a b`, then retry;", "zz a b")).toBe("then retry");
    expect(left("`zz a b`; `zz c d`.", "zz a b", "zz c d")).toBeNull();
  });
});

