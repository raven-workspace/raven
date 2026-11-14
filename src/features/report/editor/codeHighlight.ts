import hljs from "highlight.js/lib/core";
import http from "highlight.js/lib/languages/http";
import json from "highlight.js/lib/languages/json";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import { Decoration } from "prosekit/pm/view";
import type { HighlightParser } from "prosekit/extensions/code-block";
// The findings code view registers the app's languages on the shared highlight.js core; the page adds the ones its
// evidence needs (raw HTTP, JSON, SQL, HTML).
import { LANGUAGES } from "../../findings/CodeView";

for (const [name, def] of Object.entries({ http, json, sql, xml })) if (!hljs.getLanguage(name)) hljs.registerLanguage(name, def);

const LABELS: Record<string, string> = {
  lua: "Lua",
  c: "C",
  python: "Python",
  bash: "Bash",
  powershell: "PowerShell",
  php: "PHP",
  javascript: "JavaScript",
  typescript: "TypeScript",
  ruby: "Ruby",
  go: "Go",
  http: "HTTP",
  json: "JSON",
  sql: "SQL",
  xml: "HTML / XML",
};

/** The languages a code block on the page can be set to, as the picker lists them ("" is plain text). */
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: "", label: "Plain text" },
  ...[...LANGUAGES.filter((l) => l !== "plaintext"), "http", "json", "sql", "xml"].map((value) => ({ value, label: LABELS[value] ?? value })),
];

/** Inline decorations for highlight.js's token spans over a code block's text, offset from `from`. */
function tokenDecorations(html: string, from: number): Decoration[] {
  const template = document.createElement("template");
  // highlight.js escapes the source text; its markup is only its own token spans.
  template.innerHTML = html;
  const out: Decoration[] = [];
  let at = from;
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      at += node.textContent?.length ?? 0;
      return;
    }
    if (!(node instanceof Element)) return;
    const start = at;
    node.childNodes.forEach(walk);
    if (node.className && at > start) out.push(Decoration.inline(start, at, { class: node.className }));
  };
  template.content.childNodes.forEach(walk);
  return out;
}

/** ProseKit's code-block highlight parser, backed by the app's highlight.js (no shiki): plain text stays plain. */
export const hljsParser: HighlightParser = ({ content, language, pos }) => {
  if (!language || !hljs.getLanguage(language)) return [];
  const { value } = hljs.highlight(content, { language, ignoreIllegals: true });
  return tokenDecorations(value, pos + 1);
};
