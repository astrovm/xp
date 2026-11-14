// @ts-nocheck -- Dialog chrome compared against the XP SP3 VM.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { pressAltGr } from "./helpers/keys";
afterEach(cleanupShells);
const dialogs = (s) => [...s.document.querySelectorAll(".xp-dialog")];
const current = (s) => dialogs(s).at(-1);
const key = (s, key) =>
  s.document.activeElement.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
const click = (s, element, x = 40, y = 50) =>
  element.dispatchEvent(
    new s.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    }),
  );

test("only the newest dialog is active", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const outer = d.confirm("Proceed?");
  const inner = d.alert("Read this first");
  const [first, second] = dialogs(s);
  expect(first.classList.contains("active")).toBeFalse();
  expect(second.classList.contains("active")).toBeTrue();
  expect(second.classList.contains("xp-message-box")).toBeTrue();
  key(s, "Enter");
  await inner;
  expect(first.classList.contains("active")).toBeTrue();
  key(s, "n");
  expect(await outer).toBeFalse();
});

test("the ? button shows What's This help for a control", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const dialog = d.createDialog({ title: "Properties", help: true });
  const described = s.document.createElement("button");
  described.dataset.help = "Shows the clock on the taskbar.";
  const plain = s.document.createElement("button");
  dialog.body.append(described, plain);
  let clicked = 0;
  plain.addEventListener("click", () => {
    clicked += 1;
  });

  const help = dialog.el.querySelector(".help-btn");
  expect(help.getAttribute("aria-label")).toBe("Help");
  click(s, plain);
  expect(clicked).toBe(1);
  expect(s.document.querySelector(".xp-help-popup")).toBeNull();

  help.click();
  expect(dialog.el.classList.contains("whats-this")).toBeTrue();
  click(s, described, 5000, 5000);
  expect(dialog.el.classList.contains("whats-this")).toBeFalse();
  const popup = s.document.querySelector(".xp-help-popup");
  expect(popup.textContent).toBe("Shows the clock on the taskbar.");
  await s.advanceTime(1);
  s.document.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(s.document.querySelector(".xp-help-popup")).toBeNull();

  help.click();
  click(s, plain);
  expect(clicked).toBe(1);
  expect(s.document.querySelector(".xp-help-popup").textContent).toBe(
    "No Help topic is associated with this item.",
  );
  help.click();
  click(s, plain);
  await s.advanceTime(1);
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Shift", bubbles: true }),
  );
  expect(s.document.querySelector(".xp-help-popup")).toBeNull();

  help.click();
  dialog.el.querySelector(".dlg-body").focus();
  dialog.onKeydown(
    new s.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(dialog.el.classList.contains("whats-this")).toBeFalse();
  expect(dialog.el.isConnected).toBeTrue();
  dialog.close();
});

test("file dialogs browse with places, back, the folder list, and file types", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  fs.createFile(fs.MY_DOCUMENTS, "notes.txt", { content: "" });
  fs.createFile(fs.MY_DOCUMENTS, "photo.bmp", { content: "" });
  const save = d.saveFile({ filter: [".txt"] });
  const dialog = current(s);
  expect(dialog.classList.contains("xp-file-dialog")).toBeTrue();
  expect(dialog.querySelector(".help-btn")).not.toBeNull();
  const folder = dialog.querySelector(".dlg-file-folder");
  const names = () =>
    [...dialog.querySelectorAll(".dlg-file-item")].map((item) =>
      item.textContent.trim(),
    );
  expect(folder.textContent).toBe("My Documents");
  expect(dialog.querySelector(".dlg-file-place.selected").textContent).toBe(
    "My Documents",
  );
  expect(names()).toEqual(["My Music", "My Pictures", "notes.txt"]);
  expect(dialog.querySelector('[data-action="back"]').disabled).toBeTrue();

  const type = dialog.querySelector(".dlg-file-type");
  expect([...type.options].map((option) => option.textContent)).toEqual([
    "TXT Files (*.txt)",
    "All Files (*.*)",
  ]);
  type.value = "";
  type.dispatchEvent(new s.window.Event("change"));
  expect(names()).toContain("photo.bmp");
  type.value = ".txt";
  type.dispatchEvent(new s.window.Event("change"));
  expect(names()).not.toContain("photo.bmp");

  [...dialog.querySelectorAll(".dlg-file-place")]
    .find((place) => place.textContent === "My Computer")
    .click();
  expect(folder.dataset.value).toBe(fs.MY_COMPUTER);
  dialog.querySelector('[data-action="back"]').click();
  expect(folder.dataset.value).toBe(fs.MY_DOCUMENTS);

  folder.click();
  dialog
    .querySelector(`.dlg-file-folder-option[data-folder-id="${fs.DESKTOP}"]`)
    .click();
  expect(folder.textContent).toBe("Desktop");
  [...dialog.querySelectorAll(".dlg-file-place")]
    .find((place) => place.textContent === "Desktop")
    .click();
  expect(folder.dataset.value).toBe(fs.DESKTOP);

  const typed = dialog.querySelector("#dlg-file-name").value;
  dialog.querySelector('[data-action="new-folder"]').click();
  await flushShell();
  expect(dialog.querySelector(".dlg-file-rename").value).toBe("New Folder");
  expect(dialog.querySelector("#dlg-file-name").value).toBe(typed);
  // F2 in the rename box reaches the item too. Like Explorer, the open box
  // stays with its text.
  const errors = [];
  const onError = (event) => errors.push(event.error);
  s.window.addEventListener("error", onError);
  const renameBox = dialog.querySelector(".dlg-file-rename");
  renameBox.value = "Typed";
  renameBox.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "F2",
      bubbles: true,
      cancelable: true,
    }),
  );
  s.window.removeEventListener("error", onError);
  expect(errors).toEqual([]);
  expect(dialog.querySelectorAll(".dlg-file-rename")).toHaveLength(1);
  expect(dialog.querySelector(".dlg-file-rename") === renameBox).toBeTrue();
  expect(renameBox.value).toBe("Typed");
  // The first Esc ends the rename box, and the second closes the dialog.
  key(s, "Escape");
  expect(names()).toContain("New Folder");
  key(s, "Escape");
  expect(await save).toBeNull();

  const open = d.openFile();
  expect(
    current(s).querySelector(".dlg-file-folder-field").textContent,
  ).toContain("Look in:");
  expect(
    [...current(s).querySelectorAll(".dlg-file-type option")].map(
      (option) => option.textContent,
    ),
  ).toEqual(["All Files (*.*)"]);
  key(s, "Escape");
  expect(await open).toBeNull();
});

test("New Folder reports a filesystem error", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const create = fs.createFolder;
  fs.createFolder = () => {
    throw new Error("synthetic storage failure");
  };
  const save = d.saveFile();
  current(s).querySelector('[data-action="new-folder"]').click();
  await flushShell();
  expect(current(s).classList.contains("xp-message-box")).toBeTrue();
  expect(current(s).textContent).toContain("synthetic storage failure");
  fs.createFolder = create;
  key(s, "Enter");
  await flushShell();
  key(s, "Escape");
  expect(await save).toBeNull();
});

