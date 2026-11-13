// @ts-nocheck -- Happy DOM supplies browser events and elements.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  clickStartAction,
  flushShell,
} from "./helpers/shell-harness";
afterEach(cleanupShells);
async function setup() {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Fixture"),
    child = fs.createFolder(folder.id, "Nested"),
    file = fs.createFile(folder.id, "note.txt", { content: "original" });
  fs.open(folder.id);
  await flushShell();
  const win = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  const item = (id) =>
    win.querySelector(`.explorer-item[data-node-id="${id}"]`);
  const context = (id) => {
    item(id).dispatchEvent(
      new s.window.MouseEvent("contextmenu", { bubbles: true }),
    );
    return win.querySelector(".explorer-context-menu");
  };
  const command = async (id, action) => {
    const c = context(id);
    c.querySelector(`[data-command="${action}"]`).click();
    await flushShell();
  };
  const key = (el, key) =>
    el.dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  const confirm = async () => {
    const buttons = [
      ...s.document.querySelectorAll(".xp-dialog .dlg-buttons button"),
    ];
    buttons.find((b) => b.textContent === "Yes").click();
    await flushShell();
    await flushShell();
  };
  return {
    s,
    fs,
    folder,
    child,
    file,
    win,
    item,
    context,
    command,
    key,
    confirm,
  };
}
test("Explorer delete asks once and restore/permanent delete affect the selected file", async () => {
  const h = await setup();
  await h.command(h.file.id, "delete");
  await h.confirm();
  expect(h.s.document.querySelector(".xp-dialog-overlay") === null).toBeTrue();
  expect(h.fs.getNode(h.file.id).parent).toBe(h.fs.RECYCLE_BIN);
  h.fs.open(h.fs.RECYCLE_BIN);
  await flushShell();
  await h.command(h.file.id, "restore");
  expect(h.fs.getNode(h.file.id).parent).toBe(h.folder.id);
  h.fs.open(h.folder.id);
  await flushShell();
  await h.command(h.file.id, "delete");
  await h.confirm();
  h.fs.open(h.fs.RECYCLE_BIN);
  await flushShell();
  await h.command(h.file.id, "permanent");
  await h.confirm();
  expect(h.fs.getNode(h.file.id)).toBeNull();
});
test("Explorer context menus support copy, cut, rename, properties and keyboard navigation", async () => {
  const h = await setup();
  await h.command(h.file.id, "copy");
  expect(h.s.window.FileOperations.getClipboard()).toMatchObject({
    mode: "copy",
    ids: [h.file.id],
  });
  await h.command(h.file.id, "cut");
  expect(h.s.window.FileOperations.getClipboard().mode).toBe("cut");
  const finishRename = (value) => {
    const input = h.s.document.querySelector(".explorer-rename");
    input.value = value;
    input.dispatchEvent(
      new h.s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  };
  await h.command(h.file.id, "rename");
  finishRename("renamed.txt");
  await flushShell();
  expect(h.fs.getNode(h.file.id).name).toBe("renamed.txt");
  h.key(h.item(h.file.id), "F2");
  finishRename("keyboard.txt");
  await flushShell();
  expect(h.fs.getNode(h.file.id).name).toBe("keyboard.txt");
  await h.command(h.file.id, "properties");
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "keyboard.txt Properties",
  );
  h.key(h.s.document.activeElement, "Enter");
  let menu = h.context(h.file.id);
  for (const key of ["End", "ArrowUp", "ArrowDown", "Home"]) h.key(menu, key);
  expect(h.s.document.activeElement.textContent).toBe("Open");
  h.key(menu, "Escape");
  expect(menu.isConnected).toBeFalse();
  menu = h.context(h.file.id);
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(menu.isConnected).toBeFalse();
  h.key(h.item(h.child.id), "Enter");
  expect(h.win.querySelectorAll(".explorer-item")).toHaveLength(0);
  expect(h.win.querySelector(".explorer-status").textContent).toBe("0 objects");
  h.win.querySelector('[data-explorer-action="back"]').click();
  expect(h.item(h.file.id)).not.toBeNull();
  h.win.querySelector('[data-explorer-action="forward"]').click();
  expect(h.item(h.file.id)).toBeNull();
  h.win.querySelector('[data-explorer-action="up"]').click();
  expect(h.item(h.file.id)).not.toBeNull();
});
test("Explorer drag and drop moves internal files and imports external file contents", async () => {
  const h = await setup(),
    w = h.s.window;
  const transfer = new w.DataTransfer();
  const drag = (type) => {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: transfer });
    return e;
  };
  h.item(h.file.id).click();
  h.item(h.file.id).dispatchEvent(drag("dragstart"));
  expect(JSON.parse(transfer.getData("application/x-astro-vfs-ids"))).toEqual([
    h.file.id,
  ]);
  const target = h.item(h.child.id);
  target.dispatchEvent(drag("dragover"));
  expect(target.classList.contains("drop-target")).toBeTrue();
  target.dispatchEvent(drag("dragleave"));
  expect(target.classList.contains("drop-target")).toBeFalse();
  // A folder never shows as a drop target for itself.
  h.item(h.child.id).click();
  target.dispatchEvent(drag("dragstart"));
  const overSelf = drag("dragover");
  target.dispatchEvent(overSelf);
  expect(overSelf.defaultPrevented).toBeFalse();
  expect(target.classList.contains("drop-target")).toBeFalse();
  target.dispatchEvent(drag("dragend"));
  target.dispatchEvent(drag("dragover"));
  expect(target.classList.contains("drop-target")).toBeTrue();
  target.dispatchEvent(drag("dragleave"));
  // A folder dropped on itself stays where it is, with no message.
  transfer.setData("application/x-astro-vfs-ids", JSON.stringify([h.child.id]));
  target.dispatchEvent(drag("drop"));
  await flushShell();
  expect(h.s.document.querySelectorAll(".xp-dialog")).toHaveLength(0);
  transfer.setData("application/x-astro-vfs-ids", JSON.stringify([h.file.id]));
  // A drag moves the file and never touches the clipboard, like XP.
  w.FileOperations.copy([h.child.id]);
  target.dispatchEvent(drag("drop"));
  await flushShell();
  await flushShell();
  expect(h.fs.getNode(h.file.id).parent).toBe(h.child.id);
  expect(w.FileOperations.getClipboard()).toEqual({
    mode: "copy",
    ids: [h.child.id],
  });
  const external = {
    types: ["Files"],
    files: [new w.File(["imported"], "external.txt", { type: "text/plain" })],
    items: [],
    getData: () => "",
  };
  const drop = new w.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: external });
  h.item(h.child.id).dispatchEvent(drop);
  for (let i = 0; i < 30 && !h.fs.findChild(h.child.id, "external.txt"); i++)
    await flushShell();
  expect(h.fs.findChild(h.child.id, "external.txt").content).toBe("imported");
});
test("search companion finds files from its form", async () => {
  const h = await setup(),
    s = h.s;
  clickStartAction(s, "search");
  const search = s.document.querySelector('.xp-window[data-game="__search"]');
  expect(search).not.toBeNull();
  const kinds = [...search.querySelectorAll("[data-search-kind]")];
  expect(kinds.length).toBeGreaterThan(0);
  kinds[0].click();
  const query = search.querySelector("#search-filename");
  query.value = "note";
  h.key(query, "Enter");
  await flushShell();
  expect(search.textContent).toContain("note.txt");
});
test("Explorer menu commands switch views, select items and paste copies", async () => {
  const h = await setup();
  const menu = async (name, command) => {
    h.win.querySelector(`[data-explorer-menu="${name}"]`).click();
    h.win.querySelector(`[data-explorer-command="${command}"]`).click();
    await flushShell();
  };
  for (const view of ["thumbnails", "tiles", "icons", "list", "details"]) {
    await menu("view", view);
    expect(h.win.querySelector(".explorer-items").dataset.view).toBe(view);
  }
  expect(h.win.querySelector(".explorer-details-header") !== null).toBeTrue();
  await menu("edit", "select-all");
  expect(h.win.querySelectorAll(".explorer-item.selected").length).toBe(2);
  await menu("edit", "invert-selection");
  expect(h.win.querySelectorAll(".explorer-item.selected").length).toBe(0);
  h.item(h.file.id).click();
  await menu("edit", "copy");
  h.item(h.child.id).dispatchEvent(new h.s.window.MouseEvent("dblclick"));
  await menu("edit", "paste");
  await flushShell();
  expect(h.fs.findChild(h.child.id, "note.txt").content).toBe("original");
  h.win.querySelector('[data-explorer-action="folders"]').click();
  expect(
    h.win
      .querySelector('[data-explorer-action="folders"]')
      .getAttribute("aria-pressed"),
  ).toBe("true");
  const root = h.win.querySelector(
    `.explorer-tree-item[data-node-id="${h.fs.MY_COMPUTER}"]`,
  );
  root.click();
  expect(h.win.querySelectorAll(".my-computer-item").length).toBeGreaterThan(0);
  root.dispatchEvent(new h.s.window.MouseEvent("dblclick"));
  const address = h.win.querySelector(".explorer-address input");
  address.value = h.fs.getPath(h.folder.id);
  h.win.querySelector('[data-explorer-action="go"]').click();
  expect(h.item(h.file.id) !== null).toBeTrue();
  address.value = "missing path";
  address.dispatchEvent(new h.s.window.Event("change"));
  expect(address.value).toBe(h.fs.getPath(h.folder.id));
  h.win.querySelector('[data-explorer-action="view"]').click();
  expect(h.win.querySelector(".explorer-items").dataset.view).toBe("tiles");
  await menu("view", "refresh");
  await menu("help", "about-windows");
  expect(h.s.document.querySelector(".xp-dialog") !== null).toBeTrue();
  h.key(h.s.document.activeElement, "Enter");
});
test("Explorer menus navigate headings and submenus from the keyboard", async () => {
  const h = await setup(),
    chrome = h.win.querySelector(".explorer-chrome");
  const key = (value, el = h.s.document.activeElement, extra = {}) =>
    el.dispatchEvent(
      new h.s.window.KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
  const heading = h.win.querySelector('[data-explorer-menu="file"]');
  heading.focus();
  for (const value of ["ArrowRight", "ArrowLeft", "Home", "End", "ArrowDown"]) {
    heading.focus();
    key(value);
    expect(h.win.querySelector(".explorer-menu").hidden).toBeFalse();
  }
  key("Escape", chrome);
  expect(h.win.querySelector(".explorer-menu").hidden).toBeTrue();
  key("v", chrome, { altKey: true });
  expect(
    h.win
      .querySelector('[data-explorer-menu="view"]')
      .getAttribute("aria-expanded"),
  ).toBe("true");
  for (const value of ["End", "Home", "ArrowDown", "ArrowUp"]) key(value);
  const parent = h.win.querySelector('[data-explorer-command="go-to"]');
  parent.focus();
  key("ArrowRight");
  expect(h.win.querySelector(".explorer-submenu").hidden).toBeFalse();
  for (const value of ["End", "Home", "ArrowDown", "ArrowUp"]) key(value);
  key("ArrowLeft");
  expect(h.win.querySelector(".explorer-submenu").hidden).toBeTrue();
  parent.dispatchEvent(
    new h.s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(h.win.querySelector(".explorer-submenu").hidden).toBeFalse();
  h.win.querySelector('[data-explorer-subcommand="my-computer"]').click();
  expect(h.win.querySelectorAll(".my-computer-item").length).toBeGreaterThan(0);
  h.win.querySelector('[data-explorer-menu="view"]').click();
  const folders = h.win.querySelector('[data-explorer-command="explorer-bar"]');
  folders.focus();
  key("ArrowRight");
  h.win.querySelector('[data-explorer-subcommand="folders-bar"]').click();
  expect(
    h.win
      .querySelector(".explorer-content")
      .classList.contains("folders-visible"),
  ).toBeTrue();
  h.win.querySelector('[data-explorer-menu="view"]').click();
  const refresh = h.win.querySelector('[data-explorer-command="refresh"]');
  refresh.focus();
  key("Enter");
  expect(h.win.querySelector(".explorer-menu").hidden).toBeTrue();
});
test("Control Panel navigates categories, classic view and settings destinations", async () => {
  const s = await login(await loadShell());
  clickStartAction(s, "controlPanel");
  const content = () => s.document.querySelector(".control-panel-content");
  const action = (id) =>
    content().querySelector(`[data-control-panel-action="${id}"]`).click();
  content().querySelector(".explorer-section-toggle").click();
  expect(
    content()
      .querySelector(".explorer-section-toggle")
      .getAttribute("aria-expanded"),
  ).toBe("false");
  content().querySelector(".explorer-section-toggle").click();
  expect(
    content()
      .querySelector(".explorer-section-toggle")
      .getAttribute("aria-expanded"),
  ).toBe("true");
  action("classic");
  expect(content().classList.contains("classic-view")).toBeTrue();
  action("classic");
  expect(content().classList.contains("classic-view")).toBeFalse();
  action("folders");
  expect(content().classList.contains("folders-visible")).toBeTrue();
  content().querySelector('[data-control-panel-category="appearance"]').click();
  expect(content().textContent).toContain("Appearance and Themes");
  for (const id of [
    "theme",
    "desktop",
    "screen-saver",
    "resolution",
    "display",
  ]) {
    action(id);
    expect(
      !!s.document.querySelector(
        '.xp-window[data-game="__display-properties"]',
      ),
    ).toBeTrue();
    s.document
      .querySelector('.xp-window[data-game="__display-properties"] .close-btn')
      .click();
  }
  action("taskbar-properties");
  expect(!!s.document.querySelector(".taskbar-properties-dialog")).toBeTrue();
  s.document
    .querySelector('.taskbar-properties-dialog [data-action="cancel"]')
    .click();
  action("back");
  await flushShell();
  content().querySelector('[data-control-panel-category="datetime"]').click();
  action("date-time");
  expect(!!s.document.querySelector(".datetime-dialog")).toBeTrue();
  s.document.querySelector('.datetime-dialog [data-action="cancel"]').click();
  action("back");
  await flushShell();
  action("search");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__search"]'),
  ).toBeTrue();
});
