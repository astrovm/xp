"use strict";

const wireSystemWindowControls = (win) => {
  win.el.addEventListener("pointerdown", () => focusWindow(win.gameId));
  win.el
    .querySelector(".close-btn")
    .addEventListener("click", () => closeGameWindow(win.gameId));
  win.el
    .querySelector(".minimize-btn")
    .addEventListener("click", () =>
      minimizeWindow(win.gameId, { animate: true }),
    );
  win.el
    .querySelector(".maximize-btn")
    .addEventListener("click", () =>
      toggleMaximize(win.gameId, { animate: true }),
    );
  updateMaximizeButton(win);
  wireDrag(win);
  if (win.application?.window.resizable !== false) wireResize(win);
};

const applicationContext = (win) => ({
  windowElement: win.el,
  XP_ICON_PATHS,
  dialogs: XPDialogs,
  fileOps,
  fs,
  // Opens an application. It gives its window, or a promise of the
  // window while the application loads. It is false for no application.
  launchApplication(applicationId, options = {}) {
    const application = window.XPApplicationRegistry.get(applicationId);
    if (!application) return false;
    return application.kind === "system"
      ? openSystemWindow(applicationId)
      : openXPProgram(applicationId, options);
  },
  // Runs a program by its name, such as "notepad", like Run does, from the
  // folder with the path base. It gives a promise of the new window that
  // the program opens, or of null, or false for a name that is no program.
  runProgram: (name, args, base) =>
    newWindowOf(() => runNamedProgram(name, args, base)),
  // Opens an item with its program, like START and XP's ShellExecuteEx. It
  // gives a promise of the new window that the program opens, or of null,
  // or false when nothing opens the item. A folder opens in Explorer,
  // which is open already, so it gives no new window.
  openItem: (id) =>
    newWindowOf(() => {
      const opened = fs.launch(id);
      return opened && (opened.folder ? Promise.resolve(null) : opened.result);
    }),
  // Like START /MIN and /MAX, a window that a program opens shows
  // minimized or maximized. Like XP's Calculator, a program that opens
  // restored does not take /MAX.
  showWindow(other, show) {
    if (show === "min") minimizeWindow(other.gameId);
    else if (!other.maximized && !other.application?.window.opensRestored)
      toggleMaximize(other.gameId);
  },
  // A promise that ends when the window closes, like START /WAIT.
  whenClosed: (other) => whenWindowCloses(other),
  // Gives the keys to a control of this window, like XP: only when this
  // window is the active window. Else the window keeps the control for
  // the time that it becomes active again, and stays behind.
  giveKeys: (target) => giveKeysInWindow(win, target),
  getDesktopSize,
  getSystemVolume,
  setSystemVolume,
  getMixer,
  setMixer,
  openAboutWindows,
  setSize(width, height) {
    win.el.style.width = `${width}px`;
    win.el.style.height = `${height}px`;
  },
  // The title of this window only. The program keeps its own name, so
  // the Start menu and the other windows of the program do not change.
  setTitle(title) {
    win.title = title;
    win.el.querySelector(".title-text").textContent = title;
    renderTaskButtons();
    updateDocumentTitle();
  },
  setAccessKeyText,
  close: () => closeGameWindow(win.gameId),
  minimize: () => minimizeWindow(win.gameId),
  openFile: (options) => XPDialogs.openFile(options),
  saveFile: (options) => XPDialogs.saveFile(options),
  myPictures: fs.MY_PICTURES,
  pictureUrl: (file) => fs.getPictureUrl(file.id),
  // A deleted picture's folder is in the Recycle Bin: Paint then uses My
  // Pictures.
  folderOf: (id) => {
    const parent = fs.getNode(id)?.parent;
    return parent && !fs.isInRecycleBin(parent) ? parent : null;
  },
  // The path of a file, or null when it is gone or in the Recycle Bin. A
  // program that waits, such as for a question, opens the file only when
  // it is still at this path, like XP.
  pathOf: (id) =>
    fs.getNode(id) && !fs.isInRecycleBin(id) ? fs.getPath(id) : null,
  setFileContent: (id, content, options) => fs.setContent(id, content, options),
  writeFile: (parentId, name, content) =>
    fileOps.writeFile(parentId, name, content),
  setWallpaper(dataUrl) {
    const desktop = document.getElementById("desktop");
    desktop.style.setProperty("--desktop-background", `url("${dataUrl}")`);
    desktop.dataset.wallpaperPosition = "center";
  },
  showMessage: (title, text) => XPDialogs.alert(text, title, "info"),
});

