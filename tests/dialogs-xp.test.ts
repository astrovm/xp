// @ts-nocheck -- Dialog chrome compared against the XP SP3 VM.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
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
  key(s, "Escape");
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

  dialog.querySelector('[data-action="new-folder"]').click();
  expect(names()).toContain("New Folder");
  expect(dialog.querySelector("#dlg-file-name").value).toBe("New Folder");

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
    expect(name.value).toBe("");
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
