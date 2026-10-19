import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEV_BUILD_STATE,
  DEV_RELOAD_PATH,
  computeSourceFingerprint,
  createDevelopmentLiveReload,
  createPreviewVersion,
  createRequestHandler,
  ensureDevelopmentBuild,
  watchDevelopmentBuild,
  parseServerArguments,
} from "../tools/dev-server";
import { bunCommand } from "./helpers/coverage";

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "astro-xp-dev-server-test-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("development build synchronization", () => {
  test("derives preview versions from the build fingerprint", () => {
    expect(
      createPreviewVersion(
        "abcdef0123456789",
        new Date("2026-08-02T12:00:00.000Z"),
      ),
    ).toBe("26.08.02-abcdef0");
  });

  test("fingerprints build inputs but ignores unrelated files", async () => {
    const project = await makeTemporaryDirectory();
    await mkdir(join(project, "site"), { recursive: true });
    await mkdir(join(project, "tools"), { recursive: true });
    await writeFile(join(project, "site", "index.html"), "one");
    await writeFile(join(project, "tools", "deploy.ts"), "build");
    await writeFile(join(project, "precache-config.ts"), "config");
    await writeFile(join(project, "package.json"), "{}");
    await writeFile(join(project, "bun.lock"), "lock");
    Bun.spawnSync(["git", "init"], { cwd: project });
    Bun.spawnSync(["git", "add", "."], { cwd: project });
    Bun.spawnSync(
      [
        "git",
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: project },
    );

    const initial = await computeSourceFingerprint(project);
    await writeFile(join(project, "README.md"), "ignored");
    expect(await computeSourceFingerprint(project)).toBe(initial);
    await writeFile(join(project, "site", "new.js"), "untracked");
    const untracked = await computeSourceFingerprint(project);
    expect(untracked).not.toBe(initial);
    await rm(join(project, "site", "new.js"));
    await writeFile(join(project, "site", "index.html"), "two");
    expect(await computeSourceFingerprint(project)).not.toBe(initial);
  });

  test("skips an unchanged build and rebuilds when the fingerprint changes", async () => {
    const root = await makeTemporaryDirectory();
    const output = join(root, "dist");
    let sourceFingerprint = "first";
    let builds = 0;
    const builder = async ({ outputDir }: { outputDir?: string }) => {
      builds += 1;
      await mkdir(join(outputDir as string, "js"), { recursive: true });
      await writeFile(join(outputDir as string, "index.html"), "built");
    };
    const options = {
      outputDir: output,
      fingerprint: async () => sourceFingerprint,
      builder,
    };

    expect(await ensureDevelopmentBuild(options)).toEqual({ rebuilt: true });
    expect(await ensureDevelopmentBuild(options)).toEqual({ rebuilt: false });
    sourceFingerprint = "second";
    expect(await ensureDevelopmentBuild(options)).toEqual({ rebuilt: true });
    expect(builds).toBe(2);
    const state = JSON.parse(
      await readFile(join(output, DEV_BUILD_STATE), "utf8"),
    );
    expect(state.schema).toBe(2);
    expect(state.fingerprint).toBe("second");
  });

  test("passes a fingerprint-based version to preview builds", async () => {
    const root = await makeTemporaryDirectory();
    const versions: string[] = [];

    await ensureDevelopmentBuild({
      outputDir: join(root, "dist"),
      fingerprint: async () => "1234567890abcdef",
      version: (fingerprint) => `preview-${fingerprint.slice(0, 7)}`,
      builder: async ({ outputDir, version }) => {
        versions.push(version as string);
        await mkdir(outputDir as string, { recursive: true });
        await writeFile(join(outputDir as string, "index.html"), "built");
      },
    });

    expect(versions).toEqual(["preview-1234567"]);
  });
});

