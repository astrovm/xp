// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const workerPath = require.resolve("../site/js/shell-worker.js");
const originalSelf = globalThis.self;
const originalCaches = globalThis.caches;
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const OriginalRequest = globalThis.Request;

afterEach(() => {
  globalThis.self = originalSelf;
  globalThis.caches = originalCaches;
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.Request = OriginalRequest;
  delete require.cache[workerPath];
});

const ORIGIN = "https://xp.example";
const RELEASE = "releases/26.10.19-abcdef1";
const sri = (content) =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;
const entry = (
  url,
  content = url,
  revision = `r-${content.replace(/\W+/g, "-")}`,
) => ({
  integrity: sri(content),
  revision,
  url,
});
const shellKey = (path, revision) => `${ORIGIN}${path}?__rev=${revision}`;

// An in-memory CacheStorage that stores responses by absolute URL.
function createCaches() {
  const stores = new Map();
  const urlOf = (request) =>
    typeof request === "string" ? request : request.url;
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      match: async (request) => store.get(urlOf(request))?.clone(),
      put: async (request, response) => {
        const body = await response.arrayBuffer();
        store.set(
          urlOf(request),
          new Response(body, {
            headers: response.headers,
            status: response.status,
          }),
        );
      },
      delete: async (request) => store.delete(urlOf(request)),
    };
  };
  return {
    stores,
    storage: {
      keys: async () => [...stores.keys()],
      open,
      delete: async (name) => stores.delete(name),
    },
    seed: async (name, url, body) =>
      (await open(name)).put(url, new Response(body)),
    text: async (name, url) => stores.get(name)?.get(url)?.clone().text(),
  };
}

