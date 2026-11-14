// @ts-nocheck -- Where the keys go on presses and closes in the shell's own surfaces.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  clickStartAction,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { pointerAt } from "./helpers/hit-test";

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
// Chrome moves the keys on a mousedown that is not canceled. Happy DOM does
// not, so the checks read whether the shell canceled it.
const mousedownKeepsKeys = (s, target) => {
  const event = new s.window.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};
const desktopMenu = (s) => {
  s.document.getElementById("desktop-icons").dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    }),
  );
  return s.document.getElementById("desktop-context-menu");
};

test("the empty taskbar takes the keys, outside the Tab order, like XP", async () => {
  const s = await login(await loadShell());
  const taskbar = s.document.getElementById("taskbar");
  // tabindex -1: a press gives it the keys, and Tab never stops on it.
  expect(taskbar.getAttribute("tabindex")).toBe("-1");
  taskbar.focus();
  expect(s.document.activeElement === taskbar).toBeTrue();
  // Its buttons keep their own keys and their place in the Tab order.
  const start = s.document.getElementById("start-button");
  expect(start.tabIndex).toBe(0);
  expect(mousedownKeepsKeys(s, taskbar)).toBeFalse();
});

test("a press on a shell popup's empty part keeps the keys where they are", async () => {
  const s = await login(await loadShell());
  const icons = s.document.getElementById("desktop-icons");
  icons.focus();
  const menu = desktopMenu(s);
  await settle();
  const first = menu.querySelector("button:not(:disabled)");
  expect(s.document.activeElement === first).toBeTrue();
  // The menu itself, a separator and a label are not controls.
  expect(mousedownKeepsKeys(s, menu)).toBeTrue();
  expect(
    mousedownKeepsKeys(s, menu.querySelector(".context-separator")),
  ).toBeTrue();
  expect(mousedownKeepsKeys(s, first.querySelector(".context-label"))).toBe(
    false,
  );
  // A gray item is no control either.
  const gray = menu.querySelector("button:disabled");
  expect(mousedownKeepsKeys(s, gray)).toBeTrue();
  key(s, first, "Escape");
  await settle();

  // The Start menu's banner and its All Programs flyouts.
  s.document.getElementById("start-button").click();
  await settle();
  expect(
    mousedownKeepsKeys(s, s.document.querySelector(".start-menu-header")),
  ).toBeTrue();
  expect(
    mousedownKeepsKeys(s, s.document.getElementById("all-programs-button")),
  ).toBeFalse();
  s.document.getElementById("all-programs-button").click();
  await settle();
  expect(
    mousedownKeepsKeys(s, s.document.querySelector(".start-program-flyout")),
  ).toBeTrue();
  key(s, s.document.body, "Escape");
  await settle();

  // The volume popup's caption.
  s.document.getElementById("tray-volume-button").click();
  await settle();
  const popup = s.document.getElementById("tray-volume-popup");
  expect(mousedownKeepsKeys(s, popup.querySelector("span"))).toBeTrue();
  expect(
    mousedownKeepsKeys(s, popup.querySelector(".tray-mute-row")),
  ).toBeFalse();
  // A press outside every popup is left to the browser.
  expect(mousedownKeepsKeys(s, icons)).toBeFalse();
});

test("shell popups give the keys back when they close, never to the page", async () => {
  const s = await login(await loadShell());
  const icons = s.document.getElementById("desktop-icons");
  const active = () => s.document.activeElement;

  // A desktop menu command gives the keys back to the desktop.
  icons.focus();
  desktopMenu(s);
  await settle();
  s.document
    .querySelector('#desktop-context-menu [data-action="refresh"]')
    .click();
  await settle();
  expect(active() === icons).toBeTrue();

  // The volume popup gives them back when its button closes it.
  icons.focus();
  const volume = s.document.getElementById("tray-volume-button");
  volume.click();
  await settle();
  expect(active().id).toBe("tray-volume-slider");
  volume.click();
  await settle();
  expect(active() === icons).toBeTrue();
  // Escape on its slider closes it too. Other keys stay with the slider.
  const popup = s.document.getElementById("tray-volume-popup");
  volume.click();
  await settle();
  key(s, active(), "ArrowUp");
  expect(popup.hidden).toBeFalse();
  key(s, active(), "Escape");
  await settle();
  expect(popup.hidden).toBeTrue();
  expect(active() === icons).toBeTrue();

  // Escape in the Start menu, or in its flyouts, gives them to Start.
  const start = s.document.getElementById("start-button");
  start.click();
  await settle();
  const allPrograms = s.document.getElementById("all-programs-button");
  allPrograms.focus();
  key(s, allPrograms, "ArrowRight");
  await settle();
  expect(
    s.document.getElementById("start-menu-flyouts").contains(active()),
  ).toBeTrue();
  key(s, active(), "Escape", { bubbles: true });
  key(s, s.document.body, "Escape");
  await settle();
  expect(s.document.getElementById("start-menu").hidden).toBeTrue();
  expect(active() === start).toBeTrue();

  // A taskbar menu command gives them back to the window that had them.
  const fs = s.window.VirtualFS;
  fs.open(fs.MY_DOCUMENTS);
  await settle();
  const win = s.document.querySelector(".xp-window.active");
  const items = win.querySelector(".explorer-items");
  items.focus();
  s.document.getElementById("task-buttons").dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 590,
    }),
  );
  await settle();
  const taskbarMenu = s.document.getElementById("taskbar-context-menu");
  expect(taskbarMenu.contains(active())).toBeTrue();
  taskbarMenu.querySelector('[data-taskbar-action="lock"]').click();
  await settle();
  expect(active() === items).toBeTrue();

  // The window menu gives them back to the window's control.
  key(s, items, " ", { altKey: true, code: "Space" });
  await settle();
  const systemMenu = s.document.getElementById("window-system-menu");
  expect(systemMenu.contains(active())).toBeTrue();
  key(s, active(), "Escape");
  await settle();
  expect(systemMenu.hidden).toBeTrue();
  expect(active() === items).toBeTrue();
});

