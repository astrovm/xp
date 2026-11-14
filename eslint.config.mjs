import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";
import tseslint from "typescript-eslint";
import { localRules } from "./tools/lint-rules.mjs";

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(
  join(projectDirectory, "site/index.html"),
  "utf8",
);
const classicScriptPaths = [
  ...indexHtml.matchAll(/<script(?: defer)? src="(js\/[^"]+\.js)"/g),
]
  .map((match) => match[1])
  .filter((path) => path !== "js/ruffle.js");
const sharedDeclarations = new Set();
for (const path of classicScriptPaths) {
  const source = readFileSync(join(projectDirectory, "site", path), "utf8");
  for (const match of source.matchAll(
    /^(?:const|let|var|function)\s+([$A-Z_a-z][$\w]*)/gm,
  )) {
    sharedDeclarations.add(match[1]);
  }
}
const sharedGlobals = Object.fromEntries(
  [...sharedDeclarations].map((name) => [name, "writable"]),
);
const sharedDeclarationPattern = `^(?:${[...sharedDeclarations]
  .map((name) => name.replaceAll("$", "\\$"))
  .join("|")})$`;

// The test files. The test lint rules check each of them.
export const TEST_FILES = ["tests/**/*.ts", "scripts/**/*.test.ts"];

export default defineConfig(
  {
    ignores: [
      "coverage/",
      ".stryker-tmp/",
      "reports/",
      "build/",
      "dist/",
      // A build stages its output here before it replaces dist/.
      ".dist-build-*/",
      "site/iframe/inside-the-firewall/",
      // Emscripten builds this file. SOURCES.json names its source.
      "site/apps/pinball/runtime/",
      "site/vendor/",
    ],
  },
  {
    files: ["eslint.config.mjs", "tools/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["site/js/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        ...sharedGlobals,
        XPDialogs: "readonly",
      },
    },
    rules: {
      // These classic scripts intentionally share one global lexical scope.
      // The behavioral harness concatenates them and catches duplicate names.
      "no-redeclare": "off",
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          varsIgnorePattern: sharedDeclarationPattern,
        },
      ],
    },
  },
  {
    files: ["site/apps/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      "no-unused-vars": ["error", { args: "none" }],
    },
  },
  {
    files: ["worker/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { ...globals.browser, module: "readonly" },
    },
    rules: {
      "no-unused-vars": ["error", { varsIgnorePattern: "^_" }],
    },
  },
  {
    files: [
      "catalog/**/*.ts",
      "scripts/**/*.ts",
      "tests/**/*.ts",
      "tools/**/*.ts",
      "worker/**/*.ts",
      "precache-config.ts",
    ],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.bunBuiltin,
        ...globals.node,
        ...globals.worker,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Every file that bun test runs, in tests/ and next to the scripts.
    files: TEST_FILES,
    plugins: { local: localRules },
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // An expect(...) with no matcher passes and checks nothing.
      "local/expect-needs-matcher": "error",
      // A .rejects or .resolves check that the test does not wait for
      // checks nothing in time.
      "local/await-async-expect": "error",
    },
  },
  prettier,
);
