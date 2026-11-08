// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[([0-9;]*)m/g

/** Strip ANSI SGR colour codes and turn CRLF into LF. */
export function normalize(output: string): string {
  return output.replace(SGR, '').replace(/\r\n/g, '\n')
}

/** True when one SGR sequence sets a red foreground and a yellow background (nxc's "pwned" marker). */
export function hasRedOnYellow(raw: string): boolean {
  for (const m of raw.matchAll(SGR)) {
    const p = m[1].split(';')
    if ((p.includes('31') || p.includes('91')) && (p.includes('43') || p.includes('103'))) return true
  }
  return false
}

export const NT_HASH = /^[0-9a-fA-F]{32}$/
/** NT hash of an empty password: carries no credential. */
export const EMPTY_NT = '31d6cfe0d16ae931b73c59d7e0c089c0'
/** True for a real, non-empty NT hash. */
export const isUsableNt = (h: string): boolean => NT_HASH.test(h) && h.toLowerCase() !== EMPTY_NT
