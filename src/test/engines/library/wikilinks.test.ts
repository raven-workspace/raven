import { describe, expect, it } from "vitest";
import { cardForLink, splitWikilinks } from "../../../engines/library/wikilinks";
import type { CardMeta } from "../../../engines/library/store";

const card = (id: string, title: string, file: string): CardMeta => ({ id, title, file, stage: "", category: "active-directory", os: "windows" });
const CARDS = [
  card("kerb", "Kerberoasting", "Active Directory/Kerberoasting.md"),
  card("asrep", "AS-REP Roasting", "Active Directory/AS-REP-Roasting.md"),
];

describe("splitWikilinks", () => {
  it("splits text around links, keeping the target and the shown label", () => {
    expect(splitWikilinks("Full procedure: [[Kerberoasting]].")).toEqual([
      { text: "Full procedure: " },
      { target: "Kerberoasting", label: "Kerberoasting" },
      { text: "." },
    ]);
  });
  it("uses an alias as the label and drops a heading from the target", () => {
    expect(splitWikilinks("[[AS-REP-Roasting#Crack|roast]] it")).toEqual([
      { target: "AS-REP-Roasting", label: "roast" },
      { text: " it" },
    ]);
    expect(splitWikilinks("[[Kerberoasting#Crack]]")).toEqual([{ target: "Kerberoasting", label: "Kerberoasting" }]);
  });
  it("leaves text without links as one piece", () => {
    expect(splitWikilinks("plain [not] a link")).toEqual([{ text: "plain [not] a link" }]);
  });
});

describe("cardForLink", () => {
  it("matches a card by its file name or its title, ignoring case, spaces and dashes", () => {
    expect(cardForLink("Kerberoasting", CARDS)?.id).toBe("kerb");
    expect(cardForLink("AS-REP-Roasting", CARDS)?.id).toBe("asrep");
    expect(cardForLink("as-rep roasting", CARDS)?.id).toBe("asrep");
    expect(cardForLink("Active Directory/Kerberoasting", CARDS)?.id).toBe("kerb");
  });
  it("finds nothing for a note that is not a card", () => {
    expect(cardForLink("06 - Lateral Movement", CARDS)).toBeUndefined();
  });
});
