// @ts-nocheck -- Where the keys go while a modal dialog is open, and when the desktop has them.
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
// Chrome blurs a control that something hides, with no new owner for the
// keys. Happy DOM does not, so the test does it.
const loseKeys = (s, control) => {
  control.blur();
  control.dispatchEvent(
    new s.window.FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
  );
};
const openDocuments = async (s) => {
  clickStartAction(s, "documents");
  await settle();
  return s.document.querySelector('.xp-window[data-game="__my-documents"]');
};
const desktopIcon = (s, id) =>
  s.document.querySelector(`.desktop-icon[data-desktop-id="${id}"]`);

test("an open modal dialog keeps the keys, never the window behind it", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  const win = await openDocuments(s);
  const answer = s.window.XPDialogs.confirm("Go on?");
  await settle();
  const dialog = s.document.querySelector(".xp-dialog");
  const [yes, no] = dialog.querySelectorAll(".dlg-buttons button");
  expect(active() === yes).toBeTrue();
  const inDialog = () => dialog.contains(active()) && !win.contains(active());

  // A control that goes away, like an item of a list that is drawn again:
  // the default button gets the keys.
  const gone = s.document.createElement("button");
  dialog.querySelector(".dlg-message").append(gone);
  gone.focus();
  gone.remove();
  await settle();
  expect(active() === yes).toBeTrue();

  // Keys that leave to nothing go back to the control that had them last.
  const field = s.document.createElement("input");
  dialog.querySelector(".dlg-message").append(field);
  field.focus();
  loseKeys(s, field);
  await settle();
  expect(active() === field).toBeTrue();

  // A gray default button is skipped for the first control that shows.
  field.remove();
  yes.disabled = true;
  Object.defineProperty(no, "offsetParent", { get: () => dialog });
  await settle();
  const first = [...dialog.querySelectorAll("button")].find(
    (button) => !button.disabled && button.offsetParent !== null,
  );
  expect(active() === first).toBeTrue();
  expect(inDialog()).toBeTrue();
  yes.disabled = false;

  // A modeless dialog does not keep the keys.
  no.click();
  expect(await answer).toBeFalse();
  await settle();
  expect(win.contains(active())).toBeTrue();
  const modeless = s.window.XPDialogs.createDialog({
    title: "Find",
    modal: false,
  });
  expect(s.window.XPDialogs.takeKeys()).toBeFalse();
  modeless.close();
});

test("a system dialog takes the keys, keeps Tab inside and gives them back", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  const win = await openDocuments(s);
  const items = win.querySelector(".explorer-items");
  items.focus();
  const shutdown = s.document.getElementById("shutdown-dialog");

  s.document.getElementById("start-button").click();
  s.document.getElementById("turn-off-button").click();
  await settle();
  expect(shutdown.hidden).toBeFalse();
  const confirm = s.document.getElementById("shutdown-confirm");
  expect(active() === confirm).toBeTrue();

  // Tab and Shift+Tab go around its buttons.
  const buttons = [...shutdown.querySelectorAll("button")];
  key(s, confirm, "Tab");
  expect(active() === buttons[buttons.indexOf(confirm) + 1]).toBeTrue();
  key(s, active(), "Tab", { shiftKey: true });
  expect(active() === confirm).toBeTrue();
  buttons[0].focus();
  key(s, buttons[0], "Tab", { shiftKey: true });
  expect(active() === buttons.at(-1)).toBeTrue();
  key(s, active(), "Tab");
  expect(active() === buttons[0]).toBeTrue();
  // Alt+Tab is not its Tab.
  expect(key(s, active(), "Tab", { altKey: true })).toBeTrue();

  // A control that goes away gives the keys to the dialog, not the window.
  const gone = s.document.createElement("button");
  s.document.body.append(gone);
  gone.focus();
  gone.remove();
  await settle();
  expect(active() === confirm).toBeTrue();

  // Esc closes it, and the keys go back to where they were: the Start
  // button, which the Start menu gave them to.
  key(s, confirm, "Escape");
  await settle();
  expect(shutdown.hidden).toBeTrue();
  expect(active() === s.document.getElementById("start-button")).toBeTrue();

  // The same for Log Off.
  const logoff = s.document.getElementById("logoff-dialog");
  s.document.getElementById("start-button").click();
  s.document.getElementById("log-off-button").click();
  await settle();
  expect(active() === s.document.getElementById("logoff-confirm")).toBeTrue();
  s.document.getElementById("logoff-cancel").click();
  await settle();
  expect(logoff.hidden).toBeTrue();
  expect(active() === s.document.getElementById("start-button")).toBeTrue();

  // A control that is gone sends the keys to the active window, here none.
  const field = s.document.createElement("button");
  s.document.getElementById("desktop-icons").append(field);
  field.focus();
  key(s, field, "F4", { altKey: true });
  await settle();
  expect(active() === confirm).toBeTrue();
  field.remove();
  key(s, confirm, "Escape");
  await settle();
  expect(active() === s.document.getElementById("desktop-icons")).toBeTrue();
  expect(win.isConnected).toBeTrue();
});

