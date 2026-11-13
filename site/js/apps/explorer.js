"use strict";

// ============================================
// Virtual Filesystem integration
// ============================================

const fs = window.VirtualFS;
const fileOps = window.FileOperations;

const refreshInstalledGames = async (installedGames) => {
  const nextIds = new Set(Object.keys(installedGames));
  const removedFileIds = [];
  installedGameIds.forEach((gameId) => {
    if (nextIds.has(gameId)) return;
    closeGameWindow(gameId);
    if (fs.canWrite)
      removedFileIds.push(...fs.findByApp(gameId).map((node) => node.id));
    delete gamesList[gameId];
    const favorites = getFavorites().filter((id) => id !== gameId);
    setFavorites(favorites);
  });
  if (removedFileIds.length)
    await fs.transaction(() => removedFileIds.forEach((id) => fs.destroy(id)));
  Object.entries(installedGames).forEach(([gameId, game]) => {
    gamesList[gameId] = game;
  });
  installedGameIds.clear();
  nextIds.forEach((gameId) => installedGameIds.add(gameId));

  if (!shellInitialized) return;
  await syncGameFiles();
  buildDesktopIcons();
  if (!document.getElementById("start-menu").hidden) buildPinnedPrograms();
  const internetWindow = openWindows.get("__internet-games");
  if (internetWindow) renderInstalledInternetGames(internetWindow);
  const linkedGameId = getHashGameId();
  if (linkedGameId && !openWindows.has(linkedGameId))
    openLinkedGame(linkedGameId);
};

const initializeGameLibrary = async () => {
  try {
    gameLibrary = window.AstroGameLibrary.createManager();
    gameLibrary.subscribe((games) => {
      void refreshInstalledGames(games).catch((error) => console.error(error));
    });
    await refreshInstalledGames(await gameLibrary.initialize());
    gameLibraryReady = true;
  } catch (error) {
    console.error("Internet Games initialization failed:", error);
    gameLibraryError = error;
  }
};

// Shared names understood by Run, Search, and the shell. Keep these routes in
// one place so adding a simulated application does not create another parser.
const SHELL_COMMANDS = [
  {
    id: "documents",
    title: "My Documents",
    aliases: ["documents", "my documents"],
    run: () => openSystemWindow("__my-documents"),
  },
  {
    id: "pictures",
    title: "My Pictures",
    aliases: ["pictures", "my pictures"],
    run: () => openSystemWindow("__my-pictures"),
  },
  {
    id: "music",
    title: "My Music",
    aliases: ["music", "my music"],
    run: () => openSystemWindow("__my-music"),
  },
  {
    id: "computer",
    title: "My Computer",
    aliases: ["computer", "my computer"],
    run: () => openSystemWindow("__my-computer"),
  },
  {
    id: "control-panel",
    title: "Control Panel",
    aliases: ["control panel"],
    run: () => openControlPanel(),
  },

  {
    id: "notepad",
    title: "Notepad",
    aliases: ["notepad"],
    run: () => openNotepad(),
  },
  {
    id: "search",
    title: "Search",
    aliases: ["search"],
    run: () => openSystemWindow("__search"),
  },
  {
    id: "internet-games",
    title: "Internet Games",
    aliases: ["internet games", "game store", "games online"],
    run: () => openSystemWindow("__internet-games"),
  },
  { id: "run", title: "Run", aliases: ["run"], run: () => openRunDialog() },
];

const normalizeShellCommand = (value) => value.trim().toLowerCase();
const resolveShellCommand = (value) => {
  const command = normalizeShellCommand(value);
  if (!command) return null;
  const shell = SHELL_COMMANDS.find((entry) => entry.aliases.includes(command));
  if (shell) return { kind: "application", title: shell.title, run: shell.run };
  const gameId = Object.keys(gamesList).find(
    (id) =>
      id.toLowerCase() === command ||
      formatGameTitle(id).toLowerCase() === command,
  );
  if (gameId)
    return {
      kind: "game",
      title: formatGameTitle(gameId),
      run: () => openGameWindow(gameId),
    };
  const nodeId = fs.resolvePath(String(value).trim());
  const node = nodeId && fs.getNode(nodeId);
  // Like XP, Run cannot find an item by its place in the Recycle Bin.
  if (node && !isDeletedNode(node.id))
    return {
      kind: node.type === "folder" ? "folder" : "file",
      title: node.name,
      run: () => fs.open(node.id),
    };
  return null;
};

const RUN_HISTORY_KEY = "runHistory";
const getRunHistory = () =>
  readJsonStorage(
    RUN_HISTORY_KEY,
    [],
    (history) =>
      Array.isArray(history) &&
      history.every((entry) => typeof entry === "string"),
  ).slice(0, 10);
// Run only remembers commands that resolved, so the text is never empty.
const rememberRunCommand = (value) => {
  const text = value.trim();
  const history = getRunHistory().filter(
    (entry) => entry.toLowerCase() !== text.toLowerCase(),
  );
  writeJsonStorage(RUN_HISTORY_KEY, [text, ...history].slice(0, 10));
};

const searchVirtualNodes = ({ query, locationId, type }) => {
  const wanted = normalizeShellCommand(query);
  const matches = (name) => !wanted || name.toLowerCase().includes(wanted);
  const results = [];
  const representedGameIds = new Set();
  // Search starts from a protected folder and walks VirtualFS's tree, which
  // has no cycles or dangling children.
  const pending = [locationId];
  while (pending.length) {
    const id = pending.pop();
    const node = fs.getNode(id);
    if (
      id !== locationId &&
      matches(node.name) &&
      (type === "all" ||
        (type === "files" && node.type === "file") ||
        (type === "folders" && node.type === "folder") ||
        (type === "games" && !!node.app))
    ) {
      results.push({ kind: node.app ? "game-file" : node.type, node });
      if (node.app) representedGameIds.add(node.app);
    }
    if (node.type === "folder")
      fs.getChildren(id).forEach((child) => pending.push(child.id));
  }
  if (type === "all" || type === "games") {
    Object.keys(gamesList)
      .filter(
        (id) => !representedGameIds.has(id) && matches(formatGameTitle(id)),
      )
      .forEach((gameId) => {
        results.push({ kind: "game", gameId, title: formatGameTitle(gameId) });
      });
  }
  if (type === "all" || type === "applications") {
    SHELL_COMMANDS.filter((entry) => matches(entry.title)).forEach((entry) => {
      results.push({ kind: "application", command: entry, title: entry.title });
    });
  }
  return results.sort((a, b) =>
    (a.title || a.node.name).localeCompare(b.title || b.node.name),
  );
};