test("dialogs show Explorer's icons and the Recycle Bin state", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  d.properties(fs.DRIVE_C);
  expect(
    current(s).querySelector(".dlg-node-icon img").getAttribute("src"),
  ).toContain("LocalDisk.png");
  current(s).querySelector('[data-action="ok"], .xp-btn').click();
  d.properties(fs.RECYCLE_BIN);
  expect(
    current(s).querySelector(".dlg-node-icon img").getAttribute("src"),
  ).toContain("RecyclerEmpty.png");
});

test("access-key underlines follow keyboard or mouse use", async () => {
  const s = await login(await loadShell());
  const root = s.document.documentElement;
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  expect(root.classList.contains("keyboard-cues")).toBeFalse();
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Alt", bubbles: true }),
  );
  expect(root.classList.contains("keyboard-cues")).toBeTrue();
  s.document.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(root.classList.contains("keyboard-cues")).toBeFalse();
});

test("What's This help stays inside the visible mobile viewport", async () => {
  const s = await login(await loadShell());
  s.document.documentElement.style.zoom = "1.142857";
  s.window.matchMedia = () => ({ matches: true });
  Object.defineProperty(s.window, "visualViewport", {
    configurable: true,
    value: { width: 411, height: 735, scale: 1 },
  });
  const dialog = s.window.XPDialogs.createDialog({
    title: "Properties",
    help: true,
  });
  const control = s.document.createElement("button");
  control.dataset.help = "A control near the edge of the screen.";
  dialog.body.append(control);
  dialog.el.querySelector(".help-btn").click();
  click(s, control, 1000, 1000);
  const popup = s.document.querySelector(".xp-help-popup");
  expect(parseFloat(popup.style.left) + popup.offsetWidth).toBeLessThanOrEqual(
    409,
  );
  expect(parseFloat(popup.style.top) + popup.offsetHeight).toBeLessThanOrEqual(
    733,
  );
  dialog.close();
});

const keyOn = (s, element, key, init = {}) =>
  element.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
const pointerDown = (s, element) =>
  element.dispatchEvent(
    new s.window.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );

test("file dialogs show XP's five places and the Look in tree with icons", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const open = d.openFile();
  const dialog = current(s);
  expect(
    [...dialog.querySelectorAll(".dlg-file-place")].map((place) =>
      place.textContent.trim(),
    ),
  ).toEqual([
    "My Recent Documents",
    "Desktop",
    "My Documents",
    "My Computer",
    "My Network",
  ]);
  const folder = dialog.querySelector(".dlg-file-folder");
  expect(folder.querySelector("img").getAttribute("src")).toBe(
    "assets/xp/icons/MyDocuments.png",
  );
  const rows = () =>
    [...dialog.querySelectorAll(".dlg-file-folder-option")].map(
      (row) => `${parseInt(row.style.paddingLeft, 10)}:${row.textContent}`,
    );
  expect(rows()).toEqual([
    "2:Desktop",
    "12:My Documents",
    "12:My Computer",
    "22:Local Disk (C:)",
    "22:Local Disk (D:)",
    "22:Removable Disk (F:)",
    "12:My Network Places",
  ]);
  // The open folder's path shows under the place that holds it.
  [...dialog.querySelectorAll(".dlg-file-place")]
    .find((place) => place.textContent.includes("Recent"))
    .click();
  expect(rows()).toContain("32:Documents and Settings");
  expect(rows()).toContain("52:Recent");
  expect(folder.querySelector("img").getAttribute("src")).toBe(
    "assets/xp/icons/RecentDocuments.png",
  );
  dialog.querySelector('[data-action="back"]').click();
  fs.createFolder(fs.MY_PICTURES, "Trips");
  [...dialog.querySelectorAll(".dlg-file-item")]
    .find((item) => item.textContent === "My Pictures")
    .dispatchEvent(new s.window.MouseEvent("dblclick"));
  expect(rows()).toContain("22:My Pictures");
  key(s, "Escape");
  expect(await open).toBeNull();
  // A folder outside the places, like the Recycle Bin, is listed by its
  // own path.
  const bin = d.openFile({ startFolder: fs.RECYCLE_BIN });
  expect(
    [...current(s).querySelectorAll(".dlg-file-folder-option")].at(-1)
      .textContent,
  ).toBe("Recycle Bin");
  key(s, "Escape");
  expect(await bin).toBeNull();
  // Save As never starts in the Recycle Bin, even for a deleted file.
  const deleted = fs.createFolder(fs.DESKTOP, "Old");
  fs.remove(deleted.id);
  const save = d.saveFile({ startFolder: deleted.id });
  expect(
    current(s).querySelector(".dlg-file-folder-option.selected").textContent,
  ).toBe("My Documents");
  key(s, "Escape");
  expect(await save).toBeNull();
  const computer = d.openFile({ startFolder: fs.MY_COMPUTER });
  expect(
    current(s).querySelector(".dlg-file-folder-option.selected").textContent,
  ).toBe("My Computer");
  key(s, "Escape");
  expect(await computer).toBeNull();
});

test("Look in opens with the mouse or keyboard and steps through folders", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const open = d.openFile();
  const dialog = current(s);
  const folder = dialog.querySelector(".dlg-file-folder");
  const list = dialog.querySelector(".dlg-file-folder-list");
  // Clicking the field label does not open the list.
  click(s, dialog.querySelector(".dlg-file-folder-field > span"));
  expect(list.hidden).toBeTrue();
  folder.click();
  expect(list.hidden).toBeFalse();
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  folder.click();
  expect(list.hidden).toBeTrue();
  // A click elsewhere in the dialog closes the list.
  folder.click();
  pointerDown(s, dialog.querySelector(".dlg-file-list"));
  expect(list.hidden).toBeTrue();
  // A click on the box itself leaves the toggle to the click.
  folder.click();
  pointerDown(s, folder);
  expect(list.hidden).toBeFalse();
  const desktop = dialog.querySelector(
    `.dlg-file-folder-option[data-folder-id="${fs.DESKTOP}"]`,
  );
  desktop.dispatchEvent(new s.window.MouseEvent("pointerenter"));
  expect(desktop.classList.contains("selected")).toBeTrue();
  // Escape closes the list without closing the dialog.
  key(s, "Escape");
  expect(list.hidden).toBeTrue();
  expect(current(s)).toBe(dialog);
  // Alt+Down and F4 open it; the arrows move the highlight and Enter
  // opens the highlighted folder.
  folder.focus();
  keyOn(s, folder, "ArrowDown", { altKey: true });
  expect(list.hidden).toBeFalse();
  key(s, "ArrowDown");
  key(s, "Enter");
  expect(list.hidden).toBeTrue();
  expect(folder.textContent).toBe("My Computer");
  keyOn(s, folder, "F4");
  key(s, "ArrowUp");
  key(s, "ArrowUp");
  key(s, "ArrowUp");
  expect(
    dialog.querySelector(".dlg-file-folder-option.selected").textContent,
  ).toBe("Desktop");
  key(s, "Tab");
  expect(list.hidden).toBeTrue();
  // F4 and Alt+Up close the open list.
  folder.focus();
  keyOn(s, folder, "F4");
  keyOn(s, folder, "F4");
  expect(list.hidden).toBeTrue();
  keyOn(s, folder, "ArrowUp", { altKey: true });
  expect(list.hidden).toBeFalse();
  keyOn(s, folder, "ArrowUp", { altKey: true });
  expect(list.hidden).toBeTrue();
  // A letter moves to the next folder with that letter. Other letters do
  // nothing, and never press a dialog button.
  keyOn(s, folder, "F4");
  keyOn(s, folder, "m");
  expect(
    dialog.querySelector(".dlg-file-folder-option.selected").textContent,
  ).toBe("My Network Places");
  keyOn(s, folder, "M");
  expect(
    dialog.querySelector(".dlg-file-folder-option.selected").textContent,
  ).toBe("My Documents");
  expect(folder.getAttribute("aria-activedescendant")).toBe(
    dialog.querySelector(".dlg-file-folder-option.selected").id,
  );
  keyOn(s, folder, "o");
  keyOn(s, folder, "c", { ctrlKey: true });
  // Space does not click the box under the open list.
  expect(keyOn(s, folder, " ")).toBeFalse();
  expect(list.hidden).toBeFalse();
  expect(current(s)).toBe(dialog);
  // A mouse press in the list keeps the focus in the box.
  const press = new s.window.MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  list.firstChild.dispatchEvent(press);
  expect(press.defaultPrevented).toBeTrue();
  // Alt and an access key close the list, then work as usual.
  keyOn(s, folder, "t", { altKey: true });
  expect(list.hidden).toBeTrue();
  expect(s.document.activeElement).toBe(dialog.querySelector(".dlg-file-type"));
  folder.focus();
  // With the list closed, the arrows open the next or previous folder.
  keyOn(s, folder, "ArrowUp");
  expect(folder.textContent).toBe("My Documents");
  keyOn(s, folder, "ArrowUp");
  expect(folder.textContent).toBe("Desktop");
  keyOn(s, folder, "ArrowUp");
  expect(folder.textContent).toBe("Desktop");
  keyOn(s, folder, "ArrowDown");
  expect(folder.textContent).toBe("My Documents");
  keyOn(s, folder, "Home");
  expect(folder.textContent).toBe("My Documents");
  key(s, "Escape");
  expect(await open).toBeNull();
});

