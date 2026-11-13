"use strict";

// ============================================
// Window Manager
// ============================================

const openWindows = new Map();
let focusedGameId = null;
let zIndexCounter = 100;
let cascadeCount = 0;

const getDesktopSize = () => {
  const desktop = document.getElementById("desktop");
  return { width: desktop.clientWidth, height: desktop.clientHeight };
};

const XP_TASKBAR_HEIGHT = 30;
const sameWorkAreaBand = (left, right) => Math.abs(left - right) <= 1;

const getVisibleWorkArea = () => {
  let { width: desktopWidth, height: desktopHeight } = getDesktopSize();
  const viewportWidth =
    Number(window.visualViewport?.width) || Number(window.innerWidth) || 0;
  const viewportHeight =
    Number(window.visualViewport?.height) || Number(window.innerHeight) || 0;
  if (desktopWidth <= 0) desktopWidth = viewportWidth;
  if (desktopHeight <= 0) desktopHeight = viewportHeight;
  const taskbarSettings = getTaskbarSettings();
  if (taskbarSettings.autoHide || !taskbarSettings.onTop) {
    return {
      width: Math.min(desktopWidth, viewportWidth),
      height: Math.min(desktopHeight, viewportHeight),
    };
  }
  const measuredTaskbar = Number(
    document.getElementById("taskbar")?.getBoundingClientRect().height,
  );
  const taskbarHeight =
    measuredTaskbar > 0 && measuredTaskbar <= XP_TASKBAR_HEIGHT + 8
      ? measuredTaskbar
      : 0;
  let width = desktopWidth;
  let height = desktopHeight;
  const alignedWidth =
    viewportWidth > 0 && sameWorkAreaBand(desktopWidth, viewportWidth);
  const alignedHeight =
    viewportHeight > 0 && sameWorkAreaBand(desktopHeight, viewportHeight);
  if (alignedWidth && alignedHeight) {
    height = Math.max(0, height - (taskbarHeight || XP_TASKBAR_HEIGHT));
  } else if (
    alignedWidth &&
    viewportHeight > 0 &&
    viewportHeight < desktopHeight
  ) {
    height = Math.max(0, Math.floor(viewportHeight - taskbarHeight));
  } else if (
    alignedHeight &&
    viewportWidth > 0 &&
    viewportWidth < desktopWidth
  ) {
    width = Math.floor(viewportWidth);
  } else if (
    Number(window.visualViewport?.scale) > 1 &&
    viewportWidth > 0 &&
    viewportHeight > 0
  ) {
    // Pinch zoom shrinks both axes at once, so neither aligns with the
    // desktop; clamp to what the reader can actually reach.
    width = Math.min(width, Math.floor(viewportWidth));
    height = Math.min(
      height,
      Math.max(0, Math.floor(viewportHeight - taskbarHeight)),
    );
  }
  return {
    width: width > 0 ? width : desktopWidth,
    height: height > 0 ? height : desktopHeight,
  };
};

const isWindowPlacement = (value) =>
  value &&
  typeof value === "object" &&
  Number.isFinite(value.left) &&
  Number.isFinite(value.top) &&
  Number.isFinite(value.width) &&
  value.width > 0 &&
  Number.isFinite(value.height) &&
  value.height > 0;

const isWindowPlacementMap = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every(isWindowPlacement);

const getWindowPlacements = () =>
  readJsonStorage(WINDOW_PLACEMENTS_KEY, {}, isWindowPlacementMap);

const parseWindowLength = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const persistWindowPlacement = (win) => {
  // Maximizing records the restore geometry before the window grows.
  const source = win.maximized ? win.prevRect : win.el.style;
  const placement = {
    left: parseWindowLength(source.left, win.el.offsetLeft),
    top: parseWindowLength(source.top, win.el.offsetTop),
    width: parseWindowLength(source.width, win.el.offsetWidth),
    height: parseWindowLength(source.height, win.el.offsetHeight),
  };
  if (!isWindowPlacement(placement)) return;
  writeJsonStorage(WINDOW_PLACEMENTS_KEY, {
    ...getWindowPlacements(),
    [win.gameId]: placement,
  });
};

const restoreWindowPlacement = (win) => {
  const saved = getWindowPlacements()[win.gameId];
  if (!saved) return;
  const { width: desktopWidth, height: desktopHeight } = getVisibleWorkArea();
  const width =
    desktopWidth > 0 ? Math.min(saved.width, desktopWidth) : saved.width;
  const height =
    desktopHeight > 0 ? Math.min(saved.height, desktopHeight) : saved.height;
  Object.assign(win.el.style, {
    width: `${width}px`,
    height: `${height}px`,
    left: `${saved.left}px`,
    top: `${saved.top}px`,
  });
  if (desktopWidth > 0 && desktopHeight > 0) {
    const position = clampWindowPosition(win, saved.left, saved.top, {
      fullyVisible: true,
    });
    win.el.style.left = `${position.left}px`;
    win.el.style.top = `${position.top}px`;
  }
};

// Keep at least part of the title bar reachable inside the work area,
// matching how Windows XP constrains window positions.
const clampWindowPosition = (win, left, top, { fullyVisible = false } = {}) => {
  const { width: desktopWidth, height: desktopHeight } = getVisibleWorkArea();
  const width = parseWindowLength(win.el.style.width, win.el.offsetWidth);
  const height = parseWindowLength(win.el.style.height, win.el.offsetHeight);
  if (fullyVisible) {
    return {
      left: Math.min(Math.max(left, 0), Math.max(0, desktopWidth - width)),
      top: Math.min(Math.max(top, 0), Math.max(0, desktopHeight - height)),
    };
  }
  return {
    left: Math.min(Math.max(left, 60 - width), desktopWidth - 60),
    top: Math.min(Math.max(top, 0), desktopHeight - 28),
  };
};

// Fixed-size XP windows keep their measured layouts. On a screen smaller
// than one, the window shrinks to fit and its client area scales down with
// CSS zoom. A program that resizes its own window, like Minesweeper for an
// Expert board, sets a new natural size and gets fitted again.
const fitFixedWindow = (win, client) => {
  const { el } = win;
  let natural = null;
  let fitted = null;
  const readSize = () => ({
    width: parseWindowLength(el.style.width, el.offsetWidth),
    height: parseWindowLength(el.style.height, el.offsetHeight),
  });
  const fit = () => {
    const { width: areaWidth, height: areaHeight } = getVisibleWorkArea();
    // A desktop this small hasn't been laid out yet.
    if (!natural || areaWidth <= 16 || areaHeight <= 16) return;
    client.style.zoom = "";
    // The frame, title bar and menus keep their size; only the client scales.
    const chrome = (outer, inner) => Math.max(0, outer - inner || 0);
    const chromeWidth = chrome(el.offsetWidth, client.offsetWidth);
    const chromeHeight = chrome(el.offsetHeight, client.offsetHeight);
    const scale = (area, size, chrome) =>
      area > chrome && size > area ? (area - chrome) / (size - chrome) : 1;
    const zoom = Math.min(
      scale(areaWidth, natural.width, chromeWidth),
      scale(areaHeight, natural.height, chromeHeight),
    );
    const width = Math.floor(
      chromeWidth + (natural.width - chromeWidth) * zoom,
    );
    const height = Math.floor(
      chromeHeight + (natural.height - chromeHeight) * zoom,
    );
    Object.assign(el.style, {
      width: `${width}px`,
      height: `${height}px`,
      minWidth: zoom < 1 ? `${width}px` : natural.minWidth,
      minHeight: zoom < 1 ? `${height}px` : natural.minHeight,
    });
    // Compared as the element keeps them, so a value the browser rewrites
    // doesn't read as the program resizing its window.
    fitted = { width: el.style.width, height: el.style.height };
    client.style.zoom = zoom < 1 ? String(zoom) : "";
    const left = parseWindowLength(el.style.left, el.offsetLeft);
    const top = parseWindowLength(el.style.top, el.offsetTop);
    // Positions like Volume Control's one pixel above the screen stay.
    if (left + width <= areaWidth && top + height <= areaHeight) return;
    const position = clampWindowPosition(win, left, top, {
      fullyVisible: true,
    });
    el.style.left = `${position.left}px`;
    el.style.top = `${position.top}px`;
  };
  const remember = () => {
    if (
      fitted &&
      el.style.width === fitted.width &&
      el.style.height === fitted.height
    )
      return;
    natural = {
      ...readSize(),
      minWidth: el.style.minWidth,
      minHeight: el.style.minHeight,
    };
    fit();
  };
  win.fitToWorkArea = fit;
  remember();
  new MutationObserver(remember).observe(el, {
    attributes: true,
    attributeFilter: ["style"],
  });
};