const wireSearchCompanion = (win) => {
  const content = win.el.querySelector(".search-companion-content");
  const startPanel = content.querySelector(".search-start-panel");
  const formPanel = content.querySelector(".search-form-panel");
  const query = content.querySelector("#search-filename");
  const location = content.querySelector("#search-location");
  const type = content.querySelector("#search-type");
  const status = content.querySelector(".search-results-status");
  const list = content.querySelector(".search-results-list");
  const showForm = (kind) => {
    startPanel.hidden = true;
    formPanel.hidden = false;
    type.value = ["media", "documents"].includes(kind) ? "files" : "all";
    query.focus();
  };
  content.querySelectorAll("[data-search-kind]").forEach((button) => {
    button.addEventListener("click", () => showForm(button.dataset.searchKind));
  });
  content
    .querySelector('[data-search-action="back"]')
    .addEventListener("click", () => {
      formPanel.hidden = true;
      startPanel.hidden = false;
    });
  [
    [fs.MY_COMPUTER, "My Computer"],
    [fs.DESKTOP, "Desktop"],
    [fs.MY_DOCUMENTS, "My Documents"],
    [fs.MY_PICTURES, "My Pictures"],
    [fs.MY_MUSIC, "My Music"],
  ]
    .filter(([id]) => fs.getNode(id))
    .forEach(([id, label]) => {
      const option = new Option(label, id);
      location.appendChild(option);
    });
  const openResult = (result) => {
    if (result.gameId) return openGameWindow(result.gameId);
    if (result.command) return result.command.run();
    return fs.open(result.node.id);
  };
  const render = () => {
    const results = searchVirtualNodes({
      query: query.value,
      locationId: location.value,
      type: type.value,
    });
    list.replaceChildren();
    status.textContent = results.length
      ? `${results.length} result${results.length === 1 ? "" : "s"} found.`
      : "No results found.";
    results.forEach((result) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "explorer-item";
      item.setAttribute("role", "option");
      const label = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = result.title || result.node.name;
      const description = document.createElement("small");
      description.textContent = result.command
        ? "Application"
        : result.gameId
          ? "Game"
          : `${result.kind === "folder" ? "File folder" : explorerItemDescription(result.node)} — ${fs.getPath(result.node.id)}`;
      label.append(name, description);
      item.append(
        result.gameId
          ? createGameIconElement(result.gameId, "explorer-item-icon")
          : result.command
            ? createGameIconElement("__search", "explorer-item-icon")
            : createExplorerIcon(result.node),
        label,
      );
      item.addEventListener("dblclick", () => openResult(result));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          openResult(result);
        }
      });
      item.addEventListener("click", () => {
        list
          .querySelectorAll(".selected")
          .forEach((entry) => entry.classList.remove("selected"));
        item.classList.add("selected");
      });
      list.appendChild(item);
    });
  };
  content
    .querySelector('[data-search-action="search"]')
    .addEventListener("click", render);
  query.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      render();
    }
  });
  [location, type].forEach((control) =>
    control.addEventListener("change", render),
  );
};

const findBundledGameByTitle = (title) => {
  const wanted = String(title || "")
    .trim()
    .toLowerCase();
  if (!wanted) return null;
  return (
    Object.keys(window.FLASH_GAMES).find(
      (gameId) => formatGameTitle(gameId).toLowerCase() === wanted,
    ) || null
  );
};

const createInternetGameCard = (game, win, { installed = false } = {}) => {
  const card = document.createElement("article");
  card.className = "internet-game-card";

  const artwork = document.createElement("div");
  artwork.className = "internet-game-artwork";
  const image = document.createElement("img");
  image.src = game.icon || game.logoUrl || "";
  image.alt = "";
  image.loading = "lazy";
  image.addEventListener("error", () => {
    image.hidden = true;
    artwork.classList.add("missing");
  });
  artwork.appendChild(image);

  const body = document.createElement("div");
  body.className = "internet-game-card-body";
  const title = document.createElement("h2");
  title.textContent = game.title || "Untitled game";
  const developer = document.createElement("p");
  developer.className = "internet-game-developer";
  developer.textContent = game.developer || "Unknown developer";
  const tags = document.createElement("p");
  tags.className = "internet-game-tags";
  tags.textContent = Array.isArray(game.tags)
    ? game.tags.slice(0, 4).join(" · ")
    : "Flash";
  body.append(title, developer, tags);

  const actions = document.createElement("div");
  actions.className = "internet-game-actions";
  const action = document.createElement("button");
  action.type = "button";
  action.className = "xp-btn";

  if (installed) {
    action.textContent = "Play";
    action.addEventListener("click", () =>
      openGameWindow(`flashpoint:${game.uuid}`),
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "xp-btn";
    remove.textContent = "Uninstall";
    remove.addEventListener("click", async () => {
      const confirmed = await XPDialogs.confirm(
        `Remove ${game.title || "this game"} from this computer?`,
        "Uninstall Game",
        "warning",
      );
      if (!confirmed) return;
      action.disabled = true;
      remove.disabled = true;
      try {
        await gameLibrary.uninstall(game.uuid);
      } catch (error) {
        XPDialogs.alert(
          error.message || "The game could not be uninstalled.",
          "Internet Games",
          "error",
        );
        action.disabled = false;
        remove.disabled = false;
      }
    });
    actions.append(action, remove);
  } else {
    const gameId = `flashpoint:${game.uuid}`;
    const includedGameId = findBundledGameByTitle(game.title);
    let availableGameId = gamesList[gameId] ? gameId : includedGameId;
    action.textContent = availableGameId
      ? "Play"
      : game.potentiallyCompatible === false
        ? "Not compatible"
        : "Install";
    if (includedGameId && !gamesList[gameId]) {
      action.title = "Already included.";
    }
    action.disabled = game.potentiallyCompatible === false;
    action.addEventListener("click", async () => {
      if (availableGameId) {
        openGameWindow(availableGameId);
        return;
      }
      const status = win.el.querySelector(".internet-games-status");
      action.disabled = true;
      action.textContent = "Checking...";
      try {
        const details = await gameLibrary.details(game.uuid);
        if (!details.compatible) {
          throw new Error(
            details.incompatibleReason || "This game doesn't work here.",
          );
        }
        action.textContent = "Downloading...";
        await gameLibrary.install(details, {
          onProgress: ({ loaded, total }) => {
            if (total) {
              const percent = Math.min(100, Math.round((loaded / total) * 100));
              action.textContent = `Downloading ${percent}%`;
            } else {
              action.textContent = `Downloading ${XPDialogs.formatBytes(loaded)}`;
            }
          },
        });
        availableGameId = gameId;
        action.textContent = "Play";
        action.disabled = false;
        status.textContent = `${details.title} is installed.`;
      } catch (error) {
        action.textContent = "Install";
        action.disabled = false;
        status.textContent =
          error.message || "The game could not be installed.";
      }
    });
    actions.appendChild(action);
  }

  card.append(artwork, body, actions);
  return card;
};

const renderInstalledInternetGames = (win) => {
  const container = win.el.querySelector(".internet-games-installed");
  const status = win.el.querySelector(".internet-games-installed-status");
  container.replaceChildren();
  const records = gameLibrary
    ? [...installedGameIds]
        .map((id) => gameLibrary.getRecord(id))
        .filter(Boolean)
        .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
    : [];
  status.textContent = records.length
    ? `${records.length} ${records.length === 1 ? "game" : "games"}`
    : "No games installed.";
  records.forEach((record) =>
    container.appendChild(
      createInternetGameCard(record, win, { installed: true }),
    ),
  );
};

const wireInternetGames = (win) => {
  const content = win.el.querySelector(".internet-games-content");
  const tabs = [...content.querySelectorAll("[data-internet-tab]")];
  const panels = [...content.querySelectorAll("[data-internet-panel]")];
  const query = content.querySelector("#internet-games-query");
  const form = content.querySelector(".internet-games-search");
  const status = content.querySelector(".internet-games-status");
  const results = content.querySelector(".internet-games-results");

  const selectTab = (name) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.internetTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.internetPanel !== name;
    });
    if (name === "installed") renderInstalledInternetGames(win);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.internetTab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + offset + tabs.length) % tabs.length];
      selectTab(next.dataset.internetTab);
      next.focus();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const term = query.value.trim();
    if (!term) {
      status.textContent = "Type a game name.";
      query.focus();
      return;
    }
    if (!gameLibrary || gameLibraryError) {
      status.textContent =
        gameLibraryError?.message ||
        "Internet Games isn't available right now.";
      return;
    }
    const submit = form.querySelector("button");
    submit.disabled = true;
    status.textContent = "Searching...";
    results.replaceChildren();
    try {
      const games = await gameLibrary.search(term);
      status.textContent = games.length
        ? `${games.length} ${games.length === 1 ? "game" : "games"}`
        : "No games found.";
      games.forEach((game) =>
        results.appendChild(createInternetGameCard(game, win)),
      );
    } catch (error) {
      status.textContent = error.message || "Search didn't work. Try again.";
    } finally {
      submit.disabled = false;
    }
  });

  renderInstalledInternetGames(win);
  query.focus();
};

