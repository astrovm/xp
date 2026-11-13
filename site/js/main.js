"use strict";

// Constants
const DEFAULT_ASPECT_RATIO = 4 / 3;
const WINDOW_CHROME_HEIGHT = 53; // title bar + command bar
const MIN_WINDOW_WIDTH = 340;
const MIN_WINDOW_HEIGHT = 240;
const RESIZE_DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const MOVE_SIZE_STEP = 8;
// Show the palette fade and one complete progress pass unless the user skips.
const BOOT_MINIMUM_DURATION_MS = 2000 + 1800;
const WELCOME_DURATION_MS = 1200;
// After the first complete startup, later visits play a short version unless
// the user asks for the full sequence in Astro XP Settings.
const QUICK_BOOT_MINIMUM_DURATION_MS = 900;
const QUICK_WELCOME_DURATION_MS = 400;
const STARTUP_SEEN_KEY = "startupSeen";
const FULL_STARTUP_KEY = "fullStartup";
const readStartupFlag = (key) => {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
};
const useQuickStartup = () =>
  readStartupFlag(STARTUP_SEEN_KEY) && !readStartupFlag(FULL_STARTUP_KEY);
const setStartupFlag = (key, value) => {
  try {
    if (value) localStorage.setItem(key, "true");
    else localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable; startup simply stays at full length.
  }
};
// The startup sound has its own switch and level in Astro XP Settings, on top
// of Volume Control. It starts at half volume so a first visit is not loud.
const STARTUP_SOUND_KEY = "startupSound";
const DEFAULT_STARTUP_SOUND_VOLUME = 50;
const getStartupSound = () => {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STARTUP_SOUND_KEY));
  } catch {
    // Unreadable or corrupted storage falls back to the defaults.
  }
  const volume = Number(stored?.volume);
  return {
    enabled: stored?.enabled !== false,
    volume: Number.isFinite(volume)
      ? Math.min(Math.max(Math.round(volume), 0), 100)
      : DEFAULT_STARTUP_SOUND_VOLUME,
  };
};
const setStartupSound = (changes) => {
  try {
    localStorage.setItem(
      STARTUP_SOUND_KEY,
      JSON.stringify({ ...getStartupSound(), ...changes }),
    );
  } catch {
    // Storage can be unavailable; the change lasts until the page reloads.
  }
};
const APP_VERSION = "26.07.28-2";
const offlineManager = window.AstroOffline.createManager({
  currentVersion: APP_VERSION,
  gameManifestUrl: window.ASTRO_OFFLINE_MANIFEST_URL || "offline-games.json",
});
const gameDataManager = window.AstroGameData.createManager();

let bootTimeout = null;
let shutdownTimeout = null;
let loggedIn = false;
let sessionGeneration = 0;
let shellInitialized = false;
let suspended = false;
let iconsBuilt = false;
let renderedPlacesStyle = null;
let screenSaverTimeout = null;
let screenSaverPreviewCleanup = null;

const PIPES_SCREEN_SAVER_URL =
  "vendor/pipes/86e8eb1418f937ef43f9acbd871085c5160714fc/index.html";

// No prototype, so ids such as "constructor" from a URL are not games.
const gamesList = Object.assign(Object.create(null), window.FLASH_GAMES);
const installedGameIds = new Set();
let gameLibrary = null;
let gameLibraryError = null;
let gameLibraryReady = false;
let gameLibraryInitialization = Promise.resolve();
let offlineManagerInitialization = Promise.resolve();
let automaticOfflineDownloadQueue = Promise.resolve();

