import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../audit-output/", import.meta.url));

/** Starts every run from empty issues/, shots/ and no report, so stale files never reach the report. */
export default async function globalSetup(): Promise<void> {
  for (const f of ["report.json", "report.md"]) await rm(`${OUT}${f}`, { force: true });
  for (const d of ["issues", "shots"]) {
    await rm(`${OUT}${d}`, { recursive: true, force: true });
    await mkdir(`${OUT}${d}`, { recursive: true });
  }
}
