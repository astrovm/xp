// @ts-nocheck -- Keyboard and pointer routing through the real shell handlers.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  clickStartAction,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

const press = (s, target, key, options = {}) =>
  target.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
const pointerDown = (s, target) =>
  target.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
const settle = async () => {
  await flushShell();
  await flushShell();
};
const answer = async (s, id) => {
  s.document.querySelector(`.xp-dialog [data-action="${id}"]`).click();
  await settle();
};

async function openFixtureFolder() {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Keys");
  const notes = fs.createFile(folder.id, "notes.txt", { content: "n" });
  const news = fs.createFile(folder.id, "news.txt", { content: "w" });
  const other = fs.createFile(folder.id, "other.txt", { content: "o" });
  fs.open(folder.id);
  await flushShell();
  const win = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  const item = (id) =>
    win.querySelector(`.explorer-item[data-node-id="${id}"]`);
  const surface = () => win.querySelector(".explorer-items");
  return { s, fs, folder, notes, news, other, win, item, surface };
}

test("Explorer typeahead cycles matching items and keyboard shortcuts act on the selection", async () => {
  const h = await openFixtureFolder(),
    { s, fs } = h;
  const ops = s.window.FileOperations;
  h.item(h.other.id).focus();
  press(s, h.item(h.other.id), "n");
  expect(s.document.activeElement.dataset.nodeId).toBe(h.news.id);
  press(s, s.document.activeElement, "n");
  expect(s.document.activeElement.dataset.nodeId).toBe(h.notes.id);
  press(s, s.document.activeElement, "n");
  expect(s.document.activeElement.dataset.nodeId).toBe(h.news.id);
  press(s, s.document.activeElement, "a", { ctrlKey: true });
  expect(h.win.querySelectorAll(".explorer-item.selected")).toHaveLength(3);

  h.item(h.notes.id).click();
  h.item(h.notes.id).focus();
  press(s, h.item(h.notes.id), "c", { ctrlKey: true });
  expect(ops.getClipboard()).toEqual({ mode: "copy", ids: [h.notes.id] });
  press(s, h.item(h.notes.id), "v", { metaKey: true });
  await settle();
  expect(fs.findChild(h.folder.id, "Copy of notes.txt")).not.toBeNull();
  h.item(h.notes.id).click();
  h.item(h.notes.id).focus();
  press(s, h.item(h.notes.id), "x", { ctrlKey: true });
  expect(ops.getClipboard().mode).toBe("cut");

  h.item(h.other.id).click();
  h.surface().focus();
  const rename = (value) => {
    const input = s.document.querySelector(".explorer-rename");
    if (value !== null) input.value = value;
    input.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key: value === null ? "Escape" : "Enter",
        bubbles: true,
      }),
    );
  };
  press(s, h.surface(), "F2");
  rename(null);
  await settle();
  expect(fs.getNode(h.other.id).name).toBe("other.txt");
  press(s, h.surface(), "F2");
  rename("renamed.txt");
  await settle();
  expect(fs.getNode(h.other.id).name).toBe("renamed.txt");

  h.item(h.other.id).click();
  h.item(h.other.id).focus();
  press(s, h.item(h.other.id), "F10", { shiftKey: true });
  expect(!!h.win.querySelector(".explorer-context-menu")).toBeTrue();
  press(s, s.document.activeElement, "Escape");
});