const DISPLAY_SETTINGS_KEY = "displaySettings";
const START_MENU_STYLE_KEY = "startMenuStyle";
const WINDOW_PLACEMENTS_KEY = "windowPlacements";
const DESKTOP_SYSTEM_ICONS_KEY = "desktopSystemIcons";
const DESKTOP_SYSTEM_NAMES_KEY = "desktopSystemNames";
const GAME_PLAYBACK_SETTINGS_KEY = "gamePlaybackSettings";
const USER_STORAGE_KEYS = Object.freeze([
  DISPLAY_SETTINGS_KEY,
  START_MENU_STYLE_KEY,
  "clockOffsetMs",
  "taskbarShowClock",
  "taskbarSettings",
  "desktopIconPositions",
  "desktopLayoutSettings",
  DESKTOP_SYSTEM_ICONS_KEY,
  DESKTOP_SYSTEM_NAMES_KEY,
  "favorites",
  "gameStats",
  GAME_PLAYBACK_SETTINGS_KEY,
  WINDOW_PLACEMENTS_KEY,
  "gameVolumes",
  "isMuted",
  "minesweeperSettings",
  "runHistory",
  "volume",
]);
const DISPLAY_WALLPAPERS = {
  none: "none",
  bliss: 'url("/assets/xp/bliss.jpg")',
  ascent: 'url("/assets/xp/wallpapers/ascent.jpg")',
  autumn: 'url("/assets/xp/wallpapers/autumn.jpg")',
  azul: 'url("/assets/xp/wallpapers/azul.jpg")',
  "blue-lace": 'url("/assets/xp/wallpapers/blue-lace-16.bmp")',
  coffee: 'url("/assets/xp/wallpapers/coffee-bean.bmp")',
  crystal: 'url("/assets/xp/wallpapers/crystal.jpg")',
  follow: 'url("/assets/xp/wallpapers/follow.jpg")',
  friend: 'url("/assets/xp/wallpapers/friend.jpg")',
  greenstone: 'url("/assets/xp/wallpapers/greenstone.bmp")',
  home: 'url("/assets/xp/wallpapers/home.jpg")',
  "moon-flower": 'url("/assets/xp/wallpapers/moon-flower.jpg")',
  peace: 'url("/assets/xp/wallpapers/peace.jpg")',
  power: 'url("/assets/xp/wallpapers/power.jpg")',
  "prairie-wind": 'url("/assets/xp/wallpapers/prairie-wind.bmp")',
  "purple-flower": 'url("/assets/xp/wallpapers/purple-flower.jpg")',
  radiance: 'url("/assets/xp/wallpapers/radiance.jpg")',
  "red-moon-desert": 'url("/assets/xp/wallpapers/red-moon-desert.jpg")',
  ripple: 'url("/assets/xp/wallpapers/ripple.jpg")',
  stonehenge: 'url("/assets/xp/wallpapers/stonehenge.jpg")',
  tulips: 'url("/assets/xp/wallpapers/tulips.jpg")',
  "vortec-space": 'url("/assets/xp/wallpapers/vortec-space.jpg")',
  wind: 'url("/assets/xp/wallpapers/wind.jpg")',
  "windows-xp": 'url("/assets/xp/wallpapers/windows-xp.jpg")',
  zapotec: 'url("/assets/xp/wallpapers/zapotec.bmp")',
};
const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
  theme: "windows-xp",
  wallpaper: "bliss",
  customWallpaper: "",
  customWallpaperName: "",
  position: "stretch",
  backgroundColor: "#004e98",
  appearance: "blue",
  fontSize: "normal",
  screenSaver: "pipes",
  screenSaverWait: 10,
  requireLoginOnResume: false,
  transitionEffect: "fade",
  fontSmoothing: "standard",
  largeIcons: false,
  menuShadows: true,
  showWindowContents: true,
  hideKeyboardCues: true,
  resolution: "auto",
});
const SUPPORTED_SCREEN_SAVERS = Object.freeze([
  "none",
  "pipes",
  "blank",
  "marquee",
  "stars",
  "windows-xp",
]);
const SIMULATED_RESOLUTIONS = Object.freeze({
  "800x600": { width: 800, height: 600 },
  "1024x768": { width: 1024, height: 768 },
  "1440x900": { width: 1440, height: 900 },
});
const XP_ICON_PATHS = Object.freeze({
  "GenericFile.png": "assets/xp/icons/GenericFile.png",
  "TextDocument.png": "assets/xp/icons/TextDocument.png",
  "AccessibilityOptions.png": "assets/xp/icons/AccessibilityOptions.png",
  "AccessibilitySound.png": "assets/xp/icons/AccessibilitySound.png",
  "AddressBook.png": "assets/xp/icons/AddressBook.png",
  "AddRemovePrograms.png": "assets/xp/icons/AddRemovePrograms.png",
  "AppearanceAndThemes.png": "assets/xp/icons/AppearanceAndThemes.png",
  "Back.png": "assets/xp/icons/Back.png",
  "Calculator.png": "assets/xp/icons/Calculator.png",
  "CommandPrompt.png": "assets/xp/icons/CommandPrompt.png",
  "ControlPanel.png": "assets/xp/icons/ControlPanel.png",
  "DateTimeRegional.png": "assets/xp/icons/DateTimeRegional.png",
  "Exit.png": "assets/xp/icons/Exit.png",
  "FolderViewClassic.png": "assets/xp/icons/FolderViewClassic.png",
  "FolderView.png": "assets/xp/icons/FolderView.png",
  "Forward.png": "assets/xp/icons/Forward.png",
  "Fonts.png": "assets/xp/icons/Fonts.png",
  "Go.png": "assets/xp/icons/Go.png",
  "HelpAndSupport.png": "assets/xp/icons/HelpAndSupport.png",
  "InternetOptions.png": "assets/xp/icons/InternetOptions.png",
  "InternetExplorer.png": "assets/xp/icons/InternetExplorer.png",
  "InternetBackgammon.png": "assets/xp/icons/InternetBackgammon.png",
  "InternetCheckers.png": "assets/xp/icons/InternetCheckers.png",
  "InternetHearts.png": "assets/xp/icons/InternetHearts.png",
  "InternetReversi.png": "assets/xp/icons/InternetReversi.png",
  "InternetSpades.png": "assets/xp/icons/InternetSpades.png",
  "LocalDisk.png": "assets/xp/icons/LocalDisk.png",
  "OpticalDrive.png": "assets/xp/icons/OpticalDrive.png",
  "Logout.png": "assets/xp/icons/Logout.png",
  "Maximize.png": "assets/xp/icons/Maximize.png",
  "Minimize.png": "assets/xp/icons/Minimize.png",
  "Mute.png": "assets/xp/icons/Mute.png",
  "MyMusic.png": "assets/xp/icons/MyMusic.png",
  "MyNetworkPlaces.png": "assets/xp/icons/MyNetworkPlaces.png",
  "MyPictures.png": "assets/xp/icons/MyPictures.png",
  "NetworkAndInternet.png": "assets/xp/icons/NetworkAndInternet.png",
  "NetworkConnection.png": "assets/xp/icons/NetworkConnection.png",
  "NetworkConnections.png": "assets/xp/icons/NetworkConnections.png",
  "NetworkSetupWizard.png": "assets/xp/icons/NetworkSetupWizard.png",
  "NewFolder.png": "assets/xp/icons/NewFolder.png",
  "Power.png": "assets/xp/icons/Power.png",
  "PerformanceAndMaintenance.png":
    "assets/xp/icons/PerformanceAndMaintenance.png",
  "Paint.png": "assets/xp/icons/Paint.png",
  "PrintersAndHardware.png": "assets/xp/icons/PrintersAndHardware.png",
  "PrintersAndFaxes.png": "assets/xp/icons/PrintersAndFaxes.png",
  "Programs.png": "assets/xp/icons/Programs.png",
  "ProgramAccessDefaultsSmall.png":
    "assets/xp/icons/ProgramAccessDefaultsSmall.png",
  "ProgramAccessDefaultsMenu.png":
    "assets/xp/icons/ProgramAccessDefaultsMenu.png",
  "ProgramCompatibilityWizard.png":
    "assets/xp/icons/ProgramCompatibilityWizard.png",
  "ProgramFolder.png": "assets/xp/icons/ProgramFolder.png",
  "PublishToWeb.png": "assets/xp/icons/PublishToWeb.png",
  "RecentDocuments.png": "assets/xp/icons/RecentDocuments.png",
  "RemoteDesktopConnection.png": "assets/xp/icons/RemoteDesktopConnection.png",
  "RemoteDesktop.png": "assets/xp/icons/RemoteDesktop.png",
  "RemoteAssistance.png": "assets/xp/icons/RemoteAssistance.png",
  "RemovableMedia.png": "assets/xp/icons/RemovableMedia.png",
  "Restore.png": "assets/xp/icons/Restore.png",
  "Run.png": "assets/xp/icons/Run.png",
  "Search.png": "assets/xp/icons/Search.png",
  "WindowsFirewall.png": "assets/xp/icons/WindowsFirewall.png",
  "WirelessNetworkSetupWizard.png":
    "assets/xp/icons/WirelessNetworkSetupWizard.png",
  "SecurityCenter.png": "assets/xp/icons/SecurityCenter.png",
  "SharedFolder.png": "assets/xp/icons/SharedFolder.png",
  "Up.png": "assets/xp/icons/Up.png",
  "SoundsSpeechAudio.png": "assets/xp/icons/SoundsSpeechAudio.png",
  "SoundsAudioSmall.png": "assets/xp/icons/SoundsAudioSmall.png",
  "Synchronize.png": "assets/xp/icons/Synchronize.png",
  "System.png": "assets/xp/icons/System.png",
  "TaskManager.png": "assets/xp/icons/TaskManager.png",
  "TourWindowsXP.png": "assets/xp/icons/TourWindowsXP.png",
  "UserAccounts.png": "assets/xp/icons/UserAccounts.png",
  "Volume.png": "assets/xp/icons/Volume.png",
  "VolumeControl.png": "assets/xp/icons/VolumeControl.png",
  "WindowsCatalog.png": "assets/xp/icons/WindowsCatalog.png",
  "WindowsCatalogMenu.png": "assets/xp/icons/WindowsCatalogMenu.png",
  "WindowsExplorer.png": "assets/xp/icons/WindowsExplorer.png",
  "WindowsUpdate.png": "assets/xp/icons/WindowsUpdate.png",
  "WindowsUpdateMenu.png": "assets/xp/icons/WindowsUpdateMenu.png",
  "WindowsMediaPlayer.png": "assets/xp/icons/WindowsMediaPlayer.png",
  "WindowsMessenger.png": "assets/xp/icons/WindowsMessenger.png",
  "WindowsMessengerLarge.png": "assets/xp/icons/WindowsMessengerLarge.png",
  "WindowsMovieMaker.png": "assets/xp/icons/WindowsMovieMaker.png",
  "Display.png": "assets/xp/icons/Display.png",
  "Delete.png": "assets/xp/icons/Delete.png",
  "Rename.png": "assets/xp/icons/Rename.png",
  "Magnifier.png": "assets/xp/icons/Magnifier.png",
  "Minesweeper.png": "assets/xp/icons/Minesweeper.png",
  "MSN.png": "assets/xp/icons/MSN.png",
  "Notepad.png": "assets/xp/icons/Notepad.png",
  "OnScreenKeyboard.png": "assets/xp/icons/OnScreenKeyboard.png",
  "OutlookExpress.png": "assets/xp/icons/OutlookExpress.png",
  "FreeCell.png": "assets/xp/icons/FreeCell.png",
  "Hearts.png": "assets/xp/icons/Hearts.png",
  "Pinball.png": "assets/xp/icons/Pinball.png",
  "ScheduledTasks.png": "assets/xp/icons/ScheduledTasks.png",
  "Solitaire.png": "assets/xp/icons/Solitaire.png",
  "SpiderSolitaire.png": "assets/xp/icons/SpiderSolitaire.png",
  "TaskbarAndStartMenu.png": "assets/xp/icons/TaskbarAndStartMenu.png",
  "ExplorerProperties.png": "assets/xp/icons/ExplorerProperties.png",
  "MyComputer.png": "assets/xp/icons/MyComputer.png",
  "MyDocuments.png": "assets/xp/icons/MyDocuments.png",
  "RecyclerEmpty.png": "assets/xp/icons/RecyclerEmpty.png",
  "RecyclerFull.png": "assets/xp/icons/RecyclerFull.png",
  "Shortcut.png": "assets/xp/icons/Shortcut.png",
});
let activeMonitorResolution = "auto";