// XP's wording and titles, with the Recycle Bin icon.
const confirmRecycleDelete = (ids) => {
  const node = fs.getNode(ids[0]);
  const [text, title] =
    ids.length > 1
      ? [
          `Are you sure you want to send these ${ids.length} items to the Recycle Bin?`,
          "Confirm Multiple File Delete",
        ]
      : node.type === "folder"
        ? [
            `Are you sure you want to remove the folder '${node.name}' and move all its contents to the Recycle Bin?`,
            "Confirm Folder Delete",
          ]
        : [
            `Are you sure you want to send '${node.name}' to the Recycle Bin?`,
            "Confirm File Delete",
          ];
  return XPDialogs.confirm(text, title, "recycle").then(
    async (yes) => yes && (await fileOps.removeToBin(ids)),
  );
};

// Deletes items from the Recycle Bin for good. An item restored meanwhile,
// for example in another tab, is not deleted: the operation fails instead.
const confirmRecycleBinDelete = async (ids) => {
  const yes = await XPDialogs.confirm(
    "Are you sure you want to permanently delete the selected items?",
    "Confirm File Delete",
    "warning",
  );
  if (!yes) return;
  try {
    await fileOps.permanentlyDelete(ids);
  } catch (error) {
    await XPDialogs.alert(
      error.message || "The file operation failed.",
      "File operation",
      "error",
    );
  }
};

// Empty Recycle Bin is only enabled while the bin has items.
const confirmEmptyRecycleBin = () => {
  const count = fs.getChildren(fs.RECYCLE_BIN).length;
  const single = count === 1;
  return XPDialogs.confirm(
    single
      ? "Are you sure you want to delete this item?"
      : `Are you sure you want to delete these ${count} items?`,
    single ? "Confirm File Delete" : "Confirm Multiple File Delete",
    "warning",
  ).then(async (yes) => {
    try {
      if (!yes) return false;
      await fileOps.emptyRecycleBin();
      return true;
    } catch (error) {
      await XPDialogs.alert(
        error.message || "The file operation failed.",
        "File operation",
        "error",
      );
    }
  });
};

const choosePasteConflict = ({ existing }) =>
  new Promise((resolve) => {
    const dialog = XPDialogs.createDialog({
      title: "Confirm File Replace",
      onCancel: () => dialog.close("cancel"),
    });
    const text = document.createElement("p");
    text.className = "dlg-text";
    text.textContent = `${existing.name} already exists. What do you want to do?`;
    const row = document.createElement("div");
    row.className = "dlg-buttons";
    [
      ["Replace", "replace"],
      ["Keep Both", "rename"],
      ["Cancel", "cancel"],
    ].forEach(([label, value]) => {
      row.appendChild(
        XPDialogs.createDialogButton({ id: value, label }, () =>
          dialog.close(value),
        ),
      );
    });
    dialog.body.append(text, row);
    dialog.onResult(resolve);
    dialog.defaultButton = row.firstChild;
    row.firstChild.focus();
  });
// Every caller checks canPaste or fills the clipboard first. Pastes cannot
// overlap: the conflict and progress dialogs are modal.
const pasteIntoFolder = async (destinationId) => {
  const clipboard = fileOps.getClipboard();
  let cancelled = false;
  const progress =
    clipboard.ids.length > 1
      ? XPDialogs.progress({
          title: clipboard.mode === "cut" ? "Moving..." : "Copying...",
          text: "Preparing file operation...",
          cancellable: true,
          onCancel: () => {
            cancelled = true;
          },
        })
      : null;
  try {
    const result = await fileOps.pasteWithConflicts(
      destinationId,
      choosePasteConflict,
      {
        isCancelled: () => cancelled,
        onProgress: ({ completed, total, mode }) =>
          progress?.update(
            completed / total,
            `${mode === "cut" ? "Moving" : "Copying"} ${completed} of ${total}...`,
          ),
      },
    );
    progress?.close?.(result.cancelled ? "cancelled" : "complete");
    return result;
  } catch (error) {
    progress?.close?.("error");
    console.error(error);
    XPDialogs.alert(
      error.message || "The file operation could not be completed.",
      "File Operation Error",
      "error",
    );
    return null;
  }
};
// Browser DataTransfer exposes file bytes, but directory traversal is only
// available through the non-standard webkitGetAsEntry API. Unsupported
// browsers import the flat FileList and cannot preserve directory structure.
const readAllDirectoryEntries = (reader) =>
  new Promise((resolve, reject) => {
    const entries = [];
    const read = () =>
      reader.readEntries((batch) => {
        if (!batch.length) resolve(entries);
        else {
          entries.push(...batch);
          read();
        }
      }, reject);
    read();
  });
