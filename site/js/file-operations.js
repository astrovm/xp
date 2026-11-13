"use strict";

// ============================================
// Shared Virtual Filesystem Operations
// ============================================
// Desktop, Explorer, and future XP applications use this small service for
// mutations instead of each maintaining its own clipboard or delete rules.

(function (root, factory) {
  const filesystem =
    root.VirtualFS ||
    (typeof module !== "undefined" && module.exports
      ? require("./filesystem.js")
      : null);
  const api = factory(filesystem);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.FileOperations = api;
})(globalThis, function (fs) {
  if (!fs) throw new Error("FileOperations requires VirtualFS");

  let clipboard = null;
  const listeners = new Set();

  const snapshotClipboard = () =>
    clipboard
      ? {
          mode: clipboard.mode,
          ids: [...clipboard.ids],
        }
      : null;

  const getState = () => ({ clipboard: snapshotClipboard() });

  const notify = (event) => {
    const state = getState();
    listeners.forEach((listener) => {
      try {
        listener(state, event);
      } catch (error) {
        console.error("FileOperations listener error:", error);
      }
    });
  };

  const subscribe = (listener) => {
    if (typeof listener !== "function") {
      throw new Error("FileOperations: listener must be a function");
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  // A filesystem mutation can come from any shell surface. Forward those
  // changes so views using this service stay synchronized as well.
  fs.subscribe(() => notify({ type: "filesystem-change" }));

  const requireFolder = (id) => {
    const node = fs.getNode(id);
    if (!node || node.type !== "folder") {
      throw new Error("FileOperations: destination must be a folder");
    }
    return node;
  };

  const assertWritableFolder = (id) => {
    const folder = requireFolder(id);
    // Nothing new goes in the Recycle Bin, or in a folder inside it.
    if (fs.isInRecycleBin(id) || id === fs.MY_COMPUTER) {
      throw new Error("FileOperations: this location cannot accept new items");
    }
    return folder;
  };

  const getTopLevelIds = (ids) => {
    if (!Array.isArray(ids)) {
      throw new Error("FileOperations: items must be an array");
    }
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) {
      throw new Error("FileOperations: select at least one item");
    }
    uniqueIds.forEach((id) => {
      if (!fs.getNode(id))
        throw new Error(`FileOperations: item "${id}" was not found`);
    });
    return uniqueIds.filter(
      (id) =>
        !uniqueIds.some(
          (otherId) => otherId !== id && fs.isDescendantOf(otherId, id),
        ),
    );
  };

  const assertMovableTo = (ids, destinationId) => {
    requireFolder(destinationId);
    ids.forEach((id) => {
      const node = fs.getNode(id);
      if (node.protected) {
        throw new Error(
          `FileOperations: cannot move "${node.name}": access is denied`,
        );
      }
      if (id === destinationId || fs.isDescendantOf(id, destinationId)) {
        throw new Error(
          `FileOperations: cannot move "${node.name}" into itself`,
        );
      }
    });
  };

  const assertCopyableTo = (ids, destinationId) => {
    requireFolder(destinationId);
    ids.forEach((id) => {
      const node = fs.getNode(id);
      if (id === destinationId || fs.isDescendantOf(id, destinationId)) {
        throw new Error(
          `FileOperations: cannot copy "${node.name}" into itself`,
        );
      }
    });
  };

  const setClipboard = (mode, ids) => {
    clipboard = { mode, ids: getTopLevelIds(ids) };
    notify({ type: "clipboard", mode });
    return snapshotClipboard();
  };

  const copy = (ids) => setClipboard("copy", ids);

  const cut = (ids) => {
    const topLevelIds = getTopLevelIds(ids);
    topLevelIds.forEach((id) => {
      const node = fs.getNode(id);
      if (node.protected) {
        throw new Error(
          `FileOperations: cannot cut "${node.name}": access is denied`,
        );
      }
    });
    clipboard = { mode: "cut", ids: topLevelIds };
    notify({ type: "clipboard", mode: "cut" });
    return snapshotClipboard();
  };

  const canPaste = (destinationId) => {
    if (!clipboard) return false;
    try {
      assertWritableFolder(destinationId);
      const ids = getTopLevelIds(clipboard.ids);
      if (clipboard.mode === "cut") assertMovableTo(ids, destinationId);
      else assertCopyableTo(ids, destinationId);
      return true;
    } catch (error) {
      return false;
    }
  };

  const paste = (destinationId) => {
    if (!clipboard) throw new Error("FileOperations: clipboard is empty");
    assertWritableFolder(destinationId);
    const ids = getTopLevelIds(clipboard.ids);
    const mode = clipboard.mode;
    if (mode === "cut") assertMovableTo(ids, destinationId);
    else assertCopyableTo(ids, destinationId);

    // VirtualFS deduplicates conflicts deterministically. All validation
    // happens before mutations so ordinary paste failures preserve state.
    const results =
      mode === "cut"
        ? ids.map((id) => fs.move(id, destinationId))
        : ids.map((id) => fs.copy(id, destinationId));
    if (mode === "cut") {
      clipboard = null;
      notify({ type: "clipboard", mode: null });
    }
    notify({
      type: "paste",
      mode,
      destinationId,
      ids: results.map((node) => node.id),
    });
    return results;
  };

  const getConflicts = (ids, destinationId) => {
    requireFolder(destinationId);
    return getTopLevelIds(ids)
      .map((id) => ({
        source: fs.getNode(id),
        existing: fs.findChild(destinationId, fs.getNode(id).name),
      }))
      .filter(
        ({ source, existing }) => !!existing && existing.id !== source.id,
      );
  };

  // Resolver receives { source, existing, mode } and returns "replace",
  // "rename", or "cancel" (sync or Promise). Replace is limited to files;
  // folders always use the filesystem's deterministic copy naming.
  // options.items ({ mode, ids }) moves or copies those items instead of
  // the clipboard, and leaves the clipboard as it is, like a drag.
  const pasteWithConflicts = async (
    destinationId,
    resolveConflict,
    options = {},
  ) => {
    const usesClipboard = !options.items;
    const source = options.items || clipboard;
    if (!source) throw new Error("FileOperations: clipboard is empty");
    assertWritableFolder(destinationId);
    const ids = getTopLevelIds(source.ids);
    const mode = source.mode;
    if (mode === "cut") assertMovableTo(ids, destinationId);
    else assertCopyableTo(ids, destinationId);
    if (
      mode === "cut" &&
      ids.every((id) => fs.getNode(id).parent === destinationId)
    )
      return { cancelled: false, results: ids.map((id) => fs.getNode(id)) };
    const decisions = [];
    for (const conflict of getConflicts(ids, destinationId)) {
      const response = await Promise.resolve(
        resolveConflict?.({ ...conflict, mode }) || "rename",
      );
      const decision = ["replace", "rename", "cancel"].includes(response)
        ? response
        : "rename";
      if (decision === "cancel") return { cancelled: true, results: [] };
      decisions.push({ conflict, decision });
    }
    // Items already moved leave a cut clipboard; the rest can be retried.
    const keepUnmovedOnClipboard = (index) => {
      if (mode !== "cut" || !usesClipboard) return;
      const remaining = ids
        .slice(index)
        .filter((remainingId) => !!fs.getNode(remainingId));
      clipboard = remaining.length ? { mode: "cut", ids: remaining } : null;
      notify({ type: "clipboard", mode: clipboard?.mode || null });
    };
    const results = [];
    for (const [index, id] of ids.entries()) {
      if (options.isCancelled?.()) {
        keepUnmovedOnClipboard(index);
        return { cancelled: true, results };
      }
      const planned = decisions.find(
        ({ conflict }) => conflict.source.id === id,
      );
      try {
        await fs.transaction(() => {
          // Replace only the file that still holds the clashing name; it may
          // have been renamed or moved while the conflict dialog was open.
          const existing =
            planned?.decision === "replace"
              ? fs.findChild(destinationId, fs.getNode(id).name)
              : null;
          if (
            existing?.id === planned?.conflict.existing.id &&
            existing?.type === "file" &&
            planned.conflict.source.type === "file"
          ) {
            fs.destroy(existing.id);
          }
          results.push(
            mode === "cut"
              ? fs.move(id, destinationId)
              : fs.copy(id, destinationId),
          );
        });
      } catch (error) {
        keepUnmovedOnClipboard(index);
        throw error;
      }
      options.onProgress?.({
        completed: index + 1,
        total: ids.length,
        mode,
        id,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (mode === "cut" && usesClipboard) {
      clipboard = null;
      notify({ type: "clipboard", mode: null });
    }
    notify({
      type: "paste",
      mode,
      destinationId,
      ids: results.map((node) => node.id),
    });
    return { cancelled: false, results };
  };

  const createFolder = (parentId, name) => {
    assertWritableFolder(parentId);
    return fs.createFolder(parentId, name);
  };
  const createFile = (parentId, name, options = {}) => {
    assertWritableFolder(parentId);
    return fs.createFile(parentId, name, options);
  };
  const rename = (id, name) => fs.rename(id, name);

  const removeToBin = (ids) => {
    const topLevelIds = getTopLevelIds(ids);
    topLevelIds.forEach((id) => {
      const node = fs.getNode(id);
      if (node.protected || fs.isInRecycleBin(id)) {
        throw new Error(
          `FileOperations: cannot delete "${node.name}" to the Recycle Bin`,
        );
      }
    });
    topLevelIds.forEach((id) => fs.remove(id));
    return topLevelIds;
  };

  const permanentlyDelete = (ids) => {
    const topLevelIds = getTopLevelIds(ids);
    topLevelIds.forEach((id) => {
      const node = fs.getNode(id);
      if (!fs.isInRecycleBin(id) || node.protected) {
        throw new Error(
          `FileOperations: "${node.name}" is not deletable from the Recycle Bin`,
        );
      }
    });
    topLevelIds.forEach((id) => fs.destroy(id));
    return topLevelIds;
  };

  const restore = (ids) => {
    const topLevelIds = getTopLevelIds(ids);
    topLevelIds.forEach((id) => {
      if (fs.getParent(id)?.id !== fs.RECYCLE_BIN) {
        throw new Error(
          "FileOperations: only top-level Recycle Bin items can be restored",
        );
      }
    });
    const pending = new Set(topLevelIds);
    // An item waits while its original folder, or any folder above it, is
    // still in the bin and selected, so it returns to its real location.
    const waitsForPending = (id) => {
      for (
        let folderId = fs.getNode(id)?.originalParent;
        folderId;
        folderId = fs.getNode(folderId)?.parent
      ) {
        if (pending.has(folderId)) return true;
      }
      return false;
    };
    const orderedIds = [];
    while (pending.size) {
      const nextId =
        [...pending].find((id) => !waitsForPending(id)) ||
        pending.values().next().value;
      pending.delete(nextId);
      orderedIds.push(nextId);
    }
    return orderedIds.map((id) => fs.restore(id));
  };

  const emptyRecycleBin = () => fs.emptyRecycleBin();

  // Files from the user's computer keep their data: text stays text, and
  // everything else, like pictures, becomes a data URL.
  const dataUrlFromBlob = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result), {
        once: true,
      });
      reader.addEventListener("error", () => reject(reader.error), {
        once: true,
      });
      reader.readAsDataURL(blob);
    });
  const readFileContent = (file) =>
    file.type.startsWith("text/") || /\.(txt|log|csv|md)$/i.test(file.name)
      ? file.text()
      : dataUrlFromBlob(file);

  const resetForTests = () => {
    clipboard = null;
    listeners.clear();
  };

  return {
    subscribe,
    getState,
    getClipboard: snapshotClipboard,
    getTopLevelIds,
    canPaste,
    copy,
    cut,
    paste: (...args) => fs.transaction(() => paste(...args)),
    getConflicts,
    dataUrlFromBlob,
    readFileContent,
    pasteWithConflicts,
    createFolder,
    createFile,
    rename,
    removeToBin: (...args) => fs.transaction(() => removeToBin(...args)),
    permanentlyDelete: (...args) =>
      fs.transaction(() => permanentlyDelete(...args)),
    restore: (...args) => fs.transaction(() => restore(...args)),
    emptyRecycleBin,
    resetForTests,
  };
});
