import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { type CatalogFetcher, handleCatalogRequest } from "../catalog/catalog";
import { handleRtcRequest } from "../rtc/rtc";
import type { BuildOptions } from "./deploy";

const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_DIR = join(PROJECT_DIR, "dist");
export const DEV_BUILD_STATE = ".dev-build-state.json";
export const DEV_RELOAD_PATH = "/__dev/reload";
const BUILD_INPUTS = [
  "site",
  "tools/deploy.ts",
  "precache-config.ts",
  "package.json",
  "bun.lock",
];
const DEV_CLIENT = `<script>
window.ASTRO_DEV = true;
(() => {
  const clearProductionOfflineState = async () => {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("astro-xp"))
          .map((name) => caches.delete(name)),
      );
    }
  };
  void clearProductionOfflineState().catch((error) =>
    console.warn("Could not clear the production offline worker:", error),
  );
  const events = new EventSource("${DEV_RELOAD_PATH}");
  events.addEventListener("reload", () => window.location.reload());
})();
</script>`;
const DEV_SERVICE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith("astro-xp")).map((name) => caches.delete(name)),
    );
    await self.registration.unregister();
    const windows = await clients.matchAll({ type: "window" });
    await Promise.all(windows.map((client) => client.navigate(client.url)));
  })());
});`;

export interface DevelopmentLiveReload {
  close(): void;
  reload(): void;
  response(): Response;
}

export function createDevelopmentLiveReload({
  heartbeatMs = 5_000,
} = {}): DevelopmentLiveReload {
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const send = (message: string) => {
    for (const client of clients) {
      try {
        client.enqueue(encoder.encode(message));
      } catch {
        clients.delete(client);
      }
    }
  };
  const heartbeat = setInterval(() => send(": heartbeat\n\n"), heartbeatMs);
  heartbeat.unref?.();

  return {
    close() {
      clearInterval(heartbeat);
      for (const client of clients) client.close();
      clients.clear();
    },
    reload() {
      send(`event: reload\ndata: ${Date.now()}\n\n`);
    },
    response() {
      let activeController: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          activeController = controller;
          clients.add(controller);
          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          clients.delete(activeController);
        },
      });
      return new Response(stream, {
        headers: noCacheHeaders({
          Connection: "keep-alive",
          "Content-Type": "text/event-stream",
        }),
      });
    },
  };
}

interface DevBuildState {
  schema: 2;
  fingerprint: string;
  generatedAt: string;
}

interface EnsureDevelopmentBuildOptions {
  outputDir: string;
  force?: boolean;
  projectDir?: string;
  fingerprint?: () => Promise<string>;
  builder?: (options: BuildOptions) => Promise<void>;
  version?: (fingerprint: string) => string;
}

interface EnsureDevelopmentBuildResult {
  rebuilt: boolean;
}

function gitOutput(
  arguments_: string[],
  projectDir: string,
): Uint8Array | null {
  const result = Bun.spawnSync(["git", ...arguments_], {
    cwd: projectDir,
    stderr: "ignore",
    stdout: "pipe",
  });
  return result.success ? result.stdout : null;
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function filesystemFingerprint(projectDir: string): Promise<string> {
  const digest = createHash("sha256");
  for (const input of BUILD_INPUTS) {
    const path = join(projectDir, input);
    try {
      const info = await stat(path);
      const files = info.isDirectory() ? await walkFiles(path) : [path];
      for (const file of files.sort()) {
        digest.update(relative(projectDir, file).split(sep).join("/"));
        digest.update(await readFile(file));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      digest.update(`missing:${input}`);
    }
  }
  return digest.digest("hex");
}

export async function computeSourceFingerprint(
  projectDir = PROJECT_DIR,
): Promise<string> {
  const tracked = gitOutput(
    ["ls-files", "-s", "--", ...BUILD_INPUTS],
    projectDir,
  );
  const changes = gitOutput(
    ["diff", "--binary", "--no-ext-diff", "HEAD", "--", ...BUILD_INPUTS],
    projectDir,
  );
  const untracked = gitOutput(
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...BUILD_INPUTS],
    projectDir,
  );
  if (!tracked || !changes || !untracked) {
    return filesystemFingerprint(projectDir);
  }

  const digest = createHash("sha256");
  digest.update(tracked);
  digest.update(changes);
  for (const relativePath of Buffer.from(untracked)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort()) {
    digest.update(relativePath);
    digest.update(await readFile(join(projectDir, relativePath)));
  }
  return digest.digest("hex");
}

async function readBuildState(
  outputDir: string,
): Promise<DevBuildState | null> {
  try {
    const state = JSON.parse(
      await readFile(join(outputDir, DEV_BUILD_STATE), "utf8"),
    ) as Partial<DevBuildState>;
    return state.schema === 2 &&
      typeof state.fingerprint === "string" &&
      typeof state.generatedAt === "string"
      ? (state as DevBuildState)
      : null;
  } catch {
    return null;
  }
}

export async function ensureDevelopmentBuild({
  outputDir,
  force = false,
  projectDir = PROJECT_DIR,
  fingerprint = () => computeSourceFingerprint(projectDir),
  builder,
  version,
}: EnsureDevelopmentBuildOptions): Promise<EnsureDevelopmentBuildResult> {
  const resolvedOutput = resolve(outputDir);
  const [sourceFingerprint, previousState] = await Promise.all([
    fingerprint(),
    readBuildState(resolvedOutput),
  ]);
  const hasIndex = await Bun.file(join(resolvedOutput, "index.html")).exists();
  if (!force && hasIndex && previousState?.fingerprint === sourceFingerprint) {
    console.log("Development build is already in sync.");
    return { rebuilt: false };
  }

  const startedAt = performance.now();
  console.log(
    hasIndex
      ? "Development build is stale; rebuilding..."
      : "Development build is missing; building...",
  );
  const selectedBuilder = builder ?? (await import("./deploy")).build;
  await selectedBuilder({
    outputDir: resolvedOutput,
    sourceDir: join(projectDir, "site"),
    ...(version ? { version: version(sourceFingerprint) } : {}),
  });
  const state: DevBuildState = {
    schema: 2,
    fingerprint: sourceFingerprint,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(
    join(resolvedOutput, DEV_BUILD_STATE),
    `${JSON.stringify(state)}\n`,
  );
  console.log(
    `Development build synchronized in ${((performance.now() - startedAt) / 1000).toFixed(2)}s.`,
  );
  return { rebuilt: true };
}

export function createPreviewVersion(
  fingerprint: string,
  date = new Date(),
): string {
  const [year, month, day] = date.toISOString().slice(0, 10).split("-");
  return `${year.slice(2)}.${month}.${day}-${fingerprint.slice(0, 7)}`;
}

function noCacheHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0",
  );
  headers.set("Expires", "0");
  headers.set("Pragma", "no-cache");
  return headers;
}

async function staticResponse(
  request: Request,
  directory: string,
  development: boolean,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", {
      status: 405,
      headers: noCacheHeaders({ Allow: "GET, HEAD" }),
    });
  }
  const url = new URL(request.url);
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad request.", {
      status: 400,
      headers: noCacheHeaders(),
    });
  }
  const root = resolve(directory);
  let path = resolve(root, `.${pathname}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    return new Response("Not found.", {
      status: 404,
      headers: noCacheHeaders(),
    });
  }
  try {
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
  } catch {
    return new Response("Not found.", {
      status: 404,
      headers: noCacheHeaders(),
    });
  }
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return new Response("Not found.", {
      status: 404,
      headers: noCacheHeaders(),
    });
  }
  const injectClient = development && file.type.startsWith("text/html");
  const body = injectClient
    ? (await file.text()).replace("</body>", `${DEV_CLIENT}\n  </body>`)
    : file;
  const size = injectClient
    ? new TextEncoder().encode(body as string).length
    : file.size;
  return new Response(request.method === "HEAD" ? null : body, {
    headers: noCacheHeaders({
      "Content-Length": String(size),
      // Bun reports application/octet-stream for unknown files.
      "Content-Type": file.type,
    }),
  });
}

