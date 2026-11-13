// @ts-nocheck -- Isolated browser globals exercise the actual IndexedDB backend.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { IDBFactory } from "fake-indexeddb";
import { fileURLToPath } from "node:url";
import { instrumentSource } from "./helpers/coverage";

const sourcePath = fileURLToPath(
  new URL("../site/js/filesystem.js", import.meta.url),
);
const source = instrumentSource(readFileSync(sourcePath, "utf8"), sourcePath);
const operationsPath = fileURLToPath(
  new URL("../site/js/file-operations.js", import.meta.url),
);
const operationsSource = instrumentSource(
  readFileSync(operationsPath, "utf8"),
  operationsPath,
);
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
const tab = (indexedDB, localStorage, globals = {}) => {
  const context = createContext({
    __coverage__: globalThis.__coverage__,
    indexedDB,
    localStorage,
    document: {},
    console,
    ...globals,
  });
  runInContext(source, context);
  return context.VirtualFS;
};
// A tab with the file operations service, like the shell loads it.
const tabWithOperations = (indexedDB, localStorage) => {
  const context = createContext({
    __coverage__: globalThis.__coverage__,
    indexedDB,
    localStorage,
    document: {},
    console,
  });
  runInContext(source, context);
  runInContext(operationsSource, context);
  return { fs: context.VirtualFS, operations: context.FileOperations };
};
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

