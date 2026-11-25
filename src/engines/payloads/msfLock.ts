import { examScope, examVerdict, examWarning } from "../exam";
import type { PayloadDef } from "./types";

/**
 * The exam limits Metasploit (Meterpreter) to one machine; msfvenom, multi/handler and raw shells are
 * unrestricted. A Meterpreter payload is judged as a Metasploit command by the exam rules, and the line is that
 * verdict's warning. Only `breach: true` is a warning; `breach: false` is information.
 */
export function msfLockLine(input: {
  exam: boolean; def: Pick<PayloadDef, "meterpreter">; hostId: string | null; msfHostId: string | null; hostName: (id: string) => string;
}): { text: string; breach: boolean } | null {
  const { exam, def, hostId, msfHostId, hostName } = input;
  const scope = examScope({ kind: exam ? "exam-sim" : "lab", msfHostId }, hostId);
  return examWarning(examVerdict(def.meterpreter ? { exam: "metasploit" } : {}, scope), scope, hostName);
}
