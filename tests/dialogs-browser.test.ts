// @ts-nocheck -- Happy DOM supplies the browser API.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
} from "./helpers/shell-harness";
afterEach(cleanupShells);
const current = (s) => [...s.document.querySelectorAll(".xp-dialog")].at(-1);
const key = (s, key, options = {}) =>
  s.document.activeElement.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key, bubbles: true, ...options }),
  );
test("message access keys, stacked dialogs and keyboard cancel resolve correctly", async () => {
  const s = await login(await loadShell()),
    d = s.window.XPDialogs;
  const outer = d.confirm("Proceed?");
  const inner = d.alert("First read this");
  key(s, "Enter");
  expect(await inner).toBe("ok");
  key(s, "n", { altKey: true });
  expect(await outer).toBeFalse();
  const retry = d.message({
    text: "Retry?",
    buttons: d.BUTTON_SETS.retryCancel,
  });
  key(s, "Escape");
  expect(await retry).toBe("cancel");
  const yes = d.confirm("Proceed?");
  key(s, "y");
  expect(await yes).toBeTrue();
  const custom = d.message({
    text: "custom",
    icon: "unknown",
    buttons: [{ id: "finish", label: "Finish", isDefault: true }],
  });
  key(s, "Escape");
  expect(await custom).toBe("finish");
});
test("modal focus is trapped and dialogs can be dragged within the overlay", async () => {
  const s = await login(await loadShell()),
    d = s.window.XPDialogs.createDialog({ title: "Fields" });
  const first = s.document.createElement("input"),
    last = s.document.createElement("button");
  d.body.append(first, last);
  const buttons = [...d.el.querySelectorAll("button,input")];
  for (const el of buttons)
    Object.defineProperty(el, "offsetParent", { get: () => d.el });
  last.focus();
  key(s, "Tab");
  expect(s.document.activeElement).toBe(buttons[0]);
  key(s, "Tab", { shiftKey: true });
  expect(s.document.activeElement).toBe(last);
  const overlay = d.el.parentElement;
  Object.defineProperty(overlay, "clientWidth", { value: 600 });
  Object.defineProperty(overlay, "clientHeight", { value: 400 });
  const bar = d.el.querySelector(".title-bar");
  bar.dispatchEvent(
    new s.window.PointerEvent("pointerdown", {
      button: 0,
      clientX: 10,
      clientY: 10,
      bubbles: true,
    }),
  );
  s.document.dispatchEvent(
    new s.window.PointerEvent("pointermove", { clientX: 80, clientY: 50 }),
  );
  s.document.dispatchEvent(new s.window.PointerEvent("pointerup"));
  expect(d.el.style.left).toBe("70px");
  expect(d.el.style.top).toBe("40px");
  d.close();
  d.close();
  expect(d.el.isConnected).toBeFalse();
});
test("progress clamps percentages and cancel signals without silently closing", async () => {
  const s = await login(await loadShell());
  let canceled = 0;
  const p = s.window.XPDialogs.progress({
    text: "Copying",
    cancellable: true,
    onCancel: () => canceled++,
  });
  p.update(2, "Done");
  expect(
    p.el.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"),
  ).toBe("100");
  expect(p.el.querySelector(".dlg-progress-text").textContent).toBe("Done");
  p.update(-1);
  expect(
    p.el.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"),
  ).toBe("0");
  p.el.querySelector(".dlg-buttons button").click();
  expect(canceled).toBe(1);
  expect(p.el.isConnected).toBeTrue();
  p.close();
});
test("properties describe drives, files and nested folder contents", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS,
    d = s.window.XPDialogs;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Example");
  fs.createFolder(folder.id, "Sub");
  const file = fs.createFile(folder.id, "sample.txt", { content: "hello" });
  for (const id of [
    folder.id,
    file.id,
    fs.DRIVE_C,
    fs.DRIVE_D,
    fs.DRIVE_F,
    fs.RECYCLE_BIN,
  ]) {
    const p = d.properties(id);
    if (!fs.getNode(id)) {
      expect(await p).toBeNull();
      continue;
    }
    expect(current(s).textContent).toContain("Properties");
    if (id === folder.id)
      expect(current(s).textContent).toContain("1 files, 1 folders");
    key(s, "Enter");
    await p;
  }
  expect(await d.properties("missing")).toBeNull();
});
test("open dialog navigates folders, filters files, validates names and cancels", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS,
    d = s.window.XPDialogs;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Fixture");
  const file = fs.createFile(folder.id, "note.txt", { content: "hello" });
  fs.createFile(folder.id, "hidden.png");
  const p = d.openFile({ startFolder: folder.id, filter: [".txt"] });
  expect(current(s).textContent).toContain("note.txt");
  expect(current(s).textContent).not.toContain("hidden.png");
  s.document.getElementById("dlg-file-name").value = "missing";
  key(s, "Enter");
  expect(current(s).textContent).toContain("Cannot find");
  key(s, "Enter");
  await flushShell();
  s.document.getElementById("dlg-file-name").value = "note.txt";
  key(s, "Enter");
  expect((await p).id).toBe(file.id);
  const canceled = d.openFile({ startFolder: "missing" });
  key(s, "Escape");
  expect(await canceled).toBeNull();
  const nested = d.openFile();
  const item = [...current(s).querySelectorAll(".dlg-file-item")].find(
    (x) => x.textContent === "Fixture",
  );
  item.dispatchEvent(new s.window.MouseEvent("dblclick"));
  expect(
    current(s).querySelector(".dlg-file-folder-value").textContent,
  ).toContain("Fixture");
  const note = [...current(s).querySelectorAll(".dlg-file-item")].find((x) =>
    x.textContent.endsWith("note.txt"),
  );
  note.click();
  note.dispatchEvent(new s.window.MouseEvent("dblclick"));
  expect((await nested).id).toBe(file.id);
});
test("save dialog confirms replacement and returns new filenames", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS,
    d = s.window.XPDialogs;
  const file = fs.createFile(fs.MY_DOCUMENTS, "save.txt");
  const p = d.saveFile({ defaultName: "save.txt" });
  key(s, "Enter");
  expect(current(s).textContent).toContain("already exists");
  key(s, "n");
  await flushShell();
  expect(s.document.getElementById("dlg-file-name")).not.toBeNull();
  key(s, "Enter");
  key(s, "y");
  expect(await p).toEqual({
    parentId: fs.MY_DOCUMENTS,
    name: "save.txt",
    existingId: file.id,
  });
  const fresh = d.saveFile();
  key(s, "Enter");
  await flushShell();
  expect(current(s)).toBeDefined();
  s.document.getElementById("dlg-file-name").value = "new.txt";
  key(s, "Enter");
  expect(await fresh).toEqual({
    parentId: fs.MY_DOCUMENTS,
    name: "new.txt",
    existingId: null,
  });
});

