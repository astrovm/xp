// @ts-nocheck -- XP's checks for a new name: bad characters, names in use and Save As.
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
  for (let index = 0; index < 4; index += 1) await flushShell();
};
const key = (s, target, name, init = {}) =>
  target.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
// Types text like a browser: each character asks first with beforeinput,
// and goes in where the caret is unless the box refuses it.
const type = (s, input, text) => {
  for (const character of text) {
    const event = new s.window.InputEvent("beforeinput", {
      data: character,
      inputType: "insertText",
      bubbles: true,
      cancelable: true,
    });
    if (!input.dispatchEvent(event)) continue;
    input.setRangeText(
      character,
      input.selectionStart,
      input.selectionEnd,
      "end",
    );
    input.dispatchEvent(new s.window.Event("input", { bubbles: true }));
  }
};
const beforeInput = (s, input, init) =>
  input.dispatchEvent(
    new s.window.InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
// Pastes text like Chrome: the paste event comes first, then beforeinput,
// then the text goes in where the caret is. Each step can stop the rest.
const paste = (s, input, text) => {
  const clipboardData = new s.window.DataTransfer();
  clipboardData.setData("text/plain", text);
  const event = new s.window.ClipboardEvent("paste", {
    clipboardData,
    bubbles: true,
    cancelable: true,
  });
  if (!input.dispatchEvent(event)) return false;
  if (!beforeInput(s, input, { data: text, inputType: "insertFromPaste" }))
    return false;
  input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
  input.dispatchEvent(new s.window.Event("input", { bubbles: true }));
  return true;
};
const dialogs = (s) =>
  [...s.document.querySelectorAll(".xp-dialog")].map((dialog) => ({
    title: dialog.getAttribute("aria-label"),
    text: dialog.querySelector(".dlg-text")?.textContent,
  }));
const answer = async (s, label = "OK") => {
  [...s.document.querySelectorAll(".xp-dialog .dlg-buttons button")]
    .find((button) => button.textContent === label)
    .click();
  await settle();
};
const balloon = (s) =>
  [...s.document.querySelectorAll(".xp-balloon > div")].map(
    (row) => row.textContent,
  );
const BALLOON = [
  "A file name cannot contain any of the following characters:",
  '\\ / : * ? " < > |',
];
const openDocuments = async (s) => {
  clickStartAction(s, "documents");
  await settle();
  return s.document.querySelector('.xp-window[data-game="__my-documents"]');
};
const renameInExplorer = async (s, win, id) => {
  win
    .querySelector(`.explorer-item[data-node-id="${id}"]`)
    .dispatchEvent(new s.window.MouseEvent("contextmenu", { bubbles: true }));
  win.querySelector('.explorer-context-menu [data-command="rename"]').click();
  await settle();
  return win.querySelector(".explorer-rename");
};
const renameOnDesktop = async (s, id) => {
  const icon = s.document.querySelector(
    `.desktop-icon[data-desktop-id="${id}"]`,
  );
  icon.focus();
  icon.dispatchEvent(new s.window.MouseEvent("contextmenu", { bubbles: true }));
  s.document
    .querySelector('#desktop-context-menu [data-action="rename"]')
    .click();
  await settle();
  return s.document.querySelector(".desktop-rename");
};

test("a rename box drops the characters that a name cannot have and shows XP's balloon", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Alpha");
  const win = await openDocuments(s);
  const input = await renameInExplorer(s, win, folder.id);
  input.value = "";
  type(s, input, "bad");
  expect(balloon(s)).toEqual([]);
  type(s, input, "/");
  expect(input.value).toBe("bad");
  expect(balloon(s)).toEqual(BALLOON);

  // Pasted text goes in without its bad characters, where the caret is.
  input.setSelectionRange(1, 1);
  expect(paste(s, input, "x:y")).toBeFalse();
  expect(input.value).toBe("bxyad");
  expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3]);
  // One balloon shows at a time.
  expect(s.document.querySelectorAll(".xp-balloon")).toHaveLength(1);
  // Text that the browser puts in another way, such as a spelling fix,
  // loses its bad characters too.
  input.setSelectionRange(0, 0);
  expect(
    beforeInput(s, input, { data: "q*", inputType: "insertReplacementText" }),
  ).toBeFalse();
  expect(input.value).toBe("qbxyad");
  // A deletion has no text, and goes on.
  expect(
    beforeInput(s, input, { inputType: "deleteContentBackward" }),
  ).toBeTrue();

  // The next key closes the balloon.
  key(s, input, "c");
  expect(balloon(s)).toEqual([]);
  // So does the loss of the keys.
  type(s, input, "?");
  input.dispatchEvent(new s.window.FocusEvent("blur"));
  expect(balloon(s)).toEqual([]);
  await settle();

  // On the desktop too, and the balloon closes after 10 seconds.
  const file = fs.createFile(fs.DESKTOP, "note.txt", { content: "" });
  await settle();
  const box = await renameOnDesktop(s, file.id);
  type(s, box, '<>:"|');
  expect(box.value).toBe("note.txt");
  expect(balloon(s)).toEqual(BALLOON);
  await s.advanceTime(9999);
  expect(balloon(s)).toEqual(BALLOON);
  await s.advanceTime(1);
  expect(balloon(s)).toEqual([]);
  key(s, box, "Escape");
  await settle();
  expect(fs.getNode(file.id).name).toBe("note.txt");
});