function loadWorker({ manifest, fetcher, version = "26.10.19-abcdef1" }) {
  const listeners = new Map();
  const cacheStorage = createCaches();
  const requests = [];
  const calls = { claim: 0, skipWaiting: 0 };
  globalThis.caches = cacheStorage.storage;
  globalThis.fetch = async (request) => {
    requests.push(request);
    return fetcher(request);
  };
  globalThis.setTimeout = (callback) => originalSetTimeout(callback, 0);
  // Bun drops the integrity option, so keep what the worker asked for.
  globalThis.Request = class extends OriginalRequest {
    constructor(input, init) {
      super(input, init);
      this.init = init;
    }
  };
  globalThis.self = {
    __ASTRO_XP_PRECACHE__: manifest,
    __ASTRO_XP_VERSION__: version,
    location: new URL(`${ORIGIN}/sw.js`),
    clients: { claim: async () => (calls.claim += 1) },
    skipWaiting: () => (calls.skipWaiting += 1),
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  delete require.cache[workerPath];
  require(workerPath);
  const lifecycle = (type) => {
    let promise;
    listeners.get(type)({ waitUntil: (value) => (promise = value) });
    return promise;
  };
  return {
    cacheStorage,
    calls,
    requests,
    install: () => lifecycle("install"),
    activate: () => lifecycle("activate"),
    message: (data, ports) => listeners.get("message")({ data, ports }),
    request: (url, options) => {
      let response = null;
      listeners.get("fetch")({
        request: new Request(url, options),
        respondWith: (value) => (response = value),
      });
      return response;
    },
  };
}

const serveContent = (request) =>
  new Response(`body of ${new URL(request.url).pathname}`);

describe("shell worker install", () => {
  test("downloads in parallel and stores files without the release prefix", async () => {
    const manifest = Array.from({ length: 40 }, (_, index) =>
      entry(`${RELEASE}/js/file-${index}.js`, `file ${index}`),
    );
    manifest.push(entry("index.html", "index"));
    let active = 0;
    let peak = 0;
    const worker = loadWorker({
      manifest,
      fetcher: async (request) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => originalSetTimeout(resolve, 5));
        active -= 1;
        return serveContent(request);
      },
    });

    await worker.install();

    expect(peak).toBe(16);
    expect(worker.requests).toHaveLength(41);
    const first = worker.requests.find((request) =>
      request.url.endsWith("/file-0.js"),
    );
    expect(first.url).toBe(`${ORIGIN}/${RELEASE}/js/file-0.js`);
    expect(first.cache).toBe("default");
    expect(first.init.integrity).toBe(sri("file 0"));
    expect(first.init.credentials).toBe("same-origin");
    const index = worker.requests.find((request) =>
      request.url.endsWith("/index.html"),
    );
    // The root page changes in place, so it skips the HTTP cache.
    expect(index.cache).toBe("reload");
    expect(
      await worker.cacheStorage.text(
        "astro-xp-shell-v1",
        shellKey("/js/file-0.js", "r-file-0"),
      ),
    ).toBe(`body of /${RELEASE}/js/file-0.js`);
    expect(
      await worker.cacheStorage.text(
        "astro-xp-shell-v1",
        shellKey("/index.html", "r-index"),
      ),
    ).toBe("body of /index.html");
  });

  test("downloads only files whose revision is not cached yet", async () => {
    const worker = loadWorker({
      manifest: [
        entry(`${RELEASE}/js/same.js`, "same"),
        entry(`${RELEASE}/js/changed.js`, "changed v2"),
      ],
      fetcher: serveContent,
    });
    await worker.cacheStorage.seed(
      "astro-xp-shell-v1",
      shellKey("/js/same.js", "r-same"),
      "cached same",
    );
    await worker.cacheStorage.seed(
      "astro-xp-shell-v1",
      shellKey("/js/changed.js", "r-changed-v1"),
      "old changed",
    );

    await worker.install();

    expect(worker.requests.map((request) => request.url)).toEqual([
      `${ORIGIN}/${RELEASE}/js/changed.js`,
    ]);
    expect(
      await worker.cacheStorage.text(
        "astro-xp-shell-v1",
        shellKey("/js/same.js", "r-same"),
      ),
    ).toBe("cached same");
  });

  test("does nothing when every file is already cached", async () => {
    const worker = loadWorker({
      manifest: [entry(`${RELEASE}/js/a.js`, "a")],
      fetcher: serveContent,
    });
    await worker.cacheStorage.seed(
      "astro-xp-shell-v1",
      shellKey("/js/a.js", "r-a"),
      "a",
    );
    await worker.cacheStorage.seed(
      "astro-xp-precache-v2-https://xp.example/",
      `${ORIGIN}/releases/old/js/a.js`,
      "a",
    );
    let listedCaches = 0;
    const keys = globalThis.caches.keys;
    globalThis.caches.keys = async () => {
      listedCaches += 1;
      return keys();
    };

    await worker.install();

    expect(worker.requests).toHaveLength(0);
    expect(listedCaches).toBe(0);
  });

  test("reuses matching files from the old Workbox precache", async () => {
    const worker = loadWorker({
      manifest: [
        entry(`${RELEASE}/js/kept.js`, "kept"),
        entry(`${RELEASE}/js/edited.js`, "edited new"),
        entry("index.html", "index"),
      ],
      fetcher: serveContent,
    });
    const legacy = "astro-xp-precache-v2-https://xp.example/";
    await worker.cacheStorage.seed(
      legacy,
      `${ORIGIN}/releases/old/js/kept.js`,
      "kept",
    );
    await worker.cacheStorage.seed(
      legacy,
      `${ORIGIN}/releases/old/js/edited.js`,
      "edited old",
    );
    await worker.cacheStorage.seed(
      legacy,
      `${ORIGIN}/index.html?__WB_REVISION__=abc`,
      "index",
    );
    // Other caches are never a source, even with a matching path.
    await worker.cacheStorage.seed(
      "astro-bundled-games-v1",
      `${ORIGIN}/js/edited.js`,
      "edited new",
    );

    await worker.install();

    expect(worker.requests.map((request) => request.url)).toEqual([
      `${ORIGIN}/${RELEASE}/js/edited.js`,
    ]);
    expect(
      await worker.cacheStorage.text(
        "astro-xp-shell-v1",
        shellKey("/js/kept.js", "r-kept"),
      ),
    ).toBe("kept");
    expect(
      await worker.cacheStorage.text(
        "astro-xp-shell-v1",
        shellKey("/index.html", "r-index"),
      ),
    ).toBe("index");
  });

  test("falls back to a download when a legacy entry disappears", async () => {
    const worker = loadWorker({
      manifest: [entry(`${RELEASE}/js/a.js`, "a")],
      fetcher: serveContent,
    });
    const legacy = "astro-xp-precache-v2-https://xp.example/";
    await worker.cacheStorage.seed(
      legacy,
      `${ORIGIN}/releases/old/js/a.js`,
      "a",
    );
    const open = globalThis.caches.open;
    globalThis.caches.open = async (name) => {
      const cache = await open(name);
      return name === legacy
        ? { ...cache, match: async () => undefined }
        : cache;
    };

    await worker.install();

    expect(worker.requests).toHaveLength(1);
  });

  test("stores redirected pages as plain responses", async () => {
    const worker = loadWorker({
      manifest: [entry(`${RELEASE}/capture.html`, "capture")],
      fetcher: () => {
        const response = new Response("capture page", {
          headers: { "Content-Type": "text/html" },
        });
        Object.defineProperty(response, "redirected", { value: true });
        return response;
      },
    });
    let stored;
    const open = globalThis.caches.open;
    globalThis.caches.open = async (name) => {
      const cache = await open(name);
      return {
        ...cache,
        put: async (request, response) => {
          stored = response.clone();
          return cache.put(request, response);
        },
      };
    };

    await worker.install();

    expect(stored.redirected).toBe(false);
    expect(stored.headers.get("Content-Type")).toBe("text/html");
    expect(await stored.text()).toBe("capture page");
  });
});

