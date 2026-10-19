import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";
import tseslint from "typescript-eslint";

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

export default defineConfig(
  {
    ignores: [
      "coverage/",
      "dist/",
      "site/iframe/inside-the-firewall/",
      "site/vendor/",
    ],
  },
  {
    files: ["eslint.config.mjs"],
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
    files: [
      "site/apps/index.js",
      "site/apps/catalog/**/*.js",
      "site/apps/core/**/*.js",
      "site/apps/programs/**/*.js",
      "site/apps/system/**/*.js",
      "site/apps/notepad/**/*.js",
      "site/apps/task-manager/**/*.js",
      "site/apps/paint/index.js",
      "site/apps/pinball/index.js",
    ],
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
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettier,
);