test("a rename box cleans text from an input method when it ends, and keeps every change in its undo", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Alpha");
  const win = await openDocuments(s);
  const input = await renameInExplorer(s, win, folder.id);
  // Chrome's own edit, which Ctrl+Z can take back. Happy DOM has none.
  const edits = [];
  s.document.execCommand = (command, _, text) => {
    edits.push([
      command,
      input.value.slice(input.selectionStart, input.selectionEnd),
      text,
    ]);
    input.setRangeText(
      command === "delete" ? "" : text,
      input.selectionStart,
      input.selectionEnd,
      "end",
    );
    return true;
  };
  const compose = (value) => {
    input.dispatchEvent(new s.window.Event("compositionstart"));
    // The text that the input method composes goes in as it is.
    expect(
      beforeInput(s, input, {
        data: value.slice(input.value.length),
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    ).toBeTrue();
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new s.window.Event("compositionend"));
  };

  compose("Alphax?y");
  expect(input.value).toBe("Alphaxy");
  expect([input.selectionStart, input.selectionEnd]).toEqual([7, 7]);
  expect(edits).toEqual([["delete", "?", ""]]);
  expect(balloon(s)).toEqual(BALLOON);
  // Many bad characters go in one edit, so one Ctrl+Z takes it back.
  compose("Alphaxya?b?c");
  expect(input.value).toBe("Alphaxyabc");
  expect([input.selectionStart, input.selectionEnd]).toEqual([10, 10]);
  expect(edits.at(-1)).toEqual(["insertText", "?b?", "b"]);
  // Clean text needs no edit.
  compose("Alphaxyabcd");
  expect(edits).toHaveLength(2);
  // A paste uses the same edit.
  expect(paste(s, input, "q|")).toBeFalse();
  expect(input.value).toBe("Alphaxyabcdq");
  expect(edits.at(-1)).toEqual(["insertText", "", "q"]);
});

test("an Explorer rename to a name in use shows XP's error and opens the box again", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Alpha");
  let win = await openDocuments(s);
  let input = await renameInExplorer(s, win, folder.id);
  input.value = "My Music";
  // The Enter ends in the box, so it cannot also press OK in the error box.
  expect(key(s, input, "Enter")).toBeFalse();
  await settle();
  expect(dialogs(s)).toEqual([
    {
      title: "Error Renaming File or Folder",
      text: "Cannot rename Alpha: A file with the name you specified already exists. Specify a different file name.",
    },
  ]);
  expect(fs.getNode(folder.id).name).toBe("Alpha");
  await answer(s);
  // Like XP, the box is open again with the old name, all selected.
  input = win.querySelector(".explorer-rename");
  expect(s.document.activeElement === input).toBeTrue();
  expect(input.value).toBe("Alpha");
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  input.value = "Gamma";
  expect(key(s, input, "Escape", { cancelable: true })).toBeFalse();
  expect(fs.getNode(folder.id).name).toBe("Alpha");
  input = await renameInExplorer(s, win, folder.id);
  input.value = "Gamma";
  key(s, input, "Enter");
  await settle();
  expect(fs.getNode(folder.id).name).toBe("Gamma");
  expect(dialogs(s)).toEqual([]);

  // An item that goes away while the error shows gets no box.
  input = await renameInExplorer(s, win, folder.id);
  input.value = "My Music";
  key(s, input, "Enter");
  await settle();
  fs.destroy(folder.id);
  await settle();
  await answer(s);
  expect(win.querySelector(".explorer-rename")).toBeNull();

  // A window that closes drops the rename, and no error shows.
  const other = fs.createFolder(fs.MY_DOCUMENTS, "Delta");
  await settle();
  input = await renameInExplorer(s, win, other.id);
  input.value = "My Music";
  key(s, input, "F4", { altKey: true });
  await settle();
  expect(win.isConnected).toBeFalse();
  expect(dialogs(s)).toEqual([]);
  expect(fs.getNode(other.id).name).toBe("Delta");

  // A window that closes while the error shows opens no box.
  win = await openDocuments(s);
  input = await renameInExplorer(s, win, other.id);
  input.value = "My Music";
  key(s, input, "Enter");
  await settle();
  win.querySelector(".close-btn").click();
  await settle();
  await answer(s);
  expect(win.isConnected).toBeFalse();
  expect(s.document.querySelector(".explorer-rename")).toBeNull();
});

