// @ts-nocheck -- Program and system windows opened through the real shell.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  clickStartAction,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

const settle = async () => {
  for (let i = 0; i < 4; i++) await flushShell();
};
const dialogText = (s) =>
  [...s.document.querySelectorAll(".xp-dialog")].at(-1)?.textContent || "";
const runCommand = async (s, command) => {
  clickStartAction(s, "run");
  const dialog = s.document.querySelector(".run-dialog");
  dialog.querySelector("#run-command").value = command;
  dialog.querySelector('[data-action="run"]').click();
  await settle();
};
// Serves selected applications from test doubles while leaving the rest of
// the real registry in place.
const overrideRegistry = (s, overrides) => {
  const registry = s.window.XPApplicationRegistry;
  s.window.XPApplicationRegistry = {
    ...registry,
    get: (id) => (id in overrides ? overrides[id] : registry.get(id)),
    values: () => registry.values(),
  };
};

test("a folder opens in Explorer while Explorer's code still loads", async () => {
  const s = await login(await loadShell({ preloadApplications: false }));
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Projects");
  expect(() => fs.open(folder.id)).not.toThrow();
  await settle();
  const win = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  expect(win?.querySelector(".title-text")?.textContent).toBe("Projects");

  // A window that fails to load leaves nothing to show the folder in.
  win.querySelector(".close-btn").click();
  await settle();
  overrideRegistry(s, {
    "__my-documents": {
      kind: "system",
      title: "My Documents",
      loaded: null,
      load: () => Promise.reject(new Error("offline")),
    },
  });
  expect(() => fs.open(folder.id)).not.toThrow();
  await settle();
  expect(dialogText(s)).toContain("offline");
  expect(
    s.document.querySelector('.xp-window[data-game="__my-documents"]') === null,
  ).toBeTrue();
});

test("system windows load lazily and report load failures", async () => {
  const s = await login(await loadShell({ preloadApplications: false }));
  clickStartAction(s, "documents");
  await settle();
  expect(
    !!s.document.querySelector('.xp-window[data-game="__my-documents"]'),
  ).toBeTrue();

  overrideRegistry(s, {
    "__my-music": {
      kind: "system",
      title: "My Music",
      loaded: null,
      load: () => Promise.reject(new Error("")),
    },
    "__my-pictures": { kind: "program" },
  });
  clickStartAction(s, "music");
  await settle();
  expect(dialogText(s)).toContain(
    "The window could not be loaded. Try opening it again.",
  );
  clickStartAction(s, "pictures");
  await settle();
  expect(
    !!s.document.querySelector('.xp-window[data-game="__my-pictures"]'),
  ).toBeFalse();
});

test("programs report load failures and honor custom window options", async () => {
  const s = await login(await loadShell());
  const element = s.document.createElement("div");
  element.className = "window-content";
  overrideRegistry(s, {
    __notepad: {
      title: "Notepad",
      loaded: null,
      load: () => Promise.reject(new Error("")),
    },
  });
  await runCommand(s, "notepad");
  expect(dialogText(s)).toContain(
    "The application could not be loaded. Try opening it again.",
  );
  s.document.querySelector('.xp-dialog [data-action="ok"]').click();

  const desktop = s.document.getElementById("desktop");
  Object.defineProperties(desktop, {
    clientWidth: { configurable: true, value: 12 },
    clientHeight: { configurable: true, value: 12 },
  });
  overrideRegistry(s, {
    __notepad: {
      id: "__notepad",
      title: "Custom",
      icon: "Notepad.png",
      kind: "program",
      window: {
        width: 200,
        height: 120,
        customChrome: true,
        resizable: false,
        maximizable: false,
      },
      mount: () => ({ element, unmount() {} }),
    },
  });
  await runCommand(s, "notepad");
  const win = s.document.querySelector('.xp-window[data-game="__notepad"]');
  expect(win.style.width).toBe("200px");
  // A desktop that small isn't laid out yet, so the start position stays.
  expect(win.style.left).toBe("8px");
  expect(win.style.top).toBe("8px");
  expect(win.querySelector(".maximize-btn").disabled).toBeTrue();
  expect(win.querySelectorAll(".resize-handle")).toHaveLength(0);
  win.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
});

