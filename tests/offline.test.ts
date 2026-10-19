// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const offlinePath = require.resolve("../site/js/offline.js");
delete require.cache[offlinePath];
const {
  BUNDLED_GAME_CACHE,
  createManager,
  validateGameManifest,
  waitForWorker,
} = require(offlinePath);

class Events {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }
  removeEventListener(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }
  dispatch(name) {
    this.listeners.get(name)?.forEach((listener) => listener());
  }
}

class Worker extends Events {
  constructor(state = "activated", version = null, scriptURL = null) {
    super();
    this.state = state;
    this.version = version;
    this.scriptURL = scriptURL;
    this.messages = [];
  }
  transition(state) {
    this.state = state;
    this.dispatch("statechange");
  }
  postMessage(message, ports = []) {
    if (message.type === "GET_VERSION") {
      if (this.version) ports[0]?.postMessage({ version: this.version });
      return;
    }
    this.messages.push(message);
  }
}

class Registration extends Events {
  constructor({ active = null, installing = null, waiting = null } = {}) {
    super();
    this.active = active;
    this.installing = installing;
    this.waiting = waiting;
    this.updateCalls = 0;
    this.unregisterCalls = 0;
  }
  async update() {
    this.updateCalls += 1;
  }
  async unregister() {
    this.unregisterCalls += 1;
  }
}

class MemoryStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

class MemoryCache {
  constructor() {
    this.values = new Map();
  }
  async put(key, response) {
    this.values.set(String(key), response);
  }
  async match(key) {
    return this.values.get(String(key));
  }
  async delete(key) {
    return this.values.delete(String(key?.url ?? key));
  }
  async keys() {
    return [...this.values.keys()].map((key) => new Request(key));
  }
}

const manifest = {
  version: "26.07.29-aaaaaaa",
  runtime: {
    revision: "runtime-1",
    bytes: 10,
    files: [{ url: "js/runtime.wasm?rev=runtime-1", bytes: 10 }],
  },
  runtimes: {
    scummvm: {
      revision: "scummvm-1",
      bytes: 8,
      files: [
        {
          url: "vendor/scummvm/scummvm.wasm?rev=scummvm-1",
          bytes: 8,
        },
      ],
    },
  },
  games: {
    "bike-mania": {
      revision: "bike-1",
      root: "swf/bike-mania.bike-1/",
      type: "swf",
      bytes: 4,
      files: [{ url: "swf/bike-mania.bike-1/main.swf", bytes: 4 }],
    },
    doom: {
      revision: "doom-1",
      root: "iframe/doom.doom-1/",
      type: "iframe",
      bytes: 6,
      files: [
        { url: "iframe/doom.doom-1/index.html", bytes: 2 },
        { url: "iframe/doom.doom-1/dos/doom/doom.jsdos", bytes: 4 },
      ],
    },
    "pink-panther-passport-to-peril": {
      revision: "peril-1",
      root: "iframe/pink-panther-passport-to-peril.peril-1/",
      runtime: "scummvm",
      type: "iframe",
      bytes: 2,
      files: [
        {
          url: "iframe/pink-panther-passport-to-peril.peril-1/index.html",
          bytes: 2,
        },
      ],
    },
    "pink-panther-hokus-pokus": {
      revision: "pokus-1",
      root: "iframe/pink-panther-hokus-pokus.pokus-1/",
      runtime: "scummvm",
      type: "iframe",
      bytes: 2,
      files: [
        {
          url: "iframe/pink-panther-hokus-pokus.pokus-1/index.html",
          bytes: 2,
        },
      ],
    },
  },
};
const testIntegrity = `sha384-${"A".repeat(64)}`;
const now = 1_800_000_000_000;
const sixHours = 6 * 60 * 60 * 1000;
for (const entry of [
  manifest.runtime,
  ...Object.values(manifest.runtimes),
  ...Object.values(manifest.games),
]) {
  for (const file of entry.files) file.integrity = testIntegrity;
}

const makeEnvironment = ({
  assetBaseUrl = "https://xp.example/",
  registration = new Registration({
    active: new Worker("activated", manifest.version),
  }),
  remoteVersion = "26.07.29-aaaaaaa",
  remoteReleasedAt = new Date(now - sixHours).toISOString(),
  stabilityDelayMs = sixHours,
  storageValues = {},
  sessionValues = {},
} = {}) => {
  let remote = {
    releasedAt: remoteReleasedAt,
    stabilityDelayMs,
    version: remoteVersion,
  };
  let currentTime = now;
  const serviceWorker = new Events();
  serviceWorker.controller = registration.active;
  serviceWorker.registerCalls = [];
  serviceWorker.register = async (...args) => {
    serviceWorker.registerCalls.push(args);
    return registration;
  };
  serviceWorker.getRegistration = async () => registration;
  serviceWorker.ready = Promise.resolve(registration);
  const bundledCache = new MemoryCache();
  const shellCache = new MemoryCache();
  const deletedCaches = [];
  const storage = new MemoryStorage({
    astroXpLastUpdateCheck: "1800000000000",
    ...storageValues,
  });
  const sessionStorage = new MemoryStorage(sessionValues);
  let reloads = 0;
  const timers = [];
  const fetches = [];
  const environment = new Events();
  Object.assign(environment, {
    navigator: {
      onLine: true,
      serviceWorker,
      storage: {
        estimate: async () => ({ usage: 100, quota: 10_000 }),
      },
    },
    localStorage: storage,
    sessionStorage,
    MessageChannel,
    location: {
      href: "https://xp.example/",
      origin: "https://xp.example",
      reload: () => {
        reloads += 1;
      },
    },
    Date: { now: () => currentTime },
    clearTimeout() {},
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    document: Object.assign(new Events(), {
      baseURI: assetBaseUrl,
      visibilityState: "visible",
    }),
    caches: {
      keys: async () => ["astro-xp-precache", BUNDLED_GAME_CACHE],
      open: async (name) =>
        name === BUNDLED_GAME_CACHE ? bundledCache : shellCache,
      delete: async (name) => {
        deletedCaches.push(name);
        if (name === BUNDLED_GAME_CACHE) bundledCache.values.clear();
        return true;
      },
    },
    fetch: async (url, options) => {
      fetches.push({ options, url });
      expect(options.cache).toBe("no-store");
      if (String(url).startsWith("/version.json")) {
        return new Response(
          JSON.stringify({
            version: remote.version,
            revision: remote.version.split("-").at(-1),
            releasedAt: remote.releasedAt,
            stabilityDelayMs: remote.stabilityDelayMs,
            offlineBytes: 8_000_000,
            bundledGameBytes: 10,
          }),
        );
      }
      if (url === "offline-games.json") {
        return new Response(JSON.stringify(manifest));
      }
      return new Response(new Uint8Array([1]));
    },
  });
  return {
    bundledCache,
    deletedCaches,
    environment,
    fetches,
    getReloads: () => reloads,
    registration,
    setNow: (value) => {
      currentTime = value;
    },
    setRemote: (value) => {
      remote = { ...remote, ...value };
    },
    serviceWorker,
    storage,
    sessionStorage,
    timers,
  };
};