test("a desktop rename to a name in use shows XP's error and opens the box again", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const first = fs.createFile(fs.DESKTOP, "first.txt", { content: "" });
  fs.createFile(fs.DESKTOP, "second.txt", { content: "" });
  await settle();
  let input = await renameOnDesktop(s, first.id);
  input.value = "SECOND.txt";
  key(s, input, "Enter");
  await settle();
  expect(dialogs(s).map((dialog) => dialog.text)).toEqual([
    "Cannot rename first: A file with the name you specified already exists. Specify a different file name.",
  ]);
  await answer(s);
  input = s.document.querySelector(".desktop-rename");
  expect(s.document.activeElement === input).toBeTrue();
  expect(input.value).toBe("first.txt");
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 9]);
  key(s, input, "Escape");
  await settle();
  expect(fs.getNode(first.id).name).toBe("first.txt");

  // An icon that goes away while the error shows gets no box.
  input = await renameOnDesktop(s, first.id);
  input.value = "second.txt";
  key(s, input, "Enter");
  await settle();
  fs.destroy(first.id);
  await settle();
  await answer(s);
  expect(s.document.querySelector(".desktop-rename")).toBeNull();
});

test("Save As refuses a name with a character Windows does not allow", async () => {
  const s = await login(await loadShell());
  const save = s.window.XPDialogs.saveFile({ defaultExtension: ".txt" });
  await settle();
  const name = s.document.getElementById("dlg-file-name");
  name.value = "a|b";
  key(s, name, "Enter");
  await settle();
  expect(dialogs(s).at(-1)).toEqual({
    title: "Save As",
    text: "a|b.txt\nThe above file name is invalid.",
  });
  await answer(s);
  // The Save As dialog stays open for another name.
  s.document.getElementById("dlg-file-name").value = "ab";
  key(s, s.document.getElementById("dlg-file-name"), "Enter");
  await settle();
  expect((await save).name).toBe("ab.txt");
});