const keepWindowsInWorkArea = () => {
  const { width: desktopWidth, height: desktopHeight } = getDesktopSize();
  if (desktopWidth === 0 || desktopHeight === 0) return;

  openWindows.forEach((win) => {
    if (win.maximized) return;
    if (win.fitToWorkArea) {
      win.fitToWorkArea();
      return;
    }
    const el = win.el;
    const width = parseWindowLength(el.style.width, el.offsetWidth);
    const height = parseWindowLength(el.style.height, el.offsetHeight);
    el.style.width = `${Math.min(width, desktopWidth)}px`;
    el.style.height = `${Math.min(height, desktopHeight)}px`;
    const position = clampWindowPosition(win, el.offsetLeft, el.offsetTop, {
      fullyVisible: true,
    });
    el.style.left = `${position.left}px`;
    el.style.top = `${position.top}px`;
  });
};

const snapshotWindowState = () => ({
  focusedGameId,
  zIndexCounter,
  windows: [...openWindows.values()].map((win) => ({
    gameId: win.gameId,
    minimized: win.minimized,
    maximized: win.maximized,
    zIndex: win.zIndex,
    lastUsed: win.lastUsed,
    prevRect: win.prevRect ? { ...win.prevRect } : null,
    styles: Object.fromEntries(
      ["left", "top", "width", "height", "display", "zIndex"].map((name) => [
        name,
        win.el.style[name],
      ]),
    ),
  })),
});

const restoreWindowState = (snapshot) => {
  if (!snapshot) return;
  snapshot.windows.forEach((saved) => {
    const win = openWindows.get(saved.gameId);
    if (!win) return;
    Object.assign(win, {
      minimized: saved.minimized,
      maximized: saved.maximized,
      zIndex: saved.zIndex,
      lastUsed: saved.lastUsed,
      prevRect: saved.prevRect ? { ...saved.prevRect } : null,
    });
    Object.assign(win.el.style, saved.styles);
    win.el.classList.toggle("maximized", saved.maximized);
  });
  focusedGameId = openWindows.has(snapshot.focusedGameId)
    ? snapshot.focusedGameId
    : null;
  // Opening a window focuses it, so every open window has a z-index.
  zIndexCounter = Math.max(
    snapshot.zIndexCounter,
    ...[...openWindows.values()].map((win) => win.zIndex),
  );
  openWindows.forEach((win, gameId) =>
    win.el.classList.toggle("active", gameId === focusedGameId),
  );
  // A bounded selected monitor is not a physical viewport constraint. Only
  // clamp a restored snapshot when the browser itself is the limiting edge.
  const monitor = getSimulatedMonitorSize();
  if (activeMonitorResolution === "auto" || monitor.limited)
    keepWindowsInWorkArea();
  layoutDesktopIcons();
  applyFocusVolumes();
  renderTaskButtons();
  updateDocumentTitle();
};

const updateDocumentTitle = () => {
  document.title = focusedGameId ? formatGameTitle(focusedGameId) : "Astro XP";
};

const applyFocusVolumes = () => {
  openWindows.forEach((win, gameId) => {
    const volume = gameId === focusedGameId ? normalizeGameVolume(gameId) : 0;
    setPlayerVolume(win.player, win.type, volume);
  });
};

const syncWindowVolumeUI = (win) => {
  if (!win.volumeBtn) return;
  const { volume, isMuted } = getGameVolume(win.gameId);
  const numericVolume = Number.isFinite(volume) ? volume : 100;
  const muted = isMuted || numericVolume === 0;
  [win.volumeBtn, win.volumeMenuItem].filter(Boolean).forEach((button) => {
    button.classList.toggle("checked", muted);
    button.classList.toggle("active", muted);
    button.setAttribute("aria-pressed", String(muted));
    button.setAttribute("aria-checked", String(muted));
  });
  win.volumeBtn.title = muted ? "Unmute / Volume" : "Mute / Volume";
  win.volumeBtn.setAttribute("aria-label", win.volumeBtn.title);
  // Only game windows, which have every volume control, reach here.
  const label = win.volumeMenuItem.querySelector(".menu-item-label");
  const menuLabel = muted ? "&Unmute" : "&Mute";
  win.volumeMenuItem.dataset.accessKey =
    XPDialogs.parseAccessKey(menuLabel).key;
  setAccessKeyText(label, menuLabel);
  win.volumeSlider.value = String(numericVolume);
  win.volumeSlider.setAttribute(
    "aria-valuetext",
    muted ? `Muted, volume ${numericVolume}%` : `${numericVolume}%`,
  );
};

// The value comes from a range input, which is always numeric.
const setWindowVolume = (win, value) => {
  const numericValue = parseInt(value, 10);

  const isMuted = numericValue === 0;
  setGameVolume(win.gameId, numericValue, isMuted);

  if (win.gameId === focusedGameId) {
    setPlayerVolume(win.player, win.type, normalizeGameVolume(win.gameId));
  }
  syncWindowVolumeUI(win);
};

const toggleWindowMute = (win) => {
  const gameSettings = getGameVolume(win.gameId);

  if (gameSettings.isMuted) {
    // Unmuting - restore to previous volume
    const volume = gameSettings.volume || 100;
    setGameVolume(win.gameId, volume, false);
    if (win.gameId === focusedGameId) {
      setPlayerVolume(win.player, win.type, normalizeGameVolume(win.gameId));
    }
  } else {
    // Muting - store current volume before setting to 0
    setGameVolume(win.gameId, gameSettings.volume, true);
    if (win.gameId === focusedGameId) {
      setPlayerVolume(win.player, win.type, 0);
    }
  }
  syncWindowVolumeUI(win);
};

// Only game windows, which have favorite controls, reach here.
const updateFavoriteUI = (win) => {
  const isFavorite = getFavorites().includes(win.gameId);
  [win.favoriteBtn, win.favoriteMenuItem].filter(Boolean).forEach((button) => {
    button.classList.toggle("active", isFavorite);
    button.classList.toggle("checked", isFavorite);
    button.setAttribute("aria-pressed", String(isFavorite));
    button.setAttribute("aria-checked", String(isFavorite));
  });
  win.favoriteBtn.title = isFavorite
    ? "Remove from Favorites"
    : "Add to Favorites";
  win.favoriteBtn.setAttribute("aria-label", win.favoriteBtn.title);
  const label = win.favoriteMenuItem.querySelector(".menu-item-label");
  const menuLabel = isFavorite ? "&Remove from Favorites" : "Add to &Favorites";
  win.favoriteMenuItem.dataset.accessKey =
    XPDialogs.parseAccessKey(menuLabel).key;
  setAccessKeyText(label, menuLabel);
};

const toggleFavorite = (gameId) => {
  const favorites = getFavorites();
  const index = favorites.indexOf(gameId);

  if (index === -1) {
    favorites.push(gameId);
  } else {
    favorites.splice(index, 1);
  }

  setFavorites(favorites);
  // Favorites are toggled from the game's own window.
  updateFavoriteUI(openWindows.get(gameId));

  // Refresh start menu if it's open
  const startMenu = document.getElementById("start-menu");
  if (!startMenu.hidden) {
    buildPinnedPrograms();
    if (!document.getElementById("start-menu-flyouts").hidden) {
      openAllPrograms();
    }
  }
};

const trackGamePlay = (gameId) => {
  const gameStats = getGameStats();
  const timestamp = Date.now();

  if (!gameStats[gameId]) {
    gameStats[gameId] = {
      plays: 0,
      lastPlayed: null,
    };
  }

  gameStats[gameId].plays += 1;
  gameStats[gameId].lastPlayed = timestamp;

  writeJsonStorage("gameStats", gameStats);
  // The window is registered just before its play is tracked.
  openWindows.get(gameId).lastUsed = timestamp;
};