const importFileEntry = (entry, destinationId, state) =>
  new Promise((resolve, reject) =>
    entry.file(async (file) => {
      try {
        if (state.cancelled) return resolve(false);
        const content = await fileOps.readFileContent(file);
        const existing = fs.findChild(destinationId, file.name);
        let replaceId;
        if (existing) {
          const choice = await choosePasteConflict({ existing });
          if (choice === "cancel") {
            state.cancelled = true;
            return resolve(false);
          }
          if (choice === "replace" && existing.type === "file")
            replaceId = existing.id;
        }
        await fs.transaction(() => {
          if (replaceId) fs.destroy(replaceId);
          return fileOps.createFile(destinationId, file.name, {
            content,
            size: file.size,
          });
        });
        state.completed = (state.completed || 0) + 1;
        state.progress?.update(0, `Imported ${state.completed} item(s)...`);
        resolve(true);
      } catch (error) {
        reject(error);
      }
    }, reject),
  );
// Callers check state.cancelled before importing each entry.
const importDirectoryEntry = async (entry, destinationId, state) => {
  let folder = null;
  try {
    const existing = fs.findChild(destinationId, entry.name);
    if (existing) {
      const choice = await choosePasteConflict({ existing });
      if (choice === "cancel") {
        state.cancelled = true;
        return;
      }
      if (choice === "replace" && existing.type === "folder")
        await fs.destroy(existing.id);
    }
    folder = await fileOps.createFolder(destinationId, entry.name);
    const entries = await readAllDirectoryEntries(entry.createReader());
    for (const child of entries) {
      if (state.cancelled) throw new Error("Directory import cancelled");
      if (child.isDirectory)
        await importDirectoryEntry(child, folder.id, state);
      else if (child.isFile) await importFileEntry(child, folder.id, state);
    }
  } catch (error) {
    // A failed child has already removed its own folder, so this folder is
    // still present.
    if (folder) await fs.destroy(folder.id);
    if (error.message === "Directory import cancelled") return;
    throw error;
  }
};
// Only writable folders are wired as drop targets (see wireFolderDropTarget).
const importDroppedFiles = async (destinationId, dataTransfer) => {
  const state = { cancelled: false, completed: 0 };
  state.progress = XPDialogs.progress({
    title: "Importing...",
    text: "Preparing dropped files...",
    cancellable: true,
    onCancel: () => {
      state.cancelled = true;
    },
  });
  try {
    const entries = [...(dataTransfer.items || [])]
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);
    if (entries.length) {
      for (const entry of entries) {
        if (state.cancelled) break;
        if (entry.isDirectory)
          await importDirectoryEntry(entry, destinationId, state);
        else if (entry.isFile)
          await importFileEntry(entry, destinationId, state);
      }
      return;
    }
    for (const file of [...(dataTransfer.files || [])]) {
      if (state.cancelled) break;
      await importFileEntry({ file: (ok) => ok(file) }, destinationId, state);
    }
  } finally {
    state.progress.close();
  }
};
const wireFolderDropTarget = (element, destinationId) => {
  element.dataset.dropDestinationId = destinationId;
  element.addEventListener("dragover", (event) => {
    const internal = event.dataTransfer?.types?.includes(
      "application/x-astro-vfs-ids",
    );
    if (
      internal ||
      fileOps.canPaste(destinationId) ||
      event.dataTransfer?.files?.length
    ) {
      event.preventDefault();
      element.classList.add("drop-target");
    }
  });
  element.addEventListener("dragleave", () =>
    element.classList.remove("drop-target"),
  );
  element.addEventListener("drop", async (event) => {
    event.preventDefault();
    element.classList.remove("drop-target");
    try {
      const payload = event.dataTransfer?.getData(
        "application/x-astro-vfs-ids",
      );
      const ids = payload ? JSON.parse(payload) : [];
      if (!Array.isArray(ids)) throw new Error("Invalid dropped item list");
      if (ids.length) {
        fileOps.cut(ids);
        await pasteIntoFolder(destinationId);
      } else await importDroppedFiles(destinationId, event.dataTransfer);
    } catch (error) {
      XPDialogs.alert(
        error.message || "The dropped files could not be imported.",
        "File Operation Error",
        "error",
      );
    }
  });
};
const closeExplorerMenu = (root = document) => {
  root.querySelectorAll(".explorer-menu").forEach((menu) => {
    menu.hidden = true;
  });
  root
    .querySelectorAll('[data-explorer-menu][aria-expanded="true"]')
    .forEach((button) => button.setAttribute("aria-expanded", "false"));
};

const systemFolderShortcuts = {
  "__my-documents": () => fs.MY_DOCUMENTS,
  "__my-computer": () => fs.MY_COMPUTER,
  "__my-pictures": () => fs.MY_PICTURES,
  "__my-music": () => fs.MY_MUSIC,
  "__recycle-bin": () => fs.RECYCLE_BIN,
};

// XP shows the All Users documents folder as "Shared Documents", and lists
// the user's documents in My Computer as "astro's Documents".
const explorerDisplayName = (node) =>
  node.id === fs.SHARED_DOCUMENTS ? "Shared Documents" : node.name;

// An item in the Recycle Bin, not the bin itself. Like XP, Explorer never
// browses into a deleted folder.
const isDeletedNode = (id) => id !== fs.RECYCLE_BIN && fs.isInRecycleBin(id);

const navigateExplorer = (win, folderId, { history = true } = {}) => {
  const folder = fs.getNode(folderId);
  if (!folder || folder.type !== "folder" || isDeletedNode(folderId))
    return false;
  if (history) {
    const entries = win.history.slice(0, win.historyIndex + 1);
    if (entries.at(-1) !== folderId) entries.push(folderId);
    win.history = entries;
    win.historyIndex = entries.length - 1;
  }
  win.currentFolderId = folderId;
  renderExplorerItems(win);
  return true;
};

// Back and Forward skip folders that were deleted since, and the folder
// that is already open. The index is -1 when no such folder is left, and
// the button is then disabled.
const explorerHistoryTarget = (win, step) => {
  for (
    let index = win.historyIndex + step;
    index >= 0 && index < win.history.length;
    index += step
  ) {
    const id = win.history[index];
    if (
      id !== win.currentFolderId &&
      fs.getNode(id)?.type === "folder" &&
      !isDeletedNode(id)
    )
      return index;
  }
  return -1;
};
const stepExplorerHistory = (win, step) => {
  const index = explorerHistoryTarget(win, step);
  if (index === -1) return;
  win.historyIndex = index;
  navigateExplorer(win, win.history[index], { history: false });
};
const explorerBack = (win) => stepExplorerHistory(win, -1);
const explorerForward = (win) => stepExplorerHistory(win, 1);