test("the desktop and the taskbar take the keys from the active window", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  const win = await openDocuments(s);
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 800, configurable: true },
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  const taskButton = () =>
    s.document.querySelector('.task-button[data-game="__my-documents"]');
  expect(win.classList.contains("active")).toBeTrue();
  expect(taskButton().classList.contains("active")).toBeTrue();

  // A press on the desktop: no window is active, like XP.
  const icons = s.document.getElementById("desktop-icons");
  icons.focus();
  await settle();
  expect(win.classList.contains("active")).toBeFalse();
  expect(taskButton().classList.contains("active")).toBeFalse();

  // Alt+F4 then turns the computer off and leaves the window open.
  key(s, icons, "F4", { altKey: true });
  await settle();
  expect(win.isConnected).toBeTrue();
  const shutdown = s.document.getElementById("shutdown-dialog");
  expect(shutdown.hidden).toBeFalse();
  key(s, active(), "Escape");
  await settle();
  expect(active() === icons).toBeTrue();
  // Alt+Space opens no window menu.
  key(s, icons, " ", { altKey: true });
  expect(s.document.getElementById("window-system-menu").hidden).toBeTrue();

  // The task button makes the window active again.
  taskButton().click();
  await settle();
  expect(win.classList.contains("active")).toBeTrue();

  // The same for the empty taskbar.
  s.document.getElementById("taskbar").focus();
  await settle();
  expect(win.classList.contains("active")).toBeFalse();
  key(s, active(), "F4", { altKey: true });
  await settle();
  expect(win.isConnected).toBeTrue();
  expect(shutdown.hidden).toBeFalse();
  key(s, active(), "Escape");
});

test("a deleted desktop icon gives the keys to the desktop, not to a window", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "gone.txt", { content: "" });
  const win = await openDocuments(s);
  const icon = desktopIcon(s, file.id);
  icon.focus();
  icon.classList.add("selected");
  key(s, icon, "Delete");
  await settle();
  const dialog = s.document.querySelector(".xp-dialog");
  [...dialog.querySelectorAll(".dlg-buttons button")]
    .find((button) => button.textContent === "Yes")
    .click();
  await settle();
  expect(fs.getNode(file.id).parent).toBe(fs.RECYCLE_BIN);
  expect(win.contains(active())).toBeFalse();
  expect(active() === s.document.getElementById("desktop-icons")).toBeTrue();
});

test("a desktop rename that Enter or Esc ends leaves the keys on its icon", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "old.txt", { content: "" });
  const win = await openDocuments(s);
  const rename = (id) => {
    desktopIcon(s, id).focus();
    desktopIcon(s, id).dispatchEvent(
      new s.window.MouseEvent("contextmenu", { bubbles: true }),
    );
    s.document
      .querySelector(
        `#desktop-context-menu [data-action="${
          id === "__my-computer" ? "rename-my-computer" : "rename"
        }"]`,
      )
      .click();
    return s.document.querySelector(".desktop-rename");
  };

  let input = rename(file.id);
  input.value = "new.txt";
  key(s, input, "Enter");
  await settle();
  expect(fs.getNode(file.id).name).toBe("new.txt");
  expect(active() === desktopIcon(s, file.id)).toBeTrue();
  expect(win.contains(active())).toBeFalse();

  input = rename(file.id);
  input.value = "other.txt";
  key(s, input, "Escape");
  await settle();
  expect(fs.getNode(file.id).name).toBe("new.txt");
  expect(active() === desktopIcon(s, file.id)).toBeTrue();

  // The same for My Computer, whose name is a setting.
  input = rename("__my-computer");
  input.value = "Computer";
  key(s, input, "Enter");
  await settle();
  expect(desktopIcon(s, "__my-computer").textContent).toBe("Computer");
  expect(active() === desktopIcon(s, "__my-computer")).toBeTrue();
  input = rename("__my-computer");
  key(s, input, "Escape");
  await settle();
  expect(active() === desktopIcon(s, "__my-computer")).toBeTrue();

  // Alt+F4 in the box turns the computer off and keeps the new name.
  input = rename(file.id);
  input.value = "kept.txt";
  key(s, input, "F4", { altKey: true });
  await settle();
  expect(win.isConnected).toBeTrue();
  expect(s.document.getElementById("shutdown-dialog").hidden).toBeFalse();
  expect(active() === s.document.getElementById("shutdown-confirm")).toBe(true);
  expect(fs.getNode(file.id).name).toBe("kept.txt");
  key(s, active(), "Escape");
});

