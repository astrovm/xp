// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { unzipSync, zipSync } = require("fflate");

class FakeCache {
  constructor() {
    this.values = new Map();
  }
  async put(key, response) {
    // CacheStorage consumes the response stream before put resolves.
    this.values.set(
      String(key),
      new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: response.headers,
      }),
    );
  }
  async match(key) {
    const value = this.values.get(String(key.url || key));
    return value?.clone ? value.clone() : value || null;
  }
  async delete(key) {
    return this.values.delete(String(key.url || key));
  }
  async keys() {
    return [...this.values.keys()];
  }
}

class FakeStore {
  constructor() {
    this.values = new Map();
  }
  async list() {
    return [...this.values.values()];
  }
  async get(id) {
    return this.values.get(id);
  }
  async put(record) {
    this.values.set(record.id, record);
  }
  async delete(id) {
    this.values.delete(id);
  }
}

const uuid = "a2fb012a-b14c-6921-b688-403571e42bb0";
const details = {
  uuid,
  title: "Bike Mania Arena",
  library: "Games",
  platform: "Flash",
  status: "Playable",
  applicationPath: "FPSoftware\\Flash\\flashplayer_32_sa.exe",
  downloadUrl: `https://xp.example/api/games/${uuid}/download`,
  logoUrl: `https://xp.example/api/games/${uuid}/logo`,
  launchCommand: "http://localflash/bikemaniaarena1/bike-mania-arena-1.swf",
  tags: ["Sports", "Racing"],
  compatible: true,
  packageType: "gamezip",
  legacyFallback: true,
};
const legacyUuid = "6ad53148-33c7-0fd0-9c7b-5baa815b752d";
const legacyDetails = {
  ...details,
  uuid: legacyUuid,
  title: "Bike Mania 3 on Ice",
  packageType: "legacy",
  downloadUrl: `https://xp.example/api/games/${legacyUuid}/download`,
  logoUrl: `https://xp.example/api/games/${legacyUuid}/logo`,
  launchCommand: "http://localflash/bikemania3/bikemaniaonice.swf",
};

function loadModules() {
  const installerPath = require.resolve("../site/js/game-installer.js");
  const libraryPath = require.resolve("../site/js/game-library.js");
  delete require.cache[installerPath];
  delete require.cache[libraryPath];
  return {
    installer: require(installerPath),
    library: require(libraryPath),
  };
}