const createInitializedManager = async (environment) => {
  const manager = createManager({
    currentVersion: manifest.version,
    environment,
  });
  await manager.initialize();
  return manager;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const flushUntil = async (condition, attempts = 50) => {
  for (let attempt = 0; attempt < attempts && !condition(); attempt += 1) {
    await flush();
  }
};

const countVersionFetches = ({ fetches }) =>
  fetches.filter(({ url }) => String(url).startsWith("/version.json")).length;

const makeDisabledEnvironment = () =>
  makeEnvironment({
    storageValues: {
      astroXpOfflineEnabled: "false",
      astroXpOfflineGameRecords: JSON.stringify({
        "synthetic-game": {
          bytes: 4,
          files: ["swf/synthetic-game/main.swf"],
          revision: "synthetic-1",
          type: "swf",
        },
      }),
      syntheticPersonalPreference: "preserve-me",
    },
  });

const makeReenabledManager = async () => {
  const disabled = makeDisabledEnvironment();
  const manager = await createInitializedManager(disabled.environment);
  await manager.setOfflineEnabled(true);
  return { disabled, manager };
};

describe("waitForWorker", () => {
  test("resolves once an installing worker becomes activated", async () => {
    const activatingWorker = new Worker("installing");
    const activation = waitForWorker(activatingWorker);
    activatingWorker.transition("activated");
    await activation;
  });
});

describe("validateGameManifest", () => {
  test("rejects file URLs that escape the asset root", () => {
    expect(() =>
      validateGameManifest({
        ...manifest,
        runtime: {
          ...manifest.runtime,
          files: [{ url: "../runtime.wasm", bytes: 1 }],
        },
      }),
    ).toThrow(/didn't load/);
  });
});

describe("offline manager", () => {
  test("registers the versioned worker and becomes ready with default preferences", async () => {
    const initial = makeEnvironment();
    const manager = await createInitializedManager(initial.environment);
    expect(manager.getSnapshot().enabled).toBe(true);
    expect(manager.getSnapshot().savePlayedGamesOffline).toBe(true);
    expect(manager.getSnapshot().automaticUpdatesEnabled).toBe(true);
    expect(initial.serviceWorker.registerCalls[0]).toEqual([
      `/sw.${manifest.version}.js`,
      { scope: "/", updateViaCache: "none" },
    ]);
    expect(manager.getSnapshot().phase).toBe("ready");
    expect(manager.getSnapshot().bundledGames.length).toBe(4);
  });

  test("unregisters the worker and clears caches and game records when offline access is disabled", async () => {
    const disabled = makeDisabledEnvironment();
    const disabledManager = await createInitializedManager(
      disabled.environment,
    );
    expect(disabledManager.getSnapshot().enabled).toBe(false);
    expect(disabledManager.getSnapshot().phase).toBe("disabled");
    expect(disabled.registration.unregisterCalls).toBe(1);
    expect(disabled.serviceWorker.registerCalls.length).toBe(0);
    await expect(disabledManager.downloadGame("bike-mania")).rejects.toThrow(
      /Enable offline access/,
    );
    expect(
      disabled.fetches.some(({ url }) =>
        String(url).startsWith("/version.json"),
      ),
    ).toBe(false);
    expect(disabled.deletedCaches).toContain("astro-xp-precache");
    expect(disabled.deletedCaches).toContain(BUNDLED_GAME_CACHE);
    expect(
      JSON.parse(disabled.storage.getItem("astroXpOfflineGameRecords")),
    ).toEqual({});
    expect(disabled.storage.getItem("syntheticPersonalPreference")).toBe(
      "preserve-me",
    );
  });

  test("registers the worker again when offline access is re-enabled", async () => {
    const { disabled, manager } = await makeReenabledManager();
    expect(manager.getSnapshot().enabled).toBe(true);
    expect(manager.getSnapshot().phase).toBe("ready");
    expect(disabled.serviceWorker.registerCalls.length).toBe(1);
  });

  test("persists the save-played-games preference", async () => {
    const { disabled, manager } = await makeReenabledManager();
    manager.setSavePlayedGamesOffline(false);
    expect(disabled.storage.getItem("astroXpSavePlayedGamesOffline")).toBe(
      "false",
    );
  });

  test("skips update checks on visibility changes but still checks manually when automatic updates are disabled", async () => {
    const { disabled, manager } = await makeReenabledManager();
    manager.setSavePlayedGamesOffline(false);
    manager.setAutomaticUpdatesEnabled(false);
    const versionFetchesBeforeVisibility = countVersionFetches(disabled);
    disabled.setNow(now + 2 * 60 * 60 * 1000);
    disabled.environment.document.dispatch("visibilitychange");
    await flush();
    expect(countVersionFetches(disabled)).toBe(versionFetchesBeforeVisibility);
    await manager.checkForUpdates();
    expect(countVersionFetches(disabled)).toBe(
      versionFetchesBeforeVisibility + 1,
    );
  });

  test("shares one in-flight update and does not re-register while a worker is installing", async () => {
    const downloading = makeEnvironment();
    const downloadingManager = await createInitializedManager(
      downloading.environment,
    );
    downloading.setRemote({ version: "26.07.30-download" });
    downloading.registration.installing = new Worker(
      "installing",
      "26.07.30-download",
    );
    const firstUpdate = downloadingManager.updateNow();
    expect(downloadingManager.getSnapshot().phase).toBe("checking");
    expect(downloadingManager.updateNow()).toBe(firstUpdate);
    await firstUpdate;
    expect(downloadingManager.getSnapshot().phase).toBe("updating");
    expect(downloadingManager.getSnapshot().workerState).toBe("installing");
    const registrationsDuringDownload =
      downloading.serviceWorker.registerCalls.length;
    await downloadingManager.updateNow();
    expect(downloading.serviceWorker.registerCalls.length).toBe(
      registrationsDuringDownload,
    );
  });

  test("installs a manual update and reloads only once when automatic updates are disabled", async () => {
    const manualUpdates = makeEnvironment({
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    const manualUpdatesManager = await createInitializedManager(
      manualUpdates.environment,
    );
    expect(
      manualUpdates.fetches.some(({ url }) =>
        String(url).startsWith("/version.json"),
      ),
    ).toBe(false);
    manualUpdates.setRemote({ version: "26.07.30-manual11" });
    manualUpdates.registration.waiting = new Worker(
      "installed",
      "26.07.30-manual11",
    );
    await manualUpdatesManager.updateNow();
    expect(manualUpdates.registration.waiting.messages).toEqual([
      { type: "SKIP_WAITING" },
    ]);
    manualUpdates.serviceWorker.dispatch("controllerchange");
    expect(manualUpdates.getReloads()).toBe(1);
    manualUpdates.serviceWorker.dispatch("controllerchange");
    // The manual reload intent is consumed once.
    expect(manualUpdates.getReloads()).toBe(1);
  });

  test("migrates a legacy query-string worker to the versioned worker script", async () => {
    const legacyActiveWorker = new Worker(
      "activated",
      manifest.version,
      `/sw.js?v=${manifest.version}`,
    );
    const migrationRegistration = new Registration({
      active: legacyActiveWorker,
    });
    const migration = makeEnvironment({
      registration: migrationRegistration,
      remoteVersion: manifest.version,
    });
    const migrationWaitingWorker = new Worker("installed", manifest.version);
    migration.serviceWorker.register = async (...args) => {
      migration.serviceWorker.registerCalls.push(args);
      migrationRegistration.waiting = migrationWaitingWorker;
      return migrationRegistration;
    };
    await createInitializedManager(migration.environment);
    expect(migration.serviceWorker.registerCalls[0][0]).toBe(
      `/sw.${manifest.version}.js`,
    );
    expect(migrationWaitingWorker.messages).toEqual([{ type: "SKIP_WAITING" }]);
  });

  test("migrates a legacy worker without checking for updates when automatic updates are disabled", async () => {
    const manualMigrationRegistration = new Registration({
      active: new Worker(
        "activated",
        manifest.version,
        `/sw.js?v=${manifest.version}`,
      ),
    });
    const manualMigration = makeEnvironment({
      registration: manualMigrationRegistration,
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    const manualMigrationWorker = new Worker("installed", manifest.version);
    manualMigration.serviceWorker.register = async (...args) => {
      manualMigration.serviceWorker.registerCalls.push(args);
      manualMigrationRegistration.waiting = manualMigrationWorker;
      return manualMigrationRegistration;
    };
    await createInitializedManager(manualMigration.environment);
    expect(manualMigration.serviceWorker.registerCalls[0][0]).toBe(
      `/sw.${manifest.version}.js`,
    );
    expect(manualMigrationWorker.messages).toEqual([{ type: "SKIP_WAITING" }]);
    expect(
      manualMigration.fetches.some(({ url }) =>
        String(url).startsWith("/version.json"),
      ),
    ).toBe(false);
  });

  test("downloads a game and its runtime with integrity metadata", async () => {
    const initial = makeEnvironment();
    const manager = await createInitializedManager(initial.environment);
    await manager.downloadGame("bike-mania");
    expect(
      initial.fetches.find(({ url }) =>
        String(url).includes("bike-mania.bike-1/main.swf"),
      ).options.integrity,
    ).toBe(testIntegrity);
    expect(manager.getSnapshot().downloadedGameIds).toEqual(["bike-mania"]);
    expect(manager.getSnapshot().downloadedGameBytes).toBe(14);
    expect(initial.bundledCache.values.size).toBe(2);
  });

  test("caches game files relative to a versioned asset base URL", async () => {
    const versioned = makeEnvironment({
      assetBaseUrl: `https://xp.example/releases/${manifest.version}/`,
    });
    const versionedManager = await createInitializedManager(
      versioned.environment,
    );
    await versionedManager.downloadGame("bike-mania");
    expect(
      versioned.fetches.some(
        ({ url }) =>
          new URL(url, `https://xp.example/releases/${manifest.version}/`)
            .href ===
          `https://xp.example/releases/${manifest.version}/swf/bike-mania.bike-1/main.swf`,
      ),
    ).toBe(true);
    expect(
      versioned.bundledCache.values.has(
        "https://xp.example/swf/bike-mania.bike-1/main.swf",
      ),
    ).toBe(true);
  });

  test("keeps downloaded games offline after an update to a new release", async () => {
    const before = makeEnvironment({
      assetBaseUrl: "https://xp.example/releases/26.07.28-old/",
    });
    const oldManager = await createInitializedManager(before.environment);
    await oldManager.downloadGame("bike-mania");
    const legacyKey =
      "https://xp.example/releases/26.07.28-old/swf/legacy/main.swf";
    await before.bundledCache.put(legacyKey, new Response("old layout"));

    const after = makeEnvironment({
      assetBaseUrl: `https://xp.example/releases/${manifest.version}/`,
      storageValues: Object.fromEntries(before.storage.values),
    });
    after.bundledCache.values = before.bundledCache.values;
    const manager = await createInitializedManager(after.environment);
    await flushUntil(() => !after.bundledCache.values.has(legacyKey));

    expect(manager.getSnapshot().downloadedGameIds).toEqual(["bike-mania"]);
    expect(
      after.fetches.some(({ url }) => String(url).includes("main.swf")),
    ).toBeFalse();
    expect([...after.bundledCache.values.keys()].sort()).toEqual([
      "https://xp.example/js/runtime.wasm?rev=runtime-1",
      "https://xp.example/swf/bike-mania.bike-1/main.swf",
    ]);
  });

  test("downloads a game again when its files are missing from the cache", async () => {
    const initial = makeEnvironment();
    const manager = await createInitializedManager(initial.environment);
    await manager.downloadGame("bike-mania");
    initial.bundledCache.values.clear();

    const restarted = makeEnvironment({
      storageValues: Object.fromEntries(initial.storage.values),
    });
    restarted.bundledCache.values = initial.bundledCache.values;
    await createInitializedManager(restarted.environment);
    await flushUntil(() => restarted.bundledCache.values.size === 2);

    expect(
      restarted.fetches.filter(({ url }) => String(url).includes("main.swf")),
    ).toHaveLength(1);
  });

  test("keeps synchronizing when an old release file cannot be deleted", async () => {
    const h = makeEnvironment();
    const legacyKey = "https://xp.example/releases/26.07.28-old/swf/a.swf";
    await h.bundledCache.put(legacyKey, new Response("old layout"));
    h.bundledCache.delete = async () => {
      throw new Error("synthetic cache failure");
    };
    const manager = await createInitializedManager(h.environment);
    await flush();
    expect(manager.getSnapshot().gameError).toBeNull();
  });

  test("keeps older game records that never listed their files", async () => {
    const legacy = makeEnvironment({
      storageValues: {
        astroXpOfflineGameRecords: JSON.stringify({
          doom: { bytes: 6, revision: "doom-1", type: "iframe" },
        }),
      },
    });
    const manager = await createInitializedManager(legacy.environment);
    await flush();
    expect(
      legacy.fetches.some(({ url }) => String(url).includes("doom")),
    ).toBeFalse();
    expect(manager.getSnapshot().downloadedGameIds).toEqual(["doom"]);
  });

  test("waits until online before downloading missing files again", async () => {
    const initial = makeEnvironment();
    const manager = await createInitializedManager(initial.environment);
    await manager.downloadGame("bike-mania");
    initial.bundledCache.values.clear();

    const offline = makeEnvironment({
      storageValues: Object.fromEntries(initial.storage.values),
    });
    offline.environment.navigator.onLine = false;
    const offlineManager = await createInitializedManager(offline.environment);
    await flush();

    expect(
      offline.fetches.some(({ url }) => String(url).includes("main.swf")),
    ).toBeFalse();
    expect(offlineManager.getSnapshot().gameError).toBeNull();
    expect(offlineManager.getSnapshot().downloadedGameIds).toEqual([
      "bike-mania",
    ]);
  });

  test("restores a missing cached file when a downloaded game is downloaded again", async () => {
    const initial = makeEnvironment();
    const manager = await createInitializedManager(initial.environment);
    await manager.downloadGame("bike-mania");
    const bikeUrl = "https://xp.example/swf/bike-mania.bike-1/main.swf";
    await initial.bundledCache.delete(bikeUrl);
    await manager.downloadGame("bike-mania");
    expect(initial.bundledCache.values.has(bikeUrl)).toBe(true);
  });

  test("tracks multiple downloaded games and removes them individually and all at once", async () => {
    const initial = makeEnvironment();
    const manager = await createInitializedManager(initial.environment);
    await manager.downloadGame("bike-mania");
    await manager.downloadGame("doom");
    expect(manager.getSnapshot().downloadedGameIds.length).toBe(2);
    expect(manager.getSnapshot().downloadedGameBytes).toBe(20);
    expect(initial.bundledCache.values.size).toBe(4);

    await manager.removeGame("bike-mania");
    expect(manager.getSnapshot().downloadedGameIds).toEqual(["doom"]);
    expect(manager.getSnapshot().downloadedGameBytes).toBe(6);
    expect(
      initial.bundledCache.values.has(
        "https://xp.example/js/runtime.wasm?rev=runtime-1",
      ),
    ).toBe(false);

    await manager.removeAllGames();
    expect(manager.getSnapshot().downloadedGameIds).toEqual([]);
    expect(initial.deletedCaches).toContain(BUNDLED_GAME_CACHE);
  });

  test("aborts an in-progress download and discards its files when offline access is disabled", async () => {
    const interrupted = makeEnvironment();
    const interruptedManager = await createInitializedManager(
      interrupted.environment,
    );
    const originalInterruptedPut = interrupted.bundledCache.put.bind(
      interrupted.bundledCache,
    );
    let releaseInterruptedPut;
    let markInterruptedPutStarted;
    const interruptedPutStarted = new Promise((resolve) => {
      markInterruptedPutStarted = resolve;
    });
    const interruptedPutRelease = new Promise((resolve) => {
      releaseInterruptedPut = resolve;
    });
    interrupted.bundledCache.put = async (...arguments_) => {
      markInterruptedPutStarted();
      await interruptedPutRelease;
      return originalInterruptedPut(...arguments_);
    };
    const interruptedDownload = interruptedManager.downloadGame("doom");
    await interruptedPutStarted;
    await interruptedManager.setOfflineEnabled(false);
    releaseInterruptedPut();
    await expect(interruptedDownload).rejects.toThrow(
      /Offline access was disabled/,
    );
    expect(interruptedManager.getSnapshot().phase).toBe("disabled");
    expect(interruptedManager.getSnapshot().gamePhase).toBe("idle");
    expect(interrupted.bundledCache.values.size).toBe(0);
    expect(
      JSON.parse(
        interrupted.storage.getItem("astroXpOfflineGameRecords") || "{}",
      ),
    ).toEqual({});
  });

  test("repairs system files by unregistering, clearing caches, and activating without reloading", async () => {
    const repaired = makeEnvironment({
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    const repairedManager = await createInitializedManager(
      repaired.environment,
    );
    repaired.setRemote({ version: "26.07.30-repair111" });
    repaired.registration.waiting = new Worker(
      "installed",
      "26.07.30-repair111",
    );
    await repairedManager.repair();
    repaired.serviceWorker.dispatch("controllerchange");
    // Repair does not reload the current session.
    expect(repaired.getReloads()).toBe(0);
    expect(repaired.registration.unregisterCalls).toBe(1);
    expect(repaired.deletedCaches).toContain("astro-xp-precache");
    expect(repaired.registration.waiting.messages).toEqual([
      { type: "SKIP_WAITING" },
    ]);
  });

  test("downloads games despite a low storage estimate and unavailable persistence", async () => {
    const lowEstimate = makeEnvironment();
    lowEstimate.environment.navigator.storage = {
      estimate: async () => ({ usage: 100, quota: 100 }),
      persist: async () => {
        throw new Error("persistence unavailable");
      },
    };
    const lowEstimateManager = await createInitializedManager(
      lowEstimate.environment,
    );
    await lowEstimateManager.downloadGame("bike-mania");
    expect(lowEstimateManager.getSnapshot().downloadedGameIds).toEqual([
      "bike-mania",
    ]);
  });

  test("rolls back a partial download and reports an error when the storage quota is exceeded", async () => {
    const quotaFailure = makeEnvironment();
    const originalPut = quotaFailure.bundledCache.put.bind(
      quotaFailure.bundledCache,
    );
    let putCount = 0;
    quotaFailure.bundledCache.put = async (key, response) => {
      putCount += 1;
      if (putCount === 2) {
        throw new DOMException("full", "QuotaExceededError");
      }
      return originalPut(key, response);
    };
    const quotaFailureManager = await createInitializedManager(
      quotaFailure.environment,
    );
    await expect(quotaFailureManager.downloadGame("doom")).rejects.toThrow(
      /Storage is full/,
    );
    expect(quotaFailure.bundledCache.values.size).toBe(0);
    expect(quotaFailureManager.getSnapshot().downloadedGameIds).toEqual([]);
    expect(quotaFailureManager.getSnapshot().gameError).toMatch(
      /Storage is full/,
    );
  });

  test("keeps the previous game revision when upgrading a downloaded game fails", async () => {
    const failedUpgrade = makeEnvironment({
      storageValues: {
        astroXpOfflineGameRecords: JSON.stringify({
          __runtime__: {
            bytes: 10,
            files: ["js/runtime.wasm?rev=runtime-old"],
            revision: "runtime-old",
            type: "runtime",
          },
          "bike-mania": {
            bytes: 4,
            files: ["swf/bike-mania.old/main.swf"],
            revision: "old",
            type: "swf",
          },
        }),
      },
    });
    const oldBikeUrl = "https://xp.example/swf/bike-mania.old/main.swf";
    await failedUpgrade.bundledCache.put(oldBikeUrl, new Response("old game"));
    const upgradePut = failedUpgrade.bundledCache.put.bind(
      failedUpgrade.bundledCache,
    );
    failedUpgrade.bundledCache.put = async (key, response) => {
      if (String(key).includes("bike-mania.bike-1")) {
        throw new DOMException("full", "QuotaExceededError");
      }
      return upgradePut(key, response);
    };
    const failedUpgradeManager = await createInitializedManager(
      failedUpgrade.environment,
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (failedUpgradeManager.getSnapshot().gamePhase === "error") break;
      await flush();
    }
    expect(failedUpgrade.bundledCache.values.has(oldBikeUrl)).toBe(true);
    expect(
      JSON.parse(failedUpgrade.storage.getItem("astroXpOfflineGameRecords"))[
        "bike-mania"
      ].revision,
    ).toBe("old");
  });

  test("keeps a shared runtime cached until the last game using it is removed", async () => {
    const sharedRuntime = makeEnvironment();
    const sharedRuntimeManager = await createInitializedManager(
      sharedRuntime.environment,
    );
    await sharedRuntimeManager.downloadGame("pink-panther-passport-to-peril");
    await sharedRuntimeManager.downloadGame("pink-panther-hokus-pokus");
    expect(sharedRuntime.bundledCache.values.size).toBe(3);
    await sharedRuntimeManager.removeGame("pink-panther-passport-to-peril");
    expect(
      sharedRuntime.bundledCache.values.has(
        "https://xp.example/vendor/scummvm/scummvm.wasm?rev=scummvm-1",
      ),
    ).toBe(true);
    await sharedRuntimeManager.removeGame("pink-panther-hokus-pokus");
    expect(sharedRuntime.bundledCache.values.size).toBe(0);
  });

  test("refreshes a stale downloaded runtime to the current revision", async () => {
    const staleRuntime = makeEnvironment({
      storageValues: {
        astroXpOfflineGameRecords: JSON.stringify({
          __runtime__: {
            bytes: 10,
            files: ["js/old-runtime.wasm"],
            revision: "runtime-old",
            type: "runtime",
          },
          "bike-mania": {
            bytes: 4,
            files: ["swf/bike-mania/main.swf"],
            revision: "bike-1",
            type: "swf",
          },
        }),
      },
    });
    await createInitializedManager(staleRuntime.environment);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const saved = JSON.parse(
        staleRuntime.storage.getItem("astroXpOfflineGameRecords"),
      );
      if (saved.__runtime__?.revision === manifest.runtime.revision) break;
      await flush();
    }
    expect(
      JSON.parse(staleRuntime.storage.getItem("astroXpOfflineGameRecords"))
        .__runtime__.revision,
    ).toBe(manifest.runtime.revision);
  });

  test("reports an available update and reloads after applying it", async () => {
    const updateRegistration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    const update = makeEnvironment({
      registration: updateRegistration,
      remoteVersion: "26.07.30-bbbbbbb",
    });
    const updateManager = await createInitializedManager(update.environment);
    await updateManager.checkForUpdates();
    expect(updateManager.getSnapshot().availableVersion).toBe(
      "26.07.30-bbbbbbb",
    );
    const waitingWorker = new Worker("installed", "26.07.30-bbbbbbb");
    updateRegistration.waiting = waitingWorker;
    updateRegistration.dispatch("updatefound");
    await flush();
    await updateManager.applyUpdate();
    expect(waitingWorker.messages).toEqual([{ type: "SKIP_WAITING" }]);
    update.serviceWorker.dispatch("controllerchange");
    expect(update.getReloads()).toBe(1);
  });

  test("refuses to activate a stale waiting worker and retries registration for the remote version", async () => {
    const staleWaitingRegistration = new Registration({
      active: new Worker("activated", manifest.version),
      waiting: new Worker("installed", "26.07.30-intermediate"),
    });
    const staleWaiting = makeEnvironment({
      registration: staleWaitingRegistration,
      remoteVersion: "26.07.30-bbbbbbb",
    });
    const staleWaitingManager = await createInitializedManager(
      staleWaiting.environment,
    );
    expect(staleWaitingManager.getSnapshot().updateReady).toBe(false);
    await expect(staleWaitingManager.applyUpdate()).rejects.toThrow(
      /isn't ready/,
    );
    expect(staleWaitingRegistration.waiting.messages).toEqual([]);
    staleWaitingRegistration.waiting = new Worker(
      "installed",
      "26.07.30-bbbbbbb",
    );
    const retry = staleWaiting.timers.find(({ delay }) => delay === 30_000);
    expect(retry).toBeTruthy();
    retry.callback();
    await flushUntil(
      () => staleWaitingRegistration.waiting.messages.length > 0,
    );
    expect(staleWaiting.serviceWorker.registerCalls.at(-1)[0]).toMatch(
      /^\/sw\.26\.07\.30-bbbbbbb\.js\?retry=1800000000000$/,
    );
    expect(staleWaitingManager.getSnapshot().updateReady).toBe(true);
    expect(staleWaitingRegistration.waiting.messages).toEqual([
      { type: "SKIP_WAITING" },
    ]);
  });

  test("delays automatic activation until a release is stable and never reloads the open session", async () => {
    const firstReleaseTime = now - 3 * 60 * 60 * 1000;
    const delayedRegistration = new Registration({
      active: new Worker("activated", manifest.version),
      waiting: new Worker("installed", "26.07.30-first111"),
    });
    const delayed = makeEnvironment({
      registration: delayedRegistration,
      remoteVersion: "26.07.30-first111",
      remoteReleasedAt: new Date(firstReleaseTime).toISOString(),
    });
    const delayedManager = await createInitializedManager(delayed.environment);
    expect(delayedManager.getSnapshot().phase).toBe("update-pending");
    expect(delayedRegistration.waiting.messages).toEqual([]);

    const secondReleaseTime = now;
    delayed.setRemote({
      version: "26.07.30-second22",
      releasedAt: new Date(secondReleaseTime).toISOString(),
    });
    delayed.setNow(secondReleaseTime + sixHours);
    delayedRegistration.waiting = new Worker("installed", "26.07.30-second22");
    const dueTimer = delayed.timers.find(
      ({ delay }) => delay === 3 * 60 * 60 * 1000,
    );
    expect(dueTimer).toBeTruthy();
    dueTimer.callback();
    for (
      let attempt = 0;
      attempt < 20 && !delayedRegistration.waiting.messages.length;
      attempt++
    ) {
      await flush();
    }
    expect(delayedRegistration.waiting.messages).toEqual([
      { type: "SKIP_WAITING" },
    ]);
    delayed.serviceWorker.dispatch("controllerchange");
    // Automatic activation keeps the current session open.
    expect(delayed.getReloads()).toBe(0);
    delayedRegistration.waiting.messages.length = 0;
    await createInitializedManager(delayed.environment);
    expect(delayedRegistration.waiting.messages).toEqual([
      { type: "SKIP_WAITING" },
    ]);
    delayed.serviceWorker.dispatch("controllerchange");
    expect(delayed.getReloads()).toBe(0);
  });

  test("honors a configured automatic update delay while still allowing an immediate update", async () => {
    const configurableReleaseTime = now - 7 * 60 * 60 * 1000;
    const configurableRegistration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    const configurable = makeEnvironment({
      registration: configurableRegistration,
      remoteVersion: "26.07.30-config123",
      remoteReleasedAt: new Date(configurableReleaseTime).toISOString(),
      storageValues: {
        astroXpAutomaticUpdateDelay: String(12 * 60 * 60 * 1000),
      },
    });
    const configurableManager = await createInitializedManager(
      configurable.environment,
    );
    expect(configurableManager.getSnapshot().automaticUpdateDelayMs).toBe(
      12 * 60 * 60 * 1000,
    );
    expect(configurableManager.getSnapshot().phase).toBe("update-pending");
    expect(configurable.serviceWorker.registerCalls.length).toBe(0);
    await configurableManager.checkForUpdates();
    expect(configurable.serviceWorker.registerCalls.length).toBe(0);

    const scheduledUpdate = configurable.timers.find(
      ({ delay }) => delay === 5 * 60 * 60 * 1000,
    );
    expect(scheduledUpdate).toBeTruthy();
    configurable.setNow(now + 5 * 60 * 60 * 1000);
    configurableRegistration.waiting = new Worker(
      "installed",
      "26.07.30-config123",
    );
    scheduledUpdate.callback();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (configurableRegistration.waiting.messages.length > 0) break;
      await flush();
    }
    expect(configurable.serviceWorker.registerCalls.at(-1)[0]).toBe(
      "/sw.26.07.30-config123.js",
    );
    expect(configurableRegistration.waiting.messages).toEqual([
      { type: "SKIP_WAITING" },
    ]);

    const configurableWaitingWorker = new Worker(
      "installed",
      "26.07.30-config123",
    );
    configurableRegistration.waiting = configurableWaitingWorker;
    await configurableManager.updateNow();
    expect(configurable.serviceWorker.registerCalls.at(-1)[0]).toBe(
      "/sw.26.07.30-config123.js",
    );
    expect(configurableWaitingWorker.messages).toEqual([
      { type: "SKIP_WAITING" },
    ]);
  });

  test("persists the automatic update delay and clears it when reset", async () => {
    const configurable = makeEnvironment({
      storageValues: {
        astroXpAutomaticUpdateDelay: String(12 * 60 * 60 * 1000),
      },
    });
    const configurableManager = await createInitializedManager(
      configurable.environment,
    );
    configurableManager.setAutomaticUpdateDelay(0);
    expect(configurable.storage.getItem("astroXpAutomaticUpdateDelay")).toBe(
      "0",
    );
    configurableManager.setAutomaticUpdateDelay(null);
    expect(configurable.storage.getItem("astroXpAutomaticUpdateDelay")).toBe(
      null,
    );
  });

  test("marks an already-active newer worker as ready and reloads on updateNow", async () => {
    const activatedUpdate = makeEnvironment({
      registration: new Registration({
        active: new Worker("activated", "26.07.30-bbbbbbb"),
      }),
      remoteVersion: "26.07.30-bbbbbbb",
    });
    const activatedManager = await createInitializedManager(
      activatedUpdate.environment,
    );
    await activatedManager.checkForUpdates();
    expect(activatedUpdate.getReloads()).toBe(0);
    expect(activatedManager.getSnapshot().updateReady).toBe(true);
    await activatedManager.updateNow();
    expect(activatedUpdate.getReloads()).toBe(1);
  });

  test("requires a repair instead of reloading again when a previous active-version reload did not take effect", async () => {
    const inconsistentUpdate = makeEnvironment({
      registration: new Registration({
        active: new Worker("activated", "26.07.30-bbbbbbb"),
      }),
      remoteVersion: "26.07.30-bbbbbbb",
      sessionValues: {
        astroXpActiveVersionReload: "26.07.30-bbbbbbb",
      },
    });
    const inconsistentManager = await createInitializedManager(
      inconsistentUpdate.environment,
    );
    await inconsistentManager.checkForUpdates();
    expect(inconsistentUpdate.getReloads()).toBe(0);
    await inconsistentManager.updateNow();
    expect(inconsistentManager.getSnapshot().phase).toBe("repair-required");
    expect(inconsistentManager.getSnapshot().error).toMatch(/Select Repair/);
  });

  test("retries a failed update three times before suggesting repair", async () => {
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
      installing: new Worker("installing"),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-bbbbbbb",
    });
    const manager = await createInitializedManager(h.environment);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      registration.installing.transition("redundant");
      expect(manager.getSnapshot()).toMatchObject({
        phase: "updating",
        workerState: "failed",
        error: null,
      });
      const retry = h.timers.findLast(({ delay }) => delay === 2000 * attempt);
      registration.installing = new Worker("installing");
      const checks = countVersionFetches(h);
      retry.callback();
      await flushUntil(() => countVersionFetches(h) > checks);
      await flushUntil(() => manager.getSnapshot().phase === "updating");
      expect(countVersionFetches(h)).toBe(checks + 1);
    }
    registration.installing.transition("redundant");
    expect(manager.getSnapshot().phase).toBe("error");
    expect(manager.getSnapshot().error).toMatch(/Select Repair/);
  });

  test("retries when the new worker is already gone", async () => {
    const h = makeEnvironment({ remoteVersion: "26.07.30-bbbbbbb" });
    const register = h.serviceWorker.register;
    h.serviceWorker.register = async () => {
      throw new TypeError("A bad HTTP response code (404) was received");
    };
    const manager = createManager({
      currentVersion: manifest.version,
      environment: h.environment,
    });
    await manager.updateNow().catch(() => {});
    expect(manager.getSnapshot()).toMatchObject({
      phase: "updating",
      error: null,
    });
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      h.timers
        .findLast(({ delay }) => delay === 2000 * (attempt - 1))
        .callback();
      await flushUntil(() =>
        h.timers.some(({ delay }) => delay === 2000 * attempt),
      );
    }
    h.timers.findLast(({ delay }) => delay === 6000).callback();
    await flushUntil(() => manager.getSnapshot().phase === "error");
    expect(manager.getSnapshot().error).toMatch(/bad HTTP response code/);

    h.serviceWorker.register = register;
    await manager.updateNow();
    expect(h.serviceWorker.registerCalls).toHaveLength(1);
  });

  test("a finished install resets the retries, and turning offline off cancels one", async () => {
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
      installing: new Worker("installing"),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-bbbbbbb",
    });
    const manager = await createInitializedManager(h.environment);
    const retryWith = async (delay, nextWorker) => {
      registration.installing = nextWorker;
      h.timers.findLast((timer) => timer.delay === delay).callback();
      await flushUntil(() => manager.getSnapshot().phase === "updating");
    };
    registration.installing.transition("redundant");
    const installed = new Worker("installing");
    await retryWith(2000, installed);
    installed.transition("installed");
    // A replaced worker isn't a failure.
    installed.transition("redundant");
    expect(manager.getSnapshot().workerState).toBe("installed");
    expect(h.timers.filter(({ delay }) => delay === 2000)).toHaveLength(1);

    const failing = new Worker("installing");
    registration.installing = failing;
    registration.dispatch("updatefound");
    failing.transition("redundant");
    expect(h.timers.filter(({ delay }) => delay === 2000)).toHaveLength(2);

    // A retry whose check fails waits for the next one.
    const offline = new Worker("installing");
    await retryWith(2000, offline);
    offline.transition("redundant");
    h.environment.navigator.onLine = false;
    h.timers.findLast(({ delay }) => delay === 4000).callback();
    await flush();
    h.environment.navigator.onLine = true;

    await manager.setOfflineEnabled(false);
    const checks = countVersionFetches(h);
    h.timers.findLast(({ delay }) => delay === 2000).callback();
    await flush();
    expect(countVersionFetches(h)).toBe(checks);
  });
});

