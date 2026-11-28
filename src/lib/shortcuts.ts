/**
 * Every Raven shortcut, defined once with a key per OS (docs/specs/terminal.md §3). Handlers match key events with
 * `matches`, and tooltips, hint lines and the Shortcuts popover show `keyLabel`, so the two can't drift apart.
 *
 * A shortcut is written as macOS draws it ("⌘K", "⌘⇧C", "⌥⌘1", "^`", "A"). The Linux key follows from the rule:
 * - outside a terminal pane, Ctrl replaces ⌘ (⌘K is Ctrl+K);
 * - inside a terminal pane, plain Ctrl belongs to the shell, so ⌘ becomes Ctrl+Shift (⌘C is Ctrl+Shift+C);
 * - a ⌘ chord that already has Shift becomes Ctrl+Alt in both (⌘⇧C is Ctrl+Alt+C);
 * - Ctrl chords (^`, ^⇧`) and keys without ⌘ (A, M, ⌥H, Esc) are the same on both.
 * Where the rule is wrong for one shortcut, its definition says so with `linux` or `linuxTerminal`.
 */

export type Os = "mac" | "linux";

/** Where focus is: anywhere in the app, or inside a terminal pane (whose keys RAV-88 routes). */
export type KeyScope = "app" | "terminal";

/** One key with its modifiers. `meta` is ⌘ (macOS only); `ctrl` is Control on both. */
export interface Chord {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** The key as drawn: an upper-case letter, a digit, a symbol ("/", "["), or a glyph ("↵", "↑", "Esc"). */
  key: string;
}

export interface Shortcut {
  /** As macOS draws it, e.g. "⌘⇧K". */
  readonly mac: string;
  /** Linux outside a terminal, as Linux writes it ("Ctrl+Shift+K"), when the rule gives the wrong key. */
  readonly linux?: string;
  /** Linux inside a terminal pane, when the rule gives the wrong key. */
  readonly linuxTerminal?: string;
}

/** Defines a shortcut: its macOS key, and a Linux key only where the rule doesn't give it. */
export const shortcut = (mac: string, linux?: { app?: string; terminal?: string }): Shortcut =>
  Object.freeze({ mac, linux: linux?.app, linuxTerminal: linux?.terminal });

/* The OS */

/** The same test ProseMirror uses for its "Mod" key, so the report editor's own keys agree with these. */
function detectOs(): Os {
  return typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform) ? "mac" : "linux";
}

let current: Os = detectOs();

/** The OS the keys are shown and matched for. */
export const currentOs = (): Os => current;

/** Pins the OS, for tests. (The visual audit shows Linux's keys with `AUDIT_OS=linux`, which fakes the platform.) */
export function setOs(os: Os) {
  current = os;
}

/* Parsing and the rule */

const MAC_MODS: Record<string, keyof Omit<Chord, "key">> = { "⌘": "meta", "⇧": "shift", "⌥": "alt", "^": "ctrl", "⌃": "ctrl" };
const LINUX_MODS: Record<string, keyof Omit<Chord, "key">> = { ctrl: "ctrl", shift: "shift", alt: "alt", super: "meta" };

const plain = (key: string): Chord => ({ meta: false, ctrl: false, alt: false, shift: false, key });

/** "⌥⌘1" → Alt, Meta, "1". Modifier glyphs lead; whatever follows is the key ("^`" is Ctrl and "`"). */
export function parseMac(s: string): Chord {
  const c = plain("");
  let i = 0;
  // The last character is always the key, even when it is itself a modifier glyph ("⌘^" would be Meta and "^").
  while (i < s.length - 1 && MAC_MODS[s[i]!]) c[MAC_MODS[s[i++]!]!] = true;
  c.key = normalKey(s.slice(i));
  return c;
}

/** "Ctrl+Shift+K" → Ctrl, Shift, "K". A literal "+" key is written last ("Ctrl++"). */
export function parseLinux(s: string): Chord {
  const c = plain("");
  const parts = s.endsWith("++") ? [...s.slice(0, -2).split("+"), "+"] : s.split("+");
  const key = parts.pop()!;
  for (const p of parts) {
    const mod = LINUX_MODS[p.toLowerCase()];
    if (!mod) throw new Error(`unknown modifier "${p}" in "${s}"`);
    c[mod] = true;
  }
  c.key = normalKey(key);
  return c;
}

const normalKey = (k: string) => (k.length === 1 ? k.toUpperCase() : k);

