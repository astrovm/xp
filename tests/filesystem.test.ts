// @ts-nocheck
import { beforeEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fsPath = require.resolve("../site/js/filesystem.js");

// localStorage shim so persistence can be exercised across module reloads.
const installMemoryStorage = () => {
  const memoryStorage = new Map();
  global.localStorage = {
    getItem: (key) => (memoryStorage.has(key) ? memoryStorage.get(key) : null),
    setItem: (key, value) => memoryStorage.set(key, String(value)),
    removeItem: (key) => memoryStorage.delete(key),
    clear: () => memoryStorage.clear(),
  };
};

const loadFilesystem = () => {
  delete require.cache[fsPath];
  return require(fsPath);
};

describe("virtual filesystem", () => {
  let fs;

  beforeEach(() => {
    installMemoryStorage();
    fs = loadFilesystem();
  });

  const createTestFolder = () => {
    const folder = fs.createFolder(fs.MY_DOCUMENTS, "Test Folder");
    const file = fs.createFile(folder.id, "notes.txt", { content: "hello" });
    return { folder, file };
  };

  test("hides XP's Recent folder from listings but keeps its name taken", () => {
    const recent = fs.getNode(fs.RECENT);
    expect(recent.parent).toBe(fs.USER_PROFILE);
    expect(
      fs.getChildren(fs.USER_PROFILE).map((node) => node.name),
    ).not.toContain("Recent");
    expect(fs.findChild(fs.USER_PROFILE, "recent")).toBe(recent);
    expect(fs.createFolder(fs.USER_PROFILE, "Recent").name).not.toBe("Recent");
  });

  test("seeds the well-known locations", () => {
    expect(fs.getNode(fs.MY_COMPUTER), "My Computer exists").toBeTruthy();
    expect(fs.getNode(fs.DESKTOP), "Desktop exists").toBeTruthy();
    expect(fs.getNode(fs.MY_DOCUMENTS), "My Documents exists").toBeTruthy();
    expect(fs.getNode(fs.MY_PICTURES), "My Pictures exists").toBeTruthy();
    expect(fs.getNode(fs.MY_MUSIC), "My Music exists").toBeTruthy();
    expect(fs.getNode(fs.DRIVE_C), "Local Disk exists").toBeTruthy();
    expect(fs.getNode(fs.RECYCLE_BIN), "Recycle Bin exists").toBeTruthy();
    expect(fs.getChildren(fs.MY_COMPUTER).length).toBe(3);
    expect(fs.getNode(fs.DRIVE_D).name).toBe("Local Disk (D:)");
    expect(fs.getNode(fs.DRIVE_F).name).toBe("Removable Disk (F:)");
  });

  test("converts between Windows paths and nodes", () => {
    expect(fs.getPath(fs.DRIVE_C)).toBe("C:\\");
    expect(fs.getPath(fs.MY_PICTURES)).toBe(
      "C:\\Documents and Settings\\astro\\My Documents\\My Pictures",
    );
    expect(
      fs.resolvePath("C:\\Documents and Settings\\astro\\My Documents"),
    ).toBe(fs.MY_DOCUMENTS);
    expect(fs.resolvePath("c:\\documents and settings\\ASTRO\\desktop")).toBe(
      fs.DESKTOP,
    );
    expect(fs.resolvePath("C:\\does\\not\\exist")).toBe(null);
    expect(fs.resolvePath("My Computer")).toBe(fs.MY_COMPUTER);
    expect(fs.resolvePath("F:\\")).toBe(fs.DRIVE_F);
  });

  test("resolves the paths it gives to Recycle Bin items", () => {
    const file = fs.createFile(fs.MY_DOCUMENTS, "binned.txt");
    fs.remove(file.id);
    const path = fs.getPath(file.id);
    expect(path).toStartWith("Recycle Bin\\");
    expect(fs.resolvePath(path)).toBe(file.id);
  });

  test("rejects names that are invalid on Windows", () => {
    expect(fs.validateName("notes.txt")).toBe("notes.txt");
    expect(fs.validateName("  notes.txt")).toBe("notes.txt");
    [
      "",
      "   ",
      ".",
      "..",
      "trailing.",
      "trailing ",
      "bad/name.txt",
      "bad:name.txt",
      "bad\u0000name.txt",
      "CON",
      "nul.txt",
      "COM1.log",
      "LPT9",
    ].forEach((name) => {
      expect(
        () => fs.validateName(name),
        `rejects ${JSON.stringify(name)}`,
      ).toThrow(/VirtualFS:/);
    });

    expect(() => fs.createFolder(fs.MY_DOCUMENTS, "invalid?folder")).toThrow(
      /invalid characters/,
    );
  });

  test("creates folders and files with timestamps and sizes", () => {
    const folder = fs.createFolder(fs.MY_DOCUMENTS, "Test Folder");
    expect(folder.type).toBe("folder");
    expect(folder.parent).toBe(fs.MY_DOCUMENTS);
    expect(folder.created > 0 && folder.modified > 0).toBeTruthy();

    const file = fs.createFile(folder.id, "notes.txt", { content: "hello" });
    expect(file.ext).toBe(".txt");
    expect(fs.getSize(file.id)).toBe(5);
    expect(fs.getContent(file.id)).toBe("hello");
    fs.setContent(file.id, "hello world");
    expect(fs.getSize(file.id)).toBe(11);
    expect(fs.getSize(folder.id)).toBe(11);
  });

  test("renames items and deduplicates conflicting names", () => {
    const { folder, file } = createTestFolder();

    fs.rename(file.id, "todo.txt");
    expect(fs.getNode(file.id).name).toBe("todo.txt");
    expect(() => fs.rename(file.id, "AUX.txt")).toThrow(/reserved device name/);
    expect(
      fs.getNode(file.id).name,
      "invalid rename leaves node unchanged",
    ).toBe("todo.txt");
    const duplicate = fs.createFile(folder.id, "todo.txt");
    expect(duplicate.name).toBe("todo (2).txt");
  });

  test('copies folders recursively, naming same-folder copies "Copy of"', () => {
    const { folder, file } = createTestFolder();
    fs.createFile(folder.id, "second.txt");

    const folderCopy = fs.copy(folder.id, fs.MY_DOCUMENTS);
    expect(folderCopy.name).toBe("Copy of Test Folder");
    expect(fs.getChildren(folderCopy.id).length).toBe(2);
    expect(fs.getChildren(folderCopy.id)[0].id).not.toBe(file.id);

    // Copying into another folder keeps the name when there is no conflict.
    const elsewhere = fs.copy(folder.id, fs.MY_PICTURES);
    expect(elsewhere.name).toBe("Test Folder");
  });

  test("prevents moving or copying a folder into itself", () => {
    const { folder } = createTestFolder();
    const subFolder = fs.createFolder(folder.id, "Sub");

    expect(() => fs.move(folder.id, subFolder.id)).toThrow(/into itself/);
    expect(() => fs.move(folder.id, folder.id)).toThrow(/into itself/);
    expect(() => fs.copy(folder.id, subFolder.id)).toThrow(/into itself/);
    fs.move(subFolder.id, fs.MY_PICTURES);
    expect(fs.getNode(subFolder.id).parent).toBe(fs.MY_PICTURES);
  });

  test("denies changes to protected system items", () => {
    const { folder } = createTestFolder();

    expect(() => fs.remove(fs.MY_DOCUMENTS)).toThrow(/access is denied/);
    expect(() => fs.destroy(fs.DESKTOP)).toThrow(/access is denied/);
    expect(() => fs.rename(fs.DRIVE_C, "X")).toThrow(/access is denied/);
    expect(() => fs.move(fs.MY_PICTURES, folder.id)).toThrow(
      /access is denied/,
    );
    expect(fs.isProtected(fs.RECYCLE_BIN)).toBeTruthy();
  });

  test("restores deleted items from the Recycle Bin and destroys items deleted twice", () => {
    const { folder } = createTestFolder();
    const folderCopy = fs.copy(folder.id, fs.MY_DOCUMENTS);

    fs.remove(folderCopy.id);
    expect(fs.isInRecycleBin(folderCopy.id)).toBeTruthy();
    expect(fs.getChildren(fs.RECYCLE_BIN).length).toBe(1);
    // My Pictures, My Music (seeded) and Test Folder remain.
    expect(fs.getChildren(fs.MY_DOCUMENTS).length).toBe(3);

    fs.restore(folderCopy.id);
    expect(fs.isInRecycleBin(folderCopy.id)).toBeFalsy();
    expect(fs.getNode(folderCopy.id).parent).toBe(fs.MY_DOCUMENTS);

    // The second delete happens in the bin and destroys permanently.
    fs.remove(folderCopy.id);
    fs.remove(folderCopy.id);
    expect(fs.getNode(folderCopy.id)).toBeFalsy();
    expect(fs.getChildren(fs.RECYCLE_BIN).length).toBe(0);
  });

  test("empties the Recycle Bin recursively", () => {
    const { folder, file } = createTestFolder();

    fs.remove(folder.id);
    expect(fs.getChildren(fs.RECYCLE_BIN).length).toBe(1);
    fs.emptyRecycleBin();
    expect(fs.getChildren(fs.RECYCLE_BIN).length).toBe(0);
    expect(fs.getNode(folder.id), "folder destroyed").toBeFalsy();
    expect(fs.getNode(file.id), "descendants destroyed too").toBeFalsy();
  });

  test("opens files with registered handlers and finds them by app", () => {
    let openedWith = null;
    fs.registerFileType(".game", (node) => {
      openedWith = node;
    });
    const gameFile = fs.createFile(fs.DESKTOP, "Doom.game", { app: "doom" });
    expect(fs.open(gameFile.id)).toBe(true);
    expect(openedWith.id).toBe(gameFile.id);
    expect(fs.findByApp("doom").map((node) => node.id)).toEqual([gameFile.id]);
    fs.move(gameFile.id, fs.MY_DOCUMENTS);
    fs.rename(gameFile.id, "My Doom Shortcut.game");
    expect(
      fs.findByApp("doom").map((node) => node.id),
      "managed files remain discoverable after move and rename",
    ).toEqual([gameFile.id]);
    expect(fs.findByApp("missing-game")).toEqual([]);
    const unknownFile = fs.createFile(fs.DESKTOP, "readme.xyz");
    expect(fs.open(unknownFile.id)).toBe(false);
  });

  test("persists content across sessions", () => {
    const persistent = fs.createFile(fs.MY_DOCUMENTS, "keep.txt", {
      content: "saved",
    });
    const reloaded = loadFilesystem();
    expect(reloaded.getContent(persistent.id)).toBe("saved");
    expect(reloaded.getNode(persistent.id).parent).toBe(fs.MY_DOCUMENTS);
    expect(
      reloaded.getNode(fs.MY_PICTURES),
      "seed survives reload",
    ).toBeTruthy();
  });

  test("notifies subscribers of changes", () => {
    let notified = 0;
    const unsubscribe = fs.subscribe(() => {
      notified += 1;
    });
    fs.createFile(fs.MY_DOCUMENTS, "ping.txt");
    expect(notified > 0, "listener fired").toBeTruthy();
    unsubscribe();
  });

  test("reseeds on reset while preserving subscribers and file handlers", () => {
    let resetNotified = 0;
    fs.subscribe(() => {
      resetNotified += 1;
    });
    fs.registerFileType(".txt", () => {});
    fs.createFile(fs.MY_DOCUMENTS, "delete-on-reset.txt");
    fs.reset();
    expect(
      fs.findChild(fs.MY_DOCUMENTS, "delete-on-reset.txt"),
      "reset removes user-created files",
    ).toBe(null);
    expect(
      fs.getNode(fs.DESKTOP),
      "reset restores the seeded desktop",
    ).toBeTruthy();
    expect(resetNotified, "create and reset both notify subscribers").toBe(2);
    const afterReset = fs.createFile(fs.MY_DOCUMENTS, "after-reset.txt");
    expect(fs.open(afterReset.id), "reset preserves file handlers").toBe(true);
  });
});

describe("virtual filesystem edge cases", () => {
  const storedNodes = (nodes) =>
    JSON.stringify({ version: 1, nodes: { ...nodes } });
  const node = (id, overrides = {}) => ({
    id,
    name: id,
    type: "file",
    parent: null,
    children: [],
    created: 0,
    modified: 0,
    size: 0,
    protected: false,
    ext: "",
    content: "",
    app: null,
    originalParent: null,
    originalName: null,
    ...overrides,
  });

  const withConsoleErrors = (callback) => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
      callback();
    } finally {
      console.error = original;
    }
    return errors;
  };

  test("keeps files in memory when browser storage is missing or blocked", () => {
    for (const storage of [
      undefined,
      {
        getItem() {
          throw new Error("blocked");
        },
      },
    ]) {
      global.localStorage = storage;
      const fs = loadFilesystem();
      const file = fs.createFile(fs.DESKTOP, "memo.txt", { content: "kept" });
      expect(fs.getContent(file.id)).toBe("kept");
      fs.resetForTests();
      expect(fs.getNode(file.id)).toBeNull();
    }
    delete global.localStorage;
  });

  test("repairs missing and malformed system folders from stored data", () => {
    installMemoryStorage();
    const seed = loadFilesystem();
    const nodes = Object.fromEntries(
      Object.keys(seed.WELL_KNOWN).map((key) => [
        seed.WELL_KNOWN[key],
        { ...seed.getNode(seed.WELL_KNOWN[key]) },
      ]),
    );
    delete nodes[seed.MY_MUSIC];
    nodes[seed.MY_DOCUMENTS].children = nodes[
      seed.MY_DOCUMENTS
    ].children.filter((id) => id !== seed.MY_MUSIC);
    nodes[seed.MY_PICTURES].children = "corrupt";
    localStorage.setItem("virtualFileSystem", storedNodes(nodes));
    const fs = loadFilesystem();
    expect(fs.getParent(fs.MY_MUSIC).id).toBe(fs.MY_DOCUMENTS);
    expect(fs.getChildren(fs.MY_DOCUMENTS).map(({ id }) => id)).toContain(
      fs.MY_MUSIC,
    );
    expect(fs.getChildren(fs.MY_PICTURES)).toEqual([]);
  });

  test("restores a missing system folder together with its missing parent", () => {
    installMemoryStorage();
    const seed = loadFilesystem();
    const nodes = Object.fromEntries(
      Object.values(seed.WELL_KNOWN).map((id) => [id, { ...seed.getNode(id) }]),
    );
    delete nodes[seed.MY_DOCUMENTS];
    delete nodes[seed.MY_MUSIC];
    localStorage.setItem("virtualFileSystem", storedNodes(nodes));
    const fs = loadFilesystem();
    expect(fs.getParent(fs.MY_MUSIC).id).toBe(fs.MY_DOCUMENTS);
    expect(fs.getParent(fs.MY_DOCUMENTS).id).toBe(fs.USER_PROFILE);
    const children = fs.getChildren(fs.MY_DOCUMENTS).map(({ id }) => id);
    expect(children.filter((id) => id === fs.MY_MUSIC)).toHaveLength(1);
  });

  test("reports unreadable stored data and starts from the seed", () => {
    installMemoryStorage();
    localStorage.setItem("virtualFileSystem", "{broken");
    let fs;
    const errors = withConsoleErrors(() => {
      fs = loadFilesystem();
    });
    expect(errors[0][0]).toContain("failed to read stored filesystem");
    expect(fs.getNode(fs.DESKTOP)).toBeTruthy();
  });

  test("rolls back an edit when storage rejects the write", () => {
    for (const [error, message] of [
      [
        Object.assign(new Error("full"), { name: "QuotaExceededError" }),
        "full",
      ],
      [Object.assign(new Error("full"), { code: 22 }), "full"],
      [new Error("disk failure"), "disk failure"],
    ]) {
      installMemoryStorage();
      const fs = loadFilesystem();
      const setItem = localStorage.setItem;
      localStorage.setItem = () => {
        throw error;
      };
      expect(() => fs.createFile(fs.DESKTOP, "new.txt")).toThrow(message);
      localStorage.setItem = setItem;
      expect(fs.findChild(fs.DESKTOP, "new.txt")).toBeNull();
    }
  });

  test("keeps notifying after a listener throws", () => {
    installMemoryStorage();
    const fs = loadFilesystem();
    let notified = 0;
    fs.subscribe(() => {
      throw new Error("listener failed");
    });
    fs.subscribe(() => {
      notified += 1;
    });
    const errors = withConsoleErrors(() => fs.createFolder(fs.DESKTOP, "New"));
    expect(errors[0][0]).toBe("VirtualFS listener error:");
    expect(notified).toBe(1);
  });

  test("answers lookups for missing items and unusual paths", () => {
    installMemoryStorage();
    const fs = loadFilesystem();
    expect(fs.getParent("missing")).toBeNull();
    expect(fs.getParent(fs.MY_COMPUTER)).toBeNull();
    expect(fs.getChildren("missing")).toEqual([]);
    expect(fs.getPath("missing")).toBeNull();
    expect(fs.getSize("missing")).toBe(0);
    expect(fs.resolvePath(null)).toBeNull();
    expect(fs.resolvePath("   ")).toBeNull();
    expect(fs.resolvePath("\\\\")).toBeNull();
    expect(fs.resolvePath("Recycle Bin")).toBe(fs.RECYCLE_BIN);
    expect(() => fs.createFolder(fs.DESKTOP, null)).toThrow(
      "a name is required",
    );
    expect(fs.createFolder(fs.DESKTOP, 2026).name).toBe("2026");
    expect(fs.createFile(fs.DESKTOP, "README").ext).toBe("");
    expect(fs.createFile(fs.DESKTOP, ".profile").ext).toBe("");
  });

  test("renames folders, sizes files, and renames files while saving", () => {
    installMemoryStorage();
    const fs = loadFilesystem();
    const folder = fs.createFolder(fs.DESKTOP, "Folder");
    expect(fs.createFolder(fs.DESKTOP, "Folder").name).toBe("Folder (2)");
    expect(fs.rename(folder.id, "Projects").ext).toBe("");
    expect(fs.createFile(fs.DESKTOP, "big.bin", { size: 4096 }).size).toBe(
      4096,
    );
    const note = fs.createFile(fs.DESKTOP, "draft.txt", { content: "a" });
    const saved = fs.setContent(note.id, "b", { name: "final.md" });
    expect(saved).toMatchObject({ name: "final.md", ext: ".md", content: "b" });
  });

  test("numbers repeated copies and duplicate names", () => {
    installMemoryStorage();
    const fs = loadFilesystem();
    const original = fs.createFile(fs.DESKTOP, "note.txt");
    expect(fs.copy(original.id, fs.DESKTOP).name).toBe("Copy of note.txt");
    expect(fs.copy(original.id, fs.DESKTOP).name).toBe("Copy (2) of note.txt");
    expect(fs.createFile(fs.DESKTOP, "note.txt").name).toBe("note (2).txt");
    expect(fs.createFile(fs.DESKTOP, "note.txt").name).toBe("note (3).txt");
  });

  test("handles detached and inconsistent stored items", () => {
    installMemoryStorage();
    const seed = loadFilesystem();
    const nodes = {};
    for (const id of Object.values(seed.WELL_KNOWN))
      nodes[id] = { ...seed.getNode(id) };
    nodes.orphan = node("orphan", { name: "orphan.txt", size: Infinity });
    nodes.ghost = node("ghost", { name: "ghost.txt", parent: "missing" });
    nodes.binned = node("binned", {
      name: "binned.txt",
      parent: seed.RECYCLE_BIN,
    });
    nodes[seed.RECYCLE_BIN].children = ["binned"];
    localStorage.setItem("virtualFileSystem", storedNodes(nodes));
    const fs = loadFilesystem();

    expect(fs.getSize("orphan")).toBe(0);
    expect(fs.rename("orphan", "renamed.txt").name).toBe("renamed.txt");
    expect(fs.setContent("orphan", null).content).toBe("");
    expect(fs.rename("ghost", "ghostly.txt").name).toBe("ghostly.txt");
    expect(fs.move("orphan", fs.DESKTOP).parent).toBe(fs.DESKTOP);
    expect(fs.restore("binned").name).toBe("binned.txt");
  });

  test("rejects operations on missing items and the wrong item types", () => {
    installMemoryStorage();
    const fs = loadFilesystem();
    const file = fs.createFile(fs.DESKTOP, "note.txt");
    expect(() => fs.rename("missing", "x")).toThrow('item "missing" not found');
    expect(() => fs.createFile(file.id, "child.txt")).toThrow(
      "is not a folder",
    );
    expect(() => fs.restore(file.id)).toThrow("Only items in the Recycle Bin");
    expect(() => fs.setContent(fs.DESKTOP, "text")).toThrow("is not a file");
    expect(fs.getContent(fs.DESKTOP)).toBeNull();
    expect(fs.move(file.id, fs.DESKTOP)).toBe(fs.getNode(file.id));
    expect(fs.destroy("missing")).toBeUndefined();
    expect(fs.open(fs.DESKTOP)).toBeFalse();
    fs.registerFolderHandler(() => {});
    expect(fs.open(fs.DESKTOP)).toBeTrue();
    fs.registerFileType("*", () => {});
    const extensionless = fs.createFile(fs.DESKTOP, "README");
    fs.getNode(extensionless.id).ext = undefined;
    expect(fs.open(extensionless.id)).toBeTrue();
  });
});
