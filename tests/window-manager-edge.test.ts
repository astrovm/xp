// @ts-nocheck -- Window manager edge cases driven through the real shell.
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
const key = (s, target, value, extra = {}) => {
  const event = new s.window.KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
};
const pointer = (s, target, type, x, y, extra = {}) =>
  target.dispatchEvent(
    new s.window.PointerEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
      ...extra,
    }),
  );
const dialogText = (s) =>
  [...s.document.querySelectorAll(".xp-dialog")].at(-1)?.textContent || "";

// Gives a window real geometry, as the browser's layout would.
function geometry(s, win, rect = {}) {
  const desktop = s.document.getElementById("desktop");
  Object.defineProperties(desktop, {
    clientWidth: { configurable: true, value: 1024 },
    clientHeight: { configurable: true, value: 738 },
  });
  Object.assign(win.style, {
    left: "100px",
    top: "80px",
    width: "500px",
    height: "400px",
    ...rect,
  });
  for (const [prop, style] of Object.entries({
    offsetLeft: "left",
    offsetTop: "top",
    offsetWidth: "width",
    offsetHeight: "height",
  }))
    Object.defineProperty(win, prop, {
      configurable: true,
      get: () => parseFloat(win.style[style]) || 0,
    });
  win.getBoundingClientRect = () => ({
    left: win.offsetLeft,
    top: win.offsetTop,
    width: win.offsetWidth,
    height: win.offsetHeight,
    right: win.offsetLeft + win.offsetWidth,
    bottom: win.offsetTop + win.offsetHeight,
  });
  win.getAnimations ??= () => [];
}

async function documents() {
  const s = await login(await loadShell());
  clickStartAction(s, "documents");
  await settle();
  const win = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  geometry(s, win);
  return { s, win };
}

const withRuffle = (s, players = []) => {
  s.window.RufflePlayer = {
    newest: () => ({
      createPlayer: () => {
        const player = s.document.createElement("ruffle-player");
        player.load = (config) => {
          player.config = config;
        };
        players.push(player);
        return player;
      },
    }),
  };
  return players;
};
const openGame = async (s, gameId) => {
  s.window.history.replaceState(null, "", `#${gameId}`);
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await settle();
  return s.document.querySelector(`.xp-window[data-game="${gameId}"]`);
};

const overrideRegistry = (s, overrides) => {
  const registry = s.window.XPApplicationRegistry;
  s.window.XPApplicationRegistry = {
    ...registry,
    get: (id) => (id in overrides ? overrides[id] : registry.get(id)),
    values: () => registry.values(),
  };
};
const runCommand = async (s, command) => {
  clickStartAction(s, "run");
  const dialog = s.document.querySelector(".run-dialog");
  dialog.querySelector(".run-command").value = command;
  dialog.querySelector('[data-action="run"]').click();
  await settle();
};

test("closing a maximized window remembers its restored geometry", async () => {
  const { s, win } = await documents();
  win.querySelector(".maximize-btn").click();
  expect(win.classList.contains("maximized")).toBeTrue();
  Object.assign(win.style, { left: "0px", top: "0px", width: "1024px" });
  win.querySelector(".close-btn").click();
  await settle();
  const placement = JSON.parse(
    s.window.localStorage.getItem("windowPlacements"),
  )["__my-documents"];
  expect(placement).toMatchObject({
    left: 100,
    top: 80,
    width: 500,
    height: 400,
  });
});

test("a window placed only by layout remembers its laid-out geometry", async () => {
  const { s, win } = await documents();
  // No inline geometry, so the shell reads the layout's offsets instead.
  win.removeAttribute("style");
  for (const [prop, value] of Object.entries({
    offsetLeft: 30,
    offsetTop: 40,
    offsetWidth: 320,
    offsetHeight: 240,
  }))
    Object.defineProperty(win, prop, { configurable: true, value });
  win.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  win.querySelector(".maximize-btn").click();
  expect(win.classList.contains("maximized")).toBeTrue();
  win.querySelector(".close-btn").click();
  await settle();
  expect(
    JSON.parse(s.window.localStorage.getItem("windowPlacements"))[
      "__my-documents"
    ],
  ).toEqual({ left: 30, top: 40, width: 320, height: 240 });
});

