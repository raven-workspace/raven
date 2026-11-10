import { describe, expect, it } from "vitest";
import type { CardMeta } from "../../../engines/library/store";
import { splitWikilinks } from "../../../engines/library/wikilinks";
import { parseNote } from "../../../engines/manual";
import { resolveLink } from "../../../engines/manual/links";

// Synthetic notes and cards only.
const NOTES = [
  parseNote("04-Foundations/Zz-Errors.md", "---\nid: zz-errors\n---\n# Zz Errors\n## Core Concept\n")!,
  parseNote("03-Tools/Zz Tool.md", "# Zz Tool\n")!,
];
const CARDS: CardMeta[] = [{ id: "some-card", title: "Some Card", stage: "initial-foothold", category: "Active-Directory", os: "windows", file: "02-Cards/AD/Some-Card.md" }];

describe("resolveLink", () => {
  it("resolves a note by its file name", () => {
    expect(resolveLink("Zz-Errors", NOTES, CARDS)).toEqual({ kind: "note", noteId: "zz-errors" });
    expect(resolveLink("03-Tools/Zz Tool", NOTES, CARDS)).toEqual({ kind: "note", noteId: "zz-tool" });
  });
  it("carries a heading as its slug", () => {
    expect(resolveLink("Zz-Errors", NOTES, CARDS, "Core Concept")).toEqual({ kind: "note", noteId: "zz-errors", heading: "core-concept" });
  });
  it("falls back to a card, then to none", () => {
    expect(resolveLink("Some-Card", NOTES, CARDS)).toEqual({ kind: "card", cardId: "some-card" });
    expect(resolveLink("Missing", NOTES, CARDS)).toEqual({ kind: "none" });
  });
  it("resolves a heading link split from text, keeping the alias label", () => {
    const [p] = splitWikilinks("[[Zz-Errors#Core Concept|why]]");
    expect(p).toEqual({ target: "Zz-Errors", heading: "Core Concept", label: "why" });
    if (!("target" in p)) throw new Error("not a link");
    expect(resolveLink(p.target, NOTES, CARDS, p.heading)).toEqual({ kind: "note", noteId: "zz-errors", heading: "core-concept" });
  });
});

describe("resolveLink with a raw target", () => {
  it("reads a #heading inside the target", () => {
    expect(resolveLink("Zz-Errors#Core Concept", NOTES, CARDS)).toEqual({ kind: "note", noteId: "zz-errors", heading: "core-concept" });
  });
});
