// @ts-nocheck -- Where the keys go on presses and closes in the shell's own surfaces.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
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