test("Explorer keyboard deletes recycle, permanently delete, and empty the Recycle Bin selection", async () => {
  const h = await openFixtureFolder(),
    { s, fs } = h;
  // A failed delete shows an alert, for Delete and Shift+Delete alike.
  const fileOps = s.window.FileOperations,
    removeToBin = fileOps.removeToBin,
    destroy = fs.destroy;
  fileOps.removeToBin = async () => {
    throw new Error("Storage is full.");
  };
  fs.destroy = () => {
    throw new Error("Storage is full.");
  };
  try {
    for (const shiftKey of [false, true]) {
      h.item(h.notes.id).click();
      h.item(h.notes.id).focus();
      press(s, h.item(h.notes.id), "Delete", { shiftKey });
      await answer(s, "yes");
      await settle();
      expect(s.document.querySelector(".xp-dialog").textContent).toContain(
        "Storage is full.",
      );
      await answer(s, "ok");
      expect(fs.getNode(h.notes.id).parent).not.toBe(fs.RECYCLE_BIN);
    }
  } finally {
    fileOps.removeToBin = removeToBin;
    fs.destroy = destroy;
  }

  h.item(h.notes.id).click();
  h.item(h.notes.id).focus();
  press(s, h.item(h.notes.id), "Delete");
  await answer(s, "yes");
  expect(fs.getNode(h.notes.id).parent).toBe(fs.RECYCLE_BIN);

  h.item(h.news.id).click();
  h.item(h.news.id).focus();
  press(s, h.item(h.news.id), "Delete", { shiftKey: true });
  await answer(s, "yes");
  expect(fs.getNode(h.news.id)).toBeNull();

  fs.open(fs.RECYCLE_BIN);
  await settle();
  const bin = h.item(h.notes.id);
  bin.click();
  bin.focus();
  press(s, bin, "Delete");
  expect(s.document.querySelector(".xp-dialog").textContent).toContain(
    "permanently delete the selected items",
  );
  await answer(s, "no");
  expect(!!fs.getNode(h.notes.id)).toBeTrue();
  press(s, h.item(h.notes.id), "Delete");
  await answer(s, "yes");
  expect(fs.getNode(h.notes.id)).toBeNull();
});

test("Explorer keyboard shortcuts skip protected and empty selections", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  clickStartAction(s, "computer");
  await settle();
  const win = s.document.querySelector('.xp-window[data-game="__my-computer"]');
  const drive = win.querySelector(
    `.explorer-item[data-node-id="${fs.DRIVE_C}"]`,
  );
  drive.click();
  drive.focus();
  s.window.prompt = () => {
    throw new Error("should not rename");
  };
  for (const [key, options] of [
    ["F2", {}],
    ["Delete", {}],
    ["x", { ctrlKey: true }],
    ["v", { ctrlKey: true }],
    ["z", {}],
  ])
    press(s, drive, key, options);
  await settle();
  expect(!!s.document.querySelector(".xp-dialog")).toBeFalse();
  win
    .querySelectorAll(".selected")
    .forEach((item) => item.classList.remove("selected"));
  press(s, drive, "c", { ctrlKey: true });
  expect(s.window.FileOperations.getClipboard()).toBeNull();
});

test("desktop keyboard navigation extends selections and supports typeahead", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  fs.createFile(fs.DESKTOP, "Zebra.txt");
  fs.createFile(fs.DESKTOP, "Zoo.txt");
  await settle();
  const surface = s.document.getElementById("desktop-icons");
  const icons = () => [...s.document.querySelectorAll(".desktop-icon")];
  surface.focus();
  press(s, surface, "End", { shiftKey: true });
  expect(icons().at(-1).classList.contains("selected")).toBeTrue();
  press(s, surface, "Home", { ctrlKey: true });
  expect(s.document.activeElement).toBe(icons()[0]);
  press(s, s.document.activeElement, "ArrowDown", { shiftKey: true });
  press(s, s.document.activeElement, "ArrowDown", { ctrlKey: true });
  expect(icons().some((icon) => icon.classList.contains("selected"))).toBe(
    true,
  );
  press(s, s.document.activeElement, "z");
  const first = s.document.activeElement.textContent;
  press(s, s.document.activeElement, "z");
  expect(s.document.activeElement.textContent).not.toBe(first);
  expect(s.document.activeElement.textContent).toMatch(/^Z/);
  press(s, s.document.activeElement, " ");
  press(s, s.document.activeElement, " ", { ctrlKey: true });
  surface.focus();
  press(s, surface, "F10", { shiftKey: true });
  expect(s.document.getElementById("desktop-context-menu").hidden).toBeFalse();
  press(s, s.document.body, "Escape");

  const notes = fs.createFile(fs.DESKTOP, "a.txt");
  const other = fs.createFile(fs.DESKTOP, "b.txt");
  await settle();
  for (const id of [notes.id, other.id])
    s.document
      .querySelector(`[data-desktop-id="${id}"]`)
      .classList.add("selected");
  const selected = s.document.querySelector(`[data-desktop-id="${notes.id}"]`);
  selected.focus();
  press(s, selected, "Delete");
  expect(s.document.querySelector(".xp-dialog").textContent).toContain(
    "Recycle Bin",
  );
  await answer(s, "no");
  press(s, selected, "Delete", { shiftKey: true });
  expect(s.document.querySelector(".xp-dialog").textContent).toContain(
    "these items",
  );
  await answer(s, "yes");
  expect(fs.getNode(notes.id)).toBeNull();
  expect(fs.getNode(other.id)).toBeNull();
});