describe("offline failure and lifecycle boundaries", () => {
  test("workers already finished or missing resolve; redundant workers reject and detach listeners", async () => {
    await waitForWorker(null);
    await waitForWorker(new Worker());
    await expect(waitForWorker(new Worker("redundant"))).rejects.toThrow(
      "download stopped",
    );
    const worker = new Worker("installing"),
      waiting = waitForWorker(worker);
    worker.transition("redundant");
    await expect(waiting).rejects.toThrow("download stopped");
    expect(worker.listeners.get("statechange").size).toBe(0);
  });
  for (const [label, change] of [
    ["null", () => null],
    ["runtime array", (m) => ({ ...m, runtimes: [] })],
    ["null runtimes", (m) => ({ ...m, runtimes: null })],
    [
      "invalid runtime name",
      (m) => ({ ...m, runtimes: { "../bad": m.runtime } }),
    ],
    ["invalid runtime entry", (m) => ({ ...m, runtimes: { bad: {} } })],
    ["invalid game id", (m) => ({ ...m, games: { "Bad!": m.games.doom } })],
    [
      "invalid game type",
      (m) => ({ ...m, games: { doom: { ...m.games.doom, type: "exe" } } }),
    ],
    [
      "unversioned root",
      (m) => ({
        ...m,
        games: { doom: { ...m.games.doom, root: "iframe/doom/" } },
      }),
    ],
    [
      "missing runtime",
      (m) => ({
        ...m,
        games: { doom: { ...m.games.doom, runtime: "absent" } },
      }),
    ],
    ["negative bytes", (m) => ({ ...m, runtime: { ...m.runtime, bytes: -1 } })],
    [
      "missing integrity",
      (m) => ({
        ...m,
        runtime: { ...m.runtime, files: [{ url: "runtime.wasm", bytes: 1 }] },
      }),
    ],
  ])
    test(`rejects ${label} manifests before downloading files`, () => {
      expect(() =>
        validateGameManifest(change(structuredClone(manifest))),
      ).toThrow("game list didn't load");
    });
  test("invalid stored records are ignored and subscriptions receive isolated snapshots", async () => {
    for (const records of ["broken-json", "[]", "null"]) {
      const h = makeEnvironment({
        storageValues: { astroXpOfflineGameRecords: records },
      });
      const manager = await createInitializedManager(h.environment),
        snapshots = [];
      const unsubscribe = manager.subscribe((value) => snapshots.push(value));
      expect(snapshots[0].downloadedGameIds).toEqual([]);
      snapshots[0].bundledGames[0].id = "changed";
      snapshots[0].downloadedGameIds.push("changed");
      expect(manager.getSnapshot().bundledGames[0].id).toBe("bike-mania");
      expect(manager.getSnapshot().downloadedGameIds).toEqual([]);
      manager.setSavePlayedGamesOffline(false);
      expect(snapshots.length).toBe(2);
      unsubscribe();
      manager.setSavePlayedGamesOffline(true);
      expect(snapshots.length).toBe(2);
    }
  });
  test("rejects malformed preferences and unavailable offline actions without changing storage", async () => {
    const h = makeEnvironment(),
      manager = await createInitializedManager(h.environment);
    await expect(manager.setOfflineEnabled("false")).rejects.toThrow(
      "setting is invalid",
    );
    expect(() => manager.setSavePlayedGamesOffline(0)).toThrow(
      "setting is invalid",
    );
    expect(() => manager.setAutomaticUpdatesEnabled(null)).toThrow(
      "setting is invalid",
    );
    for (const delay of [-1, 1.5, NaN, "0"])
      expect(() => manager.setAutomaticUpdateDelay(delay)).toThrow(
        "delay is invalid",
      );
    h.environment.navigator.onLine = false;
    await expect(manager.repair()).rejects.toThrow("You're offline");
    await expect(manager.checkForUpdates()).rejects.toThrow("You're offline");
    await manager.setOfflineEnabled(false);
    await expect(manager.repair()).rejects.toThrow("Turn on offline use");
    await expect(manager.checkForUpdates()).rejects.toThrow(
      "Turn on offline use",
    );
    await expect(manager.downloadAllGames()).rejects.toThrow(
      "Enable offline access",
    );
  });
  test("downloads all built-in games once and retains shared runtimes", async () => {
    const h = makeEnvironment(),
      manager = await createInitializedManager(h.environment);
    await manager.downloadAllGames();
    expect(manager.getSnapshot().downloadedGameIds.sort()).toEqual(
      Object.keys(manifest.games).sort(),
    );
    const downloaded = h.fetches.length;
    await manager.downloadAllGames();
    expect(h.fetches.length).toBe(downloaded);
    await manager.removeAllGames();
    expect(manager.getSnapshot().downloadedGameIds).toEqual([]);
    expect(h.bundledCache.values.size).toBe(0);
  });
  for (const [label, response, error] of [
    [
      "HTTP failure",
      () => new Response("offline", { status: 503 }),
      "Update check failed (503)",
    ],
    [
      "invalid metadata",
      () => Response.json({ version: "bad" }),
      "sent bad data",
    ],
  ])
    test(`reports ${label} during update checks`, async () => {
      const h = makeEnvironment(),
        manager = await createInitializedManager(h.environment);
      h.environment.fetch = async () => response();
      await expect(manager.checkForUpdates()).rejects.toThrow(error);
      expect(manager.getSnapshot().error).toContain(error);
    });
  for (const [label, response, error] of [
    [
      "HTTP failure",
      () => new Response("offline", { status: 503 }),
      "catalog failed (503)",
    ],
    [
      "wrong version",
      () => Response.json({ ...manifest, version: "different" }),
      "game list didn't load",
    ],
  ])
    test(`reports catalog ${label} during initialization`, async () => {
      const h = makeEnvironment(),
        fetch = h.environment.fetch;
      h.environment.fetch = async (url, options) =>
        url === "offline-games.json" ? response() : fetch(url, options);
      const manager = await createInitializedManager(h.environment);
      expect(manager.getSnapshot().phase).toBe("error");
      expect(manager.getSnapshot().error).toContain(error);
    });
  test("rolls back runtime downloads when an asset server fails", async () => {
    const h = makeEnvironment(),
      manager = await createInitializedManager(h.environment),
      fetch = h.environment.fetch;
    h.environment.fetch = async (url, options) =>
      String(url).endsWith("main.swf")
        ? new Response("offline", { status: 502 })
        : fetch(url, options);
    await expect(manager.downloadGame("bike-mania")).rejects.toThrow(
      "Offline download failed (502)",
    );
    expect(manager.getSnapshot().downloadedGameIds).toEqual([]);
    expect(manager.getSnapshot().gamePhase).toBe("error");
  });
  test("persists disabled state even when service-worker removal fails", async () => {
    const h = makeEnvironment(),
      manager = await createInitializedManager(h.environment);
    h.registration.unregister = async () => {
      throw new Error("worker removal failed");
    };
    await expect(manager.setOfflineEnabled(false)).rejects.toThrow(
      "worker removal failed",
    );
    expect(manager.getSnapshot().enabled).toBeFalse();
    expect(manager.getSnapshot().phase).toBe("disabled");
    expect(manager.getSnapshot().error).toBe("worker removal failed");
  });
  test("tracks online and offline transitions and resumes automatic checks", async () => {
    const h = makeEnvironment(),
      manager = await createInitializedManager(h.environment);
    h.environment.navigator.onLine = false;
    h.environment.dispatch("offline");
    expect(manager.getSnapshot().online).toBeFalse();
    h.environment.navigator.onLine = true;
    h.environment.dispatch("online");
    expect(manager.getSnapshot().online).toBeTrue();
    manager.setAutomaticUpdatesEnabled(false);
    const before = h.fetches.length;
    manager.setAutomaticUpdatesEnabled(true);
    await flushUntil(() => h.fetches.length > before);
    expect(h.fetches.length).toBeGreaterThan(before);
  });
  for (const workerUrl of ["/sw.js", "/sw.js?channel=test"])
    test(`supports custom worker URL ${workerUrl}`, async () => {
      const h = makeEnvironment(),
        manager = createManager({
          currentVersion: manifest.version,
          environment: h.environment,
          serviceWorkerUrl: workerUrl,
        });
      await manager.initialize();
      expect(h.serviceWorker.registerCalls[0][0]).toBe(
        `${workerUrl}${workerUrl.includes("?") ? "&" : "?"}v=${manifest.version}`,
      );
    });
  test("waits for a first installation and reports activation failures", async () => {
    for (const finalState of ["activated", "redundant"]) {
      const worker = new Worker("installing", manifest.version),
        registration = new Registration({ installing: worker });
      const h = makeEnvironment({ registration });
      h.serviceWorker.getRegistration = async () => null;
      const manager = createManager({
        currentVersion: manifest.version,
        environment: h.environment,
      });
      const ready = manager.initialize();
      await flushUntil(() => worker.listeners.get("statechange")?.size === 2);
      registration.installing = null;
      if (finalState === "activated") registration.active = worker;
      worker.transition(finalState);
      await ready;
      expect(manager.getSnapshot().phase).toBe(
        finalState === "activated" ? "ready" : "error",
      );
      if (finalState === "activated")
        expect(manager.getSnapshot().usage).toBe(100);
      else expect(manager.getSnapshot().error).toContain("download stopped");
    }
  });
});

