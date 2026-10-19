"use strict";

(function exposeOfflineManager(root, factory) {
  const storagePolicy =
    typeof module === "object" && module.exports
      ? require("./storage-policy.js")
      : root.AstroStoragePolicy;
  const api = factory(storagePolicy);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.AstroOffline = api;
  }
})(globalThis, (storagePolicy) => {
  const LAST_CHECKED_KEY = "astroXpLastUpdateCheck";
  const DOWNLOAD_VERSION_KEY = "astroXpDownloadVersion";
  const DOWNLOAD_BYTES_KEY = "astroXpDownloadBytes";
  const GAME_RECORDS_KEY = "astroXpOfflineGameRecords";
  const ACTIVE_VERSION_RELOAD_KEY = "astroXpActiveVersionReload";
  const AUTOMATIC_UPDATE_DELAY_KEY = "astroXpAutomaticUpdateDelay";
  const OFFLINE_ENABLED_KEY = "astroXpOfflineEnabled";
  const SAVE_PLAYED_GAMES_KEY = "astroXpSavePlayedGamesOffline";
  const AUTOMATIC_UPDATES_KEY = "astroXpAutomaticUpdatesEnabled";
  const BUNDLED_GAME_CACHE = "astro-bundled-games-v1";
  const RELEASE_PREFIX = /^\/releases\/[^/]+(?=\/)/;
  const DEFAULT_CHECK_INTERVAL = 60 * 60 * 1000;
  const UPDATE_RETRY_DELAY = 30 * 1000;
  const MISSING_FILE_MESSAGE = "ASTRO_FILE_MISSING";
  const MODULE_LOAD_FAILURE =
    /dynamically imported module|module script failed/i;
  // A release deployed during an update removes files the update still needs,
  // so a failed install checks for the newer release before asking for Repair.
  const INSTALL_RETRIES = 3;
  const INSTALL_RETRY_DELAY = 2 * 1000;

  const waitForWorker = (worker) =>
    new Promise((resolve, reject) => {
      if (!worker || worker.state === "activated") {
        resolve();
        return;
      }
      if (worker.state === "redundant") {
        reject(new Error("The download stopped. Try again."));
        return;
      }
      const onStateChange = () => {
        if (worker.state === "activated") {
          worker.removeEventListener("statechange", onStateChange);
          resolve();
        } else if (worker.state === "redundant") {
          worker.removeEventListener("statechange", onStateChange);
          reject(new Error("The download stopped. Try again."));
        }
      };
      worker.addEventListener("statechange", onStateChange);
    });

  const safeRecords = (storage) => {
    try {
      const parsed = JSON.parse(storage.getItem(GAME_RECORDS_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  };

  const validManifestFile = (file) =>
    file &&
    typeof file.url === "string" &&
    !file.url.startsWith("/") &&
    !file.url.includes("\\") &&
    !file.url
      .split("/")
      .some((part) => !part || part === "." || part === "..") &&
    Number.isInteger(file.bytes) &&
    file.bytes >= 0 &&
    typeof file.integrity === "string" &&
    /^sha384-[A-Za-z0-9+/]+={0,2}$/.test(file.integrity);

  const validateManifestEntry = (entry) =>
    entry &&
    typeof entry.revision === "string" &&
    Number.isInteger(entry.bytes) &&
    entry.bytes >= 0 &&
    Array.isArray(entry.files) &&
    entry.files.every(validManifestFile);

  const validateGameManifest = (manifest) => {
    if (
      !manifest ||
      typeof manifest.version !== "string" ||
      !validateManifestEntry(manifest.runtime) ||
      !manifest.games ||
      typeof manifest.games !== "object" ||
      Array.isArray(manifest.games)
    ) {
      throw new Error("The game list didn't load. Try again.");
    }
    if (
      manifest.runtimes !== undefined &&
      (!manifest.runtimes ||
        typeof manifest.runtimes !== "object" ||
        Array.isArray(manifest.runtimes))
    ) {
      throw new Error("The game list didn't load. Try again.");
    }
    for (const [id, entry] of Object.entries(manifest.runtimes || {})) {
      if (!/^[a-z0-9-]+$/.test(id) || !validateManifestEntry(entry)) {
        throw new Error("The game list didn't load. Try again.");
      }
    }
    for (const [id, entry] of Object.entries(manifest.games)) {
      if (
        !/^[a-z0-9-]+$/.test(id) ||
        !validateManifestEntry(entry) ||
        !["swf", "iframe"].includes(entry.type) ||
        entry.root !== `${entry.type}/${id}.${entry.revision}/` ||
        (entry.runtime !== undefined &&
          (!/^[a-z0-9-]+$/.test(entry.runtime) ||
            !manifest.runtimes?.[entry.runtime]))
      ) {
        throw new Error("The game list didn't load. Try again.");
      }
    }
    return manifest;
  };

  const createManager = ({
    currentVersion,
    environment = globalThis,
    serviceWorkerUrl = "/sw.{version}.js",
    versionUrl = "/version.json",
    gameManifestUrl = "offline-games.json",
    cachePrefix = "astro-xp",
    bundledCacheName = BUNDLED_GAME_CACHE,
    checkInterval = DEFAULT_CHECK_INTERVAL,
  }) => {
    const navigatorObject = environment.navigator;
    const storage = environment.localStorage;
    const sessionStorage = environment.sessionStorage || storage;
    const listeners = new Set();
    const trackedRegistrations = new WeakSet();
    const trackedWorkers = new WeakSet();
    const records = safeRecords(storage);
    let registration = null;
    let manifest = null;
    let checkPromise = null;
    let reloadWhenControlled = false;
    let lifecycleListenersAttached = false;
    let updateRetryTimer = null;
    let automaticUpdateTimer = null;
    let bypassWorkerCdn = false;
    let applyTargetVersion = null;
    let reloadTargetVersion = null;
    let failedUpdateInstalls = 0;
    let missingFileCheck = null;

    const versionedServiceWorkerUrl = (version) => {
      if (serviceWorkerUrl.includes("{version}")) {
        const versionedUrl = serviceWorkerUrl.replace(
          "{version}",
          encodeURIComponent(version),
        );
        return bypassWorkerCdn
          ? `${versionedUrl}?retry=${environment.Date.now()}`
          : versionedUrl;
      }
      const separator = serviceWorkerUrl.includes("?") ? "&" : "?";
      const versionedUrl = `${serviceWorkerUrl}${separator}v=${encodeURIComponent(version)}`;
      return bypassWorkerCdn
        ? `${versionedUrl}&retry=${environment.Date.now()}`
        : versionedUrl;
    };

    const workerNeedsVersionedUrl = (worker, version) => {
      if (!worker?.scriptURL || !serviceWorkerUrl.includes("{version}")) {
        return false;
      }
      const expected = new URL(
        serviceWorkerUrl.replace("{version}", encodeURIComponent(version)),
        environment.location.href,
      );
      return (
        new URL(worker.scriptURL, environment.location.href).pathname !==
        expected.pathname
      );
    };

    const scheduleUpdateRetry = () => {
      if (
        !state.enabled ||
        (!state.automaticUpdatesEnabled && applyTargetVersion === null)
      ) {
        return;
      }
      if (updateRetryTimer !== null) return;
      updateRetryTimer = (environment.setTimeout || setTimeout)(() => {
        updateRetryTimer = null;
        const shouldApply = applyTargetVersion !== null;
        void checkForUpdates({
          applyAutomatically: shouldApply,
          bypassDelay: shouldApply,
        }).catch(() => {});
      }, UPDATE_RETRY_DELAY);
    };

    const scheduleAutomaticUpdate = (eligibleAt) => {
      if (!state.enabled || !state.automaticUpdatesEnabled) {
        cancelAutomaticUpdate();
        return;
      }
      if (automaticUpdateTimer !== null) {
        (environment.clearTimeout || clearTimeout)(automaticUpdateTimer);
      }
      const delay = Math.max(0, eligibleAt - environment.Date.now());
      automaticUpdateTimer = (environment.setTimeout || setTimeout)(
        () => {
          automaticUpdateTimer = null;
          if (environment.Date.now() < eligibleAt) {
            scheduleAutomaticUpdate(eligibleAt);
            return;
          }
          void checkForUpdates({ applyAutomatically: true }).catch(() => {
            if (navigatorObject.onLine !== false) {
              scheduleAutomaticUpdate(
                environment.Date.now() + UPDATE_RETRY_DELAY,
              );
            }
          });
        },
        Math.min(delay, 2_147_483_647),
      );
    };

    const retryFailedUpdate = () => {
      failedUpdateInstalls += 1;
      const applying = applyTargetVersion !== null;
      const reload = reloadTargetVersion !== null;
      (environment.setTimeout || setTimeout)(() => {
        if (!state.enabled) return;
        void checkForUpdates({
          applyAutomatically: true,
          bypassDelay: applying,
          reload,
        }).catch(() => {});
      }, INSTALL_RETRY_DELAY * failedUpdateInstalls);
    };

    const cancelAutomaticUpdate = () => {
      if (automaticUpdateTimer === null) return;
      (environment.clearTimeout || clearTimeout)(automaticUpdateTimer);
      automaticUpdateTimer = null;
    };

    const cancelUpdateRetry = () => {
      if (updateRetryTimer === null) return;
      (environment.clearTimeout || clearTimeout)(updateRetryTimer);
      updateRetryTimer = null;
    };

    const requestWorkerVersion = (worker) =>
      new Promise((resolve) => {
        const MessageChannelConstructor =
          environment.MessageChannel || globalThis.MessageChannel;
        if (!worker || !MessageChannelConstructor) {
          resolve(null);
          return;
        }
        const channel = new MessageChannelConstructor();
        let settled = false;
        const finish = (version = null) => {
          if (settled) return;
          settled = true;
          channel.port1.close?.();
          channel.port2.close?.();
          resolve(typeof version === "string" ? version : null);
        };
        channel.port1.onmessage = (event) => finish(event.data?.version);
        try {
          worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
        } catch {
          finish();
          return;
        }
        (environment.setTimeout || setTimeout)(() => finish(), 250);
      });

    const cachedDownloadBytes =
      storage.getItem(DOWNLOAD_VERSION_KEY) === currentVersion
        ? Number(storage.getItem(DOWNLOAD_BYTES_KEY)) || null
        : null;
    const savedAutomaticUpdateDelayValue = storage.getItem(
      AUTOMATIC_UPDATE_DELAY_KEY,
    );
    const savedAutomaticUpdateDelay = Number(savedAutomaticUpdateDelayValue);
    const settingEnabled = (key) => storage.getItem(key) !== "false";
    let state = {
      enabled: settingEnabled(OFFLINE_ENABLED_KEY),
      savePlayedGamesOffline: settingEnabled(SAVE_PLAYED_GAMES_KEY),
      automaticUpdatesEnabled: settingEnabled(AUTOMATIC_UPDATES_KEY),
      online: navigatorObject.onLine !== false,
      phase: settingEnabled(OFFLINE_ENABLED_KEY) ? "starting" : "disabled",
      currentVersion,
      availableVersion: null,
      availableRevision: null,
      updateEligibleAt: null,
      automaticUpdateDelayMs:
        savedAutomaticUpdateDelayValue !== null &&
        Number.isInteger(savedAutomaticUpdateDelay) &&
        savedAutomaticUpdateDelay >= 0
          ? savedAutomaticUpdateDelay
          : null,
      releaseUpdateDelayMs: null,
      downloadBytes: cachedDownloadBytes,
      bundledGameBytes: null,
      downloadMetadataError: false,
      lastChecked: Number(storage.getItem(LAST_CHECKED_KEY)) || null,
      updateReady: false,
      // A file this tab needs is gone because a newer release replaced it.
      reloadRequired: false,
      workerState: "unregistered",
      usage: null,
      quota: null,
      error: null,
      bundledGames: [],
      downloadedGameIds: Object.keys(records).filter(
        (id) => !id.startsWith("__runtime__"),
      ),
      downloadedGameBytes: Object.values(records).reduce(
        (total, record) => total + (Number(record.bytes) || 0),
        0,
      ),
      gamePhase: "idle",
      activeGameId: null,
      gameProgressLoaded: 0,
      gameProgressTotal: 0,
      gameError: null,
    };

    const snapshot = () => ({
      ...state,
      bundledGames: state.bundledGames.map((game) => ({ ...game })),
      downloadedGameIds: [...state.downloadedGameIds],
    });
    const notify = () => listeners.forEach((listener) => listener(snapshot()));
    const setState = (patch) => {
      state = { ...state, ...patch };
      notify();
    };

    const subscribe = (listener) => {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    };

    const persistRecords = () => {
      storage.setItem(GAME_RECORDS_KEY, JSON.stringify(records));
      const downloadedGameIds = Object.keys(records).filter(
        (id) => !id.startsWith("__runtime__"),
      );
      setState({
        downloadedGameIds,
        downloadedGameBytes: Object.values(records).reduce(
          (total, record) => total + (Number(record.bytes) || 0),
          0,
        ),
      });
    };

    const refreshStorageEstimate = async () => {
      const estimate = await storagePolicy.estimate(navigatorObject.storage);
      if (!estimate) return snapshot();
      setState({ usage: estimate.usage, quota: estimate.quota });
      return snapshot();
    };

    const rememberVersionMetadata = (metadata) => {
      storage.setItem(DOWNLOAD_VERSION_KEY, metadata.version);
      storage.setItem(DOWNLOAD_BYTES_KEY, String(metadata.offlineBytes));
      setState({
        downloadBytes: metadata.offlineBytes,
        bundledGameBytes: metadata.bundledGameBytes,
        releaseUpdateDelayMs: metadata.stabilityDelayMs,
        downloadMetadataError: false,
      });
    };

    const automaticUpdateDelay = (metadata) =>
      state.automaticUpdateDelayMs ?? metadata.stabilityDelayMs;

    const updateEligibleAt = (metadata) =>
      Date.parse(metadata.releasedAt) + automaticUpdateDelay(metadata);

    const markWaitingUpdate = async (worker, knownMetadata = null) => {
      if (
        applyTargetVersion === currentVersion &&
        !state.automaticUpdatesEnabled
      ) {
        if ((await requestWorkerVersion(worker)) !== currentVersion) {
          throw new Error("The download doesn't match. Try again.");
        }
        applyTargetVersion = null;
        setState({
          phase: "ready",
          workerState: "waiting",
          updateReady: false,
          error: null,
        });
        worker.postMessage({ type: "SKIP_WAITING" });
        return true;
      }
      let metadata = knownMetadata;
      try {
        metadata ||= await fetchVersion();
        rememberVersionMetadata(metadata);
      } catch {
        scheduleUpdateRetry();
        return false;
      }
      const eligibleAt = updateEligibleAt(metadata);
      if (
        environment.Date.now() < eligibleAt &&
        applyTargetVersion !== metadata.version
      ) {
        setState({
          phase: "update-pending",
          updateReady: false,
          workerState: "waiting",
          availableVersion: metadata.version,
          availableRevision: metadata.revision,
          updateEligibleAt: eligibleAt,
          downloadBytes: metadata.offlineBytes,
          error: null,
        });
        return false;
      }
      const workerVersion = await requestWorkerVersion(worker);
      if (workerVersion !== metadata.version) {
        bypassWorkerCdn = true;
        setState({
          phase: "updating",
          updateReady: false,
          workerState: "waiting",
          availableVersion: metadata.version,
          availableRevision: metadata.revision,
          updateEligibleAt: eligibleAt,
          downloadBytes: metadata.offlineBytes,
          error: null,
        });
        scheduleUpdateRetry();
        return false;
      }
      bypassWorkerCdn = false;
      setState({
        phase: "update-ready",
        updateReady: true,
        workerState: "waiting",
        availableVersion: metadata.version,
        availableRevision: metadata.revision,
        updateEligibleAt: eligibleAt,
        downloadBytes: metadata.offlineBytes,
        error: null,
      });
      if (applyTargetVersion === metadata.version) {
        applyTargetVersion = null;
        await applyUpdate({ reload: reloadTargetVersion === metadata.version });
      }
      return true;
    };

    const reconcileActiveVersion = async (targetVersion) => {
      if (!targetVersion || targetVersion === currentVersion) {
        sessionStorage.removeItem?.(ACTIVE_VERSION_RELOAD_KEY);
        return false;
      }
      const activeVersion = await requestWorkerVersion(registration?.active);
      if (activeVersion !== targetVersion) return false;

      setState({
        availableVersion: targetVersion,
        availableRevision: targetVersion.split("-").at(-1) || null,
      });
      if (reloadTargetVersion !== targetVersion) {
        setState({
          phase: "update-ready",
          updateReady: true,
          workerState: "active",
          error: null,
        });
        return true;
      }
      reloadTargetVersion = null;
      if (sessionStorage.getItem(ACTIVE_VERSION_RELOAD_KEY) === targetVersion) {
        setState({
          phase: "repair-required",
          updateReady: false,
          workerState: "active",
          error: "Some files don't match. Select Repair.",
        });
        return true;
      }

      sessionStorage.setItem(ACTIVE_VERSION_RELOAD_KEY, targetVersion);
      setState({ phase: "applying", error: null });
      environment.location.reload();
      return true;
    };

    const trackInstallingWorker = (worker, isUpdate) => {
      if (!worker || trackedWorkers.has(worker)) return;
      trackedWorkers.add(worker);
      setState({
        phase: isUpdate ? "updating" : "downloading",
        workerState: worker.state,
        error: null,
      });
      worker.addEventListener("statechange", () => {
        if (!state.enabled) return;
        setState({ workerState: worker.state });
        if (worker.state === "installed" && isUpdate) {
          failedUpdateInstalls = 0;
          (environment.setTimeout || setTimeout)(() => {
            if (registration?.waiting) {
              void markWaitingUpdate(registration.waiting);
            }
          }, 0);
        } else if (worker.state === "activated" && !isUpdate) {
          setState({ phase: "ready", workerState: "active", error: null });
          void refreshStorageEstimate();
        } else if (
          worker.state === "redundant" &&
          isUpdate &&
          failedUpdateInstalls < INSTALL_RETRIES
        ) {
          setState({ phase: "updating", workerState: "failed", error: null });
          retryFailedUpdate();
        } else if (worker.state === "redundant") {
          setState({
            phase: "error",
            workerState: "failed",
            error: isUpdate
              ? "The update didn't finish. Select Repair."
              : "The system-file download did not complete.",
          });
        }
      });
    };

    const trackRegistration = (nextRegistration, inspectWaiting = true) => {
      registration = nextRegistration;
      if (trackedRegistrations.has(nextRegistration)) return;
      trackedRegistrations.add(nextRegistration);
      nextRegistration.addEventListener("updatefound", () => {
        if (!state.enabled) return;
        trackInstallingWorker(
          nextRegistration.installing,
          Boolean(
            nextRegistration.active || navigatorObject.serviceWorker.controller,
          ),
        );
      });
      if (
        inspectWaiting &&
        nextRegistration.waiting &&
        nextRegistration.active &&
        (state.automaticUpdatesEnabled || applyTargetVersion !== null)
      ) {
        void markWaitingUpdate(nextRegistration.waiting);
      } else if (nextRegistration.installing) {
        trackInstallingWorker(
          nextRegistration.installing,
          Boolean(
            nextRegistration.active || navigatorObject.serviceWorker.controller,
          ),
        );
      }
    };

    const workerRunsVersion = (worker, version) =>
      Boolean(worker?.scriptURL) &&
      serviceWorkerUrl.includes("{version}") &&
      !workerNeedsVersionedUrl(worker, version);

    // Chrome slows down the downloads of an installing worker, so the page
    // stores the new files first and the worker only checks them. The
    // entry points are left to the worker: the current one would answer the
    // page's request with its own copy.
    const prefetchShell = async (targetVersion) => {
      const shellCache = environment.AstroShellCache;
      if (!shellCache || !environment.caches) return;
      const existing =
        registration ||
        (await navigatorObject.serviceWorker.getRegistration?.("/"));
      if (
        [existing?.active, existing?.waiting, existing?.installing].some(
          (worker) => workerRunsVersion(worker, targetVersion),
        )
      ) {
        return;
      }
      setState({
        phase: existing?.active ? "updating" : "downloading",
        error: null,
      });
      try {
        const scriptUrl = new URL(
          versionedServiceWorkerUrl(targetVersion),
          environment.location.href,
        );
        const response = await environment.fetch(scriptUrl.href, {
          cache: "no-store",
        });
        if (!response.ok) return;
        await shellCache
          .createShellCache({
            base: scriptUrl.href,
            caches: environment.caches,
            fetch: (request) => environment.fetch(request),
            manifest: shellCache
              .parseWorkerManifest(await response.text())
              .filter((entry) => !entry.fixed),
          })
          .install();
      } catch {
        // The worker downloads whatever is still missing.
      }
    };

    const registerAndWait = async (targetVersion, inspectWaiting = true) => {
      if (!navigatorObject.serviceWorker) {
        throw new Error("This browser can't work offline.");
      }
      await prefetchShell(targetVersion);
      const nextRegistration = await navigatorObject.serviceWorker.register(
        versionedServiceWorkerUrl(targetVersion),
        { scope: "/", updateViaCache: "none" },
      );
      trackRegistration(nextRegistration, inspectWaiting);
      if (nextRegistration.active) {
        setState({
          phase:
            nextRegistration.installing || nextRegistration.waiting
              ? "updating"
              : "ready",
          workerState: nextRegistration.waiting ? "waiting" : "active",
          updateReady: false,
          error: null,
        });
        return nextRegistration;
      }
      const worker = nextRegistration.installing || nextRegistration.waiting;
      if (worker) {
        setState({
          phase: "downloading",
          workerState: worker.state,
          error: null,
        });
        await waitForWorker(worker);
      } else {
        await navigatorObject.serviceWorker.ready;
      }
      const activeWorker = nextRegistration.active || worker;
      if ((await requestWorkerVersion(activeWorker)) !== targetVersion) {
        scheduleUpdateRetry();
        throw new Error("The download doesn't match. Try again.");
      }
      setState({ phase: "ready", workerState: "active", error: null });
      await refreshStorageEstimate();
      return nextRegistration;
    };

    async function fetchVersion() {
      if (navigatorObject.onLine === false) {
        throw new Error("You're offline. Connect to check for updates.");
      }
      const separator = versionUrl.includes("?") ? "&" : "?";
      const response = await environment.fetch(
        `${versionUrl}${separator}t=${environment.Date.now()}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`Update check failed (${response.status}).`);
      }
      const metadata = await response.json();
      if (
        typeof metadata.version !== "string" ||
        typeof metadata.revision !== "string" ||
        typeof metadata.releasedAt !== "string" ||
        !Number.isFinite(Date.parse(metadata.releasedAt)) ||
        !Number.isInteger(metadata.stabilityDelayMs) ||
        metadata.stabilityDelayMs < 0 ||
        !Number.isFinite(metadata.offlineBytes) ||
        metadata.offlineBytes <= 0 ||
        !Number.isFinite(metadata.bundledGameBytes) ||
        metadata.bundledGameBytes <= 0
      ) {
        throw new Error("The update server sent bad data. Try again later.");
      }
      return metadata;
    }

    const loadGameManifest = async () => {
      const response = await environment.fetch(gameManifestUrl, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Offline game catalog failed (${response.status}).`);
      }
      manifest = validateGameManifest(await response.json());
      if (manifest.version !== currentVersion) {
        manifest = null;
        throw new Error("The game list didn't load. Try again.");
      }
      setState({
        bundledGames: Object.entries(manifest.games).map(([id, entry]) => ({
          id,
          bytes: entry.bytes,
          revision: entry.revision,
          type: entry.type,
        })),
        bundledGameBytes:
          manifest.runtime.bytes +
          Object.values(manifest.runtimes || {}).reduce(
            (total, entry) => total + entry.bytes,
            0,
          ) +
          Object.values(manifest.games).reduce(
            (total, entry) => total + entry.bytes,
            0,
          ),
      });
      return manifest;
    };

    const ensureManifest = async () => manifest || loadGameManifest();
    // Game files keep the same cache key across releases, so a download stays
    // usable offline after an update that did not change the game itself.
    const absoluteUrl = (url) => {
      const key = new URL(
        url,
        environment.document?.baseURI ||
          environment.location?.href ||
          environment.location?.origin ||
          "https://astro.local/",
      );
      key.pathname = key.pathname.replace(RELEASE_PREFIX, "");
      return key.href;
    };
    const hasAllFiles = async (cache, record) =>
      (
        await Promise.all(
          (record.files || []).map((url) => cache.match(absoluteUrl(url))),
        )
      ).every(Boolean);

    const cacheEntry = async (id, entry, progress) => {
      const cache = await environment.caches.open(bundledCacheName);
      if (!state.enabled) {
        throw new Error("Offline access was disabled.");
      }
      if (
        records[id]?.revision === entry.revision &&
        Array.isArray(records[id].files) &&
        (await hasAllFiles(cache, {
          files: entry.files.map((file) => file.url),
        }))
      ) {
        return;
      }
      const previousFiles = records[id]?.files || [];
      const previousUrls = new Set(previousFiles.map(absoluteUrl));
      let loaded = 0;
      const written = [];
      try {
        for (const file of entry.files) {
          const response = await environment.fetch(file.url, {
            cache: "no-store",
            integrity: file.integrity,
          });
          if (!response.ok) {
            throw new Error(`Offline download failed (${response.status}).`);
          }
          if (!state.enabled) {
            throw new Error("Offline access was disabled.");
          }
          const url = absoluteUrl(file.url);
          await cache.put(url, response);
          written.push(url);
          loaded += file.bytes;
          progress(file.bytes);
        }
        if (!state.enabled) {
          throw new Error("Offline access was disabled.");
        }
      } catch (error) {
        await Promise.all(
          written
            .filter((url) => !state.enabled || !previousUrls.has(url))
            .map((url) => cache.delete(url).catch(() => {})),
        );
        throw error;
      }
      const nextUrls = new Set(
        entry.files.map((file) => absoluteUrl(file.url)),
      );
      await Promise.all(
        [...previousUrls]
          .filter((url) => !nextUrls.has(url))
          .map((url) => cache.delete(url).catch(() => {})),
      );
      if (!state.enabled) {
        await Promise.all(
          written.map((url) => cache.delete(url).catch(() => {})),
        );
        throw new Error("Offline access was disabled.");
      }
      records[id] = {
        bytes: entry.bytes,
        files: entry.files.map((file) => file.url),
        revision: entry.revision,
        ...(entry.runtime ? { runtime: entry.runtime } : {}),
        type: entry.type || "runtime",
      };
      persistRecords();
      return loaded;
    };

    const downloadGame = async (id) => {
      if (!state.enabled) {
        throw new Error("Enable offline access to download built-in games.");
      }
      const currentManifest = await ensureManifest();
      const entry = currentManifest.games[id];
      if (!entry) throw new Error("This game isn't available.");
      const runtimeEntry = entry.runtime
        ? currentManifest.runtimes?.[entry.runtime]
        : entry.type === "swf"
          ? currentManifest.runtime
          : null;
      const runtimeRecordId = entry.runtime
        ? `__runtime__:${entry.runtime}`
        : "__runtime__";
      const needsRuntime =
        runtimeEntry &&
        records[runtimeRecordId]?.revision !== runtimeEntry.revision;
      const total = entry.bytes + (needsRuntime ? runtimeEntry.bytes : 0);
      await storagePolicy.requestPersistence(navigatorObject.storage);
      let loaded = 0;
      setState({
        gamePhase: "downloading",
        activeGameId: id,
        gameProgressLoaded: 0,
        gameProgressTotal: total,
        gameError: null,
      });
      const progress = (bytes) => {
        loaded += bytes;
        setState({ gameProgressLoaded: Math.min(loaded, total) });
      };
      try {
        if (runtimeEntry) {
          await cacheEntry(runtimeRecordId, runtimeEntry, progress);
        }
        await cacheEntry(id, entry, progress);
        setState({
          gamePhase: "idle",
          activeGameId: null,
          gameProgressLoaded: total,
          gameProgressTotal: total,
        });
        await refreshStorageEstimate();
        return snapshot();
      } catch (error) {
        const normalized = storagePolicy.normalizeError(error);
        setState(
          state.enabled
            ? {
                gamePhase: "error",
                activeGameId: null,
                gameError: normalized.message,
              }
            : {
                gamePhase: "idle",
                activeGameId: null,
                gameError: null,
                gameProgressLoaded: 0,
                gameProgressTotal: 0,
              },
        );
        throw normalized;
      }
    };

    const deleteRecordFiles = async (id) => {
      const record = records[id];
      if (!record) return;
      const cache = await environment.caches.open(bundledCacheName);
      await Promise.all(
        (record.files || []).map((url) => cache.delete(absoluteUrl(url))),
      );
      delete records[id];
      persistRecords();
    };

    const removeGame = async (id) => {
      setState({
        gamePhase: "removing",
        activeGameId: id,
        gameError: null,
      });
      try {
        const removedRecord = records[id];
        await deleteRecordFiles(id);
        const hasSwfGame = Object.entries(records).some(
          ([recordId, record]) =>
            !recordId.startsWith("__runtime__") && record.type === "swf",
        );
        if (!hasSwfGame) await deleteRecordFiles("__runtime__");
        if (removedRecord?.runtime) {
          const hasRuntimeConsumer = Object.entries(records).some(
            ([recordId, record]) =>
              !recordId.startsWith("__runtime__") &&
              record.runtime === removedRecord.runtime,
          );
          if (!hasRuntimeConsumer)
            await deleteRecordFiles(`__runtime__:${removedRecord.runtime}`);
        }
        setState({ gamePhase: "idle", activeGameId: null });
        await refreshStorageEstimate();
        return snapshot();
      } catch (error) {
        setState({
          gamePhase: "error",
          activeGameId: null,
          gameError: error.message,
        });
        throw error;
      }
    };

    const downloadAllGames = async () => {
      if (!state.enabled) {
        throw new Error("Enable offline access to download built-in games.");
      }
      const currentManifest = await ensureManifest();
      for (const id of Object.keys(currentManifest.games)) {
        if (records[id]?.revision !== currentManifest.games[id].revision) {
          await downloadGame(id);
        }
      }
      return snapshot();
    };

    const removeAllGames = async () => {
      setState({
        gamePhase: "removing",
        activeGameId: null,
        gameError: null,
      });
      await environment.caches.delete(bundledCacheName);
      for (const id of Object.keys(records)) delete records[id];
      persistRecords();
      setState({ gamePhase: "idle" });
      await refreshStorageEstimate();
      return snapshot();
    };

    // Releases before stable cache keys stored files under /releases/<version>/.
    const removeReleaseScopedFiles = async (cache) => {
      const keys = await cache.keys();
      await Promise.all(
        keys
          .filter((request) =>
            RELEASE_PREFIX.test(new URL(request.url).pathname),
          )
          .map((request) => cache.delete(request).catch(() => {})),
      );
    };

    const syncDownloadedGames = async () => {
      const currentManifest = await ensureManifest();
      const cache = await environment.caches.open(bundledCacheName);
      await removeReleaseScopedFiles(cache);
      const selectedIds = Object.keys(records).filter(
        (key) => !key.startsWith("__runtime__"),
      );
      for (const id of selectedIds) {
        const entry = currentManifest.games[id];
        if (!entry) {
          await deleteRecordFiles(id);
          continue;
        }
        const runtimeEntry = entry.runtime
          ? currentManifest.runtimes?.[entry.runtime]
          : entry.type === "swf"
            ? currentManifest.runtime
            : null;
        const runtimeRecordId = entry.runtime
          ? `__runtime__:${entry.runtime}`
          : "__runtime__";
        // Missing files can only be fetched again while online.
        const online = navigatorObject.onLine !== false;
        if (
          records[id].revision !== entry.revision ||
          (online && !(await hasAllFiles(cache, records[id]))) ||
          (runtimeEntry &&
            (records[runtimeRecordId]?.revision !== runtimeEntry.revision ||
              (online &&
                !(await hasAllFiles(cache, records[runtimeRecordId])))))
        ) {
          await downloadGame(id);
        }
      }
    };

    const checkForUpdates = async ({
      applyAutomatically = false,
      bypassDelay = false,
      reload = false,
    } = {}) => {
      if (!state.enabled) {
        throw new Error("Turn on offline use first.");
      }
      if (checkPromise) return checkPromise;
      checkPromise = (async () => {
        const previousPhase = state.phase;
        setState({ phase: "checking", error: null });
        try {
          const metadata = await fetchVersion();
          if (!state.enabled) {
            throw new Error("Offline access was disabled.");
          }
          const automaticApplicationAllowed =
            applyAutomatically &&
            (state.automaticUpdatesEnabled || bypassDelay);
          rememberVersionMetadata(metadata);
          if (reload) reloadTargetVersion = metadata.version;
          if (reloadTargetVersion && reloadTargetVersion !== metadata.version) {
            reloadTargetVersion = null;
          }
          if (applyTargetVersion && applyTargetVersion !== metadata.version) {
            applyTargetVersion = null;
          }
          const checkedAt = environment.Date.now();
          storage.setItem(LAST_CHECKED_KEY, String(checkedAt));
          const activeWorkerVersion = await requestWorkerVersion(
            registration?.active,
          );
          const updateAvailable =
            metadata.version !== currentVersion ||
            (activeWorkerVersion !== null &&
              activeWorkerVersion !== metadata.version);
          const eligibleAt = updateEligibleAt(metadata);
          const migrateActiveWorker =
            !updateAvailable &&
            activeWorkerVersion === metadata.version &&
            workerNeedsVersionedUrl(registration?.active, metadata.version);
          if (updateAvailable && !bypassDelay && checkedAt < eligibleAt) {
            applyTargetVersion = null;
            if (state.automaticUpdatesEnabled) {
              scheduleAutomaticUpdate(eligibleAt);
            }
            setState({
              phase: state.automaticUpdatesEnabled
                ? "update-pending"
                : "update-available",
              availableVersion: metadata.version,
              availableRevision: metadata.revision,
              lastChecked: checkedAt,
              updateEligibleAt: eligibleAt,
              updateReady: false,
              error: null,
            });
            return snapshot();
          }
          if (
            !updateAvailable ||
            automaticApplicationAllowed ||
            migrateActiveWorker
          ) {
            cancelAutomaticUpdate();
          }
          if (
            updateAvailable &&
            activeWorkerVersion === metadata.version &&
            (await reconcileActiveVersion(metadata.version))
          ) {
            setState({ lastChecked: checkedAt });
            return snapshot();
          }
          if (updateAvailable && !automaticApplicationAllowed) {
            setState({
              phase: "update-available",
              availableVersion: metadata.version,
              availableRevision: metadata.revision,
              lastChecked: checkedAt,
              updateEligibleAt: eligibleAt,
              updateReady: false,
              error: null,
            });
            return snapshot();
          }
          if (
            (automaticApplicationAllowed && updateAvailable) ||
            migrateActiveWorker
          ) {
            applyTargetVersion = metadata.version;
          }
          await registerAndWait(metadata.version);
          let waitingUpdateReady = false;
          if (registration.waiting) {
            waitingUpdateReady = await markWaitingUpdate(
              registration.waiting,
              metadata,
            );
          } else if (registration.installing) {
            trackInstallingWorker(registration.installing, true);
          }
          if (reloadWhenControlled) {
            setState({ lastChecked: checkedAt });
            return snapshot();
          }
          if (
            activeWorkerVersion !== null &&
            activeWorkerVersion !== metadata.version &&
            !registration?.waiting &&
            !registration?.installing
          ) {
            bypassWorkerCdn = true;
            scheduleUpdateRetry();
          }
          if (
            updateAvailable &&
            (await reconcileActiveVersion(metadata.version))
          ) {
            setState({ lastChecked: checkedAt });
            return;
          }
          setState({
            phase: registration?.installing
              ? "updating"
              : updateAvailable
                ? waitingUpdateReady
                  ? "update-ready"
                  : "update-available"
                : "ready",
            availableVersion: updateAvailable ? metadata.version : null,
            availableRevision: updateAvailable ? metadata.revision : null,
            lastChecked: checkedAt,
            updateEligibleAt: updateAvailable ? eligibleAt : null,
            updateReady: updateAvailable && waitingUpdateReady,
            // registerAndWait has just confirmed an active worker, unless a
            // newer one is still installing or waiting behind it.
            workerState: registration?.installing
              ? registration.installing.state
              : registration?.waiting
                ? "waiting"
                : "active",
            error: null,
          });
          if (!registration?.waiting && !registration?.installing) {
            applyTargetVersion = null;
          }
        } catch (error) {
          setState({
            phase: previousPhase === "ready" ? "ready" : "error",
            error: error.message,
            downloadMetadataError: state.downloadBytes === null,
          });
          throw error;
        } finally {
          checkPromise = null;
        }
        return snapshot();
      })();
      return checkPromise;
    };

    const deleteShellCaches = async () => {
      if (!environment.caches) return;
      const names = await environment.caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(cachePrefix))
          .map((name) => environment.caches.delete(name)),
      );
    };

    const applyUpdate = async ({ reload = true } = {}) => {
      if (registration?.waiting) {
        const workerVersion = await requestWorkerVersion(registration.waiting);
        if (
          !state.availableVersion ||
          workerVersion !== state.availableVersion
        ) {
          scheduleUpdateRetry();
          throw new Error("The update isn't ready yet.");
        }
        reloadWhenControlled ||= reload;
        reloadTargetVersion = null;
        setState({ phase: reload ? "applying" : "update-ready", error: null });
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
        return;
      }
      if (state.availableVersion && registration?.active) {
        if (reload) reloadTargetVersion = state.availableVersion;
        if (await reconcileActiveVersion(state.availableVersion)) return;
      }
      throw new Error(
        registration?.installing
          ? "The update is still downloading."
          : "There's no update to install.",
      );
    };

    const repair = async () => {
      if (!state.enabled) {
        throw new Error("Turn on offline use first.");
      }
      if (navigatorObject.onLine === false) {
        throw new Error("You're offline. Connect to repair.");
      }
      reloadTargetVersion = null;
      reloadWhenControlled = false;
      sessionStorage.removeItem?.(ACTIVE_VERSION_RELOAD_KEY);
      setState({ phase: "repairing", error: null });
      const currentRegistration =
        registration ||
        (await navigatorObject.serviceWorker?.getRegistration("/"));
      if (currentRegistration) await currentRegistration.unregister();
      await deleteShellCaches();
      registration = null;
      setState({ phase: "starting", updateReady: false });
      await checkForUpdates({ applyAutomatically: true, bypassDelay: true });
      return snapshot();
    };

    const setOfflineEnabled = async (enabled) => {
      if (typeof enabled !== "boolean") {
        throw new Error("The offline access setting is invalid.");
      }
      storage.setItem(OFFLINE_ENABLED_KEY, String(enabled));
      if (enabled === state.enabled) return snapshot();
      if (enabled) {
        setState({ enabled: true, phase: "starting", error: null });
        return initialize();
      }

      setState({ enabled: false, phase: "disabling", error: null });
      applyTargetVersion = null;
      reloadWhenControlled = false;
      reloadTargetVersion = null;
      cancelAutomaticUpdate();
      cancelUpdateRetry();
      try {
        if (checkPromise) await checkPromise.catch(() => {});
        const currentRegistration =
          registration ||
          (await navigatorObject.serviceWorker?.getRegistration?.("/"));
        if (currentRegistration) await currentRegistration.unregister();
        await deleteShellCaches();
        await environment.caches?.delete(bundledCacheName);
        for (const id of Object.keys(records)) delete records[id];
        persistRecords();
        registration = null;
        manifest = null;
        setState({
          phase: "disabled",
          workerState: "unregistered",
          bundledGames: [],
          updateReady: false,
          availableVersion: null,
          availableRevision: null,
          updateEligibleAt: null,
          gamePhase: "idle",
          error: null,
        });
        await refreshStorageEstimate();
        return snapshot();
      } catch (error) {
        setState({ phase: "disabled", error: error.message });
        throw error;
      }
    };

    const setSavePlayedGamesOffline = (enabled) => {
      if (typeof enabled !== "boolean") {
        throw new Error("The automatic game download setting is invalid.");
      }
      storage.setItem(SAVE_PLAYED_GAMES_KEY, String(enabled));
      setState({ savePlayedGamesOffline: enabled });
      return snapshot();
    };

    const setAutomaticUpdatesEnabled = (enabled) => {
      if (typeof enabled !== "boolean") {
        throw new Error("The automatic update setting is invalid.");
      }
      storage.setItem(AUTOMATIC_UPDATES_KEY, String(enabled));
      setState({ automaticUpdatesEnabled: enabled });
      if (!enabled) {
        applyTargetVersion = null;
        cancelAutomaticUpdate();
        cancelUpdateRetry();
      } else if (state.enabled) {
        void checkForUpdates({ applyAutomatically: true }).catch(() => {});
      }
      return snapshot();
    };

    const setAutomaticUpdateDelay = (delay) => {
      if (delay === null) {
        storage.removeItem(AUTOMATIC_UPDATE_DELAY_KEY);
        setState({ automaticUpdateDelayMs: null });
        return snapshot();
      }
      if (!Number.isInteger(delay) || delay < 0) {
        throw new Error("The automatic update delay is invalid.");
      }
      storage.setItem(AUTOMATIC_UPDATE_DELAY_KEY, String(delay));
      setState({ automaticUpdateDelayMs: delay });
      return snapshot();
    };

    let manualUpdatePromise = null;
    const updateNow = () => {
      if (manualUpdatePromise) return manualUpdatePromise;
      if (
        reloadWhenControlled ||
        (reloadTargetVersion && registration?.installing)
      )
        return Promise.resolve(snapshot());
      const pendingCheck = checkPromise;
      setState({ phase: "checking", error: null });
      manualUpdatePromise = (async () => {
        // A background check must not consume the user's explicit reload request.
        if (pendingCheck) await pendingCheck.catch(() => {});
        return checkForUpdates({
          applyAutomatically: true,
          bypassDelay: true,
          reload: true,
        });
      })().finally(() => {
        manualUpdatePromise = null;
      });
      return manualUpdatePromise;
    };

    const automaticCheck = () => {
      const automaticUpdateIsDue =
        state.updateEligibleAt !== null &&
        environment.Date.now() >= state.updateEligibleAt;
      if (
        !state.enabled ||
        !state.automaticUpdatesEnabled ||
        navigatorObject.onLine === false ||
        (!automaticUpdateIsDue &&
          state.lastChecked &&
          environment.Date.now() - state.lastChecked < checkInterval)
      ) {
        return;
      }
      void checkForUpdates({ applyAutomatically: true }).catch(() => {});
    };

    // Files are named by content and each deploy removes the old ones, so a
    // tab left open across a release can fail to load a file. One check per
    // tab tells a missing file apart from a network problem.
    const reportMissingFile = () => {
      if (state.reloadRequired || missingFileCheck) return;
      missingFileCheck = fetchVersion().then(
        (metadata) => {
          if (metadata.version === currentVersion) return;
          setState({ reloadRequired: true });
          if (state.enabled) {
            void checkForUpdates({ applyAutomatically: true }).catch(() => {});
          }
        },
        () => {
          missingFileCheck = null;
        },
      );
    };

    const sameOrigin = (url) => {
      try {
        return (
          new URL(url, environment.location.href).origin ===
          new URL(environment.location.href).origin
        );
      } catch {
        return false;
      }
    };

    const attachLifecycleListeners = () => {
      if (lifecycleListenersAttached) return;
      lifecycleListenersAttached = true;
      navigatorObject.serviceWorker?.addEventListener("message", (event) => {
        if (event.data?.type === MISSING_FILE_MESSAGE) reportMissingFile();
      });
      // Scripts, styles and images report load failures here.
      environment.addEventListener?.(
        "error",
        (event) => {
          const url = event.target?.src || event.target?.href;
          if (typeof url === "string" && url && sameOrigin(url)) {
            reportMissingFile();
          }
        },
        true,
      );
      environment.addEventListener?.("unhandledrejection", (event) => {
        if (MODULE_LOAD_FAILURE.test(String(event.reason?.message))) {
          reportMissingFile();
        }
      });
      navigatorObject.serviceWorker?.addEventListener(
        "controllerchange",
        () => {
          if (reloadWhenControlled) {
            reloadWhenControlled = false;
            environment.location.reload();
          }
        },
      );
      environment.addEventListener?.("online", () => {
        setState({ online: true });
        automaticCheck();
      });
      environment.addEventListener?.("offline", () => {
        setState({ online: false });
      });
      environment.document?.addEventListener("visibilitychange", () => {
        if (environment.document.visibilityState === "visible")
          automaticCheck();
      });
    };

    const initialize = async () => {
      attachLifecycleListeners();
      await refreshStorageEstimate();
      if (!state.enabled) {
        const existingRegistration =
          await navigatorObject.serviceWorker?.getRegistration?.("/");
        if (existingRegistration) await existingRegistration.unregister();
        await deleteShellCaches();
        await environment.caches?.delete(bundledCacheName);
        for (const id of Object.keys(records)) delete records[id];
        persistRecords();
        registration = null;
        manifest = null;
        setState({
          phase: "disabled",
          workerState: "unregistered",
          bundledGames: [],
          error: null,
        });
        return snapshot();
      }
      try {
        const existingRegistration =
          await navigatorObject.serviceWorker?.getRegistration?.("/");
        if (state.automaticUpdatesEnabled) {
          if (existingRegistration) trackRegistration(existingRegistration);
          try {
            await checkForUpdates({ applyAutomatically: true });
          } catch (error) {
            if (!existingRegistration) throw error;
            setState({ phase: "ready", workerState: "active", error: null });
          }
        } else if (
          existingRegistration?.active &&
          (await requestWorkerVersion(existingRegistration.active)) ===
            currentVersion &&
          workerNeedsVersionedUrl(existingRegistration.active, currentVersion)
        ) {
          applyTargetVersion = currentVersion;
          await registerAndWait(currentVersion, false);
          if (registration.waiting) {
            await markWaitingUpdate(registration.waiting);
          } else if (registration.installing) {
            trackInstallingWorker(registration.installing, true);
          }
        } else if (!existingRegistration) {
          await registerAndWait(currentVersion);
        } else {
          trackRegistration(existingRegistration, false);
          setState({ phase: "ready", workerState: "active", error: null });
        }
        await loadGameManifest();
        const knownVersion = storage.getItem(DOWNLOAD_VERSION_KEY);
        if (
          knownVersion &&
          knownVersion !== currentVersion &&
          (await reconcileActiveVersion(knownVersion))
        ) {
          return snapshot();
        }
        void syncDownloadedGames().catch((error) => {
          setState({ gamePhase: "error", gameError: error.message });
        });
      } catch (error) {
        setState({ phase: "error", error: error.message });
      }
      return snapshot();
    };

    return {
      applyUpdate,
      checkForUpdates,
      downloadAllGames,
      downloadGame,
      getSnapshot: snapshot,
      initialize,
      refreshStorageEstimate,
      removeAllGames,
      reportMissingFile,
      removeGame,
      repair,
      setAutomaticUpdatesEnabled,
      setAutomaticUpdateDelay,
      setOfflineEnabled,
      setSavePlayedGamesOffline,
      subscribe,
      updateNow,
    };
  };

  return {
    BUNDLED_GAME_CACHE,
    createManager,
    validateGameManifest,
    waitForWorker,
  };
});
