import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ariaKeys,
  chordFor,
  editorKey,
  keyLabel,
  matches,
  parseLinux,
  parseMac,
  setOs,
  shortcut,
  shortcutLabel,
  SHORTCUTS,
  type Os,
} from "../lib/shortcuts";
import { HintUnit } from "../ui/HintLine";
import { IconButton } from "../ui/IconButton";
import { TitleBarIconButton, TitleBarShortcuts } from "../ui/TitleBar";
import { TooltipProvider } from "../ui/Tooltip";
import { Lock } from "@phosphor-icons/react";

/** A keydown as the browser reports it. */
const press = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}, code = "") => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

const label = (mac: string, os: Os, scope: "app" | "terminal" = "app") => shortcutLabel(shortcut(mac), os, scope);

describe("the Linux key map (terminal.md §3)", () => {
  it("outside a terminal, Ctrl replaces ⌘", () => {
    expect(label("⌘K", "linux")).toBe("Ctrl+K");
    expect(label("⌘L", "linux")).toBe("Ctrl+L");
    expect(label("⌘↵", "linux")).toBe("Ctrl+Enter");
    expect(label("⌘[", "linux")).toBe("Ctrl+[");
    expect(label("⌥⌘1", "linux")).toBe("Ctrl+Alt+1");
  });

  it("a ⌘ chord that already has Shift is Ctrl+Alt, in and out of a terminal", () => {
    for (const key of ["C", "S", "W", "L"]) {
      expect(label(`⌘⇧${key}`, "linux")).toBe(`Ctrl+Alt+${key}`);
      expect(label(`⌘⇧${key}`, "linux", "terminal")).toBe(`Ctrl+Alt+${key}`);
    }
  });

  it("Ctrl chords are the same on both", () => {
    for (const os of ["mac", "linux"] as const) {
      for (const scope of ["app", "terminal"] as const) {
        expect(chordFor(shortcut("^`"), os, scope)).toEqual({ meta: false, ctrl: true, alt: false, shift: false, key: "`" });
        expect(chordFor(shortcut("^⇧`"), os, scope)).toEqual({ meta: false, ctrl: true, alt: false, shift: true, key: "`" });
        expect(chordFor(shortcut("^⇧M"), os, scope)).toEqual({ meta: false, ctrl: true, alt: false, shift: true, key: "M" });
      }
    }
    expect(label("^⇧M", "linux")).toBe("Ctrl+Shift+M");
  });

  it("keys without ⌘ don't change", () => {
    for (const key of ["A", "M", "P", "L", "N", "1", "7", "Esc"]) expect(label(key, "linux")).toBe(key);
    for (const key of ["A", "1", "⌥H", "^`", "Esc"]) expect(chordFor(shortcut(key), "linux")).toEqual(chordFor(shortcut(key), "mac"));
  });

  it("inside a terminal, Raven's chords take Ctrl+Shift so plain Ctrl reaches the shell", () => {
    expect(label("⌘K", "linux", "terminal")).toBe("Ctrl+Shift+K");
    expect(label("⌘C", "linux", "terminal")).toBe("Ctrl+Shift+C");
    expect(label("⌘V", "linux", "terminal")).toBe("Ctrl+Shift+V");
    expect(label("^`", "linux", "terminal")).toBe("Ctrl+`");
    // macOS is the same in a terminal: ⌘ never reaches the shell.
    expect(label("⌘K", "mac", "terminal")).toBe("⌘K");
  });

  it("a definition can override the rule, for the app and the terminal apart", () => {
    const sc = shortcut("⌘⇧K", { app: "Ctrl+Shift+K", terminal: "Ctrl+Alt+Shift+K" });
    expect(shortcutLabel(sc, "mac")).toBe("⌘⇧K");
    expect(shortcutLabel(sc, "linux")).toBe("Ctrl+Shift+K");
    expect(shortcutLabel(sc, "linux", "terminal")).toBe("Ctrl+Alt+Shift+K");
  });

  it("the report editor's own Shift keys stay Ctrl+Shift, as ProseKit binds them", () => {
    expect(shortcutLabel(SHORTCUTS.link, "linux")).toBe("Ctrl+Shift+K");
    expect(shortcutLabel(SHORTCUTS.strikethrough, "linux")).toBe("Ctrl+Shift+S");
    expect(shortcutLabel(SHORTCUTS.redo, "linux")).toBe("Ctrl+Shift+Z");
    expect(editorKey(SHORTCUTS.link, "mac")).toBe("Mod-Shift-k");
    expect(editorKey(SHORTCUTS.link, "linux")).toBe("Ctrl-Shift-k");
    expect(editorKey(SHORTCUTS.heading1)).toBe("Mod-Alt-1");
    expect(editorKey(SHORTCUTS.subscript)).toBe("Mod-,");
  });

  it("every shortcut has a key on both OSes, and the two never clash on Linux where they clash nowhere on macOS", () => {
    const flat = Object.values(SHORTCUTS).flat();
    const macs = new Map<string, string>();
    const linuxes = new Map<string, string>();
    for (const sc of flat) {
      expect(() => chordFor(sc, "linux")).not.toThrow();
      const mac = JSON.stringify(chordFor(sc, "mac"));
      const linux = JSON.stringify(chordFor(sc, "linux"));
      // Same Linux chord only for shortcuts that already share their macOS chord (⌘↵, ⌘B, ⌘E, ⌘.).
      if (linuxes.has(linux)) expect(linuxes.get(linux)).toBe(mac);
      linuxes.set(linux, mac);
      macs.set(mac, linux);
    }
  });
});