const selectedExplorerNodes = (win) =>
  [...win.el.querySelectorAll(".explorer-item.selected")]
    .map((item) => item.dataset.nodeId)
    .filter((id) => !!fs.getNode(id));

// Inline rename, like XP: the label becomes an edit box; Enter or leaving
// it commits, and Escape cancels.
const startExplorerRename = (win, nodeId) => {
  // Like XP, items in the Recycle Bin keep their names until restored.
  if (fs.isInRecycleBin(nodeId)) return;
  const item = win.el.querySelector(
    `.explorer-item[data-node-id="${CSS.escape(nodeId)}"]`,
  );
  const label = item.querySelector("b");
  const node = fs.getNode(nodeId);
  const input = document.createElement("input");
  input.className = "explorer-rename";
  input.value = node.name;
  label.replaceWith(input);
  input.focus();
  input.setSelectionRange(
    0,
    node.name.lastIndexOf(".") > 0
      ? node.name.lastIndexOf(".")
      : node.name.length,
  );
  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    input.replaceWith(label);
    item.focus();
    if (!commit || input.value === node.name) return;
    try {
      await fileOps.rename(nodeId, input.value);
    } catch (error) {
      await XPDialogs.alert(
        error.message || "The file operation failed.",
        "Error Renaming File or Folder",
        "error",
      );
    }
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
};

const renderExplorerTaskPane = (win) => {
  const section = win.el.querySelector(
    ".explorer-sidebar > section:first-child",
  );
  const title = section?.querySelector(".explorer-section-label");
  const body = section?.querySelector(".explorer-section-body");
  if (!title || !body) return;

  const isComputer = win.currentFolderId === fs.MY_COMPUTER;
  const isBin = win.currentFolderId === fs.RECYCLE_BIN;
  title.textContent = isComputer
    ? "System Tasks"
    : isBin
      ? "Recycle Bin Tasks"
      : "File and Folder Tasks";
  body.replaceChildren();

  const addTask = (label, icon, action) => {
    const button = document.createElement("button");
    button.type = "button";
    const image = document.createElement("img");
    image.src = XP_ICON_PATHS[icon];
    image.alt = "";
    const text = document.createElement("span");
    text.textContent = label;
    button.append(image, text);
    button.addEventListener("click", action);
    body.appendChild(button);
  };

  if (isComputer) {
    addTask(
      "View system information",
      "ExplorerProperties.png",
      openProjectSettings,
    );
    addTask(
      "Add or remove programs",
      "AddRemovePrograms.png",
      openControlPanel,
    );
    addTask("Change a setting", "ControlPanel.png", openControlPanel);
    return;
  }

  const selected = selectedExplorerNodes(win);
  // XP offers these only while the bin has items.
  if (isBin) {
    const binItems = fs.getChildren(fs.RECYCLE_BIN).map((node) => node.id);
    if (binItems.length)
      addTask(
        "Empty the Recycle Bin",
        "RecyclerFull.png",
        confirmEmptyRecycleBin,
      );
    const restore = async (ids) => {
      try {
        await fileOps.restore(ids);
      } catch (error) {
        await XPDialogs.alert(
          error.message || "The file operation failed.",
          "Restore files",
          "error",
        );
      }
    };
    if (selected.length)
      addTask(
        selected.length === 1
          ? "Restore this item"
          : "Restore the selected items",
        "RecyclerEmpty.png",
        () => restore(selected),
      );
    else if (binItems.length)
      addTask("Restore all items", "RecyclerEmpty.png", () =>
        restore(binItems),
      );
    section.hidden = !body.children.length;
    return;
  }

  // XP's selection tasks; only the ones the simulation can carry out.
  const editable = selected.filter((id) => !fs.getNode(id).protected);
  if (selected.length === 1 && editable.length === 1) {
    const kind = fs.getNode(selected[0]).type === "folder" ? "folder" : "file";
    addTask(`Rename this ${kind}`, "Rename.png", () =>
      startExplorerRename(win, selected[0]),
    );
    addTask(`Delete this ${kind}`, "Delete.png", () =>
      confirmRecycleDelete(selected),
    );
  } else if (editable.length > 1) {
    addTask("Delete the selected items", "Delete.png", () =>
      confirmRecycleDelete(editable),
    );
  } else if (
    !fs.getNode(win.currentFolderId).protected ||
    [
      fs.MY_DOCUMENTS,
      fs.MY_PICTURES,
      fs.MY_MUSIC,
      fs.SHARED_DOCUMENTS,
      fs.DESKTOP,
      fs.DRIVE_C,
      fs.DRIVE_D,
      fs.DRIVE_F,
    ].includes(win.currentFolderId)
  ) {
    addTask(
      "Make a new folder",
      "NewFolder.png",
      async () => await fileOps.createFolder(win.currentFolderId, "New Folder"),
    );
  }
  section.hidden = !body.children.length;
};

// XP's "Other Places" list depends on the folder being shown. My Network
// Places is omitted because the simulation has no network folder.
const renderExplorerOtherPlaces = (win) => {
  const body = win.el.querySelector(
    ".explorer-places-section .explorer-section-body",
  );
  if (!body) return;
  const current = win.currentFolderId;
  const folder = fs.getNode(current);
  const place = (id) => [id, fs.getNode(id)];
  let places;
  if (current === fs.MY_COMPUTER)
    places = [
      place(fs.MY_DOCUMENTS),
      place(fs.SHARED_DOCUMENTS),
      ["control-panel"],
    ];
  else if (current === fs.MY_DOCUMENTS)
    places = [
      place(fs.DESKTOP),
      place(fs.SHARED_DOCUMENTS),
      place(fs.MY_COMPUTER),
    ];
  else if (current === fs.RECYCLE_BIN)
    places = [place(fs.DESKTOP), place(fs.MY_DOCUMENTS), place(fs.MY_COMPUTER)];
  else if (current === fs.DESKTOP)
    places = [
      place(fs.MY_COMPUTER),
      place(fs.MY_DOCUMENTS),
      place(fs.SHARED_DOCUMENTS),
    ];
  else if ([fs.MY_PICTURES, fs.MY_MUSIC].includes(current))
    places = [place(fs.MY_DOCUMENTS), place(fs.MY_COMPUTER)];
  else if (folder.parent === fs.MY_COMPUTER)
    places = [
      place(fs.MY_COMPUTER),
      place(fs.MY_DOCUMENTS),
      place(fs.SHARED_DOCUMENTS),
    ];
  else
    places = [
      place(folder.parent),
      ...[fs.MY_DOCUMENTS, fs.SHARED_DOCUMENTS, fs.MY_COMPUTER]
        .filter((id) => id !== folder.parent && id !== current)
        .map(place),
    ];
  body.replaceChildren();
  places.forEach(([id, node]) => {
    const button = document.createElement("button");
    button.type = "button";
    const image = document.createElement("img");
    const text = document.createElement("span");
    if (id === "control-panel") {
      button.dataset.place = "control-panel";
      image.src = XP_ICON_PATHS["ControlPanel.png"];
      text.textContent = "Control Panel";
      button.addEventListener("click", openControlPanel);
    } else {
      button.dataset.place =
        {
          [fs.MY_COMPUTER]: "computer",
          [fs.MY_DOCUMENTS]: "documents",
          [fs.SHARED_DOCUMENTS]: "shared-documents",
          [fs.DESKTOP]: "desktop",
        }[id] || "parent";
      image.src =
        id === fs.MY_COMPUTER
          ? XP_ICON_PATHS["MyComputer.png"]
          : id === fs.MY_DOCUMENTS
            ? XP_ICON_PATHS["MyDocuments.png"]
            : id === fs.DESKTOP
              ? "assets/xp/icons/Desktop.png"
              : XP_ICON_PATHS["NewFolder.png"];
      text.textContent = explorerDisplayName(node);
      button.addEventListener("click", () => navigateExplorer(win, id));
    }
    image.alt = "";
    button.append(image, text);
    body.appendChild(button);
  });
};