// The new window of a launch, like the new process of XP's START. A window
// that was open before, such as Calculator, which has one window here, or
// Task Manager, is no new window: XP's taskmgr.exe gives the work to the
// copy that runs. START does not wait for that window or change it. The
// launch gives its window, a promise of it, or false for nothing to run.
const newWindowOf = (launch) => {
  const before = new Set(openWindows.values());
  const launched = launch();
  return (
    launched !== false &&
    Promise.resolve(launched).then((win) =>
      win?.gameId && !before.has(win) ? win : null,
    )
  );
};

const openXPProgram = (programId, options = {}) => {
  let program = window.XPApplicationRegistry.get(programId);
  if (program.load) {
    if (!program.loaded) {
      const launchSession = sessionGeneration;
      return program
        .load()
        .then(() =>
          loggedIn && launchSession === sessionGeneration
            ? openXPProgram(programId, options)
            : null,
        )
        .catch((error) => {
          if (!loggedIn || launchSession !== sessionGeneration) return null;
          void XPDialogs.alert(
            error.message ||
              "The application could not be loaded. Try opening it again.",
            program.title,
            "error",
          );
          return null;
        });
    }
    program = program.loaded;
  }
  // A program with many windows, such as the Command Prompt, opens a new
  // window each time, like XP's new process. Its first window has the id
  // of the program, and the next ones "__command-prompt#2" and up.
  const manyWindows = program.window.manyWindows === true;
  const existing = !manyWindows && openWindows.get(programId);
  if (existing) {
    restoreWindow(programId);
    focusWindow(programId);
    return options.file
      ? existing.mountedApplication?.openFile?.(options.file)
      : existing;
  }
  let windowId = programId;
  let instance = 0;
  while (openWindows.has(windowId)) {
    instance += 1;
    windowId = `${programId}#${instance + 1}`;
  }
  const { width: desktopWidth, height: desktopHeight } = getDesktopSize();
  const el = createWindowElement(windowId, programId);
  el.classList.add("xp-native-program-window");
  if (program.window.className) el.classList.add(program.window.className);
  el.querySelectorAll(".game-menu-bar, .game-menu").forEach((node) =>
    node.remove(),
  );
  const preferredWidth = program.window.width;
  const preferredHeight = program.window.height;
  if (program.window.resizable === false) {
    el.style.minWidth = `${preferredWidth}px`;
    el.style.minHeight = `${preferredHeight}px`;
  }
  // A fixed-size window keeps its size; it's fitted after it mounts.
  const fixedSize = program.window.resizable === false;
  const windowWidth =
    desktopWidth > 16 && !fixedSize
      ? Math.min(preferredWidth, desktopWidth - 16)
      : preferredWidth;
  const windowHeight =
    desktopHeight > 16 && !fixedSize
      ? Math.min(preferredHeight, desktopHeight - 16)
      : preferredHeight;
  el.style.width = `${windowWidth}px`;
  el.style.height = `${windowHeight}px`;
  // Whole pixels keep pixel art sharp in odd-sized windows. A fixed XP
  // position moves back on a screen too small to show the whole window.
  const fitStart = (start, size, available) =>
    available > 16 ? Math.min(start, Math.max(0, available - size)) : start;
  // Like XP, each new window of the program cascades down and to the
  // right of the one before it, and wraps when it does not fit.
  const left =
    program.window.left ??
    Math.max(8, Math.floor((desktopWidth - windowWidth) / 2));
  const top =
    program.window.top ??
    Math.max(8, Math.floor((desktopHeight - windowHeight) / 2));
  const place = cascadePlace(
    instance,
    { left, top, width: windowWidth, height: windowHeight },
    { width: desktopWidth, height: desktopHeight },
  );
  el.style.left = `${fitStart(place.left, windowWidth, desktopWidth)}px`;
  el.style.top = `${fitStart(place.top, windowHeight, desktopHeight)}px`;
  const win = {
    gameId: windowId,
    applicationId: programId,
    el,
    type: "system",
    player: null,
    minimized: false,
    maximized: false,
    prevRect: null,
    zIndex: 0,
    lastUsed: Date.now(),
    maximizeBtn: el.querySelector(".maximize-btn"),
    favoriteBtn: null,
    volumeBtn: null,
    application: program,
    cascadeSteps: instance,
  };
  const mounted = program.mount(applicationContext(win), {
    application: program,
    file: options.file || null,
    arguments: options.arguments,
    from: options.from,
    folder: options.folder,
    fresh: options.fresh,
    title: options.title,
    window: win,
  });
  win.mountedApplication = mounted;
  win.beforeClose = mounted.beforeClose;
  el.querySelector(".window-content").replaceWith(mounted.element);
  document.getElementById("desktop").appendChild(el);
  openWindows.set(windowId, win);
  updateMaximizeButton(win);
  if (fixedSize) {
    el.querySelectorAll(".resize-handle").forEach((handle) => handle.remove());
    fitFixedWindow(win, mounted.element);
  }
  if (program.window.customChrome) {
    win.el.addEventListener("pointerdown", () => focusWindow(win.gameId));
    wireDrag(win);
  } else {
    wireSystemWindowControls(win);
  }
  focusWindow(windowId);
  // Some XP programs, like Spider Solitaire, open maximized.
  if (program.window.startMaximized) toggleMaximize(windowId);
  return win;
};

