// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { instrumentSource } from "./helpers/coverage";

// The Worker imports this file as text, which claims the module registry
// entry, so the browser script is evaluated directly instead of required.
const movePath = resolve(import.meta.dir, "../worker/domain-move.js");
const moveModule = { exports: {} };
new Function(
  "module",
  instrumentSource(readFileSync(movePath, "utf8"), movePath),
)(moveModule);
const {
  IMPORTED_KEY,
  MOVED_KEY,
  createImporter,
  hasStoredData,
  readStorage,
  renameLegacy,
  runExport,
  runImport,
} = moveModule.exports;

const OLD = "https://flash.example";
const NEW = "https://xp.example";

class MemoryStorage {
  values = new Map();
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

const notFound = () =>
  Object.assign(new Error("Not found"), { name: "NotFoundError" });

class FileHandle {
  kind = "file";
  constructor(name, file = new File([], name)) {
    this.name = name;
    this.file = file;
  }
  async getFile() {
    return this.file;
  }
  async createWritable() {
    const parts = [];
    return {
      write: async (data) => parts.push(data),
      close: async () => {
        this.file = new File(parts, this.name);
      },
    };
  }
}

class DirectoryHandle {
  kind = "directory";
  children = new Map();
  constructor(name = "") {
    this.name = name;
  }
  async *entries() {
    yield* this.children.entries();
  }
  async *keys() {
    yield* this.children.keys();
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.children.has(name)) {
      if (!create) throw notFound();
      this.children.set(name, new DirectoryHandle(name));
    }
    return this.children.get(name);
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.children.has(name)) {
      if (!create) throw notFound();
      this.children.set(name, new FileHandle(name));
    }
    return this.children.get(name);
  }
}

const memoryCaches = () => {
  const stores = new Map();
  const urlOf = (request) =>
    typeof request === "string" ? request : request.url;
  return {
    stores,
    keys: async () => [...stores.keys()],
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
        match: async (request) => entries.get(urlOf(request))?.clone(),
        put: async (request, response) => {
          entries.set(urlOf(request), response);
        },
      };
    },
  };
};

const makeEnv = (origin) => {
  const listeners = new Set();
  const root = new DirectoryHandle();
  const errors = [];
  const env = {
    IDBKeyRange,
    MessageChannel,
    Request,
    Response,
    caches: memoryCaches(),
    console: { error: (...values) => errors.push(values) },
    errors,
    indexedDB: new IDBFactory(),
    localStorage: new MemoryStorage(),
    navigator: { storage: { getDirectory: async () => root } },
    document: {},
    opfs: root,
    addEventListener: (type, listener) => listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
    dispatch: (event) => [...listeners].forEach((listener) => listener(event)),
    listeners,
    setTimeout,
    clearTimeout,
  };
  env.location = new URL(`${origin}/`);
  return env;
};

const request = (value) =>
  new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });

const createDatabase = (env, name, version, upgrade) => {
  const opening = env.indexedDB.open(name, version);
  opening.onupgradeneeded = () => upgrade(opening.result);
  return request(opening);
};

const putRecords = async (database, store, records) => {
  const transaction = database.transaction(store, "readwrite");
  for (const [key, value] of records) {
    if (key === undefined) transaction.objectStore(store).put(value);
    else transaction.objectStore(store).put(value, key);
  }
  await new Promise((resolve) => (transaction.oncomplete = resolve));
};

const readAll = async (env, name, store) => {
  const database = await request(env.indexedDB.open(name));
  const transaction = database.transaction(store, "readonly");
  const [keys, values] = await Promise.all([
    request(transaction.objectStore(store).getAllKeys()),
    request(transaction.objectStore(store).getAll()),
  ]);
  database.close();
  return keys.map((key, index) => [key, values[index]]);
};

const collect = async (env) => {
  const items = [];
  for await (const item of readStorage(env, {
    fromOrigin: OLD,
    toOrigin: NEW,
  })) {
    items.push(item);
  }
  return items;
};