export function createRequestHandler(
  directory: string,
  fetcher: CatalogFetcher = fetch,
  liveReload?: DevelopmentLiveReload,
): (request: Request) => Promise<Response> {
  return (request) => {
    const path = new URL(request.url).pathname;
    if (liveReload && path === DEV_RELOAD_PATH) {
      return Promise.resolve(liveReload.response());
    }
    if (liveReload && path === "/sw.js") {
      return Promise.resolve(
        new Response(DEV_SERVICE_WORKER, {
          headers: noCacheHeaders({
            "Content-Type": "text/javascript; charset=utf-8",
            "Service-Worker-Allowed": "/",
          }),
        }),
      );
    }
    if (path === "/api/games" || path.startsWith("/api/games/")) {
      return handleCatalogRequest(request, fetcher);
    }
    if (path === "/api/rtc") {
      return handleRtcRequest(request, fetcher);
    }
    return staticResponse(request, directory, Boolean(liveReload));
  };
}

interface WatchDevelopmentBuildOptions {
  debounceMs?: number;
  fingerprint?: () => Promise<string>;
  onReload: () => void;
  projectDir?: string;
  rebuild: () => Promise<EnsureDevelopmentBuildResult>;
}

export interface DevelopmentBuildWatcher {
  close(): void;
}

