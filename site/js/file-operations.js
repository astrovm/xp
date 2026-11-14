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

  // Each cut or copy gets a new token. A paste changes the clipboard only
  // while the clipboard still holds the cut that it pastes.
  let clipboardToken = 0;
  const newClipboard = (mode, ids) => ({
    mode,
    ids,
    token: ++clipboardToken,
    // Items cut or copied from the Recycle Bin stay on the clipboard there.
    fromBin: ids.filter((id) => fs.isInRecycleBin(id)),
  });
  const setClipboardIds = (ids) => {
    clipboard = ids.length ? { ...clipboard, ids } : null;
    notify({ type: "clipboard", mode: clipboard?.mode || null });
  };

  // The clipboard forgets items that were destroyed, and items that went to
  // the Recycle Bin after the cut or copy. This runs only after a change was
  // saved, so a failed delete keeps the clipboard. It covers every way to
  // delete: the Delete key, a drag to the bin, uninstall and other tabs.
  // An item is still there when it exists, and is in the Recycle Bin only
  // if it already was there (fromBin).
  const isStillThere = (id, fromBin) =>
    !!fs.getNode(id) && (!fs.isInRecycleBin(id) || fromBin.includes(id));
  const pruneClipboard = () => {
    if (!clipboard) return;
    const remaining = clipboard.ids.filter((id) =>
      isStillThere(id, clipboard.fromBin),
    );
    // An item restored from the bin and deleted again leaves the clipboard.
    clipboard.fromBin = clipboard.fromBin.filter((id) => fs.isInRecycleBin(id));
    if (remaining.length !== clipboard.ids.length) setClipboardIds(remaining);
  };

  // A filesystem mutation can come from any shell surface. Forward those
  // changes so views using this service stay synchronized as well.
  fs.subscribe(() => {
    pruneClipboard();
    notify({ type: "filesystem-change" });
  });

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
    clipboard = newClipboard(mode, getTopLevelIds(ids));
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
    clipboard = newClipboard("cut", topLevelIds);
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

  // A move or copy never renames an item to make room, like XP. Each item
  // whose name is in use is a question for resolveConflict, which gets
  // { source, existing, mode } and returns (sync or Promise):
  //   "replace" - a file replaces the file with its name. A folder joins
  //               the folder with its name, and each of its items that
  //               clashes there is a new question.
  //   "skip"    - the item stays where it is.
  //   "cancel"  - nothing changes. Any other answer, or no resolver, also
  //               cancels.
  // A file and a folder with the same name are an error. Every question
  // comes before the first change, so Cancel leaves everything as it was.
  // A copy into its own folder is never a question: it gets a "Copy of"
  // name.
  const cancelled = Symbol("cancelled");
  // A file cannot replace a folder, and a folder cannot replace a file.
  const nameInUseError = (name, existing, mode) =>
    new Error(
      `Cannot ${mode === "cut" ? "move" : "copy"} ${name}: A ${existing.type} with the name you specified already exists. Specify a different file name.`,
    );
  const planItem = async (id, destinationId, mode, resolveConflict) => {
    const source = fs.getNode(id);
    const existing = fs.findChild(destinationId, source.name);
    if (!existing || existing.id === id)
      return { id, destinationId, action: "put" };
    if (existing.type !== source.type)
      throw nameInUseError(source.name, existing, mode);
    const decision = await Promise.resolve(
      resolveConflict?.({ source, existing, mode }),
    );
    if (decision === "skip") return { id, action: "skip" };
    if (decision !== "replace") throw cancelled;
    if (source.type === "file")
      return { id, destinationId, action: "replace", existingId: existing.id };
    const children = [];
    for (const child of fs.getChildren(id))
      children.push(
        await planItem(child.id, existing.id, mode, resolveConflict),
      );
    return {
      id,
      destinationId,
      action: "merge",
      existingId: existing.id,
      children,
    };
  };
  // Runs a plan inside a transaction. It returns the item that now holds
  // the name in the destination, or null for an item that stayed. A folder
  // that a move empties into the folder with its name goes away.
  const runPlan = (plan, mode) => {
    if (plan.action === "skip") return null;
    const node = fs.getNode(plan.id);
    // The item with the name may have moved or changed while a question
    // was open. Then the item goes in with its own name.
    const existing = fs.findChild(plan.destinationId, node.name);
    const planned = existing?.id === plan.existingId ? existing : null;
    if (plan.action === "merge" && planned) {
      // An item deleted or moved out of the folder while a question was
      // open stays where it is now.
      const inside = new Set(fs.getChildren(plan.id).map((child) => child.id));
      plan.children
        .filter((child) => inside.has(child.id))
        .forEach((child) => runPlan(child, mode));
      if (mode === "cut" && !fs.getChildren(plan.id).length)
        fs.destroy(plan.id);
      return planned;
    }
    if (plan.action === "replace" && planned) fs.destroy(planned.id);
    return mode === "cut"
      ? fs.move(plan.id, plan.destinationId)
      : fs.copy(plan.id, plan.destinationId);
  };

  // options.items ({ mode, ids, fromBin }) moves or copies those items
  // instead of the clipboard, and leaves the clipboard as it is, like a
  // drag. fromBin lists the items that were in the Recycle Bin at drag
  // start. Without it, the items in the bin when the paste starts count.
  const pasteWithConflicts = async (
    destinationId,
    resolveConflict,
    options = {},
  ) => {
    const usesClipboard = !options.items;
    const source = options.items || clipboard;
    if (!source) throw new Error("FileOperations: clipboard is empty");
    assertWritableFolder(destinationId);
    if (!Array.isArray(source.ids))
      throw new Error("FileOperations: items must be an array");
    // Items destroyed since the user picked them are skipped.
    const liveIds = source.ids.filter((id) => !!fs.getNode(id));
    if (source.ids.length && !liveIds.length)
      return { cancelled: false, results: [] };
    const ids = getTopLevelIds(liveIds);
    // A paste takes an item out of the Recycle Bin only if it was there
    // when the user picked it (cut, copy or drag start), and is still
    // there. Other items deleted before or during the paste are skipped.
    let fromBin = (Array.isArray(source.fromBin) ? source.fromBin : ids).filter(
      (id) => ids.includes(id) && fs.isInRecycleBin(id),
    );
    const mode = source.mode;
    if (mode === "cut") assertMovableTo(ids, destinationId);
    else assertCopyableTo(ids, destinationId);
    if (
      mode === "cut" &&
      ids.every((id) => fs.getNode(id).parent === destinationId)
    )
      return { cancelled: false, results: ids.map((id) => fs.getNode(id)) };
    // An item that leaves the bin while the paste runs, then goes back,
    // went there after the user picked it.
    const unsubscribe = fs.subscribe(() => {
      fromBin = fromBin.filter((id) => fs.isInRecycleBin(id));
    });
    try {
      const plans = new Map();
      try {
        for (const id of ids)
          plans.set(
            id,
            await planItem(id, destinationId, mode, resolveConflict),
          );
      } catch (error) {
        if (error !== cancelled) throw error;
        return { cancelled: true, results: [] };
      }
      // Items already moved leave a cut clipboard; the rest can be retried.
      // A new cut or copy made during the paste stays on the clipboard.
      const pastesClipboard = () =>
        mode === "cut" && usesClipboard && clipboard?.token === source.token;
      const keepUnmovedOnClipboard = (index) => {
        if (!pastesClipboard()) return;
        setClipboardIds(
          ids
            .slice(index)
            .filter(
              (id) => clipboard.ids.includes(id) && isStillThere(id, fromBin),
            ),
        );
      };
      const results = [];
      for (const [index, id] of ids.entries()) {
        if (options.isCancelled?.()) {
          keepUnmovedOnClipboard(index);
          return { cancelled: true, results };
        }
        const reportProgress = () =>
          options.onProgress?.({
            completed: index + 1,
            total: ids.length,
            mode,
            id,
          });
        if (!isStillThere(id, fromBin)) {
          reportProgress();
          continue;
        }
        try {
          await fs.transaction(() => {
            const result = runPlan(plans.get(id), mode);
            if (result) results.push(result);
          });
        } catch (error) {
          keepUnmovedOnClipboard(index);
          throw error;
        }
        if (mode === "cut" && !usesClipboard) forgetCutItems([id]);
        reportProgress();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (pastesClipboard()) setClipboardIds([]);
      notify({
        type: "paste",
        mode,
        destinationId,
        ids: results.map((node) => node.id),
      });
      return { cancelled: false, results };
    } finally {
      unsubscribe();
    }
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

  // Items dragged away leave a cut clipboard, so a later Paste never moves
  // them again.
  const forgetCutItems = (ids) => {
    if (clipboard?.mode !== "cut") return;
    const remaining = clipboard.ids.filter((id) => !ids.includes(id));
    if (remaining.length !== clipboard.ids.length) setClipboardIds(remaining);
  };

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
    getConflicts,
    nameInUseError,
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