describe("shell worker retries", () => {
  const retryWorker = (responses) => {
    const results = [...responses];
    return loadWorker({
      manifest: [entry(`${RELEASE}/js/a.js`, "a")],
      fetcher: (request) => {
        const next = results.shift();
        if (next instanceof Error) throw next;
        return next === undefined
          ? serveContent(request)
          : new Response("", { status: next });
      },
    });
  };

  test("retries network errors and busy servers, then bypasses the HTTP cache", async () => {
    for (const responses of [
      [new TypeError("offline"), new TypeError("integrity")],
      [503, 429],
      [408],
    ]) {
      const worker = retryWorker(responses);
      await worker.install();
      expect(worker.requests).toHaveLength(responses.length + 1);
      expect(worker.requests.map((request) => request.cache)).toEqual([
        "default",
        ...responses.map(() => "reload"),
      ]);
      expect(
        await worker.cacheStorage.text(
          "astro-xp-shell-v1",
          shellKey("/js/a.js", "r-a"),
        ),
      ).toBe(`body of /${RELEASE}/js/a.js`);
    }
  });

  test("waits longer before each retry", async () => {
    const delays = [];
    const worker = retryWorker([500, 500]);
    globalThis.setTimeout = (callback, delay) => {
      delays.push(delay);
      return originalSetTimeout(callback, 0);
    };
    await worker.install();
    expect(delays).toEqual([500, 1000]);
  });

  test("gives up after three attempts", async () => {
    const network = retryWorker([
      new TypeError("offline 1"),
      new TypeError("offline 2"),
      new TypeError("offline 3"),
    ]);
    await expect(network.install()).rejects.toThrow("offline 3");
    expect(network.requests).toHaveLength(3);

    const server = retryWorker([500, 502, 503]);
    await expect(server.install()).rejects.toThrow(
      `${RELEASE}/js/a.js failed (503)`,
    );
    expect(server.requests).toHaveLength(3);
  });

  test("does not retry a missing file", async () => {
    const worker = retryWorker([404]);
    await expect(worker.install()).rejects.toThrow(
      `${RELEASE}/js/a.js failed (404)`,
    );
    expect(worker.requests).toHaveLength(1);
  });

  test("stops starting downloads after one fails", async () => {
    const manifest = Array.from({ length: 40 }, (_, index) =>
      entry(`${RELEASE}/js/file-${index}.js`, `file ${index}`),
    );
    const worker = loadWorker({
      manifest,
      fetcher: async (request) => {
        await new Promise((resolve) => originalSetTimeout(resolve, 1));
        return request.url.endsWith("/file-0.js")
          ? new Response("", { status: 404 })
          : serveContent(request);
      },
    });
    await expect(worker.install()).rejects.toThrow("failed (404)");
    await new Promise((resolve) => originalSetTimeout(resolve, 20));
    expect(worker.requests.length).toBeLessThan(40);
  });
});