const createWindowElement = (gameId) => {
  const win = document.createElement("div");
  win.className = "xp-window";
  win.dataset.game = gameId;
  // The frame takes the focus when the window has nothing else to focus.
  win.tabIndex = -1;
  win.addEventListener("focusin", (event) => {
    const target = event.target;
    // XP never gives the keys to the frame, or by mouse to the title bar, a
    // toolbar or a task pane. The window's control keeps them.
    if (
      target === win ||
      (pointerHeld && target.closest("[data-mouse-keeps-focus]"))
    ) {
      focusWindowControl(win);
      return;
    }
    // The window remembers its focused control, to give it back when the
    // window becomes active again, like XP. A menu is not a control: XP
    // leaves the menus when the window loses the keys.
    if (!target.closest('[role="menu"], [role="menubar"]'))
      win.lastFocusedElement = target;
  });

  const titleBar = document.createElement("div");
  titleBar.className = "title-bar";
  titleBar.dataset.mouseKeepsFocus = "";

  const titleIcon = createGameIconElement(gameId, "title-icon");

  const titleText = document.createElement("span");
  titleText.className = "title-text";
  titleText.textContent = formatGameTitle(gameId);

  const titleButtons = document.createElement("div");
  titleButtons.className = "title-buttons";

  const minimizeBtn = document.createElement("button");
  minimizeBtn.type = "button";
  minimizeBtn.className = "tb-btn minimize-btn";
  minimizeBtn.title = "Minimize";
  minimizeBtn.setAttribute("aria-label", "Minimize");

  const maximizeBtn = document.createElement("button");
  maximizeBtn.type = "button";
  maximizeBtn.className = "tb-btn maximize-btn";
  maximizeBtn.title = "Maximize";
  maximizeBtn.setAttribute("aria-label", "Maximize");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tb-btn close-btn";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");

  titleButtons.append(minimizeBtn, maximizeBtn, closeBtn);
  titleBar.append(titleIcon, titleText, titleButtons);

  const menuBar = document.createElement("div");
  menuBar.className = "game-menu-bar";
  menuBar.setAttribute("role", "toolbar");
  menuBar.setAttribute("aria-label", "Game controls");

  const menuItems = document.createElement("div");
  menuItems.className = "game-menu-items";
  menuItems.setAttribute("role", "menubar");
  menuItems.setAttribute("aria-label", "Game menu");

  const makeMenuButton = (label) => {
    const { text, key } = XPDialogs.parseAccessKey(label);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-menu-button";
    button.dataset.gameMenu = text.toLowerCase();
    button.dataset.accessKey = key;
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    setAccessKeyText(button, label);
    return button;
  };

  const makeMenuItem = (label, action, options = {}) => {
    const { key } = XPDialogs.parseAccessKey(label);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "game-menu-item";
    item.dataset.gameAction = action;
    item.dataset.accessKey = key;
    item.setAttribute(
      "role",
      options.checkbox ? "menuitemcheckbox" : "menuitem",
    );
    if (options.checkbox) item.setAttribute("aria-checked", "false");
    if (options.disabled) item.disabled = true;
    if (options.checkbox) {
      const check = document.createElement("span");
      check.className = "menu-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      item.appendChild(check);
    }
    const itemLabel = document.createElement("span");
    itemLabel.className = "menu-item-label";
    setAccessKeyText(itemLabel, label);
    item.appendChild(itemLabel);
    if (options.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "menu-shortcut";
      shortcut.textContent = options.shortcut;
      item.appendChild(shortcut);
    }
    return item;
  };

  const makeMenu = (name) => {
    const menu = document.createElement("div");
    menu.className = "game-menu";
    menu.dataset.gameMenu = name;
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    return menu;
  };

  const fileButton = makeMenuButton("&File");
  const helpButton = makeMenuButton("&Help");

  const fileMenu = makeMenu("file");
  fileMenu.append(
    makeMenuItem("&Full Screen", "fullscreen", { shortcut: "F11" }),
    makeMenuItem("Add to &Favorites", "favorite", { checkbox: true }),
    makeMenuItem("&Mute", "mute", { checkbox: true }),
    makeMenuItem("&Volume", "volume-popup"),
    Object.assign(document.createElement("div"), {
      className: "game-menu-separator",
    }),
    makeMenuItem("&Close", "close", { shortcut: "Alt+F4" }),
    Object.assign(document.createElement("div"), {
      className: "game-menu-separator",
    }),
    makeMenuItem("&Properties", "properties", {
      disabled: gamesList[gameId]?.type !== "swf",
    }),
  );

  const helpMenu = makeMenu("help");
  helpMenu.append(makeMenuItem("&About Astro XP", "project"));

  const quickActions = document.createElement("div");
  quickActions.className = "game-quick-actions";

  const fullscreenBtn = document.createElement("button");
  fullscreenBtn.type = "button";
  fullscreenBtn.className = "quick-access-btn fullscreen-btn";
  fullscreenBtn.title = "Full Screen (F11)";
  fullscreenBtn.setAttribute("aria-label", "Full Screen (F11)");
  fullscreenBtn.textContent = "⛶";

  const quickFavoriteBtn = document.createElement("button");
  quickFavoriteBtn.type = "button";
  quickFavoriteBtn.className = "quick-access-btn favorite-btn";
  quickFavoriteBtn.title = "Add to Favorites";
  quickFavoriteBtn.setAttribute("aria-label", "Add to Favorites");
  quickFavoriteBtn.textContent = "★";
  quickFavoriteBtn.setAttribute("aria-pressed", "false");

  const quickVolumeBtn = document.createElement("button");
  quickVolumeBtn.type = "button";
  quickVolumeBtn.className = "quick-access-btn volume-btn";
  quickVolumeBtn.title = "Mute";
  quickVolumeBtn.setAttribute("aria-label", "Mute");
  quickVolumeBtn.textContent = "🔊";
  quickVolumeBtn.setAttribute("aria-pressed", "false");

  const volumeSlider = document.createElement("input");
  volumeSlider.className = "volume-slider game-volume-slider";
  volumeSlider.type = "range";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.step = "1";
  volumeSlider.value = "100";
  volumeSlider.setAttribute("aria-label", "Game volume");

  quickActions.append(
    quickFavoriteBtn,
    quickVolumeBtn,
    volumeSlider,
    fullscreenBtn,
  );
  menuItems.append(fileButton, helpButton);
  menuBar.append(menuItems, quickActions);

  const content = document.createElement("div");
  content.className = "window-content";

  win.append(titleBar, menuBar, fileMenu, helpMenu, content);

  RESIZE_DIRECTIONS.forEach((direction) => {
    const handle = document.createElement("div");
    handle.className = `resize-handle resize-${direction}`;
    handle.dataset.dir = direction;
    win.appendChild(handle);
  });

  return win;
};

const updateMaximizeButton = (win) => {
  const button = win.maximizeBtn;

  button.classList.toggle("restore-btn", win.maximized);
  button.title = win.maximized ? "Restore" : "Maximize";
  button.setAttribute("aria-label", button.title);
};

const bundledGameRoot = (gameId, type) =>
  new URL(
    window.ASTRO_GAME_ROOTS?.[gameId] || `${type}/${gameId}/`,
    document.baseURI,
  ).href;