const openNotepad = (file = null) => openXPProgram("__notepad", { file });

window.AstroApplicationHost = Object.freeze({
  installFileAssociations(registry) {
    registry.values().forEach((application) => {
      application.fileTypes?.forEach((extension) => {
        fs.registerFileType(extension, (file) =>
          openXPProgram(application.id, { file }),
        );
      });
    });
  },
});

const systemApplicationContext = () => ({
  XPDialogs,
  XP_ICON_PATHS,
  addTrayIcon,
  arrangeTaskbarWindows,
  closeGameWindow,
  createGameIconElement,
  focusWindow,
  gamesList,
  logOff,
  minimizeWindow,
  openRunDialog,
  restart,
  restoreWindow,
  setSuspended,
  setWindowTopmost,
  switchUser,
  toggleMaximize,
  turnOff,
  confirmEmptyRecycleBin,
  confirmRecycleDelete,
  confirmRecycleBinDelete,
  explorerBack,
  explorerForward,
  EXPLORER_VIEWS,
  explorerViewFor,
  fileOps,
  fs,
  navigateExplorer,
  openAboutWindows,
  openControlPanel,
  openDateTimeProperties,

  openProjectSettings,

  openSearchDialog,
  openShellProperties,
  openSystemWindow,
  openTaskbarProperties,
  openWindows,
  pasteIntoFolder,
  renderExplorerItems,
  renderExplorerTree,
  renderTaskButtons,
  resolveShellCommand,
  selectedExplorerNodes,
  renderExplorerSelection,
  setExplorerView,
  startExplorerRename,
  focusExplorerList,
  stepExplorerFilmstrip,
  canRotatePicture,
  explorerFilmstripNode,
  explorerViewsFor,
  setAccessKeyText,
  wireDisplayProperties,
  wireSearchCompanion,
  wireInternetGames,
  wireProjectSettings,
});

// options.folderId opens an Explorer window on that folder instead of the
// shortcut's own folder, as the first folder of its history. An open window
// navigates to the folder. options.folders shows the Folders bar, and
// options.selectId selects that item in the folder.
const openSystemWindow = (shortcutId, options = {}) => {
  const existing = openWindows.get(shortcutId);
  if (existing) {
    restoreWindow(shortcutId);
    focusWindow(shortcutId);
    if (options.folderId) navigateExplorer(existing, options.folderId);
    showExplorerOptions(existing, options);
    return existing;
  }

  const registered = window.XPApplicationRegistry.get(shortcutId);
  if (!registered || registered.kind !== "system") return null;
  if (registered.load && !registered.loaded) {
    const launchSession = sessionGeneration;
    return registered
      .load()
      .then(() =>
        loggedIn && launchSession === sessionGeneration
          ? openSystemWindow(shortcutId, options)
          : null,
      )
      .catch((error) => {
        if (!loggedIn || launchSession !== sessionGeneration) return null;
        void XPDialogs.alert(
          error.message ||
            "The window could not be loaded. Try opening it again.",
          registered.title,
          "error",
        );
      });
  }
  const application = registered.loaded || registered;
  const { width: desktopWidth, height: desktopHeight } = getDesktopSize();
  const el = createWindowElement(shortcutId);
  el.classList.add("explorer-window");
  if (application.window.className)
    el.classList.add(application.window.className);
  el.querySelectorAll(".game-menu-bar, .game-menu").forEach((node) =>
    node.remove(),
  );
  // A fixed-size dialog keeps its size; it's fitted after it mounts.
  const fixedSize = application.window.dialogControls === true;
  const windowWidth = fixedSize
    ? application.window.width
    : Math.min(application.window.width, desktopWidth - 16);
  const windowHeight = fixedSize
    ? application.window.height
    : Math.min(application.window.height, desktopHeight - 16);
  el.style.width = `${windowWidth}px`;
  el.style.height = `${windowHeight}px`;
  const defaultLeft = Math.max(8, (desktopWidth - windowWidth) / 2);
  const defaultTop = Math.max(8, (desktopHeight - windowHeight) / 2);
  el.style.left = `${Math.min(
    application.window.left ?? defaultLeft,
    Math.max(8, desktopWidth - windowWidth),
  )}px`;
  el.style.top = `${Math.min(
    application.window.top ?? defaultTop,
    Math.max(8, desktopHeight - windowHeight),
  )}px`;
  document.getElementById("desktop").appendChild(el);

  const firstFolderId = systemFolderShortcuts[shortcutId]
    ? options.folderId || systemFolderShortcuts[shortcutId]()
    : null;
  const win = {
    gameId: shortcutId,
    el,
    type: "system",
    player: null,
    minimized: false,
    maximized: false,
    prevRect: null,
    zIndex: 0,
    lastUsed: Date.now(),
    currentFolderId: firstFolderId,
    history: firstFolderId ? [firstFolderId] : [],
    historyIndex: 0,
    maximizeBtn: el.querySelector(".maximize-btn"),
    favoriteBtn: null,
    volumeBtn: null,
    application,
  };
  openWindows.set(shortcutId, win);
  const context = systemApplicationContext(win);
  const mounted = application.mount(context, {
    application,
    window: win,
  });
  win.mountedApplication = mounted;
  el.querySelector(".window-content").replaceWith(mounted.element);
  if (win.currentFolderId) renderExplorerItems(win);
  wireSystemWindowControls(win);
  if (application.window.dialogControls) {
    el.classList.add("dialog-frame");
    el.querySelector(".minimize-btn").remove();
    el.querySelector(".maximize-btn").remove();
    XPDialogs.addWhatsThisHelp(el, mounted.element);
    fitFixedWindow(win, mounted.element);
  }
  application.activate?.(context, { application, window: win }, mounted);
  focusWindow(shortcutId);
  showExplorerOptions(win, options);
  return win;
};

