// @ts-nocheck -- XP gives the keys to the active window's control.
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

// Two Explorer windows: My Documents, then My Pictures on top.
async function twoWindows() {
  const s = await login(await loadShell());
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
  // A short name for the focused element, so a failed check prints no DOM.
  const focused = () => {
    const active = s.document.activeElement;
    return (
      active.dataset?.explorerAction ||
      active.dataset?.game ||
      active.className ||
      active.tagName
    );
  };
  const press = (target, type) =>
    target.dispatchEvent(new s.window.PointerEvent(type, { bubbles: true }));
  // A press ends with its click.
  const release = (target) =>
    target.dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  // A click on a window's title bar makes it the active window.
  const activate = (win) => {
    press(win.querySelector(".title-text"), "pointerdown");
    release(win.querySelector(".title-text"));
  };
  const key = (target, key) =>
    target.dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  return { s, docs, pictures, focused, press, release, activate, key };
}

test("a press on a part that XP never focuses keeps the keys on the window's control", async () => {
  const { s, docs, pictures, focused, press, release, activate, key } =
    await twoWindows();
  activate(docs);
  expect(focused()).toBe("explorer-items");

  // A title-bar button or a toolbar button takes no focus from the mouse.
  for (const button of [
    docs.querySelector(".minimize-btn"),
    docs.querySelector('[data-explorer-action="search"]'),
  ]) {
    press(button, "pointerdown");
    // A touch tap moves the focus after its pointerup.
    press(button, "pointerup");
    button.focus();
    release(docs);
    expect(focused()).toBe("explorer-items");
  }
  // A menu command gives the focus back to the list, not to the button.
  docs.querySelector('[data-explorer-menu="edit"]').click();
  // Chrome focuses the menu item that the click presses.
  const selectAll = docs.querySelector('[data-explorer-command="select-all"]');
  selectAll.focus();
  selectAll.click();
  await settle();
  expect(focused()).toBe("explorer-items");

  // A press on Views leaves the keys on the list. Escape closes the menu,
  // and an arrow key moves into it, like XP.
  const views = docs.querySelector('[data-explorer-action="view"]');
  const menu = docs.querySelector(".explorer-menu");
  const list = docs.querySelector(".explorer-items");
  const openViews = () => {
    press(views, "pointerdown");
    views.focus();
    views.click();
  };
  openViews();
  expect(focused()).toBe("explorer-items");
  expect(menu.hidden).toBeFalse();
  key(list, "Escape");
  expect(menu.hidden).toBeTrue();
  expect(focused()).toBe("explorer-items");
  for (const [arrow, index] of [
    ["ArrowDown", 0],
    ["ArrowUp", -1],
  ]) {
    openViews();
    key(list, arrow);
    const commands = [...menu.querySelectorAll("button:not(:disabled)")];
    expect(commands.indexOf(s.document.activeElement)).toBe(
      (index + commands.length) % commands.length,
    );
    // Escape gives the keys back to the list, not to the Views button.
    key(s.document.activeElement, "Escape");
    expect(menu.hidden).toBeTrue();
    expect(focused()).toBe("explorer-items");
  }
  // Other keys on the list leave the menu alone, also Escape with Ctrl,
  // Alt or the Windows key, which go to the shell.
  openViews();
  key(list, "Home");
  const escape = (options) => {
    const event = new s.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      ...options,
    });
    list.dispatchEvent(event);
    return event;
  };
  expect(escape({ metaKey: true }).defaultPrevented).toBeFalse();
  expect(menu.hidden).toBeFalse();
  // Ctrl+Esc reaches the shell, which opens the Start menu. The Start menu
  // takes the keys, so Views closes, like XP.
  escape({ ctrlKey: true });
  const startMenu = s.document.getElementById("start-menu");
  expect(startMenu.hidden).toBeFalse();
  expect(docs.contains(s.document.activeElement)).toBeFalse();
  expect(menu.hidden).toBeTrue();
  escape({ ctrlKey: true });
  activate(docs);
  openViews();
  // A context menu keeps its arrow keys while Views is open.
  const item = docs.querySelector(".explorer-item");
  item.focus();
  item.dispatchEvent(new s.window.MouseEvent("contextmenu", { bubbles: true }));
  const context = docs.querySelector(".explorer-context-menu");
  key(s.document.activeElement, "ArrowDown");
  expect(context.contains(s.document.activeElement)).toBeTrue();
  key(s.document.activeElement, "Escape");
  list.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Escape",
      shiftKey: true,
      bubbles: true,
    }),
  );
  expect(menu.hidden).toBeTrue();

  // A menu closed by a press outside it leaves no state behind: Escape on
  // a heading that the mouse opened keeps the heading.
  openViews();
  key(list, "ArrowDown");
  press(list, "pointerdown");
  release(list);
  expect(menu.hidden).toBeTrue();
  const file = docs.querySelector('[data-explorer-menu="file"]');
  file.focus();
  file.click();
  key(s.document.activeElement, "Escape");
  expect(s.document.activeElement === file).toBeTrue();
  key(file, "Escape");

  // A press on Views while the keys are in the File menu gives them back
  // to the list, and Escape still closes Views.
  list.focus();
  list.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "f",
      altKey: true,
      bubbles: true,
    }),
  );
  const fileItem = s.document.activeElement;
  expect(menu.contains(fileItem)).toBeTrue();
  // In Chrome the window gives the keys back to the File item during the
  // press. Happy DOM skips a focus call inside focusin, so the test does it.
  press(views, "pointerdown");
  fileItem.focus();
  views.click();
  expect(focused()).toBe("explorer-items");
  expect(menu.hidden).toBeFalse();
  key(list, "Escape");
  expect(menu.hidden).toBeTrue();
  expect(focused()).toBe("explorer-items");

  // A title bar press, such as a drag, closes the File menu and gives the
  // keys back to the list.
  list.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "f",
      altKey: true,
      bubbles: true,
    }),
  );
  expect(menu.contains(s.document.activeElement)).toBeTrue();
  press(docs.querySelector(".title-text"), "pointerdown");
  expect(menu.hidden).toBeTrue();
  expect(focused()).toBe("explorer-items");
  release(docs.querySelector(".title-text"));

  // A task pane press gives the keys back to the address bar, the control
  // that had them before the menu.
  const fileHeading = docs.querySelector('[data-explorer-menu="file"]');
  docs.querySelector(".explorer-address input").focus();
  fileHeading.focus();
  key(fileHeading, "ArrowDown");
  expect(menu.contains(s.document.activeElement)).toBeTrue();
  press(docs.querySelector(".explorer-sidebar section"), "pointerdown");
  expect(menu.hidden).toBeTrue();
  expect(
    s.document.activeElement === docs.querySelector(".explorer-address input"),
  ).toBeTrue();
  release(docs.querySelector(".explorer-sidebar section"));

  // A hover on a main menu item takes the keys out of a submenu before it
  // closes.
  const viewHeading = docs.querySelector('[data-explorer-menu="view"]');
  viewHeading.focus();
  key(viewHeading, "ArrowDown");
  const parentItem = menu.querySelector(".has-submenu");
  parentItem.focus();
  key(parentItem, "ArrowRight");
  const submenu = docs.querySelector(".explorer-submenu");
  expect(submenu.contains(s.document.activeElement)).toBeTrue();
  const plainItem = menu.querySelector(".game-menu-item:not(.has-submenu)");
  plainItem.dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(submenu.hidden).toBeTrue();
  expect(s.document.activeElement === plainItem).toBeTrue();
  key(plainItem, "Escape");
  key(viewHeading, "Escape");

  // A disabled item cannot take the keys, so a hover on it gives them to
  // the submenu's own item.
  list.focus();
  list.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "f",
      altKey: true,
      bubbles: true,
    }),
  );
  const folderItem = menu.querySelector(".has-submenu");
  folderItem.focus();
  key(folderItem, "ArrowRight");
  expect(submenu.contains(s.document.activeElement)).toBeTrue();
  const disabledItem = menu.querySelector(".game-menu-item:disabled");
  disabledItem.dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(submenu.hidden).toBeTrue();
  expect(s.document.activeElement === folderItem).toBeTrue();
  key(folderItem, "Escape");
  key(docs.querySelector('[data-explorer-menu="file"]'), "Escape");
  list.focus();

  // Views opened from the address bar gives the keys back to it.
  const address = docs.querySelector(".explorer-address input");
  address.focus();
  openViews();
  expect(s.document.activeElement === address).toBeTrue();
  key(address, "Escape");
  expect(menu.hidden).toBeTrue();
  expect(s.document.activeElement === address).toBeTrue();

  // The menu closes when another window takes the keys.
  list.focus();
  openViews();
  pictures.querySelector(".explorer-items").focus();
  expect(menu.hidden).toBeTrue();
  activate(docs);

  // A middle-press that ends on another element ends the press.
  s.document.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { button: 1, bubbles: true }),
  );
  s.document.dispatchEvent(
    new s.window.PointerEvent("pointerup", { button: 1, bubbles: true }),
  );
  docs.querySelector('[data-explorer-action="search"]').focus();
  expect(focused()).toBe("search");

  // The keyboard can still focus a toolbar button.
  const folders = docs.querySelector('[data-explorer-action="folders"]');
  folders.focus();
  expect(focused()).toBe("folders");
  // A press on the frame gives the keys back to that button.
  docs.focus();
  expect(focused()).toBe("folders");
  // A key ends a press whose pointerup the page never saw, such as one
  // that ended in a game's iframe.
  press(docs, "pointerdown");
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Tab" }),
  );
  docs.querySelector('[data-explorer-action="view"]').focus();
  expect(focused()).toBe("view");
});