test("Views switches between XP's five list views", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  fs.createFile(fs.MY_DOCUMENTS, "notes.txt", { content: "hello" });
  const open = d.openFile();
  const dialog = current(s);
  const list = dialog.querySelector(".dlg-file-list");
  const views = dialog.querySelector('[data-action="views"]');
  const menu = dialog.querySelector(".dlg-file-views-menu");
  expect(list.dataset.view).toBe("list");
  views.click();
  expect(menu.hidden).toBeFalse();
  expect(
    [...menu.querySelectorAll("button")].map(
      (item) => `${item.firstChild.textContent}${item.lastChild.textContent}`,
    ),
  ).toEqual(["Thumbnails", "Tiles", "Icons", "•List", "Details"]);
  views.click();
  expect(menu.hidden).toBeTrue();
  const choose = (label) => {
    views.click();
    [...menu.querySelectorAll("button")]
      .find((item) => item.textContent.includes(label))
      .click();
  };
  choose("Details");
  expect(list.dataset.view).toBe("details");
  expect(list.querySelector(".dlg-file-header").textContent).toBe(
    "NameSizeTypeDate Modified",
  );
  const note = [...list.querySelectorAll(".dlg-file-item")].find((item) =>
    item.textContent.startsWith("notes.txt"),
  );
  expect(
    [...note.querySelectorAll(".dlg-file-item-detail")].map(
      (cell) => cell.textContent,
    ),
  ).toEqual([
    "1 KB",
    "Text Document",
    expect.stringMatching(/^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2} [AP]M$/),
  ]);
  const music = [...list.querySelectorAll(".dlg-file-item")].find((item) =>
    item.textContent.startsWith("My Music"),
  );
  expect(music.querySelector(".dlg-file-item-detail").textContent).toBe("");
  choose("Tiles");
  expect(list.dataset.view).toBe("tiles");
  expect(list.querySelectorAll(".dlg-file-item-detail").length).toBeGreaterThan(
    0,
  );
  // The arrows move through the menu and Enter chooses.
  views.click();
  const items = [...menu.querySelectorAll("button")];
  expect(s.document.activeElement).toBe(items[1]);
  items[4].dispatchEvent(new s.window.MouseEvent("pointerenter"));
  expect(s.document.activeElement).toBe(items[4]);
  key(s, "ArrowUp");
  key(s, "Enter");
  expect(list.dataset.view).toBe("list");
  expect(menu.hidden).toBeTrue();
  expect(s.document.activeElement).toBe(views);
  choose("Icons");
  expect(list.dataset.view).toBe("icons");
  // Each view's access key is underlined and chooses it. Other letters do
  // nothing, and never press Open behind the menu.
  views.click();
  expect(
    [...menu.querySelectorAll(".menu-accesskey")].map((key) => key.textContent),
  ).toEqual(["h", "s", "n", "L", "D"]);
  key(s, "o");
  expect(menu.hidden).toBeFalse();
  expect(current(s)).toBe(dialog);
  // Tab does nothing in the menu, like XP.
  const menuKey = s.document.activeElement;
  key(s, "Tab");
  keyOn(s, menuKey, "Tab", { shiftKey: true });
  expect(menu.hidden).toBeFalse();
  expect(s.document.activeElement === menuKey).toBeTrue();
  // AltGr types "ś" on the S key of a Polish keyboard. It chooses no view.
  pressAltGr(s.window, menuKey, "ś", "KeyS");
  expect(menu.hidden).toBeFalse();
  expect(list.dataset.view).toBe("icons");
  // Alt and a letter closes the menu and chooses no view.
  keyOn(s, menuKey, "s", { altKey: true, code: "KeyS" });
  expect(menu.hidden).toBeTrue();
  expect(list.dataset.view).toBe("icons");
  views.click();
  key(s, "S");
  expect(list.dataset.view).toBe("tiles");
  expect(menu.hidden).toBeTrue();
  expect(s.document.activeElement).toBe(views);
  choose("Icons");
  // The chosen view stays when the folder changes.
  [...dialog.querySelectorAll(".dlg-file-place")]
    .find((place) => place.textContent === "Desktop")
    .click();
  expect(list.dataset.view).toBe("icons");
  key(s, "Escape");
  expect(await open).toBeNull();
});

