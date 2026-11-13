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
  // A click on a window's title bar makes it the active window.
  const activate = (win) => {
    press(win.querySelector(".title-text"), "pointerdown");
    press(win.querySelector(".title-text"), "pointerup");
  };
  return { s, docs, pictures, focused, press, activate };
}

test("a press on a part that XP never focuses keeps the keys on the window's control", async () => {
  const { s, docs, focused, press, activate } = await twoWindows();
  activate(docs);
  expect(focused()).toBe("explorer-items");

  // A title-bar button or a toolbar button takes no focus from the mouse.
  for (const button of [
    docs.querySelector(".minimize-btn"),
    docs.querySelector('[data-explorer-action="search"]'),
  ]) {
    press(button, "pointerdown");
    button.focus();
    press(button, "pointerup");
    expect(focused()).toBe("explorer-items");
  }

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
