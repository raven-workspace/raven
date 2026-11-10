import type { PayloadDef } from "./types";

/**
 * The exam limits Metasploit (Meterpreter) to one machine; msfvenom, multi/handler and raw shells are
 * unrestricted. Only `breach: true` is a warning; `breach: false` is information.
 */
export function msfLockLine(input: {
  exam: boolean; def: Pick<PayloadDef, "meterpreter">; hostId: string | null; msfHostId: string | null; hostName: (id: string) => string;
}): { text: string; breach: boolean } | null {
  const { exam, def, hostId, msfHostId, hostName } = input;
  if (!exam || !def.meterpreter) return null;
  if (msfHostId === hostId) return null;
  if (msfHostId === null) return { text: "Using Meterpreter here makes this your Metasploit machine", breach: false };
  return { text: `Metasploit is locked to ${hostName(msfHostId)}`, breach: true };
}
