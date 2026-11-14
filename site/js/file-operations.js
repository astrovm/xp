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
      throw new Error("A listener must be a function.");
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
      throw new Error("The destination is not a folder.");
    }
    return node;
  };

  const assertWritableFolder = (id) => {
    const folder = requireFolder(id);
    // Nothing new goes in the Recycle Bin, or in a folder inside it.
    if (fs.isInRecycleBin(id) || id === fs.MY_COMPUTER) {
      throw new Error(
        "You cannot save in the folder you specified. Please choose another location.",
      );
    }
    return folder;
  };

  const getTopLevelIds = (ids) => {
    if (!Array.isArray(ids)) {
      throw new Error("The items must be an array.");
    }
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) {
      throw new Error("Select at least one item.");
    }
    uniqueIds.forEach((id) => {
      if (!fs.getNode(id))
        throw new Error(
          "Cannot find the file or folder. Make sure the path and file name are correct.",
        );
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
        throw new Error(`Cannot move ${node.name}: Access is denied.`);
      }
      if (id === destinationId || fs.isDescendantOf(id, destinationId)) {
        throw new Error(
          `Cannot move ${node.name}: The destination folder is a subfolder of the source folder.`,
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
          `Cannot copy ${node.name}: The destination folder is a subfolder of the source folder.`,
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
        throw new Error(`Cannot move ${node.name}: Access is denied.`);
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
  // name is the name that the item takes in the destination. An item in
  // the Recycle Bin goes back with its original name. findExisting finds
  // the item that has a name in a folder. A restore also finds the items
  // that it puts there itself.
  const planItem = async (
    id,
    destinationId,
    mode,
    resolveConflict,
    name = fs.getNode(id).name,
    findExisting = fs.findChild,
  ) => {
    const source = fs.getNode(id);
    const existing = findExisting(destinationId, name);
    if (!existing || existing.id === id)
      return { id, destinationId, name, action: "put" };
    if (existing.type !== source.type)
      throw nameInUseError(name, existing, mode);
    const decision = await Promise.resolve(
      resolveConflict?.({ source, existing, mode }),
    );
    if (decision === "skip") return { id, action: "skip" };
    if (decision !== "replace") throw cancelled;
    if (source.type === "file")
      return {
        id,
        destinationId,
        name,
        action: "replace",
        existingId: existing.id,
      };
    const children = [];
    for (const child of fs.getChildren(id))
      children.push(
        await planItem(
          child.id,
          existing.id,
          mode,
          resolveConflict,
          child.name,
          findExisting,
        ),
      );
    return {
      id,
      destinationId,
      name,
      action: "merge",
      existingId: existing.id,
      children,
    };
  };
  const putItem = (plan, mode) =>
    mode === "cut"
      ? fs.move(plan.id, plan.destinationId)
      : fs.copy(plan.id, plan.destinationId);
  // Runs a plan inside a transaction. It returns the item that now holds
  // the name in the destination, or null for an item that stayed. A folder
  // that a move empties into the folder with its name goes away. put moves
  // or copies the item itself; the items inside a folder always use
  // putItem.
  const runPlan = (plan, mode, put = putItem) => {
    if (plan.action === "skip") return null;
    // The item with the name may have moved or changed while a question
    // was open. Then the item goes in with its own name.
    const existing = fs.findChild(plan.destinationId, plan.name);
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
    return put(plan, mode);
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
    if (!source) throw new Error("The Clipboard is empty.");
    assertWritableFolder(destinationId);
    if (!Array.isArray(source.ids))
      throw new Error("The items must be an array.");
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
  // Saves content in the file with that name in the folder, like the Save
  // As of an XP program. It finds the file when it writes, not when the
  // Replace question was open. So a file that moved away meanwhile keeps
  // its content, and a file that took the name meanwhile gets the new
  // content. The file keeps the case of its name, like Windows. Like XP,
  // the Replace answer is the check: the file is written as it is now.
  const writeFile = (parentId, name, content) =>
    fs.transaction(() => {
      assertWritableFolder(parentId);
      const existing = fs.findChild(parentId, name);
      if (!existing) return fs.createFile(parentId, name, { content });
      if (existing.type !== "file")
        throw new Error(
          `Cannot create the ${name} file. A folder with the name you specified already exists. Specify a different file name.`,
        );
      return fs.setContent(existing.id, content);
    });

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
        throw new Error(`Cannot delete ${node.name}: Access is denied.`);
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
        throw new Error(`Cannot delete ${node.name}: Access is denied.`);
      }
    });
    topLevelIds.forEach((id) => fs.destroy(id));
    return topLevelIds;
  };

  // Restore puts items back where they were deleted from, like XP. An item
  // whose name is in use there is a question for resolveConflict, with the
  // answers of pasteWithConflicts. Every question comes before the first
  // change, so Cancel leaves everything in the Recycle Bin. It returns
  // { cancelled, results }.
  const restore = async (ids, resolveConflict) => {
    const topLevelIds = getTopLevelIds(ids);
    topLevelIds.forEach((id) => {
      if (fs.getParent(id)?.id !== fs.RECYCLE_BIN) {
        throw new Error("Only top-level Recycle Bin items can be restored.");
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
    // The folders that the restore takes out of the bin before the item
    // that comes next, and the folder that takes the items of a folder
    // that joins a folder with its name, at each level. A folder inside a
    // joined folder goes into that folder before the items that wait for
    // it.
    const leaving = new Set();
    const joins = new Map();
    // The items that the restore puts in each folder, by name. Like XP, an
    // item that goes where an item of the same restore went is a question
    // too.
    const claims = new Map();
    const claimKey = (folderId, name) =>
      `${folderId}\n${String(name).toLowerCase()}`;
    const findExisting = (folderId, name) => {
      const claimed = claims.get(claimKey(folderId, name));
      return claimed
        ? { ...fs.getNode(claimed.id), name: claimed.name }
        : fs.findChild(folderId, name);
    };
    const record = (plan) => {
      if (plan.action === "skip") return;
      if (plan.action === "merge") {
        joins.set(plan.id, plan.existingId);
        plan.children.forEach(record);
      } else {
        leaving.add(plan.id);
        claims.set(claimKey(plan.destinationId, plan.name), plan);
      }
    };
    const outOfBin = (folderId) => {
      for (let id = folderId; id; id = fs.getNode(id)?.parent) {
        if (leaving.has(id) || joins.has(id)) return true;
      }
      return !fs.isInRecycleBin(folderId);
    };
    const targetOf = (node) => {
      const folderId = joins.get(node.originalParent) || node.originalParent;
      return fs.getNode(folderId)?.type === "folder" && outOfBin(folderId)
        ? folderId
        : fs.DESKTOP;
    };
    const plans = [];
    try {
      for (const id of orderedIds) {
        const node = fs.getNode(id);
        const plan = await planItem(
          id,
          targetOf(node),
          "cut",
          resolveConflict,
          node.originalName || node.name,
          findExisting,
        );
        record(plan);
        plans.push(plan);
      }
    } catch (error) {
      if (error !== cancelled) throw error;
      return { cancelled: true, results: [] };
    }
    // An item that left the bin while a question was open stays where it
    // is now, like a paste. An item that a later item of the restore
    // replaced is not a result.
    const results = await fs.transaction(() =>
      plans
        .filter((plan) => fs.getParent(plan.id)?.id === fs.RECYCLE_BIN)
        .map((plan) =>
          runPlan(plan, "cut", () => fs.restore(plan.id, plan.destinationId)),
        )
        .filter((node) => node && fs.getNode(node.id)),
    );
    return { cancelled: false, results };
  };

  // Imports files from the user's computer, like a copy. items is a tree:
  // { type: "file", name, size, modified, read } where read() returns a
  // Promise of the content, or { type: "folder", name, children }. Every
  // question comes before the first change, as in pasteWithConflicts, and
  // the content is read before the first change too. options.isCancelled
  // stops the import before any change. options.onProgress gets
  // { completed, total } while the files are read. It returns
  // { cancelled, results }.
  const importWithConflicts = async (
    destinationId,
    items,
    resolveConflict,
    options = {},
  ) => {
    assertWritableFolder(destinationId);
    const files = [];
    const plan = async (item, folderId) => {
      if (options.isCancelled?.()) throw cancelled;
      const existing = folderId && fs.findChild(folderId, item.name);
      const step = { item, folderId, action: "put" };
      if (existing) {
        if (existing.type !== item.type)
          throw nameInUseError(item.name, existing, "copy");
        const decision = await Promise.resolve(
          resolveConflict?.({ source: item, existing, mode: "copy" }),
        );
        if (decision === "skip") return null;
        if (decision !== "replace") throw cancelled;
        step.action = "replace";
        step.existingId = existing.id;
      }
      if (item.type === "file") files.push(step);
      else {
        // The items of a new folder never clash, so they get no folder.
        step.children = [];
        for (const child of item.children) {
          const childStep = await plan(child, step.existingId || null);
          if (childStep) step.children.push(childStep);
        }
      }
      return step;
    };
    const steps = [];
    try {
      for (const item of items) {
        const step = await plan(item, destinationId);
        if (step) steps.push(step);
      }
      for (const [index, step] of files.entries()) {
        if (options.isCancelled?.()) throw cancelled;
        step.content = await step.item.read();
        options.onProgress?.({ completed: index + 1, total: files.length });
      }
    } catch (error) {
      if (error !== cancelled) throw error;
      return { cancelled: true, results: [] };
    }
    // The item with the name may have moved or changed while a question
    // was open. Then the new item goes in with its own name.
    const run = (step, parentId) => {
      const existing = fs.findChild(parentId, step.item.name);
      const planned =
        step.action === "replace" && existing?.id === step.existingId
          ? existing
          : null;
      if (step.item.type === "folder") {
        const folder = planned || createFolder(parentId, step.item.name);
        step.children.forEach((child) => run(child, folder.id));
        return folder;
      }
      if (planned) fs.destroy(planned.id);
      return createFile(parentId, step.item.name, {
        content: step.content,
        size: step.item.size,
      });
    };
    const results = await fs.transaction(() =>
      steps.map((step) => run(step, destinationId)),
    );
    notify({
      type: "import",
      destinationId,
      ids: results.map((node) => node.id),
    });
    return { cancelled: false, results };
  };

  // The tree of importWithConflicts for files from a file input or a drop
  // without folders.
  const importItemsFromFiles = (files) =>
    [...files].map((file) => ({
      type: "file",
      name: file.name,
      size: file.size,
      modified: file.lastModified,
      read: () => readFileContent(file),
    }));

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
    importWithConflicts,
    importItemsFromFiles,
    createFolder,
    createFile,
    rename,
    writeFile,
    removeToBin: (...args) => fs.transaction(() => removeToBin(...args)),
    permanentlyDelete: (...args) =>
      fs.transaction(() => permanentlyDelete(...args)),
    restore,
    emptyRecycleBin,
    resetForTests,
  };
});