describe("shell worker activation", () => {
  test("removes old files and the Workbox cache, then takes control", async () => {
    const worker = loadWorker({
      manifest: [entry(`${RELEASE}/js/a.js`, "a")],
      fetcher: serveContent,
    });
    const shell = "astro-xp-shell-v1";
    await worker.cacheStorage.seed(shell, shellKey("/js/a.js", "r-a"), "a");
    await worker.cacheStorage.seed(shell, shellKey("/js/a.js", "r-old"), "old");
    await worker.cacheStorage.seed(shell, shellKey("/js/gone.js", "r-g"), "g");
    await worker.cacheStorage.seed(
      "astro-xp-precache-v2-https://xp.example/",
      `${ORIGIN}/releases/old/js/a.js`,
      "a",
    );
    await worker.cacheStorage.seed(
      "astro-bundled-games-v1",
      `${ORIGIN}/swf/game/main.swf`,
      "game",
    );

    await worker.activate();

    expect([...worker.cacheStorage.stores.get(shell).keys()]).toEqual([
      shellKey("/js/a.js", "r-a"),
    ]);
    expect([...worker.cacheStorage.stores.keys()]).toEqual([
      shell,
      "astro-bundled-games-v1",
    ]);
    expect(worker.calls.claim).toBe(1);
  });
});

describe("shell worker requests", () => {
  const routedWorker = async () => {
    const worker = loadWorker({
      manifest: [
        entry(`${RELEASE}/js/a.js`, "a"),
        entry(`${RELEASE}/capture.html`, "capture"),
        entry(`${RELEASE}/js/uncached.js`, "uncached"),
        entry("index.html", "index"),
      ],
      fetcher: () => new Response("from network"),
    });
    const shell = "astro-xp-shell-v1";
    await worker.cacheStorage.seed(shell, shellKey("/js/a.js", "r-a"), "a");
    await worker.cacheStorage.seed(
      shell,
      shellKey("/capture.html", "r-capture"),
      "capture",
    );
    await worker.cacheStorage.seed(
      shell,
      shellKey("/index.html", "r-index"),
      "index",
    );
    return worker;
  };

  test("serves cached files for any release path", async () => {
    const worker = await routedWorker();
    for (const [url, body] of [
      [`${ORIGIN}/${RELEASE}/js/a.js`, "a"],
      [`${ORIGIN}/releases/older/js/a.js`, "a"],
      [`${ORIGIN}/js/a.js?v=1&utm_source=x&fbclid=y`, "a"],
      [`${ORIGIN}/`, "index"],
      [`${ORIGIN}/index.html`, "index"],
      [`${ORIGIN}/${RELEASE}/capture`, "capture"],
    ]) {
      expect(await (await worker.request(url)).text()).toBe(body);
    }
    expect(worker.requests).toHaveLength(0);
  });

  test("uses the network when a listed file is not cached", async () => {
    const worker = await routedWorker();
    expect(
      await (
        await worker.request(`${ORIGIN}/${RELEASE}/js/uncached.js`)
      ).text(),
    ).toBe("from network");
  });

  test("leaves other requests to the browser", async () => {
    const worker = await routedWorker();
    for (const [url, options] of [
      [`${ORIGIN}/js/a.js`, { method: "POST" }],
      ["https://other.example/js/a.js"],
      [`${ORIGIN}/js/a.js?game=1`],
      [`${ORIGIN}/js/missing.js`],
      [`${ORIGIN}/apps/`],
    ]) {
      expect(worker.request(url, options)).toBeNull();
    }
  });
});

describe("shell worker messages", () => {
  test("activates on request and reports its version", () => {
    const worker = loadWorker({ manifest: [], fetcher: serveContent });
    worker.message({ type: "SKIP_WAITING" });
    expect(worker.calls.skipWaiting).toBe(1);

    const posted = [];
    worker.message({ type: "GET_VERSION" }, [
      { postMessage: (data) => posted.push(data) },
    ]);
    expect(posted).toEqual([{ version: "26.10.19-abcdef1" }]);

    worker.message({ type: "GET_VERSION" }, []);
    worker.message({ type: "OTHER" });
    worker.message(undefined);
    expect(worker.calls.skipWaiting).toBe(1);
    expect(posted).toHaveLength(1);
  });
});
