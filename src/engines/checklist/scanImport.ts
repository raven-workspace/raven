/** `# Nmap 7.94 scan initiated Mon Nov  2 10:00:00 2026 as: nmap -p- -oN full.nmap 10.10.10.5` (-oN / -oG header). */
const NMAP_HEADER = /^#\s*Nmap\s.*?\bas:\s*(.+)$/i;
/** `<nmaprun scanner="nmap" args="nmap -p- 10.10.10.5" …>` (-oX). */
const NMAP_XML_ARGS = /<nmaprun\b[^>]*\sargs="([^"]*)"/i;
const decodeXml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Only scan provenance: the nmap `as:` header and the XML `args` attribute. Typed-looking output lines are not commands. */
export function scanProvenanceLines(text: string): string[] {
  const out: string[] = [];
  const xml = text.match(NMAP_XML_ARGS);
  if (xml) out.push(decodeXml(xml[1]).trim());
  for (const raw of text.split(/\r?\n/)) {
    const header = raw.trim().match(NMAP_HEADER);
    if (header) out.push(header[1].trim());
  }
  return out.filter(Boolean);
}
