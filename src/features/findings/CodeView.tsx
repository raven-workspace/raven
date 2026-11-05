import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import lua from "highlight.js/lib/languages/lua";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import typescript from "highlight.js/lib/languages/typescript";
import { useMemo } from "react";

const REGISTERED = { lua, c, python, bash, powershell, php, javascript, typescript, ruby, go, plaintext };
for (const [name, def] of Object.entries(REGISTERED)) hljs.registerLanguage(name, def);

export const LANGUAGES = Object.keys(REGISTERED);

const EXTENSIONS: Record<string, string> = {
  lua: "lua", c: "c", h: "c", py: "python", sh: "bash", ps1: "powershell", php: "php",
  js: "javascript", ts: "typescript", rb: "ruby", go: "go", txt: "plaintext",
};

/** The language a file name suggests; plaintext when the extension is unknown. */
export function guessLanguage(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot >= 0 && EXTENSIONS[name.slice(dot + 1).toLowerCase()]) || "plaintext";
}

/** Highlighted, read-only code. The markup comes from highlight.js, which escapes the source text. */
export function CodeView({ code, language }: { code: string; language: string }) {
  const lang = hljs.getLanguage(language) ? language : "plaintext";
  const html = useMemo(() => hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, [code, lang]);
  return (
    <pre className="m-0 max-h-[320px] overflow-auto rounded-sm border border-line bg-bg p-2.5 text-[12px] leading-[1.5]">
      {/* highlight.js output is escaped HTML; raw file content never reaches the DOM unescaped. */}
      <code className={`hljs language-${lang}`} dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