test("an Explorer rename box lets the shell keys through and commits on close", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.MY_DOCUMENTS, "note.txt", { content: "" });
  const win = await openDocuments(s);
  const item = win.querySelector(`.explorer-item[data-node-id="${file.id}"]`);
  item.dispatchEvent(new s.window.MouseEvent("contextmenu", { bubbles: true }));
  win.querySelector('.explorer-context-menu [data-command="rename"]').click();
  await settle();
  const input = win.querySelector(".explorer-rename");
  const reached = [];
  const listen = (event) => reached.push(event.key);
  s.document.addEventListener("keydown", listen);

  // The box keeps its own keys from Explorer.
  key(s, input, "Delete");
  key(s, input, "a", { ctrlKey: true });
  expect(reached).toEqual([]);

  // Alt+F4 reaches the shell. The window closes, and the rename commits.
  input.value = "done.txt";
  key(s, input, "F4", { altKey: true });
  await settle();
  s.document.removeEventListener("keydown", listen);
  expect(reached).toEqual(["F4"]);
  expect(win.isConnected).toBeFalse();
  expect(fs.getNode(file.id).name).toBe("done.txt");
});

test("Alt and a letter in an Explorer rename box opens the menu and commits, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.MY_DOCUMENTS, "note.txt", { content: "" });
  const win = await openDocuments(s);
  const item = win.querySelector(`.explorer-item[data-node-id="${file.id}"]`);
  item.dispatchEvent(new s.window.MouseEvent("contextmenu", { bubbles: true }));
  win.querySelector('.explorer-context-menu [data-command="rename"]').click();
  await settle();
  const input = win.querySelector(".explorer-rename");
  input.value = "menu.txt";
  const openMenu = () =>
    [...win.querySelectorAll(".game-menu")].find((menu) => !menu.hidden) ||
    null;
  expect(openMenu() === null).toBeTrue();
  expect(key(s, input, "f", { altKey: true })).toBeFalse();
  await settle();
  // The menu takes the keys, so the box closes with the new name.
  expect(
    win
      .querySelector('[role="menubar"] [aria-expanded="true"]')
      ?.textContent.trim(),
  ).toBe("File");
  expect(openMenu().contains(s.document.activeElement)).toBeTrue();
  expect(win.querySelector(".explorer-rename") === null).toBeTrue();
  expect(fs.getNode(file.id).name).toBe("menu.txt");

  // Alt with a letter that no menu has, and Ctrl+Alt with a letter, stay
  // in the box.
  key(s, s.document.activeElement, "Escape");
  await settle();
  const renamed = win.querySelector(
    `.explorer-item[data-node-id="${file.id}"]`,
  );
  renamed.dispatchEvent(
    new s.window.MouseEvent("contextmenu", { bubbles: true }),
  );
  win.querySelector('.explorer-context-menu [data-command="rename"]').click();
  await settle();
  const again = win.querySelector(".explorer-rename");
  again.focus();
  key(s, again, "q", { altKey: true });
  key(s, again, "f", { altKey: true, ctrlKey: true });
  await settle();
  expect(openMenu() === null).toBeTrue();
  expect(s.document.activeElement === again).toBeTrue();
  key(s, again, "Escape");
  await settle();

  // The desktop has no menu bar, so its box keeps the keys and its name.
  const memo = fs.createFile(fs.DESKTOP, "memo.txt", { content: "" });
  await settle();
  desktopIcon(s, memo.id).focus();
  desktopIcon(s, memo.id).dispatchEvent(
    new s.window.MouseEvent("contextmenu", { bubbles: true }),
  );
  s.document
    .querySelector('#desktop-context-menu [data-action="rename"]')
    .click();
  const box = s.document.querySelector(".desktop-rename");
  box.value = "kept.txt";
  key(s, box, "f", { altKey: true });
  await settle();
  expect(s.document.activeElement === box).toBeTrue();
  expect(openMenu() === null).toBeTrue();
  expect(fs.getNode(memo.id).name).toBe("memo.txt");
  key(s, box, "Enter");
  await settle();
  expect(fs.getNode(memo.id).name).toBe("kept.txt");
});