test("global shortcuts manage windows, task buttons and fullscreen", async () => {
  const s = await login(await loadShell());
  clickStartAction(s, "documents");
  clickStartAction(s, "pictures");
  await settle();
  const buttons = () => [
    ...s.document.querySelectorAll("#task-buttons .task-button"),
  ];
  buttons()[0].focus();
  press(s, buttons()[0], "End");
  expect(s.document.activeElement).toBe(buttons().at(-1));
  press(s, s.document.activeElement, "Home");
  expect(s.document.activeElement).toBe(buttons()[0]);
  press(s, s.document.activeElement, "ArrowLeft");
  expect(s.document.activeElement).toBe(buttons().at(-1));
  press(s, s.document.activeElement, "ArrowRight");
  expect(s.document.activeElement).toBe(buttons()[0]);

  s.document.body.focus();
  press(s, s.document.body, "F11");
  const active = s.document.querySelector(".xp-window.active").dataset.game;
  press(s, s.document.body, "F4", { altKey: true });
  await settle();
  expect(
    !!s.document.querySelector(`.xp-window[data-game="${active}"]`),
  ).toBeFalse();
  press(s, s.document.body, "F4", { altKey: true });
  await settle();
  press(s, s.document.body, "F4", { altKey: true });
  await settle();
  expect(s.document.querySelectorAll(".xp-window")).toHaveLength(0);
  press(s, s.document.body, "Escape", { altKey: true });
  press(s, s.document.body, "F4", { altKey: true });
  expect(
    !!s.document.querySelector(".system-dialog-overlay:not([hidden])"),
  ).toBeTrue();
});

test("keyboard file operation failures are reported", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "locked.txt");
  await settle();
  const icon = s.document.querySelector(`[data-desktop-id="${file.id}"]`);
  icon.click();
  icon.focus();
  const copy = s.window.FileOperations.copy;
  s.window.FileOperations.copy = () => {
    throw new Error("");
  };
  try {
    press(s, icon, "c", { ctrlKey: true });
    await settle();
  } finally {
    s.window.FileOperations.copy = copy;
  }
  expect(s.document.querySelector(".xp-dialog").textContent).toContain(
    "The file operation failed.",
  );
});

test("clicking elsewhere closes open application menus but not the menu being used", async () => {
  const s = await login(await loadShell());
  const bar = s.document.createElement("div");
  bar.className = "game-menu-bar";
  bar.innerHTML =
    '<button class="game-menu-button" data-game-menu="file" aria-expanded="true"></button><div class="game-menu" data-game-menu="file"></div>';
  s.document.body.append(bar);
  pointerDown(s, bar.querySelector(".game-menu"));
  expect(bar.querySelector(".game-menu").hidden).toBeFalse();
  pointerDown(s, s.document.body);
  expect(bar.querySelector(".game-menu").hidden).toBeTrue();
  expect(
    bar.querySelector(".game-menu-button").getAttribute("aria-expanded"),
  ).toBe("false");

  s.document.getElementById("start-button").click();
  pointerDown(s, s.document.getElementById("start-menu"));
  expect(s.document.getElementById("start-menu").hidden).toBeFalse();
  for (const selector of [
    "#desktop-context-menu",
    "#window-system-menu",
    "#taskbar-context-menu",
    "#tray-volume-popup",
  ]) {
    const element = s.document.querySelector(selector);
    if (element) pointerDown(s, element);
  }
  pointerDown(s, s.document.body);
  expect(s.document.getElementById("start-menu").hidden).toBeTrue();

  clickStartAction(s, "documents");
  await settle();
  const chrome = s.document.querySelector(".explorer-chrome");
  if (chrome) pointerDown(s, chrome);
  s.document.getElementById("start-button").click();
  s.document.getElementById("turn-off-button").click();
  s.document.getElementById("standby-confirm").click();
  expect(s.document.getElementById("standby-screen").hidden).toBeFalse();
  pointerDown(s, s.document.body);
  expect(s.document.getElementById("standby-screen").hidden).toBeFalse();
  press(s, s.document.body, "a");
  expect(s.document.getElementById("standby-screen").hidden).toBeTrue();
});