test("keys that came from nowhere, or from a control that is gone, go to the active window or the desktop", async () => {
  const s = await login(await loadShell());
  const icons = s.document.getElementById("desktop-icons");
  const active = () => s.document.activeElement;

  // No control had the keys: the desktop gets them.
  active().blur?.();
  const menu = desktopMenu(s);
  await settle();
  expect(menu.contains(active())).toBeTrue();
  menu.querySelector('[data-action="refresh"]').click();
  await settle();
  expect(active() === icons).toBeTrue();

  // The control that had them is gone: the active window gets them.
  const fs = s.window.VirtualFS;
  fs.open(fs.MY_DOCUMENTS);
  await settle();
  const win = s.document.querySelector(".xp-window.active");
  const gone = s.document.createElement("button");
  win.append(gone);
  gone.focus();
  desktopMenu(s);
  await settle();
  gone.remove();
  menu.querySelector('[data-action="refresh"]').click();
  await settle();
  // The frame passes them on to the window's own control.
  expect(win.contains(active())).toBeTrue();
  expect(menu.contains(active())).toBeFalse();

  // A control in a hidden part does not get them either.
  const panel = s.document.createElement("div");
  const hiddenControl = s.document.createElement("button");
  panel.append(hiddenControl);
  win.append(panel);
  hiddenControl.focus();
  desktopMenu(s);
  await settle();
  panel.hidden = true;
  menu.querySelector('[data-action="refresh"]').click();
  await settle();
  // The frame passes them on to the window's own control.
  expect(win.contains(active())).toBeTrue();
  expect(menu.contains(active())).toBeFalse();
});

test("a gray item takes the hover, and a press on it keeps the keys", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  s.document.getElementById("desktop-icons").focus();
  const menu = desktopMenu(s);
  await settle();
  const first = active();
  expect(menu.contains(first)).toBeTrue();
  // Chrome sends the pointer to the gray item itself, so a program can
  // follow the hover.
  const gray = menu.querySelector("button:disabled");
  expect(pointerAt(s, gray, "pointerover") === gray).toBeTrue();
  // Chrome sends no mousedown for it, but the press still takes the keys
  // to the page. They come back after the press.
  expect(pointerAt(s, gray, "pointerdown") === gray).toBeTrue();
  first.blur();
  await new Promise((resolve) => setTimeout(resolve));
  expect(active() === first).toBeTrue();
  expect(menu.hidden).toBeFalse();
  // Keys that cannot go back, like on a control that a style hides, go to
  // the desktop when no window is open.
  const focus = first.focus;
  first.focus = () => {};
  pointerAt(s, gray, "pointerdown");
  first.blur();
  await new Promise((resolve) => setTimeout(resolve));
  expect(active() === s.document.getElementById("desktop-icons")).toBeTrue();
  first.focus = focus;
  first.focus();
  // A press on an enabled item is left to the item, so the keys do not
  // come back to it.
  pointerAt(s, first, "pointerdown");
  first.blur();
  await new Promise((resolve) => setTimeout(resolve));
  expect(active() === first).toBeFalse();
});

