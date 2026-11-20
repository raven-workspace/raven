// Usage (from the repo root): node scripts/tailwind-migration/twcss.mjs "class list"
// Prints the CSS Tailwind emits for those classes under Raven's theme (src/styles/global.css): the exact declarations,
// variants and their order, which is what an SCSS conversion must reproduce.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const tw = await import(createRequire(root + "/package.json").resolve("tailwindcss"));
const compile = tw.compile ?? tw.default.compile;
const MAP = {
  tailwindcss: "tailwindcss/index.css",
  "tw-animate-css": "tw-animate-css/dist/tw-animate.css",
  "shadcn/tailwind.css": "shadcn/dist/tailwind.css",
};
const css = await readFile(root + "/src/styles/global.css", "utf8");
const c = await compile(css, {
  base: root + "/src/styles",
  loadStylesheet: async (id, base) => {
    const p = id.startsWith(".") ? path.resolve(base, id) : path.join(root, "node_modules", MAP[id] ?? id);
    return { path: p, base: path.dirname(p), content: await readFile(p, "utf8") };
  },
});
const out = c.build(process.argv[2].split(/\s+/).filter(Boolean));
const start = out.indexOf("@layer utilities");
let depth = 0, end = start;
for (let i = out.indexOf("{", start); i < out.length; i++) {
  if (out[i] === "{") depth++;
  else if (out[i] === "}" && --depth === 0) { end = i + 1; break; }
}
console.log(out.slice(start, end));
