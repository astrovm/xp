// @ts-nocheck -- Keyboard and pointer integration through the real shell handlers.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
  clickStartAction,
} from "./helpers/shell-harness";
import { pressAltGr } from "./helpers/keys";
afterEach(cleanupShells);
const key = (s, el, key, extra = {}) =>
  el.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...extra,
    }),
  );
const context = (s, el) =>
  el.dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 60,
    }),
  );
const answer = async (s, id = "yes") => {
  s.document.querySelector(`.xp-dialog [data-action="${id}"]`).click();
  await flushShell();
  await flushShell();
};
test("desktop system shortcuts rename, create links, open properties and hide My Computer", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const icon = (id) => s.document.querySelector(`[data-desktop-id="${id}"]`);
  const action = async (id, name) => {
    context(s, icon(id));
    s.document
      .querySelector(`#desktop-context-menu [data-action="${name}"]`)
      .click();
    await flushShell();
  };
  await action("__my-computer", "rename-my-computer");
  let input = s.document.querySelector(".desktop-rename");
  input.value = "Workstation";
  key(s, input, "Enter");
  expect(icon("__my-computer").textContent).toContain("Workstation");
  await action("__my-computer", "rename-my-computer");
  input = s.document.querySelector(".desktop-rename");
  input.value = "Discard";
  key(s, input, "Escape");
  expect(icon("__my-computer").textContent).toContain("Workstation");
  await action("__my-computer", "create-computer-shortcut");
  expect(fs.findChild(fs.DESKTOP, "Shortcut to My Computer.game").app).toBe(
    "__my-computer",
  );
  await action("__recycle-bin", "create-recycle-shortcut");
  expect(fs.findChild(fs.DESKTOP, "Shortcut to Recycle Bin.game").app).toBe(
    "__recycle-bin",
  );
  for (const [id, name] of [
    ["__my-computer", "computer-properties"],
    ["__recycle-bin", "recycle-properties"],
  ]) {
    await action(id, name);
    expect(s.document.querySelector(".xp-dialog").textContent).toContain(
      "Properties",
    );
    await answer(s, "ok");
  }
  await action("__my-computer", "explore-my-computer");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__my-computer"]'),
  ).toBeTrue();
  await action("__my-computer", "search-my-computer");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__search"]'),
  ).toBeTrue();
  await action("__my-computer", "hide-my-computer");
  expect(icon("__my-computer") === null).toBeTrue();
});
test("desktop keyboard copy, cut, paste, rename and permanent delete update files", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS,
    ops = s.window.FileOperations;
  const file = fs.createFile(fs.DESKTOP, "keyboard.txt", { content: "text" });
  await flushShell();
  const icon = () => s.document.querySelector(`[data-desktop-id="${file.id}"]`);
  icon().click();
  icon().focus();
  // AltGr types characters, such as "ć" and "ź" on a Polish keyboard. Like
  // XP, it runs no Ctrl shortcut. The character goes to type-ahead.
  for (const [key, code] of [
    ["ć", "KeyC"],
    ["ź", "KeyX"],
  ])
    pressAltGr(s.window, icon(), key, code);
  expect(ops.getClipboard()).toBeNull();
  icon().click();
  icon().focus();
  // Like Windows, a layout of another script gives the letter of the key's
  // place: a Russian C key types "с", and a Greek X key types "χ".
  key(s, icon(), "с", { ctrlKey: true, code: "KeyC" });
  expect(ops.getClipboard().mode).toBe("copy");
  key(s, icon(), "χ", { ctrlKey: true, code: "KeyX" });
  expect(ops.getClipboard().mode).toBe("cut");
  key(s, icon(), "F2");
  const rename = s.document.querySelector(".desktop-rename");
  rename.value = "renamed.txt";
  key(s, rename, "Enter");
  await flushShell();
  expect(fs.getNode(file.id).name).toBe("renamed.txt");
  icon().click();
  icon().focus();
  key(s, icon(), "F10", { shiftKey: true });
  expect(s.document.getElementById("desktop-context-menu").hidden).toBeFalse();
  key(s, s.document.activeElement, "Escape");
  key(s, icon(), "Delete", { shiftKey: true });
  await answer(s);
  expect(fs.getNode(file.id)).toBeNull();
  const other = fs.createFile(fs.MY_DOCUMENTS, "pasted.txt", {
    content: "copy",
  });
  ops.copy([other.id]);
  const surface = s.document.getElementById("desktop-icons");
  surface.focus();
  // "æ" starts the name of no icon, so type-ahead selects nothing.
  for (const [key, code] of [
    ["√", "KeyV"],
    ["æ", "KeyA"],
  ])
    for (const event of pressAltGr(s.window, surface, key, code))
      expect(event.defaultPrevented).toBeFalse();
  await flushShell();
  expect(fs.findChild(fs.DESKTOP, "pasted.txt")).toBeNull();
  expect(s.document.querySelectorAll(".desktop-icon.selected").length).toBe(0);
  key(s, surface, "м", { ctrlKey: true, code: "KeyV" });
  await flushShell();
  await flushShell();
  expect(fs.findChild(fs.DESKTOP, "pasted.txt").content).toBe("copy");
  key(s, surface, "ф", { ctrlKey: true, code: "KeyA" });
  expect(s.document.querySelectorAll(".desktop-icon.selected").length).toBe(
    s.document.querySelectorAll(".desktop-icon").length,
  );
  key(s, surface, "F5");
});
test("desktop marquee selects intersecting icons and additive selection preserves previous icons", async () => {
  const s = await login(await loadShell()),
    surface = s.document.getElementById("desktop-icons"),
    icons = [...s.document.querySelectorAll(".desktop-icon")];
  surface.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1000,
    height: 700,
  });
  icons.forEach((icon, index) =>
    Object.defineProperties(icon, {
      offsetLeft: { value: index * 90, configurable: true },
      offsetTop: { value: 10, configurable: true },
      offsetWidth: { value: 70, configurable: true },
      offsetHeight: { value: 70, configurable: true },
    }),
  );
  const drag = (end, extra = {}) => {
    for (const [type, x, y] of [
      ["pointerdown", 1, 1],
      ["pointermove", end, 100],
      ["pointerup", end, 100],
    ])
      surface.dispatchEvent(
        new s.window.PointerEvent(type, {
          button: 0,
          pointerId: 1,
          clientX: x,
          clientY: y,
          bubbles: true,
          ...extra,
        }),
      );
  };
  drag(170);
  expect(icons.filter((i) => i.classList.contains("selected")).length).toBe(2);
  icons[4].click();
  drag(80, { ctrlKey: true });
  expect(icons[0].classList.contains("selected")).toBeTrue();
  expect(icons[4].classList.contains("selected")).toBeTrue();
});
test("taskbar attention and keyboard menus act on selected windows", async () => {
  const s = await login(await loadShell());
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 800 },
  );
  clickStartAction(s, "documents");
  clickStartAction(s, "pictures");
  expect(s.window.XPShell.setWindowAttention("missing")).toBeFalse();
  expect(s.window.XPShell.setWindowAttention("__my-documents")).toBeTrue();
  const task = s.document.querySelector(
    '.task-button[data-game="__my-documents"]',
  );
  expect(task.className).toContain("attention");
  task.click();
  expect(task.className).not.toContain("attention");

  context(s, s.document.getElementById("taskbar"));
  const menu = s.document.getElementById("taskbar-context-menu");
  for (const k of ["End", "Home", "ArrowDown", "ArrowUp"]) key(s, menu, k);
  key(s, menu, "Escape");
  expect(menu.hidden).toBeTrue();
});
test("toolbar context controls change text, title and icon size and keyboard resize persists", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        taskbarSettings: JSON.stringify({ quickLaunch: true, locked: false }),
      },
    }),
  );
  const toolbar = () => s.document.querySelector(".quick-launch-toolbar"),
    layout = () =>
      JSON.parse(s.window.localStorage.getItem("taskbarSettings"))
        .toolbarLayouts["__quick-launch"];
  const menu = () => {
    context(s, toolbar());
    return s.document.getElementById("taskbar-overflow-menu");
  };
  const option = (label) =>
    menu().querySelector(`[aria-label="${label}"]`).click();
  option("Show Text");
  expect(layout().showText).toBeTrue();
  option("Show Title");
  expect(layout().showTitle).toBeTrue();
  let view = menu().querySelector('[aria-label="View"]');
  key(s, view, "ArrowRight");
  expect(view.getAttribute("aria-expanded")).toBe("true");
  const submenu = s.document.querySelector(".toolbar-view-menu");
  key(s, submenu, "ArrowLeft");
  expect(submenu.hidden).toBeTrue();
  view.click();
  s.document.querySelector('[aria-label="Large Icons"]').click();
  expect(layout().largeIcons).toBeTrue();
  view = menu().querySelector('[aria-label="View"]');
  view.parentElement.dispatchEvent(new s.window.PointerEvent("pointerenter"));
  expect(view.getAttribute("aria-expanded")).toBe("true");
  view.parentElement.dispatchEvent(new s.window.PointerEvent("pointerleave"));
  expect(view.getAttribute("aria-expanded")).toBe("false");
  view.click();
  s.document.querySelector('[aria-label="Small Icons"]').click();
  expect(layout().largeIcons).toBeFalse();
  const before = layout().width;
  key(s, toolbar().querySelector(".toolbar-size"), "ArrowRight");
  expect(layout().width).toBe(before + 10);
  key(s, toolbar().querySelector(".toolbar-size"), "ArrowLeft");
  expect(layout().width).toBe(before);
  key(s, toolbar().querySelector(".toolbar-grip"), "ArrowRight");
  expect(
    JSON.parse(s.window.localStorage.getItem("taskbarSettings")).toolbarOrder,
  ).toContain("__quick-launch");
  context(s, toolbar().querySelector("[data-shortcut]"));
  s.document
    .querySelector('#taskbar-overflow-menu [aria-label="Delete"]')
    .click();
  expect(
    JSON.parse(s.window.localStorage.getItem("taskbarSettings"))
      .quickLaunchItems.length,
  ).toBe(0);
  option("Close Toolbar");
  expect(toolbar() === null).toBeTrue();
});
test("floating toolbars can move and resize using keys and toggle always-on-top", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        taskbarSettings: JSON.stringify({
          quickLaunch: true,
          locked: false,
          toolbarLayouts: {
            "__quick-launch": {
              floating: true,
              x: 100,
              y: 100,
              width: 200,
              height: 100,
            },
          },
        }),
      },
    }),
  );
  const toolbar = () => s.document.querySelector(".quick-launch-toolbar"),
    layout = () =>
      JSON.parse(s.window.localStorage.getItem("taskbarSettings"))
        .toolbarLayouts["__quick-launch"];
  key(s, toolbar().querySelector(".toolbar-grip"), "ArrowRight");
  key(s, toolbar().querySelector(".toolbar-grip"), "ArrowDown");
  expect([layout().x, layout().y]).toEqual([110, 110]);
  key(s, toolbar().querySelector(".toolbar-size"), "ArrowDown");
  expect(layout().height).toBe(110);
  context(s, toolbar());
  s.document.querySelector('[aria-label="Always on Top"]').click();
  expect(layout().onTop).toBeTrue();
  toolbar().querySelector(".toolbar-close").click();
  expect(toolbar() === null).toBeTrue();
});
test("Start menu shows recent play history, favorites and keyboard-navigable program flyouts", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        favorites: JSON.stringify(["inside-the-firewall"]),
        gameStats: JSON.stringify({
          "inside-the-firewall": { plays: 2, lastPlayed: 2 },
          "big-truck-adventures": { plays: 1, lastPlayed: 1 },
        }),
      },
    }),
  );
  clickStartAction(s, "recent");
  const recent = s.document.querySelector(".start-program-flyout");
  expect(recent.textContent).toContain("Inside the Firewall");
  recent.querySelector("button").click();
  await flushShell();
  expect(
    !!s.document.querySelector('.xp-window[data-game="inside-the-firewall"]'),
  ).toBeTrue();
  s.document.getElementById("start-button").click();
  const all = s.document.getElementById("all-programs-button");
  all.click();
  const panel = s.document.querySelector(".start-program-flyout");
  expect(!!panel).toBeTrue();
  for (const value of ["End", "Home", "ArrowDown", "ArrowUp", "ArrowLeft"])
    key(s, panel, value);
  key(s, panel, "Escape");
  expect(s.document.activeElement === all).toBeTrue();
});
test("Alt-Tab cycles windows, releases the switcher, and shell shortcuts respect standby", async () => {
  const s = await login(await loadShell());
  clickStartAction(s, "documents");
  clickStartAction(s, "pictures");
  key(s, s.document.body, "Tab", { altKey: true });
  expect(s.document.getElementById("window-switcher").hidden).toBeFalse();
  expect(s.document.querySelector(".xp-window.active").dataset.game).toBe(
    "__my-documents",
  );
  key(s, s.document.body, "Tab", { altKey: true, shiftKey: true });
  expect(s.document.querySelector(".xp-window.active").dataset.game).toBe(
    "__my-pictures",
  );
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keyup", { key: "Alt", bubbles: true }),
  );
  expect(s.document.getElementById("window-switcher").hidden).toBeTrue();
  key(s, s.document.body, "Escape", { altKey: true });
  expect(s.document.querySelector(".xp-window.active").dataset.game).toBe(
    "__my-documents",
  );
  key(s, s.document.body, " ", { altKey: true });
  expect(s.document.getElementById("window-system-menu").hidden).toBeFalse();
  key(s, s.document.body, "Escape");
  expect(s.document.getElementById("window-system-menu").hidden).toBeTrue();
  s.document.body.focus();
  key(s, s.document.body, "Escape", { ctrlKey: true });
  expect(s.document.getElementById("start-menu").hidden).toBeFalse();
  s.document.getElementById("turn-off-button").click();
  s.document.getElementById("standby-confirm").click();
  key(s, s.document.body, "Shift");
  expect(s.document.getElementById("standby-screen").hidden).toBeFalse();
  key(s, s.document.body, "a");
  expect(s.document.getElementById("standby-screen").hidden).toBeTrue();
});
test("shell fetch checks bundled routes before installed games and falls back after storage errors", async () => {
  const requests = [],
    matches = [];
  let result = null,
    error = false;
  const s = await login(
    await loadShell({
      fetchObject: async (input) => {
        requests.push(typeof input === "string" ? input : input.url);
        return new Response("network");
      },
      gameLibraryManager: {
        subscribe: () => () => {},
        initialize: async () => ({}),
        match: async (input) => {
          matches.push(input);
          if (error) throw new Error("storage failed");
          return result;
        },
      },
    }),
  );
  const route = Object.values(s.window.FLASH_GAMES).flatMap((g) =>
    Object.keys(g.archive?.routes || {}),
  )[0];
  expect(typeof route).toBe("string");
  expect(await (await s.window.fetch(route)).text()).toBe("network");
  expect(matches).toHaveLength(0);
  result = new Response("installed");
  const response = await s.window.fetch("https://remote.example/asset");
  expect(await response.text()).toBe("installed");
  expect(response.url).toBe("https://remote.example/asset");
  result = new Response("request");
  expect(
    await (
      await s.window.fetch(
        new s.window.Request("https://remote.example/request"),
      )
    ).text(),
  ).toBe("request");
  error = true;
  expect(
    await (await s.window.fetch("https://remote.example/fallback")).text(),
  ).toBe("network");
  expect(requests.at(-1)).toBe("https://remote.example/fallback");
});