// XP's Details section names the selection, or the open folder when nothing
// is selected.
const renderExplorerDetails = (win) => {
  const body = win.el.querySelector(
    ".explorer-details-section .explorer-section-body",
  );
  if (!body) return;
  const selected = selectedExplorerNodes(win);
  const name = document.createElement("strong");
  const type = document.createElement("span");
  body.replaceChildren(name, type);
  if (selected.length > 1) {
    name.textContent = `${selected.length} items selected.`;
    type.remove();
    return;
  }
  const node = fs.getNode(selected[0] || win.currentFolderId);
  name.textContent =
    node.id === fs.MY_COMPUTER ? "My Computer" : explorerDisplayName(node);
  type.textContent =
    node.id === fs.MY_COMPUTER ||
    (node.protected && node.type === "folder" && !node.id.startsWith("drive"))
      ? "System Folder"
      : explorerItemDescription(node);
  if (node.type === "file") {
    const modified = document.createElement("span");
    modified.textContent = `Date Modified: ${new Date(node.modified).toLocaleString()}`;
    const size = document.createElement("span");
    size.textContent = `Size: ${XPDialogs.formatBytes(fs.getSize(node.id))}`;
    body.append(modified, size);
  }
};

const renderExplorerSelection = (win) => {
  renderExplorerTaskPane(win);
  renderExplorerOtherPlaces(win);
  renderExplorerDetails(win);
};

