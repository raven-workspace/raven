/**
 * The bundled faces the UI lays text out in (DESIGN.md Typography), as `document.fonts.load` arguments: a font and the
 * text whose glyphs pick the file. Instrument Sans at the type roles' weights (400 and 600) and JetBrains Mono, from
 * their Latin files; both are variable, so one file covers every weight, and naming each role's weight keeps this right
 * if that changes. The last entry is JetBrains Mono's own arrows and box drawing (global.css), which key hints use.
 */
export const APP_FONTS: readonly (readonly [font: string, text: string])[] = [
  ["400 1em 'Instrument Sans Variable'", "a"],
  ["600 1em 'Instrument Sans Variable'", "a"],
  ["400 1em 'JetBrains Mono Variable'", "a"],
  ["400 1em 'JetBrains Mono Variable'", "→"],
];

/** Long enough for files read from the app bundle, short enough that a broken one only delays the window a moment. */
export const FONT_WAIT_MS = 500;

/**
 * Resolves once the app's fonts are loaded, or after `timeoutMs`, whichever comes first; never rejects. A browser reads an
 * `@font-face` file only once text using it has been laid out, so without this the first frames paint in the fallback
 * and reflow when the real font swaps in (`font-display: swap`), moving any scroll placed on them (RAV-50, 57, 58).
 * A failed or missing font resolves too: the fallback applies as before.
 */
export function loadFonts(
  fonts: Pick<FontFaceSet, "load"> | undefined = document.fonts,
  faces: typeof APP_FONTS = APP_FONTS,
  timeoutMs = FONT_WAIT_MS,
): Promise<void> {
  if (!fonts) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  const loaded = Promise.all(faces.map(([font, text]) => fonts.load(font, text))).then(
    () => undefined,
    () => undefined,
  );
  return Promise.race([loaded, timeout]).finally(() => clearTimeout(timer));
}