const categoryIcons = {
  Racing: "🏁",
  Action: "💥",
  Adventure: "🗺️",
  Puzzle: "🧩",
  Arcade: "👾",
  Misc: "⭐",
  Favorites: "★",
  "Recently Played": "🕒",
  Other: "🎮",
};

const systemShortcuts = {
  "__my-documents": {
    title: "My Documents",
    icon: "assets/xp/icons/MyDocuments.png",
  },
  "__my-computer": {
    title: "My Computer",
    icon: "assets/xp/icons/MyComputer.png",
  },
  "__my-pictures": {
    title: "My Pictures",
    icon: "assets/xp/icons/MyPictures.png",
    desktop: false,
  },
  "__my-music": {
    title: "My Music",
    icon: "assets/xp/icons/MyMusic.png",
    desktop: false,
  },
  "__recycle-bin": {
    title: "Recycle Bin",
    icon: "assets/xp/icons/RecyclerEmpty.png",
  },
  "__display-properties": {
    title: "Display Properties",
    icon: "assets/xp/icons/MyComputer.png",
    desktop: false,
  },
  "__control-panel": {
    title: "Control Panel",
    icon: "assets/xp/icons/ControlPanel.png",
    desktop: false,
  },
  __notepad: {
    title: "Notepad",
    icon: "assets/xp/icons/Notepad.png",
    desktop: false,
  },
  __search: {
    title: "Search Results",
    icon: "assets/xp/icons/Search.png",
    desktop: false,
  },
  "__astro-settings": {
    title: "Astro XP Settings",
    icon: "assets/xp/icons/ControlPanel.png",
  },
  "__internet-games": {
    title: "Internet Games",
    icon: "assets/xp/icons/AddRemovePrograms.png",
  },
};