const transfer = async (from, to) => {
  const importer = createImporter(to);
  for (const item of await collect(from)) await importer.write(item);
  importer.finish();
};

const seedOldOrigin = async (env) => {
  env.localStorage.setItem("astroFlashOfflineEnabled", "true");
  env.localStorage.setItem("displaySettings", '{"theme":"luna"}');
  env.localStorage.setItem("astro-flash.scummvm.dott.iso.v1", "{}");
  const documents = await createDatabase(env, "astro-documents", 1, (db) => {
    const store = db.createObjectStore("files", { keyPath: "path" });
    store.createIndex("byFolder", "folder", { unique: false });
    db.createObjectStore("log", { autoIncrement: true }).createIndex(
      "byId",
      "id",
      { unique: true, multiEntry: true },
    );
  });
  await putRecords(
    documents,
    "files",
    Array.from({ length: 120 }, (_, index) => [
      undefined,
      { path: `/doc-${String(index).padStart(3, "0")}`, folder: "/" },
    ]),
  );
  documents.close();
  const saves = await createDatabase(env, "/saves", 21, (db) => {
    db.createObjectStore("FILE_DATA");
  });
  await putRecords(saves, "FILE_DATA", [
    ["/saves/slot1", { contents: new Uint8Array([1, 2, 3]) }],
  ]);
  saves.close();
  (await createDatabase(env, "empty", 1, () => {})).close();

  const games = await env.opfs.getDirectoryHandle("astro-flash-revcdos", {
    create: true,
  });
  const data = await games.getDirectoryHandle("data", { create: true });
  const file = await data.getFileHandle("gta-vc.img", { create: true });
  const writable = await file.createWritable();
  await writable.write("game data");
  await writable.close();

  const bundled = await env.caches.open("astro-bundled-games-v1");
  await bundled.put(
    new Request(`${OLD}/swf/sonic/main.swf`),
    new Response("swf", { headers: { "Content-Type": "application/x" } }),
  );
  await bundled.put(
    new Request("https://cdn.example/zip?id=1"),
    new Response("zip"),
  );
  await bundled.put(
    new Request(`${OLD}/missing`),
    new Response(null, { status: 404 }),
  );
  const shell = await env.caches.open("astro-flash-precache-v2-x");
  await shell.put(new Request(`${OLD}/index.html`), new Response("old"));
};

test("pages get the script as a global", () => {
  new Function(
    "module",
    instrumentSource(readFileSync(movePath, "utf8"), movePath),
  )(undefined);
  expect(Object.keys(globalThis.AstroDomainMove)).toEqual(
    Object.keys(moveModule.exports),
  );
  delete globalThis.AstroDomainMove;
});

describe("legacy names", () => {
  test("maps old storage names to the new ones", () => {
    expect(renameLegacy("astroFlashOfflineEnabled")).toBe(
      "astroXpOfflineEnabled",
    );
    expect(renameLegacy("astro-flash-revcdos")).toBe("astro-xp-revcdos");
    expect(renameLegacy("astro-flash.scummvm.astro-flash.v1")).toBe(
      "astro-xp.scummvm.astro-xp.v1",
    );
    expect(renameLegacy("myAstroFlash")).toBe("myAstroFlash");
    expect(renameLegacy("displaySettings")).toBe("displaySettings");
  });
});

