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

// A stop request ends the run: SIGINT or SIGTERM to this process, or to the
// step that runs now (Ctrl+C sends it to both). The run stops the step, waits
// until it has ended, starts no new step, then dies by the same signal. So
// neither the shard nor the tools its tests started (such as the dev server)
// write counters after the run ends. `bun test` stops the tools of its
// workers when it stops.
const STOP_SIGNALS = { SIGINT: 2, SIGTERM: 15 } as const;
type StopSignal = keyof typeof STOP_SIGNALS;
const STOP_WAIT_MS = 10_000;
let current: Subprocess | undefined;
let stopping = false;
const stop = async (signal: StopSignal) => {
  if (stopping) return;
  stopping = true;
  if (current && current.exitCode === null && current.signalCode === null) {
    current.kill(signal);
    const ended = await Promise.race([
      current.exited.then(() => true),
      Bun.sleep(STOP_WAIT_MS).then(() => false),
    ]);
    if (!ended)
      console.error(
        `The test process ${current.pid} did not stop in ${STOP_WAIT_MS / 1000} s. It may still write to ${rawCoverageDirectory}.`,
      );
  }
  // Dying by the signal lets a calling shell loop stop on Ctrl+C too.
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
  process.exit(128 + STOP_SIGNALS[signal]);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

// A stopped step dies by the signal, or, for `bun test --parallel`, exits
// with 128 plus the signal number.
const stopSignalOf = ({
  exitCode,
  signalCode,
}: Subprocess): StopSignal | undefined => {
  if (signalCode === "SIGINT" || exitCode === 128 + STOP_SIGNALS.SIGINT)
    return "SIGINT";
  if (signalCode === "SIGTERM" || exitCode === 128 + STOP_SIGNALS.SIGTERM)
    return "SIGTERM";
};

// The steps use the same Bun binary as this script, not the one on PATH.
// After a stop request, no new step starts, and the run waits for `stop` to
// end the process.
const never = new Promise<number>(() => {});
const run = async (arguments_: string[], env = process.env) => {
  if (stopping) return never;
  current = Bun.spawn([process.execPath, ...arguments_], {
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await current.exited;
  const signal = stopSignalOf(current);
  if (signal) void stop(signal);
  return stopping ? never : code;
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