const renderExplorerTree = (win) => {
  const tree = win.el.querySelector(".explorer-tree");
  if (!tree) return;
  tree.replaceChildren();
  const expanded =
    win.expandedFolders ||
    new Set([
      fs.MY_COMPUTER,
      fs.DRIVE_C,
      fs.DOCUMENTS_AND_SETTINGS,
      fs.USER_PROFILE,
    ]);
  win.expandedFolders = expanded;
  // Only protected roots and their folder children are added.
  const addNode = (id, depth = 0) => {
    const node = fs.getNode(id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "explorer-tree-item";
    row.dataset.nodeId = id;
    row.style.paddingLeft = `${6 + depth * 14}px`;
    // The tree lists no deleted folders under the Recycle Bin.
    const hasFolders =
      id !== fs.RECYCLE_BIN &&
      fs.getChildren(id).some((child) => child.type === "folder");
    row.textContent = `${hasFolders ? (expanded.has(id) ? "− " : "+ ") : "  "}${node.name}`;
    row.classList.toggle("active", id === win.currentFolderId);
    row.addEventListener("click", () => {
      if (hasFolders) expanded.add(id);
      navigateExplorer(win, id);
    });
    row.addEventListener("dblclick", () => {
      if (!hasFolders) return;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      renderExplorerTree(win);
    });
    tree.appendChild(row);
    if (hasFolders && expanded.has(id))
      fs.getChildren(id)
        .filter((child) => child.type === "folder")
        .forEach((child) => addNode(child.id, depth + 1));
  };
  addNode(fs.MY_COMPUTER);
  addNode(fs.RECYCLE_BIN);
};

const openExplorerContextMenu = (win, clientX, clientY) => {
  const selected = selectedExplorerNodes(win);
  const recycle = win.currentFolderId === fs.RECYCLE_BIN;
  const protectedSelection = selected.some((id) => fs.isProtected(id));
  const menu = document.createElement("div");
  menu.className = "xp-context-menu explorer-context-menu";
  menu.setAttribute("role", "menu");
  const close = () => menu.remove();
  const add = (label, command, disabled) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.command = command;
    button.disabled = disabled;
    button.setAttribute("role", "menuitem");
    menu.appendChild(button);
  };
  if (recycle) {
    add("Restore", "restore", !selected.length);
    add("Delete Permanently", "permanent", !selected.length);
    add("Properties", "properties", selected.length !== 1);
  } else {
    add("Open", "open", selected.length !== 1);
    add("Cut", "cut", !selected.length || protectedSelection);
    add("Copy", "copy", !selected.length);
    add("Delete", "delete", !selected.length || protectedSelection);
    add("Rename", "rename", selected.length !== 1 || protectedSelection);
    add("Properties", "properties", selected.length !== 1);
  }
  win.el.appendChild(menu);
  const rect = win.el.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(clientX - rect.left, rect.width - menu.offsetWidth - 2))}px`;
  menu.style.top = `${Math.max(25, Math.min(clientY - rect.top, rect.height - menu.offsetHeight - 2))}px`;
  menu.querySelector("button:not(:disabled)")?.focus();
  menu.addEventListener("click", async (event) => {
    try {
      const command = event.target.dataset.command;
      if (!command) return;
      if (command === "open") fs.open(selected[0]);
      if (command === "cut") fileOps.cut(selected);
      if (command === "copy") fileOps.copy(selected);
      if (command === "restore") await fileOps.restore(selected);
      if (command === "properties") XPDialogs.properties(selected[0]);
      if (command === "rename") startExplorerRename(win, selected[0]);
      if (command === "delete") await confirmRecycleDelete(selected);
      if (command === "permanent") await confirmRecycleBinDelete(selected);
      close();
    } catch (error) {
      await XPDialogs.alert(
        error.message || "The file operation failed.",
        "File operation",
        "error",
      );
    }
  });
  menu.addEventListener("keydown", (event) => {
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      document.activeElement?.click();
      return;
    }
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const target =
        event.key === "Home"
          ? buttons[0]
          : event.key === "End"
            ? buttons.at(-1)
            : buttons[
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                  buttons.length
              ];
      target?.focus();
    }
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!menu.contains(event.target)) close();
    },
    { once: true },
  );
};

const createExplorerIcon = (node) => {
  const icon = document.createElement("span");
  icon.className = "explorer-item-icon";
  const addImage = (fileName) => {
    const image = document.createElement("img");
    image.src = XP_ICON_PATHS[fileName];
    image.alt = "";
    icon.appendChild(image);
    return icon;
  };

  if (node.id === fs.DRIVE_C || node.id === fs.DRIVE_D)
    return addImage("LocalDisk.png");
  if (node.id === fs.DRIVE_F) return addImage("RemovableMedia.png");
  if (node.id === fs.MY_MUSIC) return addImage("MyMusic.png");
  if (node.id === fs.MY_PICTURES) return addImage("MyPictures.png");
  if (node.app && systemShortcuts[node.app]) {
    const shortcut = createGameIconElement(node.app, "explorer-item-icon");
    shortcut.classList.remove("system-icon");
    return shortcut;
  }
  if (node.type === "folder") {
    return addImage("NewFolder.png");
  }

  const game = node.app ? gamesList[node.app] : null;
  if (game) {
    if (game.icon) {
      const image = document.createElement("img");
      image.src = game.icon;
      image.alt = "";
      icon.appendChild(image);
    } else {
      icon.classList.add("explorer-item-emoji");
      icon.textContent = getGameIcon(node.app);
    }
    return icon;
  }

  return addImage(
    /\.(txt|log|csv|md)$/i.test(node.name)
      ? "TextDocument.png"
      : "GenericFile.png",
  );
};

XPDialogs.setNodeIconFactory(createExplorerIcon);

const explorerItemDescription = (node) => {
  if (node.id === fs.DRIVE_C || node.id === fs.DRIVE_D) return "Local Disk";
  if (node.id === fs.DRIVE_F) return "Removable Disk";
  if (node.type === "folder") return "File folder";
  if (node.app && gamesList[node.app]) return "Game";
  return `${(node.ext || "").replace(".", "").toUpperCase() || "File"} file`;
};

const openExplorerNode = (win, node) => {
  // XP opens Properties for an item in the Recycle Bin.
  if (isDeletedNode(node.id)) {
    XPDialogs.properties(node.id);
    return;
  }
  if (node.type === "folder") {
    navigateExplorer(win, node.id);
    return;
  }
  try {
    fs.open(node.id);
  } catch (error) {
    console.error(error);
  }
};

// Explorer windows always show an existing folder; a deleted one is replaced
// by My Computer before this renders.
const renderExplorerItems = (win, contentRoot = win.el) => {
  const main = contentRoot.querySelector(".explorer-main");
  const folder = fs.getNode(win.currentFolderId);

  win.title =
    folder.id === fs.MY_COMPUTER ? "My Computer" : explorerDisplayName(folder);
  win.el.querySelector(".title-text").textContent = win.title;
  renderTaskButtons();
  const titleIcon = win.el.querySelector(".title-icon");
  titleIcon.replaceChildren();
  const image = document.createElement("img");
  image.src =
    folder.id === fs.RECYCLE_BIN
      ? getRecycleBinIconPath()
      : folder.id === fs.MY_COMPUTER
        ? "assets/xp/icons/MyComputer.png"
        : folder.id === fs.MY_MUSIC
          ? "assets/xp/icons/MyMusic.png"
          : folder.id === fs.MY_PICTURES
            ? "assets/xp/icons/MyPictures.png"
            : "assets/xp/icons/MyDocuments.png";
  image.alt = "";
  titleIcon.appendChild(image);
  renderExplorerTree(win);

  const explorerContent = main.closest(".explorer-content");
  const chrome = explorerContent.querySelector(".explorer-chrome");
  // XP names its shell folders in the address bar and shows paths elsewhere.
  chrome.querySelector("input").value = [
    fs.MY_DOCUMENTS,
    fs.SHARED_DOCUMENTS,
    fs.DESKTOP,
  ].includes(folder.id)
    ? explorerDisplayName(folder)
    : fs.getPath(folder.id);
  chrome.querySelector(".explorer-address-field img").src =
    folder.id === fs.RECYCLE_BIN
      ? getRecycleBinIconPath()
      : folder.id === fs.MY_COMPUTER
        ? XP_ICON_PATHS["MyComputer.png"]
        : folder.id === fs.MY_MUSIC
          ? XP_ICON_PATHS["MyMusic.png"]
          : folder.id === fs.MY_PICTURES
            ? XP_ICON_PATHS["MyPictures.png"]
            : XP_ICON_PATHS["MyDocuments.png"];
  chrome.querySelector('[data-explorer-action="back"]').disabled =
    explorerHistoryTarget(win, -1) === -1;
  chrome.querySelector('[data-explorer-action="forward"]').disabled =
    explorerHistoryTarget(win, 1) === -1;
  chrome.querySelector('[data-explorer-action="up"]').disabled =
    !folder.parent &&
    ![fs.MY_COMPUTER, fs.RECYCLE_BIN].includes(win.currentFolderId);

  // XP's tile view shows no folder heading.
  main.querySelector("h2").hidden = true;

  const items = main.querySelector(".explorer-items");
  items.dataset.view = win.explorerView;
  items.innerHTML = "";

  const myComputerGroup = (node) =>
    [fs.SHARED_DOCUMENTS, fs.MY_DOCUMENTS].includes(node.id)
      ? "Files Stored on This Computer"
      : node.id === fs.DRIVE_F
        ? "Devices with Removable Storage"
        : "Hard Disk Drives";
  const myComputerGroupOrder = [
    "Files Stored on This Computer",
    "Hard Disk Drives",
    "Devices with Removable Storage",
  ];
  const myComputerOrder = [
    fs.SHARED_DOCUMENTS,
    fs.MY_DOCUMENTS,
    fs.DRIVE_C,
    fs.DRIVE_D,
    fs.DRIVE_F,
  ];
  const children = [
    ...(folder.id === fs.MY_COMPUTER
      ? [fs.getNode(fs.SHARED_DOCUMENTS), fs.getNode(fs.MY_DOCUMENTS)]
      : []),
    ...fs.getChildren(folder.id),
  ]
    .filter(Boolean)
    .sort((a, b) =>
      folder.id === fs.MY_COMPUTER
        ? myComputerGroupOrder.indexOf(myComputerGroup(a)) -
            myComputerGroupOrder.indexOf(myComputerGroup(b)) ||
          myComputerOrder.indexOf(a.id) - myComputerOrder.indexOf(b.id)
        : (a.type === "folder" ? 0 : 1) - (b.type === "folder" ? 0 : 1) ||
          a.name.localeCompare(b.name),
    );

  renderExplorerSelection(win);
  if (!children.length) {
    // XP leaves an empty folder's view blank.
    explorerContent.querySelector(".explorer-status").textContent = "0 objects";
    return;
  }

  if (items.dataset.view === "details") {
    const header = document.createElement("div");
    header.className = "explorer-details-header";
    header.innerHTML = "<span>Name</span><span>Type</span><span>Size</span>";
    items.appendChild(header);
  }

  let currentGroup = "";
  children.forEach((node) => {
    if (folder.id === fs.MY_COMPUTER) {
      const group = myComputerGroup(node);
      if (group !== currentGroup) {
        const groupHeading = document.createElement("h3");
        groupHeading.className = "explorer-group-heading";
        groupHeading.textContent = group;
        items.appendChild(groupHeading);
        currentGroup = group;
      }
    }
    const item = document.createElement("button");
    item.type = "button";
    item.className = "explorer-item";
    item.dataset.nodeId = node.id;
    item.draggable = !node.protected;
    item.title = node.name;

    const label = document.createElement("span");
    const name = document.createElement("b");
    name.textContent =
      folder.id === fs.MY_COMPUTER && node.id === fs.MY_DOCUMENTS
        ? `${fs.getNode(fs.USER_PROFILE).name}'s Documents`
        : explorerDisplayName(node);
    const description = document.createElement("small");
    description.textContent = explorerItemDescription(node);
    label.appendChild(name);
    // System folders show only their name, like XP.
    if (folder.id !== fs.MY_COMPUTER && !node.protected)
      label.appendChild(description);

    const itemIcon = createExplorerIcon(node);
    if (folder.id === fs.MY_COMPUTER && node.id === fs.MY_DOCUMENTS) {
      itemIcon.querySelector("img").src = XP_ICON_PATHS["NewFolder.png"];
    }
    item.append(itemIcon, label);
    if (folder.id === fs.MY_COMPUTER) item.classList.add("my-computer-item");
    if (items.dataset.view === "details") {
      item.classList.add("explorer-details-row");
      const type = document.createElement("span");
      type.className = "explorer-detail-type";
      type.textContent = explorerItemDescription(node);
      const size = document.createElement("span");
      size.className = "explorer-detail-size";
      size.textContent =
        node.type === "folder"
          ? ""
          : XPDialogs.formatBytes(fs.getSize(node.id));
      item.append(type, size);
    }
    item.addEventListener("click", (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        items
          .querySelectorAll(".selected")
          .forEach((entry) => entry.classList.remove("selected"));
      }
      item.classList.add("selected");
      renderExplorerSelection(win);
    });
    item.addEventListener("dragstart", (event) => {
      const ids = selectedExplorerNodes(win);
      event.dataTransfer.setData(
        "application/x-astro-vfs-ids",
        JSON.stringify(ids.includes(node.id) ? ids : [node.id]),
      );
      event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dblclick", () => openExplorerNode(win, node));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        openExplorerNode(win, node);
      }
      if (e.key === "F2" && !node.protected) {
        e.preventDefault();
        startExplorerRename(win, node.id);
      }
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      item.click();
      openExplorerContextMenu(win, event.clientX, event.clientY);
    });
    // A deleted folder takes no drops: nothing new goes in the Recycle Bin.
    if (node.type === "folder" && !fs.isInRecycleBin(node.id))
      wireFolderDropTarget(item, node.id);
    items.appendChild(item);
  });
  explorerContent.querySelector(".explorer-status").textContent =
    `${children.length} ${children.length === 1 ? "object" : "objects"}`;
};

