// Merges the Istanbul counters written by `COVERAGE=1 bun test`, counts
// first-party files that no test loaded as uncovered, prints a per-file
// summary, writes lcov and HTML reports, and fails below the threshold.
import { readdir, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import {
  coverageDirectory,
  emptyFileCoverage,
  isCovered,
  projectDirectory,
  rawCoverageDirectory,
} from "../tests/helpers/coverage-config";

// Every metric must stay at 100%; CI fails the build otherwise.
const THRESHOLDS = {
  lines: 100,
  statements: 100,
  functions: 100,
  branches: 100,
} as const;
const METRICS = Object.keys(THRESHOLDS) as (keyof typeof THRESHOLDS)[];

const coverageMap = libCoverage.createCoverageMap({});
const rawFiles = await readdir(rawCoverageDirectory).catch(() => []);
if (!rawFiles.length) {
  console.error("No coverage data found. Run `bun run test:coverage`.");
  process.exit(1);
}
for (const file of rawFiles)
  coverageMap.merge(
    JSON.parse(await readFile(resolve(rawCoverageDirectory, file), "utf8")),
  );

const tracked = (
  await Array.fromAsync(
    new Bun.Glob("{site,catalog,rtc,worker,tools}/**/*.{js,ts}").scan({
      cwd: projectDirectory,
    }),
  )
)
  .filter((file) => !file.endsWith(".d.ts"))
  .filter((file) => isCovered(resolve(projectDirectory, file)))
  .sort();
for (const file of tracked) {
  if (coverageMap.files().includes(file)) continue;
  const path = resolve(projectDirectory, file);
  coverageMap.addFileCoverage(
    emptyFileCoverage(await Bun.file(path).text(), path),
  );
}

const context = libReport.createContext({
  coverageMap,
  dir: coverageDirectory,
  sourceFinder: (file: string) =>
    readFileSync(resolve(projectDirectory, file), "utf8"),
});
reports.create("lcovonly").execute(context);
reports.create("html").execute(context);
reports
  .create("text", { skipFull: process.argv.includes("--skip-full") })
  .execute(context);
await rm(rawCoverageDirectory, { recursive: true, force: true });

const summary = coverageMap.getCoverageSummary();
const failing = METRICS.filter(
  (metric) => summary[metric].pct < THRESHOLDS[metric],
).map(
  (metric) =>
    `${metric} ${summary[metric].pct}% (minimum ${THRESHOLDS[metric]}%)`,
);
console.log(
  `\nCoverage across ${coverageMap.files().length} files: ` +
    METRICS.map((metric) => `${metric} ${summary[metric].pct}%`).join(", "),
);
if (failing.length) {
  console.error(`Coverage is below the minimum: ${failing.join(", ")}`);
  process.exit(1);
}