test("File name drops down the names used before, and the grip resizes", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  for (const name of ["first.txt", "second.txt", "first.txt"]) {
    const save = d.saveFile({ defaultName: name });
    key(s, "Enter");
    expect((await save).name).toBe(name);
    fs.createFile(fs.MY_DOCUMENTS, `${name}.keep`, { content: "" });
  }
  // A name the dialog refuses is not remembered.
  const open = d.openFile();
  s.document.getElementById("dlg-file-name").value = "missing.txt";
  key(s, "Enter");
  await flushShell();
  key(s, "Enter");
  await flushShell();
  const dialog = current(s);
  const input = dialog.querySelector("#dlg-file-name");
  const arrow = dialog.querySelector(".dlg-file-name-arrow");
  const list = dialog.querySelector(".dlg-file-name-list");
  arrow.click();
  expect(list.hidden).toBeFalse();
  expect(input.getAttribute("aria-expanded")).toBe("true");
  expect(
    [...list.querySelectorAll(".dlg-file-name-option")].map(
      (row) => row.textContent,
    ),
  ).toEqual(["first.txt", "second.txt"]);
  arrow.click();
  expect(list.hidden).toBeTrue();
  arrow.click();
  key(s, "ArrowDown");
  key(s, "ArrowDown");
  key(s, "Enter");
  expect(input.value).toBe("second.txt");
  arrow.click();
  const first = list.querySelector(".dlg-file-name-option");
  first.dispatchEvent(new s.window.MouseEvent("pointerenter"));
  expect(first.classList.contains("selected")).toBeTrue();
  first.click();
  expect(input.value).toBe("first.txt");
  expect(list.hidden).toBeTrue();
  // Enter with nothing highlighted only closes the list.
  arrow.click();
  key(s, "Enter");
  expect(list.hidden).toBeTrue();
  expect(input.value).toBe("first.txt");
  // Opening another drop-down closes this one.
  arrow.click();
  dialog.querySelector(".dlg-file-folder").click();
  expect(list.hidden).toBeTrue();
  key(s, "Escape");
  // F4, Alt+Down and Down open the list from the File name box, and the
  // box names the highlighted row. Typed letters go into the box.
  input.focus();
  keyOn(s, input, "F4");
  expect(list.hidden).toBeFalse();
  expect(input.getAttribute("aria-controls")).toBe(list.id);
  key(s, "ArrowDown");
  expect(input.getAttribute("aria-activedescendant")).toBe(
    list.querySelector(".selected").id,
  );
  keyOn(s, input, "F4");
  expect(list.hidden).toBeTrue();
  expect(input.hasAttribute("aria-activedescendant")).toBeFalse();
  keyOn(s, input, "ArrowDown", { altKey: true });
  expect(list.hidden).toBeFalse();
  keyOn(s, input, "ArrowDown", { altKey: true });
  expect(list.hidden).toBeTrue();
  keyOn(s, input, "ArrowDown");
  expect(list.hidden).toBeFalse();
  keyOn(s, input, "c");
  // AltGr characters type as usual and keep the list open.
  keyOn(s, input, "@", { altKey: true, ctrlKey: true });
  expect(list.hidden).toBeFalse();
  // A mouse press on the arrow keeps the focus in the box.
  const press = new s.window.MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  arrow.dispatchEvent(press);
  expect(press.defaultPrevented).toBeTrue();
  expect(current(s)).toBe(dialog);
  // Open closes the list before it checks the name.
  dialog.querySelector(".dlg-buttons [data-action]").click();
  expect(list.hidden).toBeTrue();
  await flushShell();
  key(s, "Enter");
  await flushShell();
  keyOn(s, input, "Home");
  expect(list.hidden).toBeTrue();

  // Field labels focus their fields with Alt and the access key.
  keyOn(s, dialog.querySelector(".dlg-file-type"), "n", { altKey: true });
  expect(s.document.activeElement).toBe(input);
  keyOn(s, input, "t", { altKey: true });
  expect(s.document.activeElement).toBe(dialog.querySelector(".dlg-file-type"));
  keyOn(s, s.document.activeElement, "i", { altKey: true });
  expect(s.document.activeElement).toBe(
    dialog.querySelector(".dlg-file-folder"),
  );

  // The grip makes the dialog larger, up to the screen's edge, and never
  // smaller than it opened. It pins the dialog, so it grows to the right
  // and down only.
  const grip = dialog.querySelector(".dlg-file-grip");
  const body = dialog.querySelector(".dlg-body");
  const overlay = dialog.parentElement;
  const rect = (left, top, right, bottom) => () => ({
    left,
    top,
    right,
    bottom,
  });
  overlay.getBoundingClientRect = rect(0, 0, 1024, 768);
  dialog.getBoundingClientRect = rect(200, 100, 758, 514);
  Object.defineProperty(dialog, "offsetWidth", {
    get: () => parseInt(dialog.style.width, 10) || 558,
  });
  Object.defineProperty(body, "offsetHeight", {
    get: () => parseInt(body.style.height, 10) || 384,
  });
  Object.defineProperty(dialog, "offsetHeight", {
    get: () => body.offsetHeight + 30,
  });
  const drag = (fromX, fromY, toX, toY) => {
    grip.dispatchEvent(
      new s.window.MouseEvent("pointerdown", {
        button: 0,
        clientX: fromX,
        clientY: fromY,
        bubbles: true,
      }),
    );
    s.document.dispatchEvent(
      new s.window.MouseEvent("pointermove", { clientX: toX, clientY: toY }),
    );
  };
  grip.dispatchEvent(
    new s.window.MouseEvent("pointerdown", { button: 2, bubbles: true }),
  );
  expect(dialog.style.left).toBe("");
  drag(100, 100, 160, 140);
  expect(dialog.style.left).toBe("200px");
  expect(dialog.style.top).toBe("100px");
  expect(dialog.style.width).toBe("618px");
  expect(body.style.height).toBe("424px");
  s.document.dispatchEvent(
    new s.window.MouseEvent("pointermove", { clientX: 2000, clientY: 2000 }),
  );
  expect(dialog.style.width).toBe("824px");
  expect(body.style.height).toBe("638px");
  s.document.dispatchEvent(new s.window.MouseEvent("pointerup"));
  s.document.dispatchEvent(
    new s.window.MouseEvent("pointermove", { clientX: 300, clientY: 300 }),
  );
  expect(dialog.style.width).toBe("824px");
  // A later drag can shrink it back to the size it opened at, not less.
  drag(100, 100, -1000, -1000);
  expect(dialog.style.width).toBe("558px");
  expect(body.style.height).toBe("384px");
  s.document.dispatchEvent(new s.window.MouseEvent("pointercancel"));
  s.document.dispatchEvent(
    new s.window.MouseEvent("pointermove", { clientX: 300, clientY: 300 }),
  );
  expect(dialog.style.width).toBe("558px");
  key(s, "Escape");
  expect(await open).toBeNull();
});

test("a file dialog that accepts an empty name remembers nothing", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const picked = d.browseFiles({
    title: "Pick",
    startFolder: fs.USER_PROFILE,
    acceptLabel: "&Open",
    folderLabel: "Look &in:",
    onAccept: ({ name }) => `picked:${name}`,
  });
  // The profile's Recent folder is hidden, like XP's.
  expect(
    [...current(s).querySelectorAll(".dlg-file-item")].map(
      (item) => item.textContent,
    ),
  ).not.toContain("Recent");
  // Enter on the Look in box runs the default button, like XP's.
  current(s).querySelector(".dlg-file-folder").focus();
  key(s, "Enter");
  expect(await picked).toBe("picked:");
  const open = d.openFile();
  current(s).querySelector(".dlg-file-name-arrow").click();
  expect(current(s).querySelectorAll(".dlg-file-name-option")).toHaveLength(0);
  key(s, "Escape");
  key(s, "Escape");
  expect(await open).toBeNull();
});