test("the window that was active keeps its sound while the desktop has the keys", async () => {
  const s = await login(await loadShell());
  const players = [];
  s.window.RufflePlayer = {
    newest: () => ({
      createPlayer: () => {
        const player = s.document.createElement("ruffle-player");
        player.load = () => {};
        player.metadata = { frameRate: 24 };
        players.push(player);
        return player;
      },
    }),
  };
  s.window.history.replaceState(null, "", "#big-truck-adventures");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await settle();
  const win = s.document.querySelector(
    '.xp-window[data-game="big-truck-adventures"]',
  );
  const player = players.at(-1);
  const tray = s.document.getElementById("tray-volume-slider");
  const slide = (value) => {
    tray.value = String(value);
    tray.dispatchEvent(new s.window.Event("input", { bubbles: true }));
  };
  slide(50);
  const volume = player.volume;
  expect(volume > 0).toBeTrue();

  s.document.getElementById("desktop-icons").focus();
  await settle();
  expect(win.classList.contains("active")).toBeFalse();
  slide(50);
  expect(player.volume).toBe(volume);

  // A minimized window is silent at once, with no other change of volume.
  win.querySelector(".minimize-btn").click();
  await settle();
  expect(player.volume).toBe(0);
});

test("a window that takes the keys becomes the active window, with no press", async () => {
  const s = await login(await loadShell());
  const docs = await openDocuments(s);
  clickStartAction(s, "pictures");
  await settle();
  const pictures = s.document.querySelector(
    '.xp-window[data-game="__my-pictures"]',
  );
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 800, configurable: true },
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  const isActive = (win) =>
    win.classList.contains("active") &&
    s.document
      .querySelector(`.task-button[data-game="${win.dataset.game}"]`)
      .classList.contains("active") &&
    [...s.document.querySelectorAll(".xp-window[data-game]")].every(
      (other) => other === win || +other.style.zIndex < +win.style.zIndex,
    );
  expect(isActive(pictures)).toBeTrue();

  // From the desktop, like Tab or a script.
  s.document.getElementById("desktop-icons").focus();
  await settle();
  expect(isActive(pictures)).toBeFalse();
  const items = docs.querySelector(".explorer-items");
  items.focus();
  await settle();
  expect(isActive(docs)).toBeTrue();
  expect(isActive(pictures)).toBeFalse();
  // The keys stay where they went.
  expect(s.document.activeElement === items).toBeTrue();
  expect(s.document.title).toContain("My Documents");

  // From another window too.
  pictures.querySelector(".explorer-items").focus();
  await settle();
  expect(isActive(pictures)).toBeTrue();

  // A minimized window takes no keys in Chrome, so it does not become active.
  docs.querySelector(".minimize-btn").click();
  await settle();
  items.focus();
  await settle();
  expect(docs.classList.contains("active")).toBeFalse();
});

