// Coverage paths, scope and the Istanbul instrumenter. Importing this file
// has no side effects, so tools that only read coverage data, such as
// tools/coverage-run.ts and tools/coverage-report.ts, can use it without
// starting a coverage run of their own. tests/helpers/coverage.ts records
// coverage.
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";

export const projectDirectory = resolve(import.meta.dir, "../..");
export const coverageEnabled = process.env.COVERAGE === "1";
export const coverageDirectory = resolve(
  projectDirectory,
  process.env.COVERAGE_DIR || "coverage",
);
export const rawCoverageDirectory = resolve(coverageDirectory, "raw");

// First-party code that ships or runs in CI. Imported engines, generated
// runtimes, and maintenance tools that need the licensed XP source media are
// excluded because no test environment can run them.
export const coverageIncludes = [
  /^site\/js\/.+\.js$/,
  /^site\/apps\/.+\.js$/,
  /^site\/iframe\/scummvm\/.+\.js$/,
  /^catalog\/.+\.ts$/,
  /^rtc\/.+\.ts$/,
  /^worker\/.+\.(js|ts)$/,
  /^tools\/(content-address|deploy|dev-server|extract-swf|validate-icons|validate-javascript)\.ts$/,
];
export const coverageExcludes = [
  /^site\/apps\/paint\/(lib|src)\//,
  /^site\/apps\/pinball\/runtime\//,
];

export const isCovered = (path: string) => {
  const file = relative(projectDirectory, path);
  return (
    coverageIncludes.some((pattern) => pattern.test(file)) &&
    !coverageExcludes.some((pattern) => pattern.test(file))
  );
};

const loadModule = createRequire(import.meta.url);

// Babel is loaded only when coverage is requested, keeping normal runs fast.
let instrumenter: ReturnType<
  typeof import("istanbul-lib-instrument").createInstrumenter
>;
export const getInstrumenter = () =>
  (instrumenter ??= loadModule("istanbul-lib-instrument").createInstrumenter({
    coverageGlobalScope: "globalThis",
    coverageGlobalScopeFunc: false,
    esModules: true,
    parserPlugins: ["typescript", "importAttributes"],
    produceSourceMap: false,
  }));

export const emptyFileCoverage = (code: string, path: string) => {
  getInstrumenter().instrumentSync(code, relative(projectDirectory, path));
  return getInstrumenter().lastFileCoverage();
};