test("Thumbnails view shows pictures, and other items keep their icons", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const art = "data:image/png;base64,iVBORw0KGgo=";
  fs.createFile(fs.MY_PICTURES, "art.png", { content: art });
  fs.createFile(fs.MY_PICTURES, "broken.png", {
    content: "data:image/png;base64,AAAA",
  });
  fs.createFile(fs.MY_PICTURES, "notes.txt", { content: "hello" });
  const open = d.openFile({ startFolder: fs.MY_PICTURES });
  const list = current(s).querySelector(".dlg-file-list");
  expect(list.dataset.view).toBe("thumbnails");
  const item = (name) =>
    [...list.querySelectorAll(".dlg-file-item")].find(
      (element) =>
        element.querySelector(".dlg-file-item-name").textContent === name,
    );
  const picture = (name) => item(name).querySelector(".thumbnail-picture");
  expect(picture("art.png").getAttribute("src")).toBe(art);
  expect(picture("notes.txt")).toBeNull();
  expect(picture("Sample Pictures")).toBeNull();
  // A folder shows its first 4 pictures on a large folder, like XP.
  expect(
    [
      ...item("Sample Pictures").querySelectorAll(
        ".folder-thumbnail-pictures img",
      ),
    ].map((image) => image.getAttribute("src")),
  ).toEqual([
    "/assets/xp/sample-pictures/blue-hills.jpg",
    "/assets/xp/sample-pictures/sunset.jpg",
    "/assets/xp/sample-pictures/water-lilies.jpg",
    "/assets/xp/sample-pictures/winter.jpg",
  ]);
  // A picture the browser cannot draw shows its icon instead.
  picture("broken.png").dispatchEvent(new s.window.Event("error"));
  expect(picture("broken.png")).toBeNull();
  expect(item("broken.png").querySelector(".dlg-node-icon img")).not.toBeNull();
  // The sample pictures show the pictures from the XP CD.
  item("Sample Pictures").dispatchEvent(new s.window.MouseEvent("dblclick"));
  expect(
    [...list.querySelectorAll(".thumbnail-picture")].map((image) =>
      image.getAttribute("src"),
    ),
  ).toEqual([
    "/assets/xp/sample-pictures/blue-hills.jpg",
    "/assets/xp/sample-pictures/sunset.jpg",
    "/assets/xp/sample-pictures/water-lilies.jpg",
    "/assets/xp/sample-pictures/winter.jpg",
  ]);
  // Other views keep the icons.
  current(s).querySelector('[data-action="views"]').click();
  [...current(s).querySelectorAll(".dlg-file-views-menu button")]
    .find((button) => button.textContent.includes("Icons"))
    .click();
  expect(list.querySelector(".thumbnail-picture")).toBeNull();
  key(s, "Escape");
  expect(await open).toBeNull();
});

test("Save adds the default extension before it looks for a file to replace", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const readme = fs.createFile(fs.MY_DOCUMENTS, "readme.txt", {
    content: "old",
  });
  const save = (name) => {
    const result = d.saveFile({
      startFolder: fs.MY_DOCUMENTS,
      defaultExtension: ".txt",
    });
    const dialog = current(s);
    dialog.querySelector("#dlg-file-name").value = name;
    [...dialog.querySelectorAll(".dlg-buttons button")]
      .find((button) => button.textContent === "Save")
      .click();
    return result;
  };
  const replacing = save("readme");
  await flushShell();
  expect(current(s).textContent).toContain("readme.txt already exists.");
  current(s).querySelector('[data-action="yes"]').click();
  expect(await replacing).toEqual({
    parentId: fs.MY_DOCUMENTS,
    name: "readme.txt",
    existingId: readme.id,
  });
  // A name keeps an extension of the listed types. Any other dot is part
  // of the name, so Notepad can still open the file.
  const typed = async (name, filter, allFiles = false) => {
    const result = d.saveFile({
      startFolder: fs.MY_DOCUMENTS,
      defaultExtension: ".txt",
      filter,
    });
    const dialog = current(s);
    if (allFiles) {
      const type = dialog.querySelector(".dlg-file-type");
      type.value = "";
      type.dispatchEvent(new s.window.Event("change"));
    }
    dialog.querySelector("#dlg-file-name").value = name;
    [...dialog.querySelectorAll(".dlg-buttons button")]
      .find((button) => button.textContent === "Save")
      .click();
    return (await result).name;
  };
  expect(await typed("server.log")).toBe("server.log");
  expect(await typed("NOTES.TXT", [".txt"])).toBe("NOTES.TXT");
  expect(await typed("v1.2 draft", [".txt"])).toBe("v1.2 draft.txt");
  expect(await typed("server.log", [".txt"])).toBe("server.log.txt");
  // All Files keeps any extension the name has.
  expect(await typed("server.log", [".txt"], true)).toBe("server.log");
  expect(await typed("todo", [".txt"], true)).toBe("todo.txt");
  // A leading dot starts the name, not an extension, as on the disk.
  expect(await typed(".txt", [".txt"])).toBe(".txt.txt");
});

test("Open and Save open a folder whose name is typed, like XP", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  for (const [show, label] of [
    [() => d.openFile({ startFolder: fs.MY_DOCUMENTS }), "Open"],
    [() => d.saveFile({ startFolder: fs.MY_DOCUMENTS }), "Save"],
  ]) {
    const result = show();
    const dialog = current(s);
    const name = dialog.querySelector("#dlg-file-name");
    name.value = "my pictures";
    [...dialog.querySelectorAll(".dlg-buttons button")]
      .find((button) => button.textContent === label)
      .click();
    await flushShell();
    expect(current(s)).toBe(dialog);
    expect(dialog.querySelector(".dlg-file-folder").textContent).toContain(
      "My Pictures",
    );
    // Like XP, the typed text stays in the box, all selected.
    expect(name.value).toBe("my pictures");
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe("my pictures".length);
    expect(s.document.activeElement).toBe(name);
    // Back returns to the folder the dialog came from.
    dialog.querySelector('[data-action="back"]').click();
    expect(dialog.querySelector(".dlg-file-folder").textContent).toContain(
      "My Documents",
    );
    key(s, "Escape");
    expect(await result).toBeNull();
  }
});

