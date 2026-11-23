// Exports the exam fixture's report the way the owner does (Report, Export PDF) in the audit app, then compiles what
// the button sent with the real backend and draws every page of the PDF, to judge it as a grader would (RAV-28).
// Start the audit app first (`npm run dev:audit`), then:
//   node audit/export-report.mjs <out folder>
// It writes export.json, the PDF and .7z, and pages/p<n>.png. Synthetic fixture data only.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webkit } from "playwright";

const out = resolve(process.argv[2] ?? "audit-output/export");
const port = process.env.AUDIT_PORT ?? "5199";
const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${out}/pages`, { recursive: true });

// WebKit at 1400px, as the page itself is judged.
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`http://localhost:${port}/e/e-exam/s/report`);
await page.getByRole("button", { name: "Export PDF" }).click();
const panel = page.getByRole("dialog", { name: "Exported" });
await panel.waitFor();
// Past the dialog's fade-in, so the shot shows the panel as the owner reads it.
await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].every((d) => d.getAnimations({ subtree: true }).every((a) => a.playState !== "running")));
await panel.screenshot({ path: `${out}/result-panel.png` });
const captured = await page.evaluate(() => globalThis.__ravenLastExport);
await browser.close();
writeFileSync(`${out}/export.json`, JSON.stringify(captured));
writeFileSync(`${out}/report.typ`, captured.input.source);

const result = execFileSync("cargo", ["run", "--quiet", "--example", "export_report", "--", `${out}/export.json`, out], {
  cwd: `${root}/src-tauri`,
  encoding: "utf8",
});
console.log(result);
const pdf = JSON.parse(result).pdfPath;
execFileSync("swift", [`${root}/audit/pdf-pages.swift`, pdf, `${out}/pages`], { stdio: "inherit" });
