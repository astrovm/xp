// @ts-nocheck -- A control that is drawn again keeps the keys, like XP.
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
  for (let index = 0; index < 4; index += 1) await flushShell();
};
const key = (s, target, name, init = {}) =>
  target.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
const hover = (s, element) =>
  element.dispatchEvent(new s.window.PointerEvent("pointerenter"));
const active = (s) => s.document.activeElement;
const openDocuments = async (s) => {
  clickStartAction(s, "documents");
  await settle();
  return s.document.querySelector('.xp-window[data-game="__my-documents"]');
};
const ruffle = (s) => {
  s.window.RufflePlayer = {
    newest: () => ({
      createPlayer: () => {
        const player = s.document.createElement("ruffle-player");
        player.load = () => {};
        player.metadata = { frameRate: 24 };
        return player;
      },
    }),
  };
};

test("the desktop keeps the keys on an icon that F5 draws again", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const icon = (id) =>
    s.document.querySelector(`.desktop-icon[data-desktop-id="${id}"]`);
  const bin = icon("__recycle-bin");
  bin.click();
  bin.focus();
  key(s, bin, "F5");
  await settle();
  expect(bin.isConnected).toBeFalse();
  expect(active(s) === icon("__recycle-bin")).toBeTrue();

  // An icon that goes away leaves the keys on the desktop.
  const file = fs.createFile(fs.DESKTOP, "gone.txt", { content: "" });
  await settle();
  icon(file.id).focus();
  fs.destroy(file.id);
  await settle();
  expect(active(s) === s.document.getElementById("desktop-icons")).toBeTrue();
});

test("Explorer's folder tree, tasks and other places keep the keys when drawn again", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const win = await openDocuments(s);
  const list = win.querySelector(".explorer-items");
  const row = (id) =>
    win.querySelector(`.explorer-tree-item[data-node-id="${id}"]`);

  // A folder of the tree that opens its folder keeps the keys.
  const drive = row(fs.DRIVE_C);
  drive.focus();
  drive.click();
  await settle();
  expect(drive.isConnected).toBeFalse();
  expect(active(s) === row(fs.DRIVE_C)).toBeTrue();
  // A folder that is gone gives them to the open folder.
  const folder = fs.createFolder(fs.DRIVE_C, "Trip");
  await settle();
  row(folder.id).focus();
  fs.destroy(folder.id);
  await settle();
  expect(active(s) === row(fs.DRIVE_C)).toBeTrue();

  // A task keeps the keys when the pane is drawn again.
  const task = (label) =>
    win.querySelector(`.explorer-sidebar [data-task="${label}"]`);
  task("Make a new folder").focus();
  const file = fs.createFile(fs.DRIVE_C, "photo.txt", { content: "" });
  await settle();
  expect(active(s) === task("Make a new folder")).toBeTrue();
  // A task that is gone gives them to the list.
  win.querySelector(`.explorer-item[data-node-id="${file.id}"]`).click();
  await settle();
  task("Rename this file").focus();
  fs.destroy(file.id);
  await settle();
  expect(task("Rename this file")).toBeNull();
  expect(active(s) === list).toBeTrue();

  // A place keeps the keys, and a place that is gone gives them to the list.
  const place = (name) =>
    win.querySelector(`.explorer-places-section [data-place="${name}"]`);
  place("computer").focus();
  row(fs.DESKTOP).click();
  await settle();
  expect(active(s) === place("computer")).toBeTrue();
  place("documents").focus();
  row(fs.MY_DOCUMENTS).click();
  await settle();
  expect(place("documents")).toBeNull();
  expect(active(s) === list).toBeTrue();
});

test("task buttons keep the keys when the taskbar draws new ones", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        taskbarSettings: JSON.stringify({ group: true, locked: false }),
      },
    }),
  );
  const fs = s.window.VirtualFS;
  for (const action of ["documents", "pictures", "music"])
    clickStartAction(s, action);
  fs.open(fs.createFile(fs.MY_DOCUMENTS, "memo.txt").id);
  await settle();

  // With no room, one button holds every window. Each drawing makes it new.
  const overflow = () =>
    s.document.querySelector("#task-buttons .task-button-grouped");
  const first = overflow();
  first.focus();
  s.window.XPShell.setWindowAttention("__my-pictures");
  await settle();
  expect(first.isConnected).toBeFalse();
  expect(active(s) === overflow()).toBeTrue();

  // With room, the Explorer windows share a group button.
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 330, configurable: true },
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  const group = () =>
    s.document.querySelector("#task-buttons .task-button-grouped");
  const button = group();
  expect(button.textContent).toContain("3 Windows Explorer");
  button.focus();
  s.window.XPShell.setWindowAttention("__my-music");
  await settle();
  expect(button.isConnected).toBeFalse();
  expect(active(s) === group()).toBeTrue();
});

