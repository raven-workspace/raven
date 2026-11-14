import { describe, expect, it } from "vitest";
import { archivedMeta, archivePage, type ArchivedPage, type ReportNode, type SectionMeta } from "../engines/report";

const page = (text: string): ReportNode => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
/** Every whole page the archive stores: each entry's doc, and each `previousDoc` kept whole in an entry's meta. */
const storedDocs = (originals: ArchivedPage[]) => originals.reduce((n, o) => n + 1 + (o.meta.previousDoc ? 1 : 0), 0);

describe("the archive of replaced pages (meta.originals)", () => {
  it("six Restore and Use-rebuilt swaps with edits between add at most one page each, and every kept previousDoc reads back", () => {
    const old = page("Owner's layout-5 page");
    // A rebuild: the old page archived, kept as previousDoc; the rebuilt page is open.
    let meta: SectionMeta = { layout: 6, previousDoc: old, previousLayout: 5, originals: archivePage({ layout: 5 }, old, "rebuild") };
    let open = page("Rebuilt draft");
    for (let swap = 1; swap <= 6; swap++) {
      const before = meta.originals!;
      // What swapPrevious stores: the open page archived, previousDoc and the open page trade places.
      const originals = archivePage(meta, open, "restore");
      const next: SectionMeta = { ...meta, previousDoc: open, restored: !meta.restored, originals };
      open = { ...(meta.previousDoc as ReportNode) };
      meta = next;
      expect(storedDocs(originals) - storedDocs(before)).toBeLessThanOrEqual(1);
      // Entries are only ever appended.
      expect(originals.slice(0, before.length)).toEqual(before);
      // The owner edits the page now open before the next swap.
      open = { ...open, content: [...open.content!, { type: "paragraph", content: [{ type: "text", text: `edit ${swap}` }] }] };
    }
    const originals = meta.originals!;
    // One entry per distinct page swapped out, never a second whole copy in its meta.
    expect(originals).toHaveLength(7);
    expect(storedDocs(originals)).toBe(7);
    // Each entry's previousDoc reads back as the page it named, byte for byte.
    for (let i = 1; i < originals.length; i++) {
      const ref = originals[i].meta.previousDocRef as number;
      expect(typeof ref).toBe("number");
      expect(JSON.stringify(archivedMeta(originals, i).previousDoc)).toBe(JSON.stringify(originals[ref].doc));
      expect(archivedMeta(originals, i)).not.toHaveProperty("previousDocRef");
    }
    expect(JSON.stringify(archivedMeta(originals, 1).previousDoc)).toBe(JSON.stringify(old));
  });

  it("keeps a previousDoc the archive doesn't hold whole, and refers to the entry being appended when it is that page", () => {
    const kept = page("Not archived");
    const one = archivePage({ layout: 5, previousDoc: kept }, page("A"), "rebuild");
    expect(one[0].meta.previousDoc).toEqual(kept);
    expect(archivedMeta(one, 0).previousDoc).toEqual(kept);
    const same = page("B");
    const two = archivePage({ layout: 6, previousDoc: same, originals: one }, same, "restore");
    expect(two[1].meta).toEqual({ layout: 6, previousDocRef: 1 });
    expect(archivedMeta(two, 1).previousDoc).toEqual(same);
  });
});