export async function watchDevelopmentBuild({
  debounceMs = 350,
  fingerprint = () => computeSourceFingerprint(projectDir),
  onReload,
  projectDir = PROJECT_DIR,
  rebuild,
}: WatchDevelopmentBuildOptions): Promise<DevelopmentBuildWatcher> {
  let building = false;
  let pending = false;
  let checking = false;
  let previousFingerprint = await fingerprint();

  const runBuild = async () => {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    try {
      const result = await rebuild();
      if (result.rebuilt) onReload();
    } catch (error) {
      console.error(
        "Development rebuild failed:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      building = false;
      if (pending) {
        pending = false;
        scheduleBuild();
      }
    }
  };

  const scheduleBuild = () => void runBuild();
  const interval = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const nextFingerprint = await fingerprint();
      if (nextFingerprint !== previousFingerprint) {
        previousFingerprint = nextFingerprint;
        scheduleBuild();
      }
    } catch (error) {
      console.error(
        "Could not check development sources:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      checking = false;
    }
  }, debounceMs);

  return {
    close() {
      clearInterval(interval);
    },
  };
}

interface ServerArguments {
  directory: string;
  force: boolean;
  hostname: string;
  port: number;
  production: boolean;
  sync: boolean;
}

export function parseServerArguments(arguments_: string[]): ServerArguments {
  const parsed: ServerArguments = {
    directory: DEFAULT_OUTPUT_DIR,
    force: false,
    hostname: "127.0.0.1",
    port: 8000,
    production: false,
    sync: true,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--rebuild") {
      parsed.force = true;
      continue;
    }
    if (argument === "--no-sync") {
      parsed.sync = false;
      continue;
    }
    if (argument === "--production") {
      parsed.production = true;
      continue;
    }
    if (
      argument === "--directory" ||
      argument === "--hostname" ||
      argument === "--port"
    ) {
      const value = arguments_[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--directory") parsed.directory = resolve(value);
      else if (argument === "--hostname") parsed.hostname = value;
      else {
        parsed.port = Number(value);
        if (
          !Number.isInteger(parsed.port) ||
          parsed.port < 0 ||
          parsed.port > 65535
        ) {
          throw new Error("--port must be an integer between 0 and 65535");
        }
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

export async function startDevelopmentServer(
  arguments_: ServerArguments,
  {
    serve = Bun.serve,
    ensureBuild = ensureDevelopmentBuild,
    watch = watchDevelopmentBuild,
  }: {
    serve?: (options: Parameters<typeof Bun.serve>[0]) => { url: URL };
    ensureBuild?: typeof ensureDevelopmentBuild;
    watch?: typeof watchDevelopmentBuild;
  } = {},
) {
  const version = arguments_.production ? createPreviewVersion : undefined;
  if (arguments_.sync) {
    await ensureBuild({
      outputDir: arguments_.directory,
      force: arguments_.force,
      version,
    });
  } else if (
    !(await Bun.file(join(arguments_.directory, "index.html")).exists())
  ) {
    throw new Error(
      `${arguments_.directory} is not built; omit --no-sync or run \`bun run build\``,
    );
  }
  const liveReload = arguments_.production
    ? undefined
    : createDevelopmentLiveReload();
  const server = serve({
    hostname: arguments_.hostname,
    port: arguments_.port,
    fetch: createRequestHandler(arguments_.directory, fetch, liveReload),
    error(error) {
      console.error(error);
      return new Response("Internal server error.", {
        status: 500,
        headers: noCacheHeaders(),
      });
    },
  });
  console.log(`Server running on ${server.url}`);
  if (arguments_.sync) {
    await watch({
      rebuild: () =>
        ensureBuild({
          outputDir: arguments_.directory,
          version,
        }),
      onReload: () => {
        if (liveReload) liveReload.reload();
        else console.log("Preview update built; check for updates in the app.");
      },
    });
    console.log("Watching source files for changes.");
  }
  return { server, liveReload };
}

if (import.meta.main) {
  try {
    await startDevelopmentServer(parseServerArguments(Bun.argv.slice(2)));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
