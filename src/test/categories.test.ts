import { describe, expect, it } from "vitest";
import { BUILTIN_LIBRARY } from "../engines/library/data";
import { FIELD_MANUAL_CARDS } from "../engines/library/data/fieldManual";
import { PIVOT_COMMANDS } from "../engines/library/data/pivot";
import { CATEGORIES, CATEGORY_ALIASES, allCategories, categoryLabel, categoryOf } from "../engines/library/categories";

describe("categories", () => {
  it("every built-in command has a category from CATEGORIES", () => {
    for (const c of BUILTIN_LIBRARY.filter((c) => c.source !== "field-manual"))
      expect(CATEGORIES, c.id).toContain(c.category);
  });
  it("field-manual commands take their card's category", () => {
    const c = BUILTIN_LIBRARY.find((x) => x.cardId)!;
    expect(categoryOf(c, FIELD_MANUAL_CARDS)).toBe(FIELD_MANUAL_CARDS.find((k) => k.id === c.cardId)!.category);
  });
  it("pivot built-ins are Pivoting", () => {
    expect(PIVOT_COMMANDS.every((c) => c.category === "Pivoting")).toBe(true);
  });
  it("extra vault folder becomes a category", () => {
    const cards = [{ id: "x", title: "X", stage: "s", category: "Cloud", os: "any" as const, file: "02-Cards/Cloud/X.md" }];
    expect(allCategories(cards)).toContain("Cloud");
  });
  it("labels read as words", () => {
    expect(categoryLabel("Shells-and-Transfers")).toBe("Shells & transfers");
    expect(categoryLabel("Active-Directory")).toBe("Active Directory");
    expect(categoryLabel("PrivEsc-Windows")).toBe("PrivEsc Windows");
    expect(categoryLabel("Some-New_Folder")).toBe("Some New Folder");
  });
  it("aliases cover lateral movement", () => {
    expect(CATEGORY_ALIASES["Pivoting"]).toEqual(expect.arrayContaining(["lateral movement", "tunneling", "port forwarding"]));
  });
  it("uncategorised commands fall back to Other", () => {
    const c = { ...BUILTIN_LIBRARY[0], category: undefined, cardId: undefined };
    expect(categoryOf(c, [])).toBe("Other");
  });
});