// The texts below come from Explorer in an XP SP3 virtual machine.
test("rename boxes act on each refused name like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.MY_DOCUMENTS, "file1.txt", { content: "" });
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "fold");
  fs.createFile(fs.MY_DOCUMENTS, "other.txt", { content: "" });
  const win = await openDocuments(s);
  const rename = async (id, value) => {
    const input = await renameInExplorer(s, win, id);
    input.value = value;
    key(s, input, "Enter");
    await settle();
  };
  // An empty name and a bare device name keep the old name, with no
  // message.
  for (const value of ["", "   ", "con", "NUL", "con.", "com1 "]) {
    await rename(file.id, value);
    expect(dialogs(s)).toEqual([]);
    expect(fs.getNode(file.id).name).toBe("file1.txt");
    expect(win.querySelector(".explorer-rename")).toBeNull();
  }
  // A name in use and a device name with an extension get one text. It
  // names the file without its extension.
  const inUse = {
    title: "Error Renaming File or Folder",
    text: "Cannot rename file1: A file with the name you specified already exists. Specify a different file name.",
  };
  for (const value of ["con.txt", "nul.txt", "other.txt", "fold"]) {
    await rename(file.id, value);
    // A name with no extension asks about the extension first, like XP.
    if (value === "fold") await answer(s, "Yes");
    expect(dialogs(s)).toEqual([inUse]);
    await answer(s);
    const input = win.querySelector(".explorer-rename");
    expect(input.value).toBe("file1.txt");
    key(s, input, "Escape");
    await settle();
  }
  await rename(folder.id, "other.txt");
  expect(dialogs(s).map((dialog) => dialog.text)).toEqual([
    "Cannot rename fold: A file with the name you specified already exists. Specify a different file name.",
  ]);
  await answer(s);
  key(s, win.querySelector(".explorer-rename"), "Escape");
  await settle();
  // Spaces and periods at the end go away.
  await rename(file.id, "abd.txt ");
  expect(fs.getNode(file.id).name).toBe("abd.txt");
  await rename(file.id, "abc.txt.");
  expect(fs.getNode(file.id).name).toBe("abc.txt");
  await rename(folder.id, "abe .. ");
  expect(fs.getNode(folder.id).name).toBe("abe");
  expect(dialogs(s)).toEqual([]);
  // A bad character that gets past the box has XP's text too.
  const input = await renameInExplorer(s, win, file.id);
  input.value = "a?b.txt";
  key(s, input, "Enter");
  await settle();
  expect(dialogs(s)).toEqual([
    {
      title: "Error Renaming File or Folder",
      text: 'A file name cannot contain any of the following characters:\n\t\\ / : * ? " < > |',
    },
  ]);
  await answer(s);
  // Another error keeps its own text, with no module name.
  fs.getNode(file.id).protected = true;
  const box = win.querySelector(".explorer-rename");
  box.value = "x.txt";
  key(s, box, "Enter");
  await settle();
  expect(dialogs(s).map((dialog) => dialog.text)).toEqual([
    "Cannot rename abc.txt: Access is denied.",
  ]);
});

test("a desktop rename box keeps the old name for an empty or device name", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "note.txt", { content: "" });
  await settle();
  for (const value of ["", "aux", "note.txt "]) {
    const input = await renameOnDesktop(s, file.id);
    input.value = value;
    key(s, input, "Enter");
    await settle();
    expect(dialogs(s)).toEqual([]);
    expect(fs.getNode(file.id).name).toBe("note.txt");
  }
  const input = await renameOnDesktop(s, file.id);
  input.value = "prn.txt";
  key(s, input, "Enter");
  await settle();
  expect(dialogs(s).map((dialog) => dialog.text)).toEqual([
    "Cannot rename note: A file with the name you specified already exists. Specify a different file name.",
  ]);
});

// Like XP, a one-line box takes only the first line of a paste. A file name
// box also drops the bad characters of that line, and shows its balloon.
test("a paste with line breaks keeps its first line, and a bad character in it shows the balloon", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Alpha");
  const win = await openDocuments(s);
  const input = await renameInExplorer(s, win, folder.id);
  input.value = "";
  for (const text of ["a\nb", "c\r\n", "\r"]) {
    expect(paste(s, input, text)).toBeFalse();
    expect(balloon(s)).toEqual([]);
  }
  expect(input.value).toBe("ac");
  // XP gives "ab" and the balloon for "a:b" and "c" on two lines.
  input.value = "";
  expect(paste(s, input, "a:b\r\nc")).toBeFalse();
  expect(input.value).toBe("ab");
  expect(balloon(s)).toEqual(BALLOON);
  // An empty first line takes the place of the selected text.
  input.select();
  expect(paste(s, input, "\nz")).toBeFalse();
  expect(input.value).toBe("");
  // Text with only bad characters leaves the box as it is.
  input.value = "keep";
  input.setSelectionRange(0, 4);
  expect(paste(s, input, "?*\nz")).toBeFalse();
  expect(input.value).toBe("keep");
  // Clean text on one line is the browser's own paste.
  input.setSelectionRange(4, 4);
  expect(paste(s, input, "s")).toBeTrue();
  expect(input.value).toBe("keeps");

  // Every one-line box keeps the first line, also one with no check.
  const address = win.querySelector(".explorer-address input");
  address.value = "";
  expect(paste(s, address, "C:\\one\ntwo")).toBeFalse();
  expect(address.value).toBe("C:\\one");
  // A read-only box and a box with its own paste are left alone.
  address.readOnly = true;
  expect(paste(s, address, "x\ny")).toBeTrue();
  address.readOnly = false;
  address.dataset.ownPaste = "";
  expect(paste(s, address, "x\ny")).toBeTrue();
  // A multi-line box takes every line.
  const area = s.document.createElement("textarea");
  s.document.body.append(area);
  expect(paste(s, area, "x\ny")).toBeTrue();
  expect(area.value).toBe("x\ny");
  area.remove();
});

