// @ts-nocheck -- Drive the Notepad UI against the shared virtual filesystem.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
} from "./helpers/shell-harness";
import { checkMenuBar } from "./helpers/menu-bar";
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
  for (const command of ["o", "n"]) {
    h.editor.dispatchEvent(
      new h.s.window.KeyboardEvent("keydown", {
        key: command,
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await flushShell();
    if (command === "o") await h.answer("cancel");
  }
  expect(h.editor.value).toBe("");
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
