import path from "node:path";
import type { Plugin } from "vite";

/**
 * Audit mode only: swaps `src/lib/api.ts` for the in-memory fake. Imports made from inside `src/audit/`
 * are left alone, so the fake can still `import type { Api } from "../lib/api"`.
 */
export function auditApiPlugin(): Plugin {
  let root = process.cwd();
  const realApi = () => path.join(root, "src", "lib", "api.ts");
  const fakeApi = () => path.join(root, "src", "audit", "fakeApi.ts");
  const auditDir = () => path.join(root, "src", "audit") + path.sep;
  return {
    name: "raven-audit-api",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(auditDir())) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && path.normalize(resolved.id.split("?")[0]) === realApi()) return fakeApi();
      return null;
    },
  };
}
