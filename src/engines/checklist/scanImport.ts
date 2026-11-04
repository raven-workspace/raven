/** `# Nmap 7.94 scan initiated Mon Nov  2 10:00:00 2026 as: nmap -p- -oN full.nmap 10.10.10.5` (-oN / -oG header). */
const NMAP_HEADER = /^#\s*Nmap\s.*?\bas:\s*(.+)$/i;
/** `<nmaprun scanner="nmap" args="nmap -p- 10.10.10.5" …>` (-oX). */
const NMAP_XML_ARGS = /<nmaprun\b[^>]*\sargs="([^"]*)"/i;
/** A shell prompt before a pasted command: `kali@kali:~$ `, `└─$ `, `└─# `, `$ `, `# `, `❯ `, `PS C:\> `. */
const PROMPT = /^(?:\S*@\S*?[:\s]\S*\s*[$#]|└─+[$#]|PS\s+\S*>|[$#❯%>])\s*/;

const decodeXml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * The command lines a pasted scan says it came from: the nmap `as:` header, the XML `args` attribute, and any
 * line that reads as a typed command (after an optional prompt it starts with a lower-case word, which scan
 * output lines like `Nmap scan report`, `PORT`, `Host:` or `|_http-title` never do).
 */
export function scanCommandLines(scanText: string): string[] {
  const out: string[] = [];
  const xml = scanText.match(NMAP_XML_ARGS);
  if (xml) out.push(decodeXml(xml[1]).trim());
  for (const raw of scanText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(NMAP_HEADER);
    if (header) {
      out.push(header[1].trim());
      continue;
    }
    // `# Nmap done at …` and other comments; `# nmap …` is a root prompt.
    if (line.startsWith('#') && !/^#\s*[a-z]/.test(line)) continue;
    const typed = line.replace(PROMPT, '');
    if (/^[a-z]/.test(typed)) out.push(typed);
  }
  return out.filter(Boolean);
}