test("a submenu that the pointer closes gives the keys to its item", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  const pointer = (target, type) =>
    target.dispatchEvent(new s.window.PointerEvent(type, { bubbles: false }));

  // The desktop's Arrange Icons By.
  s.document.getElementById("desktop-icons").focus();
  const menu = desktopMenu(s);
  await settle();
  const arrange = menu.querySelector(".context-submenu-button");
  arrange.focus();
  key(s, arrange, "ArrowRight");
  await settle();
  const arrangeMenu = arrange.nextElementSibling;
  expect(arrangeMenu.contains(active())).toBeTrue();
  pointer(arrange.parentElement, "pointerleave");
  expect(active() === arrange).toBeTrue();
  key(s, arrange, "Escape");
  await settle();

  // The taskbar's Toolbars.
  s.document.getElementById("task-buttons").dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 590,
    }),
  );
  await settle();
  const toolbars = s.document.getElementById("taskbar-toolbar-parent");
  const toolbarsButton = toolbars.firstElementChild;
  toolbarsButton.focus();
  key(s, toolbarsButton, "ArrowRight");
  const toolbarsMenu = s.document.getElementById("taskbar-toolbar-submenu");
  expect(toolbarsMenu.contains(active())).toBeTrue();
  pointer(toolbars, "pointerleave");
  expect(active() === toolbarsButton).toBeTrue();
});

test("keys on a control that a command removes go to the active window", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  clickStartAction(s, "documents");
  await settle();
  clickStartAction(s, "pictures");
  await settle();
  const docs = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  const pictures = s.document.querySelector(
    '.xp-window[data-game="__my-pictures"]',
  );
  expect(pictures.classList.contains("active")).toBeTrue();
  // A task button only shows when the taskbar has room for it.
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 800, configurable: true },
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();

  // In Chrome a right press on a taskbar button gives it the keys. Close
  // on its window menu removes the button, after the menu gives the keys
  // back to it.
  const button = s.document.querySelector(
    '.task-button[data-game="__my-documents"]',
  );
  button.focus();
  button.dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 590,
    }),
  );
  await settle();
  const systemMenu = s.document.getElementById("window-system-menu");
  expect(systemMenu.contains(active())).toBeTrue();
  systemMenu.querySelector('[data-command="close"]').click();
  await settle();
  expect(docs.isConnected).toBeFalse();
  expect(button.isConnected).toBeFalse();
  expect(pictures.contains(active())).toBeTrue();
});

test("a popup skips a control that does not take the keys back", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  const fs = s.window.VirtualFS;
  fs.open(fs.MY_DOCUMENTS);
  await settle();
  const win = s.document.querySelector(".xp-window.active");
  const items = win.querySelector(".explorer-items");
  items.focus();
  const menu = desktopMenu(s);
  await settle();
  expect(menu.contains(active())).toBeTrue();
  // Chrome skips focus() on a control that a style hides, such as one in a
  // minimized window.
  items.focus = () => {};
  menu.querySelector('[data-action="refresh"]').click();
  await settle();
  expect(menu.hidden).toBeTrue();
  expect(menu.contains(active())).toBeFalse();
  expect(active() === s.document.body).toBeFalse();

  // A window that a style hides takes no keys at all, so the desktop gets
  // them.
  for (const element of [win, ...win.querySelectorAll("*")])
    element.focus = () => {};
  menu.querySelector('[data-action="refresh"]').focus();
  desktopMenu(s);
  await settle();
  expect(menu.contains(active())).toBeTrue();
  menu.querySelector('[data-action="refresh"]').click();
  await settle();
  expect(active() === s.document.getElementById("desktop-icons")).toBeTrue();
});

test("keys on a control that something hides go to the active window", async () => {
  const s = await login(await loadShell());
  const active = () => s.document.activeElement;
  const fs = s.window.VirtualFS;
  fs.open(fs.MY_DOCUMENTS);
  await settle();
  const win = s.document.querySelector(".xp-window.active");
  const control = s.document.createElement("button");
  win.querySelector(".explorer-items").append(control);
  control.focus();
  // Chrome blurs a control that a class or a style hides, with no new
  // owner for the keys. Happy DOM does not, so the test does it.
  control.style.display = "none";
  control.blur();
  control.dispatchEvent(
    new s.window.FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
  );
  expect(active() === s.document.body).toBeTrue();
  await settle();
  expect(active() === s.document.body).toBeFalse();
  expect(win.contains(active())).toBeTrue();

  // A move to another control, or keys that something else takes, stay.
  const other = s.document.getElementById("start-button");
  other.focus();
  other.dispatchEvent(
    new s.window.FocusEvent("focusout", {
      bubbles: true,
      relatedTarget: win,
    }),
  );
  await settle();
  expect(active() === other).toBeTrue();
  other.blur();
  other.dispatchEvent(
    new s.window.FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
  );
  other.focus();
  await settle();
  expect(active() === other).toBeTrue();
});
