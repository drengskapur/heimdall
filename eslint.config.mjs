import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "dist/**",
    "app/lib/generated/**",
    "node_modules/**",
    ".stryker-tmp/**",
    "reports/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "ground-truth/**",
  ]),

  // All TypeScript — application, server, and tests — using the TS parser.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // The ported UI leans on structural casts at the generated seams and on
      // reference typings in the fidelity specs; keep these as signal (warn)
      // rather than hard failures.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "no-control-regex": "off",
      "no-irregular-whitespace": "off",
      "no-async-promise-executor": "warn",
    },
  },

  // React hooks / fast-refresh rules apply to the UI only.
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // Three modules deliberately pair a data table with the small cells that
  // render it: RESOURCES with NsCell, DETAIL_SECTIONS with its section
  // renderers, and the port-forward store with its view. Splitting each in two
  // would scatter one concept across two files to satisfy a hint that only
  // affects Fast Refresh during development. The rule is off for exactly these,
  // which is what lets `--max-warnings 0` hold everywhere else — a warning that
  // can never fail the build is decoration.
  {
    files: [
      "app/ui/resource/registry.tsx",
      "app/ui/resource/detail-sections.tsx",
      "app/ui/resource/port-forward-view.tsx",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },

  // Node ESM scripts and servers (.mjs) — plain JS, Node globals.
  {
    files: ["**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      // Node scripts, but the fidelity tooling embeds browser-context functions
      // (page.evaluate bodies), so browser globals are expected here too.
      // `axe` is one of those: scripts/a11y.mjs injects axe-core into the page
      // before evaluating against it, so it is defined at the point of use even
      // though nothing in this file declares it.
      globals: { ...globals.node, ...globals.browser, axe: "readonly" },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "no-control-regex": "off",
      "no-async-promise-executor": "warn",
    },
  },
]);