test("browser resizes leave maximized windows alone", async () => {
  const { s, win } = await documents();
  win.querySelector(".maximize-btn").click();
  Object.assign(win.style, { left: "900px", width: "2000px" });
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  expect([win.style.left, win.style.width]).toEqual(["900px", "2000px"]);
});

test("resolution previews restore maximized and closed windows on cancel", async () => {
  const s = await login(await loadShell());
  clickStartAction(s, "documents");
  clickStartAction(s, "pictures");
  await settle();
  const documentsWin = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  const picturesWin = s.document.querySelector(
    '.xp-window[data-game="__my-pictures"]',
  );
  geometry(s, documentsWin);
  geometry(s, picturesWin);
  documentsWin.querySelector(".maximize-btn").click();
  clickStartAction(s, "controlPanel");
  s.document
    .querySelector('[data-control-panel-category="appearance"]')
    .click();
  s.document.querySelector('[data-control-panel-action="display"]').click();
  const display = s.document.querySelector(".display-properties-content");
  const resolution = display.querySelector("#display-resolution");
  const change = (value) => {
    resolution.value = value;
    resolution.dispatchEvent(new s.window.Event("change", { bubbles: true }));
  };
  change("auto");
  picturesWin.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  change("800x600");
  picturesWin.querySelector(".close-btn").click();
  await settle();
  documentsWin.querySelector(".maximize-btn").click();
  expect(documentsWin.classList.contains("maximized")).toBeFalse();
  change("auto");
  expect(documentsWin.classList.contains("maximized")).toBeTrue();
  expect(picturesWin.isConnected).toBeFalse();
  display.querySelector('[data-display-action="cancel"]').click();
  await settle();
  expect(documentsWin.classList.contains("maximized")).toBeTrue();
});

test("a secondary dialog of a closed Display Properties window closes quietly", async () => {
  const s = await login(await loadShell());
  clickStartAction(s, "controlPanel");
  s.document
    .querySelector('[data-control-panel-category="appearance"]')
    .click();
  s.document.querySelector('[data-control-panel-action="display"]').click();
  const displayWin = s.document.querySelector(
    '.xp-window[data-game="__display-properties"]',
  );
  displayWin.querySelector(".display-effects").click();
  const dialog = s.document.querySelector(".display-effects-dialog");
  displayWin.querySelector(".close-btn").click();
  await settle();
  expect(displayWin.isConnected).toBeFalse();
  [...dialog.querySelectorAll(".dlg-buttons button")]
    .find((button) => button.textContent === "Cancel")
    .click();
  await settle();
  expect(s.document.querySelector(".xp-dialog")).toBeNull();
});

test("Flash games load the default player script and skip windows closed while it loads", async () => {
  const s = await login(await loadShell());
  s.document.querySelector('meta[name="astro-ruffle-src"]')?.remove();
  const scripts = [];
  const appendChild = s.document.head.appendChild.bind(s.document.head);
  s.document.head.appendChild = (node) => {
    if (node.tagName === "SCRIPT") {
      scripts.push(node);
      return node;
    }
    return appendChild(node);
  };
  const win = await openGame(s, "bike-mania");
  expect(scripts[0].getAttribute("src")).toBe("js/ruffle.js");
  win.querySelector(".close-btn").click();
  await settle();
  const players = withRuffle(s);
  scripts[0].onload();
  await settle();
  expect(players).toEqual([]);
});

test("unfocused games start silent and archived games load from their archive", async () => {
  const s = await login(await loadShell());
  const players = withRuffle(s);
  const sugar = await openGame(s, "sugar-sugar");
  expect(players[0].config.base).toBe(
    "https://www.friv.com/z/games/sugarsugar/",
  );
  const revcdos = await openGame(s, "revcdos");
  const volumes = [];
  Object.defineProperty(players[0], "volume", {
    configurable: true,
    set: (value) => volumes.push(value),
  });
  players[0].dispatchEvent(new s.window.Event("loadedmetadata"));
  expect(volumes).toEqual([0]);
  sugar.dispatchEvent(new s.window.PointerEvent("pointerdown"));
  const frame = revcdos.querySelector("iframe");
  frame.contentWindow.postMessage = () => {};
  frame.dispatchEvent(new s.window.Event("load"));
  expect(sugar.classList.contains("active")).toBeTrue();
});

