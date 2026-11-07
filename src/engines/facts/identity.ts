export interface ParsedIdentity {
  username?: string;
  privileges: string[];
  groups: string[];
}

const PRIV_VECTORS = [
  "SeImpersonatePrivilege",
  "SeAssignPrimaryTokenPrivilege",
  "SeBackupPrivilege",
  "SeRestorePrivilege",
  "SeDebugPrivilege",
  "SeLoadDriverPrivilege",
  "SeTakeOwnershipPrivilege",
  "SeManageVolumePrivilege",
];
const GROUP_VECTORS = ["sudo", "wheel", "docker", "lxd", "disk", "adm"];

function parsePrivileges(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(Se\w+)\s+.*\b(Enabled|Disabled)\s*$/.exec(line);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Rows of a `whoami` table: first column of each line after the `====` rule, up to a blank line. */
function tableFirstColumn(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const rule = lines.findIndex((l) => /^={3,}(\s+={3,})*\s*$/.test(l.trim()));
  if (rule < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(rule + 1)) {
    if (!line.trim()) break;
    out.push(line.trim().split(/\s{2,}/)[0]);
  }
  return out;
}

/** Splits `whoami /all` into its titled sections. */
function sections(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = output.split(/^([A-Z][A-Z ]+INFORMATION)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

function parseId(output: string): ParsedIdentity | null {
  const uid = /uid=\d+\(([^)]+)\)/.exec(output);
  if (!uid) return null;
  const groupsPart = /groups=(\S.*)$/m.exec(output)?.[1] ?? "";
  const groups = [...groupsPart.matchAll(/\d+\(([^)]+)\)/g)].map((m) => m[1]);
  return { username: uid[1], privileges: [], groups };
}

export function parseIdentity(command: string, output: string): ParsedIdentity | null {
  const cmd = command.trim().replace(/\s+/g, " ").toLowerCase();
  if (cmd === "id") return parseId(output);
  if (cmd === "whoami") {
    const name = output.split(/\r?\n/).find((l) => l.trim())?.trim();
    return name ? { username: name, privileges: [], groups: [] } : null;
  }
  if (cmd === "whoami /priv") return { privileges: parsePrivileges(output), groups: [] };
  if (cmd === "whoami /groups") return { privileges: [], groups: tableFirstColumn(output) };
  if (cmd === "whoami /all") {
    const s = sections(output);
    const username = tableFirstColumn(s["USER INFORMATION"] ?? "")[0];
    return {
      ...(username ? { username } : {}),
      privileges: parsePrivileges(s["PRIVILEGES INFORMATION"] ?? ""),
      groups: tableFirstColumn(s["GROUP INFORMATION"] ?? ""),
    };
  }
  return null;
}

export function vectorsFromIdentity(id: { privileges: string[]; groups: string[] }): string[] {
  const privs = PRIV_VECTORS.filter((p) => id.privileges.includes(p)).map((p) => `${p} abuse`);
  const groups = GROUP_VECTORS.filter((g) => id.groups.includes(g)).map((g) => `${g} group`);
  return [...privs, ...groups];
}
