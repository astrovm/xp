// @ts-nocheck -- The XP menu bar rules, checked the same way in every program.
import { expect } from "bun:test";

// Happy DOM never moves the keys on a click, so each check focuses what
// Chrome would focus. Results are booleans and labels, so a failure never
// prints the whole page.
export const checkMenuBar = async ({ s, win, control, accessKey, settle }) => {
  const bar = win.querySelector('[role="menubar"]');
  const titles = [...bar.querySelectorAll('[role="menuitem"]')].filter(
    (title) => !title.closest('[role="menu"]'),
  );
  const [title] = titles;
  // The checks below move to the next title only when it opens a menu.
  const nextTitle = titles[1]?.hasAttribute("aria-haspopup") ? titles[1] : null;
  const openMenu = () =>
    [...bar.querySelectorAll('[role="menu"]')].find(
      (menu) => !menu.hidden && !menu.parentElement.closest('[role="menu"]'),
    ) || null;
  const items = () =>
    [...openMenu().children].filter(
      (item) => item.matches('[role^="menuitem"]') && !item.disabled,
    );
  const active = () => s.document.activeElement;
  const label = (element) => element?.textContent.trim() ?? null;
  const keysOn = (element) => active() === element;
  const key = async (target, name, init = {}) => {
    const event = new s.window.KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    await settle();
    return event;
  };
  const press = async (target) => {
    target.dispatchEvent(
      new s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
    await settle();
  };
  const openByKey = async () => {
    control.focus();
    await key(control, accessKey, { altKey: true });
  };
  const clickTitle = async (entry = title) => {
    entry.focus();
    entry.click();
    await settle();
  };
  // Every close leaves the menus shut, the titles reset and the keys on the
  // program.
  const expectClosed = (keysBack = true) => {
    expect(openMenu() === null).toBeTrue();
    expect(
      titles.some((entry) => entry.getAttribute("aria-expanded") === "true"),
    ).toBeFalse();
    if (keysBack) expect(keysOn(control)).toBeTrue();
  };

  // 2. Alt and the access key open the menu, with the keys on its first item.
  expect(label(title.querySelector(".menu-accesskey")).toLowerCase()).toBe(
    accessKey,
  );
  await openByKey();
  expect(title.getAttribute("aria-expanded")).toBe("true");
  const [first, second] = items();
  expect(keysOn(first)).toBeTrue();

  // 3. Up and Down move through the enabled items and wrap. Home and End
  // go to the ends.
  await key(first, "ArrowUp");
  expect(keysOn(items().at(-1))).toBeTrue();
  await key(active(), "ArrowDown");
  expect(keysOn(first)).toBeTrue();
  if (second) {
    await key(first, "ArrowDown");
    expect(keysOn(second)).toBeTrue();
  }
  await key(active(), "End");
  expect(keysOn(items().at(-1))).toBeTrue();
  await key(active(), "Home");
  expect(keysOn(first)).toBeTrue();

  // 6. Tab stays in the menu. Other keys never reach the program.
  expect((await key(first, "Tab")).defaultPrevented).toBeTrue();
  let reached = 0;
  const count = () => (reached += 1);
  win.addEventListener("keydown", count);
  await key(first, "F2");
  await key(first, "1");
  win.removeEventListener("keydown", count);
  expect(reached).toBe(0);
  expect(keysOn(first)).toBeTrue();

  // 3. Right and Left move to the next menu, open.
  if (nextTitle) {
    await key(first, "ArrowRight");
    expect(nextTitle.getAttribute("aria-expanded")).toBe("true");
    expect(title.getAttribute("aria-expanded")).toBe("false");
    expect(keysOn(items()[0])).toBeTrue();
    await key(active(), "ArrowLeft");
    expect(title.getAttribute("aria-expanded")).toBe("true");
    expect(keysOn(items()[0])).toBeTrue();
  }

  // 5. Escape gives the keys to the title, then closes the menu. A second
  // Escape gives them back to the program.
  await key(active(), "Escape");
  expectClosed(false);
  expect(keysOn(title)).toBeTrue();
  await key(title, "Escape");
  expect(keysOn(control)).toBeTrue();

  // 1. A click opens the menu and a second one closes it.
  await clickTitle();
  expect(title.getAttribute("aria-expanded")).toBe("true");
  expect(keysOn(title)).toBeTrue();
  // 11. The pointer moves the keys to the item under it.
  const hovered = items().at(-1);
  hovered.dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(keysOn(hovered)).toBeTrue();
  // The pointer on a title, a separator or the menu itself moves nothing.
  for (const target of [title, openMenu()]) {
    target.dispatchEvent(
      new s.window.PointerEvent("pointerover", { bubbles: true }),
    );
    expect(keysOn(hovered)).toBeTrue();
  }
  // Keys on the menu itself, not on an item, stay there.
  await key(openMenu(), "ArrowDown");
  title.focus();
  title.click();
  await settle();
  expectClosed();
  // A menu that the keys left keeps them where they are.
  await clickTitle();
  control.focus();
  items()[0].dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(keysOn(control)).toBeTrue();
  await clickTitle();
  expectClosed();
  // 5. Escape on the title of a clicked menu closes it and keeps the title.
  await clickTitle();
  await key(title, "Escape");
  expectClosed(false);
  expect(keysOn(title)).toBeTrue();

  // 3. Down, Enter or Space on a title opens its menu; Right and Left on a
  // title with a menu open move to the next one, open.
  for (const name of ["ArrowDown", "Enter", " "]) {
    title.focus();
    await key(title, name);
    expect(keysOn(items()[0])).toBeTrue();
    await key(active(), "Escape");
  }
  // Other keys on a title do nothing, and keys with the Windows key or Ctrl
  // stay with the shell.
  await key(title, "x");
  await key(title, "ArrowDown", { metaKey: true });
  await key(title, "ArrowDown", { ctrlKey: true });
  expect(openMenu() === null).toBeTrue();
  expect(keysOn(title)).toBeTrue();
  if (nextTitle) {
    await clickTitle();
    await key(title, "ArrowRight");
    expect(keysOn(items()[0])).toBeTrue();
    expect(nextTitle.getAttribute("aria-expanded")).toBe("true");
    await key(active(), "Escape");
    // Without an open menu the keys only move.
    await key(nextTitle, "ArrowLeft");
    expect(keysOn(title)).toBeTrue();
    expect(openMenu() === null).toBeTrue();
  }
  await key(title, "Escape");
  expect(keysOn(control)).toBeTrue();

  // 8. A press outside the menus closes them: on the page, on the window's
  // title bar and in the program. The keys come back first.
  for (const target of [
    s.document.body,
    win.querySelector(".title-bar") || s.document.body,
    control,
  ]) {
    await openByKey();
    await press(target);
    expectClosed();
  }
  // A press on a title or in the open menu keeps the menus to the window.
  await clickTitle();
  await press(title);
  await press(items()[0]);
  expect(openMenu() === null).toBeFalse();
  if (nextTitle) {
    await clickTitle(nextTitle);
    expect(nextTitle.getAttribute("aria-expanded")).toBe("true");
    expect(title.getAttribute("aria-expanded")).toBe("false");
  }
  await press(s.document.body);
  expectClosed();

  // 9. The page losing the keys closes the menus, and the keys go back.
  await openByKey();
  s.window.dispatchEvent(new s.window.Event("blur"));
  await settle();
  expectClosed();

  // 10. Keys that move to another window close the menus where they went.
  await openByKey();
  const elsewhere = s.document.getElementById("start-button");
  active().dispatchEvent(
    new s.window.FocusEvent("focusout", {
      bubbles: true,
      relatedTarget: elsewhere,
    }),
  );
  await settle();
  expectClosed(false);
  // Keys that stay in the window keep the menus.
  await openByKey();
  active().dispatchEvent(
    new s.window.FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
  );
  expect(openMenu() === null).toBeFalse();
  await key(active(), "Escape");
  await key(title, "Escape");
  expect(keysOn(control)).toBeTrue();
};