test("Ctrl+Z after an input method never brings back a refused character", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Alpha");
  const win = await openDocuments(s);
  const input = await renameInExplorer(s, win, folder.id);
  // A model of Chrome's undo list for the box. Each edit keeps the text
  // before it. Undo and redo put a kept text back and send an input event,
  // in the execCommand call, like Chrome.
  let past = [];
  let future = [];
  const restore = (from, to, inputType) => {
    if (!from.length) return false;
    to.push(input.value);
    input.value = from.pop();
    input.dispatchEvent(
      new s.window.InputEvent("input", { inputType, bubbles: true }),
    );
    return true;
  };
  const commands = [];
  s.document.execCommand = (command, _, text) => {
    commands.push(command);
    if (command === "undo") return restore(past, future, "historyUndo");
    if (command === "redo") return restore(future, past, "historyRedo");
    past.push(input.value);
    future = [];
    input.setRangeText(
      command === "delete" ? "" : text,
      input.selectionStart,
      input.selectionEnd,
      "end",
    );
    return true;
  };
  // The input method puts its text in as one native edit.
  const compose = (value) => {
    input.dispatchEvent(new s.window.Event("compositionstart"));
    past.push(input.value);
    future = [];
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new s.window.Event("compositionend"));
  };
  compose("Alphax?y");
  expect(input.value).toBe("Alphaxy");
  // Ctrl+Z takes back the cleanup, and the box skips the state with "?".
  commands.length = 0;
  s.document.execCommand("undo");
  expect(input.value).toBe("Alpha");
  expect(commands).toEqual(["undo", "undo"]);
  // Ctrl+Y does the same in the other direction.
  commands.length = 0;
  s.document.execCommand("redo");
  expect(input.value).toBe("Alphaxy");
  expect(commands).toEqual(["redo", "redo"]);
  expect(input.value.includes("?")).toBeFalse();
  // With no step left, the box cleans the text itself.
  past = [];
  future = [];
  input.value = "Alpha?";
  input.dispatchEvent(
    new s.window.InputEvent("input", {
      inputType: "historyUndo",
      bubbles: true,
    }),
  );
  expect(input.value).toBe("Alpha");
  // A browser with no execCommand cleans the text too.
  s.document.execCommand = undefined;
  input.value = "Al*pha";
  input.dispatchEvent(
    new s.window.InputEvent("input", {
      inputType: "historyRedo",
      bubbles: true,
    }),
  );
  expect(input.value).toBe("Alpha");
  // A plain edit is left to the beforeinput check.
  input.value = "Al*pha";
  input.dispatchEvent(
    new s.window.InputEvent("input", {
      inputType: "insertText",
      bubbles: true,
    }),
  );
  expect(input.value).toBe("Al*pha");
});

// The texts below come from Notepad's Save As in an XP SP3 virtual machine.
test("Save As keeps the dialog open in a folder that takes no files, and .. stops at the top of a drive", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const save = s.window.XPDialogs.saveFile({ defaultExtension: ".txt" });
  await settle();
  const name = () => s.document.getElementById("dlg-file-name");
  const enter = async (value) => {
    name().value = value;
    key(s, name(), "Enter");
    await settle();
  };
  const refused = {
    title: "Save As",
    text: "You cannot save in the folder you specified. Please choose another location.",
  };
  // The Places bar opens My Computer, which takes no files.
  s.document
    .querySelector(`.dlg-file-place[data-folder-id="${fs.MY_COMPUTER}"]`)
    .click();
  await settle();
  await enter("x");
  expect(dialogs(s).at(-1)).toEqual(refused);
  await answer(s);
  // ".." in My Computer goes to the Desktop, like XP.
  await enter("..");
  expect(s.document.querySelector(".dlg-file-folder").textContent).toContain(
    "Desktop",
  );
  expect(dialogs(s).map((dialog) => dialog.title)).toEqual(["Save As"]);
  // A path into the Recycle Bin is refused too.
  await enter("C:");
  const binFolder = fs.createFolder(fs.DESKTOP, "Gone");
  fs.remove(binFolder.id);
  await settle();
  // From C:\, ".." stays in C:\, so "..\x" saves C:\x.txt.
  await enter("..\\x");
  const result = await save;
  expect(result).toEqual({
    parentId: fs.DRIVE_C,
    name: "x.txt",
    existingId: null,
  });
});

