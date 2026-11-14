// @ts-nocheck -- Control Panel's Explorer chrome, history, views and menus.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  clickStartAction,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

const open = async () => {
  const s = await login(await loadShell());
  clickStartAction(s, "controlPanel");
  await flushShell();
  const win = s.document.querySelector(
    '.xp-window[data-game="__control-panel"]',
  );
  const $ = (selector) => win.querySelector(selector);
  const toolbar = (action) =>
    $(`.explorer-toolbar [data-control-panel-action="${action}"]`);
  const menu = (name) => $(`[data-control-panel-menu="${name}"]`).click();
  const command = (name) => $(`[data-control-panel-command="${name}"]`);
  return { s, win, $, toolbar, menu, command };
};

test("Control Panel keeps XP's title, address and history across its pages", async () => {
  const { s, win, $, toolbar } = await open();
  const title = () => win.querySelector(".title-text").textContent;
  expect([title(), $(".explorer-address input").value]).toEqual([
    "Control Panel",
    "Control Panel",
  ]);
  expect([toolbar("back").disabled, toolbar("forward").disabled]).toEqual([
    true,
    true,
  ]);
  expect(toolbar("views").disabled).toBeTrue();
  expect(
    $('[data-control-panel-category="datetime"]').getAttribute("title"),
  ).toContain("time zone");

  $('[data-control-panel-category="appearance"]').click();
  expect(title()).toBe("Appearance and Themes");
  expect($(".title-icon img").src).toContain("ControlPanel");
  expect($(".control-panel-category-heading").textContent).toBe(
    "Appearance and Themes",
  );
  toolbar("back").click();
  expect(title()).toBe("Control Panel");
  toolbar("forward").click();
  expect(title()).toBe("Appearance and Themes");

  // Up goes to Control Panel, then to the Desktop folder.
  toolbar("up").click();
  expect(title()).toBe("Control Panel");
  expect(toolbar("forward").disabled).toBeTrue();
  toolbar("up").click();
  await flushShell();
  expect(
    s.document.querySelector('.xp-window[data-game="__control-panel"]'),
  ).toBeNull();
});

test("Classic View selects, opens and lists icons like Explorer", async () => {
  const { s, $, toolbar, menu, command } = await open();
  $('[data-control-panel-action="classic"]').click();
  expect($(".control-panel-content").className).toContain("classic-view");
  expect($('[data-control-panel-action="classic"]').textContent).toBe(
    "Switch to Category View",
  );
  const icons = () => [...s.document.querySelectorAll(".control-panel-icon")];
  expect(icons().map((icon) => icon.textContent)).toEqual([
    "Date and Time",
    "Display",
    "Taskbar and Start Menu",
  ]);

  // A click selects; File → Open and Enter open the selection.
  icons()[0].click();
  expect(icons()[0].className).toContain("selected");
  menu("file");
  command("open").click();
  expect(!!s.document.querySelector(".datetime-dialog")).toBeTrue();
  s.document.querySelector('.datetime-dialog [data-action="cancel"]').click();
  icons()[2].dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  icons()[2].dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  expect(!!s.document.querySelector(".taskbar-properties-dialog")).toBeTrue();
  s.document
    .querySelector('.taskbar-properties-dialog [data-action="cancel"]')
    .click();
  icons()[1].dispatchEvent(
    new s.window.MouseEvent("dblclick", { bubbles: true }),
  );
  await flushShell();
  expect(
    !!s.document.querySelector('.xp-window[data-game="__display-properties"]'),
  ).toBeTrue();
  $(".control-panel-main").dispatchEvent(
    new s.window.MouseEvent("dblclick", { bubbles: true }),
  );
  $(".control-panel-main").dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );

  // Edit selects everything, then inverts to nothing.
  menu("edit");
  command("select-all").click();
  expect(
    icons().every((icon) => icon.className.includes("selected")),
  ).toBeTrue();
  menu("edit");
  command("invert-selection").click();
  expect(
    icons().some((icon) => icon.className.includes("selected")),
  ).toBeFalse();
  menu("file");
  expect(command("open").disabled).toBeTrue();
  menu("file");
  expect($(".explorer-menu").hidden).toBeTrue();

  // Views and View → List or Icons.
  toolbar("views").click();
  command("view-list").click();
  expect($(".control-panel-icons").dataset.view).toBe("list");
  menu("view");
  expect(command("view-list").className).toContain("checked");
  command("view-icons").click();
  expect($(".control-panel-icons").dataset.view).toBe("icons");
  menu("view");
  command("refresh").click();
  expect(icons()).toHaveLength(3);
});

