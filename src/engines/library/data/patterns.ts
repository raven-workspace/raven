/**
 * Regex sources and bin lists shared by the built-in matchers.
 * The matcher compiles every source case-insensitively and only sees the line up to the first
 * unquoted `;`, `&&`, `|`, `||` or ` #` (src/utils/checklist/matcher.ts), so patterns never rely on flag case.
 */

/** `-u ''`, `-u ""`, `-u guest`, `-u anonymous` (quoted or not): a null or guest session. */
export const NULL_USER = String.raw`(^|\s)-u\s*(''|""|'guest'|"guest"|guest|'anonymous'|"anonymous"|anonymous)(?=\s|$)`;
/** `-p ''` / `-p ""`: an empty password. */
export const EMPTY_PASS = String.raw`(^|\s)-p\s*(''|"")(?=\s|$)`;
/** nxc protocol words. */
export const NXC_SMB = String.raw`(^|\s)smb(?=\s)`;
export const NXC_LDAP = String.raw`(^|\s)ldap(?=\s)`;
export const NXC_MSSQL = String.raw`(^|\s)mssql(?=\s)`;
/** nmap UDP scan type (`-sU`, `-sSU`). */
export const NMAP_UDP = String.raw`(^|\s)-s[a-z]*u[a-z]*(?=\s|$)`;

/** Windows binary names as firstBinary sees them: `name`, `name.exe` and `.\name.exe`, lower-case. */
export const exe = (...names: string[]): string[] =>
  names.flatMap((n) => {
    const base = n.toLowerCase().replace(/\.exe$/, '');
    return [base, `${base}.exe`, `.\\${base}.exe`];
  });

/** Impacket entry points as installed on Kali (`impacket-x`) and from the repo (`x.py`). */
export const impacket = (name: string): string[] => [`impacket-${name.toLowerCase()}`, `${name.toLowerCase()}.py`];