describe("filesystem persistence", () => {
  test("migrates existing documents once and saves individual records without writing localStorage", async () => {
    const localStorage = storage();
    const oldContext = createContext({
      localStorage,
      console,
      __coverage__: globalThis.__coverage__,
    });
    runInContext(source, oldContext);
    const old = oldContext.VirtualFS;
    const legacy = old.createFile(old.MY_DOCUMENTS, "existing.txt", {
      content: "old document",
    });
    const indexedDB = new IDBFactory();
    const first = tab(indexedDB, localStorage);
    await first.ready;
    expect(first.getContent(legacy.id)).toBe("old document");
    localStorage.setItem = () => {
      throw new Error("localStorage writes must not happen");
    };
    await first.setContent(legacy.id, "new document");
    first.close();
    const reopened = tab(indexedDB, localStorage);
    await reopened.ready;
    expect(reopened.getContent(legacy.id)).toBe("new document");
    const db = await request(indexedDB.open("astro-documents", 1));
    const records = await request(
      db.transaction("nodes").objectStore("nodes").getAll(),
    );
    expect(records.find((node) => node.id === legacy.id).revision).toBe(2);
    expect(records.find((node) => node.id === old.DRIVE_C).revision).toBe(1);
    reopened.close();
    db.close();
  });

  test("rejects stale writes from concurrent tabs without losing either tab's files", async () => {
    const indexedDB = new IDBFactory(),
      localStorage = storage();
    const a = tab(indexedDB, localStorage),
      b = tab(indexedDB, localStorage);
    await Promise.all([a.ready, b.ready]);
    const results = await Promise.allSettled([
      a.createFile(a.MY_DOCUMENTS, "a.txt", { content: "A" }),
      b.createFile(b.MY_DOCUMENTS, "b.txt", { content: "B" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results[0].status === "rejected" ? a : b;
    const name = loser === a ? "a.txt" : "b.txt";
    await loser.createFile(loser.MY_DOCUMENTS, name, { content: name });
    const reopened = tab(indexedDB, localStorage);
    await reopened.ready;
    expect(reopened.findChild(reopened.MY_DOCUMENTS, "a.txt")).not.toBeNull();
    expect(reopened.findChild(reopened.MY_DOCUMENTS, "b.txt")).not.toBeNull();
    a.close();
    b.close();
    reopened.close();
  });

  test("preserves committed content and reports failure when a durable write aborts", async () => {
    const indexedDB = new IDBFactory(),
      localStorage = storage();
    const fs = tab(indexedDB, localStorage);
    await fs.ready;
    const file = await fs.createFile(fs.MY_DOCUMENTS, "notes.txt", {
      content: "saved",
    });
    const db = await request(indexedDB.open("astro-documents", 1));
    const prototype = Object.getPrototypeOf(
      db.transaction("nodes").objectStore("nodes"),
    );
    const put = prototype.put;
    prototype.put = function (value, ...args) {
      const result = put.call(this, value, ...args);
      if (value.content === "failed") this.transaction.abort();
      return result;
    };
    try {
      await expect(fs.setContent(file.id, "failed")).rejects.toThrow();
    } finally {
      prototype.put = put;
    }
    expect(fs.getContent(file.id)).toBe("saved");
    fs.close();
    db.close();
  });

  test("rejects an editor overwrite after a refresh", async () => {
    const fs = tab(new IDBFactory(), storage());
    await fs.ready;
    const file = await fs.createFile(fs.MY_DOCUMENTS, "notes.txt", {
      content: "old",
    });
    await fs.setContent(file.id, "new", { expectedContent: "old" });
    await expect(
      fs.setContent(file.id, "stale", { expectedContent: "old" }),
    ).rejects.toThrow("changed in another window");
    expect(fs.getContent(file.id)).toBe("new");
    await fs.rename(file.id, "notes.txt");
    await fs.rename(file.id, "NOTES.txt");
    expect(fs.getNode(file.id).name).toBe("NOTES.txt");
    fs.close();
  });
});

describe("filesystem persistence failures", () => {
  test("becomes read-only without IndexedDB", async () => {
    const fs = tab(undefined, storage());
    await fs.ready;
    expect(fs.canWrite).toBeFalse();
    await expect(fs.createFile(fs.DESKTOP, "a.txt")).rejects.toThrow(
      "Can't save files",
    );
    fs.close();
  });

  test("reports a database that cannot be opened", async () => {
    const indexedDB = new IDBFactory();
    (await request(indexedDB.open("astro-documents", 2))).close();
    const fs = tab(indexedDB, storage());
    await fs.ready;
    await expect(fs.createFile(fs.DESKTOP, "a.txt")).rejects.toThrow(
      /version/i,
    );
  });

  test("stops writing after another tab upgrades the database", async () => {
    const indexedDB = new IDBFactory();
    let pageshow;
    const fs = tab(indexedDB, storage(), {
      BroadcastChannel,
      addEventListener: (type, listener) => {
        if (type === "pageshow") pageshow = listener;
      },
    });
    await fs.ready;
    (await request(indexedDB.open("astro-documents", 2))).close();
    expect(fs.canWrite).toBeFalse();
    const notified = [];
    fs.subscribe(() => notified.push("refresh"));
    pageshow();
    const other = new BroadcastChannel("astro-documents");
    other.postMessage("changed");
    other.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(notified).toEqual([]);
    await expect(fs.createFile(fs.DESKTOP, "a.txt")).rejects.toThrow(
      "Can't save files",
    );
  });

  test("refreshes from other tabs and when the page is shown again", async () => {
    const indexedDB = new IDBFactory(),
      localStorage = storage();
    let pageshow;
    const a = tab(indexedDB, localStorage, { BroadcastChannel });
    const b = tab(indexedDB, localStorage, {
      BroadcastChannel,
      addEventListener: (type, listener) => {
        if (type === "pageshow") pageshow = listener;
      },
    });
    await Promise.all([a.ready, b.ready]);
    const changed = new Promise((resolve) => b.subscribe(resolve));
    const file = await a.createFile(a.DESKTOP, "shared.txt", {
      content: "from A",
    });
    await changed;
    expect(b.getContent(file.id)).toBe("from A");
    await a.destroy(file.id);
    const shown = new Promise((resolve) => b.subscribe(resolve));
    pageshow();
    await shown;
    expect(b.getNode(file.id)).toBeNull();
    a.close();
    b.close();
  });

  test("retries a conflicting transaction against the latest files", async () => {
    const indexedDB = new IDBFactory(),
      localStorage = storage();
    const a = tab(indexedDB, localStorage),
      b = tab(indexedDB, localStorage);
    await Promise.all([a.ready, b.ready]);
    await a.createFile(a.DESKTOP, "first.txt");
    const created = await b.transaction(
      () => b.createFile(b.DESKTOP, "second.txt"),
      { retry: 1 },
    );
    expect(created.name).toBe("second.txt");
    expect(b.findChild(b.DESKTOP, "first.txt")).not.toBeNull();
    a.close();
    b.close();
  });

  // Documents stored before Recent and My Network Places existed: the
  // records lack both folders, and the user made a folder named Recent.
  const storeOldDocuments = async (indexedDB, { keepRecent = false } = {}) => {
    const first = tab(indexedDB, storage());
    await first.ready;
    first.close();
    const db = await request(indexedDB.open("astro-documents", 1));
    const store = db.transaction("nodes", "readwrite").objectStore("nodes");
    const profile = await request(store.get(first.USER_PROFILE));
    if (!keepRecent) store.delete(first.RECENT);
    store.delete(first.MY_NETWORK_PLACES);
    store.put({
      ...profile,
      children: [
        ...profile.children.filter((id) => id !== first.RECENT),
        "user-recent",
      ],
    });
    store.put({
      ...profile,
      id: "user-recent",
      name: "Recent",
      parent: first.USER_PROFILE,
      children: [],
      protected: false,
    });
    await new Promise((resolve) => (store.transaction.oncomplete = resolve));
    return db;
  };

  test("stores new system folders for documents saved before them", async () => {
    const indexedDB = new IDBFactory();
    const db = await storeOldDocuments(indexedDB);
    const fs = tab(indexedDB, storage());
    await fs.ready;
    expect(fs.getNode(fs.RECENT).hidden).toBeTrue();
    expect(fs.getNode(fs.MY_NETWORK_PLACES)).toBeTruthy();
    // The user's own Recent folder moves aside and stays visible.
    expect(fs.getNode("user-recent").name).toBe("Recent (2)");
    expect(fs.findChild(fs.USER_PROFILE, "Recent").id).toBe(fs.RECENT);
    const records = await request(
      db.transaction("nodes").objectStore("nodes").getAll(),
    );
    expect(records.map((node) => node.id)).toContain(fs.RECENT);
    expect(records.find((node) => node.id === "user-recent").name).toBe(
      "Recent (2)",
    );
    fs.close();
    db.close();
  });

  const storedNode = async (db, id) =>
    request(db.transaction("nodes").objectStore("nodes").get(id));

  test("puts a stored system folder back in its parent folder", async () => {
    const indexedDB = new IDBFactory();
    const db = await storeOldDocuments(indexedDB, { keepRecent: true });
    const fs = tab(indexedDB, storage());
    await fs.ready;
    expect(fs.getNode(fs.USER_PROFILE).children).toContain(fs.RECENT);
    expect(fs.getNode("user-recent").name).toBe("Recent (2)");
    expect((await storedNode(db, fs.USER_PROFILE)).children).toContain(
      fs.RECENT,
    );
    fs.close();
    db.close();
  });

  test("stores the system folders after another tab's write conflicts", async () => {
    const indexedDB = new IDBFactory();
    const db = await storeOldDocuments(indexedDB);
    const profile = await storedNode(db, "user-profile");
    const prototype = Object.getPrototypeOf(db);
    const transaction = prototype.transaction;
    let writes = 0;
    prototype.transaction = function (names, mode, ...args) {
      const result = transaction.call(this, names, mode, ...args);
      // Before the heal's revision check reads the profile, another tab's
      // write appears to have changed it.
      if (mode === "readwrite" && ++writes === 2)
        result
          .objectStore("nodes")
          .put({ ...profile, revision: (profile.revision || 0) + 5 });
      return result;
    };
    const fs = tab(indexedDB, storage());
    try {
      await fs.ready;
    } finally {
      prototype.transaction = transaction;
    }
    expect(writes).toBeGreaterThan(2);
    expect(await storedNode(db, fs.RECENT)).toBeTruthy();
    expect((await storedNode(db, fs.USER_PROFILE)).children).toContain(
      fs.RECENT,
    );
    fs.close();
    db.close();
  });

  test("stays read-only when the database closes while it heals", async () => {
    const indexedDB = new IDBFactory();
    const db = await storeOldDocuments(indexedDB);
    const prototype = Object.getPrototypeOf(db);
    const transaction = prototype.transaction;
    let writes = 0;
    prototype.transaction = function (names, mode, ...args) {
      // The second write is the heal: another tab upgrades the database
      // just before it.
      if (mode === "readwrite" && ++writes === 2) this.onversionchange();
      return transaction.call(this, names, mode, ...args);
    };
    const fs = tab(indexedDB, storage(), { console: { error: () => {} } });
    try {
      await fs.ready;
    } finally {
      prototype.transaction = transaction;
    }
    expect(fs.canWrite).toBeFalse();
    expect(fs.getNode(fs.RECENT)).toBeTruthy();
    db.close();
  });

  test("resets every stored field of a system folder but its dates", async () => {
    const indexedDB = new IDBFactory();
    const first = tab(indexedDB, storage());
    await first.ready;
    const created = first.getNode(first.MY_DOCUMENTS).created;
    first.close();
    const db = await request(indexedDB.open("astro-documents", 1));
    const store = db.transaction("nodes", "readwrite").objectStore("nodes");
    const documents = await request(store.get(first.MY_DOCUMENTS));
    store.put({
      ...documents,
      type: "file",
      name: "Fake",
      protected: false,
      size: 99,
      ext: ".exe",
      content: "data",
      app: "__my-computer",
      originalParent: first.DESKTOP,
      originalName: "Old",
    });
    await new Promise((resolve) => (store.transaction.oncomplete = resolve));
    db.close();

    const fs = tab(indexedDB, storage());
    await fs.ready;
    expect(fs.getNode(fs.MY_DOCUMENTS)).toMatchObject({
      type: "folder",
      name: "My Documents",
      protected: true,
      size: 0,
      ext: "",
      content: "",
      app: null,
      originalParent: null,
      originalName: null,
      created,
    });
    fs.close();
  });

  test("heals system folders in memory when storing them fails", async () => {
    const indexedDB = new IDBFactory();
    const db = await storeOldDocuments(indexedDB);
    const prototype = Object.getPrototypeOf(
      db.transaction("nodes").objectStore("nodes"),
    );
    const put = prototype.put;
    prototype.put = function (value, ...args) {
      const result = put.call(this, value, ...args);
      this.transaction.abort();
      return result;
    };
    const errors = [];
    let pageshow;
    const fs = tab(indexedDB, storage(), {
      console: { error: (...args) => errors.push(args) },
      addEventListener: (type, listener) => {
        if (type === "pageshow") pageshow = listener;
      },
    });
    try {
      await fs.ready;
    } finally {
      prototype.put = put;
    }
    expect(fs.canWrite).toBeTrue();
    expect(fs.getNode(fs.RECENT)).toBeTruthy();
    expect(errors[0][0]).toContain("failed to store system folders");
    // A reload of the stored folders heals them again in memory.
    const shown = new Promise((resolve) => fs.subscribe(resolve));
    pageshow();
    await shown;
    expect(fs.getNode(fs.MY_NETWORK_PLACES)).toBeTruthy();
    fs.close();
    db.close();
  });

  test("stores healed sample pictures with the next write after a failed heal", async () => {
    const indexedDB = new IDBFactory();
    const first = tab(indexedDB, storage());
    await first.ready;
    first.close();
    // Documents stored before Sample Pictures existed.
    const db = await request(indexedDB.open("astro-documents", 1));
    const store = db.transaction("nodes", "readwrite").objectStore("nodes");
    const pictures = await request(store.get(first.MY_PICTURES));
    store.put({ ...pictures, children: [] });
    for (const id of [
      first.SAMPLE_PICTURES,
      "sample-blue-hills",
      "sample-sunset",
      "sample-water-lilies",
      "sample-winter",
    ])
      store.delete(id);
    await new Promise((resolve) => (store.transaction.oncomplete = resolve));
    // The heal's write fails, so this tab heals only its own copy.
    const prototype = Object.getPrototypeOf(
      db.transaction("nodes").objectStore("nodes"),
    );
    const put = prototype.put;
    prototype.put = function (value, ...args) {
      const result = put.call(this, value, ...args);
      this.transaction.abort();
      return result;
    };
    const fs = tab(indexedDB, storage(), { console: { error: () => {} } });
    try {
      await fs.ready;
    } finally {
      prototype.put = put;
    }
    expect(await storedNode(db, "sample-sunset")).toBeUndefined();
    // Deleting one sample also stores the folder's other samples.
    await fs.destroy("sample-winter");
    fs.close();
    const reopened = tab(indexedDB, storage());
    await reopened.ready;
    expect(
      reopened.getChildren(reopened.SAMPLE_PICTURES).map(({ name }) => name),
    ).toEqual(["Blue hills.jpg", "Sunset.jpg", "Water lilies.jpg"]);
    expect((await storedNode(db, "sample-sunset")).revision).toBe(1);
    reopened.close();
    db.close();
  });

  test("keeps a cut item on the clipboard when its delete is not saved", async () => {
    const indexedDB = new IDBFactory();
    const { fs, operations } = tabWithOperations(indexedDB, storage());
    await fs.ready;
    const file = await fs.createFile(fs.DESKTOP, "cut.txt");
    operations.cut([file.id]);
    const db = await request(indexedDB.open("astro-documents", 1));
    const prototype = Object.getPrototypeOf(
      db.transaction("nodes").objectStore("nodes"),
    );
    const put = prototype.put;
    prototype.put = function (value, ...args) {
      const result = put.call(this, value, ...args);
      this.transaction.abort();
      return result;
    };
    try {
      await expect(fs.remove(file.id)).rejects.toThrow();
    } finally {
      prototype.put = put;
    }
    // The file stays, so it stays cut.
    expect(fs.getNode(file.id).parent).toBe(fs.DESKTOP);
    expect(operations.getClipboard()).toEqual({ mode: "cut", ids: [file.id] });
    // A saved delete takes it off the clipboard.
    await fs.remove(file.id);
    expect(operations.getClipboard()).toBeNull();
    fs.close();
    db.close();
  });

  test("explains a full browser storage quota", async () => {
    const indexedDB = new IDBFactory();
    const fs = tab(indexedDB, storage());
    await fs.ready;
    const db = await request(indexedDB.open("astro-documents", 1));
    const prototype = Object.getPrototypeOf(
      db.transaction("nodes").objectStore("nodes"),
    );
    const put = prototype.put;
    prototype.put = function (value, ...args) {
      const result = put.call(this, value, ...args);
      Object.defineProperty(this.transaction, "error", {
        value: new DOMException("Quota exceeded", "QuotaExceededError"),
      });
      this.transaction.abort();
      return result;
    };
    try {
      await expect(fs.createFile(fs.DESKTOP, "big.txt")).rejects.toThrow(
        "Storage is full",
      );
    } finally {
      prototype.put = put;
    }
    fs.close();
    db.close();
  });
});
