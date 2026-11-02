// @ts-check
// Mutation testing: Stryker changes the code in small ways and runs the tests that reach each
// change. Run it through scripts/mutants.ts, which picks the lines to change.
import { readdirSync, readFileSync } from "node:fs";

// Only the tests that load the mutated code (catalog, rtc, worker, tools), not the ~90 files that
// drive the browser scripts in Happy DOM: the dry run goes through every test one at a time, and
// Stryker's switch can't reach scripts that run inside a Happy DOM window.
const testFiles = readdirSync("tests")
  .filter((name) => name.endsWith(".test.ts") && name !== "ci-workflow.test.ts")
  .filter((name) =>
    /\b(catalog|rtc|worker|tools)\/[\w-]+(\.[jt]s)?["']/.test(
      readFileSync(`tests/${name}`, "utf8"),
    ),
  )
  .map((name) => `tests/${name}`);

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  appendPlugins: ["@hughescr/stryker-bun-runner"],
  testRunner: "bun",
  bun: {
    testFiles,
    // The same per-test timeout `bun run test` uses.
    bunArgs: ["--timeout=30000"],
    // Bounds only the dry run, the whole selection once with coverage (a few seconds here, run
    // one test at a time). The default 10 s killed the bot's first trial. Mutant runs use
    // Stryker's own per-mutant timeout.
    timeout: 600_000,
  },
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // A mutant that loops forever is stopped and counted as timed out.
  timeoutMS: 10000,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
};

export default config;