test("game properties fall back when the player cannot report its frame rate", async () => {
  const s = await login(await loadShell());
  const players = withRuffle(s);
  const win = await openGame(s, "bike-mania");
  players[0].ruffle = () => {
    throw new Error("player not ready");
  };
  win.querySelector('[data-game-action="properties"]').click();
  expect(dialogText(s)).toContain("Properties");
});

test("windows whose close checks refuse or fail stay open", async () => {
  const s = await login(await loadShell());
  const element = s.document.createElement("div");
  element.className = "window-content";
  let beforeClose = () => false;
  overrideRegistry(s, {
    __notepad: {
      id: "__notepad",
      title: "Guarded",
      icon: "Notepad.png",
      kind: "program",
      window: { width: 300, height: 200 },
      mount: () => ({
        element,
        beforeClose: () => beforeClose(),
        unmount() {},
      }),
    },
  });
  await runCommand(s, "notepad");
  const win = s.document.querySelector('.xp-window[data-game="__notepad"]');
  win.querySelector(".close-btn").click();
  await settle();
  expect(win.isConnected).toBeTrue();
  for (const [message, expected] of [
    ["", "The window could not be closed."],
    ["Save failed.", "Save failed."],
  ]) {
    beforeClose = () => Promise.reject(new Error(message));
    win.querySelector(".close-btn").click();
    await settle();
    expect(dialogText(s)).toContain(expected);
    s.document.querySelector('.xp-dialog [data-action="ok"]').click();
    await settle();
    expect(win.isConnected).toBeTrue();
  }
});

test("caption drags move the frame each animation frame and stop running animations", async () => {
  const { s, win } = await documents();
  const frames = [];
  s.window.requestAnimationFrame = (callback) => frames.push(callback);
  s.window.cancelAnimationFrame = () => {};
  const cancelled = [];
  win.getAnimations = () => [{ cancel: () => cancelled.push("minimize") }];
  const bar = win.querySelector(".title-bar");
  pointer(s, bar, "pointerdown", 120, 90);
  expect(cancelled).toEqual(["minimize"]);
  pointer(s, bar, "pointermove", 150, 110);
  frames.shift()();
  expect(win.style.transform).toBe("translate3d(30px, 20px, 0)");
  pointer(s, bar, "pointerup", 150, 110);
  expect(win.style.transform).toBe("");
  expect([win.style.left, win.style.top]).toEqual(["130px", "100px"]);
});

test("title buttons and secondary buttons do not maximize or resize windows", async () => {
  const { s, win } = await documents();
  win
    .querySelector(".title-buttons")
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  expect(win.classList.contains("maximized")).toBeFalse();
  const handle = win.querySelector('.resize-handle[data-dir="se"]');
  pointer(s, handle, "pointerdown", 600, 480, { button: 2 });
  pointer(s, handle, "pointermove", 700, 580);
  pointer(s, handle, "pointerup", 700, 580);
  expect(win.style.width).toBe("500px");
  pointer(s, handle, "pointerdown", 600, 480);
  pointer(s, handle, "pointermove", 640, 520);
  pointer(s, handle, "pointercancel", 700, 580);
  expect([win.style.width, win.style.height]).toEqual(["540px", "440px"]);
  win.querySelector(".maximize-btn").click();
  pointer(s, handle, "pointerdown", 600, 480);
  pointer(s, handle, "pointermove", 700, 580);
  pointer(s, handle, "pointerup", 700, 580);
  expect(win.classList.contains("maximized")).toBeTrue();
});

test("move mode ignores other keys and the system menu ignores its separators", async () => {
  const { s, win } = await documents();
  const openMenu = () =>
    win.querySelector(".title-bar").dispatchEvent(
      new s.window.MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 120,
        clientY: 90,
      }),
    );
  openMenu();
  const menu = s.document.getElementById("window-system-menu");
  menu.querySelector(".context-separator").click();
  expect(menu.hidden).toBeFalse();
  menu.querySelector('[data-command="move"]').click();
  expect(key(s, s.document, "a").defaultPrevented).toBeFalse();
  expect(win.classList.contains("move-mode")).toBeTrue();
  key(s, s.document, "Escape");
  expect(win.classList.contains("move-mode")).toBeFalse();
});