test("programs launch other applications, save files and set the wallpaper", async () => {
  const s = await login(await loadShell());
  let context;
  overrideRegistry(s, {
    __notepad: {
      id: "__notepad",
      title: "Notepad",
      icon: "Notepad.png",
      kind: "program",
      window: { width: 200, height: 120 },
      mount: (programContext) => {
        context = programContext;
        return { element: s.document.createElement("div"), unmount() {} };
      },
    },
  });
  await runCommand(s, "notepad");

  expect(context.launchApplication("missing")).toBeFalse();
  expect(context.launchApplication("__my-documents")).toBeTrue();
  await settle();
  expect(
    !!s.document.querySelector('.xp-window[data-game="__my-documents"]'),
  ).toBeTrue();

  const fs = s.window.VirtualFS;
  const file = context.createFile(fs.MY_DOCUMENTS, "saved.txt", "old");
  expect(fs.getContent(file.id)).toBe("old");
  context.setFileContent(file.id, "new");
  expect(fs.getContent(file.id)).toBe("new");
  expect(context.folderOf("sample-winter")).toBe(fs.SAMPLE_PICTURES);
  expect(context.folderOf("missing")).toBeNull();
  // A deleted picture's folder is in the Recycle Bin. Paint never saves there.
  const folder = fs.createFolder(fs.MY_PICTURES, "Trip");
  const photo = context.createFile(folder.id, "beach.png", "");
  fs.remove(folder.id);
  expect(context.folderOf(photo.id)).toBeNull();
  expect(() => context.createFile(folder.id, "late.png", "")).toThrow(
    /cannot accept new items/,
  );
  // Paint reads pictures through the shell, sample pictures included.
  expect(context.pictureUrl(fs.getNode("sample-winter"))).toBe(
    "/assets/xp/sample-pictures/winter.jpg",
  );
  expect(context.pictureUrl(file)).toBeNull();

  context.setWallpaper("data:image/png;base64,AAAA");
  const desktop = s.document.getElementById("desktop");
  expect(desktop.dataset.wallpaperPosition).toBe("center");
  expect(desktop.style.getPropertyValue("--desktop-background")).toBe(
    'url("data:image/png;base64,AAAA")',
  );
});

test("desktop items open games, system windows, and survive failing files", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        taskbarSettings: JSON.stringify({
          quickLaunch: true,
          quickLaunchItems: ["bike-mania", "__my-computer", "__astro-settings"],
        }),
      },
    }),
  );
  const fs = s.window.VirtualFS;
  s.window.RufflePlayer = {
    newest: () => ({
      createPlayer: () => {
        const player = s.document.createElement("ruffle-player");
        player.load = () => {};
        return player;
      },
    }),
  };
  const desktop = s.document.getElementById("desktop");
  Object.defineProperties(desktop, {
    clientWidth: { configurable: true, value: 1600 },
    clientHeight: { configurable: true, value: 300 },
  });
  const quick = (id) =>
    s.document.querySelector(`.quick-launch-toolbar [data-shortcut="${id}"]`);
  quick("bike-mania").click();
  await settle();
  expect(s.window.location.hash).toBe("#bike-mania");
  const game = s.document.querySelector('.xp-window[data-game="bike-mania"]');
  expect(parseFloat(game.style.height)).toBeLessThanOrEqual(276);
  quick("__my-computer").click();
  quick("__astro-settings").click();
  await settle();
  expect(
    !!s.document.querySelector('.xp-window[data-game="__astro-settings"]'),
  ).toBeTrue();

  fs.registerFileType(".boom", () => {
    throw new Error("handler failed");
  });
  const file = fs.createFile(fs.DESKTOP, "broken.boom");
  await settle();
  const errors = [];
  const originalError = s.window.console.error;
  s.window.console.error = (error) => errors.push(error);
  try {
    s.document
      .querySelector(`[data-desktop-id="${file.id}"]`)
      .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  } finally {
    s.window.console.error = originalError;
  }
  expect(errors[0].message).toBe("handler failed");
});

test("games opened from Run are linked in the address hash", async () => {
  const s = await login(await loadShell());
  s.window.RufflePlayer = {
    newest: () => ({
      createPlayer: () => {
        const player = s.document.createElement("ruffle-player");
        player.load = () => {};
        return player;
      },
    }),
  };
  expect(s.window.location.hash).toBe("");
  await runCommand(s, "bike-mania");
  expect(
    !!s.document.querySelector('.xp-window[data-game="bike-mania"]'),
  ).toBeTrue();
  expect(s.window.location.hash).toBe("#bike-mania");
});

test("programs open no larger than the desktop leaves room for", async () => {
  const s = await login(await loadShell());
  const desktop = s.document.getElementById("desktop");
  Object.defineProperties(desktop, {
    clientWidth: { configurable: true, value: 500 },
    clientHeight: { configurable: true, value: 300 },
  });
  await runCommand(s, "notepad");
  const win = s.document.querySelector('.xp-window[data-game="__notepad"]');
  expect(win.style.width).toBe("484px");
  expect(win.style.height).toBe("284px");
});