test("the Open dialog's list keeps the keys when it is drawn again", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  const fs = s.window.VirtualFS;
  const full = fs.createFolder(fs.MY_DOCUMENTS, "Full");
  fs.createFile(full.id, "a.txt", { content: "" });
  fs.createFile(full.id, "b.txt", { content: "" });
  fs.createFolder(fs.MY_DOCUMENTS, "Empty");
  const open = s.window.XPDialogs.openFile({ startFolder: fs.MY_DOCUMENTS });
  await settle();
  const dialog = s.document.querySelector(".xp-dialog");
  const list = dialog.querySelector(".dlg-file-list");
  const item = (name) =>
    [...list.querySelectorAll(".dlg-file-item")].find(
      (row) => row.textContent.trim() === name,
    );
  const enter = (name) => {
    item(name).focus();
    item(name).dispatchEvent(
      new s.window.MouseEvent("dblclick", { bubbles: true }),
    );
  };
  const tool = (action) =>
    dialog.querySelector(`.dlg-file-tool[data-action="${action}"]`);

  // A double-click on a folder: its first item gets the keys.
  enter("Full");
  await settle();
  expect(active() === item("a.txt")).toBeTrue();

  // The same item keeps them when the list changes in place.
  item("b.txt").focus();
  const type = dialog.querySelector(".dlg-file-type");
  type.dispatchEvent(new s.window.Event("change", { bubbles: true }));
  expect(active() === item("b.txt")).toBeTrue();

  // Back turns gray with the keys: the list gets them.
  tool("back").focus();
  tool("back").click();
  await settle();
  expect(tool("back").disabled).toBeTrue();
  expect(active() === item("Empty")).toBeTrue();

  // An empty folder's list itself takes them.
  enter("Empty");
  await settle();
  expect(active() === list).toBeTrue();

  // Up One Level keeps them while it works, and gives them to the list when
  // it turns gray.
  tool("up").focus();
  tool("up").click();
  await settle();
  expect(active() === tool("up")).toBeTrue();
  while (!tool("up").disabled) tool("up").click();
  await settle();
  expect(list.contains(active())).toBeTrue();
  expect(active() === list).toBeFalse();

  dialog
    .querySelector('.dlg-buttons [data-action="cancel"]')
    .dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  expect(await open).toBeNull();
});

test("the Date and Time calendar keeps the keys on its day", async () => {
  const s = await login(await loadShell());
  s.document
    .getElementById("taskbar-clock")
    .dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  await settle();
  const dialog = s.document.querySelector(".datetime-dialog");
  const day = (text) =>
    [...dialog.querySelectorAll(".dlg-calendar-day")].find(
      (button) => button.textContent === text,
    );
  day("12").focus();
  day("12").click();
  expect(s.document.activeElement === day("12")).toBeTrue();
  expect(day("12").classList.contains("selected")).toBeTrue();
});

// Chrome gives no keys to a control that is hidden. Happy DOM does, so the
// test makes it act like Chrome. Happy DOM shares its element classes with
// later tests, so the change ends with the test.
const restoreFocus = [];
afterEach(() => restoreFocus.splice(0).forEach((restore) => restore()));
const hiddenTakesNoKeys = (s) => {
  const prototype = s.window.HTMLElement.prototype;
  const focus = prototype.focus;
  prototype.focus = function (options) {
    if (this.closest('[hidden], [style*="display: none"]')) return;
    focus.call(this, options);
  };
  restoreFocus.push(() => (prototype.focus = focus));
};

