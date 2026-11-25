import type { LibraryCommand } from "../../engines/library/types";

/** A library command for a test: an operator command named by its id unless `over` says otherwise. */
export const libraryCommand = (id: string, over: Partial<LibraryCommand> = {}): LibraryCommand => ({
  id, title: id, tool: "x", template: "x", os: "any", runFrom: "attacker", goals: [], source: "operator", ...over,
});

/** A small library engine tests pass in place of the built-ins: one matcher, for `nmap -p-`. */
export const TEST_LIBRARY: LibraryCommand[] = [
  libraryCommand("test-nmap-full", {
    title: "Scan every TCP port", tool: "nmap", template: "sudo nmap -p- {TARGET_IP}", goals: ["h-enum-full-tcp"],
    match: { bins: ["nmap"], any: [String.raw`(^|\s)-p-(?=\s|$)`] },
  }),
];
