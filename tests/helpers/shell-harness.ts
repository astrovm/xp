// @ts-nocheck -- Happy DOM's element types intentionally replace lib.dom here.
import { Window } from "happy-dom";
import { fileURLToPath } from "node:url";
import { coverageBuildPlugins, instrumentSource } from "./coverage";

const projectDirectory = new URL("../..", import.meta.url);
const scripts = [
  "site/js/games.js",
  "site/js/flash-url-router.js",
  "site/js/storage-policy.js",
  "site/js/game-installer.js",
  "site/js/game-library.js",
  "site/js/game-data.js",
  "site/js/filesystem.js",
  "site/js/file-operations.js",
  "site/js/dialogs.js",
  "site/js/shell-cache.js",
  "site/js/offline.js",
];

const shellScripts = [
  "site/js/main.js",
  "site/js/shell/display-scale.js",
  "site/js/shell/window-manager.js",
  "site/js/apps/display-properties.js",
  "site/js/apps/explorer.js",
  "site/js/apps/programs.js",
  "site/js/shell/taskbar-toolbars.js",
  "site/js/shell/taskbar-layout.js",
  "site/js/shell/taskbar.js",
  "site/js/shell/system-tray.js",
  "site/js/shell/desktop.js",
  "site/js/shell/start-menu.js",
  "site/js/shell/session.js",
  "site/js/shell/bootstrap.js",
];

const activeWindows = new Set<Window>();

const readScript = async (path: string) => {
  const url = new URL(path, projectDirectory);
  return instrumentSource(await Bun.file(url).text(), fileURLToPath(url));
};

export const flushShell = () =>
  new Promise((resolve) => setTimeout(resolve, 0));