// Ruffle is ~450 KB of script that only Flash games need, so it loads on the
// first Flash launch instead of during boot. Players are created directly, so
// the <embed>/<object> polyfill (a document-wide MutationObserver) stays off.
let rufflePromise = null;
const loadRuffle = () => {
  if (typeof window.RufflePlayer?.newest === "function")
    return Promise.resolve();
  rufflePromise ??= new Promise((resolve, reject) => {
    window.RufflePlayer = {
      ...window.RufflePlayer,
      config: { ...window.RufflePlayer?.config, polyfills: false },
    };
    const script = document.createElement("script");
    script.src =
      document.querySelector('meta[name="astro-ruffle-src"]')?.content ||
      "js/ruffle.js";
    const fail = () => {
      rufflePromise = null;
      script.remove();
      reject(new Error("Flash player script unavailable"));
    };
    script.onload = () =>
      typeof window.RufflePlayer?.newest === "function" ? resolve() : fail();
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return rufflePromise;
};

const loadRuffleSWF = (gameId, win) => {
  loadRuffle().then(
    () => {
      if (openWindows.get(gameId) !== win || win.player) return;
      mountRuffleSWF(gameId, win);
    },
    (error) => console.error("Could not start %s:", gameId, error),
  );
};

const mountRuffleSWF = (gameId, win) => {
  const ruffle = window.RufflePlayer.newest();
  const player = ruffle.createPlayer();
  player.id = `player-${gameId}`;
  // The game gets the keys when its window becomes active.
  player.dataset.defaultFocus = "";
  win.content.appendChild(player);
  win.player = player;

  const applyVolume = () => {
    const volume = gameId === focusedGameId ? normalizeGameVolume(gameId) : 0;
    setPlayerVolume(player, "swf", volume);
  };
  player.addEventListener("loadedmetadata", applyVolume, { once: true });

  const game = gamesList[gameId];
  const gameRoot = bundledGameRoot(gameId, "swf");
  const archiveUrl = game.archive?.launchUrl;
  const frameRate = resolveGameFrameRate(gameId);
  const config = {
    url: game.url || archiveUrl || `${gameRoot}main.swf`,
    base: game.base || (archiveUrl ? new URL(".", archiveUrl).href : gameRoot),
    ...(game.installed
      ? {
          urlRewriteRules: window.AstroGameLibrary.assetRewriteRules(
            game.uuid,
            location.origin,
          ),
        }
      : {}),
    letterbox: "on",
    scale: "showAll",
    forceScale: true,
    openUrlMode: "confirm",
    showSwfDownload: true,
    ...(frameRate === null ? {} : { frameRate }),
    volume: gameId === focusedGameId ? normalizeGameVolume(gameId) : 0,
    allowScriptAccess: false,
    autoplay: "on",
    unmuteOverlay: "hidden",
  };

  player.load(config);
};

const reloadRuffleSWF = (win) => {
  win.player?.remove();
  win.player = null;
  loadRuffleSWF(win.gameId, win);
};

const getLoadedMovieFrameRate = (player) => {
  try {
    return (
      player?.ruffle?.(1)?.metadata?.frameRate ?? player?.metadata?.frameRate
    );
  } catch {
    return null;
  }
};

// Properties is only enabled for Flash games.
const openGameProperties = (win) => {
  const currentSetting = getGameFrameRateSetting(win.gameId);
  const defaultFrameRate = normalizeFrameRate(gamesList[win.gameId]?.frameRate);
  const nativeFrameRate = getLoadedMovieFrameRate(win.player);
  const dialog = XPDialogs.createDialog({
    title: `${formatGameTitle(win.gameId)} Properties`,
    onCancel: () => dialog.close("cancel"),
  });

  const group = document.createElement("fieldset");
  group.className = "dlg-group game-playback-settings";
  const legend = document.createElement("legend");
  legend.textContent = "Playback";

  const row = document.createElement("div");
  row.className = "game-playback-row";
  const label = document.createElement("label");
  label.htmlFor = "game-frame-rate";
  label.textContent = "Frame rate:";
  const select = document.createElement("select");
  select.id = "game-frame-rate";
  select.className = "xp-select";
  [
    [
      "default",
      defaultFrameRate === null
        ? "Default (native)"
        : `Default (${defaultFrameRate} FPS)`,
    ],
    ["native", "Native (from SWF)"],
    ["30", "30 FPS"],
    ["45", "45 FPS"],
    ["60", "60 FPS"],
    ["custom", "Custom"],
  ].forEach(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  });

  const customInput = document.createElement("input");
  customInput.className = "xp-input game-fps-custom";
  customInput.type = "number";
  customInput.min = "1";
  customInput.max = "240";
  customInput.step = "0.01";
  customInput.setAttribute("aria-label", "Custom frames per second");
  customInput.value =
    typeof currentSetting === "number" ? String(currentSetting) : "60";
  const presetFrameRates = [30, 45, 60];
  select.value =
    typeof currentSetting === "number"
      ? presetFrameRates.includes(currentSetting)
        ? String(currentSetting)
        : "custom"
      : currentSetting;

  const suffix = document.createElement("span");
  suffix.textContent = "FPS";
  const nativeDescription = document.createElement("p");
  nativeDescription.className = "game-playback-note";
  nativeDescription.textContent = Number.isFinite(nativeFrameRate)
    ? `Original: ${nativeFrameRate} FPS`
    : "Native uses the game's own speed.";
  const warning = document.createElement("p");
  warning.className = "game-playback-note";
  warning.textContent = "Other speeds can make the game run faster or slower.";
  const status = document.createElement("p");
  status.className = "game-playback-status";
  status.setAttribute("role", "alert");

  const syncCustomInput = () => {
    const custom = select.value === "custom";
    customInput.hidden = !custom;
    suffix.hidden = !custom;
    if (custom) customInput.focus();
  };
  select.addEventListener("change", syncCustomInput);
  syncCustomInput();

  row.append(label, select, customInput, suffix);
  group.append(legend, row, nativeDescription, warning, status);

  const buttons = document.createElement("div");
  buttons.className = "dlg-buttons";
  const okButton = XPDialogs.createDialogButton(
    { id: "ok", label: "OK", isDefault: true },
    () => {
      const selectedSetting =
        select.value === "default" || select.value === "native"
          ? select.value
          : normalizeFrameRate(
              select.value === "custom" ? customInput.value : select.value,
            );
      if (
        select.value !== "default" &&
        select.value !== "native" &&
        selectedSetting === null
      ) {
        status.textContent = "Enter a frame rate from 1 to 240 FPS.";
        customInput.focus();
        customInput.select();
        return;
      }
      setGameFrameRate(win.gameId, selectedSetting);
      dialog.close("ok");
      if (selectedSetting !== currentSetting) reloadRuffleSWF(win);
    },
  );
  const cancelButton = XPDialogs.createDialogButton(
    { id: "cancel", label: "Cancel", isCancel: true },
    () => dialog.close("cancel"),
  );
  buttons.append(okButton, cancelButton);
  dialog.body.append(group, buttons);
  dialog.defaultButton = okButton;
  select.focus();
};

const loadIframe = (gameId, win) => {
  const player = document.createElement("iframe");
  player.allow = "fullscreen";
  player.src = bundledGameRoot(gameId, "iframe");
  player.id = `player-${gameId}`;
  // The game gets the keys when its window becomes active.
  player.dataset.defaultFocus = "";
  win.content.appendChild(player);
  win.player = player;

  player.addEventListener(
    "load",
    () => {
      const volume = gameId === focusedGameId ? normalizeGameVolume(gameId) : 0;
      setPlayerVolume(player, "iframe", volume);
    },
    { once: true },
  );
};

// A press lasts from pointerdown to its click. The focus that a press gives
// is the mouse's, not the keyboard's. A touch tap moves the focus after its
// pointerup, so the press ends only at the click. A key also ends it,
// because a press can end in an iframe or with a drag, with no click.
let pointerHeld = false;
document.addEventListener("pointerdown", () => (pointerHeld = true), true);
// A right-click or a middle-click ends with its own event, or at its
// pointerup when it ends on another element.
document.addEventListener(
  "pointerup",
  (event) => {
    if (event.button !== 0) pointerHeld = false;
  },
  true,
);
["click", "contextmenu", "auxclick", "pointercancel", "keydown"].forEach(
  (type) => document.addEventListener(type, () => (pointerHeld = false), true),
);
// A click into a game's iframe fires no focusin in the page. So when the
// page loses the focus to an iframe, its window records it.
window.addEventListener("blur", () => {
  const frame = document.activeElement;
  const el = frame?.tagName === "IFRAME" && frame.closest(".xp-window");
  if (el) el.lastFocusedElement = frame;
});

// The window gives the focus to the control that had it last, else to its
// default control. A control that cannot take the focus, such as a disabled
// or hidden one, is skipped. It returns false if no control took it.
const focusWindowControl = (el) => {
  const last = el.lastFocusedElement;
  return [
    last?.isConnected && el.contains(last) ? last : null,
    el.querySelector("[data-default-focus]"),
  ].some((target) => {
    if (!target || target.disabled || target.closest("[hidden]")) return false;
    target.focus({ preventScroll: true });
    return document.activeElement === target;
  });
};

// The keys go to the active window, like XP. If the focus is outside it, the
// window focuses its control, else its frame.
const focusWindowContent = (win) => {
  if (win.el.contains(document.activeElement)) return;
  if (!focusWindowControl(win.el)) win.el.focus({ preventScroll: true });
};

const focusWindow = (gameId) => {
  const win = openWindows.get(gameId);
  if (!win) return;

  // Every pointerdown inside a window lands here. When it is already the
  // active top window, the stacking, volumes and taskbar are current, so skip
  // the restack and taskbar rebuild and only hand focus to the application.
  if (
    focusedGameId === gameId &&
    !win.needsAttention &&
    !win.minimized &&
    win.zIndex === zIndexCounter &&
    win.el.classList.contains("active")
  ) {
    win.lastUsed = Date.now();
    win.mountedApplication?.focus?.();
    return;
  }

  focusedGameId = gameId;
  win.needsAttention = false;
  win.lastUsed = Date.now();
  win.zIndex = ++zIndexCounter;
  win.el.style.zIndex = win.alwaysOnTop ? TOPMOST_Z_INDEX : win.zIndex;
  win.mountedApplication?.focus?.();
  focusWindowContent(win);

  openWindows.forEach((w, id) => {
    w.el.classList.toggle("active", id === gameId);
  });

  applyFocusVolumes();
  syncWindowVolumeUI(win);
  renderTaskButtons();
  updateDocumentTitle();

  const deepLinkId = gamesList[gameId]
    ? gameId
    : window.XPApplicationRegistry?.get(gameId)?.deepLinkId;
  if (deepLinkId && window.location.hash !== `#${deepLinkId}`) {
    const deepLinkUrl = new URL("/", window.location.origin);
    deepLinkUrl.search = window.location.search;
    deepLinkUrl.hash = deepLinkId;
    history.replaceState(null, "", deepLinkUrl);
  }
};

// Topmost windows (Task Manager's Always On Top) stay above the others but
// below shell dialogs (6900) and the taskbar.
const TOPMOST_Z_INDEX = 6800;
const setWindowTopmost = (gameId, topmost) => {
  const win = openWindows.get(gameId);
  win.alwaysOnTop = topmost;
  win.el.style.zIndex = topmost ? TOPMOST_Z_INDEX : win.zIndex;
};

const focusTopWindow = () => {
  let topWin = null;
  openWindows.forEach((win) => {
    if (!win.minimized && (!topWin || win.zIndex > topWin.zIndex)) {
      topWin = win;
    }
  });

  if (topWin) {
    focusWindow(topWin.gameId);
  } else {
    focusedGameId = null;
    applyFocusVolumes();
    renderTaskButtons();
    updateDocumentTitle();
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }
};

// ---- XP's window animations ----
// Minimizing, restoring and maximizing don't zoom the window. XP draws the
// window's caption the way DrawCaption does, without the theme's caption
// art or buttons, and steps it from one rectangle to another, 16 times at
// about 16 ms each. Only then does the window change.
const GHOST_STEPS = 16;
const GHOST_STEP_MS = 16;
const GHOST_FRAME = 4;
// Measured on the XP VM: Luna's 25px caption puts the icon 5px in and 4px
// down and the title 26px in; Classic's 18px caption puts them 2px in and
// 1px down, and 20px in. Everything left of the title is the caption's
// first color, and the gradient runs from the title to the far end.
const GHOST_CAPTIONS = {
  luna: { height: 25, icon: [5, 4], text: 26 },
  classic: { height: 18, icon: [2, 1], text: 20 },
};

const animationsEnabled = () =>
  !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// The caption's rectangle for a window's own rectangle.
const ghostRectFor = ({ left, top, width }) => ({
  left: left + GHOST_FRAME,
  top: top + GHOST_FRAME,
  width: width - GHOST_FRAME * 2,
});

// XP pushes a maximized window's frame just past the work area.
const maximizedPageRect = () => {
  const desktop = document.getElementById("desktop").getBoundingClientRect();
  return {
    left: desktop.left - GHOST_FRAME,
    top: desktop.top - GHOST_FRAME,
    width: getVisibleWorkArea().width + GHOST_FRAME * 2,
  };
};

// A window's rectangle in the page, even while it's hidden.
const windowPageRect = (win) => {
  const desktop = document.getElementById("desktop").getBoundingClientRect();
  if (win.maximized) return maximizedPageRect();
  const rect = win.el.getBoundingClientRect();
  if (rect.width > 0) return rect;
  return {
    left: desktop.left + (parseFloat(win.el.style.left) || 0),
    top: desktop.top + (parseFloat(win.el.style.top) || 0),
    width: parseFloat(win.el.style.width) || 0,
  };
};

const taskButtonGhostRect = (win) => {
  const button = document.querySelector(
    `.task-button[data-game="${win.gameId}"]`,
  );
  const rect = button?.getBoundingClientRect();
  if (rect?.width > 0)
    return {
      left: rect.left + GHOST_FRAME,
      top: rect.top,
      width: rect.width - GHOST_FRAME * 2,
    };
  const source = windowPageRect(win);
  return {
    left: source.left + source.width / 2 - 40,
    top: getViewportHeight() - 24,
    width: 80,
  };
};

const finishWindowAnimation = (win) => win.windowAnimation?.complete();

// The caption XP steps across the screen. Like DrawCaption it is drawn once,
// as wide as the wider rectangle, and each step shows its left part.
const createCaptionGhost = (win, width, active) => {
  const classic = document.documentElement.dataset.xpAppearance === "classic";
  const metrics = GHOST_CAPTIONS[classic ? "classic" : "luna"];
  const ghost = document.createElement("div");
  ghost.className = `window-ghost${active ? " active" : ""}`;
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.height = `${metrics.height}px`;
  const caption = document.createElement("div");
  caption.className = "window-ghost-caption";
  Object.assign(caption.style, {
    width: `${Math.max(0, Math.round(width))}px`,
    backgroundPosition: `${metrics.text}px 0`,
    backgroundSize: `${Math.max(0, Math.round(width) - metrics.text)}px 100%`,
  });
  const icon = win.el.querySelector(".title-icon")?.cloneNode(true);
  if (icon) {
    icon.classList.add("window-ghost-icon");
    icon.style.left = `${metrics.icon[0]}px`;
    icon.style.top = `${metrics.icon[1]}px`;
    caption.append(icon);
  }
  const title = document.createElement("span");
  title.className = "window-ghost-text";
  title.style.left = `${metrics.text}px`;
  title.textContent = win.el.querySelector(".title-text")?.textContent || "";
  caption.append(title);
  ghost.append(caption);
  return ghost;
};

// Steps a caption bar from one rectangle to another, then runs `done`.
// Starting another animation, or calling finishWindowAnimation(), runs the
// first one's `done` straight away.
const animateCaption = (
  win,
  from,
  to,
  done,
  active = win.el.classList.contains("active"),
) => {
  finishWindowAnimation(win);
  const ghost = createCaptionGhost(win, Math.max(from.width, to.width), active);
  document.body.append(ghost);
  let step = 0;
  let timer = 0;
  // Only one caption runs at a time, so finishing one always clears the slot.
  const animation = {
    cancel() {
      clearTimeout(timer);
      ghost.remove();
      win.windowAnimation = null;
    },
    complete() {
      animation.cancel();
      done();
    },
  };
  win.windowAnimation = animation;
  const tick = () => {
    if (step >= GHOST_STEPS) {
      animation.complete();
      return;
    }
    const progress = step / GHOST_STEPS;
    const between = (start, end) => start + (end - start) * progress;
    Object.assign(ghost.style, {
      left: `${Math.round(between(from.left, to.left))}px`,
      top: `${Math.round(between(from.top, to.top))}px`,
      width: `${Math.round(between(from.width, to.width))}px`,
    });
    step += 1;
    timer = setTimeout(tick, GHOST_STEP_MS);
  };
  tick();
};

const minimizeWindow = (gameId, { animate = false } = {}) => {
  const win = openWindows.get(gameId);
  if (!win || win.minimized) return;

  win.minimized = true;
  const hide = () => {
    if (win.minimized) win.el.style.display = "none";
  };
  if (animate && animationsEnabled()) {
    animateCaption(
      win,
      ghostRectFor(windowPageRect(win)),
      taskButtonGhostRect(win),
      hide,
    );
  } else {
    finishWindowAnimation(win);
    hide();
  }

  if (focusedGameId === gameId) {
    focusedGameId = null;
    focusTopWindow();
  } else {
    renderTaskButtons();
  }
};

const restoreWindow = (gameId, { animate = false } = {}) => {
  const win = openWindows.get(gameId);
  if (!win || !win.minimized) return;

  win.minimized = false;
  // A hidden window cannot take the focus, so the active window takes it
  // when it shows.
  const show = () => {
    if (win.minimized) return;
    win.el.style.display = "flex";
    if (focusedGameId === gameId) focusWindowContent(win);
  };
  if (animate && animationsEnabled()) {
    // The restored window is about to be the active one.
    animateCaption(
      win,
      taskButtonGhostRect(win),
      ghostRectFor(windowPageRect(win)),
      show,
      true,
    );
  } else {
    finishWindowAnimation(win);
    show();
  }
};

const minimizeAllWindows = () => {
  openWindows.forEach((win) => {
    win.minimized = true;
    win.el.style.display = "none";
  });
  focusedGameId = null;
  applyFocusVolumes();
  renderTaskButtons();
  updateDocumentTitle();
};

let showDesktopSnapshot = null;
const toggleShowDesktop = () => {
  if (showDesktopSnapshot) {
    showDesktopSnapshot.windows.forEach(({ gameId, minimized }) => {
      const win = openWindows.get(gameId);
      if (win && !minimized) restoreWindow(gameId);
    });
    const activeGameId = showDesktopSnapshot.focusedGameId;
    showDesktopSnapshot = null;
    if (activeGameId && openWindows.has(activeGameId)) {
      focusWindow(activeGameId);
    } else focusTopWindow();
    return;
  }

  showDesktopSnapshot = {
    focusedGameId,
    windows: [...openWindows.values()].map((win) => ({
      gameId: win.gameId,
      minimized: win.minimized,
    })),
  };
  minimizeAllWindows();
};

const toggleMaximize = (gameId, { animate = false } = {}) => {
  const win = openWindows.get(gameId);
  finishWindowAnimation(win);
  const maximizing = !win.maximized;
  const from = ghostRectFor(windowPageRect(win));
  let to;
  if (maximizing) {
    win.prevRect = {
      left: win.el.style.left,
      top: win.el.style.top,
      width: win.el.style.width,
      height: win.el.style.height,
    };
    persistWindowPlacement(win);
    to = ghostRectFor(maximizedPageRect());
  } else {
    const desktop = document.getElementById("desktop").getBoundingClientRect();
    to = ghostRectFor({
      left: desktop.left + parseFloat(win.prevRect.left),
      top: desktop.top + parseFloat(win.prevRect.top),
      width: parseFloat(win.prevRect.width),
    });
  }
  win.maximized = maximizing;
  // The window changes once its caption has stepped to the new rectangle.
  const apply = () => {
    if (maximizing) {
      win.el.classList.add("maximized");
    } else {
      win.el.classList.remove("maximized");
      // Maximizing always records the restore geometry.
      Object.assign(win.el.style, win.prevRect);
      const position = clampWindowPosition(
        win,
        win.el.offsetLeft,
        win.el.offsetTop,
      );
      win.el.style.left = `${position.left}px`;
      win.el.style.top = `${position.top}px`;
    }
    updateMaximizeButton(win);
    focusWindow(gameId);
  };
  if (animate && animationsEnabled()) animateCaption(win, from, to, apply);
  else apply();
};

const closeGameWindow = (gameId, { skipBeforeClose = false } = {}) => {
  const win = openWindows.get(gameId);
  if (!win) return true;
  if (!skipBeforeClose && win.closePromise) return win.closePromise;

  if (!skipBeforeClose && win.beforeClose) {
    const result = win.beforeClose();
    if (result && typeof result.then === "function") {
      win.closePromise = result
        .then((shouldClose) => {
          return shouldClose !== false
            ? closeGameWindow(gameId, { skipBeforeClose: true })
            : false;
        })
        .catch((error) => {
          void XPDialogs.alert(
            error.message || "The window could not be closed.",
            "Astro XP",
            "error",
          );
          return false;
        })
        .finally(() => {
          win.closePromise = null;
        });
      return win.closePromise;
    }
    if (result === false) return false;
  }
  if (win.removeGameDataOnClose) {
    const temporaryData = win.removeGameDataOnClose;
    win.removeGameDataOnClose = false;
    return gameDataManager
      .removeTemporary(temporaryData.storageId, temporaryData.fileName)
      .catch((error) =>
        console.error("Could not remove temporary %s data:", gameId, error),
      )
      .then(() => {
        window.postMessage(
          { event: "astro.game-data-changed" },
          location.origin,
        );
        return closeGameWindow(gameId, { skipBeforeClose: true });
      });
  }
  // A closed window drops its caption without changing.
  win.windowAnimation?.cancel();
  persistWindowPlacement(win);
  win.mountedApplication?.unmount?.();
  win.el.remove();
  openWindows.delete(gameId);

  if (focusedGameId === gameId) {
    focusedGameId = null;
    focusTopWindow();
  } else {
    renderTaskButtons();
  }
  return true;
};

const wireDrag = (win) => {
  restoreWindowPlacement(win);
  const bar = win.el.querySelector(".title-bar");
  const titleIcon = bar.querySelector(".title-icon");

  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".title-buttons, .title-icon"))
      return;

    closeWindowSystemMenu();
    let restoredFromMaximized = false;
    if (win.maximized) {
      // Restore the window under the pointer before dragging, keeping
      // the pointer at the same relative position on the title bar.
      const rect = win.el.getBoundingClientRect();
      const ratio = Math.min(
        Math.max((e.clientX - rect.left) / rect.width, 0),
        1,
      );
      toggleMaximize(win.gameId);
      const position = clampWindowPosition(
        win,
        e.clientX - win.el.offsetWidth * ratio,
        e.clientY - 14,
      );
      win.el.style.left = `${position.left}px`;
      win.el.style.top = `${position.top}px`;
      restoredFromMaximized = true;
    } else {
      focusWindow(win.gameId);
    }

    const start = {
      x: e.clientX,
      y: e.clientY,
      left: win.el.offsetLeft,
      top: win.el.offsetTop,
      width: win.el.offsetWidth,
      desktop: getVisibleWorkArea(),
    };
    let frame = 0;
    let nextPosition = { left: start.left, top: start.top };

    const getPosition = (clientX, clientY) => ({
      left: Math.min(
        Math.max(start.left + clientX - start.x, 60 - start.width),
        start.desktop.width - 60,
      ),
      top: Math.min(
        Math.max(start.top + clientY - start.y, 0),
        start.desktop.height - 28,
      ),
    });
    const renderPosition = () => {
      win.el.style.transform = `translate3d(${nextPosition.left - start.left}px, ${nextPosition.top - start.top}px, 0)`;
    };

    const onMove = (ev) => {
      nextPosition = getPosition(ev.clientX, ev.clientY);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(renderPosition);
    };

    const onUp = (ev) => {
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.removeEventListener("pointercancel", onUp);
      cancelAnimationFrame(frame);
      if (ev.type === "pointerup") {
        nextPosition = getPosition(ev.clientX, ev.clientY);
      }
      win.el.style.left = `${nextPosition.left}px`;
      win.el.style.top = `${nextPosition.top}px`;
      win.el.style.transform = "";
      win.el.classList.remove("moving");
      if (restoredFromMaximized) {
        // The dragged position becomes the new restore geometry.
        win.prevRect = {
          left: win.el.style.left,
          top: win.el.style.top,
          width: win.el.style.width,
          height: win.el.style.height,
        };
      }
      persistWindowPlacement(win);
    };

    try {
      bar.setPointerCapture(e.pointerId);
    } catch (error) {
      /* pointer capture unsupported */
    }

    win.el.getAnimations().forEach((animation) => animation.cancel());
    win.el.classList.add("moving");
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
    bar.addEventListener("pointercancel", onUp);
    e.preventDefault();
  });

  bar.addEventListener("dblclick", (e) => {
    if (e.target.closest(".title-buttons, .title-icon")) return;
    toggleMaximize(win.gameId, { animate: true });
  });

  // Right-clicking the title bar opens the window system menu.
  bar.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openWindowSystemMenu(win, e.clientX, e.clientY);
  });

  // Windows XP: clicking the title-bar icon opens the system menu,
  // double-clicking it closes the window.
  titleIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = titleIcon.getBoundingClientRect();
    openWindowSystemMenu(win, rect.left, rect.bottom + 2);
  });
  titleIcon.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    closeGameWindow(win.gameId);
  });
};