test("links and resizes are ignored before login", async () => {
  const s = await loadShell();
  s.window.dispatchEvent(new s.window.Event("resize"));
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keyup", { key: "a", bubbles: true }),
  );
  s.window.location.hash = "#minesweeper";
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await settle();
  expect(!!s.document.querySelector(".xp-window")).toBeFalse();
});

test("desktop arrow keys extend the selection with Shift and only move focus with Ctrl", async () => {
  const s = await login(await loadShell());
  const icons = [...s.document.querySelectorAll(".desktop-icon")];
  icons.forEach((icon, index) => {
    icon.getBoundingClientRect = () => ({
      left: 0,
      top: index * 80,
      width: 70,
      height: 70,
    });
  });
  icons[0].click();
  icons[0].focus();
  press(s, icons[0], "ArrowDown", { shiftKey: true });
  expect(s.document.activeElement).toBe(icons[1]);
  expect(
    icons.slice(0, 2).every((icon) => icon.classList.contains("selected")),
  ).toBeTrue();
  press(s, icons[1], "ArrowDown", { ctrlKey: true });
  expect(s.document.activeElement).toBe(icons[2]);
  expect(icons[2].classList.contains("selected")).toBeFalse();
  expect(icons[1].classList.contains("selected")).toBeTrue();
});

test("Alt+Tab does nothing without open windows", async () => {
  const s = await login(await loadShell());
  const event = new s.window.KeyboardEvent("keydown", {
    key: "Tab",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  s.document.body.dispatchEvent(event);
  expect(event.defaultPrevented).toBeTrue();
  expect(s.document.querySelector(".xp-window")).toBeNull();
  expect(
    s.document.querySelector(".alt-tab-switcher:not([hidden])"),
  ).toBeNull();
});

test("menu typeahead skips items that are not rendered", async () => {
  const s = await login(await loadShell());
  s.document.getElementById("start-button").click();
  const menu = s.document.getElementById("start-menu");
  const items = [...menu.querySelectorAll("button:not(:disabled)")];
  const [hidden, ...rest] = items.filter((item) =>
    /^m/i.test(
      (
        item.getAttribute("aria-label") ||
        item.querySelector(".menu-item-label, b")?.textContent ||
        item.textContent
      ).trim(),
    ),
  );
  expect(rest.length).toBeGreaterThan(0);
  hidden.getClientRects = () => [];
  press(s, menu, "m");
  expect(s.document.activeElement).not.toBe(hidden);
  expect(rest).toContain(s.document.activeElement);
});

test("visual viewport changes reflow once and duplicate resize events do not", async () => {
  let viewport;
  const s = await login(
    await loadShell({
      beforeScripts: (window) => {
        viewport = Object.assign(new window.EventTarget(), {
          width: 411,
          height: 735,
          scale: 1,
        });
        Object.defineProperty(window, "visualViewport", {
          configurable: true,
          value: viewport,
        });
      },
    }),
  );
  let resizes = 0;
  s.window.addEventListener("resize", () => resizes++);
  const frame = () =>
    new Promise((resolve) => s.window.requestAnimationFrame(resolve));
  s.window.dispatchEvent(new s.window.Event("resize"));
  expect(resizes).toBe(1);
  viewport.dispatchEvent(new s.window.Event("resize"));
  await frame();
  expect(resizes).toBe(1);

  for (const change of [{ width: 400 }, { height: 500 }, { scale: 2 }]) {
    const before = resizes;
    Object.assign(viewport, change);
    viewport.dispatchEvent(new s.window.Event("resize"));
    viewport.dispatchEvent(new s.window.Event("resize"));
    await frame();
    expect(resizes).toBe(before + 1);
  }
});