export async function loadShell({
  gameLibraryManager,
  initialStorage = {},
  offlineSettings = {},
  offlineMethods = {},
  gameDataManager,
  fetchObject,
  preloadApplications = true,
  // Without memory-only documents and without IndexedDB, VirtualFS starts
  // read-only, as it does when browser site storage is blocked.
  documentStorage = "memory",
  // Windows change at once in tests, as with a reduced-motion preference; the
  // animation tests turn the caption animations on.
  windowAnimations = false,
  // Runs before any shell script so tests can provide optional browser APIs.
  beforeScripts = (_window) => {},
  url = "http://127.0.0.1/",
} = {}) {
  const window = new Window({
    url,
    width: 1024,
    height: 768,
    settings: {
      enableIframePageLoading: true,
      disableJavaScriptFileLoading: true,
      enableJavaScriptEvaluation: false,
      handleDisabledFileLoadingAsSuccess: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
  Object.defineProperty(window.navigator, "locks", {
    value: {
      request: (_name, _options, callback) =>
        Promise.resolve(callback({ name: "astro-xp-files" })),
    },
  });
  if (documentStorage === "memory") window.ASTRO_FS_MEMORY_ONLY = true;
  else delete window.indexedDB;
  if (fetchObject) window.fetch = fetchObject;
  // Instrumented scripts evaluated in the window record into the same map as
  // modules loaded by the test runner.
  window.__coverage__ = globalThis.__coverage__;
  const advanceTime = installVirtualTimers(window);
  if (!windowAnimations) {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query.includes("prefers-reduced-motion")
        ? { ...matchMedia(query), matches: true }
        : matchMedia(query);
  }
  const { document } = window;
  activeWindows.add(window);
  for (const [key, value] of Object.entries(initialStorage)) {
    window.localStorage.setItem(key, value);
  }
  Object.assign(window, {
    Array,
    ArrayBuffer,
    BigInt,
    Boolean,
    DataView,
    Date,
    Error,
    EvalError,
    Float32Array,
    Float64Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Intl,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RangeError,
    ReferenceError,
    RegExp,
    Set,
    String,
    Symbol,
    SyntaxError,
    TypeError,
    Uint8Array,
    Uint8ClampedArray,
    Uint16Array,
    Uint32Array,
    URIError,
    WeakMap,
    WeakSet,
    parseFloat,
    parseInt,
    structuredClone,
  });
  const scriptErrors: unknown[] = [];
  window.addEventListener("error", (event) => {
    scriptErrors.push(event.error || event.message);
  });
  const html = await Bun.file(
    new URL("site/index.html", projectDirectory),
  ).text();
  document.write(html);
  window.happyDOM.settings.enableJavaScriptEvaluation = true;

  window.matchMedia ??= (() => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  })) as typeof window.matchMedia;
  window.Option = function Option(
    text = "",
    value = "",
    defaultSelected = false,
    selected = false,
  ) {
    const option = document.createElement("option");
    option.text = text;
    option.value = value;
    option.defaultSelected = defaultSelected;
    option.selected = selected;
    return option;
  } as typeof window.Option;
  window.HTMLElement.prototype.animate = function animate() {
    const animation = new window.EventTarget() as EventTarget & {
      cancel(): void;
    };
    animation.cancel = () => {};
    const addEventListener = animation.addEventListener.bind(animation);
    animation.addEventListener = ((type: string, listener: EventListener) => {
      addEventListener(type, listener);
      if (type === "finish") {
        queueMicrotask(() =>
          animation.dispatchEvent(new window.Event("finish")),
        );
      }
    }) as typeof animation.addEventListener;
    return animation as unknown as Animation;
  };
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    const width = this.width;
    const height = this.height;
    const image = new Uint8ClampedArray(width * height * 4);
    return {
      canvas: this,
      beginPath() {},
      clearRect() {},
      closePath() {},
      drawImage() {},
      ellipse() {},
      fillRect() {},
      fillText() {},
      getImageData() {
        return { data: image, width, height };
      },
      lineTo() {},
      moveTo() {},
      putImageData() {},
      rect() {},
      setTransform() {},
      stroke() {},
    } as unknown as CanvasRenderingContext2D;
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,";
  window.HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
    callback(new window.Blob([], { type: "image/png" }));
  };

  beforeScripts(window);
  for (const path of scripts) {
    const script = document.createElement("script");
    script.textContent = await readScript(path);
    document.body.appendChild(script);
  }

  const emptyLibrary = {
    subscribe() {
      return () => {};
    },
    async initialize() {
      return {};
    },
    async search() {
      return [];
    },
    async details() {
      return null;
    },
    async install() {},
    async uninstall() {},
    getRecord() {
      return null;
    },
    async match() {
      return null;
    },
  };
  // An Error stands for a browser where the game library cannot be created.
  window.AstroGameLibrary.createManager = () => {
    if (gameLibraryManager instanceof Error) throw gameLibraryManager;
    return gameLibraryManager || emptyLibrary;
  };

  const offlineSnapshot = {
    activeGameId: null,
    automaticUpdateDelayMs: null,
    availableVersion: null,
    bundledGames: [
      { id: "freecell" },
      { id: "inside-the-firewall" },
      { id: "solitaire" },
      { id: "spider-solitaire" },
    ],
    downloadedGameIds: [],
    downloadedGameBytes: 0,
    downloadBytes: 8_000_000,
    downloadMetadataError: false,
    enabled: true,
    gameError: null,
    gamePhase: "idle",
    gameProgressLoaded: 0,
    gameProgressTotal: 0,
    lastChecked: null,
    online: true,
    releaseUpdateDelayMs: 6 * 60 * 60 * 1000,
    savePlayedGamesOffline: true,
    automaticUpdatesEnabled: true,
    phase: "ready",
    updateEligibleAt: null,
    updateAvailable: false,
    updateReady: false,
    usage: 0,
    workerState: "active",
    ...offlineSettings,
  };
  const offlineDownloads: string[] = [];
  const offlineListeners = new Set();
  const notifyOfflineListeners = () =>
    offlineListeners.forEach((listener) => listener({ ...offlineSnapshot }));
  const offlineManagerMock = {
    subscribe(listener) {
      offlineListeners.add(listener);
      listener({ ...offlineSnapshot });
      return () => offlineListeners.delete(listener);
    },
    async initialize() {},
    getSnapshot() {
      return offlineSnapshot;
    },
    async downloadGame(gameId) {
      offlineDownloads.push(gameId);
      offlineSnapshot.downloadedGameIds.push(gameId);
      notifyOfflineListeners();
    },
    async setOfflineEnabled(enabled) {
      offlineSnapshot.enabled = enabled;
      notifyOfflineListeners();
    },
    setSavePlayedGamesOffline(enabled) {
      offlineSnapshot.savePlayedGamesOffline = enabled;
      notifyOfflineListeners();
    },
    setAutomaticUpdatesEnabled(enabled) {
      offlineSnapshot.automaticUpdatesEnabled = enabled;
      notifyOfflineListeners();
    },
    setAutomaticUpdateDelay() {},
    async checkForUpdates() {},
    async updateNow() {},
    ...offlineMethods,
  };
  window.AstroOffline.createManager = () => offlineManagerMock;
  if (gameDataManager)
    window.AstroGameData.createManager = () => gameDataManager;

  // Happy DOM evaluates separately injected classic scripts in isolated lexical
  // environments. Real browsers share one global lexical environment, so join
  // the ordered shell modules before evaluation to preserve browser semantics.
  const script = document.createElement("script");
  script.textContent =
    (await Promise.all(shellScripts.map(readScript))).join("\n") +
    "\nwindow.__completeBootForTest = finishBootSequence;";
  document.body.appendChild(script);

  const applicationBundle = await Bun.build({
    entrypoints: [new URL("site/apps/index.js", projectDirectory).pathname],
    format: "iife",
    plugins: coverageBuildPlugins,
    target: "browser",
  });
  if (!applicationBundle.success) {
    throw new Error(applicationBundle.logs.join("\n"));
  }
  const applicationScript = document.createElement("script");
  applicationScript.textContent = await applicationBundle.outputs[0].text();
  document.body.appendChild(applicationScript);
  if (preloadApplications)
    await Promise.all(
      window.XPApplicationRegistry.values().map((application) =>
        application.load?.(),
      ),
    );

  if (scriptErrors.length) throw scriptErrors[0];

  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await flushShell();
  return {
    window,
    document,
    offlineDownloads,
    offlineSnapshot,
    notifyOfflineListeners,
    advanceTime,
    completeBoot: () => window.__completeBootForTest(),
  };
}

