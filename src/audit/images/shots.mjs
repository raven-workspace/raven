// Renders the mock exam's screenshots (terminal windows and one browser page) from src/audit/examTexts.ts into
// shots/<key>.png, then runs make.py, which embeds them in index.ts. Synthetic text only.
// Run: node --experimental-strip-types src/audit/images/shots.mjs
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { EXAM_SHOTS } from "../examTexts.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = `${HERE}shots/`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const page = (shot) => {
  const bar = `<div class="bar"><i></i><i></i><i></i><span>${esc(shot.title)}</span></div>`;
  if (shot.kind === "terminal") {
    return `<div class="win term">${bar}<pre>${esc(shot.text)}</pre></div>`;
  }
  // A login page: the first line is the product and version, the third the form's heading.
  const [brand, , heading] = shot.text.split("\n");
  return `<div class="win browser">${bar}<div class="site"><div class="card"><p class="brand">${esc(brand)}</p>
    <h1>${esc(heading)}</h1><label>Email<input></label><label>Password<input type="password"></label>
    <button>SIGN IN</button><p class="muted">Forgotten password?</p></div></div></div>`;
};

const CSS = `
  body { margin: 0; background: #fff; }
  .win { width: 920px; border-radius: 8px; overflow: hidden; font-family: Menlo, "DejaVu Sans Mono", monospace; }
  .bar { height: 32px; display: grid; grid-template-columns: 14px 14px 14px minmax(0,1fr); gap: 8px; align-items: center; padding: 0 12px; }
  .bar i { width: 12px; height: 12px; border-radius: 50%; background: #5c5c66; }
  .bar span { font: 13px -apple-system, "Helvetica Neue", sans-serif; text-align: center; padding-right: 66px; }
  .term { background: #16161d; color: #d7dae0; }
  .term .bar { background: #2a2a33; color: #b8bcc6; }
  pre { margin: 0; padding: 16px 20px 20px; font: 15px/1.45 Menlo, "DejaVu Sans Mono", monospace; white-space: pre-wrap; }
  .browser { background: #f1f1f4; color: #1b1b1f; }
  .browser .bar { background: #dedee3; color: #3a3a40; }
  .browser .bar span { background: #fff; border-radius: 6px; padding: 4px 10px; text-align: left; font-family: Menlo, monospace; }
  .site { height: 560px; display: grid; place-items: center; background: #34507d; font-family: -apple-system, "Helvetica Neue", sans-serif; }
  .card { width: 380px; background: #fff; border-radius: 6px; padding: 28px 32px; display: grid; gap: 12px; }
  .brand { margin: 0; font-size: 13px; color: #6b6b75; letter-spacing: .04em; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  label { display: grid; gap: 4px; font-size: 13px; color: #44444c; }
  input { height: 30px; border: 1px solid #c8c8d0; border-radius: 4px; }
  button { height: 36px; border: 0; border-radius: 4px; background: #2bc37c; color: #fff; font-weight: 600; letter-spacing: .06em; }
  .muted { margin: 0; font-size: 12px; color: #6b6b75; }
`;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 920, height: 600 }, deviceScaleFactor: 1 });
for (const [key, shot] of Object.entries(EXAM_SHOTS)) {
  await tab.setContent(`<!doctype html><style>${CSS}</style>${page(shot)}`);
  await tab.locator(".win").screenshot({ path: `${OUT}${key}.png` });
}
await browser.close();
execFileSync("python3", [`${HERE}make.py`], { stdio: "inherit" });
