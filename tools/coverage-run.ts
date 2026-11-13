// Runs the tests with coverage in shards, one after another, then writes the
// report. A Bun worker keeps every happy-dom window it created until the
// worker exits, also with --isolate. With coverage, each shell window keeps
// about 13 MB of instrumented code, so one run of all files needs about
// 20 GB. Each shard starts new workers, so its memory goes back to zero.
// Arguments go to tools/coverage-report.ts.
import { rm } from "node:fs/promises";
import type { Subprocess } from "bun";
import { rawCoverageDirectory } from "../tests/helpers/coverage-config";

const SHARDS = 4;

// A stopped run leaves counters from older code. They would mix with this
// run's counters.
await rm(rawCoverageDirectory, { recursive: true, force: true });

// A signal sent only to this process also stops the step that runs now, so
// no shard keeps writing counters after the run ends.
let current: Subprocess | undefined;
for (const [signal, number] of [
  ["SIGINT", 2],
  ["SIGTERM", 15],
] as const) {
  process.on(signal, () => {
    current?.kill(signal);
    process.exit(128 + number);
  });
}

// The steps use the same Bun binary as this script, not the one on PATH.
const run = async (arguments_: string[], env = process.env) => {
  current = Bun.spawn([process.execPath, ...arguments_], {
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return current.exited;
};

// Every shard runs, so one report shows all failures.
const failedShards: number[] = [];
for (let shard = 1; shard <= SHARDS; shard++) {
  const code = await run(
    [
      "test",
      "--parallel=4",
      "--timeout",
      "30000",
      `--shard=${shard}/${SHARDS}`,
    ],
    { ...process.env, COVERAGE: "1" },
  );
  if (code) failedShards.push(shard);
}
if (failedShards.length) {
  console.error(`Tests failed in shard ${failedShards.join(", ")}.`);
  process.exit(1);
}
process.exit(await run(["tools/coverage-report.ts", ...process.argv.slice(2)]));
