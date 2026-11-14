"use strict";

// ============================================
// Persistent Virtual Filesystem
// ============================================
// A flat node-map filesystem for the Windows XP shell. Every folder and
// file has a stable ID, a name, a type, a parent, timestamps, and a size.
// Metadata and user-created content persist between sessions through
// browser storage. The module also works under Node for testing, using
// an in-memory storage fallback.

(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.VirtualFS = api;
})(globalThis, function (root) {
  const STORAGE_KEY = "virtualFileSystem";
  const FS_VERSION = 1;
  // The one user account. Its profile folder in Documents and Settings has
  // its name, and every program that shows the user takes it from here.
  const USER_NAME = "astro";

  const WELL_KNOWN = {
    MY_COMPUTER: "my-computer",
    DRIVE_C: "drive-c",
    DRIVE_D: "drive-d",
    DRIVE_F: "drive-f",
    DOCUMENTS_AND_SETTINGS: "documents-and-settings",
    USER_PROFILE: "user-profile",
    ALL_USERS: "all-users",
    SHARED_DOCUMENTS: "shared-documents",
    DESKTOP: "desktop",
    MY_DOCUMENTS: "my-documents",
    MY_PICTURES: "my-pictures",
    MY_MUSIC: "my-music",
    SAMPLE_PICTURES: "sample-pictures",
    RECENT: "recent",
    MY_NETWORK_PLACES: "my-network-places",
    RECYCLE_BIN: "recycle-bin",
  };

  // XP's sample pictures, extracted from the SP3 CD. Nodes keep only the
  // key, because the build renames assets and stored paths would go stale.
  const SAMPLE_PICTURES = {
    "blue-hills": {
      name: "Blue hills.jpg",
      url: "/assets/xp/sample-pictures/blue-hills.jpg",
      size: 28521,
    },
    sunset: {
      name: "Sunset.jpg",
      url: "/assets/xp/sample-pictures/sunset.jpg",
      size: 71189,
    },
    "water-lilies": {
      name: "Water lilies.jpg",
      url: "/assets/xp/sample-pictures/water-lilies.jpg",
      size: 83794,
    },
    winter: {
      name: "Winter.jpg",
      url: "/assets/xp/sample-pictures/winter.jpg",
      size: 105542,
    },
  };

  // ---- Storage (localStorage in the browser, in-memory under Node) ----

  const storage = (() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.getItem(STORAGE_KEY);
        return localStorage;
      }
    } catch (error) {
      /* localStorage unavailable: use memory storage */
    }
    const memory = new Map();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    };
  })();

  let nodes = {};
  const memoryOnly = !root?.document || root.ASTRO_FS_MEMORY_ONLY === true;
  let writable = memoryOnly;
  let ready = Promise.resolve();
  let database;
  let batchDepth = 0;
  let operations = Promise.resolve();
  let initializationError;
  const readOnlyMessage =
    "Can't save files. Allow site storage in your browser, then reopen Astro XP.";
  const listeners = new Set();
  const fileTypeHandlers = new Map();
  let folderHandler = null;

  const now = () => Date.now();

  const generateId = () =>
    `f${now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  const isFolder = (node) => !!node && node.type === "folder";

  const extractExtension = (name) => {
    const dot = String(name).lastIndexOf(".");
    return dot > 0 ? String(name).slice(dot).toLowerCase() : "";
  };

  // Windows disallows these characters in file and folder names, along
  // with DOS device names (even when they have an extension). Keep this
  // check in the filesystem rather than duplicating it in each shell view.
  // eslint-disable-next-line no-control-regex -- Windows rejects ASCII control characters.
  const INVALID_NAME_CHARACTERS = /[<>:"/\\\\|?*\u0000-\u001f]/;
  const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  // A refused name throws an error with a code: "name-required",
  // "name-invalid" (a character, or a period or space at the end) or
  // "name-reserved" (a DOS device name).
  const nameError = (code, message) =>
    Object.assign(new Error(message), { code });
  const validateName = (name) => {
    if (typeof name !== "string" && typeof name !== "number") {
      throw nameError("name-required", "You must type a file name.");
    }

    const rawName = String(name);
    const normalizedName = rawName.trim();
    if (!normalizedName) {
      throw nameError("name-required", "You must type a file name.");
    }
    if (INVALID_NAME_CHARACTERS.test(rawName)) {
      throw nameError(
        "name-invalid",
        'A file name cannot contain any of the following characters:\n\t\\ / : * ? " < > |',
      );
    }
    if (/[.\s]$/.test(rawName)) {
      throw nameError(
        "name-invalid",
        `${rawName}\nThe above file name is invalid.`,
      );
    }
    const baseName = normalizedName.split(".")[0].trimEnd();
    if (RESERVED_DEVICE_NAMES.test(baseName)) {
      throw nameError(
        "name-reserved",
        `${rawName}\nThis file name is reserved for use by Windows.\nChoose another name and try again.`,
      );
    }
    return normalizedName;
  };

  // ---- Seed ----

  const seedNodes = () => {
    const timestamp = now();
    const seeded = {};
    const folder = (id, name, parent, hidden = false) => {
      seeded[id] = {
        id,
        name,
        type: "folder",
        parent,
        children: [],
        created: timestamp,
        modified: timestamp,
        size: 0,
        protected: true,
        ext: "",
        content: "",
        app: null,
        originalParent: null,
        originalName: null,
        hidden,
      };
    };

    folder(WELL_KNOWN.MY_COMPUTER, "My Computer", null);
    folder(WELL_KNOWN.DRIVE_C, "Local Disk (C:)", WELL_KNOWN.MY_COMPUTER);
    folder(WELL_KNOWN.DRIVE_D, "Local Disk (D:)", WELL_KNOWN.MY_COMPUTER);
    folder(WELL_KNOWN.DRIVE_F, "Removable Disk (F:)", WELL_KNOWN.MY_COMPUTER);
    folder(
      WELL_KNOWN.DOCUMENTS_AND_SETTINGS,
      "Documents and Settings",
      WELL_KNOWN.DRIVE_C,
    );
    folder(
      WELL_KNOWN.USER_PROFILE,
      USER_NAME,
      WELL_KNOWN.DOCUMENTS_AND_SETTINGS,
    );
    folder(
      WELL_KNOWN.ALL_USERS,
      "All Users",
      WELL_KNOWN.DOCUMENTS_AND_SETTINGS,
    );
    folder(WELL_KNOWN.SHARED_DOCUMENTS, "Documents", WELL_KNOWN.ALL_USERS);
    folder(WELL_KNOWN.DESKTOP, "Desktop", WELL_KNOWN.USER_PROFILE);
    folder(WELL_KNOWN.MY_DOCUMENTS, "My Documents", WELL_KNOWN.USER_PROFILE);
    folder(WELL_KNOWN.MY_PICTURES, "My Pictures", WELL_KNOWN.MY_DOCUMENTS);
    folder(WELL_KNOWN.MY_MUSIC, "My Music", WELL_KNOWN.MY_DOCUMENTS);
    folder(
      WELL_KNOWN.SAMPLE_PICTURES,
      "Sample Pictures",
      WELL_KNOWN.MY_PICTURES,
    );
    // XP keeps recent documents in the profile's hidden Recent folder,
    // which the file dialogs show as My Recent Documents. My Network Places
    // is a shell folder of its own, like the Recycle Bin.
    folder(WELL_KNOWN.RECENT, "Recent", WELL_KNOWN.USER_PROFILE, true);
    folder(WELL_KNOWN.MY_NETWORK_PLACES, "My Network Places", null);
    folder(WELL_KNOWN.RECYCLE_BIN, "Recycle Bin", null);
    // The sample files are ordinary files: users can delete or rename them.
    Object.entries(SAMPLE_PICTURES).forEach(([key, picture]) => {
      seeded[`sample-${key}`] = {
        id: `sample-${key}`,
        name: picture.name,
        type: "file",
        parent: WELL_KNOWN.SAMPLE_PICTURES,
        children: [],
        created: timestamp,
        modified: timestamp,
        size: picture.size,
        protected: false,
        ext: ".jpg",
        content: "",
        app: null,
        originalParent: null,
        originalName: null,
        sample: key,
      };
    });

    Object.values(seeded).forEach((node) => {
      if (node.parent) {
        seeded[node.parent].children.push(node.id);
      }
    });
    return seeded;
  };

  // Guarantee the protected system structure exists even if stored data
  // is stale or was tampered with.
  const healSeed = () => {
    const seeded = seedNodes();
    const seedFolders = Object.values(seeded).filter(isFolder);
    seedFolders.forEach((seedNode) => {
      const existing = nodes[seedNode.id];
      if (existing) {
        // Each seed field except the dates and the children comes back.
        // A stored app, for example, would give the folder another icon.
        Object.assign(existing, {
          type: "folder",
          name: seedNode.name,
          protected: true,
          hidden: seedNode.hidden,
          parent: seedNode.parent,
          size: seedNode.size,
          ext: seedNode.ext,
          content: seedNode.content,
          app: seedNode.app,
          originalParent: seedNode.originalParent,
          originalName: seedNode.originalName,
        });
        existing.children = Array.isArray(existing.children)
          ? existing.children.filter((childId) => nodes[childId])
          : [];
      } else {
        // A new system folder brings its seed files once. Later heals leave
        // them alone, so a deleted sample stays deleted.
        nodes[seedNode.id] = {
          ...seedNode,
          children: seedNode.children.filter(
            (childId) => !isFolder(seeded[childId]) && !nodes[childId],
          ),
        };
        nodes[seedNode.id].children.forEach((childId) => {
          nodes[childId] = seeded[childId];
        });
      }
      const parent = nodes[seedNode.parent];
      if (parent && !parent.children.includes(seedNode.id)) {
        // A folder the user made with a system folder's name moves aside,
        // because names in a folder must stay unique.
        const clash = findChild(parent.id, seedNode.name);
        parent.children.push(seedNode.id);
        if (clash) {
          clash.name = dedupeName(parent.id, clash.name);
          clash.modified = now();
        }
      }
    });
  };

  // ---- Persistence ----

  const save = () => {
    // Only memory-only filesystems save here; IndexedDB writes go through
    // transaction(), which batches changes so emitChange never saves.
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: FS_VERSION, nodes }),
      );
    } catch (error) {
      // Do not leave a successful-looking in-memory edit after a failed write.
      load();
      if (error.name === "QuotaExceededError" || error.code === 22) {
        throw new Error("Storage is full. Free up space and try again.", {
          cause: error,
        });
      }
      throw error;
    }
  };

  const isValidData = (data) =>
    data &&
    data.version === FS_VERSION &&
    data.nodes &&
    typeof data.nodes === "object";

  const load = () => {
    let parsed = null;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("VirtualFS: failed to read stored filesystem:", error);
    }
    nodes = isValidData(parsed) ? parsed.nodes : seedNodes();
    healSeed();
  };

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error("VirtualFS listener error:", error);
      }
    });
  };

  const emitChange = () => {
    if (batchDepth) return;
    try {
      save();
    } finally {
      notify();
    }
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  // ---- Lookup ----

  const getNode = (id) => nodes[id] || null;

  const getParent = (id) =>
    nodes[id] ? nodes[nodes[id].parent] || null : null;

  // Hidden folders, like XP's Recent, open by id but stay out of listings.
  // Names still count them, so nothing else can take a hidden name.
  const allChildren = (id) =>
    nodes[id]
      ? nodes[id].children.map((childId) => nodes[childId]).filter(Boolean)
      : [];
  const getChildren = (id) => allChildren(id).filter((node) => !node.hidden);

  const findChild = (parentId, name) =>
    allChildren(parentId).find(
      (child) => child.name.toLowerCase() === String(name).toLowerCase(),
    ) || null;

  const findByApp = (appId) =>
    Object.values(nodes).filter((node) => node.app === appId);

  const getPath = (id) => {
    const node = nodes[id];
    if (!node) return null;
    if (id === WELL_KNOWN.MY_COMPUTER) return "My Computer";
    if (id === WELL_KNOWN.DRIVE_C) return "C:\\";
    if (id === WELL_KNOWN.DRIVE_D) return "D:\\";
    if (id === WELL_KNOWN.DRIVE_F) return "F:\\";
    if (!node.parent || !nodes[node.parent]) return node.name;
    const parentPath = getPath(node.parent);
    const separator = parentPath.endsWith("\\") ? "" : "\\";
    return `${parentPath}${separator}${node.name}`;
  };

  const resolvePath = (path) => {
    if (typeof path !== "string" || !path.trim()) return null;
    const trimmed = path.trim();
    if (/^my computer$/i.test(trimmed)) return WELL_KNOWN.MY_COMPUTER;
    if (/^recycle bin$/i.test(trimmed)) return WELL_KNOWN.RECYCLE_BIN;

    const segments = trimmed
      .replace(/\//g, "\\")
      .split("\\")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (!segments.length) return null;

    let currentId;
    if (/^[cdf]:$/i.test(segments[0])) {
      currentId = {
        c: WELL_KNOWN.DRIVE_C,
        d: WELL_KNOWN.DRIVE_D,
        f: WELL_KNOWN.DRIVE_F,
      }[segments[0][0].toLowerCase()];
      segments.shift();
    } else if (/^recycle bin$/i.test(segments[0])) {
      // getPath() names Recycle Bin items from the bin itself.
      currentId = WELL_KNOWN.RECYCLE_BIN;
      segments.shift();
    } else {
      // A path with no drive has no folder to start from, so "." and ".."
      // have no meaning in it. XP finds no folder for them.
      if (segments.some((segment) => segment === "." || segment === ".."))
        return null;
      currentId = WELL_KNOWN.MY_COMPUTER;
    }

    // Like Windows, "." is the folder itself and ".." is the folder above
    // it, by the text of the path, before any name is looked up. ".." stops
    // at the top, such as the root of a drive.
    const names = [];
    for (const segment of segments) {
      if (segment === "..") names.pop();
      else if (segment !== ".") names.push(segment);
    }
    for (const name of names) {
      const match = findChild(currentId, name);
      if (!match) return null;
      currentId = match.id;
    }
    return currentId;
  };

  const isDescendantOf = (ancestorId, id) => {
    let current = nodes[id];
    while (current) {
      if (current.id === ancestorId) return true;
      current = current.parent ? nodes[current.parent] : null;
    }
    return false;
  };

  const isInRecycleBin = (id) =>
    !!nodes[id] && isDescendantOf(WELL_KNOWN.RECYCLE_BIN, id);

  const isProtected = (id) => !!nodes[id] && !!nodes[id].protected;

  const getSize = (id) => {
    const node = nodes[id];
    if (!node) return 0;
    if (node.type === "file") {
      return Number.isFinite(node.size) ? node.size : 0;
    }
    return node.children.reduce(
      (total, childId) => total + getSize(childId),
      0,
    );
  };

  // ---- Name deduplication ----

  const dedupeName = (
    parentId,
    desiredName,
    copyStyle = false,
    exceptId = null,
  ) => {
    const names = new Set(
      allChildren(parentId)
        .filter((child) => child.id !== exceptId)
        .map((child) => child.name.toLowerCase()),
    );
    if (!names.has(desiredName.toLowerCase())) return desiredName;

    if (copyStyle) {
      let counter = 1;
      let candidate = `Copy of ${desiredName}`;
      while (names.has(candidate.toLowerCase())) {
        counter += 1;
        candidate = `Copy (${counter}) of ${desiredName}`;
      }
      return candidate;
    }

    const dot = desiredName.lastIndexOf(".");
    const base = dot > 0 ? desiredName.slice(0, dot) : desiredName;
    const extension = dot > 0 ? desiredName.slice(dot) : "";
    let counter = 2;
    let candidate = `${base} (${counter})${extension}`;
    while (names.has(candidate.toLowerCase())) {
      counter += 1;
      candidate = `${base} (${counter})${extension}`;
    }
    return candidate;
  };

  // ---- Mutations ----

  const touch = (id) => {
    if (nodes[id]) {
      nodes[id].modified = now();
    }
  };

  const requireNode = (id) => {
    const node = nodes[id];
    if (!node) {
      throw new Error(
        "Cannot find the file or folder. Make sure the path and file name are correct.",
      );
    }
    return node;
  };

  const requireFolder = (id) => {
    const node = requireNode(id);
    if (!isFolder(node)) {
      throw new Error(`${node.name} is not a folder.`);
    }
    return node;
  };

  const detach = (node) => {
    const parent = nodes[node.parent];
    if (parent) {
      parent.children = parent.children.filter(
        (childId) => childId !== node.id,
      );
      touch(parent.id);
    }
  };

  // XP's titles for a failed change. The Explorer and the desktop show
  // them on their error boxes.
  const ERROR_TITLES = {
    delete: "Error Deleting File or Folder",
    move: "Error Moving File or Folder",
    rename: "Error Renaming File or Folder",
  };

  // An error with XP's text and title. Its code lets the Command Prompt
  // show its own text.
  const changeError = (verb, text, code) => {
    const error = new Error(text);
    error.code = code;
    error.title = ERROR_TITLES[verb];
    return error;
  };

  const accessDenied = (verb, node) =>
    changeError(
      verb,
      `Cannot ${verb} ${node.name}: Access is denied.\n\nMake sure the disk is not full or write-protected and that the file is not currently in use.`,
      "access-denied",
    );

  const IN_USE_TEXT =
    "It is being used by another person or program.\n\nClose any programs that might be using the file and try again.";

  // The folders that programs are in, such as the folder of a Command
  // Prompt. XP locks each of them and every folder above them.
  const foldersInUse = new Map();

  const useFolder = (owner, id) => {
    foldersInUse.set(owner, id);
  };

  const releaseFolder = (owner) => {
    foldersInUse.delete(owner);
  };

  // Throws XP's error when an item cannot be deleted, moved or renamed. A
  // protected item and a folder above a folder in use are "access denied".
  // The folder in use itself is "in use". A move of either names the
  // folder in use, because XP copies the items first and then cannot
  // remove that folder.
  const checkChange = (verb, id) => {
    const node = requireNode(id);
    if (node.protected) throw accessDenied(verb, node);
    const usedId = [...foldersInUse.values()].find(
      (folderId) => folderId === id || isDescendantOf(id, folderId),
    );
    if (!usedId) return;
    const code = usedId === id ? "in-use" : "access-denied";
    if (verb === "move")
      throw changeError(
        verb,
        `Cannot remove folder ${nodes[usedId].name}: ${IN_USE_TEXT}`,
        code,
      );
    if (code === "access-denied") throw accessDenied(verb, node);
    throw changeError(
      verb,
      `Cannot ${verb} ${node.name}: ${IN_USE_TEXT}`,
      code,
    );
  };

  const createNode = (parentId, name, type, options = {}) => {
    const parent = requireFolder(parentId);
    const validName = validateName(name);
    const timestamp = now();
    const node = {
      id: generateId(),
      name: dedupeName(parentId, validName),
      type,
      parent: parentId,
      children: [],
      created: timestamp,
      modified: timestamp,
      size: 0,
      protected: !!options.protected,
      ext: type === "file" ? options.ext || extractExtension(validName) : "",
      content: type === "file" ? String(options.content ?? "") : "",
      app: options.app || null,
      originalParent: null,
      originalName: null,
    };
    if (type === "file") {
      node.size = Number.isFinite(options.size)
        ? options.size
        : node.content.length;
    }
    nodes[node.id] = node;
    parent.children.push(node.id);
    touch(parentId);
    emitChange();
    return node;
  };

  const createFolder = (parentId, name, options) =>
    createNode(parentId, name, "folder", options);

  const createFile = (parentId, name, options) =>
    createNode(parentId, name, "file", options);

  // A rename to the same name changes nothing, so like XP nothing checks
  // that the item can change.
  const rename = (id, newName) => {
    const node = requireNode(id);
    const validName = validateName(newName);
    if (node.name === validName) return node;
    checkChange("rename", id);
    // Like XP, a rename never takes the name of another item in its folder.
    if (
      node.parent &&
      dedupeName(node.parent, validName, false, id) !== validName
    ) {
      const error = new Error(
        `Cannot rename ${node.name}: A file with the name you specified already exists. Specify a different file name.`,
      );
      error.code = "name-exists";
      throw error;
    }
    node.name = validName;
    if (node.type === "file") {
      node.ext = extractExtension(node.name);
    }
    touch(id);
    if (node.parent) touch(node.parent);
    emitChange();
    return node;
  };

  // An item that is already in the target folder stays, and like XP
  // nothing checks it, so a folder in use does not show an error.
  const move = (id, targetParentId) => {
    const node = requireNode(id);
    const target = requireFolder(targetParentId);
    if (node.parent === targetParentId) return node;
    checkChange("move", id);
    if (id === targetParentId || isDescendantOf(id, targetParentId)) {
      throw new Error(
        `Cannot move ${node.name}: The destination folder is a subfolder of the source folder.`,
      );
    }

    detach(node);
    node.name = dedupeName(targetParentId, node.name);
    node.parent = targetParentId;
    // An item moved out of the Recycle Bin forgets where it was deleted
    // from, like a restored one.
    node.originalParent = null;
    node.originalName = null;
    target.children.push(id);
    touch(id);
    touch(targetParentId);
    emitChange();
    return node;
  };

  const copy = (id, targetParentId) => {
    const node = requireNode(id);
    requireFolder(targetParentId);
    if (id === targetParentId || isDescendantOf(id, targetParentId)) {
      throw new Error(
        `Cannot copy ${node.name}: The destination folder is a subfolder of the source folder.`,
      );
    }

    const cloneRecursive = (sourceId, parentId, forcedName) => {
      const source = nodes[sourceId];
      const timestamp = now();
      const clone = {
        ...source,
        id: generateId(),
        name: forcedName || dedupeName(parentId, source.name),
        parent: parentId,
        children: [],
        created: timestamp,
        modified: timestamp,
        protected: false,
        // A copy is a new item, never one waiting in the Recycle Bin.
        originalParent: null,
        originalName: null,
      };
      nodes[clone.id] = clone;
      nodes[parentId].children.push(clone.id);
      source.children.forEach((childId) => cloneRecursive(childId, clone.id));
      return clone;
    };

    const topName =
      node.parent === targetParentId
        ? dedupeName(targetParentId, node.name, true)
        : dedupeName(targetParentId, node.name);
    const clone = cloneRecursive(id, targetParentId, topName);
    touch(targetParentId);
    emitChange();
    return clone;
  };

  // Permanently destroys a node and its descendants.
  const destroy = (id) => {
    const node = nodes[id];
    if (!node) return;
    checkChange("delete", id);
    const erase = (nodeId) => {
      const current = nodes[nodeId];
      [...current.children].forEach(erase);
      delete nodes[nodeId];
    };
    detach(node);
    erase(id);
    emitChange();
  };

  // Sends a node to the Recycle Bin; deleting an item that is already
  // in the Recycle Bin destroys it permanently.
  const remove = (id) => {
    const node = requireNode(id);
    checkChange("delete", id);
    if (isInRecycleBin(id)) {
      destroy(id);
      return;
    }
    const bin = nodes[WELL_KNOWN.RECYCLE_BIN];
    const originalParent = node.parent;
    detach(node);
    node.originalParent = originalParent;
    node.originalName = node.name;
    node.parent = WELL_KNOWN.RECYCLE_BIN;
    node.name = dedupeName(WELL_KNOWN.RECYCLE_BIN, node.name);
    bin.children.push(id);
    touch(id);
    touch(WELL_KNOWN.RECYCLE_BIN);
    emitChange();
  };

  // An item goes back to targetId, or else to the folder it was deleted
  // from. If that folder is gone or in the bin, it goes to the Desktop.
  const restore = (id, targetId = null) => {
    const node = requireNode(id);
    if (node.parent !== WELL_KNOWN.RECYCLE_BIN) {
      throw new Error("Only items in the Recycle Bin can be restored.");
    }
    const usable = (folderId) =>
      isFolder(nodes[folderId]) && !isInRecycleBin(folderId);
    targetId = usable(targetId)
      ? targetId
      : usable(node.originalParent)
        ? node.originalParent
        : WELL_KNOWN.DESKTOP;
    const restoredName = node.originalName || node.name;
    detach(node);
    node.originalParent = null;
    node.originalName = null;
    node.parent = targetId;
    node.name = dedupeName(targetId, restoredName);
    nodes[targetId].children.push(id);
    touch(id);
    touch(targetId);
    emitChange();
    return node;
  };

  const emptyRecycleBin = () => {
    [...nodes[WELL_KNOWN.RECYCLE_BIN].children].forEach(destroy);
  };

  // Restores the filesystem to the original protected folder structure.
  // Registered handlers and subscribers deliberately remain active so this
  // is safe to use from the running application, not only from tests.
  const reset = () => {
    nodes = seedNodes();
    emitChange();
  };

  const getContent = (id) => {
    const node = requireNode(id);
    return node.type === "file" ? node.content : null;
  };

  const setContent = (id, content, { name, expectedContent } = {}) => {
    const node = requireNode(id);
    if (node.type !== "file") {
      throw new Error(`${node.name} is not a file.`);
    }
    if (expectedContent !== undefined && node.content !== expectedContent) {
      throw new Error(
        "This file changed in another window. Save a copy to keep your changes.",
      );
    }
    if (name !== undefined) {
      const validName = validateName(name);
      node.name = dedupeName(node.parent, validName, false, id);
      node.ext = extractExtension(node.name);
    }
    node.content = String(content ?? "");
    node.size = node.content.length;
    // The new content replaces the sample picture.
    delete node.sample;
    touch(id);
    if (node.parent) touch(node.parent);
    emitChange();
    return node;
  };

  // A picture file's address: its stored data URL, or the asset of an XP
  // sample picture. Other files have none.
  const getPictureUrl = (id) => {
    const node = nodes[id];
    if (!node || node.type !== "file") return null;
    if (/^data:image\//i.test(node.content)) return node.content;
    return Object.hasOwn(SAMPLE_PICTURES, node.sample ?? "")
      ? SAMPLE_PICTURES[node.sample].url
      : null;
  };

  // ---- File associations ----

  // Handlers are looked up by "app:<appId>" first, then by lowercase
  // extension (".txt"), then by the "*" wildcard.
  const registerFileType = (extension, handler) => {
    fileTypeHandlers.set(String(extension).toLowerCase(), handler);
  };

  const registerFolderHandler = (handler) => {
    folderHandler = handler;
  };

  const open = (id) => {
    const node = requireNode(id);
    if (node.type === "folder") {
      if (!folderHandler) return false;
      folderHandler(node);
      return true;
    }
    const handler =
      (node.app && fileTypeHandlers.get(`app:${node.app}`)) ||
      fileTypeHandlers.get((node.ext || "").toLowerCase()) ||
      fileTypeHandlers.get("*");
    if (!handler) return false;
    handler(node);
    return true;
  };

  // ---- Testing hook ----

  const resetForTests = () => {
    storage.removeItem(STORAGE_KEY);
    nodes = seedNodes();
    foldersInUse.clear();
    listeners.clear();
    fileTypeHandlers.clear();
    folderHandler = null;
  };

  load();

  const cloneNodes = (source) =>
    Object.fromEntries(
      Object.entries(source).map(([id, node]) => [
        id,
        { ...node, children: [...node.children] },
      ]),
    );
  const sameNode = (a, b) =>
    a &&
    b &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) =>
      key === "children"
        ? a.children.length === b.children.length &&
          a.children.every((id, index) => id === b.children[index])
        : a[key] === b[key],
    );
  const requestValue = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const transactionDone = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () =>
        reject(
          transaction.error || new Error("Document transaction was aborted."),
        );
      transaction.onerror = () => {};
    });
  const readStored = async () => {
    const transaction = database.transaction("nodes", "readonly");
    const done = transactionDone(transaction);
    const [records] = await Promise.all([
      requestValue(transaction.objectStore("nodes").getAll()),
      done,
    ]);
    return Object.fromEntries(records.map((node) => [node.id, node]));
  };
  // Reloads the stored nodes. The system folders are healed in memory too,
  // in case storing them failed.
  const refresh = async () => {
    nodes = await readStored();
    healSeed();
    notify();
  };
  const channel =
    !memoryOnly && root.BroadcastChannel
      ? new root.BroadcastChannel("astro-documents")
      : null;
  const enqueue = (operation) => {
    const result = operations.then(operation);
    operations = result.catch(() => {});
    return result;
  };
  if (!memoryOnly) {
    ready = (async () => {
      if (!root.indexedDB) throw new Error(readOnlyMessage);
      const opening = root.indexedDB.open("astro-documents", 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore("nodes", { keyPath: "id" });
        opening.result.createObjectStore("meta");
      };
      database = await requestValue(opening);
      let closed = false;
      database.onversionchange = () => {
        closed = true;
        writable = false;
        database.close();
      };
      // The marker and all migrated records commit atomically. Failed migration
      // leaves the old data intact; a concurrent tab observes the same marker.
      const transaction = database.transaction(["nodes", "meta"], "readwrite");
      const done = transactionDone(transaction);
      const marker = transaction.objectStore("meta").get("initialized");
      marker.onsuccess = () => {
        if (!marker.result) {
          for (const node of Object.values(nodes))
            transaction.objectStore("nodes").put({ ...node, revision: 1 });
          transaction.objectStore("meta").put(true, "initialized");
        }
      };
      await done;
      // Seed folders added or changed since the data was stored are written
      // back, so every tab finds them. If that write fails, this tab still
      // heals its own copy.
      nodes = await readStored();
      try {
        // A retry heals the stored nodes again, not this tab's healed copy,
        // so it still writes what storage lacks.
        await commitChanges(healSeed, 3, async () => {
          nodes = await readStored();
        });
      } catch (error) {
        console.error("VirtualFS: failed to store system folders:", error);
        healSeed();
      }
      notify();
      writable = !closed;
      // Keep the legacy snapshot as a recovery backup. It is never written again.
    })().catch((error) => {
      initializationError = error;
      writable = false;
    });
    channel?.addEventListener("message", () => {
      void enqueue(async () => {
        await ready;
        if (writable) await refresh();
      });
    });
    root.addEventListener?.("pageshow", () => {
      void enqueue(async () => {
        await ready;
        if (writable) await refresh();
      });
    });
  }
  // Runs mutate on a copy of the nodes and writes only the nodes it
  // changed. A node another tab changed first makes it start over, up to
  // remainingRetries times.
  const commitChanges = async (mutate, remainingRetries, reload = refresh) => {
    const before = nodes;
    nodes = cloneNodes(before);
    let result, candidate;
    batchDepth++;
    try {
      result = mutate();
      candidate = nodes;
    } finally {
      batchDepth--;
      nodes = before;
    }
    // A node healed in memory after a failed write was never stored, and
    // has no revision. It goes with the next write, so a later change to
    // its folder cannot leave it out of storage.
    const changed = [
      ...new Set([...Object.keys(before), ...Object.keys(candidate)]),
    ].filter(
      (id) =>
        !sameNode(before[id], candidate[id]) ||
        (candidate[id] && !candidate[id].revision),
    );
    if (!changed.length) return result;
    const write = database.transaction("nodes", "readwrite");
    const done = transactionDone(write);
    const store = write.objectStore("nodes");
    let conflict = false;
    for (const id of changed) {
      const read = store.get(id);
      read.onsuccess = () => {
        if ((read.result?.revision || 0) !== (before[id]?.revision || 0)) {
          conflict = true;
          write.abort();
          return;
        }
        if (candidate[id]) {
          candidate[id].revision = (before[id]?.revision || 0) + 1;
          store.put(candidate[id]);
        } else store.delete(id);
      };
    }
    try {
      await done;
    } catch (error) {
      await reload();
      if (conflict && remainingRetries > 0)
        return commitChanges(mutate, remainingRetries - 1, reload);
      if (conflict)
        throw new Error(
          "These files changed in another tab. Check them and try again.",
          { cause: error },
        );
      if (error.name === "QuotaExceededError")
        throw new Error("Storage is full. Free up space and try again.", {
          cause: error,
        });
      throw error;
    }
    nodes = candidate;
    notify();
    channel?.postMessage("changed");
    return result;
  };
  const transaction = (mutate, { retry = 0 } = {}) => {
    if (batchDepth || memoryOnly) return mutate();
    return enqueue(async () => {
      await ready;
      if (!writable) throw initializationError || new Error(readOnlyMessage);
      return commitChanges(mutate, retry);
    });
  };
  const mutate =
    (operation) =>
    (...args) =>
      transaction(() => operation(...args));

  return {
    get ready() {
      return ready;
    },
    get canWrite() {
      return writable;
    },
    ...WELL_KNOWN,
    WELL_KNOWN,
    USER_NAME,
    transaction,
    close: () => {
      channel?.close();
      database?.close();
    },
    subscribe,
    getNode,
    getParent,
    getChildren,
    findChild,
    findByApp,
    getPath,
    resolvePath,
    isDescendantOf,
    isInRecycleBin,
    isProtected,
    checkChange,
    useFolder,
    releaseFolder,
    getSize,
    validateName,
    INVALID_NAME_CHARACTERS,
    extractExtension,
    createFolder: mutate(createFolder),
    createFile: mutate(createFile),
    rename: mutate(rename),
    move: mutate(move),
    copy: mutate(copy),
    remove: mutate(remove),
    delete: mutate(remove),
    restore: mutate(restore),
    destroy: mutate(destroy),
    emptyRecycleBin: mutate(emptyRecycleBin),
    reset: mutate(reset),
    getContent,
    getPictureUrl,
    setContent: mutate(setContent),
    registerFileType,
    registerFolderHandler,
    open,
    resetForTests,
  };
});