test("modeless dialogs ignore keys from elsewhere and shortcuts reserved by the shell", async () => {
  const s = await login(await loadShell()),
    d = s.window.XPDialogs;
  const dialog = d.createDialog({ title: "Find", modal: false });
  let closed = null;
  dialog.onResult((result) => (closed = result));
  const send = (target, key, options = {}) =>
    target.dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key, bubbles: true, ...options }),
    );
  send(s.document.body, "Escape");
  send(dialog.el, "Escape", { ctrlKey: true });
  send(dialog.el, "Meta");
  send(dialog.el, "Tab");
  expect(closed).toBeNull();
  expect(dialog.el.isConnected).toBeTrue();
  send(dialog.el, "Escape");
  expect(dialog.el.isConnected).toBeFalse();
});

test("keyboard handling respects text fields, missing defaults and disabled buttons", async () => {
  const s = await login(await loadShell()),
    d = s.window.XPDialogs;
  const empty = d.createDialog();
  key(s, "Tab");
  const area = s.document.createElement("textarea");
  empty.body.append(area);
  area.focus();
  key(s, "Enter");
  expect(empty.el.isConnected).toBeTrue();
  empty.close();

  const choice = d.message({
    text: "Choose",
    buttons: [
      { id: "first", label: "&First" },
      { id: "second", label: "&Second" },
    ],
  });
  expect(s.document.activeElement.dataset.action).toBe("first");
  const input = s.document.createElement("input");
  current(s).querySelector(".dlg-body").append(input);
  input.focus();
  key(s, "s");
  key(s, "s", { ctrlKey: true });
  key(s, "F1");
  expect(current(s)).toBeDefined();
  current(s).querySelector('[data-action="second"]').disabled = true;
  key(s, "s", { altKey: true });
  expect(current(s)).toBeDefined();
  key(s, "Enter");
  key(s, "f", { altKey: true });
  expect(await choice).toBe("first");

  const unanswered = d.message({ buttons: [{ id: "only", label: "Only" }] });
  key(s, "Escape");
  expect(await unanswered).toBeNull();
  const preferred = d.message({
    text: "Pick",
    buttons: d.BUTTON_SETS.yesNo,
    defaultButton: "no",
  });
  key(s, "Enter");
  expect(await preferred).toBe("no");
});

