// @ts-nocheck -- Drive the Notepad UI against the shared virtual filesystem.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
} from "./helpers/shell-harness";
import { checkMenuBar } from "./helpers/menu-bar";
import { pressAltGr } from "./helpers/keys";
afterEach(cleanupShells);
async function setup() {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const file = fs.createFile(fs.MY_DOCUMENTS, "note.txt", {
    content: "first\nsecond",
  });
  fs.open(file.id);
  const win = s.document.querySelector(".notepad-window"),
    editor = win.querySelector("textarea");
  const command = async (id) => {
    win.querySelector(`[data-command="${id}"]`).click();
    await flushShell();
  };
  const answer = async (id) => {
    s.document.querySelector(`.xp-dialog [data-action="${id}"]`).click();
    await flushShell();
    await flushShell();
  };
  const edit = (text) => {
    editor.value = text;
    editor.dispatchEvent(new s.window.Event("input", { bubbles: true }));
  };
  const choose = async (name) => {
    s.document.getElementById("dlg-file-name").value = name;
    s.document.querySelector(".xp-dialog .dlg-buttons button").click();
    await flushShell();
    await flushShell();
  };
  return { s, fs, file, win, editor, command, answer, edit, choose };
}
test("Notepad edits selections and clipboard, toggles wrap/status and runs menu shortcuts", async () => {
  const h = await setup();
  let clipboard = "";
  Object.defineProperty(h.s.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        clipboard = text;
      },
      readText: async () => clipboard,
    },
  });
  h.editor.setSelectionRange(0, 5);
  await h.command("copy");
  expect(clipboard).toBe("first");
  await h.command("cut");
  expect(h.editor.value).toBe("\nsecond");
  h.editor.setSelectionRange(0, 0);
  await h.command("paste");
  expect(h.editor.value).toBe("first\nsecond");
  await h.command("select-all");
  expect(h.editor.selectionEnd).toBe(h.editor.value.length);
  await h.command("delete");
  expect(h.editor.value).toBe("");
  const toggle = (command) =>
    h.win.querySelector(`[data-command="${command}"]`);
  for (const command of ["word-wrap", "status-bar"]) {
    expect(toggle(command).getAttribute("role")).toBe("menuitemcheckbox");
    expect(toggle(command).getAttribute("aria-checked")).toBe("false");
  }
  expect(toggle("cut").getAttribute("role")).toBe("menuitem");
  expect(toggle("cut").hasAttribute("aria-checked")).toBeFalse();
  await h.command("word-wrap");
  expect(h.editor.wrap).toBe("soft");
  expect(toggle("word-wrap").getAttribute("aria-checked")).toBe("true");
  await h.command("word-wrap");
  expect(h.editor.wrap).toBe("off");
  expect(toggle("word-wrap").getAttribute("aria-checked")).toBe("false");
  await h.command("status-bar");
  expect(h.win.querySelector(".notepad-status").hidden).toBeFalse();
  expect(toggle("status-bar").getAttribute("aria-checked")).toBe("true");
  h.edit("one\ntwo");
  h.editor.setSelectionRange(5, 5);
  h.editor.dispatchEvent(new h.s.window.Event("select"));
  expect(h.win.querySelector(".notepad-status").textContent).toBe(
    "Ln 2, Col 2",
  );
  h.s.document.execCommand = () => true;
  await h.command("undo");
  h.editor.dispatchEvent(
    new h.s.window.KeyboardEvent("keydown", { key: "F5", bubbles: true }),
  );
  expect(h.editor.value.length).toBeGreaterThan(7);
  const menu = h.win.querySelector(".notepad-menu-button");
  menu.click();
  expect(menu.getAttribute("aria-expanded")).toBe("true");
  menu.click();
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  menu.click();
  h.editor.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  await h.command("about");
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "About Notepad",
  );
  await h.answer("ok");
});
test("Notepad Save As creates a text file, overwrites it and opens another document", async () => {
  const h = await setup();
  h.edit("draft");
  await h.command("save-as");
  await h.choose("copy");
  const copy = h.fs.findChild(h.fs.MY_DOCUMENTS, "copy.txt");
  expect(h.fs.getContent(copy.id)).toBe("draft");
  expect(h.win.querySelector(".title-text").textContent).toBe(
    "copy.txt - Notepad",
  );
  h.edit("updated");
  await h.command("save");
  expect(h.fs.getContent(copy.id)).toBe("updated");
  await h.command("save-as");
  await h.choose("note.txt");
  await h.answer("yes");
  expect(h.fs.getContent(h.file.id)).toBe("updated");
  await h.command("open");
  await h.choose("copy.txt");
  expect(h.editor.value).toBe("updated");
  await h.command("new");
  expect(h.editor.value).toBe("");
  expect(h.win.querySelector(".title-text").textContent).toBe(
    "Untitled - Notepad",
  );
  h.edit("unsaved");
  await h.command("new");
  await h.answer("cancel");
  expect(h.editor.value).toBe("unsaved");
  await h.command("new");
  await h.answer("no");
  expect(h.editor.value).toBe("");
  h.edit("new file");
  await h.command("save");
  await h.answer("cancel");
  expect(h.editor.value).toBe("new file");
  await h.command("exit");
  await h.answer("no");
  expect(h.win.isConnected).toBeFalse();
});
test("Notepad saves a deleted file outside the Recycle Bin, under its own name", async () => {
  const h = await setup();
  // The Recycle Bin already has a note.txt, so the deleted file gets a
  // new name there.
  const older = h.fs.createFile(h.fs.DESKTOP, "note.txt", { content: "" });
  h.fs.remove(older.id);
  h.fs.remove(h.file.id);
  expect(h.fs.getNode(h.file.id).name).not.toBe("note.txt");
  h.edit("kept");
  await h.command("save");
  const name = h.s.document.getElementById("dlg-file-name");
  expect(name.value).toBe("note.txt");
  expect(
    h.s.document.querySelector(".xp-dialog .dlg-file-folder").textContent,
  ).toContain("My Documents");
  await h.choose("note.txt");
  const saved = h.fs.findChild(h.fs.MY_DOCUMENTS, "note.txt");
  expect(h.fs.getContent(saved.id)).toBe("kept");
  expect(h.fs.getContent(h.file.id)).toBe("first\nsecond");
});
// The Replace question waits for the user. Notepad finds the file again
// when it writes.
test("Notepad checks the file again after the Replace question", async () => {
  const h = await setup();
  const other = h.fs.createFolder(h.fs.MY_DOCUMENTS, "Other");
  // The file moved away during the question: it keeps its content, and a
  // new file takes the name.
  h.edit("one");
  await h.command("save-as");
  await h.choose("note.txt");
  h.fs.move(h.file.id, other.id);
  await h.answer("yes");
  expect(h.fs.getContent(h.file.id)).toBe("first\nsecond");
  const fresh = h.fs.findChild(h.fs.MY_DOCUMENTS, "note.txt");
  expect(fresh.id === h.file.id).toBeFalse();
  expect(h.fs.getContent(fresh.id)).toBe("one");
  // The file went to the Recycle Bin during the question: it stays as it
  // was there.
  const binned = h.fs.createFile(h.fs.MY_DOCUMENTS, "bin.txt", {
    content: "old",
  });
  h.edit("two");
  await h.command("save-as");
  await h.choose("bin.txt");
  h.fs.remove(binned.id);
  await h.answer("yes");
  expect(h.fs.getContent(binned.id)).toBe("old");
  expect(h.fs.getContent(h.fs.findChild(h.fs.MY_DOCUMENTS, "bin.txt").id)).toBe(
    "two",
  );
  // A folder took the name during the question: Notepad shows an error.
  const gone = h.fs.createFile(h.fs.MY_DOCUMENTS, "gone.txt", { content: "" });
  await h.command("save-as");
  await h.choose("gone.txt");
  h.fs.destroy(gone.id);
  h.fs.createFolder(h.fs.MY_DOCUMENTS, "gone.txt");
  await h.answer("yes");
  expect(
    [...h.s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
  ).toContain(
    "Cannot create the gone.txt file. A folder with the name you specified already exists.",
  );
  await h.answer("ok");
});
test("Notepad switching files preserves a canceled draft and saves on confirmation", async () => {
  const h = await setup(),
    other = h.fs.createFile(h.fs.MY_DOCUMENTS, "other.txt", {
      content: "other",
    });
  h.edit("draft");
  h.fs.open(other.id);
  await flushShell();
  await h.answer("cancel");
  expect(h.editor.value).toBe("draft");
  h.fs.open(other.id);
  await flushShell();
  await h.answer("yes");
  expect(h.fs.getContent(h.file.id)).toBe("draft");
  expect(h.editor.value).toBe("other");
  // A Russian layout types "щ" on the O key and "т" on the N key. Like
  // Windows, Ctrl+O and Ctrl+N follow the place of the key.
  for (const [command, key] of [
    ["o", "щ"],
    ["n", "т"],
  ]) {
    h.editor.dispatchEvent(
      new h.s.window.KeyboardEvent("keydown", {
        key,
        code: `Key${command.toUpperCase()}`,
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await flushShell();
    if (command === "o") await h.answer("cancel");
  }
  expect(h.editor.value).toBe("");
  // AltGr types characters, such as "ś", "ó" and "ń" on a Polish keyboard.
  // Like XP, it never runs Save, Open or New.
  h.edit("typed");
  for (const [key, code] of [
    ["ś", "KeyS"],
    ["ó", "KeyO"],
    ["ń", "KeyN"],
  ])
    for (const event of pressAltGr(h.s.window, h.editor, key, code))
      expect(event.defaultPrevented).toBeFalse();
  await flushShell();
  expect(h.s.document.querySelector(".xp-dialog")).toBeNull();
  expect(h.editor.value).toBe("typed");
  expect(h.fs.getContent(other.id)).toBe("other");
});

test("Notepad reports invalid and failed saves and ignores empty clipboard actions", async () => {
  const h = await setup();
  const dialogText = () =>
    [...h.s.document.querySelectorAll(".xp-dialog")].at(-1)?.textContent || "";
  // Save As adds .txt before it looks for a file. A name that leads to a
  // folder opens the folder; it never offers to replace it.
  const folder = h.fs.createFolder(h.fs.MY_DOCUMENTS, "Folder.txt");
  await h.command("save-as");
  await h.choose("Folder");
  expect(dialogText()).not.toContain("already exists");
  expect(
    h.s.document.querySelector(".xp-dialog .dlg-file-folder").textContent,
  ).toContain("Folder.txt");
  await h.choose("draft");
  expect(h.fs.findChild(folder.id, "draft.txt")).toBeTruthy();

  const writeFile = h.s.window.FileOperations.writeFile;
  h.s.window.FileOperations.writeFile = async () => {
    throw new Error("");
  };
  try {
    await h.command("save-as");
    await h.choose("fresh.txt");
    expect(dialogText()).toContain("The file could not be saved.");
    await h.answer("ok");
  } finally {
    h.s.window.FileOperations.writeFile = writeFile;
  }
  const setContent = h.fs.setContent;
  h.fs.setContent = async () => {
    throw new Error("");
  };
  try {
    h.edit("changed");
    await h.command("save");
    expect(dialogText()).toContain("The file could not be saved.");
    await h.answer("ok");
  } finally {
    h.fs.setContent = setContent;
  }

  Object.defineProperty(h.s.window.navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  h.editor.setSelectionRange(0, 0);
  await h.command("cut");
  await h.command("paste");
  expect(h.editor.value).toBe("changed");
  await h.command("open");
  await h.answer("cancel");
  expect(h.s.document.querySelectorAll(".xp-dialog")).toHaveLength(0);
  h.win
    .querySelector(".notepad-menu-group")
    .dispatchEvent(
      new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
  h.editor.dispatchEvent(
    new h.s.window.KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
});

test("Notepad's menus follow XP's menu bar rules", async () => {
  const h = await setup();
  h.editor.focus();
  await checkMenuBar({
    s: h.s,
    win: h.win,
    control: h.editor,
    accessKey: "f",
    settle: flushShell,
  });
});

// A drag event with the data of a drag. Happy DOM keeps no dataTransfer,
// so the test gives one.
const dragOn = (s, element, type, data, files = []) => {
  const transfer = {
    types: [...Object.keys(data), ...(files.length ? ["Files"] : [])],
    dropEffect: "move",
    files,
    getData: (format) => data[format] ?? "",
  };
  const event = new s.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  element.dispatchEvent(event);
  return { taken: event.defaultPrevented, effect: transfer.dropEffect };
};

test("Notepad opens a file dropped on it, like XP", async () => {
  const h = await setup();
  const title = () => h.win.querySelector(".title-text").textContent;
  const computerFile = (name, text) => ({ name, text: async () => text });
  // A file from the computer. Notepad asks first when its text changed.
  h.edit("changed");
  expect(
    dragOn(h.s, h.editor, "dragover", {}, [computerFile("c.txt", "")]),
  ).toEqual({ taken: true, effect: "copy" });
  dragOn(h.s, h.editor, "drop", {}, [computerFile("c.txt", "from disk")]);
  await flushShell();
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "The text in the note.txt file has changed.",
  );
  await h.answer("cancel");
  expect(h.editor.value).toBe("changed");
  dragOn(h.s, h.editor, "drop", {}, [computerFile("c.txt", "from disk")]);
  await flushShell();
  await h.answer("no");
  expect(h.editor.value).toBe("from disk");
  expect(title()).toBe("c.txt - Notepad");
  // The file has no place here, so Save asks where to save it, with its
  // name.
  h.edit("from disk, changed");
  dragOn(h.s, h.editor, "drop", {}, [computerFile("d.txt", "")]);
  await flushShell();
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "The text in the c.txt file has changed.",
  );
  await h.answer("cancel");
  await h.command("save");
  expect(h.s.document.getElementById("dlg-file-name").value).toBe("c.txt");
  await h.choose("c.txt");
  const saved = h.fs.resolvePath(`${h.fs.getPath(h.fs.MY_DOCUMENTS)}\\c.txt`);
  expect(h.fs.getContent(saved)).toBe("from disk, changed");
  expect(title()).toBe("c.txt - Notepad");

  // A file that cannot be read shows an error.
  const broken = {
    name: "e.txt",
    text: async () => {
      throw new Error("The file could not be read.");
    },
  };
  dragOn(h.s, h.editor, "drop", {}, [broken]);
  await flushShell();
  await flushShell();
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "The file could not be read.",
  );
  await h.answer("ok");
  // An error with no text gives XP's own text.
  dragOn(h.s, h.editor, "drop", {}, [
    {
      name: "g.txt",
      text: async () => {
        throw new Error("");
      },
    },
  ]);
  await flushShell();
  await flushShell();
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "Cannot open the g.txt file.",
  );
  await h.answer("ok");
  expect(h.editor.value).toBe("from disk, changed");

  // An item from an Explorer window opens. A folder, a missing item and a
  // bad list do not.
  const items = (ids) => ({
    "application/x-astro-vfs-ids": JSON.stringify(ids),
  });
  const other = h.fs.createFile(h.fs.MY_DOCUMENTS, "other.txt", {
    content: "other",
  });
  expect(dragOn(h.s, h.win, "dragover", items([other.id]))).toEqual({
    taken: true,
    effect: "move",
  });
  for (const data of [
    items([h.fs.MY_PICTURES]),
    items(["missing"]),
    { "application/x-astro-vfs-ids": "{" },
  ]) {
    dragOn(h.s, h.editor, "drop", data);
    await flushShell();
  }
  expect(title()).toBe("c.txt - Notepad");
  // Cancel keeps the changed text.
  h.edit("kept");
  dragOn(h.s, h.editor, "drop", items([other.id]));
  await flushShell();
  await h.answer("cancel");
  expect(h.editor.value).toBe("kept");
  dragOn(h.s, h.editor, "drop", items(["missing", other.id]));
  await flushShell();
  await h.answer("no");
  expect(h.editor.value).toBe("other");
  expect(title()).toBe("other.txt - Notepad");
  // Text is not a file. The text box refuses it, like XP.
  expect(dragOn(h.s, h.editor, "dragover", { "text/plain": "x" }).effect).toBe(
    "none",
  );
  dragOn(h.s, h.editor, "drop", { "text/plain": "x" });
  expect(h.editor.value).toBe("other");

  // A desktop icon dragged onto Notepad opens its file. New starts an
  // untitled document again.
  const desktopFile = h.fs.createFile(h.fs.DESKTOP, "desk.txt", {
    content: "desk",
  });
  await flushShell();
  const icon = h.s.document.querySelector(
    `.desktop-icon[data-desktop-id="${desktopFile.id}"]`,
  );
  h.s.document.elementsFromPoint = () => [h.editor];
  [
    ["pointerdown", 10],
    ["pointermove", 190],
    ["pointerup", 190],
  ].forEach(([type, at]) =>
    icon.dispatchEvent(
      new h.s.window.PointerEvent(type, {
        button: 0,
        pointerId: 1,
        clientX: at,
        clientY: at,
        bubbles: true,
      }),
    ),
  );
  await flushShell();
  await flushShell();
  expect(h.editor.value).toBe("desk");
  expect(h.fs.getNode(desktopFile.id).parent).toBe(h.fs.DESKTOP);
  await h.command("new");
  expect(title()).toBe("Untitled - Notepad");
});

test("no part of the page opens a file from the computer that no folder takes", async () => {
  const { s, fs } = await setup();
  // The browser would open the file in place of the desktop. Like XP, the
  // drop is refused.
  for (const type of ["dragenter", "dragover", "drop"])
    expect(dragOn(s, s.document.body, type, {}, [{}])).toEqual({
      taken: true,
      effect: "none",
    });
  // A drag that shows its files only at the drop still goes to a folder.
  const desktop = s.document.getElementById("desktop-icons");
  const early = dragOn(s, desktop, "dragover", {}, []);
  expect(early).toEqual({ taken: false, effect: "move" });
  const transfer = {
    types: ["Files"],
    dropEffect: "move",
    files: [],
    getData: () => "",
  };
  const event = new s.window.Event("dragover", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  desktop.dispatchEvent(event);
  expect(event.defaultPrevented).toBeTrue();
  expect(transfer.dropEffect).toBe("move");
  expect(desktop.classList.contains("drop-target")).toBeTrue();
  // Other drags, and events with no drag data, are left as they are.
  expect(dragOn(s, s.document.body, "dragover", { "text/plain": "x" })).toEqual(
    { taken: false, effect: "move" },
  );
  const bare = new s.window.Event("drop", { bubbles: true, cancelable: true });
  s.document.body.dispatchEvent(bare);
  expect(bare.defaultPrevented).toBeFalse();
  expect(fs.getNode(fs.DESKTOP).type).toBe("folder");
});

test("an item dragged over Notepad's text keeps its effect and opens on the drop", async () => {
  const h = await setup();
  const title = () => h.win.querySelector(".title-text").textContent;
  const items = (ids) => ({
    "application/x-astro-vfs-ids": JSON.stringify(ids),
  });
  const other = h.fs.createFile(h.fs.MY_DOCUMENTS, "other.txt", {
    content: "other",
  });
  // The drag over the text box itself, not only over the window.
  for (const type of ["dragenter", "dragover"])
    expect(dragOn(h.s, h.editor, type, items([other.id]))).toEqual({
      taken: true,
      effect: "move",
    });
  dragOn(h.s, h.editor, "drop", items([other.id]));
  await flushShell();
  expect(title()).toBe("other.txt - Notepad");
});

test("an item that also carries a file opens as the item in Notepad", async () => {
  const h = await setup();
  const title = () => h.win.querySelector(".title-text").textContent;
  const items = (ids) => ({
    "application/x-astro-vfs-ids": JSON.stringify(ids),
  });
  const other = h.fs.createFile(h.fs.MY_DOCUMENTS, "other.txt", {
    content: "other",
  });
  // Such as a picture that the browser drags.
  dragOn(h.s, h.editor, "drop", items([other.id]), [
    { name: "picture.png", text: async () => "from the browser" },
  ]);
  await flushShell();
  await flushShell();
  expect(h.editor.value).toBe("other");
  expect(title()).toBe("other.txt - Notepad");
});

test("Notepad does not open a dropped file that goes away while it asks to save", async () => {
  const h = await setup();
  const items = (ids) => ({
    "application/x-astro-vfs-ids": JSON.stringify(ids),
  });
  const other = h.fs.createFile(h.fs.MY_DOCUMENTS, "other.txt", {
    content: "other",
  });
  const path = h.fs.getPath(other.id);
  h.edit("changed");
  dragOn(h.s, h.editor, "drop", items([other.id]));
  await flushShell();
  await h.fs.remove(other.id);
  await h.answer("no");
  const message = [...h.s.document.querySelectorAll(".xp-dialog")].at(-1);
  expect(message.querySelector(".title-text").textContent).toBe("Notepad");
  expect(message.textContent).toContain(
    `Cannot find the ${path} file.\n\nCheck the file name and try again.`,
  );
  await h.answer("ok");
  expect(h.editor.value).toBe("changed");
  expect(h.win.querySelector(".title-text").textContent).toBe(
    "note.txt - Notepad",
  );
});

test("a drag that nothing takes is refused, also on a text box", async () => {
  const h = await setup();
  const box = h.s.document.createElement("input");
  h.s.document.getElementById("desktop").append(box);
  for (const type of ["dragenter", "dragover", "drop"]) {
    expect(dragOn(h.s, box, type, { "text/plain": "x" })).toEqual({
      taken: true,
      effect: "none",
    });
    expect(
      dragOn(h.s, box, type, {
        "application/x-astro-vfs-ids": JSON.stringify([h.file.id]),
      }),
    ).toEqual({ taken: true, effect: "none" });
  }
  expect(box.value).toBe("");
  // A drag that a target takes keeps the target's effect.
  box.addEventListener("dragover", (event) => event.preventDefault());
  expect(dragOn(h.s, box, "dragover", { "text/plain": "x" })).toEqual({
    taken: true,
    effect: "move",
  });
});
test("Notepad opens a file with the caret at the start, like XP", async () => {
  const h = await setup();
  expect(h.editor.value).toBe("first\nsecond");
  expect([h.editor.selectionStart, h.editor.selectionEnd]).toEqual([0, 0]);
  expect(h.editor.scrollTop).toBe(0);
  await h.command("status-bar");
  expect(h.win.querySelector(".notepad-status").textContent).toBe(
    "Ln 1, Col 1",
  );
});

// In the XP VM, Notepad shows each file that it opens with the caret at
// the start: New, Open, a drop, and a file that opens in an open Notepad.
test("Notepad puts the caret at the start of each file that it opens, like XP", async () => {
  const h = await setup();
  const caret = () => [h.editor.selectionStart, h.editor.selectionEnd];
  const long = h.fs.createFile(h.fs.MY_DOCUMENTS, "long.txt", {
    content: "one\ntwo\nthree",
  });
  const atEnd = () =>
    h.editor.setSelectionRange(h.editor.value.length, h.editor.value.length);
  atEnd();
  await h.command("new");
  expect(caret()).toEqual([0, 0]);
  await h.command("open");
  await h.choose("long.txt");
  expect(h.editor.value).toBe("one\ntwo\nthree");
  expect(caret()).toEqual([0, 0]);
  atEnd();
  dragOn(h.s, h.editor, "drop", {
    "application/x-astro-vfs-ids": JSON.stringify([h.file.id]),
  });
  await flushShell();
  expect(h.editor.value).toBe("first\nsecond");
  expect(caret()).toEqual([0, 0]);
  atEnd();
  h.fs.open(long.id);
  await flushShell();
  expect(h.s.document.querySelectorAll(".notepad-window")).toHaveLength(1);
  expect(h.editor.value).toBe("one\ntwo\nthree");
  expect(caret()).toEqual([0, 0]);
});

// In the XP VM, a file dropped on a Notepad window that is behind another
// window opens in Notepad, and Notepad stays behind. The window in front
// keeps the keys. Notepad's text gets them when Notepad is active again.
test("a drop on a Notepad window behind another one leaves it behind, like XP", async () => {
  const h = await setup();
  const other = h.fs.createFile(h.fs.MY_DOCUMENTS, "other.txt", {
    content: "other",
  });
  const active = () =>
    [...h.s.document.querySelectorAll(".xp-window.active")].map(
      (win) => win.dataset.game,
    );
  h.fs.open(h.fs.MY_DOCUMENTS);
  await flushShell();
  expect(active()).toEqual(["__my-documents"]);
  const front = h.s.document.activeElement;
  dragOn(h.s, h.editor, "drop", {
    "application/x-astro-vfs-ids": JSON.stringify([other.id]),
  });
  await flushShell();
  expect(h.editor.value).toBe("other");
  expect(active()).toEqual(["__my-documents"]);
  expect(h.s.document.activeElement).toBe(front);
  h.win.dispatchEvent(new h.s.window.PointerEvent("pointerdown"));
  await flushShell();
  expect(active()).toEqual(["__notepad"]);
  expect(h.s.document.activeElement).toBe(h.editor);
});