window.AstroShellApplications = Object.freeze({
  install(registry) {
    window.XPApplicationRegistry = registry;
    registry.entries().forEach(([id, application]) => {
      const existing = systemShortcuts[id];
      systemShortcuts[id] = {
        title: application.title,
        icon: XP_ICON_PATHS[application.icon],
        ...(existing && Object.hasOwn(existing, "desktop")
          ? { desktop: existing.desktop }
          : {}),
      };
    });
    window.AstroApplicationHost.installFileAssociations(registry);
  },
});

// ============================================
// Helper Functions
// ============================================

const formatGameTitle = (gameId) =>
  systemShortcuts[gameId]?.title ||
  gamesList[gameId]?.title ||
  gameId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const getGameIcon = (gameId) =>
  categoryIcons[gamesList[gameId]?.category] || categoryIcons["Other"];

const getRecycleBinIconPath = () =>
  window.VirtualFS?.getChildren(window.VirtualFS.RECYCLE_BIN).length
    ? XP_ICON_PATHS["RecyclerFull.png"]
    : XP_ICON_PATHS["RecyclerEmpty.png"];

const createGameIconElement = (gameId, className) => {
  const icon = document.createElement("span");
  icon.className = className;

  const imagePath =
    gameId === "__recycle-bin"
      ? getRecycleBinIconPath()
      : systemShortcuts[gameId]?.icon || gamesList[gameId]?.icon;
  if (imagePath) {
    const image = document.createElement("img");
    image.className = "game-icon-image";
    image.src = imagePath;
    image.alt = "";
    // A native image drag would cancel the pointer stream used by the
    // desktop icon drag, so the browser must not start one.
    image.draggable = false;
    icon.classList.add("has-image");
    if (systemShortcuts[gameId]) {
      icon.classList.add("system-icon");
    }
    icon.appendChild(image);
  } else {
    icon.textContent = getGameIcon(gameId);
  }

  return icon;
};