test("focus trapping wraps from outside the dialog in both directions", async () => {
  const s = await login(await loadShell()),
    d = s.window.XPDialogs.createDialog({ title: "Fields" });
  const input = s.document.createElement("input");
  d.body.append(input);
  const items = [...d.el.querySelectorAll("button,input")];
  for (const el of items)
    Object.defineProperty(el, "offsetParent", { get: () => d.el });
  const outside = s.document.createElement("button");
  s.document.body.append(outside);
  outside.focus();
  d.el.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    }),
  );
  expect(s.document.activeElement).toBe(items.at(-1));
  outside.focus();
  d.el.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
  );
  expect(s.document.activeElement).toBe(items[0]);
  items[0].focus();
  d.el.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    }),
  );
  expect(s.document.activeElement).toBe(items.at(-1));
  d.close();
});

test("title bar drags ignore secondary buttons and title buttons", async () => {
  const s = await login(await loadShell()),
    d = s.window.XPDialogs.createDialog();
  const bar = d.el.querySelector(".title-bar");
  bar.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { button: 2, bubbles: true }),
  );
  d.el
    .querySelector(".close-btn")
    .dispatchEvent(
      new s.window.PointerEvent("pointerdown", { button: 0, bubbles: true }),
    );
  expect(d.el.style.position).toBe("");
  d.close();
});

test("progress dialogs use defaults and cancel only when allowed", async () => {
  const s = await login(await loadShell()),
    d = s.window.XPDialogs;
  const plain = d.progress();
  expect(current(s).textContent).toContain("Progress");
  key(s, "Escape");
  expect(plain.el.isConnected).toBeTrue();
  plain.close();
  let cancelled = 0;
  const escapable = d.progress({
    cancellable: true,
    onCancel: () => cancelled++,
  });
  key(s, "Escape");
  expect(cancelled).toBe(1);
  escapable.close();
  const quiet = d.progress({ cancellable: true });
  quiet.el.querySelector(".dlg-buttons button").click();
  key(s, "Escape");
  expect(quiet.el.isConnected).toBeTrue();
  quiet.close();
  const defaulted = d.message();
  key(s, "Enter");
  expect(await defaulted).toBe("ok");
});

test("properties describe a full Recycle Bin, extensionless files and detached items", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS,
    d = s.window.XPDialogs;
  const trash = fs.createFile(fs.DESKTOP, "old.txt");
  fs.remove(trash.id);
  const bin = d.properties(fs.RECYCLE_BIN);
  expect(current(s).querySelector("img").getAttribute("src")).toContain(
    "RecyclerFull",
  );
  key(s, "Escape");
  expect(await bin).toBe("ok");
  const readme = fs.createFile(fs.DESKTOP, "README");
  const file = d.properties(readme.id);
  expect(current(s).textContent).toContain("File");
  key(s, "Enter");
  await file;
  fs.getNode(readme.id).parent = "missing-folder";
  const detached = d.properties(readme.id);
  expect(current(s).textContent).toContain("Location:");
  key(s, "Enter");
  await detached;
});