describe("parsing", () => {
  it("reads macOS glyphs in any order and Linux words", () => {
    expect(parseMac("⇧⌘Z")).toEqual(parseMac("⌘⇧Z"));
    expect(parseMac("⌘k").key).toBe("K");
    expect(parseLinux("ctrl+alt+c")).toEqual({ meta: false, ctrl: true, alt: true, shift: false, key: "C" });
    expect(parseLinux("Ctrl++").key).toBe("+");
    expect(() => parseLinux("Hyper+K")).toThrow(/unknown modifier/);
  });
});

describe("matching a key event", () => {
  it("⌘K on macOS, Ctrl+K on Linux, and not the other way round", () => {
    expect(matches(SHORTCUTS.search, press("k", { metaKey: true }), "app", "mac")).toBe(true);
    expect(matches(SHORTCUTS.search, press("k", { ctrlKey: true }), "app", "mac")).toBe(false);
    expect(matches(SHORTCUTS.search, press("k", { ctrlKey: true }), "app", "linux")).toBe(true);
    expect(matches(SHORTCUTS.search, press("k", { metaKey: true }), "app", "linux")).toBe(false);
  });

  it("extra modifiers are a different chord", () => {
    expect(matches(SHORTCUTS.search, press("K", { metaKey: true, shiftKey: true }), "app", "mac")).toBe(false);
    expect(matches(SHORTCUTS.search, press("k", { ctrlKey: true, altKey: true }), "app", "linux")).toBe(false);
    expect(matches(SHORTCUTS.copyAndLog, press("Enter", { ctrlKey: true, shiftKey: true }), "app", "linux")).toBe(false);
  });

  it("a ⌘⇧ chord is pressed as Ctrl+Alt on Linux", () => {
    const capture = shortcut("⌘⇧C");
    expect(matches(capture, press("C", { metaKey: true, shiftKey: true }), "app", "mac")).toBe(true);
    expect(matches(capture, press("c", { ctrlKey: true, altKey: true }), "app", "linux")).toBe(true);
    expect(matches(capture, press("C", { ctrlKey: true, shiftKey: true }), "app", "linux")).toBe(false);
  });

  it("in a terminal on Linux, Ctrl+Shift is Raven's and plain Ctrl is the shell's", () => {
    expect(matches(SHORTCUTS.search, press("K", { ctrlKey: true, shiftKey: true }), "terminal", "linux")).toBe(true);
    expect(matches(SHORTCUTS.search, press("k", { ctrlKey: true }), "terminal", "linux")).toBe(false);
    expect(matches(shortcut("^`"), press("`", { ctrlKey: true }, "Backquote"), "terminal", "linux")).toBe(true);
  });

  it("⌥ changes the character on macOS: the physical key still counts", () => {
    expect(matches(SHORTCUTS.heading1, press("¡", { metaKey: true, altKey: true }, "Digit1"), "app", "mac")).toBe(true);
    expect(matches(SHORTCUTS.heading1, press("1", { ctrlKey: true, altKey: true }, "Digit1"), "app", "linux")).toBe(true);
  });

  it("a symbol by its character ignores Shift; by its physical key, Shift must agree", () => {
    // A layout that needs Shift for "/".
    expect(matches(SHORTCUTS.toggleThread, press("/", { ctrlKey: true, shiftKey: true }, "Digit7"), "app", "linux")).toBe(true);
    // Canadian CSA types "é" on the US "/" key.
    expect(matches(SHORTCUTS.toggleThread, press("é", { metaKey: true }, "Slash"), "app", "mac")).toBe(true);
    // Shift on the "/" key is ⌘?, left to macOS Help.
    expect(matches(SHORTCUTS.toggleThread, press("?", { metaKey: true, shiftKey: true }, "Slash"), "app", "mac")).toBe(false);
    expect(matches(SHORTCUTS.flipSplit, press("\\", { ctrlKey: true }, "Backslash"), "app", "linux")).toBe(true);
  });
});

