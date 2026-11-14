// @ts-nocheck
import { beforeEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fsPath = require.resolve("../site/js/filesystem.js");
const operationsPath = require.resolve("../site/js/file-operations.js");

describe("file operations", () => {
  let fs;
  let operations;

  beforeEach(() => {
    const memoryStorage = new Map();
    global.localStorage = {
      getItem: (key) =>
        memoryStorage.has(key) ? memoryStorage.get(key) : null,
      setItem: (key, value) => memoryStorage.set(key, String(value)),
      removeItem: (key) => memoryStorage.delete(key),
    };

    delete require.cache[fsPath];
    delete require.cache[operationsPath];
    fs = require(fsPath);
    fs.resetForTests();
    operations = require(operationsPath);
    operations.resetForTests();
  });

  const createClipboardFixture = () => {
    const source = operations.createFolder(fs.MY_DOCUMENTS, "Source");
    const nested = operations.createFolder(source.id, "Nested");
    const note = operations.createFile(source.id, "note.txt", {
      content: "hello",
    });
    const destination = operations.createFolder(fs.MY_DOCUMENTS, "Destination");
    return { source, nested, note, destination };
  };

  const createConflictFixture = () => {
    const conflictSource = operations.createFolder(
      fs.MY_DOCUMENTS,
      "Conflict Source",
    );
    const conflictFile = operations.createFile(conflictSource.id, "same.txt", {
      content: "new",
    });
    const conflictFolder = operations.createFolder(
      conflictSource.id,
      "same-folder",
    );
    const conflictTarget = operations.createFolder(
      fs.MY_DOCUMENTS,
      "Conflict Target",
    );
    const existingFile = operations.createFile(conflictTarget.id, "same.txt", {
      content: "old",
    });
    operations.createFolder(conflictTarget.id, "same-folder");
    return {
      conflictSource,
      conflictFile,
      conflictFolder,
      conflictTarget,
      existingFile,
    };
  };

  const createAtomicFixture = () => {
    const atomicSource = operations.createFolder(
      fs.MY_DOCUMENTS,
      "Atomic Source",
    );
    const atomicA = operations.createFile(atomicSource.id, "a.txt", {
      content: "a",
    });
    const atomicB = operations.createFile(atomicSource.id, "b.txt", {
      content: "b",
    });
    const atomicTarget = operations.createFolder(
      fs.MY_DOCUMENTS,
      "Atomic Target",
    );
    const oldA = operations.createFile(atomicTarget.id, "a.txt", {
      content: "old a",
    });
    const oldB = operations.createFile(atomicTarget.id, "b.txt", {
      content: "old b",
    });
    return { atomicSource, atomicA, atomicB, atomicTarget, oldA, oldB };
  };

  test("tracks clipboard state and names same-folder copies deterministically", async () => {
    const { source, nested, note, destination } = createClipboardFixture();

    expect(operations.canPaste(destination.id)).toBe(false);
    operations.copy([source.id, nested.id]);
    expect(operations.getClipboard()).toEqual({
      mode: "copy",
      ids: [source.id],
    });
    expect(operations.canPaste(destination.id)).toBe(true);
    const {
      results: [copied],
    } = await operations.pasteWithConflicts(destination.id);
    expect(copied.name).toBe("Source");
    expect(fs.getChildren(copied.id).length).toBe(2);
    operations.copy([note.id]);
    const {
      results: [sameFolderCopy],
    } = await operations.pasteWithConflicts(source.id);
    expect(sameFolderCopy.name).toBe("Copy of note.txt");
  });

  test("moves cut items on paste and clears the clipboard only after success", async () => {
    const { note, destination } = createClipboardFixture();

    operations.cut([note.id]);
    expect(operations.canPaste(destination.id)).toBe(true);
    const {
      results: [moved],
    } = await operations.pasteWithConflicts(destination.id);
    expect(moved.id).toBe(note.id);
    expect(fs.getNode(note.id).parent).toBe(destination.id);
    expect(operations.getClipboard()).toBe(null);
    await expect(operations.pasteWithConflicts(destination.id)).rejects.toThrow(
      /The Clipboard is empty/,
    );
  });

  test("keeps a cut clipboard and its source when the destination is invalid", async () => {
    const { source, nested } = createClipboardFixture();

    operations.cut([source.id]);
    expect(operations.canPaste(nested.id)).toBe(false);
    await expect(operations.pasteWithConflicts(nested.id)).rejects.toThrow(
      /subfolder of the source folder/,
    );
    expect(operations.getClipboard()).toEqual({
      mode: "cut",
      ids: [source.id],
    });
    expect(fs.getNode(source.id).parent).toBe(fs.MY_DOCUMENTS);
  });

  test("validates names on create and rename", () => {
    const { note, destination } = createClipboardFixture();

    expect(() => operations.createFile(destination.id, "bad?.txt")).toThrow(
      /cannot contain any of the following characters/,
    );
    expect(() => operations.rename(note.id, "CON.txt")).toThrow(
      /reserved for use by Windows/,
    );
  });

  test("moves items through the Recycle Bin explicitly and rejects accidental permanent deletes", async () => {
    const { source, destination } = createClipboardFixture();
    const note = operations.createFile(destination.id, "note.txt");

    operations.removeToBin([note.id]);
    expect(fs.isInRecycleBin(note.id)).toBeTruthy();
    expect(() => operations.removeToBin([note.id])).toThrow(
      /Cannot delete note.txt: Access is denied./,
    );
    const {
      results: [restored],
    } = await operations.restore([note.id]);
    expect(restored.id).toBe(note.id);
    expect(fs.getNode(note.id).parent).toBe(destination.id);
    operations.removeToBin([note.id]);
    operations.permanentlyDelete([note.id]);
    expect(fs.getNode(note.id)).toBe(null);
    expect(() => operations.permanentlyDelete([source.id])).toThrow(
      /Cannot delete Source: Access is denied./,
    );

    // Nothing new goes in a folder inside the Recycle Bin.
    operations.removeToBin([destination.id]);
    expect(() => operations.createFile(destination.id, "late.txt")).toThrow(
      /You cannot save in the folder you specified/,
    );

    operations.removeToBin([source.id]);
    operations.emptyRecycleBin();
    expect(fs.getChildren(fs.RECYCLE_BIN).length).toBe(0);
  });

  test("notifies subscribers of clipboard and filesystem changes", () => {
    const { source, destination } = createClipboardFixture();

    let notifications = 0;
    const unsubscribe = operations.subscribe(() => {
      notifications += 1;
    });
    operations.copy([source.id]);
    operations.createFile(destination.id, "ping.txt");
    expect(notifications >= 2).toBeTruthy();
    unsubscribe();
  });

  test("reports paste conflicts with existing items", () => {
    const { conflictFile, conflictTarget, existingFile } =
      createConflictFixture();

    operations.copy([conflictFile.id]);
    const conflicts = operations.getConflicts(
      [conflictFile.id],
      conflictTarget.id,
    );
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].existing.id).toBe(existingFile.id);
  });

  test("moves dragged items without the clipboard, even when a move fails", async () => {
    const { conflictSource, conflictFile, conflictTarget } =
      createConflictFixture();
    const other = fs.createFile(conflictSource.id, "other.txt");
    operations.copy([other.id]);
    const items = { mode: "cut", ids: [conflictFile.id] };
    const cancelled = await operations.pasteWithConflicts(
      conflictTarget.id,
      () => "cancel",
      { items },
    );
    expect(cancelled.cancelled).toBe(true);
    const move = fs.move;
    fs.move = () => {
      throw new Error("Storage is full.");
    };
    try {
      await expect(
        operations.pasteWithConflicts(conflictTarget.id, () => "replace", {
          items,
        }),
      ).rejects.toThrow("Storage is full.");
    } finally {
      fs.move = move;
    }
    const moved = await operations.pasteWithConflicts(
      conflictTarget.id,
      () => "replace",
      { items },
    );
    expect(moved.results[0].parent).toBe(conflictTarget.id);
    expect(operations.getClipboard()).toEqual({
      mode: "copy",
      ids: [other.id],
    });
  });

  test("forgets cut items that are deleted or dragged away", async () => {
    const { conflictSource, conflictTarget } = createConflictFixture();
    const [a, b, c] = ["a.txt", "b.txt", "c.txt"].map((name) =>
      fs.createFile(conflictSource.id, name),
    );
    operations.cut([a.id, b.id]);
    // Deleting something else leaves the clipboard as it is.
    operations.removeToBin([c.id]);
    expect(operations.getClipboard()).toEqual({
      mode: "cut",
      ids: [a.id, b.id],
    });
    operations.removeToBin([a.id]);
    expect(operations.getClipboard()).toEqual({ mode: "cut", ids: [b.id] });
    // A drag of an item that is not cut leaves the clipboard as it is.
    const dragged = fs.createFile(conflictSource.id, "dragged.txt");
    await operations.pasteWithConflicts(conflictTarget.id, () => "rename", {
      items: { mode: "cut", ids: [dragged.id] },
    });
    expect(operations.getClipboard()).toEqual({ mode: "cut", ids: [b.id] });
    // A drag of the last cut item empties the clipboard, so Paste cannot
    // move it again.
    await operations.pasteWithConflicts(conflictTarget.id, () => "rename", {
      items: { mode: "cut", ids: [b.id] },
    });
    expect(fs.getNode(b.id).parent).toBe(conflictTarget.id);
    expect(operations.getClipboard()).toBeNull();
    expect(operations.canPaste(conflictSource.id)).toBe(false);
  });

  test("forgets clipboard items however they are deleted", () => {
    const { source, nested, note, destination } = createClipboardFixture();
    const other = fs.createFile(destination.id, "other.txt");
    // Shift+Delete destroys the item without the Recycle Bin.
    operations.copy([note.id, other.id]);
    fs.destroy(other.id);
    expect(operations.getClipboard()).toEqual({
      mode: "copy",
      ids: [note.id],
    });
    expect(operations.canPaste(destination.id)).toBe(true);
    // An item inside a deleted folder goes to the bin with it.
    operations.cut([nested.id]);
    fs.remove(source.id);
    expect(operations.getClipboard()).toBeNull();
    expect(operations.canPaste(destination.id)).toBe(false);
  });

  test("keeps items cut in the Recycle Bin, so Paste takes them out", async () => {
    const { note, destination } = createClipboardFixture();
    operations.removeToBin([note.id]);
    operations.cut([note.id]);
    fs.createFile(destination.id, "unrelated.txt");
    expect(operations.getClipboard()).toEqual({ mode: "cut", ids: [note.id] });
    // Emptying the bin destroys it, so it leaves the clipboard.
    operations.emptyRecycleBin();
    expect(operations.getClipboard()).toBeNull();
    const kept = fs.createFile(destination.id, "kept.txt");
    operations.removeToBin([kept.id]);
    operations.cut([kept.id]);
    await operations.pasteWithConflicts(destination.id);
    expect(fs.getNode(kept.id).parent).toBe(destination.id);
    expect(fs.isInRecycleBin(kept.id)).toBe(false);
    // Restored and deleted again, it went to the bin after the cut.
    const again = fs.createFile(destination.id, "again.txt");
    operations.removeToBin([again.id]);
    operations.cut([again.id]);
    await operations.restore([again.id]);
    expect(operations.getClipboard()).toEqual({ mode: "cut", ids: [again.id] });
    operations.removeToBin([again.id]);
    expect(operations.getClipboard()).toBeNull();
  });

  test("skips items deleted while a paste runs and keeps them off the clipboard", async () => {
    const { conflictSource, conflictTarget } = createConflictFixture();
    const [a, b, c, d] = ["a.txt", "b.txt", "c.txt", "d.txt"].map((name) =>
      fs.createFile(conflictSource.id, name),
    );
    operations.cut([a.id, b.id, c.id, d.id]);
    let checks = 0;
    const completed = [];
    const result = await operations.pasteWithConflicts(
      conflictTarget.id,
      () => "rename",
      {
        // Cancel comes before d moves.
        isCancelled: () => ++checks === 4,
        onProgress: (progress) => {
          completed.push(progress.completed);
          // After a moves, b goes to the bin and c is destroyed.
          if (fs.getNode(c.id)) {
            fs.remove(b.id);
            fs.destroy(c.id);
          }
        },
      },
    );
    expect(result.cancelled).toBe(true);
    expect(fs.getNode(a.id).parent).toBe(conflictTarget.id);
    expect(fs.isInRecycleBin(b.id)).toBe(true);
    expect(fs.getNode(c.id)).toBeNull();
    // Cancel keeps only d, the item still waiting.
    expect(operations.getClipboard()).toEqual({ mode: "cut", ids: [d.id] });
    // Skipped items count as done, so the progress bar moves on.
    expect(completed).toEqual([1, 2, 3]);
  });

  test("takes items out of the Recycle Bin only if they were there when picked", async () => {
    const { conflictSource, conflictFile, conflictTarget } =
      createConflictFixture();
    const binned = fs.createFile(conflictSource.id, "binned.txt");
    const gone = fs.createFile(conflictSource.id, "gone.txt");
    operations.removeToBin([conflictFile.id, binned.id]);
    // Cut in the bin, restored and deleted again while the question is open.
    fs.createFile(conflictTarget.id, conflictFile.name);
    operations.cut([conflictFile.id]);
    await operations.pasteWithConflicts(conflictTarget.id, async () => {
      await operations.restore([conflictFile.id]);
      operations.removeToBin([conflictFile.id]);
      return "rename";
    });
    expect(fs.isInRecycleBin(conflictFile.id)).toBe(true);
    // A drag that started outside the bin skips items deleted since.
    await operations.pasteWithConflicts(conflictTarget.id, null, {
      items: { mode: "cut", ids: [binned.id], fromBin: [] },
    });
    expect(fs.isInRecycleBin(binned.id)).toBe(true);
    // Without fromBin, the items in the bin now count as picked there.
    await operations.pasteWithConflicts(conflictTarget.id, null, {
      items: { mode: "cut", ids: [binned.id] },
    });
    expect(fs.getNode(binned.id).parent).toBe(conflictTarget.id);
    await expect(
      operations.pasteWithConflicts(conflictTarget.id, null, {
        items: { mode: "cut" },
      }),
    ).rejects.toThrow("items must be an array");
    // A fromBin that is not a list counts as missing.
    operations.removeToBin([binned.id]);
    await operations.pasteWithConflicts(conflictSource.id, null, {
      items: { mode: "cut", ids: [binned.id], fromBin: "bad" },
    });
    expect(fs.getNode(binned.id).parent).toBe(conflictSource.id);
    // Destroyed items are skipped.
    fs.destroy(gone.id);
    expect(
      await operations.pasteWithConflicts(conflictTarget.id, null, {
        items: { mode: "cut", ids: [gone.id] },
      }),
    ).toEqual({ cancelled: false, results: [] });
  });

  test("skips an item deleted while the conflict question is open", async () => {
    const { conflictSource, conflictFile, conflictTarget } =
      createConflictFixture();
    operations.cut([conflictFile.id]);
    const result = await operations.pasteWithConflicts(
      conflictTarget.id,
      () => {
        fs.remove(conflictFile.id);
        return "replace";
      },
    );
    expect(result).toEqual({ cancelled: false, results: [] });
    expect(fs.isInRecycleBin(conflictFile.id)).toBe(true);
    expect(fs.getNode(conflictSource.id).parent).toBe(fs.MY_DOCUMENTS);
    expect(operations.getClipboard()).toBeNull();
  });

  test("keeps a cut or copy made while a paste runs", async () => {
    const { conflictSource, conflictTarget } = createConflictFixture();
    const file = fs.createFile(conflictSource.id, "moving.txt");
    const later = fs.createFile(conflictSource.id, "later.txt");
    operations.cut([file.id]);
    const paste = operations.pasteWithConflicts(conflictTarget.id, () => {
      return "rename";
    });
    operations.copy([later.id]);
    await paste;
    expect(fs.getNode(file.id).parent).toBe(conflictTarget.id);
    expect(operations.getClipboard()).toEqual({
      mode: "copy",
      ids: [later.id],
    });
  });

  test("cancels a conflicting paste atomically and keeps the cut clipboard", async () => {
    const { conflictSource, conflictFile, conflictTarget } =
      createConflictFixture();

    operations.cut([conflictFile.id]);
    const cancelled = await operations.pasteWithConflicts(
      conflictTarget.id,
      () => "cancel",
    );
    expect(cancelled.cancelled).toBe(true);
    expect(fs.getNode(conflictFile.id).parent).toBe(conflictSource.id);
    expect(operations.getClipboard()).toEqual({
      mode: "cut",
      ids: [conflictFile.id],
    });
  });

  test("replaces only a conflicting file and completes the move", async () => {
    const { conflictFile, conflictTarget, existingFile } =
      createConflictFixture();

    operations.cut([conflictFile.id]);
    const replaced = await operations.pasteWithConflicts(
      conflictTarget.id,
      () => "replace",
    );
    expect(replaced.cancelled).toBe(false);
    expect(fs.getNode(existingFile.id)).toBe(null);
    expect(fs.getNode(conflictFile.id).parent).toBe(conflictTarget.id);
    expect(operations.getClipboard()).toBe(null);
  });

  test("skips a conflicting item when the answer is No, and moves the rest", async () => {
    const { conflictSource, conflictFile, conflictTarget, existingFile } =
      createConflictFixture();
    const free = fs.createFile(conflictSource.id, "free.txt");

    operations.cut([conflictFile.id, free.id]);
    const skipped = await operations.pasteWithConflicts(
      conflictTarget.id,
      () => "skip",
    );
    expect(skipped.results.map((node) => node.id)).toEqual([free.id]);
    expect(fs.getNode(conflictFile.id).parent).toBe(conflictSource.id);
    expect(fs.getContent(existingFile.id)).toBe("old");
    expect(fs.getChildren(conflictTarget.id).map((node) => node.name)).toEqual([
      "same.txt",
      "same-folder",
      "free.txt",
    ]);
  });

  test("merges a copied folder into the folder with its name, and asks for each clash inside", async () => {
    const { conflictFolder, conflictTarget } = createConflictFixture();
    const existingFolder = fs.findChild(conflictTarget.id, "same-folder");
    const kept = fs.createFile(existingFolder.id, "kept.txt", {
      content: "kept",
    });
    const clash = fs.createFile(existingFolder.id, "clash.txt", {
      content: "old",
    });
    fs.createFile(conflictFolder.id, "clash.txt", { content: "new" });
    fs.createFile(conflictFolder.id, "added.txt");
    const deep = fs.createFolder(conflictFolder.id, "deep");
    fs.createFile(deep.id, "inner.txt");

    const questions = [];
    operations.copy([conflictFolder.id]);
    const result = await operations.pasteWithConflicts(
      conflictTarget.id,
      ({ source, existing, mode }) => {
        questions.push([source.name, existing.id, mode]);
        return "replace";
      },
    );
    expect(questions).toEqual([
      ["same-folder", existingFolder.id, "copy"],
      ["clash.txt", clash.id, "copy"],
    ]);
    expect(result.results.map((node) => node.id)).toEqual([existingFolder.id]);
    expect(fs.getNode(clash.id)).toBeNull();
    expect(fs.getContent(kept.id)).toBe("kept");
    const names = fs.getChildren(existingFolder.id).map((node) => node.name);
    expect(names.sort()).toEqual([
      "added.txt",
      "clash.txt",
      "deep",
      "kept.txt",
    ]);
    expect(fs.getContent(fs.findChild(existingFolder.id, "clash.txt").id)).toBe(
      "new",
    );
    const deepCopy = fs.findChild(existingFolder.id, "deep");
    expect(fs.findChild(deepCopy.id, "inner.txt")).toBeTruthy();
    // A copy leaves the source folder as it was.
    expect(fs.getChildren(conflictFolder.id).length).toBe(3);
    expect(fs.findChild(conflictTarget.id, "same-folder (2)")).toBeNull();
  });

  test("merges a moved folder and removes it only when nothing stays behind", async () => {
    const { conflictSource, conflictFolder, conflictTarget } =
      createConflictFixture();
    const existingFolder = fs.findChild(conflictTarget.id, "same-folder");
    fs.createFile(existingFolder.id, "clash.txt", { content: "old" });
    const clash = fs.createFile(conflictFolder.id, "clash.txt", {
      content: "new",
    });
    const added = fs.createFile(conflictFolder.id, "added.txt");

    operations.cut([conflictFolder.id]);
    await operations.pasteWithConflicts(conflictTarget.id, ({ source }) =>
      source.id === clash.id ? "skip" : "replace",
    );
    expect(fs.getNode(added.id).parent).toBe(existingFolder.id);
    // The skipped file keeps its folder in place.
    expect(fs.getNode(clash.id).parent).toBe(conflictFolder.id);
    expect(fs.getNode(conflictFolder.id).parent).toBe(conflictSource.id);

    operations.cut([conflictFolder.id]);
    await operations.pasteWithConflicts(conflictTarget.id, () => "replace");
    expect(fs.getNode(clash.id).parent).toBe(existingFolder.id);
    expect(fs.getContent(clash.id)).toBe("new");
    expect(fs.getNode(conflictFolder.id)).toBeNull();
    expect(operations.getClipboard()).toBeNull();
  });

  test("leaves an item that left the folder while a question was open", async () => {
    const { conflictSource, conflictFolder, conflictTarget } =
      createConflictFixture();
    const existingFolder = fs.findChild(conflictTarget.id, "same-folder");
    const gone = fs.createFile(conflictFolder.id, "gone.txt");
    const away = fs.createFile(conflictFolder.id, "away.txt");

    operations.cut([conflictFolder.id]);
    await operations.pasteWithConflicts(conflictTarget.id, () => {
      fs.remove(gone.id);
      fs.move(away.id, conflictSource.id);
      return "replace";
    });
    expect(fs.isInRecycleBin(gone.id)).toBe(true);
    expect(fs.getNode(away.id).parent).toBe(conflictSource.id);
    expect(fs.getChildren(existingFolder.id)).toEqual([]);
    // The folder is empty now, so the move removes it.
    expect(fs.getNode(conflictFolder.id)).toBeNull();
  });

  test("puts an item in with its own name when the item it replaces was renamed", async () => {
    const { conflictFolder, conflictTarget } = createConflictFixture();
    const existingFolder = fs.findChild(conflictTarget.id, "same-folder");
    const inside = fs.createFile(conflictFolder.id, "inside.txt");

    operations.copy([conflictFolder.id]);
    const result = await operations.pasteWithConflicts(
      conflictTarget.id,
      () => {
        fs.rename(existingFolder.id, "renamed");
        return "replace";
      },
    );
    expect(result.results[0].name).toBe("same-folder");
    expect(result.results[0].id).not.toBe(existingFolder.id);
    expect(fs.findChild(result.results[0].id, "inside.txt")).toBeTruthy();
    expect(fs.getChildren(existingFolder.id)).toEqual([]);
    expect(fs.getNode(inside.id).parent).toBe(conflictFolder.id);

    // The same holds for a file inside a folder that merges.
    const clash = fs.createFile(existingFolder.id, "inside.txt", {
      content: "old",
    });
    fs.rename(result.results[0].id, "other");
    fs.rename(existingFolder.id, "same-folder");
    const merged = await operations.pasteWithConflicts(
      conflictTarget.id,
      ({ existing }) => {
        if (existing.id === clash.id) fs.rename(clash.id, "renamed.txt");
        return "replace";
      },
    );
    expect(merged.results[0].id).toBe(existingFolder.id);
    expect(
      fs
        .getChildren(existingFolder.id)
        .map((node) => node.name)
        .sort(),
    ).toEqual(["inside.txt", "renamed.txt"]);
    expect(fs.getContent(clash.id)).toBe("old");
  });

  test("refuses to put a file where a folder has its name, and the other way", async () => {
    const { conflictSource, conflictTarget } = createConflictFixture();
    const file = fs.createFile(conflictSource.id, "item");
    fs.createFolder(conflictTarget.id, "item");
    const folder = fs.createFolder(conflictSource.id, "box");
    fs.createFile(conflictTarget.id, "box");
    let asked = false;
    const ask = () => {
      asked = true;
      return "replace";
    };

    operations.cut([file.id]);
    await expect(
      operations.pasteWithConflicts(conflictTarget.id, ask),
    ).rejects.toThrow(
      "Cannot move item: A folder with the name you specified already exists. Specify a different file name.",
    );
    operations.copy([folder.id]);
    await expect(
      operations.pasteWithConflicts(conflictTarget.id, ask),
    ).rejects.toThrow(
      "Cannot copy box: A file with the name you specified already exists. Specify a different file name.",
    );
    expect(asked).toBe(false);
    expect(fs.getNode(file.id).parent).toBe(conflictSource.id);
  });

  test("cancels on an unknown answer or with no resolver, and changes nothing", async () => {
    const { conflictFile, conflictTarget, existingFile } =
      createConflictFixture();

    operations.copy([conflictFile.id]);
    for (const resolver of [() => "unexpected", () => "rename", undefined]) {
      const result = await operations.pasteWithConflicts(
        conflictTarget.id,
        resolver,
      );
      expect(result).toEqual({ cancelled: true, results: [] });
    }
    expect(fs.getContent(existingFile.id)).toBe("old");
    expect(fs.getChildren(conflictTarget.id).length).toBe(2);
  });

  test("rejects protected destinations before running the resolver", async () => {
    const { conflictFile } = createConflictFixture();
    operations.copy([conflictFile.id]);

    let called = false;
    await expect(
      operations.pasteWithConflicts(fs.MY_COMPUTER, () => {
        called = true;
        return "rename";
      }),
    ).rejects.toThrow(/You cannot save in the folder you specified/);
    expect(called).toBe(false);
  });

  test("preflights every conflict decision so a later cancel leaves everything untouched", async () => {
    const { atomicSource, atomicA, atomicB, atomicTarget, oldA, oldB } =
      createAtomicFixture();

    operations.cut([atomicA.id, atomicB.id]);
    let decisions = 0;
    const atomicCancelled = await operations.pasteWithConflicts(
      atomicTarget.id,
      () => (++decisions === 1 ? "replace" : "cancel"),
    );
    expect(atomicCancelled.cancelled).toBe(true);
    expect(fs.getNode(oldA.id) && fs.getNode(oldB.id)).toBeTruthy();
    expect(fs.getNode(atomicA.id).parent).toBe(atomicSource.id);
    expect(fs.getNode(atomicB.id).parent).toBe(atomicSource.id);
    expect(operations.getClipboard()).toEqual({
      mode: "cut",
      ids: [atomicA.id, atomicB.id],
    });
  });

  test('names a same-folder conflict-aware copy "Copy of"', async () => {
    const { atomicSource, atomicA } = createAtomicFixture();

    operations.copy([atomicA.id]);
    const sameCopy = await operations.pasteWithConflicts(
      atomicSource.id,
      () => "rename",
    );
    expect(sameCopy.results[0].name).toBe("Copy of a.txt");
  });

  test("treats a same-folder cut as a no-op and retains the clipboard", async () => {
    const { atomicSource, atomicB } = createAtomicFixture();

    operations.cut([atomicB.id]);
    const sameCut = await operations.pasteWithConflicts(
      atomicSource.id,
      () => "replace",
    );
    expect(sameCut.cancelled).toBe(false);
    expect(sameCut.results[0].id).toBe(atomicB.id);
    expect(operations.getClipboard()).toEqual({
      mode: "cut",
      ids: [atomicB.id],
    });
  });

  test("restores only top-level Recycle Bin items without partial restores", async () => {
    const recycledFolder = operations.createFolder(
      fs.MY_DOCUMENTS,
      "Recycled Folder",
    );
    const recycledChild = operations.createFile(
      recycledFolder.id,
      "nested.txt",
    );
    const recycledDirect = operations.createFile(fs.MY_DOCUMENTS, "direct.txt");
    operations.removeToBin([recycledFolder.id, recycledDirect.id]);
    await expect(
      operations.restore([recycledDirect.id, recycledChild.id]),
    ).rejects.toThrow(/top-level Recycle Bin items/);
    expect(fs.getNode(recycledDirect.id).parent).toBe(fs.RECYCLE_BIN);
    expect(fs.getNode(recycledChild.id).parent).toBe(recycledFolder.id);
  });

  test("restores an item to the Desktop when its original folder is still recycled", async () => {
    const fallbackFolder = operations.createFolder(
      fs.MY_DOCUMENTS,
      "Fallback Folder",
    );
    const fallbackChild = operations.createFile(
      fallbackFolder.id,
      "fallback.txt",
    );
    operations.removeToBin([fallbackChild.id]);
    operations.removeToBin([fallbackFolder.id]);
    await operations.restore([fallbackChild.id]);
    expect(fs.getNode(fallbackChild.id).parent).toBe(fs.DESKTOP);
    expect(fs.isInRecycleBin(fallbackChild.id)).toBe(false);
  });

  test("restores a selected ancestor first so its child returns to its original folder", async () => {
    const selectedFolder = operations.createFolder(
      fs.MY_DOCUMENTS,
      "Selected Folder",
    );
    const selectedChild = operations.createFile(
      selectedFolder.id,
      "selected.txt",
    );
    operations.removeToBin([selectedChild.id]);
    operations.removeToBin([selectedFolder.id]);
    await operations.restore([selectedChild.id, selectedFolder.id]);
    expect(fs.getNode(selectedFolder.id).parent).toBe(fs.MY_DOCUMENTS);
    expect(fs.getNode(selectedChild.id).parent).toBe(selectedFolder.id);
  });

  test("restores a file to its nested folder when a higher folder is also selected", async () => {
    const outer = operations.createFolder(fs.MY_DOCUMENTS, "Outer");
    const inner = operations.createFolder(outer.id, "Inner");
    const file = operations.createFile(inner.id, "deep.txt");
    operations.removeToBin([file.id]);
    operations.removeToBin([outer.id]);
    await operations.restore([file.id, outer.id]);
    expect(fs.getNode(outer.id).parent).toBe(fs.MY_DOCUMENTS);
    expect(fs.getNode(file.id).parent).toBe(inner.id);
  });

  test("keeps a file that was renamed while the replace dialog was open", async () => {
    const { conflictFile, conflictTarget, existingFile } =
      createConflictFixture();

    operations.cut([conflictFile.id]);
    await operations.pasteWithConflicts(conflictTarget.id, () => {
      operations.rename(existingFile.id, "kept.txt");
      return "replace";
    });
    expect(fs.getNode(existingFile.id).name).toBe("kept.txt");
    expect(fs.getNode(conflictFile.id).parent).toBe(conflictTarget.id);
    expect(fs.getNode(conflictFile.id).name).toBe("same.txt");
  });

  test("keeps a copy clipboard unchanged when a copy fails", async () => {
    const { note, destination } = createClipboardFixture();
    const copy = fs.copy;
    fs.copy = () => {
      throw new Error("synthetic storage failure");
    };
    operations.copy([note.id]);
    await expect(operations.pasteWithConflicts(destination.id)).rejects.toThrow(
      "synthetic storage failure",
    );
    fs.copy = copy;
    expect(operations.getClipboard()).toEqual({ mode: "copy", ids: [note.id] });
  });

  test("leaves only unmoved items on the clipboard when a paste fails partway", async () => {
    const { source, note, destination } = createClipboardFixture();
    const other = operations.createFile(source.id, "other.txt");
    const move = fs.move;
    let moves = 0;
    fs.move = (...args) => {
      moves += 1;
      if (moves === 2) throw new Error("synthetic storage failure");
      return move(...args);
    };
    operations.cut([note.id, other.id]);
    await expect(operations.pasteWithConflicts(destination.id)).rejects.toThrow(
      "synthetic storage failure",
    );
    fs.move = move;
    expect(fs.getNode(note.id).parent).toBe(destination.id);
    expect(fs.getNode(other.id).parent).toBe(source.id);
    expect(operations.getClipboard()).toEqual({ mode: "cut", ids: [other.id] });
  });

  test("restores original names after temporary Recycle Bin conflict names", async () => {
    const nameFolderA = operations.createFolder(fs.MY_DOCUMENTS, "Name A");
    const nameFolderB = operations.createFolder(fs.MY_DOCUMENTS, "Name B");
    const sameNameA = operations.createFile(nameFolderA.id, "same-name.txt");
    const sameNameB = operations.createFile(nameFolderB.id, "same-name.txt");
    operations.removeToBin([sameNameA.id, sameNameB.id]);
    expect(fs.getNode(sameNameA.id).name).not.toBe(
      fs.getNode(sameNameB.id).name,
    );
    await operations.restore([sameNameA.id, sameNameB.id]);
    expect(fs.getNode(sameNameA.id).name).toBe("same-name.txt");
    expect(fs.getNode(sameNameB.id).name).toBe("same-name.txt");
    expect(fs.getNode(sameNameA.id).originalName).toBe(null);
    expect(fs.getNode(sameNameB.id).originalName).toBe(null);
  });

  test("moves only processed items when progress is cancelled and keeps the rest on the clipboard", async () => {
    const { destination } = createClipboardFixture();
    const { atomicSource, atomicA, atomicB } = createAtomicFixture();

    operations.cut([atomicA.id, atomicB.id]);
    let stop = false;
    const partial = await operations.pasteWithConflicts(
      destination.id,
      () => "rename",
      {
        onProgress: () => {
          stop = true;
        },
        isCancelled: () => stop,
      },
    );
    expect(partial.cancelled).toBe(true);
    expect(partial.results.length).toBe(1);
    expect(fs.getNode(atomicA.id).parent).toBe(destination.id);
    expect(fs.getNode(atomicB.id).parent).toBe(atomicSource.id);
    expect(operations.getClipboard()).toEqual({
      mode: "cut",
      ids: [atomicB.id],
    });
  });

  test("isolates listener failures and rejects invalid listeners", () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    let calls = 0;
    operations.subscribe(() => {
      throw new Error("listener failed");
    });
    operations.subscribe(() => calls++);
    try {
      operations.copy([fs.MY_DOCUMENTS]);
    } finally {
      console.error = original;
    }
    expect(errors[0][0]).toBe("FileOperations listener error:");
    expect(calls).toBe(1);
    expect(() => operations.subscribe(null)).toThrow("must be a function");
  });

  test("rejects invalid selections and destinations", async () => {
    const { note, source, nested } = createClipboardFixture();
    expect(() => operations.copy("not-an-array")).toThrow("must be an array");
    expect(() => operations.copy([])).toThrow("Select at least one item.");
    expect(() => operations.copy(["missing"])).toThrow(
      "Cannot find the file or folder.",
    );
    operations.copy([note.id]);
    await expect(operations.pasteWithConflicts(note.id)).rejects.toThrow(
      "The destination is not a folder.",
    );
    operations.copy([source.id]);
    await expect(operations.pasteWithConflicts(nested.id)).rejects.toThrow(
      "Cannot copy Source: The destination folder is a subfolder of the source folder.",
    );
    await expect(operations.pasteWithConflicts(source.id)).rejects.toThrow(
      "subfolder of the source folder",
    );
    expect(operations.canPaste(nested.id)).toBeFalse();
    operations.cut([source.id]);
    await expect(operations.pasteWithConflicts(nested.id)).rejects.toThrow(
      "subfolder of the source folder",
    );
    fs.getNode(source.id).protected = true;
    await expect(operations.pasteWithConflicts(fs.DESKTOP)).rejects.toThrow(
      "Access is denied.",
    );
    expect(() => operations.cut([fs.MY_DOCUMENTS])).toThrow(
      "Access is denied.",
    );
    operations.resetForTests();
    await expect(operations.pasteWithConflicts(fs.DESKTOP)).rejects.toThrow(
      "The Clipboard is empty.",
    );
  });

  test("stops a cancelled copy", async () => {
    const { note, destination } = createClipboardFixture();
    operations.copy([note.id]);
    const stopped = await operations.pasteWithConflicts(destination.id, null, {
      isCancelled: () => true,
    });
    expect(stopped).toEqual({ cancelled: true, results: [] });
    expect(operations.getClipboard().mode).toBe("copy");
  });

  test("clears a cut clipboard when every remaining item disappears during a cancelled paste", async () => {
    const { note, destination } = createClipboardFixture();
    operations.createFile(destination.id, "note.txt");
    operations.cut([note.id]);
    const result = await operations.pasteWithConflicts(
      destination.id,
      async () => {
        await fs.destroy(note.id);
        return "replace";
      },
      { isCancelled: () => true },
    );
    expect(result.cancelled).toBeTrue();
    expect(operations.getClipboard()).toBeNull();
  });

  test("restores items whose original folders refer to each other", async () => {
    const first = operations.createFolder(fs.DESKTOP, "First");
    const second = operations.createFolder(fs.DESKTOP, "Second");
    operations.removeToBin([first.id, second.id]);
    fs.getNode(first.id).originalParent = second.id;
    fs.getNode(second.id).originalParent = first.id;
    const { results: restored } = await operations.restore([
      first.id,
      second.id,
    ]);
    expect(restored.map((node) => node.parent)).toEqual([fs.DESKTOP, first.id]);
  });

  // Like XP, a restore over a folder with the same name puts the items in
  // that folder. A file from a folder inside it goes back to that folder.
  test("restore joins a folder with the folder that has its name", async () => {
    const old = operations.createFolder(fs.MY_DOCUMENTS, "Old");
    const sub = operations.createFolder(old.id, "Sub");
    const deep = operations.createFile(sub.id, "deep.txt");
    const kept = operations.createFile(old.id, "kept.txt");
    operations.removeToBin([deep.id]);
    operations.removeToBin([old.id]);
    const again = operations.createFolder(fs.MY_DOCUMENTS, "Old");
    const asked = [];
    const { cancelled } = await operations.restore(
      [old.id, deep.id],
      ({ existing }) => {
        asked.push(existing.name);
        return "replace";
      },
    );
    expect(cancelled).toBe(false);
    expect(asked).toEqual(["Old"]);
    expect(fs.getNode(kept.id).parent).toBe(again.id);
    expect(fs.getNode(sub.id).parent).toBe(again.id);
    expect(fs.getNode(deep.id).parent).toBe(sub.id);
    expect(fs.isInRecycleBin(deep.id)).toBe(false);
  });

  test("restore reports a file that cannot take the name of a folder", async () => {
    const file = operations.createFile(fs.MY_DOCUMENTS, "item");
    operations.removeToBin([file.id]);
    operations.createFolder(fs.MY_DOCUMENTS, "item");
    await expect(
      operations.restore([file.id], () => "replace"),
    ).rejects.toThrow(
      "Cannot move item: A folder with the name you specified already exists.",
    );
    expect(fs.getNode(file.id).parent).toBe(fs.RECYCLE_BIN);
  });

  // An item that an old version put in the bin can have no original name.
  // It goes back with the name it has.
  test("restore keeps the name of an item with no original name", async () => {
    const file = operations.createFile(fs.MY_DOCUMENTS, "plain.txt");
    fs.remove(file.id);
    fs.getNode(file.id).originalName = null;
    await operations.restore([file.id]);
    expect(fs.getNode(file.id)).toMatchObject({
      parent: fs.MY_DOCUMENTS,
      name: "plain.txt",
    });
  });

  test("import works with no options, and No on an item in a folder skips it", async () => {
    const folder = operations.createFolder(fs.MY_DOCUMENTS, "Tree");
    const old = operations.createFile(folder.id, "a.txt", { content: "old" });
    const item = (name, content) => ({
      type: "file",
      name,
      size: content.length,
      read: async () => content,
    });
    const { results } = await operations.importWithConflicts(
      fs.MY_DOCUMENTS,
      [
        {
          type: "folder",
          name: "Tree",
          children: [item("a.txt", "new"), item("b.txt", "b")],
        },
      ],
      ({ existing }) => (existing.type === "folder" ? "replace" : "skip"),
    );
    expect(results.map((node) => node.id)).toEqual([folder.id]);
    expect(fs.getNode(old.id).content).toBe("old");
    expect(fs.findChild(folder.id, "b.txt").content).toBe("b");
  });
});

describe("file operations loading", () => {
  const scope = globalThis as { VirtualFS?: unknown };

  test("loads the filesystem module itself under CommonJS", () => {
    const loaded = scope.VirtualFS;
    delete scope.VirtualFS;
    try {
      delete require.cache[operationsPath];
      const operations = require(operationsPath);
      const fs = require(fsPath);
      const folder = operations.createFolder(fs.MY_DOCUMENTS, "Loaded");
      expect(fs.getNode(folder.id).name).toBe("Loaded");
    } finally {
      scope.VirtualFS = loaded;
      delete require.cache[operationsPath];
    }
  });

  test("refuses to start in a browser without VirtualFS", async () => {
    const { instrumentSource } = await import("./helpers/coverage");
    const source = instrumentSource(
      await Bun.file(operationsPath).text(),
      operationsPath,
    );
    const loaded = scope.VirtualFS;
    delete scope.VirtualFS;
    try {
      expect(() => new Function("module", source)(undefined)).toThrow(
        "FileOperations requires VirtualFS",
      );
    } finally {
      scope.VirtualFS = loaded;
    }
  });
});
