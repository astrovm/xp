// Istanbul coverage for `bun run test:coverage`. Bun's built-in report cannot
// see the classic browser scripts the shell harness evaluates inside Happy DOM,
// and it undercounts UMD modules that tests reload, so first-party sources are
// instrumented here instead: runtime imports through a Bun plugin, and harness
// scripts and bundles through `instrumentSource` and `coverageBuildPlugins`.
import { afterAll } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import Module from "node:module";
import { relative, resolve } from "node:path";
import type { BunPlugin } from "bun";
import {
  coverageEnabled,
  getInstrumenter,
  isCovered,
  projectDirectory,
  rawCoverageDirectory,
} from "./coverage-config";

type CommonJsModule = { _compile(code: string, path: string): void };

const cacheDirectory = resolve(projectDirectory, "coverage/cache");

// Instrumenting with Babel is slow, and every shell test re-evaluates the same
// scripts, so instrumented sources are cached on disk by content hash for all
// test processes to share.
export const instrumentSource = (code: string, path: string) => {
  if (!coverageEnabled || !isCovered(path)) return code;
  const file = relative(projectDirectory, path);
  const cached = resolve(
    cacheDirectory,
    `${Bun.hash(`${file}\0${code}`).toString(36)}.js`,
  );
  if (existsSync(cached)) return readFileSync(cached, "utf8");
  const instrumented = getInstrumenter().instrumentSync(code, file);
  mkdirSync(cacheDirectory, { recursive: true });
  writeFileSync(`${cached}.${process.pid}`, instrumented);
  renameSync(`${cached}.${process.pid}`, cached);
  return instrumented;
};

// ES modules and TypeScript load through a Bun plugin. Browser scripts that
// export through `module.exports` must stay CommonJS, which Bun plugins cannot
// produce, so those load through the CommonJS extension hook instead.
// Worker browser scripts are CommonJS too, and the Worker imports them as text.
const moduleFilter =
  /\/(site\/apps|catalog|rtc|tools)\/.+\.(js|ts)$|\/worker\/.+\.ts$/;
const loadInstrumented = ({ path }: { path: string }) => ({
  contents: instrumentSource(readFileSync(path, "utf8"), path),
  loader: path.endsWith(".ts") ? ("ts" as const) : ("js" as const),
});

export const coverageBuildPlugins: BunPlugin[] = coverageEnabled
  ? [
      {
        name: "istanbul",
        setup(build) {
          build.onLoad({ filter: /\.js$/ }, loadInstrumented);
        },
      },
    ]
  : [];

if (coverageEnabled) {
  const coverage = ((globalThis as { __coverage__?: object }).__coverage__ ??=
    {});
  Bun.plugin({
    name: "istanbul",
    setup(build) {
      build.onLoad({ filter: moduleFilter }, loadInstrumented);
    },
  });
  const extensions = (
    Module as unknown as {
      _extensions: Record<
        string,
        (module: CommonJsModule, path: string) => void
      >;
    }
  )._extensions;
  const loadJavaScript = extensions[".js"];
  extensions[".js"] = (module, path) =>
    isCovered(path)
      ? module._compile(
          instrumentSource(readFileSync(path, "utf8"), path),
          path,
        )
      : loadJavaScript(module, path);
  // Test files may run in separate processes and isolated globals, so each
  // writes its own counters and the report merges them.
  const writeCoverage = () => {
    mkdirSync(rawCoverageDirectory, { recursive: true });
    writeFileSync(
      resolve(
        rawCoverageDirectory,
        `${process.pid}-${crypto.randomUUID()}.json`,
      ),
      JSON.stringify(coverage),
    );
  };
  // Tool CLIs started by tests load this file with `--preload` outside the
  // test runner, where `afterAll` is unavailable.
  try {
    afterAll(writeCoverage);
  } catch {
    process.on("exit", writeCoverage);
    // Long-running tools such as the dev server are stopped with SIGTERM.
    process.on("SIGTERM", () => process.exit(143));
  }
}

// Runs a Bun entry point in a child process, recording its coverage when
// coverage is enabled.
export const bunCommand = (...arguments_: string[]) => [
  process.execPath,
  ...(coverageEnabled ? ["--preload", import.meta.path] : []),
  ...arguments_,
];