function createFixture({
  storageManager = { persist: async () => true },
  cache = new FakeCache(),
  overrides = {},
} = {}) {
  const { installer, library } = loadModules();
  const gameZipBytes = zipSync({
    "content/localflash/bikemaniaarena1/bike-mania-arena-1.swf": new Uint8Array(
      [4, 5],
    ),
  });
  let assetRequests = 0;
  const fetchObject = async (url) => {
    if (url === "/api/games?q=Bike%20Mania") {
      return new Response(JSON.stringify({ games: [details] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/logo")) {
      return new Response(new Uint8Array([9]), {
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    if (url.includes("/asset?")) {
      assetRequests++;
      return new Response(new Uint8Array([6, 7]), {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
    if (url.endsWith("/download")) {
      const bytes = url.includes(legacyUuid)
        ? new Uint8Array([7, 8])
        : gameZipBytes;
      return new Response(bytes, {
        headers: { "Content-Length": String(bytes.byteLength) },
      });
    }
    return new Response(JSON.stringify(details), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const store = new FakeStore();
  const manager = library.createManager({
    installer,
    unzipSync,
    fetchObject,
    cacheObject: cache,
    metadataStore: store,
    storageManager,
    origin: "https://xp.example",
    ...overrides,
  });
  return {
    library,
    installer,
    fetchObject,
    cache,
    store,
    manager,
    assetRequests: () => assetRequests,
  };
}

const unpersistedStorage = {
  persist: async () => {
    throw new Error("persistence unavailable");
  },
  estimate: async () => ({ usage: 1, quota: 1 }),
};

async function createInitializedFixture(options) {
  const fixture = createFixture(options);
  await fixture.manager.initialize();
  return fixture;
}

async function createLegacyFixture() {
  const fixture = await createInitializedFixture();
  fixture.legacyInstalled = await fixture.manager.install(legacyDetails);
  return fixture;
}

async function bytesOf(response) {
  return [...new Uint8Array(await response.arrayBuffer())];
}

function rewrite(library, id, url) {
  for (const [pattern, replacement] of library.assetRewriteRules(
    id,
    "https://xp.example",
  )) {
    if (pattern.test(url)) return url.replace(pattern, replacement);
  }
  return url;
}

describe("game library", () => {
  test("keeps only source metadata in the icon source registry", async () => {
    const sources = await Bun.file(
      new URL("../site/assets/icons/SOURCES.json", import.meta.url),
    ).json();
    for (const source of Object.values(sources)) {
      expect("notes" in source).toBe(false);
    }
  });

  test("uses the browser-loadable proxy URL for installed artwork", () => {
    const { library } = loadModules();
    expect(
      library.asGameConfig({
        ...details,
        iconPath: `https://xp.example/__installed-games/${uuid}/logo.jpg`,
      }).icon,
    ).toBe(details.logoUrl);
  });

  test("initializes with no games when persistence is unavailable", async () => {
    const { manager } = createFixture({ storageManager: unpersistedStorage });
    expect(await manager.initialize()).toEqual({});
  });

  test("searches the catalog", async () => {
    const { manager } = await createInitializedFixture({
      storageManager: unpersistedStorage,
    });
    const results = await manager.search("Bike Mania");
    expect(results).toHaveLength(1);
  });

  test("installs a game zip and registers it as a game", async () => {
    const { manager } = await createInitializedFixture({
      storageManager: unpersistedStorage,
    });
    const installed = await manager.install(details);
    expect(installed.id).toBe(`flashpoint:${uuid}`);
    expect(installed.category).toBe("Racing");
    expect(installed.base).toMatch(/bikemaniaarena1\/$/);
    expect(Object.keys(manager.getGames())).toHaveLength(1);
    expect(await manager.getInstallations()).toEqual([
      {
        id: `flashpoint:${uuid}`,
        uuid,
        title: details.title,
        bytes: 3,
      },
    ]);
  });

  test("serves installed game files from the cache", async () => {
    const { manager } = await createInitializedFixture({
      storageManager: unpersistedStorage,
    });
    const installed = await manager.install(details);
    const response = await manager.match(installed.url);
    expect(response).toBeInstanceOf(Response);
    expect(await bytesOf(response)).toEqual([4, 5]);
  });

  test("clears the game, cache and metadata on uninstall", async () => {
    const { manager, cache, store } = await createInitializedFixture({
      storageManager: unpersistedStorage,
    });
    await manager.install(details);
    await manager.uninstall(uuid);
    expect(manager.getGames()).toEqual({});
    expect(cache.values.size).toBe(0);
    expect(store.values.size).toBe(0);
  });

  test("reports the storage quota and rolls back when the cache is full", async () => {
    const quotaCache = new FakeCache();
    quotaCache.put = async () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const { manager, store } = await createInitializedFixture({
      cache: quotaCache,
      storageManager: { estimate: async () => ({ usage: 1, quota: 1 }) },
    });
    await expect(manager.install(details)).rejects.toThrow(/Storage is full/);
    expect(quotaCache.values.size).toBe(0);
    expect(store.values.size).toBe(0);
  });

  test("installs legacy packages and serves the downloaded file", async () => {
    const { manager, legacyInstalled } = await createLegacyFixture();
    expect(legacyInstalled.id).toBe(`flashpoint:${legacyUuid}`);
    expect(await bytesOf(await manager.match(legacyInstalled.url))).toEqual([
      7, 8,
    ]);
  });

  test("fetches and caches missing legacy assets on demand", async () => {
    const { manager, cache } = await createLegacyFixture();
    const lazyAsset = await manager.match(
      "http://localflash/bikemania3/data/config.bin",
    );
    expect(lazyAsset).toBeInstanceOf(Response);
    expect(await bytesOf(lazyAsset)).toEqual([6, 7]);
    expect(
      cache.values.has(
        `https://xp.example/__installed-games/${legacyUuid}/content/localflash/bikemania3/data/config.bin`,
      ),
    ).toBe(true);
  });

  test("ignores requests for unrelated origins", async () => {
    const { manager, assetRequests } = await createLegacyFixture();
    const before = assetRequests();
    expect(
      await manager.match("https://unrelated.example/missing.bin"),
    ).toBeNull();
    expect(assetRequests()).toBe(before);
  });

  test("shares one asset download between concurrent requests", async () => {
    const { manager, assetRequests } = await createLegacyFixture();
    const before = assetRequests();
    const concurrent = await Promise.all([
      manager.match("http://localflash/bikemania3/shared.bin"),
      manager.match("http://localflash/bikemania3/shared.bin"),
    ]);
    expect(assetRequests()).toBe(before + 1);
    for (const result of concurrent)
      expect(await bytesOf(result)).toEqual([6, 7]);
  });

  test("scopes rewritten remote asset URLs to each game", () => {
    const { library } = loadModules();
    const remote = "https://cdn.example/shared.bin";
    const firstScoped = rewrite(library, legacyUuid, remote);
    const secondScoped = rewrite(library, uuid, remote);
    expect(firstScoped).not.toBe(secondScoped);
    expect(rewrite(library, legacyUuid, firstScoped)).toBe(firstScoped);
  });

  test("caches rewritten remote assets separately for each game", async () => {
    const { library, manager, cache } = await createLegacyFixture();
    await manager.install({ ...details, packageType: "legacy" });
    const remote = "https://cdn.example/shared.bin";
    const firstScoped = rewrite(library, legacyUuid, remote);
    const secondScoped = rewrite(library, uuid, remote);
    expect(await manager.match(firstScoped)).toBeInstanceOf(Response);
    expect(await manager.match(secondScoped)).toBeInstanceOf(Response);
    expect(
      cache.values.has(
        `https://xp.example/__installed-games/${legacyUuid}/content/cdn.example/shared.bin`,
      ),
    ).toBe(true);
    expect(
      cache.values.has(
        `https://xp.example/__installed-games/${uuid}/content/cdn.example/shared.bin`,
      ),
    ).toBe(true);
  });

  test("fetches ambiguous localflash assets only for a named game", async () => {
    const { manager, assetRequests, legacyInstalled } =
      await createLegacyFixture();
    await manager.install({ ...details, packageType: "legacy" });
    const before = assetRequests();
    expect(await manager.match("http://localflash/ambiguous.bin")).toBeNull();
    expect(assetRequests()).toBe(before);
    expect(
      await manager.match("http://localflash/scoped.bin", {
        gameId: legacyInstalled.id,
      }),
    ).toBeInstanceOf(Response);
    expect(assetRequests()).toBe(before + 1);
  });

  test("serves legacy assets without caching them when storage is full", async () => {
    const { manager, cache } = await createLegacyFixture();
    cache.put = async () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const uncachedAsset = await manager.match(
      "http://localflash/bikemania3/data/optional.bin",
    );
    expect(uncachedAsset).toBeInstanceOf(Response);
    expect(await bytesOf(uncachedAsset)).toEqual([6, 7]);
    expect(
      cache.values.has(
        `https://xp.example/__installed-games/${legacyUuid}/content/localflash/bikemania3/data/optional.bin`,
      ),
    ).toBe(false);
  });

  test("ignores requests for the app's own files", async () => {
    const { manager, cache } = await createLegacyFixture();
    const sizeBefore = cache.values.size;
    expect(
      await manager.match("https://xp.example/js/runtime.wasm"),
    ).toBeNull();
    expect(cache.values.size).toBe(sizeBefore);
  });

  test("rejects downloads larger than the size limit", async () => {
    const { library } = loadModules();
    await expect(
      library.readDownload(
        new Response(new Uint8Array([1, 2]), {
          headers: { "Content-Length": "2" },
        }),
        { maxBytes: 1 },
      ),
    ).rejects.toThrow(/too big/);
  });
});

describe("game library recovery", () => {
  test.each([
    [{ installer: null }, "Can't install games"],
    [{ unzipSync: null, unzip: null }, "Can't install games"],
    [{ fetchObject: null }, "Network access"],
    [{ cacheObject: null, cachesObject: null }, "can't install games"],
  ])("reports missing browser capabilities %#", (overrides, error) => {
    expect(() => createFixture({ overrides })).toThrow(error);
  });
  test("rejects writes before initialization and notifies subscribers only while subscribed", async () => {
    const f = createFixture(),
      snapshots = [];
    await expect(f.manager.install(details)).rejects.toThrow("Still starting");
    await expect(f.manager.getInstallations()).rejects.toThrow(
      "Still starting",
    );
    await expect(f.manager.match("/asset")).rejects.toThrow("Still starting");
    await expect(f.manager.uninstall(uuid)).rejects.toThrow("Still starting");
    expect(f.manager.getRecord("absent")).toBeNull();
    await f.manager.initialize();
    const unsubscribe = f.manager.subscribe((games) => snapshots.push(games));
    const installed = await f.manager.install(details);
    expect(snapshots).toHaveLength(1);
    expect(f.manager.getRecord(installed.id).uuid).toBe(uuid);
    expect(await f.manager.install(details)).toEqual(installed);
    expect(snapshots).toHaveLength(1);
    expect(await f.manager.initialize()).toEqual(f.manager.getGames());
    unsubscribe();
    await f.manager.uninstall(uuid);
    expect(snapshots).toHaveLength(1);
  });
  test.each([
    [
      () =>
        new Response(JSON.stringify({ error: "catalog unavailable" }), {
          status: 503,
        }),
      "catalog unavailable",
    ],
    [
      () => new Response("<html>bad gateway</html>", { status: 502 }),
      "error 502",
    ],
    [() => new Response(JSON.stringify({}), { status: 403 }), "error 403"],
  ])(
    "catalog HTTP errors reach both search and details %#",
    async (response, error) => {
      const { manager } = createFixture({
        overrides: { fetchObject: async () => response() },
      });
      await expect(manager.search("game")).rejects.toThrow(error);
      await expect(manager.details(uuid)).rejects.toThrow(error);
    },
  );
  test("normalizes empty search results, forwards cancellation and estimates browser storage", async () => {
    const calls = [],
      controller = new AbortController();
    const { manager } = createFixture({
      storageManager: { estimate: async () => ({ usage: 12, quota: 100 }) },
      overrides: {
        fetchObject: async (url, options) => {
          calls.push({ url, options });
          return new Response(JSON.stringify({ games: null }));
        },
      },
    });
    expect(await manager.search("   ")).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(
      await manager.search("  Bike & Race ", { signal: controller.signal }),
    ).toEqual([]);
    expect(calls[0].url).toBe("/api/games?q=Bike%20%26%20Race");
    expect(calls[0].options.signal).toBe(controller.signal);
    expect(calls[0].options.headers.Accept).toBe("application/json");
    await manager.details("id/with space", { signal: controller.signal });
    expect(calls[1].url).toBe("/api/games/id%2Fwith%20space");
    expect(await manager.storageEstimate()).toMatchObject({
      usage: 12,
      quota: 100,
    });
  });
  test.each(["legacy", "gamezip"])(
    "streamed %s installs clean up their temporary archive",
    async (packageType) => {
      let cleaned = 0;
      const { AsyncInflate } = require("fflate");
      const f = createFixture({
        overrides: {
          Inflate: AsyncInflate,
          temporaryArchive: async (response) => ({
            blob: await response.blob(),
            cleanup: async () => {
              cleaned++;
            },
          }),
        },
      });
      await f.manager.initialize();
      const installed = await f.manager.install(
        packageType === "legacy" ? legacyDetails : details,
      );
      expect(cleaned).toBe(1);
      expect(await bytesOf(await f.manager.match(installed.url))).toEqual(
        packageType === "legacy" ? [7, 8] : [4, 5],
      );
    },
  );
  test("a failed logo metadata update removes only artwork and preserves a playable installation", async () => {
    const store = new FakeStore();
    store.put = async (record) => {
      if (record.iconPath) throw new Error("logo metadata unavailable");
      store.values.set(record.id, record);
    };
    const f = createFixture({ overrides: { metadataStore: store } });
    await f.manager.initialize();
    const installed = await f.manager.install(details);
    expect(installed.iconPath).toBeUndefined();
    expect(
      await f.cache.match(
        `https://xp.example/__installed-games/${uuid}/logo.jpg`,
      ),
    ).toBeNull();
    expect(await bytesOf(await f.manager.match(installed.url))).toEqual([4, 5]);
    expect(store.values.size).toBe(1);
  });
  test("a failed logo update still installs when its artwork cannot be removed", async () => {
    const store = new FakeStore();
    store.put = async (record) => {
      if (record.iconPath) throw new Error("logo metadata unavailable");
      store.values.set(record.id, record);
    };
    const cache = new FakeCache();
    const deleted = [];
    cache.delete = async (key) => {
      deleted.push(String(key));
      throw new Error("cache locked");
    };
    const f = createFixture({ cache, overrides: { metadataStore: store } });
    await f.manager.initialize();
    const installed = await f.manager.install(details);
    expect(deleted).toEqual([
      `https://xp.example/__installed-games/${uuid}/logo.jpg`,
    ]);
    expect(installed.iconPath).toBeUndefined();
    expect(await bytesOf(await f.manager.match(installed.url))).toEqual([4, 5]);
  });

  test("missing legacy assets are negatively cached but server errors remain retryable", async () => {
    let status = 404,
      requests = 0;
    const base = createFixture();
    const f = createFixture({
      overrides: {
        fetchObject: async (url) => {
          if (url.includes("/asset?")) {
            requests++;
            return new Response("missing", { status });
          }
          return base.fetchObject(url);
        },
      },
    });
    await f.manager.initialize();
    await f.manager.install(legacyDetails);
    const path = `https://xp.example/__installed-games/${legacyUuid}/content/remote.example/missing.txt`;
    expect(await f.manager.match(path)).toBeNull();
    expect(await f.manager.match(path)).toBeNull();
    expect(requests).toBe(1);
    status = 500;
    for (let i = 0; i < 2; i++)
      expect(await f.manager.match(`${path}?retry=${i}`)).toBeNull();
    // Query strings do not change the archive path or bypass its negative cache.
    expect(requests).toBe(1);
    const different = path.replace("missing.txt", "retry.txt");
    expect(await f.manager.match(different)).toBeNull();
    expect(await f.manager.match(different)).toBeNull();
    expect(requests).toBe(3);
  });
  test("synthetic asset URLs reject malformed encoding, unknown games and unsafe archive paths", async () => {
    const { manager, assetRequests } = await createLegacyFixture();
    for (const path of [
      "http://[",
      "data:text/plain,test",
      "/__installed-games/no-slash",
      "/__installed-games/unknown/content/a",
      `/__installed-games/${legacyUuid}/content/%ZZ`,
      `/__installed-games/${legacyUuid}/content/a%2F..%2Fsecret`,
      `/__installed-games/${legacyUuid}/metadata.json`,
    ])
      expect(await manager.match(path)).toBeNull();
    expect(assetRequests()).toBe(0);
  });
});

test.each(["success", "callback-error", "throw", "abort", "already-aborted"])(
  "background ZIP decoding handles %s",
  async (outcome) => {
    const previous = globalThis.fflate,
      controller = new AbortController();
    let terminated = 0;
    globalThis.fflate = {
      unzip(bytes, callback) {
        if (outcome === "throw") throw new Error("decoder failed");
        queueMicrotask(() => {
          if (outcome === "abort")
            controller.abort(new Error("cancelled unzip"));
          else if (outcome === "callback-error")
            callback(new Error("decoder failed"));
          else callback(null, unzipSync(bytes));
        });
        return () => {
          terminated++;
        };
      },
    };
    try {
      const f = createFixture({ overrides: { unzipSync: null } });
      await f.manager.initialize();
      if (outcome === "already-aborted")
        controller.abort(new Error("cancelled unzip"));
      const install = f.manager.install(details, { signal: controller.signal });
      if (outcome === "success") {
        const game = await install;
        expect(await bytesOf(await f.manager.match(game.url))).toEqual([4, 5]);
      } else {
        await expect(install).rejects.toThrow(
          outcome.includes("abort") ? "cancelled unzip" : "decoder failed",
        );
        expect(f.cache.values.size).toBe(0);
        expect(f.store.values.size).toBe(0);
      }
      expect(terminated).toBe(outcome === "abort" ? 1 : 0);
    } finally {
      globalThis.fflate = previous;
    }
  },
);

describe("game library browser integration", () => {
  const { IDBFactory } = require("fake-indexeddb");
  const fflate = require("fflate");

  const withGlobals = async (globals, callback) => {
    const previous = Object.fromEntries(
      Object.keys(globals).map((key) => [key, globalThis[key]]),
    );
    Object.assign(globalThis, globals);
    try {
      return await callback();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  };

  test("stores metadata in IndexedDB and reports unavailable or blocked storage", async () => {
    const { library } = loadModules();
    const indexedDB = new IDBFactory();
    const store = await library.createMetadataStore(indexedDB);
    await store.put({ id: "flashpoint:1", title: "One" });
    expect(await store.get("flashpoint:1")).toEqual({
      id: "flashpoint:1",
      title: "One",
    });
    expect(await store.list()).toHaveLength(1);
    await store.delete("flashpoint:1");
    expect(await store.list()).toEqual([]);
    store.close();
    await expect(library.createMetadataStore()).rejects.toThrow(
      "can't save games",
    );
    const newer = indexedDB.open(library.DB_NAME, 5);
    await new Promise((resolve) => (newer.onsuccess = resolve));
    newer.result.close();
    await expect(library.createMetadataStore(indexedDB)).rejects.toThrow();
  });

  test("reports failed storage requests and transactions with their error or a default", async () => {
    const { library } = loadModules();
    const scriptedIndexedDB = ({ request = {}, transaction = {} }) => {
      const database = {
        objectStoreNames: { contains: () => true },
        createObjectStore() {
          throw new Error("the existing store must be reused");
        },
        transaction() {
          // Each outcome fires once transactionDone listens for it. Like a
          // browser, an error event comes from the failed request, and the
          // transaction has no error yet.
          const fire = (event, callback) => {
            if ((transaction.event ?? "complete") !== event) return;
            setTimeout(() => {
              if (event === "error")
                callback({ target: { error: transaction.error } });
              else {
                tx.error = transaction.error;
                callback();
              }
            });
          };
          const tx = {
            objectStore: () => ({
              getAll() {
                const req = { result: [] };
                setTimeout(() =>
                  request.event
                    ? ((req.error = request.error), req.onerror())
                    : req.onsuccess(),
                );
                return req;
              },
            }),
            set oncomplete(callback) {
              fire("complete", callback);
            },
            set onabort(callback) {
              fire("abort", callback);
            },
            set onerror(callback) {
              fire("error", callback);
            },
          };
          return tx;
        },
        close() {},
      };
      return {
        open() {
          const req = { result: database };
          setTimeout(() => {
            req.onupgradeneeded();
            req.onsuccess();
          });
          return req;
        },
      };
    };
    const quota = new Error("Quota exceeded");
    for (const [options, expected] of [
      [{ request: { event: true } }, "Browser storage request failed."],
      [{ request: { event: true, error: quota } }, "Quota exceeded"],
      [{ transaction: { event: "abort" } }, "Browser storage was aborted."],
      [{ transaction: { event: "abort", error: quota } }, "Quota exceeded"],
      [{ transaction: { event: "error" } }, "Browser storage failed."],
      [{ transaction: { event: "error", error: quota } }, "Quota exceeded"],
    ]) {
      const store = await library.createMetadataStore(
        scriptedIndexedDB(options),
      );
      await expect(store.list()).rejects.toThrow(expected);
    }
    const healthy = await library.createMetadataStore(scriptedIndexedDB({}));
    expect(await healthy.list()).toEqual([]);
  });

  test("describes records without tags or titles as downloaded games", () => {
    const { library } = loadModules();
    expect(
      library.asGameConfig({ tags: "Racing", launchPath: "/game.swf" }),
    ).toMatchObject({
      title: "Installed Flash Game",
      category: "Downloaded Games",
      icon: null,
    });
  });

  test("uses browser globals when no dependencies are injected", async () => {
    const { installer, library } = loadModules();
    const indexedDB = new IDBFactory();
    const seeded = await library.createMetadataStore(indexedDB);
    await seeded.put({
      ...details,
      id: `flashpoint:${uuid}`,
      launchPath: "/x",
    });
    seeded.close();
    await withGlobals(
      {
        fflate,
        indexedDB,
        document: {},
        location: { origin: "https://xp.example" },
        caches: { open: async () => new FakeCache() },
      },
      async () => {
        const manager = library.createManager();
        expect(Object.keys(await manager.initialize())).toEqual([
          `flashpoint:${uuid}`,
        ]);
      },
    );
    const local = library.createManager({
      installer,
      unzipSync,
      cacheObject: new FakeCache(),
      metadataStore: new FakeStore(),
    });
    await local.initialize();
    expect(await local.match("https://astro.local/other.js")).toBeNull();
  });

  test("extracts archives in the background and honors cancellation", async () => {
    const { installer, library } = loadModules();
    const gameZip = zipSync({
      "content/localflash/bikemaniaarena1/bike-mania-arena-1.swf":
        new Uint8Array([4, 5]),
    });
    const base = createFixture();
    await withGlobals({ fflate }, async () => {
      const manager = library.createManager({
        installer,
        fetchObject: base.fetchObject,
        cacheObject: new FakeCache(),
        metadataStore: new FakeStore(),
        origin: "https://xp.example",
      });
      await manager.initialize();
      const game = await manager.install({ ...details, logoUrl: undefined });
      expect(await bytesOf(await manager.match(game.url))).toEqual([4, 5]);
      await manager.uninstall(uuid);

      const controller = new AbortController();
      const unzip = fflate.unzip;
      fflate.unzip = (_bytes, callback) => {
        controller.abort();
        return () => callback(new Error("terminated"));
      };
      try {
        await expect(
          manager.install(details, { signal: controller.signal }),
        ).rejects.toThrow();
      } finally {
        fflate.unzip = unzip;
      }
      let cancel;
      const reasonless = {
        reason: undefined,
        throwIfAborted() {},
        addEventListener: (_type, listener) => (cancel = listener),
        removeEventListener() {},
      };
      let terminations = 0;
      fflate.unzip = () => {
        setTimeout(cancel);
        return () => terminations++;
      };
      try {
        await expect(
          manager.install(details, { signal: reasonless }),
        ).rejects.toThrow("Download cancelled");
        expect(terminations).toBe(1);
      } finally {
        fflate.unzip = unzip;
      }
      fflate.unzip = () => {
        throw new Error("worker unavailable");
      };
      try {
        await expect(manager.install(details)).rejects.toThrow(
          "worker unavailable",
        );
      } finally {
        fflate.unzip = unzip;
      }
      fflate.unzip = (_bytes, callback) => callback(new Error("bad deflate"));
      try {
        await expect(manager.install(details)).rejects.toThrow("bad deflate");
      } finally {
        fflate.unzip = unzip;
      }
      expect(gameZip.byteLength).toBeGreaterThan(0);
    });
  });

  test("cleans up temporary archives when a stream fails or is cancelled", async () => {
    const { library } = loadModules();
    const removed = [];
    const storageManager = {
      async getDirectory() {
        return {
          async getFileHandle() {
            return {
              async createWritable() {
                return {
                  async write() {},
                  async close() {},
                  async abort() {
                    throw new Error("already closed");
                  },
                };
              },
            };
          },
          async removeEntry(name) {
            removed.push(name);
            throw new Error("entry locked");
          },
        };
      },
    };
    let resolveRead;
    const reader = {
      read: () => new Promise((resolve) => (resolveRead = resolve)),
      cancel: async () => {
        throw new Error("stream closed");
      },
      releaseLock() {},
    };
    const response = {
      ok: true,
      headers: new Headers(),
      body: { getReader: () => reader },
    };
    const controller = new AbortController();
    const pending = library.createTemporaryArchive(response, {
      storageManager,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    resolveRead({ done: false, value: new Uint8Array([1]) });
    await expect(pending).rejects.toThrow();
    expect(removed).toHaveLength(1);
    await expect(
      library.createTemporaryArchive(
        { ok: true, headers: new Headers(), body: null },
        { storageManager },
      ),
    ).rejects.toThrow("The download was empty. Try again.");
  });

  test("reports temporary archive cleanup failures after installing", async () => {
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    try {
      const f = createFixture({
        overrides: {
          temporaryArchive: async (response) => ({
            blob: await response.blob(),
            cleanup: async () => {
              throw new Error("archive locked");
            },
          }),
          Inflate: fflate.AsyncInflate,
        },
      });
      await f.manager.initialize();
      await f.manager.install({ ...legacyDetails, logoUrl: undefined });
    } finally {
      console.error = originalError;
    }
    expect(errors[0][0]).toBe("Could not remove temporary game archive:");
  });

  test("skips artwork that is missing or cannot be downloaded", async () => {
    for (const logo of [
      async () => new Response("missing", { status: 404 }),
      async () => {
        throw new Error("offline");
      },
    ]) {
      const base = createFixture();
      const f = createFixture({
        overrides: {
          fetchObject: async (url, options) =>
            url.endsWith("/logo") ? logo() : base.fetchObject(url, options),
        },
      });
      await f.manager.initialize();
      const installed = await f.manager.install(details);
      expect(installed.iconPath).toBeUndefined();
    }
  });

  test("reports installed sizes from headers, bodies, or nothing cached", async () => {
    const f = await createInitializedFixture();
    const installed = await f.manager.install(details);
    await f.manager.install(legacyDetails);
    const prefix = `https://xp.example/__installed-games/${uuid}/`;
    await f.cache.put(
      `${prefix}sized.bin`,
      new Response(new Uint8Array(3), { headers: { "Content-Length": "5" } }),
    );
    f.cache.values.set(`${prefix}unsized.bin`, new Response(new Uint8Array(2)));
    f.cache.values.set(`${prefix}gone.bin`, null);
    f.cache.values.set("https://xp.example/unrelated.bin", new Response("x"));
    for (const key of [...f.cache.values.keys()])
      if (key.includes(legacyUuid)) f.cache.values.delete(key);
    const installations = await f.manager.getInstallations();
    expect(installations.find(({ uuid: id }) => id === legacyUuid).bytes).toBe(
      0,
    );
    expect(
      installations.find(({ id }) => id === installed.id).bytes,
    ).toBeGreaterThanOrEqual(7);
  });

  test("searches for nothing when the query is missing", async () => {
    const f = createFixture();
    expect(await f.manager.search(null)).toEqual([]);
  });

  test("serves legacy assets from cache and forgets old missing paths", async () => {
    let assetRequests = 0;
    const base = createFixture();
    const f = createFixture({
      overrides: {
        fetchObject: async (url, options) => {
          if (url.includes("/asset?")) {
            assetRequests++;
            return url.includes("missing")
              ? new Response("missing", { status: 404 })
              : new Response(new Uint8Array([6]));
          }
          return base.fetchObject(url, options);
        },
      },
    });
    await f.manager.initialize();
    await f.manager.install(legacyDetails);
    const asset = `https://xp.example/__installed-games/${legacyUuid}/content/remote.example/a.bin`;
    expect(await bytesOf(await f.manager.match(asset))).toEqual([6]);
    expect(
      await bytesOf(await f.manager.match(new Request(`${asset}?v=2`))),
    ).toEqual([6]);
    expect(assetRequests).toBe(1);
    for (let index = 0; index < 258; index++)
      await f.manager.match(
        `https://xp.example/__installed-games/${legacyUuid}/content/remote.example/missing-${index}.bin`,
      );
    expect(
      await f.manager.match(
        `https://xp.example/__installed-games/${legacyUuid}/content/remote.example/missing-0.bin`,
      ),
    ).toBeNull();
    expect(assetRequests).toBe(260);
  });

  test("does not fetch legacy assets for complete archives", async () => {
    const f = await createInitializedFixture();
    await f.manager.install({ ...details, legacyFallback: false });
    expect(
      await f.manager.match(
        `https://xp.example/__installed-games/${uuid}/content/remote.example/a.bin`,
      ),
    ).toBeNull();
    expect(f.assetRequests()).toBe(0);
  });

  test("propagates cache failures other than a full quota", async () => {
    const cache = new FakeCache();
    const f = await createInitializedFixture({ cache });
    await f.manager.install(legacyDetails);
    cache.put = async () => {
      throw new Error("cache corrupted");
    };
    await expect(
      f.manager.match(
        `https://xp.example/__installed-games/${legacyUuid}/content/remote.example/new.bin`,
      ),
    ).rejects.toThrow("cache corrupted");
  });

  test("resolves remote asset requests from cache and skips malformed records", async () => {
    const f = await createInitializedFixture();
    const installed = await f.manager.install(details);
    await f.store.put({
      ...f.store.values.get(installed.id),
      id: "flashpoint:broken",
      uuid: "broken",
      launchCommand: "not a url",
    });
    const reloaded = createFixture({
      cache: f.cache,
      overrides: { metadataStore: f.store },
    });
    await reloaded.manager.initialize();
    const cached = await reloaded.manager.match(
      "http://localflash/bikemaniaarena1/bike-mania-arena-1.swf?cache=1",
    );
    expect(await bytesOf(cached)).toEqual([4, 5]);
  });
});