test("Control Panel's menus close, show About and close the window", async () => {
  const { s, win, $, menu, command } = await open();
  menu("edit");
  expect(command("select-all").disabled).toBeTrue();
  $(".control-panel-main").click();
  expect($(".explorer-menu").hidden).toBeTrue();

  // A press outside the window closes the menu and resets its button, so
  // the next click opens it again.
  menu("edit");
  s.document.body.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect($(".explorer-menu").hidden).toBeTrue();
  expect(
    $('[data-control-panel-menu="edit"]').getAttribute("aria-expanded"),
  ).toBe("false");
  menu("edit");
  expect($(".explorer-menu").hidden).toBeFalse();
  menu("edit");

  // A menu command gives the keys back to the control that had them.
  const address = $(".explorer-address input");
  address.focus();
  menu("view");
  const refresh = command("refresh");
  refresh.focus();
  refresh.click();
  expect(s.document.activeElement === address).toBeTrue();
  // Without that control, the page takes the keys.
  menu("view");
  command("refresh").focus();
  address.remove();
  command("refresh").click();
  expect(s.document.activeElement === $(".control-panel-main")).toBeTrue();

  // A command that renders the page again keeps the keys in the window.
  $('[data-control-panel-action="classic"]').click();
  $(".control-panel-icon").focus();
  menu("view");
  command("view-list").focus();
  command("view-list").click();
  expect(s.document.activeElement === $(".control-panel-icons")).toBeTrue();
  // So does a toolbar button that leaves the page.
  $(".control-panel-icon").focus();
  $('.explorer-toolbar [data-control-panel-action="back"]').click();
  expect(win.contains(s.document.activeElement)).toBeTrue();
  expect(
    $(".control-panel-main").hasAttribute("data-default-focus") ||
      !!$(".control-panel-icons[data-default-focus]"),
  ).toBeTrue();

  // A press in another Explorer window's toolbar, or keys that move to
  // that window, close the menu.
  clickStartAction(s, "documents");
  await flushShell();
  const docs = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  menu("file");
  // With no keys in Control Panel, only the press can close its menu.
  s.document.activeElement.blur();
  docs
    .querySelector(".explorer-toolbar")
    .dispatchEvent(new s.window.PointerEvent("pointerdown", { bubbles: true }));
  expect($(".explorer-menu").hidden).toBeTrue();
  expect(
    $('[data-control-panel-menu="file"]').getAttribute("aria-expanded"),
  ).toBe("false");
  menu("file");
  $(".control-panel-main").focus();
  docs.querySelector(".explorer-items").focus();
  expect($(".explorer-menu").hidden).toBeTrue();
  menu("help");
  command("about").click();
  expect(
    s.document.querySelector(".about-windows-dialog .title-text").textContent,
  ).toBe("About Windows");
  s.document.querySelector('.about-windows-dialog [data-action="ok"]').click();
  menu("file");
  command("close").click();
  await flushShell();
  expect(
    s.document.querySelector('.xp-window[data-game="__control-panel"]'),
  ).toBeNull();
});

test("Control Panel's Views button toggles its menu and the page keeps the keys", async () => {
  const { s, $, toolbar, menu } = await open();
  const views = toolbar("views");
  // Views is disabled in Category View, so a press on it closes a menu.
  expect(views.disabled).toBeTrue();
  menu("file");
  views.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect($(".explorer-menu").hidden).toBeTrue();

  // Keys on the page go to the icons when Classic View shows them.
  $(".control-panel-main").focus();
  $('[data-control-panel-action="classic"]').click();
  expect(s.document.activeElement === $(".control-panel-icons")).toBeTrue();

  // A second click on Views closes its menu, like XP.
  views.click();
  expect($(".explorer-menu").hidden).toBeFalse();
  expect(views.getAttribute("aria-expanded")).toBe("true");
  views.click();
  expect($(".explorer-menu").hidden).toBeTrue();
  expect(views.getAttribute("aria-expanded")).toBe("false");
});

test("Control Panel's address opens what it names and keeps its page otherwise", async () => {
  const { s, $ } = await open();
  const address = $(".explorer-address input");
  const form = $(".explorer-address");
  address.value = "nowhere";
  form.dispatchEvent(new s.window.Event("submit", { cancelable: true }));
  expect(address.value).toBe("Control Panel");
  address.value = "notepad";
  form.dispatchEvent(new s.window.Event("submit", { cancelable: true }));
  await flushShell();
  await flushShell();
  expect(
    !!s.document.querySelector('.xp-window[data-game="__notepad"]'),
  ).toBeTrue();
  expect(address.value).toBe("Control Panel");
});