/** The rule (see the file header) applied to one macOS chord. */
export function linuxChord(mac: Chord, scope: KeyScope): Chord {
  if (!mac.meta) return { ...mac };
  if (mac.shift) return { ...mac, meta: false, ctrl: true, alt: true, shift: false };
  return { ...mac, meta: false, ctrl: true, shift: scope === "terminal" };
}

/** The chord this shortcut is on `os`, in `scope`. */
export function chordFor(sc: Shortcut, os: Os = current, scope: KeyScope = "app"): Chord {
  const mac = parseMac(sc.mac);
  if (os === "mac") return mac;
  const own = scope === "terminal" ? sc.linuxTerminal : sc.linux;
  return own ? parseLinux(own) : linuxChord(mac, scope);
}

/* Showing a key */

/** A shortcut, several shown as one hint ("⌘B ⌘I ⌘U"), or a key that is the same everywhere ("Esc", "⌥H", "[ ]"). */
export type Keys = string | Shortcut | readonly Shortcut[];

/** How Linux writes the keys that aren't a letter or digit, as VS Code and GNOME do ("Ctrl+Enter"); the arrows keep
 *  their glyphs. */
const LINUX_KEY_NAMES: Record<string, string> = { "↵": "Enter", "⇥": "Tab", "⌫": "Backspace", "⌦": "Delete", "␣": "Space" };

/** The chord as `os` writes it: "⌘⇧K" on macOS (in Apple's order), "Ctrl+Shift+K" on Linux. */
export function formatChord(c: Chord, os: Os): string {
  if (os === "mac") return `${c.ctrl ? "^" : ""}${c.alt ? "⌥" : ""}${c.meta ? "⌘" : ""}${c.shift ? "⇧" : ""}${c.key}`;
  const mods = [c.ctrl && "Ctrl", c.alt && "Alt", c.shift && "Shift", c.meta && "Super"].filter(Boolean);
  return [...mods, LINUX_KEY_NAMES[c.key] ?? c.key].join("+");
}

/** One shortcut's label on `os`. On macOS it is the definition as written, so the order the page drew stays. */
export function shortcutLabel(sc: Shortcut, os: Os = current, scope: KeyScope = "app"): string {
  return os === "mac" ? sc.mac : formatChord(chordFor(sc, os, scope), os);
}

/** What a tooltip, a key cap or a hint shows. Several shortcuts are separated by a space, one cap each. */
export function keyLabel(keys: Keys, os: Os = current, scope: KeyScope = "app"): string {
  if (typeof keys === "string") return keys;
  const list: readonly Shortcut[] = isShortcutList(keys) ? keys : [keys as Shortcut];
  return list.map((sc) => shortcutLabel(sc, os, scope)).join(" ");
}

const isShortcutList = (keys: Keys): keys is readonly Shortcut[] => Array.isArray(keys);

const ARIA_KEY_NAMES: Record<string, string> = { "↵": "Enter", "⇥": "Tab", "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight", Esc: "Escape" };

/** The `aria-keyshortcuts` value: "Meta+K" on macOS, "Control+K" on Linux. */
export function ariaKeys(keys: Keys, os: Os = current): string {
  if (typeof keys === "string") return keys;
  const list: readonly Shortcut[] = isShortcutList(keys) ? keys : [keys as Shortcut];
  return list
    .map((sc) => {
      const c = chordFor(sc, os);
      const mods = [c.ctrl && "Control", c.alt && "Alt", c.shift && "Shift", c.meta && "Meta"].filter(Boolean);
      return [...mods, ARIA_KEY_NAMES[c.key] ?? c.key].join("+");
    })
    .join(" ");
}

/* Matching a key event */

/** The `KeyboardEvent.key` of the keys drawn as a glyph. */
const EVENT_KEYS: Record<string, string> = { ...ARIA_KEY_NAMES, "⌫": "Backspace", "⌦": "Delete", "␣": " " };

/** The physical key where a US layout has this character: the fallback when ⌥ (or a layout) changes the character. */
const CODES: Record<string, string> = {
  "/": "Slash",
  "\\": "Backslash",
  "[": "BracketLeft",
  "]": "BracketRight",
  ",": "Comma",
  ".": "Period",
  "`": "Backquote",
  ";": "Semicolon",
  "'": "Quote",
  "-": "Minus",
  "=": "Equal",
};

