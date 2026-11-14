"use strict";

// Moves browser storage from the old flash.4st.li origin to xp.4st.li. The old
// domain's top-level page reads everything and streams it into a hidden
// xp.4st.li frame. Both hosts are on the same site, so Chrome and Firefox
// don't partition the frame. Safari does, so there the user opens a popup
// instead. Imports only fill gaps: they never replace data the new origin
// already has.
(function exposeDomainMove(root, factory) {
  const domainMove = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = domainMove;
  } else {
    root.AstroDomainMove = domainMove;
  }
})(globalThis, () => {
  const MOVED_KEY = "astroXpMoved";
  const IMPORTED_KEY = "astroXpImported";
  // Workbox shell caches belong to one release and rebuild themselves.
  const SHELL_CACHE_PREFIX = "astro-flash-";
  const RECORD_BATCH = 50;
  const READY_TYPE = "astro-xp-import-ready";
  const START_TYPE = "astro-xp-import-start";

  const renameLegacy = (name) =>
    name
      .replace(/^astroFlash/, "astroXp")
      .replaceAll("astro-flash", "astro-xp");

  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const transactionDone = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      // The error of a request comes to the transaction before the
      // transaction has an error of its own. The request has it.
      transaction.onerror = (event) => reject(event.target.error);
      transaction.onabort = () => reject(transaction.error);
    });

  const listDatabases = async (env) =>
    (await env.indexedDB.databases()).map(({ name }) => name);

  const storeSchema = (store) => ({
    name: store.name,
    keyPath: store.keyPath,
    autoIncrement: store.autoIncrement,
    indexes: [...store.indexNames].map((name) => {
      const index = store.index(name);
      return {
        name,
        keyPath: index.keyPath,
        unique: index.unique,
        multiEntry: index.multiEntry,
      };
    }),
  });

  async function* readDatabase(env, name) {
    const database = await requestResult(env.indexedDB.open(name));
    try {
      const storeNames = [...database.objectStoreNames];
      let stores = [];
      // A transaction needs at least one store.
      if (storeNames.length) {
        const transaction = database.transaction(storeNames, "readonly");
        stores = storeNames.map((store) =>
          storeSchema(transaction.objectStore(store)),
        );
      }
      yield {
        kind: "database",
        name: renameLegacy(name),
        version: database.version,
        stores,
      };
      for (const store of storeNames) {
        let range = null;
        for (;;) {
          const objectStore = database
            .transaction(store, "readonly")
            .objectStore(store);
          const [keys, values] = await Promise.all([
            requestResult(objectStore.getAllKeys(range, RECORD_BATCH)),
            requestResult(objectStore.getAll(range, RECORD_BATCH)),
          ]);
          if (!keys.length) break;
          yield {
            kind: "records",
            database: renameLegacy(name),
            store,
            keys,
            values,
          };
          range = env.IDBKeyRange.lowerBound(keys.at(-1), true);
        }
      }
    } finally {
      database.close();
    }
  }

  async function* readDirectory(directory, path) {
    for await (const [name, handle] of directory.entries()) {
      const entryPath = [...path, renameLegacy(name)];
      if (handle.kind === "directory") {
        yield* readDirectory(handle, entryPath);
      } else {
        yield { kind: "file", path: entryPath, file: await handle.getFile() };
      }
    }
  }

  const rewriteUrl = (url, fromOrigin, toOrigin) => {
    const parsed = new URL(url);
    return parsed.origin === fromOrigin
      ? `${toOrigin}${parsed.pathname}${parsed.search}`
      : url;
  };

  const cacheNames = async (env) =>
    (await env.caches.keys()).filter(
      (name) => !name.startsWith(SHELL_CACHE_PREFIX),
    );

  async function* readCaches(env, fromOrigin, toOrigin) {
    for (const name of await cacheNames(env)) {
      const cache = await env.caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        // Opaque, partial and bodiless responses can't be stored again as is.
        if (response?.status !== 200) continue;
        yield {
          kind: "cache",
          cache: renameLegacy(name),
          url: rewriteUrl(request.url, fromOrigin, toOrigin),
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers],
          body: await response.blob(),
        };
      }
    }
  }

  const localEntries = (env) => {
    const entries = [];
    for (let index = 0; index < env.localStorage.length; index += 1) {
      const key = env.localStorage.key(index);
      if (key !== MOVED_KEY) {
        entries.push([renameLegacy(key), env.localStorage.getItem(key)]);
      }
    }
    return entries;
  };

  async function* readStorage(env, { fromOrigin, toOrigin }) {
    const entries = localEntries(env);
    if (entries.length) yield { kind: "local", entries };
    for (const name of await listDatabases(env)) {
      yield* readDatabase(env, name);
    }
    yield* readDirectory(await env.navigator.storage.getDirectory(), []);
    yield* readCaches(env, fromOrigin, toOrigin);
  }

  const hasStoredData = async (env) => {
    if (localEntries(env).length) return true;
    if ((await listDatabases(env)).length) return true;
    const root = await env.navigator.storage.getDirectory();
    for await (const _entry of root.keys()) return true;
    return (await cacheNames(env)).length > 0;
  };

  const createImporter = (env) => {
    const databases = new Map();

    const openDatabase = async (name, version, stores = []) => {
      if (databases.has(name)) return databases.get(name);
      const exists = (await listDatabases(env)).includes(name);
      const request = exists
        ? env.indexedDB.open(name)
        : env.indexedDB.open(name, version);
      request.onupgradeneeded = () => {
        for (const store of stores) {
          const objectStore = request.result.createObjectStore(store.name, {
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
          });
          for (const index of store.indexes) {
            objectStore.createIndex(index.name, index.keyPath, {
              unique: index.unique,
              multiEntry: index.multiEntry,
            });
          }
        }
      };
      const database = await requestResult(request);
      databases.set(name, database);
      return database;
    };

    const writeRecords = async ({ database: name, store, keys, values }) => {
      const database = await openDatabase(name);
      if (!database.objectStoreNames.contains(store)) return;
      const transaction = database.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      keys.forEach((key, index) => {
        const counting = objectStore.count(key);
        counting.onsuccess = () => {
          if (counting.result) return;
          if (objectStore.keyPath === null) {
            objectStore.add(values[index], key);
          } else {
            objectStore.add(values[index]);
          }
        };
      });
      await transactionDone(transaction);
    };

    const writeFile = async ({ path, file }) => {
      let directory = await env.navigator.storage.getDirectory();
      for (const name of path.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(name, { create: true });
      }
      const name = path.at(-1);
      try {
        await directory.getFileHandle(name);
        return;
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
    };

    const writeCache = async (item) => {
      const cache = await env.caches.open(item.cache);
      if (await cache.match(item.url)) return;
      await cache.put(
        new env.Request(item.url),
        new env.Response(item.body, {
          status: item.status,
          statusText: item.statusText,
          headers: item.headers,
        }),
      );
    };

    const write = async (item) => {
      if (item.kind === "local") {
        for (const [key, value] of item.entries) {
          if (env.localStorage.getItem(key) === null) {
            env.localStorage.setItem(key, value);
          }
        }
      } else if (item.kind === "database") {
        await openDatabase(item.name, item.version, item.stores);
      } else if (item.kind === "records") {
        await writeRecords(item);
      } else if (item.kind === "file") {
        await writeFile(item);
      } else if (item.kind === "cache") {
        await writeCache(item);
      } else {
        throw new Error(`Unknown storage item: ${item.kind}`);
      }
    };

    const finish = () => {
      for (const database of databases.values()) database.close();
      databases.clear();
      env.localStorage.setItem(IMPORTED_KEY, "1");
    };

    return { write, finish };
  };

  // Runs on xp.4st.li, in the hidden frame or in the popup that replaces it.
  const runImport = async (env, { sourceOrigin }) => {
    const imported = env.localStorage.getItem(IMPORTED_KEY) === "1";
    // Safari gives same-site frames their own IndexedDB, OPFS and caches.
    // Only a top-level window can reach the real ones there.
    const shared = env.document.hasStorageAccess
      ? await env.document.hasStorageAccess()
      : true;
    env.addEventListener("message", (event) => {
      if (event.origin !== sourceOrigin || event.data?.type !== START_TYPE) {
        return;
      }
      const [port] = event.ports;
      const importer = createImporter(env);
      port.onmessage = async ({ data }) => {
        try {
          if (data.type === "finish") importer.finish();
          else await importer.write(data.item);
          port.postMessage({ ok: true });
        } catch (error) {
          port.postMessage({ ok: false, error: String(error) });
        }
      };
    });
    (env.opener ?? env.parent).postMessage(
      { type: READY_TYPE, imported, shared },
      sourceOrigin,
    );
  };

  const waitForReady = (env, getSource, targetOrigin, timeout) =>
    new Promise((resolve, reject) => {
      const timer = env.setTimeout(() => {
        env.removeEventListener("message", onMessage);
        reject(new Error("The new site didn't answer"));
      }, timeout);
      const onMessage = (event) => {
        if (
          event.origin !== targetOrigin ||
          event.source !== getSource() ||
          event.data?.type !== READY_TYPE
        ) {
          return;
        }
        env.clearTimeout(timer);
        env.removeEventListener("message", onMessage);
        resolve(event.data);
      };
      env.addEventListener("message", onMessage);
    });

  const transfer = async (env, target, targetOrigin, onProgress) => {
    const channel = new env.MessageChannel();
    target.postMessage({ type: START_TYPE }, targetOrigin, [channel.port2]);
    const send = (message) =>
      new Promise((resolve) => {
        channel.port1.onmessage = ({ data }) => resolve(data);
        channel.port1.postMessage(message);
      });
    let failures = 0;
    let moved = 0;
    for await (const item of readStorage(env, {
      fromOrigin: env.location.origin,
      toOrigin: targetOrigin,
    })) {
      const reply = await send({ type: "write", item });
      if (reply.ok) moved += 1;
      else {
        failures += 1;
        env.console.error("Couldn't move an item:", reply.error);
      }
      onProgress?.(moved);
    }
    if (failures) throw new Error(`${failures} items didn't move`);
    await send({ type: "finish" });
  };

  // Runs as the old domain's top-level page. Always ends on the new site.
  // `requestWindow` asks the user before opening the popup, since browsers
  // only allow popups from a click. It resolves to null when they decline.
  const runExport = async (
    env,
    {
      targetOrigin,
      importPath = "/api/import",
      timeout = 15_000,
      onProgress,
      requestWindow,
    },
  ) => {
    const destination = `${targetOrigin}${env.location.pathname}${env.location.search}${env.location.hash}`;
    const importUrl = `${targetOrigin}${importPath}`;
    let popup = null;
    try {
      if (
        env.localStorage.getItem(MOVED_KEY) !== "1" &&
        (await hasStoredData(env))
      ) {
        const frame = env.document.createElement("iframe");
        frame.hidden = true;
        frame.src = importUrl;
        const frameReady = waitForReady(
          env,
          () => frame.contentWindow,
          targetOrigin,
          timeout,
        );
        env.document.body.append(frame);
        let target = frame.contentWindow;
        let ready = await frameReady;
        if (!ready.shared) {
          frame.remove();
          popup = await requestWindow(importUrl);
          if (!popup) {
            env.location.replace(destination);
            return;
          }
          ready = await waitForReady(env, () => popup, targetOrigin, timeout);
          target = popup;
        }
        if (!ready.imported) {
          await transfer(env, target, targetOrigin, onProgress);
        }
      }
      env.localStorage.setItem(MOVED_KEY, "1");
    } catch (error) {
      env.console.error("Moving storage to the new site failed:", error);
    }
    popup?.close();
    env.location.replace(destination);
  };

  return {
    MOVED_KEY,
    IMPORTED_KEY,
    createImporter,
    hasStoredData,
    readStorage,
    renameLegacy,
    runExport,
    runImport,
  };
});
