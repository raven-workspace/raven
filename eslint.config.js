import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules", "test-results", "playwright-report", "audit-output"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Feature code composes Raven's primitives (src/ui); the stock shadcn pieces they wrap or replace are off limits.
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^@/|/)ui/shadcn/(button|input|skeleton|sheet|toggle|tooltip)$",
              message:
                "Use the Raven primitives in src/ui (Button, IconButton, Input, LoadingState, Dialog, Toggle, Tooltip): they carry Raven's sizes, type roles and keyboard tooltips.",
            },
          ],
        },
      ],
    },
  },
);