test("file dialogs go up, sort folders first and keep typed names for folders", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS,
    d = s.window.XPDialogs;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Letters");
  fs.createFile(fs.MY_DOCUMENTS, "a.txt");
  fs.createFolder(fs.MY_DOCUMENTS, "Zed");
  const open = d.openFile({ startFolder: folder.id });
  current(s).querySelector('[data-action="up"]').click();
  const names = [...current(s).querySelectorAll(".dlg-file-item")].map(
    (item) => item.textContent,
  );
  expect(names.slice(0, 4)).toEqual([
    "Letters",
    "My Music",
    "My Pictures",
    "Zed",
  ]);
  expect(names.at(-1)).toEndWith("a.txt");
  s.document.getElementById("dlg-file-name").value = "typed.txt";
  for (const item of [...current(s).querySelectorAll(".dlg-file-item")].slice(
    0,
    2,
  ))
    item.dispatchEvent(new s.window.MouseEvent("click"));
  expect(current(s).querySelectorAll(".dlg-file-item.selected")).toHaveLength(
    1,
  );
  expect(s.document.getElementById("dlg-file-name").value).toBe("typed.txt");
  s.document.getElementById("dlg-file-name").value = "";
  key(s, "Enter");
  expect(current(s).textContent).toContain("Cannot find");
  key(s, "Enter");
  await flushShell();
  for (let depth = 0; depth < 6; depth++)
    current(s).querySelector('[data-action="up"]').click();
  expect(current(s).querySelector(".dlg-file-folder-value").textContent).toBe(
    "My Computer",
  );
  key(s, "Escape");
  expect(await open).toBeNull();
  const save = d.saveFile();
  current(s).querySelector('[data-action="cancel"]').click();
  expect(await save).toBeNull();
});

test("focus trapping leaves middle stops to the browser and holds focus when nothing is focusable", async () => {
  const s = await login(await loadShell());
  const tab = (target, shiftKey = false) => {
    const event = new s.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const empty = s.window.XPDialogs.createDialog({ title: "Empty" });
  for (const button of empty.el.querySelectorAll("button"))
    button.disabled = true;
  const before = s.document.activeElement;
  expect(tab(empty.el)).toBeTrue();
  expect(s.document.activeElement).toBe(before);
  empty.close();

  const d = s.window.XPDialogs.createDialog({ title: "Fields" });
  const fields = ["first", "middle", "last"].map((name) => {
    const input = s.document.createElement("input");
    input.name = name;
    d.body.append(input);
    return input;
  });
  for (const el of d.el.querySelectorAll("button,input"))
    Object.defineProperty(el, "offsetParent", { get: () => d.el });
  fields[1].focus();
  expect(tab(fields[1])).toBeFalse();
  expect(tab(fields[1], true)).toBeFalse();
  expect(s.document.activeElement).toBe(fields[1]);
  d.close();
});
test("a closed dialog gives the keys back, but never to a control that cannot take them", async () => {
  const s = await login(await loadShell()),
    d = s.window.XPDialogs;
  const active = () => s.document.activeElement;
  const icons = s.document.getElementById("desktop-icons");
  const answer = async (shown) => {
    key(s, "Enter");
    await shown;
  };

  // The control that had the keys gets them back.
  const host = s.document.createElement("button");
  s.document.body.append(host);
  host.focus();
  await answer(d.alert("One"));
  expect(active() === host).toBeTrue();

  // A control that hid meanwhile, like the item of a closed menu, does not.
  // With no window open, the desktop gets them.
  host.focus();
  const hiding = d.alert("Two");
  host.hidden = true;
  await answer(hiding);
  expect(active() === icons).toBeTrue();

  // Chrome skips focus() on a control hidden by a style, such as one in a
  // minimized window.
  host.hidden = false;
  host.focus();
  host.focus = () => {};
  await answer(d.alert("Three"));
  expect(active() === icons).toBeTrue();
  host.remove();

  // Keys that were on the page go to the dialog under this one, on its
  // default button.
  const outer = d.confirm("Outer?");
  const outerDefault = active();
  outerDefault.blur();
  expect(active() === s.document.body).toBeTrue();
  await answer(d.alert("Inner"));
  expect(active() === outerDefault).toBeTrue();
  key(s, "Escape");
  expect(await outer).toBeFalse();

  // With no dialog under it, the active window gets them.
  const fs = s.window.VirtualFS;
  fs.open(fs.MY_DOCUMENTS);
  for (let index = 0; index < 4; index += 1) await flushShell();
  const win = s.document.querySelector(".xp-window.active");
  active().blur();
  await answer(d.alert("Four"));
  expect(win.contains(active())).toBeTrue();
});
