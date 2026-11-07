/**
 * Mutation testing: Stryker changes source lines a little, one change at a time, and runs the
 * tests that reach each change. A change no test notices is a missing test.
 *
 *   bun run scripts/mutants.ts diff origin/main     # the lines this branch changed
 *   bun run scripts/mutants.ts part 3 64            # the 4th of 64 equal parts of all lines
 *   bun run scripts/mutants.ts diff HEAD^1 --out build/mutants
 *
 * Only what coverage-scope.json counts as source is changed. Lists what lived by file and line;
 * --out also writes it to lived.txt and the tally ("3 of 10") to tally.txt there. Exits 0 once
 * it got to its tally, whatever lived; only a broken run fails. Stryker's full report is in
 * reports/mutation/.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dir, "..");
const REPORT = join(ROOT, "reports/mutation/mutation.json");

interface Scope {
  roots: string[];
  extensions: string[];
  exclude: string[];
}

/** A line range of one file, as Stryker's `--mutate` takes it: "src/a.ts:3-9". */
export interface Range {
  file: string;
  from: number;
  to: number;
}

/** Whether `file` is source the coverage gate counts, by coverage-scope.json's globs. */
export function inScope(file: string, scope: Scope): boolean {
  const glob = (pattern: string) =>
    new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
  return (
    scope.roots.some((root) => file.startsWith(`${root}/`)) &&
    scope.extensions.some((extension) => file.endsWith(extension)) &&
    !scope.exclude.some(
      (pattern) => glob(pattern).test(file) || glob(pattern).test(`/${file}`),
    )
  );
}

/** The ranges of lines a unified diff with no context (`-U0`) adds or changes. */
export function changedRanges(diff: string): Range[] {
  const ranges: Range[] = [];
  let file: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4);
      file = path === "/dev/null" ? undefined : path.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      const from = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count > 0) ranges.push({ file, from, to: from + count - 1 });
    }
  }
  return ranges;
}

/** Every line of every file, in order, cut into `n` parts as equal as whole lines allow; the `k`th, 0-based, as ranges. */
export function partRanges(
  files: { file: string; lines: number }[],
  k: number,
  n: number,
): Range[] {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k >= n) {
    throw new Error(`part ${k} isn't one of 0 to ${n - 1}`);
  }
  const total = files.reduce((sum, { lines }) => sum + lines, 0);
  const start = Math.floor((total * k) / n);
  const end = Math.floor((total * (k + 1)) / n);
  const ranges: Range[] = [];
  let offset = 0;
  for (const { file, lines } of files) {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + lines);
    if (from < to)
      ranges.push({ file, from: from - offset + 1, to: to - offset });
    offset += lines;
  }
  return ranges;
}

/** Include whole syntax nodes that start in the owned lines, including blocks crossing a cut.
 * Ownership stays with the original ranges, so overlap never duplicates a reported mutant.
 */
export function instrumentRanges(
  ranges: Range[],
  read = (file: string) => readFileSync(join(ROOT, file), "utf8"),
): Range[] {
  const parsed = new Map<string, ts.SourceFile>();
  return ranges.map((range) => {
    let source = parsed.get(range.file);
    if (!source) {
      source = ts.createSourceFile(
        range.file,
        read(range.file),
        ts.ScriptTarget.Latest,
        true,
      );
      parsed.set(range.file, source);
    }
    let to = range.to;
    const visit = (node: ts.Node) => {
      const start =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (
        start >= range.from &&
        start <= range.to &&
        node.kind !== ts.SyntaxKind.SourceFile
      ) {
        to = Math.max(
          to,
          source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return { ...range, to };
  });
}

interface Mutant {
  status: string;
  mutatorName: string;
  replacement?: string;
  location: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

/** What no test caught, "src/a.ts:12  survived: EqualityOperator", by file and line, and how many mutants there were. */
export function lived(
  report: { files: Record<string, { mutants: Mutant[] }> },
  owned?: Range[],
): {
  rows: string[];
  total: number;
} {
  const left: [string, number, string][] = [];
  let total = 0;
  for (const [path, { mutants }] of Object.entries(report.files)) {
    const file = path.startsWith("/") ? relative(ROOT, path) : path;
    for (const mutant of mutants) {
      if (
        owned &&
        !owned.some(
          (range) =>
            range.file === file &&
            mutant.location.start.line >= range.from &&
            mutant.location.start.line <= range.to,
        )
      )
        continue;
      if (mutant.status === "CompileError" || mutant.status === "Ignored")
        continue;
      total++;
      if (["Survived", "NoCoverage", "Timeout"].includes(mutant.status)) {
        const status =
          mutant.status === "NoCoverage"
            ? "no coverage"
            : mutant.status.toLowerCase();
        const { line, column } = mutant.location.start;
        const end = mutant.location.end;
        const change =
          mutant.replacement === undefined
            ? ""
            : ` → ${JSON.stringify(mutant.replacement)}`;
        left.push([
          file,
          line,
          `${file}:${line}:${column}-${end.line}:${end.column}  ${status}: ${mutant.mutatorName}${change}`,
        ]);
      }
    }
  }
  left.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  return { rows: left.map(([, , row]) => row), total };
}

function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function sourceFiles(scope: Scope): { file: string; lines: number }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir)).sort()) {
      const path = `${dir}/${name}`;
      if (statSync(join(ROOT, path)).isDirectory()) walk(path);
      else if (inScope(path, scope)) files.push(path);
    }
  };
  scope.roots.forEach(walk);
  return files.map((file) => ({
    file,
    lines: readFileSync(join(ROOT, file), "utf8").split("\n").length,
  }));
}

function main(argv: string[]): number {
  const usage =
    "Usage: bun run scripts/mutants.ts diff BASE | part K N [--out DIR]";
  const out = argv.includes("--out")
    ? argv[argv.indexOf("--out") + 1]
    : undefined;
  const scope: Scope = JSON.parse(
    readFileSync(join(ROOT, "coverage-scope.json"), "utf8"),
  );
  let ranges: Range[];
  if (argv[0] === "diff" && argv[1]) {
    const since = git("merge-base", argv[1], "HEAD").trim();
    ranges = changedRanges(
      git("diff", "-U0", "--no-color", since, "HEAD"),
    ).filter((range) => inScope(range.file, scope));
  } else if (argv[0] === "part" && argv[1] && argv[2]) {
    ranges = partRanges(sourceFiles(scope), Number(argv[1]), Number(argv[2]));
  } else {
    console.error(usage);
    return 2;
  }
  let rows: string[] = [];
  let total = 0;
  if (ranges.length === 0) {
    console.log("No source lines to mutate.");
  } else {
    console.log(
      `${ranges.length} ranges in ${new Set(ranges.map((range) => range.file)).size} files.`,
    );
    rmSync(REPORT, { force: true });
    const mutate = instrumentRanges(ranges)
      .map(({ file, from, to }) => `${file}:${from}-${to}`)
      .join(",");
    const run = spawnSync("bun", ["x", "stryker", "run", "--mutate", mutate], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (run.status !== 0 || !existsSync(REPORT)) {
      console.error(
        `Stryker stopped (exit ${run.status ?? run.signal}) before its report.`,
      );
      return 1;
    }
    ({ rows, total } = lived(JSON.parse(readFileSync(REPORT, "utf8")), ranges));
  }
  rows.forEach((row) => console.log(row));
  const tally = `${total - rows.length} of ${total}`;
  console.log(`${tally} changes caught by a test.`);
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, "lived.txt"),
      rows.map((row) => `${row}\n`).join(""),
    );
    writeFileSync(join(out, "tally.txt"), `${tally}\n`);
  }
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