function codeOf(key: string): string | undefined {
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return CODES[key];
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/**
 * Whether `e` is this chord. The modifiers must be exactly the chord's, with one allowance: a symbol or digit matched by
 * its character ignores Shift, since some layouts need Shift to type "/", "[" or "1". Matched by its physical key instead
 * (where ⌥ or the layout changed the character), Shift must agree, so Shift on the "/" key is not "/".
 */
export function chordMatches(c: Chord, e: KeyEventLike): boolean {
  if (e.metaKey !== c.meta || e.ctrlKey !== c.ctrl || e.altKey !== c.alt) return false;
  const eventKey = EVENT_KEYS[c.key] ?? c.key;
  const isLetter = /^[A-Z]$/.test(c.key);
  const byChar = isLetter ? e.key.toUpperCase() === c.key : e.key === eventKey;
  if (byChar) return isLetter || eventKey.length > 1 ? e.shiftKey === c.shift : true;
  const code = codeOf(c.key);
  return code !== undefined && e.code === code && e.shiftKey === c.shift;
}

/** Whether `e` is this shortcut on the current OS. `scope` "terminal" is for the terminal pane's key routing. */
export function matches(sc: Shortcut, e: KeyEventLike, scope: KeyScope = "app", os: Os = current): boolean {
  return chordMatches(chordFor(sc, os, scope), e);
}

/**
 * A ProseMirror keymap name ("Mod-Shift-k") for one of the report editor's own keys. ⌘ is written "Mod", which
 * ProseMirror makes ⌘ on macOS and Ctrl elsewhere with the same test as `currentOs`; a Linux key of its own is
 * written out ("Ctrl-Alt-k").
 */
export function editorKey(sc: Shortcut, os: Os = current): string {
  const own = os === "linux" && sc.linux !== undefined;
  const c = own ? parseLinux(sc.linux!) : parseMac(sc.mac);
  const key = c.key.length === 1 ? c.key.toLowerCase() : (EVENT_KEYS[c.key] ?? c.key);
  return [c.meta && "Mod", c.ctrl && "Ctrl", c.alt && "Alt", c.shift && "Shift", key].filter(Boolean).join("-");
}

/* The shortcuts */

/** The report editor's own ⌘⇧ keys stay Ctrl+Shift on Linux: ProseKit binds them as Mod-Shift, they are the usual
 *  text-editing keys there, and the editor is never inside a terminal pane. */
const editorShift = (mac: string) => shortcut(mac, { app: `Ctrl+Shift+${mac.slice(-1)}` });

export const SHORTCUTS = {
  /* Everywhere */
  search: shortcut("⌘K"),
  lock: shortcut("⌘L"),
  toggleSidebar: shortcut("⌘B"),
  newEngagement: shortcut("⌘N"),
  /** Closes the editor tab in view (workspace shell). */
  closeTab: shortcut("⌘W"),
  /** Inside an engagement in the workspace shell, ⌘N adds a host (design §3.1); the Dashboard keeps it for engagements. */
  addHost: shortcut("⌘N"),
  /** ↵ copies a command; with ⌘ it is also logged against the host. */
  copyAndLog: shortcut("⌘↵"),
  paste: shortcut("⌘V"),

  /* Quick capture */
  captureKinds: [1, 2, 3, 4, 5].map((n) => shortcut(`⌘${n}`)),
  capturePrivate: shortcut("⌘P"),
  captureReturnedNothing: shortcut("⌘."),
  captureAsNote: shortcut("⌘J"),
  captureSave: shortcut("⌘↵"),

  /* Notes */
  notesScope: shortcut("⌘E"),
  toggleThread: shortcut("⌘/"),

  /* Findings */
  saveFinding: shortcut("⌘↵"),
  flipSplit: shortcut("⌘\\"),

  /* Manual */
  previousNote: shortcut("⌘["),

  /* Report */
  find: shortcut("⌘F"),
  replaceAll: shortcut("⌘↵"),
  insertEvidence: shortcut("⌘↵"),
  link: editorShift("⌘⇧K"),
  bold: shortcut("⌘B"),
  italic: shortcut("⌘I"),
  underline: shortcut("⌘U"),
  strikethrough: editorShift("⌘⇧S"),
  inlineCode: shortcut("⌘E"),
  highlight: editorShift("⌘⇧H"),
  quote: editorShift("⌘⇧B"),
  heading1: shortcut("⌥⌘1"),
  heading2: shortcut("⌥⌘2"),
  heading3: shortcut("⌥⌘3"),
  paragraph: shortcut("⌥⌘0"),
  subscript: shortcut("⌘,"),
  superscript: shortcut("⌘."),
  undo: shortcut("⌘Z"),
  redo: shortcut("⇧⌘Z", { app: "Ctrl+Shift+Z" }),
} as const;