describe("storage copy", () => {
  test("copies every kind of storage under the new names", async () => {
    const from = makeEnv(OLD);
    const to = makeEnv(NEW);
    await seedOldOrigin(from);
    from.localStorage.setItem(MOVED_KEY, "0");

    await transfer(from, to);

    expect(Object.fromEntries(to.localStorage.values)).toEqual({
      astroXpOfflineEnabled: "true",
      displaySettings: '{"theme":"luna"}',
      "astro-xp.scummvm.dott.iso.v1": "{}",
      [IMPORTED_KEY]: "1",
    });
    const documents = await readAll(to, "astro-documents", "files");
    expect(documents).toHaveLength(120);
    expect(documents[119]).toEqual([
      "/doc-119",
      { path: "/doc-119", folder: "/" },
    ]);
    const database = await request(to.indexedDB.open("astro-documents"));
    const store = database.transaction("files").objectStore("files");
    expect(store.keyPath).toBe("path");
    expect(store.index("byFolder").keyPath).toBe("folder");
    expect(database.version).toBe(1);
    const log = database.transaction("log").objectStore("log");
    expect(log.autoIncrement).toBe(true);
    expect(log.index("byId").unique).toBe(true);
    expect(log.index("byId").multiEntry).toBe(true);
    expect(store.autoIncrement).toBe(false);
    database.close();
    // Every connection is closed on both sides, so nothing blocks upgrades.
    for (const env of [from, to]) {
      const deleting = env.indexedDB.deleteDatabase("astro-documents");
      let blocked = false;
      deleting.onblocked = () => (blocked = true);
      await request(deleting);
      expect(blocked).toBe(false);
    }
    expect(await readAll(to, "/saves", "FILE_DATA")).toEqual([
      ["/saves/slot1", { contents: new Uint8Array([1, 2, 3]) }],
    ]);
    const empty = await request(to.indexedDB.open("empty"));
    expect([...empty.objectStoreNames]).toEqual([]);
    empty.close();

    const revcdos = await to.opfs.getDirectoryHandle("astro-xp-revcdos");
    const data = await revcdos.getDirectoryHandle("data");
    const file = await (await data.getFileHandle("gta-vc.img")).getFile();
    expect(await file.text()).toBe("game data");

    expect([...to.caches.stores.keys()]).toEqual(["astro-bundled-games-v1"]);
    const bundled = to.caches.stores.get("astro-bundled-games-v1");
    expect([...bundled.keys()]).toEqual([
      `${NEW}/swf/sonic/main.swf`,
      "https://cdn.example/zip?id=1",
    ]);
    const swf = bundled.get(`${NEW}/swf/sonic/main.swf`);
    expect(await swf.text()).toBe("swf");
    expect(swf.headers.get("Content-Type")).toBe("application/x");
  });

  test("reads records in small batches", async () => {
    const from = makeEnv(OLD);
    await seedOldOrigin(from);
    const batches = (await collect(from))
      .filter((item) => item.kind === "records" && item.store === "files")
      .map((item) => item.keys.length);
    expect(batches).toEqual([50, 50, 20]);
  });

  test("never replaces data the new site already has", async () => {
    const from = makeEnv(OLD);
    const to = makeEnv(NEW);
    await seedOldOrigin(from);
    to.localStorage.setItem("displaySettings", "new");
    const documents = await createDatabase(to, "astro-documents", 1, (db) =>
      db.createObjectStore("files", { keyPath: "path" }),
    );
    await putRecords(documents, "files", [
      [undefined, { path: "/doc-000", folder: "/new" }],
    ]);
    documents.close();
    const saves = await createDatabase(to, "/saves", 3, (db) =>
      db.createObjectStore("OTHER"),
    );
    saves.close();
    const revcdos = await to.opfs.getDirectoryHandle("astro-xp-revcdos", {
      create: true,
    });
    const data = await revcdos.getDirectoryHandle("data", { create: true });
    const writable = await (
      await data.getFileHandle("gta-vc.img", { create: true })
    ).createWritable();
    await writable.write("new data");
    await writable.close();
    const bundled = await to.caches.open("astro-bundled-games-v1");
    await bundled.put(
      new Request(`${NEW}/swf/sonic/main.swf`),
      new Response("new swf"),
    );

    await transfer(from, to);

    expect(to.localStorage.getItem("displaySettings")).toBe("new");
    expect(to.localStorage.getItem("astroXpOfflineEnabled")).toBe("true");
    const copied = await readAll(to, "astro-documents", "files");
    expect(copied).toHaveLength(120);
    expect(copied[0][1].folder).toBe("/new");
    expect(copied[1][1].folder).toBe("/");
    // The new site already owns this database, so missing stores stay out.
    expect(await readAll(to, "/saves", "OTHER")).toEqual([]);
    const existing = await request(to.indexedDB.open("/saves"));
    expect(existing.version).toBe(3);
    expect([...existing.objectStoreNames]).toEqual(["OTHER"]);
    existing.close();
    const file = await (await data.getFileHandle("gta-vc.img")).getFile();
    expect(await file.text()).toBe("new data");
    expect(
      await to.caches.stores
        .get("astro-bundled-games-v1")
        .get(`${NEW}/swf/sonic/main.swf`)
        .text(),
    ).toBe("new swf");
  });

  test("skips cache entries that disappear while reading", async () => {
    const from = makeEnv(OLD);
    from.caches = {
      keys: async () => ["astro-installed-games-v1"],
      open: async () => ({
        keys: async () => [new Request(`${OLD}/gone`)],
        match: async () => undefined,
      }),
    };
    expect(await collect(from)).toEqual([]);
  });

  test("records into a database it never saw land in an empty one", async () => {
    const to = makeEnv(NEW);
    const importer = createImporter(to);
    await importer.write({
      kind: "records",
      database: "unknown",
      store: "files",
      keys: [1],
      values: ["one"],
    });
    importer.finish();
    const database = await request(to.indexedDB.open("unknown"));
    expect([...database.objectStoreNames]).toEqual([]);
    database.close();
  });

  test("rejects unknown items and failed writes", async () => {
    const to = makeEnv(NEW);
    const importer = createImporter(to);
    await expect(importer.write({ kind: "mystery" })).rejects.toThrow(
      "Unknown storage item: mystery",
    );
    const database = await createDatabase(to, "unique", 1, (db) =>
      db
        .createObjectStore("items", { keyPath: "id" })
        .createIndex("name", "name", { unique: true }),
    );
    await putRecords(database, "items", [[undefined, { id: 1, name: "a" }]]);
    database.close();
    await expect(
      importer.write({
        kind: "records",
        database: "unique",
        store: "items",
        keys: [2],
        values: [{ id: 2, name: "a" }],
      }),
    ).rejects.toMatchObject({ name: "ConstraintError" });
    to.opfs.getDirectoryHandle = async () => {
      throw new Error("Storage is locked");
    };
    await expect(
      importer.write({
        kind: "file",
        path: ["a", "b"],
        file: new File([], "b"),
      }),
    ).rejects.toThrow("Storage is locked");
    const getFileHandle = to.opfs.getFileHandle.bind(to.opfs);
    to.opfs.getFileHandle = async (name, options) => {
      if (!options) throw new Error("Storage is broken");
      return getFileHandle(name, options);
    };
    await expect(
      importer.write({ kind: "file", path: ["b"], file: new File([], "b") }),
    ).rejects.toThrow("Storage is broken");
  });

  test("a failed read rejects the database copy", async () => {
    const from = makeEnv(OLD);
    from.indexedDB.databases = async () => [{ name: "broken" }];
    from.indexedDB.open = () => {
      const opening = {};
      queueMicrotask(() => {
        opening.error = new Error("Blocked");
        opening.onerror();
      });
      return opening;
    };
    await expect(collect(from)).rejects.toThrow("Blocked");
  });

  test("reports whether there is anything to move", async () => {
    const env = makeEnv(OLD);
    expect(await hasStoredData(env)).toBe(false);
    env.localStorage.setItem(MOVED_KEY, "1");
    expect(await hasStoredData(env)).toBe(false);

    const shell = await env.caches.open("astro-flash-precache-v2-x");
    await shell.put(new Request(`${OLD}/`), new Response("old"));
    expect(await hasStoredData(env)).toBe(false);
    await env.caches.open("astro-bundled-games-v1");
    expect(await hasStoredData(env)).toBe(true);

    const files = makeEnv(OLD);
    await files.opfs.getDirectoryHandle("astro-flash-revcdos", {
      create: true,
    });
    expect(await hasStoredData(files)).toBe(true);

    const databases = makeEnv(OLD);
    (await createDatabase(databases, "empty", 1, () => {})).close();
    expect(await hasStoredData(databases)).toBe(true);

    const local = makeEnv(OLD);
    local.localStorage.setItem("startupSeen", "1");
    expect(await hasStoredData(local)).toBe(true);
  });
});