// Games participate in the filesystem as ".game" files on the Desktop,
// opened through the registered file association.
const gameFileName = (gameId) =>
  `${formatGameTitle(gameId)
    // eslint-disable-next-line no-control-regex -- Windows rejects ASCII control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()}.game`;

const syncGameFiles = () => {
  if (!fs.canWrite) return;
  return fs.transaction(
    () => {
      for (const gameId of Object.keys(gamesList)) {
        if (!fs.findByApp(gameId).length)
          fs.createFile(fs.DESKTOP, gameFileName(gameId), { app: gameId });
      }
    },
    { retry: 3 },
  );
};

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  const message = event.data;
  if (message?.event === "astro.game-data-retention") {
    const win = openWindows.get(message.gameId);
    if (win && event.source === win.player?.contentWindow) {
      win.removeGameDataOnClose =
        message.keep === false
          ? {
              storageId: message.storageId || message.gameId,
              fileName: message.fileName,
            }
          : false;
    }
    return;
  }
  if (message?.event !== "astro.offline-game-ready") {
    return;
  }
  const offlineGameIds = new Set([
    "revcdos",
    "pink-panther-passport-to-peril",
    "pink-panther-hokus-pokus",
  ]);
  if (!offlineGameIds.has(message.gameId)) return;
  const win = openWindows.get(message.gameId);
  if (!win || event.source !== win.player?.contentWindow) return;
  offlineManager.downloadGame(message.gameId).catch((error) => {
    console.error("Could not add the game to Offline Games:", error);
  });
});

fs.registerFileType(".game", (file) => {
  if (file.app && gamesList[file.app]) {
    openGameWindow(file.app);
  }
});
fs.registerFileType("app:__recycle-bin", () =>
  openSystemWindow("__recycle-bin"),
);

const restoreDefaultDesktop = async () => {
  await fs.transaction(() => {
    Object.keys(gamesList).forEach((gameId) =>
      fs.findByApp(gameId).forEach((node) => fs.destroy(node.id)),
    );
  });
  localStorage.removeItem("desktopIconPositions");
  localStorage.removeItem("desktopLayoutSettings");
  await syncGameFiles();
};

const resetAstroXp = async () => {
  USER_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  await fs.reset();
  await syncGameFiles();
};

fs.registerFolderHandler((folder) => {
  openSystemWindow("__my-documents");
  navigateExplorer(openWindows.get("__my-documents"), folder.id);
});

// Keep open explorer windows and desktop shortcuts in sync with filesystem changes.
const setupExplorerFilesystemSync = () =>
  fs.subscribe(() => {
    openWindows.forEach((win) => {
      if (win.type !== "system" || !win.currentFolderId) return;
      if (
        !fs.getNode(win.currentFolderId) ||
        isDeletedNode(win.currentFolderId)
      )
        win.currentFolderId = fs.MY_COMPUTER;
      renderExplorerItems(win);
    });
    if (iconsBuilt) buildDesktopIcons();
    renderTaskButtons();
  });