const getHashGameId = () => {
  const id = window.location.hash.slice(1);
  if (id && gamesList[id]) return id;
  const application = window.XPApplicationRegistry?.values().find(
    (candidate) =>
      candidate.kind === "native-game" && candidate.deepLinkId === id,
  );
  return application?.id || null;
};

const openLinkedGame = (gameId) => {
  const application = window.XPApplicationRegistry?.get(gameId);
  if (application?.kind === "native-game") {
    openXPProgram(gameId);
  } else {
    openGameWindow(gameId);
  }
};

const readJsonStorage = (key, fallbackValue, validator) => {
  const rawValue = localStorage.getItem(key);
  if (!rawValue) {
    return fallbackValue;
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    if (typeof validator === "function" && !validator(parsedValue)) {
      return fallbackValue;
    }
    return parsedValue;
  } catch (error) {
    console.error(`Error parsing ${key} from localStorage:`, error);
    return fallbackValue;
  }
};

const writeJsonStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error storing ${key} in localStorage:`, error);
  }
};

const isDisplaySettings = (value) =>
  value &&
  typeof value === "object" &&
  ["windows-xp", "classic", "olive"].includes(value.theme) &&
  Object.hasOwn(DISPLAY_WALLPAPERS, value.wallpaper) &&
  typeof value.customWallpaper === "string" &&
  (value.customWallpaper === "" ||
    /^data:image\/(bmp|png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(
      value.customWallpaper,
    )) &&
  typeof value.customWallpaperName === "string" &&
  ["center", "tile", "stretch"].includes(value.position) &&
  /^#[0-9a-f]{6}$/i.test(value.backgroundColor) &&
  ["blue", "olive", "silver", "classic"].includes(value.appearance) &&
  (value.fontSize === undefined ||
    ["normal", "large", "extra-large"].includes(value.fontSize)) &&
  SUPPORTED_SCREEN_SAVERS.includes(value.screenSaver) &&
  Number.isInteger(value.screenSaverWait) &&
  value.screenSaverWait >= 1 &&
  value.screenSaverWait <= 60 &&
  (value.requireLoginOnResume === undefined ||
    typeof value.requireLoginOnResume === "boolean") &&
  (value.transitionEffect === undefined ||
    ["none", "fade", "scroll"].includes(value.transitionEffect)) &&
  (value.fontSmoothing === undefined ||
    ["none", "standard", "cleartype"].includes(value.fontSmoothing)) &&
  (value.largeIcons === undefined || typeof value.largeIcons === "boolean") &&
  (value.menuShadows === undefined || typeof value.menuShadows === "boolean") &&
  (value.showWindowContents === undefined ||
    typeof value.showWindowContents === "boolean") &&
  (value.hideKeyboardCues === undefined ||
    typeof value.hideKeyboardCues === "boolean") &&
  ["auto", "800x600", "1024x768", "1440x900"].includes(value.resolution);

const getDisplaySettings = () => {
  const stored = readJsonStorage(
    DISPLAY_SETTINGS_KEY,
    {},
    (value) => value && typeof value === "object" && !Array.isArray(value),
  );
  const settings = {
    ...DEFAULT_DISPLAY_SETTINGS,
    ...stored,
    screenSaver: SUPPORTED_SCREEN_SAVERS.includes(stored.screenSaver)
      ? stored.screenSaver
      : DEFAULT_DISPLAY_SETTINGS.screenSaver,
  };
  return isDisplaySettings(settings)
    ? settings
    : { ...DEFAULT_DISPLAY_SETTINGS };
};

const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const DEFAULT_DESKTOP_SYSTEM_ICONS = Object.freeze({
  "__my-computer": true,
  "__my-documents": true,
});

const getDesktopSystemIcons = () => ({
  ...DEFAULT_DESKTOP_SYSTEM_ICONS,
  ...readJsonStorage(
    DESKTOP_SYSTEM_ICONS_KEY,
    {},
    (value) =>
      isPlainObject(value) &&
      Object.values(value).every((visible) => typeof visible === "boolean"),
  ),
});

const saveDesktopSystemIcons = (settings) =>
  writeJsonStorage(DESKTOP_SYSTEM_ICONS_KEY, settings);

const getDesktopSystemNames = () =>
  readJsonStorage(
    DESKTOP_SYSTEM_NAMES_KEY,
    {},
    (value) =>
      isPlainObject(value) &&
      Object.values(value).every(
        (name) => typeof name === "string" && name.trim().length > 0,
      ),
  );

const saveDesktopSystemNames = (settings) =>
  writeJsonStorage(DESKTOP_SYSTEM_NAMES_KEY, settings);

const saveDisplaySettings = (settings) => {
  try {
    localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error("Error storing display settings:", error);
    return false;
  }
};

const displayBackground = (settings) =>
  settings.customWallpaper
    ? `url("${settings.customWallpaper}")`
    : DISPLAY_WALLPAPERS[settings.wallpaper];

// Mobile Chrome reports innerWidth and innerHeight in zoomed units once
// display-scale zooms the root, so layout sized from them overshoots the
// screen and the taskbar lands under the browser's toolbar. The visual
// viewport is not affected. Pinch zoom shrinks it, so a pinched page keeps
// using the window size.
const getViewportSize = () => {
  const viewport = window.visualViewport;
  const useVisual =
    viewport &&
    viewport.scale <= 1.001 &&
    document.documentElement.style.zoom !== "" &&
    window.matchMedia?.("(pointer: coarse)").matches;
  return useVisual
    ? { width: viewport.width, height: viewport.height }
    : { width: window.innerWidth, height: window.innerHeight };
};
const getViewportWidth = () => getViewportSize().width;
const getViewportHeight = () => getViewportSize().height;

const getSimulatedMonitorSize = (resolution = activeMonitorResolution) => {
  const requested = SIMULATED_RESOLUTIONS[resolution];
  const viewport = getViewportSize();
  if (!requested) return { ...viewport, limited: false };
  return {
    width: Math.min(requested.width, viewport.width),
    height: Math.min(requested.height, viewport.height),
    limited:
      requested.width > viewport.width || requested.height > viewport.height,
  };
};

const getTaskbarHeight = () =>
  document.documentElement.dataset.xpAppearance === "classic" ? 28 : 30;

// The selected XP resolution becomes a real, bounded monitor inside the
// browser. On a smaller browser it is honestly limited to the available
// viewport instead of pretending that off-screen space is usable.
const applySimulatedMonitor = (resolution, { reflow = true } = {}) => {
  activeMonitorResolution = resolution;
  const desktop = document.getElementById("desktop");
  const monitor = getSimulatedMonitorSize(resolution);
  const viewport = getViewportSize();
  const left = Math.max(0, Math.round((viewport.width - monitor.width) / 2));
  const top = Math.max(0, Math.round((viewport.height - monitor.height) / 2));
  layoutTaskbar(monitor, left, top);
  desktop.dataset.monitorResolution = resolution;
  if (resolution === "auto") delete desktop.dataset.monitorLimited;
  else desktop.dataset.monitorLimited = String(monitor.limited);
  if (reflow && iconsBuilt) layoutDesktopIcons();
  if (reflow && loggedIn) {
    keepWindowsInWorkArea();
    renderTaskButtons();
  }
};

const applyDisplaySettings = (settings) => {
  const desktop = document.getElementById("desktop");
  desktop.style.setProperty(
    "--desktop-background",
    displayBackground(settings),
  );
  desktop.style.setProperty("--desktop-color", settings.backgroundColor);
  desktop.dataset.wallpaperPosition = settings.position;
  document.documentElement.dataset.xpAppearance = settings.appearance;
  document.documentElement.dataset.xpFontSize = settings.fontSize;
  document.documentElement.dataset.xpLargeIcons = String(settings.largeIcons);
  document.documentElement.dataset.xpMenuShadows = String(settings.menuShadows);
  document.documentElement.dataset.xpMenuTransition = settings.transitionEffect;
  document.documentElement.dataset.xpKeyboardCues = String(
    settings.hideKeyboardCues,
  );
  applySimulatedMonitor(settings.resolution);
  scheduleScreenSaver(settings);
};

const renderScreenSaver = (container, saver, active) => {
  container.dataset.saver = saver;
  const current = container.querySelector(".pipes-screen-saver");
  if (saver !== "pipes" || !active) {
    current?.remove();
    return;
  }
  if (current) return;
  const frame = document.createElement("iframe");
  frame.className = "pipes-screen-saver";
  frame.src = PIPES_SCREEN_SAVER_URL;
  frame.title = "3D Pipes";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  container.appendChild(frame);
};

const hideScreenSaver = (saver) => {
  screenSaverPreviewCleanup?.();
  screenSaverPreviewCleanup = null;
  saver.hidden = true;
  renderScreenSaver(saver, saver.dataset.saver || "none", false);
};

const showScreenSaver = (saver, type) => {
  saver.dataset.saver = type;
  saver.hidden = false;
  renderScreenSaver(saver, type, true);
};

const scheduleScreenSaver = (settings = getDisplaySettings()) => {
  clearTimeout(screenSaverTimeout);
  const desktop = document.getElementById("desktop");
  const saver = document.getElementById("screen-saver-overlay");
  if (!desktop || !saver) return;
  hideScreenSaver(saver);
  saver.dataset.saver = settings.screenSaver;
  if (settings.screenSaver === "none" || !loggedIn) return;
  screenSaverTimeout = setTimeout(
    () => {
      showScreenSaver(saver, settings.screenSaver);
    },
    settings.screenSaverWait * 60 * 1000,
  );
};

const setupScreenSaver = () => {
  const overlay = document.createElement("div");
  overlay.id = "screen-saver-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-label", "Screen saver");
  // Appended to <body>, not #desktop: #desktop has overflow:hidden (it
  // clips desktop icons/windows to its own bounds, which stop 30px short of
  // the bottom for the taskbar), and that clip applies to this overlay too
  // if it's a descendant - fixed positioning and z-index only control where
  // an element is placed and stacked, not whether an ancestor's overflow
  // clips it out of view.
  document.body.appendChild(overlay);
  // Rescheduling reads display settings from storage and pointer moves arrive
  // every frame, so while the saver is hidden restart the idle timer at most
  // once a second. Any input still dismisses a visible saver immediately.
  let lastWake = -Infinity;
  const wake = () => {
    const now = performance.now();
    if (overlay.hidden && now - lastWake < 1000) return;
    lastWake = now;
    scheduleScreenSaver();
  };
  ["pointerdown", "keydown", "mousemove", "touchstart"].forEach((eventName) => {
    document.addEventListener(eventName, wake, { passive: true });
  });
};

const getFavorites = () => readJsonStorage("favorites", [], Array.isArray);

const setFavorites = (favorites) => writeJsonStorage("favorites", favorites);

const getGameStats = () =>
  readJsonStorage(
    "gameStats",
    {},
    (stats) => stats && typeof stats === "object",
  );

const getGameVolume = (gameId) => {
  const gameVolumes = readJsonStorage(
    "gameVolumes",
    {},
    (volumes) => volumes && typeof volumes === "object",
  );

  if (gameId in gameVolumes) {
    return {
      volume: parseInt(gameVolumes[gameId].volume, 10),
      isMuted: gameVolumes[gameId].isMuted,
    };
  }
  // Game volume is independent of the system tray volume, so an
  // unconfigured game defaults to full volume rather than inheriting
  // whatever the system sound level happens to be set to.
  return { volume: 100, isMuted: false };
};

const setGameVolume = (gameId, volume, isMuted) => {
  const gameVolumes = readJsonStorage(
    "gameVolumes",
    {},
    (volumes) => volumes && typeof volumes === "object",
  );
  gameVolumes[gameId] = {
    volume: volume,
    isMuted: isMuted,
  };
  writeJsonStorage("gameVolumes", gameVolumes);
};

const normalizeFrameRate = (value) => {
  const frameRate = Number(value);
  return Number.isFinite(frameRate) && frameRate >= 1 && frameRate <= 240
    ? frameRate
    : null;
};

const getGameFrameRateSetting = (gameId) => {
  const settings = readJsonStorage(
    GAME_PLAYBACK_SETTINGS_KEY,
    {},
    (value) => value && typeof value === "object" && !Array.isArray(value),
  );
  const frameRate = settings[gameId]?.frameRate;
  if (frameRate === "native") return "native";
  return normalizeFrameRate(frameRate) ?? "default";
};

const setGameFrameRate = (gameId, frameRate) => {
  const settings = readJsonStorage(
    GAME_PLAYBACK_SETTINGS_KEY,
    {},
    (value) => value && typeof value === "object" && !Array.isArray(value),
  );
  if (frameRate === "default") {
    delete settings[gameId];
  } else if (frameRate === "native") {
    settings[gameId] = { frameRate: "native" };
  } else {
    settings[gameId] = { frameRate: normalizeFrameRate(frameRate) };
  }
  writeJsonStorage(GAME_PLAYBACK_SETTINGS_KEY, settings);
};

const resolveGameFrameRate = (gameId) => {
  const setting = getGameFrameRateSetting(gameId);
  if (setting === "native") return null;
  if (setting === "default")
    return normalizeFrameRate(gamesList[gameId]?.frameRate);
  return setting;
};

const normalizeGameVolume = (gameId) => {
  const { volume, isMuted } = getGameVolume(gameId);
  const numericVolume = parseInt(volume, 10);
  const clampedVolume = Number.isFinite(numericVolume)
    ? Math.min(Math.max(numericVolume, 0), 100)
    : 100;

  // Volume Control's Master and Wave faders scale every audio source on
  // top of that source's own level, like a hardware mixer, so they still
  // attenuate games in addition to each game's own volume.
  if (isMuted) return 0;
  return (clampedVolume / 100) * getAudioLevel();
};

const setPlayerVolume = (player, type, normalizedVolume) => {
  if (!player) {
    return;
  }

  if (type === "iframe") {
    player.contentWindow?.postMessage(
      {
        type: "setVolume",
        volume: normalizedVolume,
      },
      window.location.origin,
    );
  } else {
    try {
      player.volume = normalizedVolume;
    } catch (error) {
      console.error("Error setting SWF volume:", error);
    }
  }
};

const toggleFullscreen = (element) => {
  if (!document.fullscreenElement) {
    element.requestFullscreen().catch((err) => {
      console.error(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
};

// XP hides access-key underlines until the keyboard is used to navigate, and
// hides them again after mouse input.
const KEYBOARD_CUE_KEYS = new Set([
  "Alt",
  "Tab",
  "F10",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);
document.addEventListener(
  "keydown",
  (event) => {
    if (KEYBOARD_CUE_KEYS.has(event.key))
      document.documentElement.classList.add("keyboard-cues");
  },
  true,
);
document.addEventListener(
  "pointerdown",
  () => document.documentElement.classList.remove("keyboard-cues"),
  true,
);

const setAccessKeyText = (element, label) => {
  const { text, key } = XPDialogs.parseAccessKey(label);
  const marker = label.indexOf("&");
  element.replaceChildren();
  if (!key || marker < 0) {
    element.textContent = text;
    return { text, key };
  }
  element.append(label.slice(0, marker));
  const underlined = document.createElement("span");
  underlined.className = "menu-accesskey";
  underlined.textContent = label[marker + 1];
  element.append(underlined, label.slice(marker + 2));
  return { text, key };
};