describe("showing the keys", () => {
  it("several shortcuts are one hint, a cap each", () => {
    const keys = [SHORTCUTS.bold, SHORTCUTS.italic, SHORTCUTS.underline];
    expect(keyLabel(keys, "mac")).toBe("⌘B ⌘I ⌘U");
    expect(keyLabel(keys, "linux")).toBe("Ctrl+B Ctrl+I Ctrl+U");
    expect(keyLabel("⌥H ⌥C", "linux")).toBe("⌥H ⌥C");
  });

  it("aria-keyshortcuts names the real modifier", () => {
    expect(ariaKeys(SHORTCUTS.lock, "mac")).toBe("Meta+L");
    expect(ariaKeys(SHORTCUTS.lock, "linux")).toBe("Control+L");
    expect(ariaKeys(SHORTCUTS.copyAndLog, "linux")).toBe("Control+Enter");
  });

  it("hints, tooltips and the Shortcuts popover show the Linux key on Linux", () => {
    setOs("linux");
    const everywhere = [
      { keys: "A", label: "Arsenal", priority: 1 },
      { keys: SHORTCUTS.search, label: "search", priority: 1 },
    ];
    render(
      <TooltipProvider>
        <HintUnit hint={{ keys: [SHORTCUTS.heading1, SHORTCUTS.paragraph], label: "heading", priority: 1 }} />
        <IconButton icon={Lock} label="Find" shortcut={SHORTCUTS.find} />
        <TitleBarIconButton icon={Lock} label="Lock" shortcut={SHORTCUTS.lock} />
        <TitleBarShortcuts everywhere={everywhere} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Ctrl+Alt+1")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Alt+0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock" })).toHaveAttribute("aria-keyshortcuts", "Control+L");
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
    const popover = screen.getByRole("region", { name: "Everywhere" });
    expect(popover).toHaveTextContent("Ctrl+K");
    expect(popover).not.toHaveTextContent("⌘");
  });

  it("and the macOS key on macOS, as drawn", () => {
    render(<HintUnit hint={{ keys: SHORTCUTS.redo, label: "redo", priority: 1 }} />);
    expect(screen.getByText("⇧⌘Z")).toBeInTheDocument();
  });
});
