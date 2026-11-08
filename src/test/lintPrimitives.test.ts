import { ESLint } from "eslint";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const eslint = new ESLint({ cwd: ROOT });

async function restricted(file: string, code: string): Promise<string[]> {
  const [r] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return r!.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

describe("features use Raven primitives, not stock shadcn pieces", () => {
  it("bans the stock pieces Raven wraps, by alias and relative path", async () => {
    for (const piece of ["button", "input", "skeleton", "sheet", "toggle", "tooltip"]) {
      const viaAlias = await restricted("src/features/x/X.tsx", `import { A } from "@/ui/shadcn/${piece}";\nexport const a = A;\n`);
      const viaPath = await restricted("src/features/x/X.tsx", `import { A } from "../../ui/shadcn/${piece}";\nexport const a = A;\n`);
      expect(viaAlias, piece).toHaveLength(1);
      expect(viaPath, piece).toHaveLength(1);
      expect(viaAlias[0]).toMatch(/src\/ui/);
    }
  }, 30_000);

  it("allows the shadcn pieces Raven has no primitive for, and src/ui itself", async () => {
    for (const piece of ["sidebar", "tabs", "toggle-group", "separator"])
      expect(await restricted("src/features/x/X.tsx", `import { A } from "../../ui/shadcn/${piece}";\nexport const a = A;\n`), piece).toEqual([]);
    expect(await restricted("src/ui/X.tsx", `import { A } from "./shadcn/tooltip";\nexport const a = A;\n`)).toEqual([]);
  }, 30_000);
});