test("fullscreen requests wait until a Flash game has a player", async () => {
  const s = await login(await loadShell());
  const appendChild = s.document.head.appendChild.bind(s.document.head);
  s.document.head.appendChild = (node) =>
    node.tagName === "SCRIPT" ? node : appendChild(node);
  const win = await openGame(s, "bike-mania");
  let requested = 0;
  s.window.HTMLElement.prototype.requestFullscreen = async () => {
    requested += 1;
  };
  win.querySelector(".fullscreen-btn").click();
  win.querySelector('[data-game-action="fullscreen"]').click();
  expect(requested).toBe(0);
  expect(win.querySelector("ruffle-player")).toBeNull();
});

test("toggling a favorite refreshes an open Start menu without All Programs", async () => {
  const s = await login(await loadShell());
  withRuffle(s);
  const win = await openGame(s, "bike-mania");
  s.document.getElementById("start-button").click();
  win.querySelector(".favorite-btn").click();
  expect(s.document.getElementById("start-menu").hidden).toBeFalse();
  expect(s.document.getElementById("start-menu-flyouts").hidden).toBeTrue();
  expect(s.window.localStorage.getItem("favorites")).toContain("bike-mania");
});

test("minimizing a group leaves already minimized members alone", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        taskbarSettings: JSON.stringify({ group: true, locked: false }),
      },
    }),
  );
  for (const action of ["documents", "pictures", "music"])
    clickStartAction(s, action);
  const fs = s.window.VirtualFS;
  fs.open(fs.createFile(fs.MY_DOCUMENTS, "memo.txt").id);
  await settle();
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 330 },
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  const pictures = s.document.querySelector(
    '.xp-window[data-game="__my-pictures"]',
  );
  pictures.querySelector(".minimize-btn").click();
  await settle();
  const group = s.document.querySelector("#task-buttons .task-button-grouped");
  group.dispatchEvent(
    new s.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  const minimizeGroup = [
    ...s.document.querySelectorAll("#taskbar-overflow-menu button"),
  ].find((button) => button.textContent === "Minimize Group");
  expect(minimizeGroup.disabled).toBeFalse();
  minimizeGroup.click();
  await settle();
  expect(
    ["__my-documents", "__my-pictures", "__my-music"].every(
      (id) =>
        s.document.querySelector(`.xp-window[data-game="${id}"]`).style
          .display === "none",
    ),
  ).toBeTrue();
});

test("cancelling a preview from a fixed resolution keeps windows where they were", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        displaySettings: JSON.stringify({ resolution: "800x600" }),
      },
    }),
  );
  clickStartAction(s, "documents");
  await settle();
  const win = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  geometry(s, win, { left: "700px" });
  clickStartAction(s, "controlPanel");
  s.document
    .querySelector('[data-control-panel-category="appearance"]')
    .click();
  s.document.querySelector('[data-control-panel-action="display"]').click();
  const display = s.document.querySelector(".display-properties-content");
  const resolution = display.querySelector("#display-resolution");
  resolution.value = "1024x768";
  resolution.dispatchEvent(new s.window.Event("change", { bubbles: true }));
  display.querySelector('[data-display-action="cancel"]').click();
  await settle();
  expect(win.style.left).toBe("700px");
  expect(s.document.getElementById("desktop").dataset.monitorResolution).toBe(
    "800x600",
  );
});

test("title bars only start drags from the primary button outside the title buttons", async () => {
  const { s, win } = await documents();
  const bar = win.querySelector(".title-bar");
  pointer(s, bar, "pointerdown", 120, 90, { button: 2 });
  expect(win.classList.contains("moving")).toBeFalse();
  pointer(s, win.querySelector(".title-buttons"), "pointerdown", 120, 90);
  expect(win.classList.contains("moving")).toBeFalse();
});

test("a Flash game that finishes loading behind another window starts silent", async () => {
  const s = await login(await loadShell());
  const scripts = [];
  const appendChild = s.document.head.appendChild.bind(s.document.head);
  s.document.head.appendChild = (node) => {
    if (node.tagName === "SCRIPT") {
      scripts.push(node);
      return node;
    }
    return appendChild(node);
  };
  await openGame(s, "bike-mania");
  clickStartAction(s, "documents");
  await settle();
  const players = withRuffle(s);
  scripts[0].onload();
  await settle();
  expect(players[0].config.volume).toBe(0);
});
