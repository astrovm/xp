// The local ESLint rules, on samples and on the real test files.
import { expect, test } from "bun:test";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { localRules } from "../tools/lint-rules.mjs";

const lint = (code: string) =>
  new Linter({ configType: "flat" })
    .verify(
      code,
      [
        {
          files: ["**/*.ts"],
          languageOptions: { parser: tseslint.parser },
          plugins: { local: localRules },
          rules: { "local/expect-needs-matcher": "error" },
        },
      ],
      "sample.test.ts",
    )
    .map((problem) => problem.line);

test("expect-needs-matcher finds each expect(...) with no matcher call", () => {
  expect(
    lint(
      [
        "expect(a);",
        "expect(a).toBe;",
        "expect(a).not;",
        "await expect(p).resolves;",
        "const pending = expect(a);",
        "expect(a).toBe(1);",
        "expect(a).not.toBeNull();",
        "await expect(p).rejects.toThrow();",
        "expect.assertions(1);",
        "other(a);",
        "expect(a)[name]();",
      ].join("\n"),
    ),
  ).toEqual([1, 2, 3, 4, 5]);
});

test("the lint config runs expect-needs-matcher on every test file", async () => {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile("tests/any.test.ts");
  expect(config.rules["local/expect-needs-matcher"]).toEqual([2]);
});