test("Save As and Open take patterns, paths and the file system's name rules, like XP", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const sub = fs.createFolder(fs.MY_DOCUMENTS, "Sub");
  const inside = fs.createFile(sub.id, "inside.txt", { content: "" });
  // Like XP, "*.*" also shows a file with no extension.
  fs.createFile(sub.id, "noext", { content: "" });
  fs.createFile(fs.MY_DOCUMENTS, "notes.txt", { content: "" });
  fs.createFile(fs.MY_DOCUMENTS, "note.txt", { content: "" });
  fs.createFile(fs.MY_DOCUMENTS, "photo.bmp", { content: "" });
  const names = (dialog) =>
    [...dialog.querySelectorAll(".dlg-file-item")].map((item) =>
      item.textContent.trim(),
    );
  const folderOf = (dialog) =>
    dialog.querySelector(".dlg-file-folder").textContent;
  const submit = (dialog, label, typed) => {
    dialog.querySelector("#dlg-file-name").value = typed;
    [...dialog.querySelectorAll(".dlg-buttons button")]
      .find((button) => button.textContent === label)
      .click();
  };
  // A warning keeps the dialog open. OK closes the warning.
  const warning = async (dialog) => {
    await flushShell();
    const box = current(s);
    expect(box === dialog).toBeFalse();
    const text = box.textContent;
    box.querySelector('[data-action="ok"]').click();
    await flushShell();
    expect(current(s) === dialog).toBeTrue();
    return text;
  };

  for (const [show, label] of [
    [
      () =>
        d.saveFile({
          startFolder: fs.MY_DOCUMENTS,
          defaultExtension: ".txt",
          filter: [".txt"],
        }),
      "Save",
    ],
    [
      () => d.openFile({ startFolder: fs.MY_DOCUMENTS, filter: [".txt"] }),
      "Open",
    ],
  ]) {
    show();
    const dialog = current(s);
    const box = dialog.querySelector("#dlg-file-name");
    // A pattern shows only the files that match it, and stays in the box.
    submit(dialog, label, "note?.txt");
    await flushShell();
    expect(current(s) === dialog).toBeTrue();
    expect(names(dialog)).toEqual([
      "My Music",
      "My Pictures",
      "Sub",
      "notes.txt",
    ]);
    expect(box.value).toBe("note?.txt");
    submit(dialog, label, "*.bmp");
    await flushShell();
    expect(names(dialog)).toEqual([
      "My Music",
      "My Pictures",
      "Sub",
      "photo.bmp",
    ]);
    // A pattern with a folder opens that folder with the pattern.
    submit(dialog, label, "sub\\*.*");
    await flushShell();
    expect(folderOf(dialog)).toBe("Sub");
    expect(names(dialog)).toEqual(["inside.txt", "noext"]);
    expect(box.value).toBe("*.*");
    // Like XP, the pattern of a type chooses that type, in any case.
    const type = dialog.querySelector(".dlg-file-type");
    expect(type.value).toBe("");
    submit(dialog, label, "*.TXT");
    await flushShell();
    expect(type.value).toBe(".txt");
    expect(names(dialog)).toEqual(["inside.txt"]);
    expect(box.value).toBe("*.TXT");
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 5]);
    // A pattern that is not a type keeps the type. A ".*" at the end also
    // takes a name with no extension.
    submit(dialog, label, "*.bak");
    await flushShell();
    expect(type.value).toBe(".txt");
    expect(names(dialog)).toEqual([]);
    submit(dialog, label, "n*.*");
    await flushShell();
    expect(type.value).toBe(".txt");
    expect(names(dialog)).toEqual(["noext"]);
    // A new file type ends the pattern.
    type.value = "";
    type.dispatchEvent(new s.window.Event("change"));
    expect(names(dialog)).toEqual(["inside.txt", "noext"]);
    // "..", "\" at the end, "C:" and "\" at the start move between folders.
    submit(dialog, label, "..");
    await flushShell();
    expect(folderOf(dialog)).toBe("My Documents");
    expect(names(dialog)).toContain("photo.bmp");
    expect(box.value).toBe("..");
    submit(dialog, label, "Sub\\");
    await flushShell();
    expect(folderOf(dialog)).toBe("Sub");
    submit(dialog, label, "C:");
    await flushShell();
    expect(folderOf(dialog)).toMatch(/C:/);
    submit(dialog, label, "\\Documents and Settings");
    await flushShell();
    expect(folderOf(dialog)).toBe("Documents and Settings");
    dialog.querySelector('[data-action="back"]').click();
    dialog.querySelector('[data-action="back"]').click();
    dialog.querySelector('[data-action="back"]').click();
    expect(folderOf(dialog)).toBe("My Documents");
    // A path that is not there, or that goes through a file, is refused.
    submit(dialog, label, "Nope\\x");
    expect(await warning(dialog)).toContain(
      "Nope\\x\nPath does not exist.\nCheck the path and try again.",
    );
    submit(dialog, label, "notes.txt\\x");
    expect(await warning(dialog)).toContain("Path does not exist.");
    // The file system's name rules, before the dialog closes.
    submit(dialog, label, "con");
    expect(await warning(dialog)).toContain(
      "This file name is reserved for use by Windows.",
    );
    submit(dialog, label, "bad<name");
    expect(await warning(dialog)).toContain("The above file name is invalid.");
    // ".." at the top stays at the top.
    submit(dialog, label, "..\\..\\..\\..\\..");
    await flushShell();
    const top = folderOf(dialog);
    submit(dialog, label, "..");
    await flushShell();
    expect(folderOf(dialog)).toBe(top);
    key(s, "Escape");
  }

  // A path names a file in another folder.
  let result = d.saveFile({
    startFolder: fs.MY_DOCUMENTS,
    defaultExtension: ".txt",
  });
  submit(current(s), "Save", "Sub\\made");
  expect(await result).toEqual({
    parentId: sub.id,
    name: "made.txt",
    existingId: null,
  });
  // A "\\" at the start is the top of the drive.
  result = d.saveFile({
    startFolder: fs.MY_DOCUMENTS,
    defaultExtension: ".txt",
  });
  submit(current(s), "Save", "\\top");
  expect(await result).toEqual({
    parentId: fs.resolvePath("C:\\"),
    name: "top.txt",
    existingId: null,
  });
  // Like Windows, it is the drive of the open folder.
  const data = fs.createFolder(fs.DRIVE_D, "Data");
  result = d.saveFile({ startFolder: data.id, defaultExtension: ".txt" });
  submit(current(s), "Save", "\\top");
  expect(await result).toEqual({
    parentId: fs.resolvePath("D:\\"),
    name: "top.txt",
    existingId: null,
  });
  result = d.openFile({ startFolder: fs.MY_DOCUMENTS });
  submit(current(s), "Open", "./sub/inside.txt");
  expect((await result).id).toBe(inside.id);
});

test("Ctrl+A does not select all in a one-line box of a dialog, like XP", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const ctrlA = (element, init = { ctrlKey: true }) => {
    const event = new s.window.KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const result = d.openFile({ startFolder: s.window.VirtualFS.MY_DOCUMENTS });
  const dialog = current(s);
  const name = dialog.querySelector("#dlg-file-name");
  name.focus();
  expect(ctrlA(name)).toBeTrue();
  expect(ctrlA(name, { metaKey: true })).toBeTrue();
  expect(ctrlA(name, { key: "A", ctrlKey: true, shiftKey: true })).toBeTrue();
  // Other keys, and Ctrl+Alt+A, stay with the box.
  expect(ctrlA(name, {})).toBeFalse();
  expect(ctrlA(name, { ctrlKey: true, altKey: true })).toBeFalse();
  key(s, "Escape");
  expect(await result).toBeNull();
  // Each dialog's one-line box acts the same. A multi-line box does not.
  const plain = d.createDialog({ title: "Run" });
  const box = s.document.createElement("input");
  const area = s.document.createElement("textarea");
  plain.body.append(box, area);
  box.focus();
  expect(ctrlA(box)).toBeTrue();
  area.focus();
  expect(ctrlA(area)).toBeFalse();
  plain.close();
});