const applyResize = (win, direction, start, deltaX, deltaY, desktopSize) => {
  const { width: desktopWidth, height: desktopHeight } = desktopSize;
  const right = start.left + start.width;
  const bottom = start.top + start.height;
  let { left, top, width, height } = start;

  if (direction.includes("e")) {
    width = Math.min(
      Math.max(start.width + deltaX, MIN_WINDOW_WIDTH),
      desktopWidth - start.left,
    );
  }
  if (direction.includes("w")) {
    width = Math.min(Math.max(start.width - deltaX, MIN_WINDOW_WIDTH), right);
    left = right - width;
  }
  if (direction.includes("s")) {
    height = Math.min(
      Math.max(start.height + deltaY, MIN_WINDOW_HEIGHT),
      desktopHeight - start.top,
    );
  }
  if (direction.includes("n")) {
    height = Math.min(
      Math.max(start.height - deltaY, MIN_WINDOW_HEIGHT),
      bottom,
    );
    top = bottom - height;
  }

  Object.assign(win.el.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
};

const wireResize = (win) => {
  win.el.querySelectorAll(".resize-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || win.maximized) return;
      focusWindow(win.gameId);
      e.preventDefault();

      const direction = handle.dataset.dir;
      // Native windows echo their new client size back as metadata; ignore it
      // while dragging so the frame does not fight the pointer.
      win.resizing = true;
      const start = {
        x: e.clientX,
        y: e.clientY,
        left: win.el.offsetLeft,
        top: win.el.offsetTop,
        width: win.el.offsetWidth,
        height: win.el.offsetHeight,
      };
      const desktopSize = getVisibleWorkArea();
      let frame = 0;
      let nextPointer = { x: e.clientX, y: e.clientY };

      const updateSize = () =>
        applyResize(
          win,
          direction,
          start,
          nextPointer.x - start.x,
          nextPointer.y - start.y,
          desktopSize,
        );

      const onMove = (ev) => {
        nextPointer = { x: ev.clientX, y: ev.clientY };
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(updateSize);
      };

      const onUp = (ev) => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        cancelAnimationFrame(frame);
        if (ev.type === "pointerup") {
          nextPointer = { x: ev.clientX, y: ev.clientY };
        }
        updateSize();
        win.resizing = false;
        persistWindowPlacement(win);
        win.mountedApplication?.bounds?.(
          win.el.offsetLeft,
          win.el.offsetTop,
          win.el.offsetWidth,
          win.el.offsetHeight,
        );
      };

      try {
        handle.setPointerCapture(e.pointerId);
      } catch (error) {
        /* pointer capture unsupported */
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  });
};