describe("Bun request handler", () => {
  test("serves static files without caching and blocks traversal", async () => {
    const root = await makeTemporaryDirectory();
    await writeFile(join(root, "index.html"), "<h1>Astro XP</h1>");
    const handler = createRequestHandler(root);

    const response = await handler(new Request("http://localhost/"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Astro XP");
    expect(response.headers.get("cache-control")).toContain("no-store");

    const traversal = await handler(
      new Request("http://localhost/%2e%2e%2fsecret"),
    );
    expect(traversal.status).toBe(404);
  });

  test("routes the local catalog API through the shared handler", async () => {
    const root = await makeTemporaryDirectory();
    await writeFile(join(root, "index.html"), "site");
    const uuid = "a2fb012a-b14c-6921-b688-403571e42bb0";
    const html = `
			<div class="fp-search-result">
				<a href="/view?id=${uuid}"></a>
				<a class="fp-search-result-title" href="/view?id=${uuid}">Bike Mania</a>
				<div class="fp-search-result-info">Flash game - Racing</div>
			</div>`;
    const handler = createRequestHandler(root, async () => new Response(html));
    const response = await handler(
      new Request("http://localhost/api/games?q=bike"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).games[0].title).toBe("Bike Mania");
  });

  test("routes RTC credentials through the local origin", async () => {
    const root = await makeTemporaryDirectory();
    const handler = createRequestHandler(
      root,
      async () =>
        new Response(
          JSON.stringify([
            {
              iceservers: [
                { urls: ["stun:rtc.example:3478"] },
                {
                  urls: ["turn:rtc.example:3478"],
                  username: "temporary-user",
                  credential: "temporary-password",
                },
              ],
            },
          ]),
        ),
    );
    const response = await handler(new Request("http://localhost/api/rtc"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      iceServers: [
        { urls: ["stun:rtc.example:3478"] },
        {
          urls: ["turn:rtc.example:3478"],
          username: "temporary-user",
          credential: "temporary-password",
        },
      ],
    });
  });

  test("injects the development client and serves reload events", async () => {
    const root = await makeTemporaryDirectory();
    await writeFile(join(root, "index.html"), "<body>site</body>");
    const liveReload = createDevelopmentLiveReload();
    const handler = createRequestHandler(root, fetch, liveReload);

    const page = await handler(new Request("http://localhost/"));
    const pageHtml = await page.text();
    expect(pageHtml).toContain("window.ASTRO_DEV = true");
    expect(pageHtml).toContain(`new EventSource("${DEV_RELOAD_PATH}")`);

    const response = await handler(
      new Request(`http://localhost${DEV_RELOAD_PATH}`),
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("connected");
    liveReload.reload();
    expect(decoder.decode((await reader.read()).value)).toContain(
      "event: reload",
    );
    await reader.cancel();
    liveReload.close();
  });

  test("replaces the production service worker in development", async () => {
    const root = await makeTemporaryDirectory();
    await writeFile(join(root, "index.html"), "<body>site</body>");
    const liveReload = createDevelopmentLiveReload();
    const handler = createRequestHandler(root, fetch, liveReload);

    const response = await handler(new Request("http://localhost/sw.js"));
    const worker = await response.text();
    expect(worker).toContain('name.startsWith("astro-xp")');
    expect(worker).toContain("self.registration.unregister()");
    expect(response.headers.get("cache-control")).toContain("no-store");
    liveReload.close();
  });

  test("serves production HTML and service worker unchanged for preview", async () => {
    const root = await makeTemporaryDirectory();
    await writeFile(join(root, "index.html"), "<body>site</body>");
    await writeFile(join(root, "sw.js"), "self.productionWorker = true;");
    const handler = createRequestHandler(root);

    const page = await handler(new Request("http://localhost/"));
    expect(await page.text()).toBe("<body>site</body>");

    const worker = await handler(new Request("http://localhost/sw.js"));
    expect(await worker.text()).toBe("self.productionWorker = true;");
  });
});

describe("development source watching", () => {
  test("debounces source changes and reloads after rebuilding", async () => {
    const project = await makeTemporaryDirectory();
    await mkdir(join(project, "site"), { recursive: true });
    const source = join(project, "site", "index.html");
    await writeFile(source, "one");
    let builds = 0;
    let resolveReload!: () => void;
    const reloaded = new Promise<void>((resolve) => {
      resolveReload = resolve;
    });
    const watcher = await watchDevelopmentBuild({
      debounceMs: 10,
      onReload: resolveReload,
      projectDir: project,
      rebuild: async () => {
        builds += 1;
        return { rebuilt: true };
      },
    });

    try {
      await Bun.sleep(25);
      await writeFile(source, "two");
      await Promise.race([
        reloaded,
        Bun.sleep(2_000).then(() => {
          throw new Error("Timed out waiting for the development rebuild");
        }),
      ]);
      expect(builds).toBe(1);
    } finally {
      watcher.close();
    }
  });
});

test("server CLI parses build controls and validates ports and unknown arguments", () => {
  expect(parseServerArguments([])).toMatchObject({
    force: false,
    hostname: "127.0.0.1",
    port: 8000,
    production: false,
    sync: true,
  });
  expect(
    parseServerArguments([
      "--rebuild",
      "--no-sync",
      "--production",
      "--hostname",
      "localhost",
      "--port",
      "0",
      "--directory",
      "/tmp/preview",
    ]),
  ).toEqual({
    force: true,
    hostname: "localhost",
    port: 0,
    production: true,
    sync: false,
    directory: "/tmp/preview",
  });
  for (const port of ["-1", "65536", "1.5", "bad"])
    expect(() => parseServerArguments(["--port", port])).toThrow(
      "must be an integer",
    );
  for (const flag of ["--port", "--hostname", "--directory"])
    expect(() => parseServerArguments([flag])).toThrow("requires a value");
  expect(() => parseServerArguments(["--unknown"])).toThrow("Unknown argument");
});

describe("development server edge cases", () => {
  test("fingerprints build inputs from the filesystem outside Git", async () => {
    const project = await makeTemporaryDirectory();
    await mkdir(join(project, "site", "js"), { recursive: true });
    await writeFile(join(project, "site", "index.html"), "one");
    await writeFile(join(project, "site", "js", "main.js"), "main");
    await writeFile(join(project, "package.json"), "{}");
    await symlink(
      join(project, "site", "index.html"),
      join(project, "site", "link.html"),
    );
    const initial = await computeSourceFingerprint(project);
    expect(await computeSourceFingerprint(project)).toBe(initial);
    await writeFile(join(project, "site", "js", "main.js"), "changed");
    expect(await computeSourceFingerprint(project)).not.toBe(initial);

    await chmod(join(project, "package.json"), 0);
    try {
      await expect(computeSourceFingerprint(project)).rejects.toThrow();
    } finally {
      await chmod(join(project, "package.json"), 0o644);
    }
  });

  test("rebuilds when the recorded build state is from another schema", async () => {
    const output = await makeTemporaryDirectory();
    await writeFile(join(output, "index.html"), "built");
    await writeFile(
      join(output, DEV_BUILD_STATE),
      JSON.stringify({ schema: 1, fingerprint: "same" }),
    );
    let builds = 0;
    const result = await ensureDevelopmentBuild({
      outputDir: output,
      fingerprint: async () => "same",
      builder: async () => {
        builds += 1;
      },
    });
    expect(result).toEqual({ rebuilt: true });
    expect(builds).toBe(1);
  });

  test("uses today's date for preview versions by default", () => {
    const today = new Date().toISOString().slice(2, 10).replaceAll("-", ".");
    expect(createPreviewVersion("abcdef0123")).toBe(`${today}-abcdef0`);
  });

  test("rejects unsupported methods, malformed paths, and missing files", async () => {
    const root = await makeTemporaryDirectory();
    await mkdir(join(root, "empty"));
    await writeFile(join(root, "index.html"), "<h1>site</h1>");
    const handler = createRequestHandler(root);
    const request = (path: string, method = "GET") =>
      handler(new Request(`http://localhost${path}`, { method }));
    expect((await request("/", "POST")).status).toBe(405);
    expect((await request("/%E0%A4%A")).status).toBe(400);
    expect((await request("/missing.js")).status).toBe(404);
    expect((await request("/empty/")).status).toBe(404);
    const head = await request("/", "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("13");
    expect(await head.text()).toBe("");
  });

  test("uses default watch settings until closed", async () => {
    const watcher = await watchDevelopmentBuild({
      fingerprint: async () => "unchanged",
      onReload: () => {},
      rebuild: async () => ({ rebuilt: false }),
    });
    watcher.close();
  });

  test("does not overlap fingerprint checks while a source check is pending", async () => {
    let checks = 0;
    let builds = 0;
    let checkStarted!: () => void;
    let finishCheck!: () => void;
    let reload!: () => void;
    const started = new Promise<void>((resolve) => {
      checkStarted = resolve;
    });
    const pendingCheck = new Promise<void>((resolve) => {
      finishCheck = resolve;
    });
    const reloaded = new Promise<void>((resolve) => {
      reload = resolve;
    });
    const watcher = await watchDevelopmentBuild({
      debounceMs: 5,
      fingerprint: async () => {
        checks += 1;
        if (checks === 1) return "initial";
        if (checks === 2) {
          checkStarted();
          await pendingCheck;
        }
        return "changed";
      },
      onReload: reload,
      rebuild: async () => {
        builds += 1;
        return { rebuilt: true };
      },
    });
    try {
      await started;
      // Several timer ticks occur while the first source check is held open.
      await Bun.sleep(30);
      expect(checks).toBe(2);
      expect(builds).toBe(0);
      finishCheck();
      await reloaded;
      expect(builds).toBe(1);
    } finally {
      watcher.close();
      finishCheck();
    }
  });

  test("queues changes during a rebuild and reports failures", async () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...arguments_: unknown[]) => errors.push(arguments_);
    let version = 0;
    let finishFirstBuild!: () => void;
    const results: (() => Promise<{ rebuilt: boolean }>)[] = [
      () =>
        new Promise((resolve) => {
          finishFirstBuild = () => resolve({ rebuilt: false });
        }),
      async () => {
        throw new Error("build failed");
      },
      async () => {
        throw "plain failure";
      },
    ];
    let builds = 0;
    const watcher = await watchDevelopmentBuild({
      debounceMs: 5,
      fingerprint: async () => {
        if (version === 99) throw new Error("git unavailable");
        if (version === 98) throw "fingerprint unavailable";
        return String(version);
      },
      onReload: () => {},
      rebuild: () => results[builds++]!(),
    });
    try {
      const waitFor = async (condition: () => boolean) => {
        for (let attempt = 0; attempt < 200 && !condition(); attempt += 1)
          await Bun.sleep(5);
        expect(condition()).toBeTrue();
      };
      version = 1;
      await waitFor(() => builds === 1);
      version = 2;
      await Bun.sleep(30);
      finishFirstBuild();
      await waitFor(() => builds === 2);
      version = 3;
      await waitFor(() => builds === 3);
      version = 99;
      await waitFor(() =>
        errors.some(([, message]) => message === "git unavailable"),
      );
      version = 98;
      await waitFor(() =>
        errors.some(([, message]) => message === "fingerprint unavailable"),
      );
    } finally {
      watcher.close();
      console.error = originalError;
    }
    expect(errors.map(([, message]) => message)).toEqual(
      expect.arrayContaining(["build failed", "plain failure"]),
    );
  });

  const serverScript = join(import.meta.dir, "..", "tools", "dev-server.ts");

  // Starts the dev server CLI, waits for it to listen, and returns its URL.
  async function startServer(...arguments_: string[]) {
    const server = Bun.spawn(bunCommand(serverScript, ...arguments_), {
      stderr: "pipe",
      stdout: "pipe",
    });
    const reader = server.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    while (!output.includes("Server running on")) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`Server exited early:\n${output}`);
      output += decoder.decode(value);
    }
    const url = output.match(/Server running on (\S+)/)![1];
    return {
      url,
      async stop() {
        reader.releaseLock();
        server.kill("SIGTERM");
        await server.exited;
      },
    };
  }

  test("refuses to serve an unbuilt directory without synchronization", async () => {
    const directory = await makeTemporaryDirectory();
    const result = Bun.spawnSync(
      bunCommand(serverScript, "--no-sync", "--directory", directory),
      { stderr: "pipe", stdout: "pipe" },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("is not built");
  });

  test("serves an existing preview build from the command line", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(join(directory, "index.html"), "<body>preview</body>");
    const server = await startServer(
      "--no-sync",
      "--production",
      "--port",
      "0",
      "--directory",
      directory,
    );
    try {
      expect(await (await fetch(server.url)).text()).toBe(
        "<body>preview</body>",
      );
    } finally {
      await server.stop();
    }
  });

  test("watches an in-sync development build from the command line", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(join(directory, "index.html"), "<body>dev</body>");
    await writeFile(
      join(directory, DEV_BUILD_STATE),
      JSON.stringify({
        schema: 2,
        fingerprint: await computeSourceFingerprint(),
        generatedAt: new Date().toISOString(),
      }),
    );
    const server = await startServer("--port", "0", "--directory", directory);
    try {
      expect(await (await fetch(server.url)).text()).toContain(
        "window.ASTRO_DEV = true",
      );
    } finally {
      await server.stop();
    }
    // The server fingerprints the real source tree and rebuilds into the
    // temporary directory if a parallel test changed it in the meantime.
  }, 60_000);
});