test("a one-line box keeps only the first line of pasted text, like XP", async () => {
  const s = await login(await loadShell());
  const paste = (element, text) => {
    const clipboardData = new s.window.DataTransfer();
    clipboardData.setData("text/plain", text);
    const event = new s.window.ClipboardEvent("paste", {
      clipboardData,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const result = s.window.XPDialogs.openFile({
    startFolder: s.window.VirtualFS.MY_DOCUMENTS,
  });
  const name = current(s).querySelector("#dlg-file-name");
  for (const [text, value] of [
    ["one\ntwo", "aonec"],
    ["one\r\ntwo\r\n", "aonec"],
    ["one\rtwo", "aonec"],
  ]) {
    name.value = "abc";
    name.setSelectionRange(1, 2);
    expect(paste(name, text)).toBeTrue();
    expect(name.value).toBe(value);
    expect(name.selectionStart).toBe(4);
  }
  // An empty first line replaces the selection, and puts in nothing at
  // the caret.
  name.value = "abc";
  name.setSelectionRange(1, 2);
  expect(paste(name, "\ntwo")).toBeTrue();
  expect(name.value).toBe("ac");
  name.setSelectionRange(1, 1);
  expect(paste(name, "\ntwo")).toBeTrue();
  expect(name.value).toBe("ac");
  // One line is the browser's own paste.
  expect(paste(name, "one")).toBeFalse();
  key(s, "Escape");
  expect(await result).toBeNull();
  // Each one-line box acts the same. Other boxes keep the browser's paste.
  const box = s.document.createElement("input");
  const area = s.document.createElement("textarea");
  const check = s.document.createElement("input");
  check.type = "checkbox";
  const locked = s.document.createElement("input");
  locked.readOnly = true;
  s.document.body.append(box, area, check, locked);
  expect(paste(box, "x\ny")).toBeTrue();
  expect(box.value).toBe("x");
  for (const other of [area, check, locked])
    expect(paste(other, "x\ny")).toBeFalse();
  box.disabled = true;
  expect(paste(box, "x\ny")).toBeFalse();
  // A paste with no text does nothing.
  box.disabled = false;
  const empty = new s.window.ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
  });
  box.dispatchEvent(empty);
  expect(empty.defaultPrevented).toBeFalse();
  expect(box.value).toBe("x");
  // A number box has no caret position. It takes the first line at its
  // own selection, with the browser's edit, and an empty first line puts
  // in nothing. A browser without that edit gets the first line.
  const number = s.document.createElement("input");
  number.type = "number";
  s.document.body.append(number);
  expect(paste(number, "45\n67")).toBeTrue();
  expect(number.value).toBe("45");
  const edits = [];
  s.document.execCommand = (command, ui, text) => {
    edits.push([command, text]);
    return true;
  };
  try {
    expect(paste(number, "8\n9")).toBeTrue();
    expect(paste(number, "\n9")).toBeTrue();
  } finally {
    delete s.document.execCommand;
  }
  expect(edits).toEqual([["insertText", "8"]]);
  expect(number.value).toBe("45");
});

test("Create New Folder makes a folder with a rename box, like XP", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  fs.createFolder(fs.MY_DOCUMENTS, "Taken");
  const result = d.saveFile({ startFolder: fs.MY_DOCUMENTS });
  const dialog = current(s);
  const name = dialog.querySelector("#dlg-file-name");
  const button = dialog.querySelector('[data-action="new-folder"]');
  const box = () => dialog.querySelector(".dlg-file-rename");
  const folders = () =>
    fs.getChildren(fs.MY_DOCUMENTS).map((node) => node.name);
  name.value = "typed";
  expect(button.disabled).toBeFalse();
  button.click();
  await flushShell();
  // The box has the new name, all selected. File name keeps its text.
  expect(box().value).toBe("New Folder");
  expect(s.document.activeElement === box()).toBeTrue();
  expect([box().selectionStart, box().selectionEnd]).toEqual([0, 10]);
  expect(
    box().closest(".dlg-file-item").classList.contains("selected"),
  ).toBeTrue();
  expect(name.value).toBe("typed");
  // Clicks in the box stay in the box.
  box().click();
  box().dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  expect(current(s) === dialog).toBeTrue();
  expect(box()).not.toBeNull();
  // Other keys, and the keys of an input method, stay in the box.
  for (const init of [{ key: "a" }, { key: "Enter", isComposing: true }])
    box().dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  expect(box()).not.toBeNull();
  // Enter gives the name and does not press Save. The blur of the box
  // that goes away does nothing more.
  const named = box();
  named.value = "nf. ";
  key(s, "Enter");
  await flushShell();
  named.dispatchEvent(new s.window.FocusEvent("blur"));
  await flushShell();
  expect(current(s) === dialog).toBeTrue();
  expect(box()).toBeNull();
  expect(folders()).toContain("nf");
  expect(name.value).toBe("typed");
  expect(
    s.document.activeElement.querySelector(".dlg-file-item-name").textContent,
  ).toBe("nf");
  // A name in use shows Explorer's error, and the box opens again with the
  // old name.
  button.click();
  await flushShell();
  box().value = "Taken";
  key(s, "Enter");
  await flushShell();
  const error = current(s);
  expect(error === dialog).toBeFalse();
  expect(error.textContent).toContain("Cannot rename New Folder");
  error.querySelector('[data-action="ok"]').click();
  await flushShell();
  expect(box().value).toBe("New Folder");
  // A box whose folder went out of the list during the error opens no
  // more.
  box().value = "Taken";
  key(s, "Enter");
  await flushShell();
  const second = current(s);
  dialog.querySelector('[data-action="up"]').click();
  second.querySelector('[data-action="ok"]').click();
  await flushShell();
  expect(box()).toBeNull();
  dialog.querySelector('[data-action="back"]').click();
  expect(folders()).toContain("New Folder");
  button.click();
  await flushShell();
  expect(box().value).toBe("New Folder (2)");
  // Esc keeps the name and does not close the dialog.
  key(s, "Escape");
  await flushShell();
  expect(current(s) === dialog).toBeTrue();
  expect(box()).toBeNull();
  expect(folders()).toContain("New Folder");
  // A click elsewhere gives the name and leaves the keys there.
  button.click();
  await flushShell();
  expect(box().value).toBe("New Folder (3)");
  box().value = "elsewhere";
  name.focus();
  await flushShell();
  expect(folders()).toContain("elsewhere");
  expect(s.document.activeElement === name).toBeTrue();
  // An empty name keeps the old name.
  button.click();
  await flushShell();
  box().value = " ";
  key(s, "Enter");
  await flushShell();
  expect(folders()).toContain("New Folder (3)");
  // Like XP, My Computer takes no new folder.
  [...dialog.querySelectorAll(".dlg-file-place")]
    .find((place) => place.textContent === "My Computer")
    .click();
  expect(dialog.querySelector(".dlg-file-folder").textContent).toBe(
    "My Computer",
  );
  expect(button.disabled).toBeTrue();
  key(s, "Escape");
  expect(await result).toBeNull();
});