// Shell timers with a positive delay (boot minimums, auto-hide, tray collapse)
// wait on a virtual clock that tests advance explicitly, so a test covering a
// two-second XP delay does not spend two real seconds. Zero-delay timers stay
// real because they only order work within the current interaction.
function installVirtualTimers(window: Window) {
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);
  const timers = new Map<
    number,
    { due: number; callback: () => void; interval?: number }
  >();
  let now = 0;
  let nextId = 1_000_000_000;
  const schedule = (callback, delay, args, interval) => {
    const id = nextId++;
    timers.set(id, {
      due: now + Math.max(0, Number(delay) || 0),
      callback: () => callback(...args),
      interval,
    });
    return id;
  };
  const clear = (realClear) => (id) => {
    if (!timers.delete(id)) realClear(id);
  };
  window.setTimeout = (callback, delay = 0, ...args) =>
    Number(delay) > 0
      ? schedule(callback, delay, args)
      : realSetTimeout(callback, delay, ...args);
  window.setInterval = (callback, delay = 0, ...args) =>
    Number(delay) > 0
      ? schedule(callback, delay, args, Number(delay))
      : realSetInterval(callback, delay, ...args);
  window.clearTimeout = clear(realClearTimeout);
  window.clearInterval = clear(realClearInterval);

  return async (milliseconds: number) => {
    const target = now + milliseconds;
    for (;;) {
      let nextTimer;
      for (const entry of timers)
        if (
          entry[1].due <= target &&
          (!nextTimer || entry[1].due < nextTimer[1].due)
        )
          nextTimer = entry;
      if (!nextTimer) break;
      const [id, timer] = nextTimer;
      now = timer.due;
      if (timer.interval) timer.due += timer.interval;
      else timers.delete(id);
      timer.callback();
      await flushShell();
      await flushShell();
    }
    now = target;
    await flushShell();
    await flushShell();
  };
}

export async function login(shell: Awaited<ReturnType<typeof loadShell>>) {
  shell.completeBoot();
  shell.document.getElementById("welcome-screen")!.click();
  await flushShell();
  await flushShell();
  return shell;
}

export function clickStartAction(
  shell: Awaited<ReturnType<typeof loadShell>>,
  action: string,
) {
  shell.document.getElementById("start-button")!.click();
  const button = shell.document.querySelector<HTMLButtonElement>(
    `[data-start-action="${action}"]`,
  );
  if (!button) throw new Error(`Missing Start action: ${action}`);
  button.click();
}

export function cleanupShells() {
  activeWindows.forEach((window) => window.close());
  activeWindows.clear();
}