// ============================================
// Shell popups (menus, the Start menu, the volume popup)
// ============================================

// Like XP, the keys never go to the page. A popup that closes gives the keys
// back to the control that had them before it got them. A press on a part
// of a popup that is not a control keeps the keys where they are.
const SHELL_POPUP =
  '[role="menu"], #start-menu, #start-menu-flyouts, #tray-volume-popup';
const POPUP_CONTROL =
  "button:not(:disabled), input:not(:disabled), select, textarea, label, a[href], [tabindex]";
const popupReturnFocus = new WeakMap();

document.addEventListener(
  "focusin",
  (event) => {
    const from = event.relatedTarget;
    if (!from) return;
    // The first control outside a popup that gives it the keys is the one
    // that gets them back. Keys that come back from a flyout of the popup
    // do not change it. A popup in a popup records its own return.
    for (
      let popup = event.target.closest(SHELL_POPUP);
      popup && !popup.contains(from);
      popup = popup.parentElement.closest(SHELL_POPUP)
    )
      if (!popupReturnFocus.has(popup)) popupReturnFocus.set(popup, from);
  },
  true,
);

document.addEventListener(
  "mousedown",
  (event) => {
    const popup = event.target.closest(SHELL_POPUP);
    if (!popup) return;
    const control = event.target.closest(POPUP_CONTROL);
    if (!control || !popup.contains(control)) event.preventDefault();
  },
  true,
);

