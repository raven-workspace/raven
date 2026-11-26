import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FONT_WAIT_MS, loadFonts } from "@/lib/loadFonts";

/** A stand-in `document.fonts` whose loads finish only when the test says so. */
function fakeFonts() {
  let finish!: (ok: boolean) => void;
  const done = new Promise<boolean>((r) => { finish = r; });
  const load = vi.fn((...[font]: [font: string, text?: string]) => done.then((ok) => (ok ? [font] : Promise.reject(new Error("NetworkError")))));
  return { fonts: { load } as unknown as Pick<FontFaceSet, "load">, load, finish: (ok = true) => finish(ok) };
}

/** What main.tsx does: mount once the fonts are in. */
function mountAfterFonts(fonts: Pick<FontFaceSet, "load"> | undefined) {
  const mount = vi.fn();
  void loadFonts(fonts).then(mount);
  return mount;
}

// RAV-59: text laid out before the bundled fonts load swaps fonts and reflows, so the app mounts after they load.
describe("loadFonts: the app mounts once its fonts are in", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks for Instrument Sans at the type roles' weights, JetBrains Mono and its arrows", () => {
    const { fonts, load } = fakeFonts();
    void loadFonts(fonts);
    expect(load.mock.calls).toEqual([
      ["400 1em 'Instrument Sans Variable'", "a"],
      ["600 1em 'Instrument Sans Variable'", "a"],
      ["400 1em 'JetBrains Mono Variable'", "a"],
      ["400 1em 'JetBrains Mono Variable'", "→"],
    ]);
  });

  it("waits for the fonts, then mounts as soon as they load", async () => {
    const { fonts, finish } = fakeFonts();
    const mount = mountAfterFonts(fonts);
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS / 2);
    expect(mount).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(mount).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a font that never loads: mounts anyway once the timeout passes", async () => {
    const { fonts } = fakeFonts();
    const mount = mountAfterFonts(fonts);
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 1);
    expect(mount).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mount).toHaveBeenCalledOnce();
  });

  it("a font that fails to load: mounts at once with the fallback, without an error", async () => {
    const { fonts, finish } = fakeFonts();
    const mount = mountAfterFonts(fonts);
    finish(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mount).toHaveBeenCalledOnce();
  });

  it("no document.fonts: mounts at once", async () => {
    const mount = mountAfterFonts(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(mount).toHaveBeenCalledOnce();
  });
});