test("an active window skips a control that cannot take the focus", async () => {
  const { docs, pictures, focused, activate } = await twoWindows();
  activate(docs);
  const folders = docs.querySelector('[data-explorer-action="folders"]');
  folders.focus();
  // The control that had the focus is now disabled.
  folders.disabled = true;
  activate(pictures);
  expect(pictures.contains(docs.ownerDocument.activeElement)).toBeTrue();
  activate(docs);
  expect(focused()).toBe("explorer-items");

  // Like Chrome, a CSS-hidden control does not take the focus. With no
  // control left, the frame gets the keys.
  activate(pictures);
  docs.querySelector(".explorer-items").focus = () => {};
  activate(docs);
  expect(focused()).toBe("__my-documents");
});

test("a window gives the keys back to the iframe that had them", async () => {
  const { s, docs, pictures, activate } = await twoWindows();
  activate(docs);
  const frame = s.document.createElement("iframe");
  docs.querySelector(".explorer-main").appendChild(frame);
  // A click into an iframe fires no focusin in the page. The page only
  // loses the focus.
  Object.defineProperty(s.document, "activeElement", {
    configurable: true,
    get: () => frame,
  });
  s.window.dispatchEvent(new s.window.Event("blur"));
  delete s.document.activeElement;
  // A blur away from anything else records nothing.
  s.window.dispatchEvent(new s.window.Event("blur"));
  activate(pictures);
  activate(docs);
  expect(s.document.activeElement === frame).toBeTrue();
});