// Chrome skips focus() on a control that a style or a class hides, such as
// a control in a minimized window. So a move counts only when the control
// has the keys after it.
const keysTaken = (target) => {
  if (!target?.isConnected || target.closest("[hidden]")) return false;
  target.focus({ preventScroll: true });
  return document.activeElement === target;
};
// The keys go to the active window, like XP, or else to the desktop.
const giveKeysToActiveWindow = () => {
  const win = openWindows.get(focusedGameId);
  if (win && !win.minimized) {
    focusWindowContent(win);
    if (win.el.contains(document.activeElement)) return;
  }
  document.getElementById("desktop-icons").focus({ preventScroll: true });
};

// Chrome sends no mousedown for a disabled item, but it still moves the
// keys, to the page or to the window. They go back to where they were, like
// XP, after the press. A hover still reaches the item.
document.addEventListener(
  "pointerdown",
  (event) => {
    if (
      !event.target.closest(SHELL_POPUP) ||
      !event.target.closest(":disabled")
    )
      return;
    const keys = document.activeElement;
    setTimeout(() => {
      if (document.activeElement !== keys && !keysTaken(keys))
        giveKeysToActiveWindow();
    });
  },
  true,
);

// Chrome puts the keys on the page when it removes the control that has
// them, for example a taskbar button of a window that closes. XP never
// leaves the keys on nothing, so they go to the active window.
let lastKeys = null;
document.addEventListener(
  "focusin",
  (event) => (lastKeys = event.target),
  true,
);
new MutationObserver(() => {
  if (
    document.activeElement === document.body &&
    lastKeys?.isConnected === false
  )
    giveKeysToActiveWindow();
}).observe(document.body, { childList: true, subtree: true });

// Chrome also puts the keys on the page when it hides the control that has
// them, by an attribute, a style or a class. The control then loses the keys
// with no new owner. If nothing takes them after that, the active window
// gets them.
document.addEventListener(
  "focusout",
  (event) => {
    if (event.relatedTarget) return;
    setTimeout(() => {
      if (document.activeElement === document.body && document.hasFocus())
        giveKeysToActiveWindow();
    });
  },
  true,
);

// Call when the popup hides, before it hides. The keys go back to the
// control that had them, or else to the active window or the desktop.
const giveKeysBackFrom = (popup) => {
  const target = popupReturnFocus.get(popup);
  popupReturnFocus.delete(popup);
  if (popup.contains(document.activeElement) && !keysTaken(target))
    giveKeysToActiveWindow();
};

// ============================================
// Window System Menu (Restore / Move / Size / ...)
// ============================================

let systemMenuWin = null;

const closeWindowSystemMenu = () => {
  const menu = document.getElementById("window-system-menu");
  giveKeysBackFrom(menu);
  menu.hidden = true;
  systemMenuWin = null;
};