test("Create New Folder waits for the file system and shows its error", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const create = fs.createFolder;
  // Like the stored file system, the folder comes later.
  let release;
  fs.createFolder = (...args) =>
    new Promise((resolve) => {
      release = () => resolve(create(...args));
    });
  const result = d.saveFile({ startFolder: fs.MY_DOCUMENTS });
  const dialog = current(s);
  dialog.querySelector('[data-action="new-folder"]').click();
  await flushShell();
  expect(dialog.querySelector(".dlg-file-rename")).toBeNull();
  release();
  await flushShell();
  expect(dialog.querySelector(".dlg-file-rename").value).toBe("New Folder");
  key(s, "Escape");
  // A dialog in another folder, or a closed dialog, gets no box.
  dialog.querySelector('[data-action="new-folder"]').click();
  await flushShell();
  dialog.querySelector('[data-action="up"]').click();
  release();
  await flushShell();
  expect(dialog.querySelector(".dlg-file-rename")).toBeNull();
  dialog.querySelector('[data-action="new-folder"]').click();
  await flushShell();
  key(s, "Escape");
  expect(await result).toBeNull();
  release();
  await flushShell();
  expect(dialog.querySelector(".dlg-file-rename")).toBeNull();
  fs.createFolder = create;
});

// The XP SP3 VM: a rename asks first when the old extension is a type that
// XP knows (it has a program), and the extension changes or goes away.
test("the extension question follows XP's registered file types", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const asks = async (name, newName) => {
    const node = fs.createFile(fs.MY_DOCUMENTS, name, { content: "" });
    const answer = d.confirmExtensionChange(node, newName);
    await flushShell();
    const asked = dialogs(s).length > 0;
    if (asked) key(s, "y");
    expect(await answer).toBeTrue();
    fs.destroy(node.id);
    return asked;
  };
  for (const [name, newName, asked] of [
    ["a.xyz", "a.txt", false],
    ["a.txt", "a.qqz", true],
    ["k.qqq", "k.zzz", false],
    ["b.txt", "b", true],
    ["noext", "noext.txt", false],
    ["song.mp3", "song.txt", true],
    ["setup.ini", "setup.old", true],
    ["page.HTM", "page.txt", true],
    ["notes.log", "notes.LOG", false],
  ])
    expect(await asks(name, newName)).toBe(asked);
});

test("F2 renames a file in the Open and Save As lists, with Explorer's rules", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.MY_DOCUMENTS, "b.txt", { content: "" });
  const other = fs.createFile(fs.MY_DOCUMENTS, "c.txt", { content: "" });
  const result = d.saveFile({ startFolder: fs.MY_DOCUMENTS, filter: null });
  const dialog = current(s);
  const name = dialog.querySelector("#dlg-file-name");
  const item = () =>
    dialog.querySelector(`.dlg-file-item[data-node-id="${file.id}"]`);
  const box = () => dialog.querySelector(".dlg-file-rename");
  const press = (target, init) => {
    const event = new s.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  item().click();
  expect(name.value).toBe("b.txt");
  // F2 with a modifier key does nothing.
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"])
    expect(press(item(), { key: "F2", [modifier]: true })).toBeFalse();
  expect(box()).toBeNull();
  expect(press(item(), { key: "F2" })).toBeTrue();
  expect(box().value).toBe("b.txt");
  // A new extension asks first, and the box keeps the new name meanwhile.
  box().value = "bb.qqz";
  key(s, "Enter");
  await flushShell();
  expect(current(s).querySelector(".dlg-text").textContent).toBe(
    "If you change a file name extension, the file may become unusable.\n\nAre you sure you want to change it?",
  );
  expect(dialog.querySelector(".dlg-file-rename").value).toBe("bb.qqz");
  // No opens the box again with the old name.
  key(s, "n");
  await flushShell();
  expect(current(s) === dialog).toBeTrue();
  expect(box().value).toBe("b.txt");
  // Yes renames. Like XP, the File name box keeps its text.
  box().value = "bb.qqz";
  key(s, "Enter");
  await flushShell();
  key(s, "y");
  await flushShell();
  expect(fs.getNode(file.id).name).toBe("bb.qqz");
  expect(box()).toBeNull();
  expect(name.value).toBe("b.txt");
  // A question that comes back after the dialog closed opens no box.
  press(dialog.querySelector(`.dlg-file-item[data-node-id="${other.id}"]`), {
    key: "F2",
  });
  box().value = "c.doc";
  key(s, "Enter");
  await flushShell();
  const question = current(s);
  dialog.querySelector('[data-action="cancel"]').click();
  question.querySelector('[data-action="no"]').click();
  await flushShell();
  expect(await result).toBeNull();
  expect(fs.getNode(other.id).name).toBe("c.txt");
  expect(dialog.querySelector(".dlg-file-rename")).toBeNull();

  // A protected folder, such as My Music, keeps its name.
  const open = d.openFile({ startFolder: fs.MY_DOCUMENTS });
  const music = current(s).querySelector(
    `.dlg-file-item[data-node-id="${fs.findChild(fs.MY_DOCUMENTS, "My Music").id}"]`,
  );
  expect(press(music, { key: "F2" })).toBeFalse();
  expect(current(s).querySelector(".dlg-file-rename")).toBeNull();
  key(s, "Escape");
  expect(await open).toBeNull();
});

// Like XP's MessageBox, a box with no Cancel answer has a gray close
// button, and Esc and Alt+F4 do nothing. XP's own questions, such as
// Confirm File Delete, close with Esc as No.
test("a Yes and No message box has a gray close button, like XP", async () => {
  const s = await login(await loadShell());
  const d = s.window.XPDialogs;
  const keyWith = (name, init) =>
    s.document.activeElement.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  const closeButton = () => current(s).querySelector(".close-btn");
  const pending = d.confirm("Go on?");
  await flushShell();
  const box = current(s);
  expect(closeButton().disabled).toBeTrue();
  key(s, "Escape");
  keyWith("F4", { altKey: true });
  closeButton().click();
  await flushShell();
  expect(box.isConnected).toBeTrue();
  key(s, "n");
  expect(await pending).toBeFalse();
  // Yes, No and Cancel, OK alone, and a one-button box close with Esc.
  for (const [buttons, answer] of [
    [d.BUTTON_SETS.yesNoCancel, "cancel"],
    [d.BUTTON_SETS.ok, "ok"],
    [d.BUTTON_SETS.yesNoClosable, "no"],
  ]) {
    const shown = d.message({ text: "?", buttons });
    await flushShell();
    expect(closeButton().disabled).toBeFalse();
    key(s, "Escape");
    expect(await shown).toBe(answer);
  }
  // Alt+F4 closes a box that can close.
  const shown = d.message({ text: "?", buttons: d.BUTTON_SETS.okCancel });
  await flushShell();
  keyWith("F4", { altKey: true });
  expect(await shown).toBe("cancel");
  // The Save As question about a file that exists has the dialog's title.
  const fs = s.window.VirtualFS;
  fs.createFile(fs.MY_DOCUMENTS, "here.txt", { content: "" });
  const save = d.saveFile({ title: "Save As", startFolder: fs.MY_DOCUMENTS });
  current(s).querySelector("#dlg-file-name").value = "here.txt";
  current(s).querySelector('[data-action="accept"]').click();
  await flushShell();
  expect(current(s).getAttribute("aria-label")).toBe("Save As");
  expect(closeButton().disabled).toBeTrue();
  key(s, "y");
  expect((await save).name).toBe("here.txt");
});
