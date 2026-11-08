import { sqlQuote, urlEncodeShell } from "./encode";

export type PasteContext =
  | "bash-prompt" | "injected-linux" | "url-param" | "php-system" | "cmd"
  | "powershell" | "webshell-param" | "sql-string" | "macro";

type Os = "linux" | "windows";

export const PASTE_CONTEXTS: { id: PasteContext; label: string; os: Os | "any" }[] = [
  { id: "bash-prompt", label: "Bash prompt", os: "linux" },
  { id: "injected-linux", label: "Injected command (Linux)", os: "linux" },
  { id: "url-param", label: "URL / form parameter", os: "any" },
  { id: "php-system", label: "PHP system()", os: "linux" },
  { id: "cmd", label: "cmd.exe", os: "windows" },
  { id: "powershell", label: "PowerShell prompt", os: "windows" },
  { id: "webshell-param", label: "Web shell ?cmd=", os: "any" },
  { id: "sql-string", label: "Inside a SQL string", os: "any" },
  { id: "macro", label: "Office macro", os: "windows" },
];

/** Single-quotes for bash -c; an embedded ' becomes '\'' . */
const bashC = (cmd: string) => `bash -c '${cmd.replace(/'/g, `'\\''`)}'`;

interface Wrapper {
  apply: (cmd: string, os: Os) => string;
  note: (os: Os) => string;
}

const urlWrap: Wrapper = {
  apply: (cmd, os) => urlEncodeShell(os === "linux" ? bashC(cmd) : cmd),
  note: (os) => (os === "linux" ? "Wrapped in bash -c '...', then URL-encoded (spaces as +)." : "URL-encoded (spaces as +)."),
};

const WRAPPERS: Record<PasteContext, Wrapper> = {
  "bash-prompt": { apply: (c) => c, note: () => "Pasted as-is at a real bash prompt." },
  "injected-linux": { apply: bashC, note: () => "Wrapped in bash -c '...' because the injection point is not a bash prompt." },
  "url-param": urlWrap,
  "webshell-param": urlWrap,
  "php-system": {
    apply: (c) => `system('${c.replace(/[\\']/g, "\\$&")}');`,
    note: () => "Placed in a single-quoted PHP string; \\ and ' escaped.",
  },
  cmd: { apply: (c) => c, note: () => "Pasted as-is at cmd.exe." },
  powershell: { apply: (c) => c, note: () => "Pasted as-is at a PowerShell prompt." },
  "sql-string": { apply: sqlQuote, note: () => "Single quotes doubled for a SQL string literal." },
  macro: { apply: (c) => c.replace(/"/g, '""'), note: () => 'Double quotes doubled for a VBA string literal.' },
};

/** Rewrites a payload so it works as pasted in the given context. */
export function wrapForContext(cmd: string, ctx: PasteContext, os: Os): { text: string; notes: string[] } {
  const w = WRAPPERS[ctx];
  return { text: w.apply(cmd, os), notes: [w.note(os)] };
}