const openWindowSystemMenu = (win, clientX, clientY) => {
  const desktop = document.getElementById("desktop");
  const menu = document.getElementById("window-system-menu");
  systemMenuWin = win;

  const enabled = {
    restore: win.maximized || win.minimized,
    move: !win.maximized && !win.minimized,
    size: !win.maximized && !win.minimized,
    minimize: !win.minimized,
    maximize: !win.maximized && !win.minimized,
    close: true,
  };
  menu.querySelectorAll("[data-command]").forEach((button) => {
    button.disabled = !enabled[button.dataset.command];
  });

  closeDesktopContextMenu();
  closeStartMenu();
  menu.hidden = false;
  menu.style.left = "0";
  menu.style.top = "0";

  const bounds = desktop.getBoundingClientRect();
  const left = Math.max(
    0,
    Math.min(clientX - bounds.left, bounds.width - menu.offsetWidth - 2),
  );
  const top = Math.max(
    0,
    Math.min(clientY - bounds.top, bounds.height - menu.offsetHeight - 2),
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector("button:not(:disabled)")?.focus();
};

const nudgeWindow = (win, deltaX, deltaY) => {
  const position = clampWindowPosition(
    win,
    win.el.offsetLeft + deltaX,
    win.el.offsetTop + deltaY,
  );
  win.el.style.left = `${position.left}px`;
  win.el.style.top = `${position.top}px`;
};

const nudgeResize = (win, deltaX, deltaY) => {
  const { width: desktopWidth, height: desktopHeight } = getVisibleWorkArea();
  const width = Math.min(
    Math.max(win.el.offsetWidth + deltaX, MIN_WINDOW_WIDTH),
    desktopWidth - win.el.offsetLeft,
  );
  const height = Math.min(
    Math.max(win.el.offsetHeight + deltaY, MIN_WINDOW_HEIGHT),
    desktopHeight - win.el.offsetTop,
  );
  win.el.style.width = `${width}px`;
  win.el.style.height = `${height}px`;
};

// Windows XP Move/Size commands: the window follows the pointer or the
// arrow keys until Enter (or a click) commits or Escape cancels.
// The system menu only enables Move and Size for normal windows.
const startMoveSizeMode = (win, mode) => {
  focusWindow(win.gameId);

  const el = win.el;
  const original = {
    left: el.style.left,
    top: el.style.top,
    width: el.style.width,
    height: el.style.height,
  };
  el.classList.add(`${mode}-mode`);
  let lastPointer = null;

  const finish = (commit) => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    el.classList.remove(`${mode}-mode`);
    if (!commit) {
      Object.assign(el.style, original);
      return;
    }
    // Same as finishing a pointer drag or resize.
    persistWindowPlacement(win);
    win.mountedApplication?.bounds?.(
      el.offsetLeft,
      el.offsetTop,
      el.offsetWidth,
      el.offsetHeight,
    );
  };

  const onKey = (e) => {
    const keys = [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Enter",
      "Escape",
    ];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Enter") return finish(true);
    if (e.key === "Escape") return finish(false);

    const deltaX =
      e.key === "ArrowLeft"
        ? -MOVE_SIZE_STEP
        : e.key === "ArrowRight"
          ? MOVE_SIZE_STEP
          : 0;
    const deltaY =
      e.key === "ArrowUp"
        ? -MOVE_SIZE_STEP
        : e.key === "ArrowDown"
          ? MOVE_SIZE_STEP
          : 0;
    if (mode === "move") {
      nudgeWindow(win, deltaX, deltaY);
    } else {
      nudgeResize(win, deltaX, deltaY);
    }
  };

  const onPointerMove = (e) => {
    if (lastPointer === null) {
      lastPointer = { x: e.clientX, y: e.clientY };
      return;
    }
    const deltaX = e.clientX - lastPointer.x;
    const deltaY = e.clientY - lastPointer.y;
    lastPointer = { x: e.clientX, y: e.clientY };
    if (mode === "move") {
      nudgeWindow(win, deltaX, deltaY);
    } else {
      nudgeResize(win, deltaX, deltaY);
    }
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    finish(true);
  };

  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerdown", onPointerDown, true);
};

const runSystemMenuCommand = (win, command) => {
  switch (command) {
    case "restore":
      if (win.minimized) {
        restoreWindow(win.gameId, { animate: true });
        focusWindow(win.gameId);
        break;
      }
      toggleMaximize(win.gameId, { animate: true });
      break;
    case "maximize":
      toggleMaximize(win.gameId, { animate: true });
      break;
    case "minimize":
      minimizeWindow(win.gameId, { animate: true });
      break;
    case "close":
      closeGameWindow(win.gameId);
      break;
    case "move":
    case "size":
      startMoveSizeMode(win, command);
      break;
  }
};

const setupWindowSystemMenu = () => {
  const menu = document.getElementById("window-system-menu");
  menu.addEventListener("click", (e) => {
    const button = e.target.closest("[data-command]");
    if (!button || button.disabled || !systemMenuWin) return;
    const win = systemMenuWin;
    closeWindowSystemMenu();
    runSystemMenuCommand(win, button.dataset.command);
  });
};

const wireWindowControls = (win) => {
  const gameId = win.gameId;
  const menuBar = win.el.querySelector(".game-menu-bar");
  const menus = [...win.el.querySelectorAll(".game-menu")];
  const menuButtons = [...menuBar.querySelectorAll(".game-menu-button")];

  // Keys in a menu that closes go back to the window's control, so a
  // close never leaves them on the page, like XP. The frame passes them on.
  const closeGameMenus = () => {
    const holdsKeys = menus.some((menu) =>
      menu.contains(document.activeElement),
    );
    menus.forEach((menu) => {
      menu.hidden = true;
    });
    menuButtons.forEach((button) =>
      button.setAttribute("aria-expanded", "false"),
    );
    if (holdsKeys) win.el.focus({ preventScroll: true });
  };
  // A press outside the window closes the menus through the shell. Keys
  // that move to another window close them too, like XP.
  menus.forEach((menu) => (menu.closeMenus = closeGameMenus));
  win.el.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !win.el.contains(event.relatedTarget))
      closeGameMenus();
  });

  const openGameMenu = (name, focusFirstItem = false) => {
    const menu = menus.find((item) => item.dataset.gameMenu === name);
    const button = menuButtons.find((item) => item.dataset.gameMenu === name);
    closeGameMenus();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    if (focusFirstItem) {
      menu
        .querySelector("button:not(:disabled), input:not(:disabled)")
        ?.focus();
    }
  };

  const switchGameMenu = (currentName, direction) => {
    const currentIndex = menuButtons.findIndex(
      (button) => button.dataset.gameMenu === currentName,
    );
    const next =
      menuButtons[
        (currentIndex + direction + menuButtons.length) % menuButtons.length
      ];
    next.focus();
    openGameMenu(next.dataset.gameMenu, true);
  };

  win.el.addEventListener("pointerdown", () => focusWindow(gameId));

  win.el
    .querySelector(".close-btn")
    .addEventListener("click", () => closeGameWindow(gameId));
  win.el
    .querySelector(".minimize-btn")
    .addEventListener("click", () => minimizeWindow(gameId));
  win.el
    .querySelector(".maximize-btn")
    .addEventListener("click", () => toggleMaximize(gameId));
  win.el.querySelector(".fullscreen-btn").addEventListener("click", () => {
    if (win.player) toggleFullscreen(win.player);
  });
  win.favoriteBtn.addEventListener("click", () => toggleFavorite(gameId));
  win.volumeBtn.addEventListener("click", () => toggleWindowMute(win));
  win.volumeSlider.addEventListener("input", () => {
    setWindowVolume(win, win.volumeSlider.value);
  });

  menuBar.addEventListener("click", (event) => {
    const button = event.target.closest(".game-menu-button");
    if (!button) return;
    const menu = menus.find(
      (item) => item.dataset.gameMenu === button.dataset.gameMenu,
    );
    if (menu.hidden) openGameMenu(button.dataset.gameMenu);
    else closeGameMenus();
  });
  menuBar.addEventListener("keydown", (event) => {
    const button = event.target.closest(".game-menu-button");
    if (!button) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const index = menuButtons.indexOf(button);
      menuButtons[
        (index + direction + menuButtons.length) % menuButtons.length
      ].focus();
    } else if (
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      openGameMenu(button.dataset.gameMenu, true);
    } else if (event.key === "Escape") {
      closeGameMenus();
      button.focus();
    }
  });
  win.el.addEventListener("keydown", (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const button = menuButtons.find(
      (item) => item.dataset.accessKey === event.key.toLowerCase(),
    );
    if (!button) return;
    event.preventDefault();
    button.focus();
    openGameMenu(button.dataset.gameMenu, true);
  });
  menus.forEach((menu) => {
    menu.addEventListener("keydown", (event) => {
      const items = [
        ...menu.querySelectorAll("button:not(:disabled), input:not(:disabled)"),
      ];
      const index = items.indexOf(document.activeElement);
      // Letters are handled by the shell's menu typeahead.
      if (event.key === "Escape") {
        event.preventDefault();
        const button = menuButtons.find(
          (item) => item.dataset.gameMenu === menu.dataset.gameMenu,
        );
        // The keys move first, so the program never gets them for a moment.
        button?.focus();
        closeGameMenus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        items[
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        switchGameMenu(
          menu.dataset.gameMenu,
          event.key === "ArrowRight" ? 1 : -1,
        );
      }
    });
    menu.addEventListener("click", (event) => {
      const item = event.target.closest("[data-game-action]");
      if (!item || item.disabled) return;
      if (item.dataset.gameAction === "volume-popup") {
        win.volumeSlider.focus();
        closeGameMenus();
        return;
      }
      switch (item.dataset.gameAction) {
        case "close":
          closeGameWindow(gameId);
          break;
        case "project":
          openProjectSettings();
          break;
        case "favorite":
          toggleFavorite(gameId);
          break;
        case "mute":
          toggleWindowMute(win);
          break;
        case "fullscreen":
          if (win.player) toggleFullscreen(win.player);
          break;
        case "properties":
          openGameProperties(win);
          break;
      }
      closeGameMenus();
    });
  });
  syncWindowVolumeUI(win);
  updateFavoriteUI(win);
  updateMaximizeButton(win);
  wireDrag(win);
  wireResize(win);
};
