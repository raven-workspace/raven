export interface PlaybookItem {
  file: string;
  heading?: string;
  text: string;
}

/**
 * The `- [ ]` items of a playbook note. `text` has the checkbox, the `→ [[…]]` tail and wiki-link brackets
 * removed and whitespace collapsed, so it can be compared exactly.
 */
export function parsePlaybook(relPath: string, text: string): PlaybookItem[] {
  const items: PlaybookItem[] = [];
  let heading: string | undefined;
  let inFence = false;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (h) {
      heading = h[1];
      continue;
    }
    const item = /^\s*[-*]\s+\[[ xX]\]\s+(.*)$/.exec(line);
    if (!item) continue;
    const cleaned = item[1]
      .replace(/\s*→.*$/, '')
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) items.push({ file: relPath, heading, text: cleaned });
  }
  return items;
}