test("system windows that finish loading after log off stay closed and silent", async () => {
  const s = await login(await loadShell({ preloadApplications: false }));
  let finishMusic, failPictures;
  const mount = () => ({
    element: s.document.createElement("div"),
    unmount() {},
  });
  overrideRegistry(s, {
    "__my-music": {
      kind: "system",
      title: "My Music",
      loaded: null,
      load: () => new Promise((resolve) => (finishMusic = resolve)),
    },
    "__my-pictures": {
      kind: "system",
      title: "My Pictures",
      loaded: null,
      load: () => new Promise((_resolve, reject) => (failPictures = reject)),
    },
  });
  clickStartAction(s, "music");
  clickStartAction(s, "pictures");
  s.document.getElementById("logoff-confirm").click();
  await settle();
  expect(s.document.getElementById("desktop").hidden).toBeTrue();
  finishMusic({ mount });
  failPictures(new Error("offline"));
  await settle();
  expect(s.document.querySelector(".xp-window")).toBeNull();
  expect(s.document.querySelector(".xp-dialog")).toBeNull();
});

test("system applications without lazy loading open directly", async () => {
  const s = await login(await loadShell());
  const element = s.document.createElement("div");
  element.className = "window-content direct-system-window";
  overrideRegistry(s, {
    "__control-panel": {
      id: "__control-panel",
      kind: "system",
      title: "Direct",
      icon: "ControlPanel.png",
      window: { width: 300, height: 200 },
      mount: () => ({ element, unmount() {} }),
    },
  });
  clickStartAction(s, "controlPanel");
  await settle();
  const win = s.document.querySelector(
    '.xp-window[data-game="__control-panel"]',
  );
  expect(win.querySelector(".direct-system-window")).toBe(element);
});

test("Paint saves through the shell's Save As dialog into My Pictures", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  s.document.getElementById("start-button").click();
  s.document.getElementById("all-programs-button").click();
  const flyouts = s.document.getElementById("start-menu-flyouts");
  flyouts.querySelector('[data-program-id="accessories"]').click();
  flyouts.querySelector('[data-program-id="paint"]').click();
  await settle();
  const win = s.document.querySelector('.xp-window[data-game="__paint"]');
  win.querySelector('[data-paint-command="save-as"]').click();
  await settle();
  const dialog = [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  expect(dialog.textContent).toContain("Save As");
  expect(dialog.querySelector(".dlg-file-folder-value").textContent).toContain(
    "My Pictures",
  );
  // XP's Paint lists only the types it saves, with no All Files.
  expect(
    [...dialog.querySelectorAll(".dlg-file-type option")].map(
      (option) => option.textContent,
    ),
  ).toEqual([
    "BMP, DIB, JPG, JPEG, PNG Files (*.bmp;*.dib;*.jpg;*.jpeg;*.png)",
  ]);
  expect(dialog.querySelector("#dlg-file-name").value).toBe("untitled");
  dialog.querySelector("#dlg-file-name").value = "sketch";
  dialog
    .querySelector("#dlg-file-name")
    .dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  for (let i = 0; i < 20 && !fs.findChild(fs.MY_PICTURES, "sketch.bmp"); i++)
    await flushShell();
  expect(fs.findChild(fs.MY_PICTURES, "sketch.bmp")).toBeTruthy();
  expect(win.querySelector(".title-text").textContent).toBe(
    "sketch.bmp - Paint",
  );
});

test("game shortcuts open at full width on roomy desktops and ignore uninstalled games", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  s.window.RufflePlayer = {
    newest: () => ({
      createPlayer: () => {
        const player = s.document.createElement("ruffle-player");
        player.load = () => {};
        return player;
      },
    }),
  };
  const desktop = s.document.getElementById("desktop");
  Object.defineProperties(desktop, {
    clientWidth: { configurable: true, value: 1600 },
    clientHeight: { configurable: true, value: 1200 },
  });
  const missing = fs.createFile(fs.DESKTOP, "Missing.game", {
    app: "uninstalled-game",
  });
  fs.open(missing.id);
  await settle();
  expect(s.document.querySelector(".xp-window")).toBeNull();

  await runCommand(s, "bike-mania");
  const game = s.document.querySelector('.xp-window[data-game="bike-mania"]');
  expect(game.style.width).toBe("720px");
  expect(parseFloat(game.style.height)).toBeLessThan(1200 * 0.92);
});
