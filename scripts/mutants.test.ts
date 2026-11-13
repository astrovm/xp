import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { resolve } from "node:path";
import { isCovered } from "../tests/helpers/coverage-config";
import {
  changedRanges,
  inScope,
  instrumentRanges,
  lived,
  partRanges,
} from "./mutants";
import realScope from "../coverage-scope.json";

const scope = {
  roots: ["src"],
  extensions: [".ts"],
  exclude: ["*.d.ts", "*.test.ts", "*/tests/*", "src/types/index.ts"],
};

describe("mutants", () => {
  test("only source the coverage gate counts is mutated", () => {
    expect(inScope("src/bot.ts", scope)).toBe(true);
    expect(inScope("src/utils/amount.ts", scope)).toBe(true);
    for (const file of [
      "scripts/mutants.ts",
      "src/types/index.ts",
      "src/global.d.ts",
      "src/a.test.ts",
      "src/x/tests/helper.ts",
      "src/readme.md",
      "srcs/a.ts",
    ]) {
      expect(inScope(file, scope)).toBe(false);
    }
  });

  test("the real scope is the TypeScript the coverage gate counts", () => {
    const files = [
      ...new Glob("{catalog,rtc,worker,tools}/**/*.ts").scanSync("."),
    ].filter((file) => !file.endsWith(".d.ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect([file, inScope(file, realScope)]).toEqual([
        file,
        isCovered(resolve(file)),
      ]);
    }
    expect(inScope("site/js/main.js", realScope)).toBe(false);
    expect(inScope("worker/domain-move.d.ts", realScope)).toBe(false);
  });

  test("a diff's added and changed lines become ranges, deletions none", () => {
    const diff = [
      "diff --git a/catalog/a.ts b/catalog/a.ts",
      "--- a/catalog/a.ts",
      "+++ b/catalog/a.ts",
      "@@ -3 +3 @@ x",
      "@@ -10,0 +11,4 @@ y",
      "@@ -20,2 +24,0 @@ z",
      "diff --git a/catalog/gone.ts b/catalog/gone.ts",
      "--- a/catalog/gone.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "--- a/catalog/b.ts",
      "+++ b/catalog/b.ts",
      "@@ -1,2 +1,2 @@",
    ].join("\n");
    expect(changedRanges(diff)).toEqual([
      { file: "catalog/a.ts", from: 3, to: 3 },
      { file: "catalog/a.ts", from: 11, to: 14 },
      { file: "catalog/b.ts", from: 1, to: 2 },
    ]);
  });

  test("parts cover every line once, as equal as whole lines allow", () => {
    const files = [
      { file: "catalog/a.ts", lines: 5 },
      { file: "catalog/b.ts", lines: 1 },
      { file: "catalog/c.ts", lines: 4 },
    ];
    for (const n of [1, 3, 4, 10, 12]) {
      const lines = Array.from({ length: n }, (_, k) =>
        partRanges(files, k, n).flatMap(({ file, from, to }) =>
          Array.from(
            { length: to - from + 1 },
            (_, i) => `${file}:${from + i}`,
          ),
        ),
      );
      expect(lines.flat()).toEqual([
        ...Array.from({ length: 5 }, (_, i) => `catalog/a.ts:${i + 1}`),
        "catalog/b.ts:1",
        ...Array.from({ length: 4 }, (_, i) => `catalog/c.ts:${i + 1}`),
      ]);
      const sizes = lines.map((part) => part.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
    expect(partRanges(files, 1, 3)).toEqual([
      { file: "catalog/a.ts", from: 4, to: 5 },
      { file: "catalog/b.ts", from: 1, to: 1 },
    ]);
    for (const k of [-1, 4, 1.5]) {
      expect(() => partRanges(files, k, 4)).toThrow();
    }
  });

  test("what no test caught is listed by file and line", () => {
    const mutant = (
      status: string,
      line: number,
      mutatorName = "EqualityOperator",
      replacement?: string,
    ) => ({
      status,
      mutatorName,
      replacement,
      location: { start: { line, column: 7 }, end: { line, column: 9 } },
    });
    const { rows, total } = lived({
      files: {
        "catalog/b.ts": {
          mutants: [
            mutant("Survived", 9, "BooleanLiteral", "false"),
            mutant("Killed", 1),
          ],
        },
        "catalog/a.ts": {
          mutants: [
            mutant("NoCoverage", 12),
            mutant("Timeout", 2, "UpdateOperator"),
            mutant("CompileError", 3),
            mutant("Ignored", 4),
          ],
        },
      },
    });
    expect(total).toBe(4);
    expect(rows).toEqual([
      "catalog/a.ts:2:7-2:9  timeout: UpdateOperator",
      "catalog/a.ts:12:7-12:9  no coverage: EqualityOperator",
      'catalog/b.ts:9:7-9:9  survived: BooleanLiteral → "false"',
    ]);
  });
});

test("crossing nodes are instrumented whole and owned only by their start lines", () => {
  const content =
    "export function f() {\n  if (true) {\n    return 1;\n  }\n}\n";
  const ranges = [{ file: "src/a.ts", from: 2, to: 2 }];
  expect(instrumentRanges(ranges, () => content)).toEqual([
    { file: "src/a.ts", from: 2, to: 4 },
  ]);
  const make = (line: number, column: number, end = column + 1) => ({
    status: "Survived",
    mutatorName: "BooleanLiteral",
    replacement: "false",
    location: { start: { line, column }, end: { line, column: end } },
  });
  const report = {
    files: {
      "src/a.ts": { mutants: [make(2, 7, 14), make(2, 7, 21), make(3, 7)] },
    },
  };
  const { rows, total } = lived(report, ranges);
  expect(total).toBe(2);
  expect(new Set(rows).size).toBe(2);
  expect(
    lived(report, [{ file: "src/a.ts", from: 3, to: 4 }]).rows,
  ).toHaveLength(1);
});