test("Alt+Enter shows Properties, never opens the item, and commits a rename box", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const active = () => s.document.activeElement;
  const dialogTitle = () =>
    s.document.querySelector(".xp-dialog")?.getAttribute("aria-label");
  const closeDialog = async () => {
    key(s, active(), "Escape");
    await settle();
  };
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Alpha");
  const win = await openDocuments(s);
  const title = () => win.querySelector(".title-text").textContent;
  const item = () =>
    win.querySelector(`.explorer-item[data-node-id="${folder.id}"]`);

  // On a selected item, Properties shows, and the folder stays shut.
  item().click();
  item().focus();
  key(s, item(), "Enter", { altKey: true });
  await settle();
  expect(dialogTitle()).toBe("Alpha Properties");
  expect(title()).toBe("My Documents");
  await closeDialog();

  // In a rename box, Alt+Enter commits the name like Enter.
  item().dispatchEvent(
    new s.window.MouseEvent("contextmenu", { bubbles: true }),
  );
  win.querySelector('.explorer-context-menu [data-command="rename"]').click();
  await settle();
  const input = win.querySelector(".explorer-rename");
  input.value = "Beta";
  key(s, input, "Enter", { altKey: true });
  await settle();
  expect(fs.getNode(folder.id).name).toBe("Beta");
  expect(title()).toBe("My Documents");
  expect(dialogTitle()).toBeUndefined();

  // On the desktop: a file, the Recycle Bin, My Computer and the desktop.
  const note = fs.createFile(fs.DESKTOP, "note.txt", { content: "" });
  await settle();
  const press = async (target) => {
    target.focus();
    key(s, target, "Enter", { altKey: true });
    await settle();
  };
  desktopIcon(s, note.id).click();
  await press(desktopIcon(s, note.id));
  expect(dialogTitle()).toBe("note.txt Properties");
  expect(s.document.querySelector('.xp-window[data-game="__notepad"]')).toBe(
    null,
  );
  await closeDialog();
  desktopIcon(s, "__recycle-bin").click();
  await press(desktopIcon(s, "__recycle-bin"));
  expect(dialogTitle()).toBe("Recycle Bin Properties");
  await closeDialog();
  desktopIcon(s, "__my-computer").click();
  await press(desktopIcon(s, "__my-computer"));
  expect(dialogTitle()).toBe("My Computer Properties");
  await closeDialog();
  // Two selected files have no single Properties.
  const other = fs.createFile(fs.DESKTOP, "other.txt", { content: "" });
  await settle();
  desktopIcon(s, note.id).classList.add("selected");
  desktopIcon(s, other.id).classList.add("selected");
  await press(desktopIcon(s, other.id));
  expect(dialogTitle()).toBeUndefined();
  // The selection counts, also when the desktop itself has the keys, as
  // after a drag around the icons.
  const desktop = s.document.getElementById("desktop-icons");
  const display = () =>
    s.document.querySelector('.xp-window[data-game="__display-properties"]');
  await press(desktop);
  expect(dialogTitle()).toBeUndefined();
  expect(display() === null).toBeTrue();
  desktopIcon(s, note.id).classList.remove("selected");
  await press(desktop);
  expect(dialogTitle()).toBe("other.txt Properties");
  await closeDialog();
  // My Documents has no Properties on the desktop, as in its menu.
  desktopIcon(s, other.id).classList.remove("selected");
  desktopIcon(s, "__my-documents").classList.add("selected");
  await press(desktop);
  expect(dialogTitle()).toBeUndefined();
  expect(display() === null).toBeTrue();
  // With no icon selected, the display's Properties show.
  desktopIcon(s, "__my-documents").classList.remove("selected");
  await press(desktop);
  expect(display() === null).toBeFalse();
});

test("a fallback for the keys never takes the active state from a window that is about to show", async () => {
  const s = await login(await loadShell({ windowAnimations: true }));
  hiddenTakesNoKeys(s);
  const win = await openDocuments(s);
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 800, configurable: true },
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  win.querySelector(".minimize-btn").click();
  await s.advanceTime(1000);
  expect(win.style.display).toBe("none");

  // The task button restores the window. While its caption slides, the
  // keys leave the taskbar to nothing, as when a menu closes.
  const start = s.document.getElementById("start-button");
  start.focus();
  s.document.querySelector('.task-button[data-game="__my-documents"]').click();
  expect(win.style.display).toBe("none");
  loseKeys(s, start);
  await settle();
  expect(win.classList.contains("active")).toBeTrue();

  // The window takes the keys when it shows.
  await s.advanceTime(1000);
  expect(win.style.display).toBe("flex");
  expect(win.classList.contains("active")).toBeTrue();
  expect(win.contains(s.document.activeElement)).toBeTrue();
});

test("a press into a game's frame makes its window active", async () => {
  const s = await login(await loadShell());
  const docs = await openDocuments(s);
  clickStartAction(s, "pictures");
  await settle();
  const pictures = s.document.querySelector(
    '.xp-window[data-game="__my-pictures"]',
  );
  expect(pictures.classList.contains("active")).toBeTrue();
  const frame = s.document.createElement("iframe");
  docs.querySelector(".explorer-items").append(frame);

  // The page sees only its own blur, with the frame as the active element.
  const pressFrame = async () => {
    Object.defineProperty(s.document, "activeElement", {
      get: () => frame,
      configurable: true,
    });
    s.window.dispatchEvent(new s.window.Event("blur"));
    delete s.document.activeElement;
    await settle();
  };
  await pressFrame();
  expect(docs.classList.contains("active")).toBeTrue();
  expect(pictures.classList.contains("active")).toBeFalse();

  // The same after the desktop took the keys.
  s.document.getElementById("desktop-icons").focus();
  await settle();
  expect(docs.classList.contains("active")).toBeFalse();
  await pressFrame();
  expect(docs.classList.contains("active")).toBeTrue();
});