// Connects an exporting page to an importing frame the way the browser does:
// window messages carry an origin, and the frame answers its parent.
const connectFrame = (from, to) => {
  const frame = {
    contentWindow: { postMessage: () => {} },
    remove: () => (frame.removed = true),
  };
  from.document = {
    createElement: () => frame,
    body: {
      append: (element) => {
        to.parent = {
          postMessage: (data, targetOrigin) => {
            if (targetOrigin !== OLD) return;
            from.dispatch({ data, origin: NEW, source: frame.contentWindow });
          },
        };
        element.contentWindow.postMessage = (data, targetOrigin, ports) => {
          if (targetOrigin !== NEW) return;
          to.dispatch({ data, origin: OLD, ports });
        };
        runImport(to, { sourceOrigin: OLD });
      },
    },
  };
  return frame;
};

// A popup answers through `opener` instead of `parent`.
const openPopup = (from, to, { answer = true } = {}) => {
  const popup = {
    postMessage: (data, targetOrigin, ports) => {
      if (targetOrigin !== NEW) return;
      to.dispatch({ data, origin: OLD, ports });
    },
    close: () => (popup.closed = true),
  };
  to.opener = {
    postMessage: (data, targetOrigin) => {
      if (targetOrigin !== OLD) return;
      from.dispatch({ data, origin: NEW, source: popup });
    },
  };
  if (answer) setTimeout(() => runImport(to, { sourceOrigin: OLD }));
  return popup;
};

