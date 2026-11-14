// The local ESLint rules, on samples and on the real test files.
import { expect, test } from "bun:test";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { localRules } from "../tools/lint-rules.mjs";

const lint = (code: string, rule = "expect-needs-matcher") =>
  new Linter({ configType: "flat" })
    .verify(
      code,
      [
        {
          files: ["**/*.ts"],
          languageOptions: { parser: tseslint.parser },
          plugins: { local: localRules },
          rules: { [`local/${rule}`]: "error" },
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

test("await-async-expect finds each .rejects or .resolves check that no one waits for", () => {
  expect(
    lint(
      [
        "expect(p).rejects.toThrow();",
        "expect(p).resolves.toBe(1);",
        "expect(p).resolves.not.toBe(1);",
        "const pending = expect(p).rejects.toThrow();",
        "[expect(p).rejects.toThrow()];",
        "function f() { expect(p).rejects.toThrow(); }",
        "expect(p).rejects;",
        "await expect(p).rejects.toThrow();",
        "await expect(p).resolves.not.toBe(1);",
        "function g() { return expect(p).rejects.toThrow(); }",
        "const h = () => expect(p).resolves.toBe(1);",
        "await expect(p).rejects;",
        "expect(p).toBe(1);",
        "expect(p)[rejects].toThrow();",
        "expect(p).not.toBe(1);",
      ].join("\n"),
      "await-async-expect",
    ),
  ).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

test("await-async-expect follows the check through variables, arrays and callbacks", () => {
  expect(
    lint(
      [
        // Lost: forEach and other calls drop what the callback gives.
        "promises.forEach((p) => expect(p).resolves.toBe(1));",
        "setTimeout(() => expect(p).rejects.toThrow());",
        "promises.map((p) => expect(p).resolves.toBe(1));",
        "const c = expect(p).rejects.toThrow(); c;",
        "Promise.all([expect(p).resolves.toBe(1)]);",
        "await Promise.all(x, [expect(p).resolves.toBe(1)]);",
        "await other([expect(p).resolves.toBe(1)]);",
        "await Promise.all(promises.filter((p) => expect(p).resolves.toBe(1)));",
        "(() => expect(p).resolves.toBe(1))();",
        "await Promise.all(promises.map(f, (p) => expect(p).resolves.toBe(1)));",
        // Lost: allSettled, any and race do not fail on each rejection.
        "await Promise.allSettled(promises.map((p) => expect(p).resolves.toBe(1)));",
        "await Promise.any([expect(a).resolves.toBe(1)]);",
        "await Promise.race([expect(a).resolves.toBe(1)]);",
        // Lost: a return in a forEach callback, and a function that is
        // called with no wait.
        "promises.forEach((p) => { return expect(p).resolves.toBe(1); });",
        "const f1 = () => expect(p).resolves.toBe(1); f1();",
        "function f2() { return expect(p).resolves.toBe(1); } f2();",
        "const f3 = function () { return expect(p).resolves.toBe(1); }; f3();",
        // Waited for.
        "await Promise.all([expect(a).resolves.toBe(1)]);",
        "const d = expect(p).rejects.toThrow(); await d;",
        "const e = [expect(p).rejects.toThrow()]; await Promise.all(e);",
        "return Promise.all([expect(a).resolves.toBe(1)]);",
        'test("x", () => expect(p).resolves.toBe(1));',
        'test.only("x", () => expect(p).resolves.toBe(1));',
        "const g = expect(p).rejects.toThrow(); const k = g; await k;",
        "const f4 = () => expect(p).resolves.toBe(1); await f4();",
        "function f5() { return expect(p).resolves.toBe(1); } await f5();",
        "await Promise.all(promises.map((p) => { return expect(p).resolves.toBe(1); }));",
        "return expect(p).resolves.toBe(1);",
      ].join("\n"),
      "await-async-expect",
    ),
  ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

test("the lint config runs the test rules on every test file", async () => {
  const eslint = new ESLint();
  const files = [...new Bun.Glob("{tests,scripts}/**/*.test.ts").scanSync(".")];
  expect(files).toContain("scripts/mutants.test.ts");
  for (const file of files) {
    const config = await eslint.calculateConfigForFile(file);
    expect([
      file,
      config.rules["local/expect-needs-matcher"],
      config.rules["local/await-async-expect"],
    ]).toEqual([file, [2], [2]]);
  }
});