test("a task button that moves keeps the keys", async () => {
  const s = await login(
    await loadShell({
      initialStorage: { taskbarSettings: JSON.stringify({ group: false }) },
    }),
  );
  const buttons = s.document.getElementById("task-buttons");
  // The taskbar has room for a button for each window.
  Object.defineProperty(buttons, "clientWidth", {
    value: 800,
    configurable: true,
  });
  for (const action of ["documents", "pictures", "music"])
    clickStartAction(s, action);
  await settle();
  // Chrome takes the keys from a button that leaves the page, also when it
  // comes back at once. Happy DOM keeps them, so the test does what Chrome
  // does.
  const replace = buttons.replaceChildren.bind(buttons);
  buttons.replaceChildren = (...nodes) => {
    if (buttons.contains(active(s))) active(s).blur();
    replace(...nodes);
  };
  const documents = buttons.querySelector('[data-game="__my-documents"]');
  documents.focus();
  s.document
    .querySelector('.xp-window[data-game="__my-pictures"] .close-btn')
    .click();
  await settle();
  expect(buttons.querySelector('[data-game="__my-pictures"]')).toBeNull();
  expect(documents.isConnected).toBeTrue();
  expect(active(s) === documents).toBeTrue();
});

test("the Start menu keeps the keys on a program that it draws again", async () => {
  const s = await login(await loadShell());
  ruffle(s);
  s.window.history.replaceState(null, "", "#big-truck-adventures");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await settle();
  const game = s.document.querySelector(
    '.xp-window[data-game="big-truck-adventures"]',
  );
  s.document.getElementById("start-button").click();
  await settle();
  // Internet Games is the first pinned program.
  const pinnedInternet = () =>
    s.document.querySelector("#start-menu-pinned .sm-pinned");
  const internet = pinnedInternet();
  internet.focus();
  // A favorite draws the pinned programs again, here with small icons.
  s.window.localStorage.setItem(
    "startMenuOptions",
    JSON.stringify({ largeIcons: false }),
  );
  game.querySelector('[data-game-action="favorite"]').click();
  await settle();
  expect(internet.isConnected).toBeFalse();
  expect(active(s) === pinnedInternet()).toBeTrue();
  // A program that is gone gives the keys to All Programs.
  s.window.localStorage.setItem(
    "startMenuOptions",
    JSON.stringify({ largeIcons: false, showInternet: false }),
  );
  game.querySelector('[data-game-action="favorite"]').click();
  await settle();
  expect(pinnedInternet()).toBeNull();
  expect(
    active(s) === s.document.getElementById("all-programs-button"),
  ).toBeTrue();

  // A submenu that closes gives its keys to the item that opens the next one.
  const all = s.document.getElementById("all-programs-button");
  all.click();
  await settle();
  const panels = () => [
    ...s.document.querySelectorAll(".start-program-flyout"),
  ];
  const accessories = panels()[0].querySelector(
    '[data-program-id="accessories"]',
  );
  accessories.click();
  await settle();
  expect(panels()[1].contains(active(s))).toBeTrue();
  const other = [
    ...panels()[0].querySelectorAll('[aria-haspopup="menu"]'),
  ].find((item) => item !== accessories);
  hover(s, other);
  await s.advanceTime(220);
  expect(active(s) === other).toBeTrue();

  // All Programs drawn again keeps the keys on the same program.
  const notepad = () =>
    s.document.querySelector(".start-program-flyout [data-program-id]");
  const program = notepad();
  program.focus();
  game.querySelector('[data-game-action="favorite"]').click();
  await settle();
  expect(program.isConnected).toBeFalse();
  expect(active(s).dataset.programId).toBe(program.dataset.programId);

  // A submenu item with no program id, like a game group, is gone after the
  // drawing, so All Programs takes the keys.
  panels()[0].querySelector('[data-program-id="games"]').click();
  await settle();
  const groupFolder = [
    ...panels()[1].querySelectorAll('[aria-haspopup="menu"]'),
  ].find((item) => !item.dataset.programId);
  groupFolder.focus();
  game.querySelector('[data-game-action="favorite"]').click();
  await settle();
  expect(groupFolder.isConnected).toBeFalse();
  expect(active(s) === s.document.getElementById("all-programs-button")).toBe(
    true,
  );
});

test("a taskbar toolbar keeps the keys on a button that it draws again", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        taskbarSettings: JSON.stringify({
          locked: false,
          desktopToolbar: true,
        }),
      },
    }),
  );
  const fs = s.window.VirtualFS;
  const first = fs.createFile(fs.DESKTOP, "first.txt", { content: "" });
  await settle();
  const button = (id) =>
    s.document.querySelector(`.taskbar-toolbar [data-shortcut="${id}"]`);
  const shortcut = () =>
    [...s.document.querySelectorAll(".taskbar-toolbar [data-shortcut]")].find(
      (entry) => entry.title === "first.txt",
    );
  const old = shortcut();
  old.focus();
  fs.createFile(fs.DESKTOP, "second.txt", { content: "" });
  await settle();
  expect(old.isConnected).toBeFalse();
  expect(active(s) === shortcut()).toBeTrue();

  // A control with no shortcut, like the grip, keeps them too.
  const grip = s.document.querySelector(".taskbar-toolbar .toolbar-grip");
  grip.focus();
  fs.createFile(fs.DESKTOP, "third.txt", { content: "" });
  await settle();
  expect(grip.isConnected).toBeFalse();
  expect(
    active(s) === s.document.querySelector(".taskbar-toolbar .toolbar-grip"),
  ).toBeTrue();

  // A button that is gone gives the keys to Start.
  shortcut().focus();
  fs.destroy(first.id);
  await settle();
  expect(button(first.id)).toBeNull();
  expect(active(s) === s.document.getElementById("start-button")).toBeTrue();
});