const partitioned = () => {
  const env = makeEnv(NEW);
  env.document = { hasStorageAccess: async () => false };
  return env;
};

const exportEnv = (path = "/play/sonic?full=1#start") => {
  const env = makeEnv(OLD);
  const url = new URL(`${OLD}${path}`);
  let replaced = null;
  env.location = {
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    replace: (target) => {
      replaced = target;
    },
  };
  env.replaced = () => replaced;
  return env;
};

describe("moving between domains", () => {
  test("moves everything, then opens the same page on the new site", async () => {
    const from = exportEnv();
    const to = makeEnv(NEW);
    await seedOldOrigin(from);
    const frame = connectFrame(from, to);
    const progress = [];

    await runExport(from, {
      targetOrigin: NEW,
      onProgress: (count) => progress.push(count),
    });

    expect(frame.src).toBe(`${NEW}/api/import`);
    expect(frame.hidden).toBe(true);
    expect(from.replaced()).toBe(`${NEW}/play/sonic?full=1#start`);
    expect(from.localStorage.getItem(MOVED_KEY)).toBe("1");
    expect(to.localStorage.getItem(IMPORTED_KEY)).toBe("1");
    expect(to.localStorage.getItem("astroXpOfflineEnabled")).toBe("true");
    expect(await readAll(to, "astro-documents", "files")).toHaveLength(120);
    expect(progress.at(-1)).toBe(progress.length);
    expect(from.errors).toEqual([]);
    expect(from.listeners.size).toBe(0);
  });

  test("moves only once", async () => {
    const from = exportEnv("/");
    await seedOldOrigin(from);
    from.localStorage.setItem(MOVED_KEY, "1");
    from.document = {
      createElement: () => {
        throw new Error("No frame expected");
      },
    };
    await runExport(from, { targetOrigin: NEW });
    expect(from.replaced()).toBe(`${NEW}/`);
    expect(from.errors).toEqual([]);
  });

  test("skips the frame when there is nothing to move", async () => {
    const from = exportEnv("/");
    from.document = {
      createElement: () => {
        throw new Error("No frame expected");
      },
    };
    await runExport(from, { targetOrigin: NEW });
    expect(from.replaced()).toBe(`${NEW}/`);
    expect(from.localStorage.getItem(MOVED_KEY)).toBe("1");
  });

  test("leaves the new site alone after it imported once", async () => {
    const from = exportEnv("/");
    const to = makeEnv(NEW);
    await seedOldOrigin(from);
    to.localStorage.setItem(IMPORTED_KEY, "1");
    connectFrame(from, to);
    await runExport(from, { targetOrigin: NEW });
    expect(from.replaced()).toBe(`${NEW}/`);
    expect(from.localStorage.getItem(MOVED_KEY)).toBe("1");
    expect(to.localStorage.getItem("displaySettings")).toBeNull();
  });

  test("still opens the new site when it doesn't answer", async () => {
    const from = exportEnv("/");
    await seedOldOrigin(from);
    const frame = { contentWindow: {} };
    from.document = {
      createElement: () => frame,
      body: {
        append: () => {
          // Messages from anywhere else are ignored.
          from.dispatch({
            data: { type: "astro-xp-import-ready" },
            origin: "https://evil.example",
            source: frame.contentWindow,
          });
          from.dispatch({
            data: { type: "astro-xp-import-ready" },
            origin: NEW,
            source: {},
          });
          from.dispatch({
            data: null,
            origin: NEW,
            source: frame.contentWindow,
          });
        },
      },
    };
    await runExport(from, { targetOrigin: NEW, timeout: 10 });
    expect(from.replaced()).toBe(`${NEW}/`);
    expect(from.localStorage.getItem(MOVED_KEY)).toBeNull();
    expect(from.listeners.size).toBe(0);
    expect(String(from.errors[0][1])).toContain("didn't answer");
  });

  test("retries next time when some items fail", async () => {
    const from = exportEnv("/");
    const to = makeEnv(NEW);
    await seedOldOrigin(from);
    to.caches.open = async () => {
      throw new Error("Quota exceeded");
    };
    connectFrame(from, to);
    await runExport(from, { targetOrigin: NEW });
    expect(from.replaced()).toBe(`${NEW}/`);
    expect(from.localStorage.getItem(MOVED_KEY)).toBeNull();
    expect(to.localStorage.getItem(IMPORTED_KEY)).toBeNull();
    expect(to.localStorage.getItem("astroXpOfflineEnabled")).toBe("true");
    expect(from.errors.map((error) => error[0])).toEqual([
      "Couldn't move an item:",
      "Couldn't move an item:",
      "Moving storage to the new site failed:",
    ]);
    expect(from.errors[0][1]).toBe("Error: Quota exceeded");
    expect(String(from.errors[2][1])).toContain("2 items didn't move");
  });

  test("moves through a popup when the frame's storage is separate", async () => {
    const from = exportEnv();
    const frameEnv = partitioned();
    const to = makeEnv(NEW);
    to.document = { hasStorageAccess: async () => true };
    await seedOldOrigin(from);
    const frame = connectFrame(from, frameEnv);
    let popup;
    const requested = [];

    await runExport(from, {
      targetOrigin: NEW,
      requestWindow: async (url) => {
        requested.push(url);
        popup = openPopup(from, to);
        return popup;
      },
    });

    expect(requested).toEqual([`${NEW}/api/import`]);
    expect(frame.removed).toBe(true);
    expect(popup.closed).toBe(true);
    expect(from.replaced()).toBe(`${NEW}/play/sonic?full=1#start`);
    expect(from.localStorage.getItem(MOVED_KEY)).toBe("1");
    expect(to.localStorage.getItem(IMPORTED_KEY)).toBe("1");
    expect(await readAll(to, "astro-documents", "files")).toHaveLength(120);
    // Nothing lands in the frame's separate storage.
    expect(frameEnv.localStorage.length).toBe(0);
    expect(await frameEnv.indexedDB.databases()).toEqual([]);
    expect(from.errors).toEqual([]);
    expect(from.listeners.size).toBe(0);
  });

  test("Not now opens the new site and asks again next time", async () => {
    const from = exportEnv("/");
    await seedOldOrigin(from);
    connectFrame(from, partitioned());
    await runExport(from, {
      targetOrigin: NEW,
      requestWindow: async () => null,
    });
    expect(from.replaced()).toBe(`${NEW}/`);
    expect(from.localStorage.getItem(MOVED_KEY)).toBeNull();
    expect(from.errors).toEqual([]);
  });

  test("closes a popup that never answers", async () => {
    const from = exportEnv("/");
    await seedOldOrigin(from);
    connectFrame(from, partitioned());
    let popup;
    await runExport(from, {
      targetOrigin: NEW,
      timeout: 10,
      requestWindow: async () =>
        (popup = openPopup(from, makeEnv(NEW), { answer: false })),
    });
    expect(popup.closed).toBe(true);
    expect(from.replaced()).toBe(`${NEW}/`);
    expect(from.localStorage.getItem(MOVED_KEY)).toBeNull();
    expect(String(from.errors[0][1])).toContain("didn't answer");
  });

  test("a popup answers its opener", async () => {
    const to = makeEnv(NEW);
    const sent = [];
    to.opener = { postMessage: (...args) => sent.push(args) };
    to.parent = {
      postMessage: () => {
        throw new Error("Popups have no parent frame");
      },
    };
    to.localStorage.setItem(IMPORTED_KEY, "1");
    to.document = { hasStorageAccess: async () => true };
    await runImport(to, { sourceOrigin: OLD });
    expect(sent).toEqual([
      [{ type: "astro-xp-import-ready", imported: true, shared: true }, OLD],
    ]);
  });

  test("the import frame only listens to the old domain", async () => {
    const to = makeEnv(NEW);
    const sent = [];
    to.parent = { postMessage: (...args) => sent.push(args) };
    await runImport(to, { sourceOrigin: OLD });
    expect(sent).toEqual([
      [{ type: "astro-xp-import-ready", imported: false, shared: true }, OLD],
    ]);
    const channel = new MessageChannel();
    let replies = 0;
    channel.port1.onmessage = () => (replies += 1);
    to.dispatch({
      data: { type: "astro-xp-import-start" },
      origin: "https://evil.example",
      ports: [channel.port2],
    });
    to.dispatch({ data: { type: "other" }, origin: OLD, ports: [] });
    to.dispatch({ data: null, origin: OLD, ports: [] });
    channel.port1.postMessage({
      type: "write",
      item: { kind: "local", entries: [["a", "b"]] },
    });
    await Bun.sleep(10);
    expect(replies).toBe(0);
    expect(to.localStorage.getItem("a")).toBeNull();
    channel.port1.close();
  });

  test("reports write errors", async () => {
    const to = makeEnv(NEW);
    to.parent = { postMessage: () => {} };
    await runImport(to, { sourceOrigin: OLD });
    const channel = new MessageChannel();
    const replies = [];
    channel.port1.onmessage = ({ data }) => replies.push(data);
    to.dispatch({
      data: { type: "astro-xp-import-start" },
      origin: OLD,
      ports: [channel.port2],
    });
    channel.port1.postMessage({ type: "write", item: null });
    await Bun.sleep(10);
    expect(replies).toHaveLength(1);
    expect(replies[0].ok).toBe(false);
    expect(replies[0].error).toContain("TypeError");
    channel.port1.close();
  });
});