describe("offline manager edge cases", () => {
  const withoutSharedRuntimes = () => {
    const catalog = structuredClone(manifest);
    delete catalog.runtimes;
    catalog.games = {
      "bike-mania": catalog.games["bike-mania"],
      doom: catalog.games.doom,
    };
    return catalog;
  };
  const uninitializedManager = (environment, options = {}) =>
    createManager({
      currentVersion: manifest.version,
      environment,
      ...options,
    });
  const versionFetch = (h, respond) => {
    const fetch = h.environment.fetch;
    h.environment.fetch = async (url, options) =>
      String(url).startsWith("/version.json")
        ? respond(url, options, fetch)
        : fetch(url, options);
  };

  test("waits through intermediate worker states before activating", async () => {
    const worker = new Worker("installing");
    const activation = waitForWorker(worker);
    worker.transition("installed");
    worker.transition("activating");
    worker.transition("activated");
    await activation;
    expect(worker.listeners.get("statechange").size).toBe(0);
  });

  test("accepts catalogs without shared runtimes", async () => {
    const catalog = withoutSharedRuntimes();
    expect(validateGameManifest(catalog)).toBe(catalog);
    const h = makeEnvironment(),
      fetch = h.environment.fetch;
    h.environment.fetch = async (url, options) =>
      url === "offline-games.json"
        ? Response.json(catalog)
        : fetch(url, options);
    const manager = await createInitializedManager(h.environment);
    expect(manager.getSnapshot().bundledGameBytes).toBe(20);
  });

  test("uses the global environment when none is provided", () => {
    globalThis.localStorage = new MemoryStorage({
      astroXpOfflineEnabled: "false",
    });
    try {
      const manager = createManager({ currentVersion: manifest.version });
      expect(manager.getSnapshot()).toMatchObject({
        enabled: false,
        phase: "disabled",
      });
    } finally {
      delete globalThis.localStorage;
    }
  });

  test("restores cached download metadata and ignores malformed stored numbers", () => {
    const cached = makeEnvironment({
      storageValues: {
        astroXpDownloadVersion: manifest.version,
        astroXpDownloadBytes: "1234",
        astroXpLastUpdateCheck: "",
        astroXpOfflineGameRecords: JSON.stringify({
          doom: { bytes: "many", files: [], revision: "doom-1" },
        }),
      },
    });
    expect(
      uninitializedManager(cached.environment).getSnapshot(),
    ).toMatchObject({
      downloadBytes: 1234,
      downloadedGameBytes: 0,
      lastChecked: null,
    });
    const malformed = makeEnvironment({
      storageValues: {
        astroXpDownloadVersion: manifest.version,
        astroXpDownloadBytes: "junk",
      },
    });
    expect(
      uninitializedManager(malformed.environment).getSnapshot().downloadBytes,
    ).toBeNull();
  });

  test("synchronizes stored games with the catalog on startup", async () => {
    const h = makeEnvironment({
      storageValues: {
        astroXpOfflineGameRecords: JSON.stringify({
          "bike-mania": {
            bytes: "many",
            files: ["swf/bike-mania.old/main.swf"],
            revision: "old",
            type: "swf",
          },
          "retired-game": { bytes: "many", revision: "r1", type: "iframe" },
          doom: {
            bytes: 6,
            files: manifest.games.doom.files.map(({ url }) => url),
            revision: "doom-1",
            type: "iframe",
          },
          "pink-panther-hokus-pokus": {
            bytes: 2,
            files: manifest.games["pink-panther-hokus-pokus"].files.map(
              ({ url }) => url,
            ),
            revision: "pokus-1",
            runtime: "scummvm",
            type: "iframe",
          },
          "__runtime__:scummvm": { bytes: 8, files: [], revision: "stale" },
        }),
      },
    });
    const staleUrl = "https://xp.example/swf/bike-mania.old/main.swf";
    await h.bundledCache.put(staleUrl, new Response("old"));
    for (const { url } of manifest.games.doom.files) {
      await h.bundledCache.put(
        new URL(url, "https://xp.example/").href,
        new Response("cached"),
      );
    }
    const manager = await createInitializedManager(h.environment);
    const records = () =>
      JSON.parse(h.storage.getItem("astroXpOfflineGameRecords"));
    await flushUntil(
      () =>
        records()["__runtime__:scummvm"]?.revision === "scummvm-1" &&
        records()["bike-mania"]?.revision === "bike-1",
    );
    expect(Object.keys(records()).sort()).toEqual([
      "__runtime__",
      "__runtime__:scummvm",
      "bike-mania",
      "doom",
      "pink-panther-hokus-pokus",
    ]);
    expect(h.bundledCache.values.has(staleUrl)).toBeFalse();
    expect(manager.getSnapshot().downloadedGameIds.sort()).toEqual([
      "bike-mania",
      "doom",
      "pink-panther-hokus-pokus",
    ]);
    expect(h.fetches.some(({ url }) => url.includes("doom"))).toBeFalse();
  });

  test("skips storage estimates when the browser has no storage manager", async () => {
    const h = makeEnvironment();
    delete h.environment.navigator.storage;
    const manager = uninitializedManager(h.environment);
    expect((await manager.refreshStorageEstimate()).usage).toBeNull();
  });

  test("treats unreadable worker versions as unknown", async () => {
    class DetachedWorker extends Worker {
      postMessage(message, ports) {
        if (message.type === "GET_VERSION") throw new Error("detached");
        super.postMessage(message, ports);
      }
    }
    for (const active of [
      new DetachedWorker("activated", manifest.version),
      new Worker("activated", 42),
    ]) {
      const h = makeEnvironment({
        registration: new Registration({ active }),
      });
      const manager = await createInitializedManager(h.environment);
      expect(manager.getSnapshot().phase).toBe("ready");
      h.timers
        .filter(({ delay }) => delay === 250)
        .forEach(({ callback }) => callback());
      expect(manager.getSnapshot().availableVersion).toBeNull();
    }
  });

  test("falls back to global timers, message channels, and session storage", async () => {
    const worker = new Worker("installing", "26.07.30-bbbbbbb");
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-bbbbbbb",
      remoteReleasedAt: new Date(now).toISOString(),
    });
    for (const key of [
      "sessionStorage",
      "setTimeout",
      "clearTimeout",
      "MessageChannel",
      "document",
    ])
      delete h.environment[key];
    const manager = await createInitializedManager(h.environment);
    expect(manager.getSnapshot().phase).toBe("update-pending");
    await manager.checkForUpdates();
    registration.waiting = new Worker("installed", "26.07.29-intermediate");
    await expect(manager.applyUpdate()).rejects.toThrow("isn't ready");
    registration.waiting = null;
    registration.installing = worker;
    registration.dispatch("updatefound");
    worker.transition("installed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    manager.setAutomaticUpdatesEnabled(false);
    await manager.downloadGame("doom");
    expect([...h.bundledCache.values.keys()]).toContain(
      "https://xp.example/iframe/doom.doom-1/index.html",
    );
    await manager.setOfflineEnabled(false);
  });

  test("resolves game files against the location when no document base exists", async () => {
    for (const [location, prefix] of [
      [{ origin: "https://origin.example" }, "https://origin.example/"],
      [undefined, "https://astro.local/"],
    ]) {
      const h = makeEnvironment();
      delete h.environment.document;
      h.environment.location = location;
      const manager = uninitializedManager(h.environment);
      await manager.downloadGame("doom");
      expect([...h.bundledCache.values.keys()][0].startsWith(prefix)).toBe(
        true,
      );
    }
  });

  test("does not schedule update retries when automatic updates are disabled", async () => {
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-bbbbbbb",
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    const manager = await createInitializedManager(h.environment);
    await manager.checkForUpdates();
    registration.waiting = new Worker("installed", "26.07.29-intermediate");
    await expect(manager.applyUpdate()).rejects.toThrow("isn't ready");
    expect(h.timers.some(({ delay }) => delay === 30_000)).toBeFalse();
  });

  test("reports pending updates as available when automatic updates are disabled", async () => {
    const h = makeEnvironment({
      remoteVersion: "26.07.30-bbbbbbb",
      remoteReleasedAt: new Date(now).toISOString(),
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    const manager = await createInitializedManager(h.environment);
    const snapshot = await manager.checkForUpdates();
    expect(snapshot.phase).toBe("update-available");
    expect(h.timers.some(({ delay }) => delay === sixHours)).toBeFalse();
  });

  test("reschedules automatic updates that fire early or fail", async () => {
    const h = makeEnvironment({
      remoteVersion: "26.07.30-bbbbbbb",
      remoteReleasedAt: new Date(now).toISOString(),
    });
    const manager = await createInitializedManager(h.environment);
    const scheduled = () => h.timers.filter(({ delay }) => delay === sixHours);
    expect(scheduled().length).toBe(1);
    scheduled()[0].callback();
    expect(scheduled().length).toBe(2);

    h.setNow(now + sixHours);
    versionFetch(h, () => new Response("down", { status: 503 }));
    scheduled()[1].callback();
    await flushUntil(() => h.timers.some(({ delay }) => delay === 30_000));
    const retry = h.timers.find(({ delay }) => delay === 30_000);
    expect(retry).toBeTruthy();

    h.environment.navigator.onLine = false;
    h.setNow(now + sixHours + 30_000);
    const timerCount = h.timers.length;
    retry.callback();
    await flush();
    await flush();
    expect(h.timers.length).toBe(timerCount);
    expect(manager.getSnapshot().error).toContain("You're offline");
  });

  test("cancels scheduled automatic updates and retries when automatic updates are turned off", async () => {
    const cleared = [];
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-bbbbbbb",
      remoteReleasedAt: new Date(now).toISOString(),
    });
    h.environment.clearTimeout = (id) => cleared.push(id);
    const manager = await createInitializedManager(h.environment);
    registration.waiting = new Worker("installed", "26.07.29-intermediate");
    await expect(manager.applyUpdate()).rejects.toThrow("isn't ready");
    manager.setAutomaticUpdatesEnabled(false);
    expect(cleared.length).toBe(2);
    manager.setAutomaticUpdatesEnabled(false);
    expect(cleared.length).toBe(2);
  });

  test("rejects a migrated worker whose version does not match the running site", async () => {
    const registration = new Registration({
      active: new Worker(
        "activated",
        manifest.version,
        `/sw.js?v=${manifest.version}`,
      ),
    });
    const h = makeEnvironment({
      registration,
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    h.serviceWorker.register = async (...args) => {
      h.serviceWorker.registerCalls.push(args);
      registration.waiting = new Worker("installed", "26.07.30-other");
      return registration;
    };
    const manager = await createInitializedManager(h.environment);
    expect(manager.getSnapshot().phase).toBe("error");
    expect(manager.getSnapshot().error).toContain("download doesn't match");
  });

  test("tracks an installing worker during a manual worker migration", async () => {
    const installing = new Worker("installing", manifest.version);
    const registration = new Registration({
      active: new Worker(
        "activated",
        manifest.version,
        `/sw.js?v=${manifest.version}`,
      ),
    });
    const h = makeEnvironment({
      registration,
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    h.serviceWorker.register = async (...args) => {
      h.serviceWorker.registerCalls.push(args);
      registration.installing = installing;
      return registration;
    };
    const manager = await createInitializedManager(h.environment);
    expect(manager.getSnapshot()).toMatchObject({
      phase: "updating",
      workerState: "active",
    });
    expect(installing.listeners.get("statechange").size).toBe(1);
  });

  test("registers the current worker on first visit when automatic updates are disabled", async () => {
    const waiting = new Worker("installed", "26.07.30-other");
    const h = makeEnvironment({
      registration: new Registration({
        active: new Worker("activated", manifest.version),
        waiting,
      }),
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    h.serviceWorker.getRegistration = async () => null;
    const manager = await createInitializedManager(h.environment);
    expect(h.serviceWorker.registerCalls[0][0]).toBe(
      `/sw.${manifest.version}.js`,
    );
    expect(manager.getSnapshot().workerState).toBe("waiting");
    expect(waiting.messages).toEqual([]);
  });

  test("keeps an existing worker ready when its waiting update cannot be verified", async () => {
    const h = makeEnvironment({
      registration: new Registration({
        active: new Worker("activated", manifest.version),
        waiting: new Worker("installed", "26.07.30-bbbbbbb"),
      }),
    });
    versionFetch(h, () => new Response("down", { status: 503 }));
    const manager = await createInitializedManager(h.environment);
    expect(manager.getSnapshot()).toMatchObject({
      phase: "ready",
      workerState: "active",
    });
    expect(h.timers.some(({ delay }) => delay === 30_000)).toBeTrue();
  });

  test("explains when neither an active nor a waiting update can be applied", async () => {
    const registration = new Registration({
      active: new Worker("activated", "26.07.30-bbbbbbb"),
    });
    const h = makeEnvironment({
      registration,
      sessionValues: { astroXpActiveVersionReload: manifest.version },
    });
    const manager = await createInitializedManager(h.environment);
    const snapshot = await manager.checkForUpdates();
    expect(snapshot).toMatchObject({
      phase: "update-available",
      availableVersion: manifest.version,
    });
    await expect(manager.applyUpdate()).rejects.toThrow(
      "There's no update to install.",
    );
    expect(h.sessionStorage.getItem("astroXpActiveVersionReload")).toBe(null);
    registration.installing = new Worker("installing");
    registration.active = null;
    await expect(manager.applyUpdate()).rejects.toThrow(
      "The update is still downloading.",
    );
  });

  test("ignores worker lifecycle events after offline access is disabled", async () => {
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    const h = makeEnvironment({ registration });
    const manager = await createInitializedManager(h.environment);
    const worker = new Worker("installing", "26.07.30-bbbbbbb");
    registration.installing = worker;
    registration.dispatch("updatefound");
    worker.transition("activating");
    expect(manager.getSnapshot().workerState).toBe("activating");
    await manager.setOfflineEnabled(false);
    worker.transition("installed");
    registration.installing = new Worker("installing");
    registration.dispatch("updatefound");
    expect(manager.getSnapshot()).toMatchObject({
      phase: "disabled",
      workerState: "unregistered",
    });
    expect(h.timers.some(({ delay }) => delay === 0)).toBeFalse();
  });

  test("checks a newly installed update only while a waiting worker remains", async () => {
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-bbbbbbb",
    });
    const manager = await createInitializedManager(h.environment);
    for (const waiting of [null, new Worker("installed", "26.07.30-bbbbbbb")]) {
      const worker = new Worker("installing", "26.07.30-bbbbbbb");
      registration.installing = worker;
      registration.dispatch("updatefound");
      worker.transition("installed");
      registration.installing = null;
      registration.waiting = waiting;
      h.timers
        .filter(({ delay }) => delay === 0)
        .forEach(({ callback }) => callback());
      h.timers.length = 0;
    }
    await flushUntil(() => manager.getSnapshot().updateReady);
    expect(manager.getSnapshot().phase).toBe("update-ready");
  });

  test("treats a controlled page without an active worker as an update", async () => {
    const registration = new Registration();
    const h = makeEnvironment({ registration });
    const manager = await createInitializedManager(h.environment);
    registration.active = null;
    h.serviceWorker.controller = new Worker("activated", manifest.version);
    registration.installing = new Worker("installing");
    registration.dispatch("updatefound");
    expect(manager.getSnapshot().phase).toBe("updating");
  });

  test("completes a first installation from a waiting worker", async () => {
    const worker = new Worker("installed", manifest.version);
    const registration = new Registration({ waiting: worker });
    const h = makeEnvironment({ registration });
    h.serviceWorker.getRegistration = async () => null;
    const manager = uninitializedManager(h.environment);
    const ready = manager.initialize();
    await flushUntil(() => worker.listeners.get("statechange")?.size === 1);
    registration.waiting = null;
    registration.active = worker;
    worker.transition("activated");
    await ready;
    expect(manager.getSnapshot().phase).toBe("ready");
  });

  test("reports an inconsistent first installation when no worker becomes active", async () => {
    const h = makeEnvironment({ registration: new Registration() });
    h.serviceWorker.getRegistration = async () => null;
    const manager = await createInitializedManager(h.environment);
    expect(manager.getSnapshot()).toMatchObject({
      phase: "error",
      error: "The download doesn't match. Try again.",
    });
    expect(h.timers.some(({ delay }) => delay === 30_000)).toBeTrue();
  });

  test("reports unsupported browsers and still downloads games on demand", async () => {
    const h = makeEnvironment();
    delete h.environment.navigator.serviceWorker;
    const manager = await createInitializedManager(h.environment);
    expect(manager.getSnapshot()).toMatchObject({
      phase: "error",
      error: "This browser can't work offline.",
    });
    await manager.downloadGame("doom");
    expect(manager.getSnapshot().downloadedGameIds).toEqual(["doom"]);
    await expect(manager.downloadGame("missing")).rejects.toThrow(
      "This game isn't available.",
    );
  });

  test("appends cache busters to version URLs with query strings", async () => {
    const h = makeEnvironment();
    await uninitializedManager(h.environment, {
      versionUrl: "/version.json?channel=beta",
    }).initialize();
    expect(
      h.fetches.some(({ url }) =>
        /^\/version\.json\?channel=beta&t=\d+$/.test(url),
      ),
    ).toBeTrue();
  });

  test("bypasses the worker CDN on retries for query-string worker URLs", async () => {
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
      waiting: new Worker("installed", "26.07.29-intermediate"),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-bbbbbbb",
    });
    const manager = uninitializedManager(h.environment, {
      serviceWorkerUrl: "/sw.js",
    });
    await manager.initialize();
    await manager
      .checkForUpdates({ applyAutomatically: true, bypassDelay: true })
      .catch(() => {});
    expect(h.serviceWorker.registerCalls.at(-1)[0]).toMatch(
      /^\/sw\.js\?v=26\.07\.30-bbbbbbb&retry=\d+$/,
    );
  });

  describe("disabling offline access during a download", () => {
    const disableWhen = (h, manager, hook) => {
      let disabled = false;
      return (...args) => {
        if (!disabled && hook(...args)) {
          disabled = true;
          void manager.setOfflineEnabled(false);
        }
      };
    };

    test("stops before opening the cache", async () => {
      const h = makeEnvironment();
      const manager = uninitializedManager(h.environment);
      const open = h.environment.caches.open;
      const disable = disableWhen(h, manager, () => true);
      h.environment.caches.open = async (name) => {
        disable();
        return open(name);
      };
      await expect(manager.downloadGame("doom")).rejects.toThrow(
        "Offline access was disabled.",
      );
      expect(manager.getSnapshot().gamePhase).toBe("idle");
    });

    test("stops after a file is fetched", async () => {
      const h = makeEnvironment();
      const manager = uninitializedManager(h.environment);
      const fetch = h.environment.fetch;
      const disable = disableWhen(h, manager, (url) =>
        String(url).endsWith("doom.jsdos"),
      );
      h.environment.fetch = async (url, options) => {
        disable(url);
        return fetch(url, options);
      };
      await expect(manager.downloadGame("doom")).rejects.toThrow(
        "Offline access was disabled.",
      );
      expect(h.bundledCache.values.size).toBe(0);
    });

    test("removes written files even when cache deletion fails", async () => {
      const h = makeEnvironment();
      const manager = uninitializedManager(h.environment);
      const put = h.bundledCache.put.bind(h.bundledCache);
      const disable = disableWhen(h, manager, (url) =>
        String(url).endsWith("doom.jsdos"),
      );
      h.bundledCache.put = async (url, response) => {
        await put(url, response);
        disable(url);
      };
      h.bundledCache.delete = async () => {
        throw new Error("cache locked");
      };
      await expect(manager.downloadGame("doom")).rejects.toThrow(
        "Offline access was disabled.",
      );
    });

    test("discards an upgrade while old files are being removed", async () => {
      const h = makeEnvironment({
        storageValues: {
          astroXpOfflineGameRecords: JSON.stringify({
            doom: {
              bytes: 6,
              files: ["iframe/doom.old/index.html"],
              revision: "old",
              type: "iframe",
            },
          }),
        },
      });
      const manager = uninitializedManager(h.environment);
      const remove = h.bundledCache.delete.bind(h.bundledCache);
      const disable = disableWhen(h, manager, (url) =>
        String(url).includes("doom.old"),
      );
      let failDeletes = false;
      h.bundledCache.delete = async (url) => {
        disable(url);
        if (failDeletes) throw new Error("cache locked");
        return remove(url);
      };
      await expect(manager.downloadGame("doom")).rejects.toThrow(
        "Offline access was disabled.",
      );
      expect(
        [...h.bundledCache.values.keys()].some((url) =>
          url.includes("doom.doom-1"),
        ),
      ).toBeFalse();

      await manager.setOfflineEnabled(true);
      failDeletes = true;
      h.storage.setItem(
        "astroXpOfflineGameRecords",
        JSON.stringify({
          doom: {
            bytes: 6,
            files: ["iframe/doom.old/index.html"],
            revision: "old",
            type: "iframe",
          },
        }),
      );
      const retry = uninitializedManager(h.environment);
      const retryDisable = disableWhen(h, retry, (url) =>
        String(url).includes("doom.old"),
      );
      h.bundledCache.delete = async (url) => {
        retryDisable(url);
        throw new Error("cache locked");
      };
      await expect(retry.downloadGame("doom")).rejects.toThrow(
        "Offline access was disabled.",
      );
    });
  });

  test("upgrades a game even when an old file cannot be deleted", async () => {
    const h = makeEnvironment({
      storageValues: {
        astroXpOfflineGameRecords: JSON.stringify({
          doom: {
            bytes: 6,
            files: ["iframe/doom.old/index.html"],
            revision: "old",
            type: "iframe",
          },
        }),
      },
    });
    const manager = uninitializedManager(h.environment);
    h.bundledCache.delete = async () => {
      throw new Error("cache locked");
    };
    await manager.downloadGame("doom");
    expect(manager.getSnapshot().downloadedGameIds).toEqual(["doom"]);
  });

  test("keeps the shared Flash runtime while another Flash game is installed", async () => {
    const h = makeEnvironment({
      storageValues: {
        astroXpOfflineGameRecords: JSON.stringify({
          "other-flash-game": {
            bytes: 1,
            files: [],
            revision: "1",
            type: "swf",
          },
        }),
      },
    });
    const manager = uninitializedManager(h.environment);
    await manager.downloadGame("bike-mania");
    await manager.removeGame("bike-mania");
    expect(
      JSON.parse(h.storage.getItem("astroXpOfflineGameRecords")).__runtime__,
    ).toBeTruthy();
  });

  test("reports cache failures while removing a game", async () => {
    const h = makeEnvironment();
    const manager = uninitializedManager(h.environment);
    await manager.downloadGame("doom");
    h.environment.caches.open = async () => {
      throw new Error("cache unavailable");
    };
    await expect(manager.removeGame("doom")).rejects.toThrow(
      "cache unavailable",
    );
    expect(manager.getSnapshot()).toMatchObject({
      gamePhase: "error",
      gameError: "cache unavailable",
    });
  });

  test("shares a running update check and stops it when offline access is disabled", async () => {
    const h = makeEnvironment();
    const manager = await createInitializedManager(h.environment);
    let release,
      requests = 0;
    versionFetch(h, async (url, options, fetch) => {
      requests += 1;
      await new Promise((resolve) => (release = resolve));
      return fetch(url, options);
    });
    const first = manager.checkForUpdates();
    const second = manager.checkForUpdates();
    await flush();
    expect(requests).toBe(1);
    const disabling = manager.setOfflineEnabled(false);
    release();
    const results = await Promise.allSettled([first, second, disabling]);
    expect(results.map(({ reason }) => reason?.message)).toEqual([
      "Offline access was disabled.",
      "Offline access was disabled.",
      undefined,
    ]);
    expect(manager.getSnapshot().phase).toBe("disabled");
  });

  test("forgets pending reload and apply targets when a newer release appears", async () => {
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-first111",
    });
    const manager = await createInitializedManager(h.environment);
    registration.installing = new Worker("installing", "26.07.30-first111");
    await manager.updateNow();
    expect(manager.getSnapshot().phase).toBe("updating");
    registration.installing = null;
    registration.waiting = new Worker("installed", "26.07.30-second22");
    h.setRemote({
      version: "26.07.30-second22",
      releasedAt: new Date(now).toISOString(),
    });
    await manager.checkForUpdates();
    expect(manager.getSnapshot().availableVersion).toBe("26.07.30-second22");
    expect(registration.waiting.messages).toEqual([]);
    expect(h.getReloads()).toBe(0);
  });

  test("marks an update ready once its worker activates during registration", async () => {
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-bbbbbbb",
    });
    const manager = await createInitializedManager(h.environment);
    h.serviceWorker.register = async (...args) => {
      h.serviceWorker.registerCalls.push(args);
      registration.active = new Worker("activated", "26.07.30-bbbbbbb");
      return registration;
    };
    const result = await manager.checkForUpdates({
      applyAutomatically: true,
      bypassDelay: true,
    });
    expect(result).toBeUndefined();
    expect(manager.getSnapshot()).toMatchObject({
      phase: "update-ready",
      updateReady: true,
    });
  });

  test("repairs and disables without a tracked registration", async () => {
    for (const existing of [null, new Registration()]) {
      const h = makeEnvironment();
      h.serviceWorker.getRegistration = async () => existing;
      const manager = uninitializedManager(h.environment);
      await manager.repair();
      expect(manager.getSnapshot().phase).toBe("ready");
      if (existing) expect(existing.unregisterCalls).toBe(1);
    }
    for (const existing of [null, new Registration()]) {
      const h = makeEnvironment();
      h.serviceWorker.getRegistration = async () => existing;
      const manager = uninitializedManager(h.environment);
      expect((await manager.setOfflineEnabled(true)).enabled).toBeTrue();
      await manager.setOfflineEnabled(false);
      expect(manager.getSnapshot().phase).toBe("disabled");
      if (existing) expect(existing.unregisterCalls).toBe(1);
    }
  });

  test("skips shell cache cleanup when Cache Storage is unavailable", async () => {
    const h = makeEnvironment();
    const manager = await createInitializedManager(h.environment);
    delete h.environment.caches;
    await manager.setOfflineEnabled(false);
    expect(h.deletedCaches).toEqual([]);
  });

  test("keeps automatic updates off while offline access is disabled", async () => {
    const h = makeDisabledEnvironment();
    h.serviceWorker.getRegistration = async () => null;
    const manager = await createInitializedManager(h.environment);
    const before = h.fetches.length;
    manager.setAutomaticUpdatesEnabled(true);
    await flush();
    expect(h.fetches.length).toBe(before);
  });

  test("waits for a background check before a manual update", async () => {
    const h = makeEnvironment();
    const manager = await createInitializedManager(h.environment);
    const background = manager.checkForUpdates();
    const manual = manager.updateNow();
    await background;
    expect((await manual).phase).toBe("ready");
    expect(countVersionFetches(h)).toBe(3);
  });

  test("checks due updates when the page becomes visible again", async () => {
    const h = makeEnvironment({
      remoteVersion: "26.07.30-bbbbbbb",
      remoteReleasedAt: new Date(now).toISOString(),
    });
    const manager = await createInitializedManager(h.environment);
    expect(manager.getSnapshot().updateEligibleAt).toBe(now + sixHours);
    const before = countVersionFetches(h);
    h.environment.document.visibilityState = "hidden";
    h.environment.document.dispatch("visibilitychange");
    expect(countVersionFetches(h)).toBe(before);
    h.setNow(now + sixHours);
    h.environment.document.visibilityState = "visible";
    h.environment.document.dispatch("visibilitychange");
    expect(countVersionFetches(h)).toBe(before + 1);
  });

  test("retries failed update checks without surfacing unhandled errors", async () => {
    const registration = new Registration({
      active: new Worker("activated", manifest.version),
      waiting: new Worker("installed", "26.07.29-intermediate"),
    });
    const h = makeEnvironment({
      registration,
      remoteVersion: "26.07.30-bbbbbbb",
    });
    const manager = await createInitializedManager(h.environment);
    const retry = h.timers.find(({ delay }) => delay === 30_000);
    expect(retry).toBeTruthy();
    versionFetch(h, () => new Response("down", { status: 503 }));
    retry.callback();
    await flushUntil(() => manager.getSnapshot().error !== null);
    expect(manager.getSnapshot().error).toBe("Update check failed (503).");

    manager.setAutomaticUpdatesEnabled(false);
    manager.setAutomaticUpdatesEnabled(true);
    h.environment.dispatch("online");
    const background = manager.checkForUpdates().catch(() => {});
    await expect(manager.updateNow()).rejects.toThrow(
      "Update check failed (503).",
    );
    await background;
  });

  test("stops rescheduling when automatic updates are turned off during a failed check", async () => {
    const h = makeEnvironment({
      remoteVersion: "26.07.30-bbbbbbb",
      remoteReleasedAt: new Date(now).toISOString(),
    });
    const manager = await createInitializedManager(h.environment);
    const scheduled = h.timers.find(({ delay }) => delay === sixHours);
    h.setNow(now + sixHours);
    let fail;
    versionFetch(
      h,
      () =>
        new Promise((resolve) => {
          fail = () => resolve(new Response("down", { status: 503 }));
        }),
    );
    scheduled.callback();
    await flush();
    manager.setAutomaticUpdatesEnabled(false);
    const timerCount = h.timers.length;
    fail();
    await flushUntil(() => manager.getSnapshot().error !== null);
    await flush();
    expect(h.timers.length).toBe(timerCount);
  });

  test("marks an already-active update ready without reloading", async () => {
    const h = makeEnvironment({
      registration: new Registration({
        active: new Worker("activated", "26.07.30-bbbbbbb"),
      }),
      remoteVersion: "26.07.30-bbbbbbb",
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    const manager = await createInitializedManager(h.environment);
    await manager.checkForUpdates();
    expect(await manager.applyUpdate({ reload: false })).toBeUndefined();
    expect(manager.getSnapshot()).toMatchObject({
      phase: "update-ready",
      updateReady: true,
    });
    expect(h.getReloads()).toBe(0);
  });

  test("finishes a manual worker migration that activates immediately", async () => {
    const registration = new Registration({
      active: new Worker(
        "activated",
        manifest.version,
        `/sw.js?v=${manifest.version}`,
      ),
    });
    const h = makeEnvironment({
      registration,
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    const manager = await createInitializedManager(h.environment);
    expect(h.serviceWorker.registerCalls.length).toBe(1);
    expect(manager.getSnapshot().phase).toBe("ready");
  });
});

describe("offline manager version reporting", () => {
  test("leaves the revision unknown for an active version without one", async () => {
    const version = "26.07.30-";
    const h = makeEnvironment({
      registration: new Registration({
        active: new Worker("activated", version),
      }),
      remoteVersion: version,
      storageValues: { astroXpAutomaticUpdatesEnabled: "false" },
    });
    const manager = await createInitializedManager(h.environment);
    await manager.checkForUpdates();
    expect(manager.getSnapshot()).toMatchObject({
      phase: "update-ready",
      availableVersion: version,
      availableRevision: null,
    });
  });
});

const shellCacheModule = require("../site/js/shell-cache.js");
const nextVersion = "26.07.30-bbbbbbb";
const workerScript = (entries) =>
  `self.__ASTRO_XP_VERSION__="${nextVersion}";\nself.__ASTRO_XP_PRECACHE__=${JSON.stringify(entries)};\nimportScripts("js/shell-cache.12345678.js");\n`;
const shellEntries = [
  { integrity: "sha384-a", revision: "aaaaaaaa", url: "js/a.aaaaaaaa.js" },
  { integrity: "sha384-b", revision: "bbbbbbbb", url: "css/b.bbbbbbbb.css" },
  {
    fixed: true,
    integrity: "sha384-i",
    revision: "iiiiiiii",
    url: "index.html",
  },
];

// Serves a worker script and its files to the page-side download.
const withShellDownloads = (
  h,
  { script = workerScript(shellEntries) } = {},
) => {
  const requested = [];
  const versionFetch = h.environment.fetch;
  h.environment.AstroShellCache = shellCacheModule;
  h.environment.fetch = async (input, options) => {
    if (typeof input === "object") {
      requested.push(new URL(input.url).pathname);
      return new Response(`body of ${input.url}`);
    }
    const path = new URL(input, "https://xp.example/").pathname;
    if (path.startsWith("/sw.")) {
      requested.push(path);
      expect(options.cache).toBe("no-store");
      return typeof script === "function" ? script() : new Response(script);
    }
    return versionFetch(input, options);
  };
  return requested;
};

describe("offline manager page-side download", () => {
  test("stores the new files before registering the new worker", async () => {
    const h = makeEnvironment({
      registration: new Registration({
        active: new Worker(
          "activated",
          manifest.version,
          "https://xp.example/sw.26.07.29-aaaaaaa.js",
        ),
      }),
      remoteVersion: nextVersion,
    });
    const requested = withShellDownloads(h);
    const register = h.serviceWorker.register;
    let storedBeforeRegister = null;
    h.serviceWorker.register = async (...args) => {
      storedBeforeRegister ??= requested.length;
      return register(...args);
    };
    await createInitializedManager(h.environment);
    expect(requested).toEqual([
      `/sw.${nextVersion}.js`,
      "/js/a.aaaaaaaa.js",
      "/css/b.bbbbbbbb.css",
    ]);
    expect(storedBeforeRegister).toBe(3);
  });

  test("skips the download when a worker of that version exists", async () => {
    const h = makeEnvironment({
      registration: new Registration({
        active: new Worker(
          "activated",
          manifest.version,
          "https://xp.example/sw.26.07.29-aaaaaaa.js",
        ),
        waiting: new Worker(
          "installed",
          nextVersion,
          `https://xp.example/sw.${nextVersion}.js`,
        ),
      }),
      remoteVersion: nextVersion,
    });
    const requested = withShellDownloads(h);
    await createInitializedManager(h.environment);
    await h.serviceWorker.register;
    expect(requested).toEqual([]);
  });

  test("leaves the files to the worker when the page can't get them", async () => {
    for (const script of [
      () => new Response("", { status: 404 }),
      () => new Response("importScripts();"),
      () => {
        throw new TypeError("offline");
      },
    ]) {
      const h = makeEnvironment({
        registration: new Registration({
          active: new Worker("activated", manifest.version),
        }),
        remoteVersion: nextVersion,
      });
      withShellDownloads(h, { script });
      await createInitializedManager(h.environment);
      expect(h.serviceWorker.registerCalls).toHaveLength(1);
    }
  });

  test("downloads on a first visit and without a versioned worker URL", async () => {
    const activeRegistration = new Registration({
      active: new Worker("activated", manifest.version),
    });
    // A worker URL without the version can't tell which release a worker runs.
    const unversioned = makeEnvironment({ registration: activeRegistration });
    const unversionedRequests = withShellDownloads(unversioned);
    await createManager({
      currentVersion: manifest.version,
      environment: unversioned.environment,
      serviceWorkerUrl: "/sw.js",
    }).initialize();
    expect(unversionedRequests[0]).toBe("/sw.js");

    const first = makeEnvironment();
    delete first.serviceWorker.getRegistration;
    first.serviceWorker.register = async () => activeRegistration;
    const firstRequests = withShellDownloads(first);
    await createInitializedManager(first.environment);
    expect(firstRequests[0]).toBe(`/sw.${manifest.version}.js`);
  });

  test("needs Cache Storage", async () => {
    const h = makeEnvironment({
      registration: new Registration({
        active: new Worker("activated", manifest.version),
      }),
      remoteVersion: nextVersion,
    });
    const requested = withShellDownloads(h);
    delete h.environment.caches;
    await createInitializedManager(h.environment);
    expect(requested).toEqual([]);
  });
});

describe("offline manager missing files", () => {
  const sendWorkerMessage = (h, data) =>
    h.serviceWorker.listeners
      .get("message")
      .forEach((listener) => listener({ data }));
  const dispatch = (h, name, event) =>
    h.environment.listeners.get(name).forEach((listener) => listener(event));

  test("asks for a reload when a newer release removed a file", async () => {
    const h = makeEnvironment();
    const manager = await createInitializedManager(h.environment);
    const checks = countVersionFetches(h);

    sendWorkerMessage(h, { type: "OTHER" });
    sendWorkerMessage(h, undefined);
    dispatch(h, "error", { target: h.environment });
    dispatch(h, "error", { target: { src: "https://other.example/a.js" } });
    dispatch(h, "error", { target: { src: "http://[" } });
    dispatch(h, "error", { target: { src: "" } });
    dispatch(h, "unhandledrejection", { reason: new Error("boom") });
    dispatch(h, "unhandledrejection", { reason: undefined });
    await flush();
    expect(countVersionFetches(h)).toBe(checks);

    // Same release: the file is just unreachable, so nothing to offer.
    sendWorkerMessage(h, { type: "ASTRO_FILE_MISSING" });
    sendWorkerMessage(h, { type: "ASTRO_FILE_MISSING" });
    await flushUntil(() => countVersionFetches(h) > checks);
    await flush();
    expect(countVersionFetches(h)).toBe(checks + 1);
    expect(manager.getSnapshot().reloadRequired).toBe(false);

    h.setRemote({ version: nextVersion });
    dispatch(h, "error", { target: { href: "css/apps/gone.12345678.css" } });
    await flushUntil(() => manager.getSnapshot().reloadRequired);
    expect(manager.getSnapshot().reloadRequired).toBe(true);
    await flushUntil(() => countVersionFetches(h) > checks + 2);
    expect(countVersionFetches(h)).toBe(checks + 3);

    dispatch(h, "unhandledrejection", {
      reason: new TypeError("Failed to fetch dynamically imported module"),
    });
    await flush();
    expect(countVersionFetches(h)).toBe(checks + 3);
  });

  test("checks again after a failed check and works with offline use off", async () => {
    const h = makeDisabledEnvironment();
    const manager = await createInitializedManager(h.environment);
    h.environment.navigator.onLine = false;
    dispatch(h, "unhandledrejection", {
      reason: new TypeError("Importing a module script failed."),
    });
    await flush();
    expect(manager.getSnapshot().reloadRequired).toBe(false);

    h.environment.navigator.onLine = true;
    h.setRemote({ version: nextVersion });
    const checks = countVersionFetches(h);
    manager.reportMissingFile();
    await flushUntil(() => manager.getSnapshot().reloadRequired);
    expect(manager.getSnapshot().reloadRequired).toBe(true);
    await flush();
    expect(countVersionFetches(h)).toBe(checks + 1);
  });
});
