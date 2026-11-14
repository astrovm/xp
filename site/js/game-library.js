"use strict";

(function exposeGameLibrary(root, factory) {
  if (typeof module === "object" && module.exports) {
    require("./storage-policy.js");
  }
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AstroGameLibrary = api;
})(globalThis, function (root) {
  const storagePolicy = root.AstroStoragePolicy;
  const DB_NAME = "astro-installed-games";
  const DB_VERSION = 1;
  const STORE_NAME = "games";
  const CACHE_NAME = "astro-installed-games-v1";
  const DEFAULT_API_BASE = "/api/games";
  const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
  const MAX_LEGACY_ASSET_BYTES = 64 * 1024 * 1024;

  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("Browser storage request failed."));
    });

  const transactionDone = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error || new Error("Browser storage was aborted."));
      // The error of a request comes to the transaction before the
      // transaction has an error of its own. The request has it.
      transaction.onerror = (event) =>
        reject(event.target.error || new Error("Browser storage failed."));
    });

  const openDatabase = (indexedDBObject = root.indexedDB) => {
    if (!indexedDBObject) {
      return Promise.reject(new Error("This browser can't save games."));
    }
    return new Promise((resolve, reject) => {
      const request = indexedDBObject.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error("Can't open game storage."));
    });
  };

  const createMetadataStore = async (indexedDBObject) => {
    const database = await openDatabase(indexedDBObject);
    const run = async (mode, operation) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const result = await operation(store);
      await transactionDone(transaction);
      return result;
    };
    return {
      list: () => run("readonly", (store) => requestResult(store.getAll())),
      get: (id) => run("readonly", (store) => requestResult(store.get(id))),
      put: (record) =>
        run("readwrite", (store) => requestResult(store.put(record))),
      delete: (id) =>
        run("readwrite", (store) => requestResult(store.delete(id))),
      close: () => database.close(),
    };
  };

  const categoryFor = (record) => {
    const tags = Array.isArray(record.tags) ? record.tags : [];
    const preferred = tags.find((tag) =>
      ["Action", "Adventure", "Arcade", "Puzzle", "Racing"].includes(tag),
    );
    return preferred || "Downloaded Games";
  };

  const asGameConfig = (record) => ({
    ...record,
    title: record.title || "Installed Flash Game",
    type: "swf",
    category: categoryFor(record),
    // Native <img> requests cannot use the page-level fetch interceptor that
    // serves installed game files from Cache Storage.
    icon: record.logoUrl || record.iconPath || null,
    url: record.launchPath,
    base: record.basePath,
    installed: true,
  });

  const assetRewriteRules = (uuid, origin) => {
    const prefix = `${origin}/__installed-games/${encodeURIComponent(uuid)}/`;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [
      // Relative URLs already resolve inside this game's synthetic directory.
      [new RegExp(`^${escapedPrefix}`), "$&"],
      [/^https?:\/\/([^/]+)\/(.*)$/i, `${prefix}content/$1/$2`],
    ];
  };

  const readDownload = async (
    response,
    { onProgress, maxBytes = MAX_DOWNLOAD_BYTES } = {},
  ) => {
    if (!response.ok) {
      throw new Error(`Game download failed (${response.status}).`);
    }
    const expected = Number(response.headers.get("content-length")) || null;
    if (expected && expected > maxBytes) {
      throw new Error("This game is too big to download.");
    }
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new Error("This game is too big to download.");
      }
      onProgress?.({ loaded: bytes.byteLength, total: expected });
      return bytes;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > maxBytes) {
        await reader.cancel();
        throw new Error("This game is too big to download.");
      }
      chunks.push(value);
      onProgress?.({ loaded, total: expected });
    }
    const result = new Uint8Array(loaded);
    let offset = 0;
    chunks.forEach((chunk) => {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return result;
  };

  const jsonRequest = async (fetchObject, url, options) => {
    const response = await fetchObject(url, {
      ...options,
      headers: { Accept: "application/json", ...options.headers },
    });
    if (!response.ok) {
      let message = "";
      try {
        message = (await response.json()).error || "";
      } catch {
        // Upstream failure pages are not necessarily JSON.
      }
      throw new Error(
        message || `The game list didn't load (error ${response.status}).`,
      );
    }
    return response.json();
  };

  const unzipInBackground = (bytes, { signal }) =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      let terminate;
      const abort = () => {
        terminate?.();
        reject(
          signal.reason || new DOMException("Download cancelled", "AbortError"),
        );
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        terminate = root.fflate.unzip(bytes, (error, entries) => {
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve(entries);
        });
      } catch (error) {
        signal?.removeEventListener("abort", abort);
        reject(error);
      }
    });

  const createTemporaryArchive = async (
    response,
    {
      signal,
      onProgress,
      maxBytes = MAX_DOWNLOAD_BYTES,
      storageManager = root.navigator?.storage,
    } = {},
  ) => {
    if (!response.ok)
      throw new Error(`Game download failed (${response.status}).`);
    const expected = Number(response.headers.get("Content-Length")) || null;
    if (expected && expected > maxBytes)
      throw new Error("This game is too big to download.");
    if (!storageManager?.getDirectory)
      throw new Error("This browser can't download games.");
    const directory = await storageManager.getDirectory();
    const name = `astro-download-${root.crypto.randomUUID()}.zip`;
    const handle = await directory.getFileHandle(name, { create: true });
    let writable, reader;
    const cleanup = () => directory.removeEntry(name);
    const abort = () => {
      void reader?.cancel(signal.reason).catch(() => {});
    };
    try {
      signal?.throwIfAborted();
      writable = await handle.createWritable();
      if (!response.body) throw new Error("The download was empty. Try again.");
      reader = response.body.getReader();
      signal?.addEventListener("abort", abort, { once: true });
      let received = 0;
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes)
          throw new Error("This game is too big to download.");
        await writable.write(value);
        onProgress?.({ loaded: received, total: expected });
      }
      signal?.throwIfAborted();
      await writable.close();
      writable = null;
      return { blob: await handle.getFile(), cleanup };
    } catch (error) {
      await reader?.cancel(error).catch(() => {});
      await writable?.abort().catch(() => {});
      await cleanup().catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      reader?.releaseLock();
    }
  };

  const createManager = ({
    installer = root.AstroGameInstaller,
    unzipSync = root.fflate?.unzipSync,
    temporaryArchive = root.document ? createTemporaryArchive : null,
    Inflate = root.fflate?.AsyncInflate,
    unzip = root.fflate?.unzip ? unzipInBackground : null,
    fetchObject = root.fetch?.bind(root),
    cachesObject = root.caches,
    indexedDBObject = root.indexedDB,
    storageManager = root.navigator?.storage,
    apiBase = DEFAULT_API_BASE,
    origin = root.location?.origin || "https://astro.local",
    cacheObject = null,
    metadataStore = null,
  } = {}) => {
    if (!installer)
      throw new Error("Can't install games right now. Reload and try again.");
    if (typeof unzip !== "function" && typeof unzipSync !== "function")
      throw new Error("Can't install games right now. Reload and try again.");
    if (typeof fetchObject !== "function")
      throw new Error("Network access is unavailable.");
    if (!cachesObject && !cacheObject)
      throw new Error("This browser can't install games.");

    let cache;
    let store;
    let initialized = false;
    const installed = new Map();
    const listeners = new Set();
    const legacyRequests = new Map();
    const legacyMisses = new Map();

    const notify = () => {
      const snapshot = manager.getGames();
      listeners.forEach((listener) => listener(snapshot));
    };

    const initialize = async () => {
      if (initialized) return manager.getGames();
      [cache, store] = await Promise.all([
        cacheObject || cachesObject.open(CACHE_NAME),
        metadataStore || createMetadataStore(indexedDBObject),
      ]);
      const records = await store.list();
      records.forEach((record) => installed.set(record.id, record));
      initialized = true;
      return manager.getGames();
    };

    const requireReady = () => {
      if (!initialized)
        throw new Error("Still starting. Try again in a moment.");
    };

    const installedAssetKey = (record, archivePath) =>
      `${origin}/__installed-games/${record.uuid}/${archivePath}`;

    const fetchLegacyAssetOnce = async (record, archivePath) => {
      if (!record.legacyFallback) return null;
      let safePath;
      try {
        safePath = installer.safeArchivePath(archivePath);
      } catch {
        return null;
      }
      if (!safePath.startsWith("content/")) return null;
      const key = installedAssetKey(record, safePath);
      const cached = await cache.match(key);
      if (cached) return cached;
      const response = await fetchObject(
        `${apiBase}/${encodeURIComponent(record.uuid)}/asset?path=${encodeURIComponent(safePath)}`,
      );
      if (!response.ok) {
        if (response.status === 404) {
          legacyMisses.set(key, Date.now() + 30_000);
          if (legacyMisses.size > 256)
            legacyMisses.delete(legacyMisses.keys().next().value);
        }
        return null;
      }
      const bytes = await readDownload(response, {
        maxBytes: MAX_LEGACY_ASSET_BYTES,
      });
      const stored = new Response(bytes, {
        status: 200,
        headers: response.headers,
      });
      try {
        await cache.put(key, stored.clone());
      } catch (error) {
        if (!storagePolicy.isQuotaExceeded(error)) throw error;
      }
      return stored;
    };

    const fetchLegacyAsset = async (record, archivePath) => {
      const key = installedAssetKey(record, archivePath);
      if ((legacyMisses.get(key) || 0) > Date.now()) return null;
      let pending = legacyRequests.get(key);
      if (!pending) {
        pending = fetchLegacyAssetOnce(record, archivePath).finally(() =>
          legacyRequests.delete(key),
        );
        legacyRequests.set(key, pending);
      }
      const response = await pending;
      return response?.clone() || null;
    };

    const manager = {
      initialize,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getGames() {
        return Object.fromEntries(
          [...installed.entries()].map(([id, record]) => [
            id,
            asGameConfig(record),
          ]),
        );
      },
      getRecord(id) {
        return installed.get(id) || null;
      },
      async getInstallations() {
        requireReady();
        const keys = await cache.keys();
        const totals = new Map(
          [...installed.values()].map((record) => [record.uuid, 0]),
        );
        for (const key of keys) {
          const url = String(key.url || key);
          for (const record of installed.values()) {
            const prefix = installedAssetKey(record, "");
            if (!url.startsWith(prefix)) continue;
            const response = await cache.match(key);
            if (response) {
              const lengthHeader =
                response.headers?.get("content-length") ?? null;
              const length = Number(lengthHeader);
              const bytes =
                lengthHeader !== null && Number.isFinite(length) && length >= 0
                  ? length
                  : (await response.blob()).size;
              totals.set(record.uuid, (totals.get(record.uuid) || 0) + bytes);
            }
            break;
          }
        }
        return [...installed.values()]
          .map((record) => ({
            id: record.id,
            uuid: record.uuid,
            title: record.title,
            bytes: totals.get(record.uuid) || 0,
          }))
          .sort((left, right) => left.title.localeCompare(right.title));
      },
      async search(query, { signal } = {}) {
        const normalized = String(query || "").trim();
        if (!normalized) return [];
        const url = `${apiBase}?q=${encodeURIComponent(normalized)}`;
        const payload = await jsonRequest(fetchObject, url, { signal });
        return Array.isArray(payload.games) ? payload.games : [];
      },
      async details(uuid, { signal } = {}) {
        return jsonRequest(
          fetchObject,
          `${apiBase}/${encodeURIComponent(uuid)}`,
          { signal },
        );
      },
      async install(record, { onProgress, signal } = {}) {
        requireReady();
        const checked = installer.validateCatalogRecord(record, { origin });
        if (installed.has(`flashpoint:${checked.uuid}`)) {
          return asGameConfig(installed.get(`flashpoint:${checked.uuid}`));
        }
        await storagePolicy.requestPersistence(storageManager);
        const response = await fetchObject(checked.downloadUrl, { signal });
        let archive;
        let metadata;
        try {
          if (temporaryArchive) {
            archive = await temporaryArchive(response, {
              onProgress,
              signal,
              storageManager,
              maxBytes:
                checked.packageType === "legacy"
                  ? MAX_LEGACY_ASSET_BYTES
                  : MAX_DOWNLOAD_BYTES,
            });
            metadata =
              checked.packageType === "legacy"
                ? await installer.installLegacy(checked, archive.blob, {
                    cache,
                    store,
                    origin,
                    signal,
                  })
                : await installer.installStream(checked, archive.blob, {
                    cache,
                    store,
                    origin,
                    signal,
                    Inflate,
                  });
          } else {
            // Injectable byte-array path for non-browser consumers.
            const bytes = await readDownload(response, { onProgress });
            metadata =
              checked.packageType === "legacy"
                ? await installer.installLegacy(checked, bytes, {
                    cache,
                    store,
                    origin,
                    signal,
                  })
                : await installer.install(checked, bytes, {
                    cache,
                    store,
                    unzip: unzip || unzipSync,
                    signal,
                    origin,
                  });
          }
        } catch (error) {
          throw storagePolicy.normalizeError(error);
        } finally {
          await archive
            ?.cleanup()
            .catch((error) =>
              console.error("Could not remove temporary game archive:", error),
            );
        }

        if (checked.logoUrl) {
          let iconPath = null;
          let iconStored = false;
          try {
            const logoResponse = await fetchObject(checked.logoUrl, {
              signal,
            });
            if (logoResponse.ok) {
              iconPath = `${origin}/__installed-games/${checked.uuid}/logo.jpg`;
              await cache.put(iconPath, logoResponse);
              iconStored = true;
              const metadataWithIcon = { ...metadata, iconPath };
              await store.put(metadataWithIcon);
              metadata = metadataWithIcon;
            }
          } catch {
            if (iconStored) await cache.delete(iconPath).catch(() => {});
            // A missing logo should not undo a successfully installed game.
          }
        }
        installed.set(metadata.id, metadata);
        notify();
        return asGameConfig(metadata);
      },
      async uninstall(idOrUuid) {
        requireReady();
        const uuid = String(idOrUuid).replace(/^flashpoint:/, "");
        await installer.uninstall(uuid, { cache, store, origin });
        installed.delete(`flashpoint:${uuid.toLowerCase()}`);
        notify();
      },
      async match(request, { gameId } = {}) {
        requireReady();
        const direct = await cache.match(request);
        if (direct) return direct;
        let requested;
        try {
          requested = new URL(
            request instanceof Request ? request.url : request,
            origin,
          );
        } catch {
          return null;
        }
        if (!/^https?:$/.test(requested.protocol)) return null;

        const syntheticPrefix = "/__installed-games/";
        if (requested.origin === new URL(origin).origin) {
          if (!requested.pathname.startsWith(syntheticPrefix)) return null;
          const remainder = requested.pathname.slice(syntheticPrefix.length);
          const slash = remainder.indexOf("/");
          if (slash < 1) return null;
          const uuid = remainder.slice(0, slash).toLowerCase();
          const record = installed.get(`flashpoint:${uuid}`);
          if (!record) return null;
          let archivePath;
          try {
            archivePath = decodeURIComponent(remainder.slice(slash + 1));
          } catch {
            return null;
          }
          return fetchLegacyAsset(record, archivePath);
        }

        const archivePath = installer.archiveLaunchPath(requested.href);
        const activeRecord = gameId ? installed.get(gameId) : null;
        const candidates = activeRecord
          ? [activeRecord]
          : [...installed.values()].filter((record) => {
              try {
                return (
                  new URL(record.launchCommand).hostname === requested.hostname
                );
              } catch {
                return false;
              }
            });
        // A shared archive host is ambiguous without the requesting game's identity.
        if (candidates.length !== 1) return null;
        const record = candidates[0];
        const cached = await cache.match(
          installedAssetKey(record, archivePath),
        );
        if (cached) return cached;
        return fetchLegacyAsset(record, archivePath);
      },
      async storageEstimate() {
        return storagePolicy.estimate(storageManager);
      },
    };
    return manager;
  };

  return {
    CACHE_NAME,
    DB_NAME,
    STORE_NAME,
    MAX_DOWNLOAD_BYTES,
    MAX_LEGACY_ASSET_BYTES,
    asGameConfig,
    assetRewriteRules,
    readDownload,
    createTemporaryArchive,
    createMetadataStore,
    createManager,
  };
});