const EXTENSION_QUESTION = {
  title: "Rename",
  text: "If you change a file name extension, the file may become unusable.\n\nAre you sure you want to change it?",
};

test("an Explorer rename asks before it changes the extension of a known file type, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const text = fs.createFile(fs.MY_DOCUMENTS, "notes.txt", { content: "" });
  const win = await openDocuments(s);
  const rename = async (id, name) => {
    const input = await renameInExplorer(s, win, id);
    input.value = name;
    key(s, input, "Enter");
    await settle();
  };
  await rename(text.id, "notes.doc");
  expect(dialogs(s)).toEqual([EXTENSION_QUESTION]);
  // The box keeps the new name while the question shows.
  expect(win.querySelector(".explorer-rename").value).toBe("notes.doc");
  expect(
    [...s.document.querySelectorAll(".xp-dialog .dlg-buttons button")].map(
      (button) => button.textContent,
    ),
  ).toEqual(["Yes", "No"]);
  // No keeps the old name and opens the box again with it, all selected.
  await answer(s, "No");
  expect(fs.getNode(text.id).name).toBe("notes.txt");
  const again = win.querySelector(".explorer-rename");
  expect(again.value).toBe("notes.txt");
  expect([again.selectionStart, again.selectionEnd]).toEqual([0, 9]);
  key(s, again, "Escape");
  await settle();
  // An extension that goes away asks too, and Yes renames.
  await rename(text.id, "notes");
  expect(dialogs(s)).toEqual([EXTENSION_QUESTION]);
  await answer(s, "Yes");
  expect(fs.getNode(text.id).name).toBe("notes");
  expect(win.querySelector(".explorer-rename")).toBeNull();

  // No question for a file with no extension, a type that XP does not
  // know, a change of case only, or a folder.
  const plain = fs.createFile(fs.MY_DOCUMENTS, "readme", { content: "" });
  const backup = fs.createFile(fs.MY_DOCUMENTS, "old.bak", { content: "" });
  const upper = fs.createFile(fs.MY_DOCUMENTS, "list.txt", { content: "" });
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "box");
  await settle();
  for (const [node, name] of [
    [plain, "readme.txt"],
    [backup, "old.xyz"],
    [upper, "LIST.TXT"],
    [folder, "box.txt"],
  ]) {
    await rename(node.id, name);
    expect(dialogs(s)).toEqual([]);
    expect(fs.getNode(node.id).name).toBe(name);
  }

  // An item that goes away while the question shows gets no box.
  const gone = fs.createFile(fs.MY_DOCUMENTS, "gone.txt", { content: "" });
  await settle();
  await rename(gone.id, "gone.doc");
  fs.destroy(gone.id);
  await settle();
  await answer(s, "No");
  expect(win.querySelector(".explorer-rename")).toBeNull();
});

test("a desktop rename asks before it changes the extension of a known file type, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "photo.png", { content: "" });
  await settle();
  let input = await renameOnDesktop(s, file.id);
  input.value = "photo.gif";
  key(s, input, "Enter");
  await settle();
  expect(dialogs(s)).toEqual([EXTENSION_QUESTION]);
  await answer(s, "No");
  expect(fs.getNode(file.id).name).toBe("photo.png");
  input = s.document.querySelector(".desktop-rename");
  expect(input.value).toBe("photo.png");
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 9]);
  input.value = "photo.gif";
  key(s, input, "Enter");
  await settle();
  await answer(s, "Yes");
  expect(fs.getNode(file.id).name).toBe("photo.gif");
  expect(s.document.querySelector(".desktop-rename")).toBeNull();

  // An icon that goes away while the question shows gets no box.
  input = await renameOnDesktop(s, file.id);
  input.value = "photo.txt";
  key(s, input, "Enter");
  await settle();
  fs.destroy(file.id);
  await settle();
  await answer(s, "No");
  expect(s.document.querySelector(".desktop-rename")).toBeNull();
});