const openDesktopItem = (itemId) => {
  const node = fs.getNode(itemId);
  if (node) {
    try {
      fs.open(itemId);
    } catch (error) {
      console.error(error);
    }
  } else if (itemId === "__astro-settings") {
    openProjectSettings();
  } else if (systemShortcuts[itemId]) {
    openSystemWindow(itemId);
  } else {
    openGameWindow(itemId);
  }
};

// Callers only open games listed in gamesList.
const openGameWindow = (gameId) => {
  const existing = openWindows.get(gameId);
  if (existing) {
    restoreWindow(gameId);
    focusWindow(gameId);
    return;
  }

  const game = gamesList[gameId];
  const aspectRatio = game.aspectRatio || DEFAULT_ASPECT_RATIO;
  const { width: desktopWidth, height: desktopHeight } = getDesktopSize();
  const availableWidth = Math.max(desktopWidth - 8, 0);
  const availableHeight = Math.max(desktopHeight - 8, 0);
  const minWidth = Math.min(MIN_WINDOW_WIDTH, availableWidth);
  const minHeight = Math.min(MIN_WINDOW_HEIGHT, availableHeight);

  let winWidth = Math.min(720, availableWidth * 0.92);
  let winHeight = winWidth / aspectRatio + WINDOW_CHROME_HEIGHT;
  const maxHeight = availableHeight * 0.92;
  if (winHeight > maxHeight) {
    winHeight = maxHeight;
    winWidth = (winHeight - WINDOW_CHROME_HEIGHT) * aspectRatio;
  }
  winWidth = Math.min(Math.max(winWidth, minWidth), availableWidth);
  winHeight = Math.min(Math.max(winHeight, minHeight), availableHeight);

  const offset = (cascadeCount++ % 6) * 28;
  const left = Math.max(
    4,
    Math.min(
      (desktopWidth - winWidth) / 2 + offset - 56,
      desktopWidth - winWidth - 4,
    ),
  );
  const top = Math.max(
    4,
    Math.min(
      (desktopHeight - winHeight) / 2 + offset - 40,
      desktopHeight - winHeight - 4,
    ),
  );

  const el = createWindowElement(gameId);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${winWidth}px`;
  el.style.height = `${winHeight}px`;
  document.getElementById("desktop").appendChild(el);

  const win = {
    gameId,
    el,
    type: game.type,
    player: null,
    minimized: false,
    maximized: false,
    prevRect: null,
    zIndex: 0,
    lastUsed: Date.now(),
    content: el.querySelector(".window-content"),
    maximizeBtn: el.querySelector(".maximize-btn"),
    favoriteBtn: el.querySelector(".favorite-btn"),
    favoriteMenuItem: el.querySelector('[data-game-action="favorite"]'),
    volumeBtn: el.querySelector(".volume-btn"),
    volumeMenuItem: el.querySelector('[data-game-action="mute"]'),
    volumeSlider: el.querySelector(".volume-slider"),
  };
  openWindows.set(gameId, win);
  trackGamePlay(gameId);

  switch (game.type) {
    case "swf":
      loadRuffleSWF(gameId, win);
      break;
    case "iframe":
      loadIframe(gameId, win);
      break;
  }

  saveBundledGameForOffline(gameId);

  wireWindowControls(win);
  // Focusing the window also links it in the address hash.
  focusWindow(gameId);
};
