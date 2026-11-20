/** Escapes `s` so it matches literally inside a RegExp. */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
