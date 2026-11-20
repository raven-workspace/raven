// Usage: node twdead.mjs '<component classes>' '<caller classes>'
// Prints caller classes that are dead: a component class sets the same property under the same condition and comes
// later in Tailwind's emitted CSS (so it won). Under the SCSS layering such a caller class would start winning.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const tw = await import(createRequire(root + "/package.json").resolve("tailwindcss"));
const compile = tw.compile ?? tw.default.compile;
const MAP = { "tailwindcss": "tailwindcss/index.css", "tw-animate-css": "tw-animate-css/dist/tw-animate.css", "shadcn/tailwind.css": "shadcn/dist/tailwind.css" };
const css = await readFile(root + "/src/styles/global.css", "utf8");
const c = await compile(css, { base: root + "/src/styles", loadStylesheet: async (id, base) => {
  const p = id.startsWith(".") ? path.resolve(base, id) : path.join(root, "node_modules", MAP[id] ?? id);
  return { path: p, base: path.dirname(p), content: await readFile(p, "utf8") };
}});
const comp = process.argv[2].split(/\s+/).filter(Boolean), caller = process.argv[3].split(/\s+/).filter(Boolean);
const out = c.build([...new Set([...comp, ...caller])]);
const util = out.slice(out.indexOf("@layer utilities"));
// Walk rules, tracking at-rule context.
const rules = []; let i = 0; const ctx = []; let idx = 0;
const esc = (cls) => "." + cls.replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
while (i < util.length) {
  const open = util.indexOf("{", i), close = util.indexOf("}", i);
  if (close !== -1 && (open === -1 || close < open)) { ctx.pop(); i = close + 1; continue; }
  if (open === -1) break;
  const head = util.slice(i, open).trim();
  if (head.startsWith("@")) { ctx.push(head); i = open + 1; continue; }
  const end = util.indexOf("}", open);
  const body = util.slice(open + 1, end);
  const props = [...body.matchAll(/([-a-z]+)\s*:/g)].map((m) => m[1]).filter((p) => !p.startsWith("--tw"));
  rules.push({ sel: head, props, cond: ctx.filter((x) => !x.startsWith("@layer")).join(" "), idx: idx++ });
  i = end + 1;
}
const info = (cls) => rules.filter((r) => r.sel.split(",").some((s) => s.trim().startsWith(esc(cls))))
  .map((r) => ({ ...r, cond: r.cond + " " + r.sel.split(",")[0].trim().slice(esc(cls).length) }));
const LONG = { padding: ["padding-top","padding-right","padding-bottom","padding-left"], "padding-inline": ["padding-left","padding-right"], "padding-block": ["padding-top","padding-bottom"],
  margin: ["margin-top","margin-right","margin-bottom","margin-left"], "margin-inline": ["margin-left","margin-right"], "margin-block": ["margin-top","margin-bottom"],
  gap: ["row-gap","column-gap"], inset: ["top","right","bottom","left"], "inset-inline": ["left","right"], "inset-block": ["top","bottom"],
  "border-width": ["border-top-width","border-right-width","border-bottom-width","border-left-width"], overflow: ["overflow-x","overflow-y"], "place-items": ["align-items","justify-items"], "place-content": ["align-content","justify-content"] };
const expand = (p) => LONG[p] ?? [p];
const overlap = (a, b) => a.some((p) => b.some((q) => expand(p).some((x) => expand(q).includes(x))));
const dead = [];
for (const k of caller) {
  for (const r of info(k)) for (const ci of comp) for (const q of info(ci))
    if (q.cond === r.cond && q.idx > r.idx && overlap(r.props, q.props))
      dead.push(`${k} (loses to ${ci})`);
}
console.log([...new Set(dead)].join("\n") || "none");
