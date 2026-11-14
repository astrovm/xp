// @ts-nocheck -- The Command Prompt window driven through the real shell.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { pressAltGr } from "./helpers/keys";

afterEach(cleanupShells);

const settle = async () => {
  for (let i = 0; i < 4; i++) await flushShell();
};

async function openCommandPrompt() {
  const s = await login(await loadShell());
  s.document.getElementById("start-button").click();
  s.document.getElementById("all-programs-button").click();
  const button = (label) =>
    [...s.document.querySelectorAll(".start-program-flyout button")].find(
      (item) => item.textContent.replace("▶", "").trim() === label,
    );
  button("Accessories").click();
  button("Command Prompt").click();
  await settle();
  const win = s.document.querySelector(
    '.xp-window[data-game="__command-prompt"]',
  );
  const input = win.querySelector(".xp-terminal-prompt input");
  const output = win.querySelector(".xp-terminal-output");
  const press = async (key) => {
    input.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
  };
  const enter = async (command) => {
    input.value = command;
    await press("Enter");
  };
  return { s, win, input, output, press, enter };
}

test("the Command Prompt runs commands, recalls history, and clears the screen", async () => {
  const h = await openCommandPrompt();
  await h.press("ArrowUp");
  expect(h.input.value).toBe("");
  await h.press("a");
  await h.enter("   ");
  await h.enter("ver");
  expect(h.output.textContent).toContain("Microsoft Windows XP");
  await h.enter("echo hello");
  await h.press("ArrowUp");
  expect(h.input.value).toBe("echo hello");
  await h.press("ArrowUp");
  await h.press("ArrowUp");
  expect(h.input.value).toBe("ver");
  await h.press("ArrowDown");
  await h.press("ArrowDown");
  expect(h.input.value).toBe("");
  await h.enter("cls");
  // Like cmd.exe, the screen keeps its blank line at the top.
  expect(h.output.textContent).toBe("\n");
  h.win
    .querySelector(".xp-terminal-screen")
    .dispatchEvent(
      new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
  h.win
    .querySelector(".title-buttons")
    .dispatchEvent(
      new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
});

test("the Command Prompt reports thrown errors and closes on exit", async () => {
  const h = await openCommandPrompt();
  const fs = h.s.window.VirtualFS;
  const transaction = fs.transaction;
  fs.transaction = () => {
    throw new Error("storage offline");
  };
  try {
    await h.enter("dir");
  } finally {
    fs.transaction = transaction;
  }
  expect(h.output.textContent).toContain("storage offline");
  await h.enter("exit");
  expect(h.win.isConnected).toBeFalse();
});

test("the Command Prompt puts a blank line after each command, like cmd.exe", async () => {
  const h = await openCommandPrompt();
  const prompt = "C:\\Documents and Settings\\astro>";
  expect(h.output.textContent).toBe(
    "Microsoft Windows XP [Version 5.1.2600]\n(C) Copyright 1985-2001 Microsoft Corp.\n\n",
  );
  const start = h.output.textContent.length;
  await h.enter("");
  await h.enter("cd .");
  await h.enter("echo hi");
  await h.enter("ver");
  await h.enter("echo a>a.txt");
  await h.enter("md Box");
  await h.enter("echo b>Box\\a.txt");
  await h.enter("copy a.txt Box");
  await h.enter("x");
  await h.enter("y");
  const question = "Overwrite Box\\a.txt? (Yes/No/All): ";
  expect(h.output.textContent.slice(start)).toBe(
    [
      `${prompt}\n`,
      `${prompt}cd .\n\n`,
      `${prompt}echo hi\nhi\n\n`,
      `${prompt}ver\n\nMicrosoft Windows XP [Version 5.1.2600]\n\n`,
      `${prompt}echo a>a.txt\n\n`,
      `${prompt}md Box\n\n`,
      `${prompt}echo b>Box\\a.txt\n\n`,
      `${prompt}copy a.txt Box\n`,
      `${question}x\n`,
      `${question}y\n        1 file(s) copied.\n\n`,
    ].join(""),
  );
});

test("the Command Prompt runs nothing on an Enter of an input method", async () => {
  const h = await openCommandPrompt();
  const before = h.output.textContent;
  h.input.value = "ver";
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    h.input.dispatchEvent(
      new h.s.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
    await settle();
  }
  expect(h.output.textContent).toBe(before);
  expect(h.input.value).toBe("ver");
  await h.press("Enter");
  expect(h.output.textContent).toContain("ver\n\nMicrosoft Windows XP");
});

test("DIR /P pauses after each screen with XP's text, and Ctrl+C ends it", async () => {
  const h = await openCommandPrompt();
  const fs = h.s.window.VirtualFS;
  const folder = fs.createFolder(fs.USER_PROFILE, "Many");
  for (let index = 0; index < 30; index += 1)
    fs.createFile(folder.id, `f${String(index).padStart(2, "0")}.txt`, {
      content: "x",
    });
  await h.enter("cd Many");
  const prompt = h.win.querySelector(".xp-terminal-prompt span");
  const key = async (name, init = {}) => {
    const event = new h.s.window.KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    h.input.dispatchEvent(event);
    await settle();
    return event.defaultPrevented;
  };
  const PAUSE = "Press any key to continue . . . ";
  let start = h.output.textContent.length;
  await h.enter("dir /p");
  // The listing has 39 rows. A screen of 25 rows shows 24 of them, then
  // the question on the last row.
  let shown = h.output.textContent.slice(start).split("\n");
  expect(shown[0]).toBe("C:\\Documents and Settings\\astro\\Many>dir /p");
  expect(shown.slice(1, -1)).toHaveLength(24);
  expect(shown[1]).toBe(" Volume in drive C has no label.");
  expect(shown.at(-2)).toContain("f16.txt");
  expect(shown.at(-1)).toBe(PAUSE);
  expect(prompt.textContent).toBe("");
  expect(h.input.disabled).toBeFalse();
  // Shift, Ctrl and Alt alone do not go on.
  for (const name of ["Shift", "Control", "Alt"])
    expect(await key(name)).toBeFalse();
  expect(h.output.textContent.endsWith(PAUSE)).toBeTrue();
  // Any other key goes on, and the question stays on its row.
  expect(await key("x")).toBeTrue();
  shown = h.output.textContent.slice(start).split("\n");
  expect(shown[25]).toBe(PAUSE);
  expect(shown.slice(26, -2)).toHaveLength(15);
  expect(shown.at(-3)).toContain("Dir(s)");
  expect(shown.at(-2)).toBe("");
  expect(h.input.value).toBe("");
  expect(prompt.textContent).toBe("C:\\Documents and Settings\\astro\\Many>");

  // Ctrl+C at the question ends the listing, with the blank row and the
  // prompt after it.
  start = h.output.textContent.length;
  await h.enter("dir /p /s");
  expect(h.output.textContent.endsWith(PAUSE)).toBeTrue();
  expect(await key("c", { ctrlKey: true })).toBeTrue();
  expect(h.output.textContent.endsWith(`${PAUSE}\n\n`)).toBeTrue();
  expect(h.output.textContent.slice(start)).not.toContain("Dir(s)");

  // A listing that fits on the screen does not pause, and /-P turns it off.
  start = h.output.textContent.length;
  await h.enter("dir /p /-p");
  expect(h.output.textContent.slice(start)).not.toContain(PAUSE);
  start = h.output.textContent.length;
  await h.enter("dir /p /b f00*");
  expect(h.output.textContent.slice(start)).not.toContain(PAUSE);
  expect(prompt.textContent).toBe("C:\\Documents and Settings\\astro\\Many>");

  // A screen with a size pauses after the rows that it shows. 12 pixels
  // make a row, and the screen has 4 pixels of border.
  Object.defineProperty(
    h.win.querySelector(".xp-terminal-screen"),
    "clientHeight",
    {
      configurable: true,
      value: 124,
    },
  );
  start = h.output.textContent.length;
  await h.enter("dir /p /b");
  shown = h.output.textContent.slice(start).split("\n");
  expect(shown.slice(1, -1)).toHaveLength(9);
  expect(shown.at(-1)).toBe(PAUSE);
  expect(await key("c", { ctrlKey: true })).toBeTrue();
});

const PAUSE = "Press any key to continue . . . ";
// Pastes text into the Command Prompt like Chrome: the paste event first.
const paste = (h, text) => {
  const clipboardData = new h.s.window.DataTransfer();
  clipboardData.setData("text/plain", text);
  const event = new h.s.window.ClipboardEvent("paste", {
    clipboardData,
    bubbles: true,
    cancelable: true,
  });
  h.input.dispatchEvent(event);
  return event.defaultPrevented;
};
const manyFiles = (
  h,
  count,
  name = (index) => `f${String(index).padStart(2, "0")}.txt`,
) => {
  const fs = h.s.window.VirtualFS;
  const folder = fs.createFolder(fs.USER_PROFILE, "Many");
  for (let index = 0; index < count; index += 1)
    fs.createFile(folder.id, name(index), { content: "x" });
};

// The XP SP3 VM: a paste types the text, and each line break runs the line
// before it. Text after the last line break stays typed.
test("a paste in the Command Prompt runs each line at its line break, like XP", async () => {
  const h = await openCommandPrompt();
  const prompt = "C:\\Documents and Settings\\astro>";
  let start = h.output.textContent.length;
  expect(paste(h, "echo one\r\necho two")).toBeTrue();
  await settle();
  expect(h.output.textContent.slice(start)).toBe(`${prompt}echo one\none\n\n`);
  expect(h.input.value).toBe("echo two");
  // The text goes in at the caret, and every kind of line break runs.
  h.input.value = "ec";
  h.input.setSelectionRange(2, 2);
  start = h.output.textContent.length;
  paste(h, "ho a\recho b\necho c\r\n");
  await settle();
  expect(h.output.textContent.slice(start)).toBe(
    `${prompt}echo a\na\n\n${prompt}echo b\nb\n\n${prompt}echo c\nc\n\n`,
  );
  expect(h.input.value).toBe("");
  // A line of a paste answers the question of a command.
  const fs = h.s.window.VirtualFS;
  fs.createFile(fs.USER_PROFILE, "a.txt", { content: "a" });
  fs.createFolder(fs.USER_PROFILE, "Box");
  await h.enter("copy a.txt Box");
  start = h.output.textContent.length;
  paste(h, "copy a.txt Box\ny\n");
  await settle();
  expect(h.output.textContent.slice(start)).toContain(
    "Overwrite Box\\a.txt? (Yes/No/All): y\n        1 file(s) copied.",
  );
  // EXIT in a paste closes the window, and the rest goes away.
  paste(h, "exit\necho late\n");
  await settle();
  expect(h.win.isConnected).toBeFalse();
});

test("a paste at the pause of DIR /P goes on, and the rest runs after it", async () => {
  const h = await openCommandPrompt();
  manyFiles(h, 30);
  await h.enter("cd Many");
  const start = h.output.textContent.length;
  await h.enter("dir /p");
  expect(h.output.textContent.endsWith(PAUSE)).toBeTrue();
  // The pause reads one character. A Windows line break is one character.
  paste(h, "\r\necho after\n");
  await settle();
  const shown = h.output.textContent.slice(start);
  expect(shown).toContain("Dir(s)");
  expect(shown).toContain("Many>echo after\nafter\n");
  expect(h.input.value).toBe("");
  // A pasted command that pauses reads the next character of the paste.
  paste(h, "dir /p\nzecho again\n");
  await settle();
  expect(h.output.textContent.endsWith("Many>echo again\nagain\n\n")).toBe(
    true,
  );
  // A paste with no text does nothing at a pause.
  await h.enter("dir /p");
  paste(h, "");
  await settle();
  expect(h.output.textContent.endsWith(PAUSE)).toBeTrue();
  await h.press("x");
  // A paste of more characters than pauses types the rest.
  await h.enter("dir /p");
  paste(h, "xy");
  await settle();
  expect(h.output.textContent.endsWith(PAUSE)).toBeFalse();
  expect(h.input.value).toBe("y");
});

// The XP SP3 VM: DIR /P counts screen rows, not lines. A screen of 25 rows
// shows 24 rows, then the question. A long line takes more than one row.
test("DIR /P counts the screen rows of long lines, like the console", async () => {
  const h = await openCommandPrompt();
  // 80 columns of 12 pixels make a row. A line goes on to the next row at
  // the last column.
  const proto = h.s.window.Range.prototype;
  const rects = proto.getClientRects;
  proto.getClientRects = function () {
    const length = this.startContainer.textContent.length;
    return Array.from({ length: Math.ceil(length / 80) }, (_, row) => ({
      top: row * 12,
    }));
  };
  try {
    // Each name takes two rows in the bare format.
    manyFiles(
      h,
      20,
      (index) => `${String(index).padStart(2, "0")}${"n".repeat(90)}.txt`,
    );
    await h.enter("cd Many");
    const start = h.output.textContent.length;
    await h.enter("dir /p /b");
    const shown = h.output.textContent.slice(start).split("\n");
    // 12 names of two rows fill 24 rows.
    expect(shown.slice(1, -1)).toHaveLength(12);
    expect(shown.at(-1)).toBe(PAUSE);
    await h.press("x");
    // The question row is not counted: the next page has 8 names.
    expect(
      h.output.textContent.slice(start).split("\n").slice(14, 22),
    ).toHaveLength(8);
    expect(h.output.textContent.slice(start)).not.toContain("continuing");
  } finally {
    proto.getClientRects = rects;
  }
});

// A measure of the screen rows right after a change of the text makes the
// browser lay out the whole screen again. Each screen of DIR /P measures
// its lines in one layout, so a long screen does not stall.
test("DIR /P lays out each screen one time", async () => {
  const h = await openCommandPrompt();
  manyFiles(h, 200, (index) => `f${String(index).padStart(3, "0")}.txt`);
  await h.enter("cd Many");
  const { Element, Range } = h.s.window;
  const append = Element.prototype.append;
  const rects = Range.prototype.getClientRects;
  let changed = false;
  let layouts = 0;
  Element.prototype.append = function (...nodes) {
    changed = true;
    return append.apply(this, nodes);
  };
  Range.prototype.getClientRects = function () {
    if (changed) layouts += 1;
    changed = false;
    return rects.call(this);
  };
  try {
    await h.enter("dir /p /b");
    expect(h.output.textContent.endsWith(PAUSE)).toBeTrue();
    expect(layouts).toBe(1);
    await h.press("x");
    expect(layouts).toBe(2);
  } finally {
    Element.prototype.append = append;
    Range.prototype.getClientRects = rects;
  }
  // AltGr+C types "ć" on a Polish keyboard. It is no Ctrl+C, so the
  // listing goes on, like any other key.
  const shown = h.output.textContent.length;
  pressAltGr(h.s.window, h.input, "ć", "KeyC");
  await settle();
  expect(h.output.textContent.slice(shown)).toContain("f");
  expect(h.output.textContent.endsWith(PAUSE)).toBeTrue();
  // Ctrl+C ends the listing with each keyboard layout. A Russian layout
  // types "с" on the C key.
  const stop = new h.s.window.KeyboardEvent("keydown", {
    key: "с",
    code: "KeyC",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  h.input.dispatchEvent(stop);
  await settle();
  expect(stop.defaultPrevented).toBeTrue();
  expect(h.output.textContent.endsWith(`${PAUSE}\n\n`)).toBeTrue();
  expect(h.output.textContent).not.toContain("f100.txt");
});

// The XP SP3 VM: at the pause, the modifier and lock keys do not go on. An
// arrow or a function key goes on two times. Ctrl+C prints no ^C.
test("the pause of DIR /P takes the keys like cmd.exe", async () => {
  const h = await openCommandPrompt();
  manyFiles(h, 200, (index) => `f${String(index).padStart(3, "0")}.txt`);
  await h.enter("cd Many");
  const key = async (name, init = {}) => {
    const event = new h.s.window.KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    h.input.dispatchEvent(event);
    await settle();
    return event.defaultPrevented;
  };
  const pauses = () => h.output.textContent.split(PAUSE).length - 1;
  await h.enter("dir /p");
  expect(pauses()).toBe(1);
  for (const name of [
    "Shift",
    "Control",
    "Alt",
    "AltGraph",
    "CapsLock",
    "NumLock",
    "ScrollLock",
    "Dead",
    "Process",
    "Unidentified",
  ])
    expect(await key(name)).toBeFalse();
  expect(pauses()).toBe(1);
  // Space goes on one page.
  expect(await key(" ")).toBeTrue();
  expect(pauses()).toBe(2);
  // Left and F5 each go on two pages.
  await key("ArrowLeft");
  expect(pauses()).toBe(4);
  await key("F5");
  expect(pauses()).toBe(6);
  // Ctrl+C ends the listing with no ^C.
  await key("c", { ctrlKey: true });
  expect(h.output.textContent.endsWith(`${PAUSE}\n\n`)).toBeTrue();
  expect(h.output.textContent.includes("^C")).toBeFalse();
  // A second press left over at the end of a command goes away.
  const before = pauses();
  await h.enter("dir /p /b f00*");
  await h.enter("dir /p");
  expect(pauses()).toBe(before + 1);
  await key("End");
  expect(pauses()).toBe(before + 3);
  await key("c", { ctrlKey: true });
});

// Like XP, the desktop cannot delete or rename the folder above the folder
// of an open Command Prompt. The window that closes frees it.
test("an open Command Prompt locks its folders until its window closes", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const outer = fs.createFolder(fs.DESKTOP, "t");
  const inner = fs.createFolder(outer.id, "t2");
  await h.enter(`cd "${fs.getPath(inner.id)}"`);
  const dialogs = () =>
    [...s.document.querySelectorAll(".xp-dialog")].map((dialog) => [
      dialog.getAttribute("aria-label"),
      dialog.querySelector(".dlg-text")?.textContent,
    ]);
  const click = async (selector) => {
    s.document.querySelector(selector).click();
    await settle();
  };
  const menu = async (action) => {
    const icon = s.document.querySelector(
      `.desktop-icon[data-desktop-id="${outer.id}"]`,
    );
    icon.focus();
    icon.dispatchEvent(
      new s.window.MouseEvent("contextmenu", { bubbles: true }),
    );
    await click(`#desktop-context-menu [data-action="${action}"]`);
  };
  const DENIED =
    "Access is denied.\n\nMake sure the disk is not full or write-protected and that the file is not currently in use.";
  await menu("delete");
  await click('.xp-dialog [data-action="yes"]');
  expect(dialogs()).toEqual([
    ["Error Deleting File or Folder", `Cannot delete t: ${DENIED}`],
  ]);
  await click('.xp-dialog [data-action="ok"]');
  expect(fs.getNode(outer.id).parent).toBe(fs.DESKTOP);
  await menu("rename");
  const box = s.document.querySelector(".desktop-rename");
  box.value = "u";
  box.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  expect(dialogs()).toEqual([
    ["Error Renaming File or Folder", `Cannot rename t: ${DENIED}`],
  ]);
  await click('.xp-dialog [data-action="ok"]');
  s.document.querySelector(".desktop-rename")?.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  expect(fs.getNode(outer.id).name).toBe("t");
  await h.enter("exit");
  expect(h.win.isConnected).toBeFalse();
  await menu("delete");
  await click('.xp-dialog [data-action="yes"]');
  expect(dialogs()).toEqual([]);
  expect(fs.isInRecycleBin(outer.id)).toBeTrue();
});

// A drag event with the data of a drag. Happy DOM keeps no dataTransfer.
const dragOn = (s, element, type, transfer) => {
  const event = new s.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  element.dispatchEvent(event);
  return event.defaultPrevented;
};
const transferOf = (data, files = []) => ({
  types: [...Object.keys(data), ...(files.length ? ["Files"] : [])],
  dropEffect: "move",
  files,
  getData: (format) => data[format] ?? "",
  setData(format, value) {
    data[format] = value;
    this.types = Object.keys(data);
  },
});

// In the XP VM, an item dropped on the Command Prompt types its path at
// the caret, in quotes when it has a space, and adds no space. Of many
// items, only the dragged one goes in.
test("the Command Prompt types the path of an item dropped on it, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const plain = fs.createFile(fs.DRIVE_C, "a.txt", { content: "" });
  const spaced = fs.createFile(fs.DRIVE_C, "b c.txt", { content: "" });
  const deleted = fs.createFile(fs.DRIVE_C, "gone.txt", { content: "" });
  fs.remove(deleted.id);
  const items = (ids) =>
    transferOf({ "application/x-astro-vfs-ids": JSON.stringify(ids) });
  // A drag of items is taken, over the prompt and over the screen.
  expect(dragOn(s, h.input, "dragover", items([plain.id]))).toBeTrue();
  const screen = h.win.querySelector(".xp-terminal-screen");
  expect(dragOn(s, screen, "dragenter", items([plain.id]))).toBeTrue();
  h.input.value = "type ";
  h.input.setSelectionRange(5, 5);
  dragOn(s, screen, "drop", items([spaced.id, plain.id]));
  await settle();
  expect(h.input.value).toBe('type "C:\\b c.txt"');
  dragOn(s, h.input, "drop", items([plain.id]));
  await settle();
  expect(h.input.value).toBe('type "C:\\b c.txt"C:\\a.txt');
  // The path goes in at the caret.
  h.input.setSelectionRange(0, 0);
  dragOn(s, h.input, "drop", items([plain.id]));
  await settle();
  expect(h.input.value).toBe('C:\\a.txttype "C:\\b c.txt"C:\\a.txt');
  // An item in the Recycle Bin, a missing item, a bad list and a file from
  // the computer type nothing.
  h.input.value = "";
  dragOn(s, h.input, "drop", items([deleted.id]));
  dragOn(s, h.input, "drop", items(["missing"]));
  dragOn(
    s,
    h.input,
    "drop",
    transferOf({ "application/x-astro-vfs-ids": "{" }),
  );
  const computerFile = transferOf({}, [{ name: "x.txt" }]);
  expect(dragOn(s, h.input, "dragover", computerFile)).toBeTrue();
  expect(computerFile.dropEffect).toBe("none");
  dragOn(s, h.input, "drop", computerFile);
  await settle();
  expect(h.input.value).toBe("");

  // In the XP VM, a drop on a Command Prompt that is behind another
  // window types the path, and the window stays behind.
  await runBox(s, "notepad");
  const focused = s.document.activeElement;
  dragOn(s, screen, "drop", items([plain.id]));
  await settle();
  expect(h.input.value).toBe("C:\\a.txt");
  expect(activeWindows(s)).toEqual(["__notepad"]);
  expect(s.document.activeElement).toBe(focused);
  expect(s.document.activeElement).not.toBe(h.input);
  await closeWindow(s, "__notepad");
  expect(activeWindows(s)).toEqual(["__command-prompt"]);
  expect(s.document.activeElement).toBe(h.input);
  h.input.value = "";

  // An Explorer drag gives the item that the pointer dragged, also when
  // other items are selected before it.
  s.window.history.replaceState(null, "", "#my-computer");
  fs.open(fs.DRIVE_C);
  await settle();
  const explorer = [...s.document.querySelectorAll(".xp-window")].find((win) =>
    win.querySelector(`.explorer-item[data-node-id="${plain.id}"]`),
  );
  const item = (id) =>
    explorer.querySelector(`.explorer-item[data-node-id="${id}"]`);
  item(plain.id).click();
  item(spaced.id).dispatchEvent(
    new s.window.MouseEvent("click", { ctrlKey: true, bubbles: true }),
  );
  const drag = transferOf({});
  dragOn(s, item(spaced.id), "dragstart", drag);
  expect(JSON.parse(drag.getData("application/x-astro-vfs-ids"))).toEqual([
    spaced.id,
    plain.id,
  ]);
  dragOn(s, h.input, "drop", drag);
  await settle();
  expect(h.input.value).toBe('"C:\\b c.txt"');

  // A desktop icon dragged onto the window types its path. The icon stays.
  h.input.value = "";
  const icon = fs.createFile(fs.DESKTOP, "desk.txt", { content: "" });
  const other = fs.createFile(fs.DESKTOP, "other.txt", { content: "" });
  await settle();
  const iconOf = (id) =>
    s.document.querySelector(`.desktop-icon[data-desktop-id="${id}"]`);
  s.document.elementsFromPoint = () => [h.input];
  // The icon that the pointer drags is the later one on the desktop.
  iconOf(icon.id).dispatchEvent(
    new s.window.PointerEvent("pointerdown", { button: 0, bubbles: true }),
  );
  iconOf(icon.id).dispatchEvent(
    new s.window.PointerEvent("pointerup", { button: 0, bubbles: true }),
  );
  [
    ["pointerdown", 10],
    ["pointermove", 190],
    ["pointerup", 190],
  ].forEach(([type, at]) =>
    iconOf(other.id).dispatchEvent(
      new s.window.PointerEvent(type, {
        button: 0,
        pointerId: 1,
        ctrlKey: type === "pointerdown",
        clientX: at,
        clientY: at,
        bubbles: true,
      }),
    ),
  );
  await settle();
  expect(
    [...s.document.querySelectorAll(".desktop-icon.selected")].length,
  ).toBe(2);
  const path = fs.getPath(other.id);
  expect(h.input.value).toBe(path.includes(" ") ? `"${path}"` : path);
  expect(fs.getNode(icon.id).parent).toBe(fs.DESKTOP);
});

// Like XP, a program that the Command Prompt runs takes its paths from the
// current folder.
test("the Command Prompt runs programs with paths from its folder, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const lastDialog = () =>
    [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  await h.enter("cd \\");
  await h.enter("notepad foo");
  expect(lastDialog().textContent).toContain(
    "Cannot find the foo.txt file.\n\nDo you want to create a new file?",
  );
  lastDialog().querySelector('[data-action="yes"]').click();
  await settle();
  expect(fs.resolvePath("C:\\foo.txt") === null).toBeFalse();
  expect(
    s.document.querySelector('.xp-window[data-game="__notepad"] .title-text')
      .textContent,
  ).toBe("foo.txt - Notepad");
  // A path that starts with "\" is on the drive of the folder.
  await h.enter("cd /d D:\\");
  await h.enter("notepad \\bar");
  expect(lastDialog().textContent).toContain("Cannot find the \\bar.txt file.");
  lastDialog().querySelector('[data-action="cancel"]').click();
  await settle();
  // cmd runs a new cmd in the same window, like XP.
  await h.enter("cmd");
  expect(s.document.querySelectorAll(".xp-command-prompt-window")).toHaveLength(
    1,
  );
  expect(h.output.textContent).not.toContain("'cmd' is not recognized");
  // An unknown name is no program.
  await h.enter("winword");
  expect(h.output.textContent).toContain("'winword' is not recognized");
});

// The controls of a Command Prompt window.
const promptIn = (s, win) => {
  const input = win.querySelector(".xp-terminal-prompt input");
  const press = async (key) => {
    input.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
  };
  return {
    win,
    input,
    press,
    text: () => win.querySelector(".xp-terminal-output").textContent,
    prompt: () => win.querySelector(".xp-terminal-prompt span").textContent,
    enter: async (command) => {
      input.value = command;
      await press("Enter");
    },
  };
};
const runBox = async (s, command) => {
  s.document.getElementById("start-button").click();
  s.document.querySelector('[data-start-action="run"]').click();
  const dialog = s.document.querySelector(".run-dialog");
  dialog.querySelector(".shell-dialog-input").value = command;
  dialog.querySelector('[data-action="run"]').click();
  await settle();
};
const promptWindows = (s) => [
  ...s.document.querySelectorAll(".xp-command-prompt-window"),
];

// In the XP VM, each cmd from Run, the Start menu or START has its own
// window, folder, history and questions. A cmd that another window starts
// does not answer a question that is open.
test("each Command Prompt is its own window, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 800 },
  );
  const foo = fs.createFolder(fs.USER_PROFILE, "foo");
  fs.createFile(foo.id, "a.txt");
  fs.createFolder(fs.USER_PROFILE, "yes");
  await h.enter("del foo");
  expect(h.win.querySelector(".xp-terminal-prompt span").textContent).toBe(
    `${fs.getPath(foo.id)}\\*, Are you sure (Y/N)? `,
  );
  // Run's cmd opens a new window. Its command is not the answer.
  await runBox(s, "cmd /k dir");
  expect(promptWindows(s)).toHaveLength(2);
  const second = promptIn(s, promptWindows(s)[1]);
  expect(second.win.dataset.game).toBe("__command-prompt#2");
  expect(second.text()).toContain(
    ` Directory of ${fs.getPath(fs.USER_PROFILE)}`,
  );
  expect(fs.getChildren(foo.id)).toHaveLength(1);
  expect(h.win.querySelector(".xp-terminal-prompt span").textContent).toBe(
    `${fs.getPath(foo.id)}\\*, Are you sure (Y/N)? `,
  );
  // Each window has its own history. The command of /K is not in it.
  await second.press("ArrowUp");
  expect(second.input.value).toBe("");
  await second.enter("cd foo");
  // The task bar, the title and the icon are the Command Prompt's. Like
  // XP, a window with an open question shows its command line.
  const buttons = [...s.document.querySelectorAll(".task-button")].filter(
    (button) => button.dataset.game?.startsWith("__command-prompt"),
  );
  expect(buttons.map((button) => button.title)).toEqual([
    "C:\\WINDOWS\\system32\\cmd.exe - del foo",
    "C:\\WINDOWS\\system32\\cmd.exe",
  ]);
  expect(second.win.querySelector(".title-icon img").getAttribute("src")).toBe(
    h.win.querySelector(".title-icon img").getAttribute("src"),
  );
  expect(buttons[1].querySelector(".task-icon img").getAttribute("src")).toBe(
    h.win.querySelector(".title-icon img").getAttribute("src"),
  );
  // TITLE changes only its own window.
  await second.enter("title Build");
  expect(second.win.querySelector(".title-text").textContent).toBe("Build");
  expect(h.win.querySelector(".title-text").textContent).toBe(
    "C:\\WINDOWS\\system32\\cmd.exe - del foo",
  );
  expect(s.document.title).toBe("Build");
  // The first window still has its question, and its answer.
  await h.enter("n");
  expect(fs.getChildren(foo.id)).toHaveLength(1);
  expect(h.win.querySelector(".xp-terminal-prompt span").textContent).toBe(
    `${fs.getPath(fs.USER_PROFILE)}>`,
  );
  await h.press("ArrowUp");
  await h.press("ArrowUp");
  expect(h.input.value).toBe("del foo");
  // START opens a new window in the folder of its cmd. Each folder stays
  // in use while its window is open.
  await second.enter('start "Third" echo hi');
  const third = promptIn(s, promptWindows(s)[2]);
  expect(third.win.querySelector(".title-text").textContent).toBe("Third");
  expect(third.text()).toBe("hi\n\n");
  expect(third.prompt()).toBe(`${fs.getPath(foo.id)}>`);
  await second.enter("cd ..");
  expect(() => fs.checkChange("delete", foo.id)).toThrow();
  await third.enter("exit");
  expect(third.win.isConnected).toBeFalse();
  expect(() => fs.checkChange("delete", foo.id)).not.toThrow();
  // A closed window frees its number for the next one.
  await second.enter("exit");
  await runBox(s, "cmd");
  expect(promptWindows(s).map((win) => win.dataset.game)).toEqual([
    "__command-prompt",
    "__command-prompt#2",
  ]);
  expect(promptIn(s, promptWindows(s)[1]).text()).toContain(
    "Microsoft Windows XP",
  );
});

// In the XP VM, cmd typed at the prompt runs a new cmd in the same window:
// its banner, then EXIT goes back. cmd /c runs its command there, and the
// new cmd starts in the folder of the old one.
test("cmd at the prompt runs a new cmd in the same window, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const profile = fs.getPath(fs.USER_PROFILE);
  const sub = fs.createFolder(fs.USER_PROFILE, "sub");
  await h.enter("cls");
  await h.enter("set NAME=one");
  await h.enter("cmd");
  expect(h.output.textContent).toBe(
    `\n${profile}>set NAME=one\n\n${profile}>cmd\nMicrosoft Windows XP [Version 5.1.2600]\n(C) Copyright 1985-2001 Microsoft Corp.\n\n`,
  );
  // The new cmd has a copy of the variables, and its own folder.
  await h.enter("set NAME=two");
  await h.enter("cd sub");
  expect(() => fs.checkChange("delete", sub.id)).toThrow();
  await h.enter("exit");
  expect(h.win.isConnected).toBeTrue();
  expect(() => fs.checkChange("delete", sub.id)).not.toThrow();
  expect(h.win.querySelector(".xp-terminal-prompt span").textContent).toBe(
    `${profile}>`,
  );
  await h.enter("cls");
  await h.enter("echo %NAME%");
  expect(h.output.textContent).toBe(`\n${profile}>echo %NAME%\none\n\n`);
  // cmd /c runs the command with all its arguments, and comes back. The
  // command can touch the switch.
  await h.enter("cls");
  await h.enter("cmd /c dir /b");
  await h.enter("cmd /cecho hi");
  expect(h.output.textContent).toBe(
    `\n${profile}>cmd /c dir /b\nDesktop\nMy Documents\nsub\n\n${profile}>cmd /cecho hi\nhi\n\n`,
  );
  // A question of cmd /c takes the next line, and then cmd /c ends.
  fs.createFile(sub.id, "a.txt");
  await h.enter("cmd /c del sub");
  await h.enter("y");
  expect(fs.getChildren(sub.id)).toHaveLength(0);
  await h.enter("cmd /k cd sub");
  expect(h.win.querySelector(".xp-terminal-prompt span").textContent).toBe(
    `${fs.getPath(sub.id)}>`,
  );
  await h.enter("cmd /c exit");
  await h.enter("exit");
  expect(h.win.querySelector(".xp-terminal-prompt span").textContent).toBe(
    `${profile}>`,
  );
  // The history of the window has the lines typed in each cmd.
  await h.press("ArrowUp");
  expect(h.input.value).toBe("exit");
  // EXIT in the first cmd closes the window.
  await h.enter("exit");
  expect(h.win.isConnected).toBeFalse();
});

// In the XP VM, cmd /c and /k lose the first quote and the last quote of
// their command.
test("Run's cmd takes a quoted command, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  fs.createFolder(fs.USER_PROFILE, "x y");
  await runBox(s, 'cmd /k "dir C:\\ /b"');
  const first = promptIn(s, promptWindows(s)[0]);
  expect(first.text()).toBe("Documents and Settings\n\n");
  await runBox(s, 'cmd /k "dir" /b');
  expect(promptIn(s, promptWindows(s)[1]).text()).toBe(
    "Desktop\nMy Documents\nx y\n\n",
  );
  await runBox(s, "cmd /kecho hi");
  expect(promptIn(s, promptWindows(s)[2]).text()).toBe("hi\n\n");
});

// In the XP VM, Explorer reads its own command line: a quoted path with a
// space after /select or /e, and a path with spaces and no quotes.
test("the Command Prompt gives Explorer its switches as typed, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "a b, c");
  const file = fs.createFile(folder.id, "x y.txt");
  const explorer = () =>
    s.document.querySelector('.xp-window[data-game="__my-documents"]');
  const address = () => explorer().querySelector(".explorer-address input");
  const folders = () =>
    explorer()
      .querySelector(".explorer-content")
      .classList.contains("folders-visible");
  const close = async () => {
    explorer().querySelector(".close-btn").click();
    await settle();
  };
  await h.enter(`explorer /select,"${fs.getPath(file.id)}"`);
  expect(address().value).toBe(fs.getPath(folder.id));
  expect(
    explorer()
      .querySelector(`.explorer-item[data-node-id="${file.id}"]`)
      .classList.contains("selected"),
  ).toBeTrue();
  await close();
  await h.enter(`explorer /e,"${fs.getPath(folder.id)}"`);
  expect(address().value).toBe(fs.getPath(folder.id));
  expect(folders()).toBeTrue();
  await close();
  await h.enter(`explorer ${fs.getPath(fs.MY_DOCUMENTS)}`);
  expect(address().value).toBe("My Documents");
  expect(folders()).toBeFalse();
  await close();
  await h.enter(`start explorer /root,"${fs.getPath(folder.id)}"`);
  expect(address().value).toBe(fs.getPath(folder.id));
  await close();
  expect(h.output.textContent).not.toContain("does not exist");
});

// In the XP VM, "explorer .." from a folder opens the folder above it, and
// Run's ".." opens the folder above the profile.
test("programs take . and .. from the Command Prompt and from Run, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const docs = fs.getPath(fs.MY_DOCUMENTS);
  const sub = fs.createFolder(fs.MY_DOCUMENTS, "sub");
  fs.createFile(fs.MY_DOCUMENTS, "a.txt", { content: "up" });
  fs.createFile(fs.MY_DOCUMENTS, "p.bmp");
  const address = () =>
    s.document.querySelector(
      '.xp-window[data-game="__my-documents"] .explorer-address input',
    ).value;
  const closeAll = async () => {
    s.document
      .querySelectorAll(
        '.xp-window:not(.xp-command-prompt-window) .close-btn, .xp-dialog [data-action="ok"]',
      )
      .forEach((button) => button.click());
    await settle();
  };
  const titles = () =>
    [...s.document.querySelectorAll(".xp-window .title-text")].map(
      (title) => title.textContent,
    );
  const lastDialog = () =>
    [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  await h.enter(`cd "${fs.getPath(sub.id)}"`);
  await h.enter("explorer .");
  expect(address()).toBe(fs.getPath(sub.id));
  await closeAll();
  await h.enter("explorer ..");
  expect(address()).toBe("My Documents");
  await closeAll();
  await h.enter("start explorer .\\..\\sub\\.");
  expect(address()).toBe(fs.getPath(sub.id));
  await closeAll();
  await h.enter("notepad ..\\a.txt");
  expect(titles()).toContain("a.txt - Notepad");
  await closeAll();
  // Paint gets the file: the empty file is no picture.
  await h.enter("mspaint ..\\p.bmp");
  expect(lastDialog().textContent).toContain("Paint cannot read this file.");
  await closeAll();
  await h.enter("notepad ..\\new");
  lastDialog().querySelector('[data-action="yes"]').click();
  await settle();
  expect(fs.resolvePath(`${docs}\\new.txt`) === null).toBeFalse();
  await closeAll();
  expect(h.output.textContent).not.toContain("not recognized");
  // Run starts in the profile folder.
  await runBox(s, ".");
  expect(address()).toBe(fs.getPath(fs.USER_PROFILE));
  await closeAll();
  await runBox(s, "..");
  expect(address()).toBe(fs.getPath(fs.getParent(fs.USER_PROFILE).id));
  await closeAll();
  await runBox(s, "explorer My Documents\\..\\My Documents\\sub");
  expect(address()).toBe(fs.getPath(sub.id));
});

const activeWindows = (s) =>
  [...s.document.querySelectorAll(".xp-window.active")].map(
    (win) => win.dataset.game,
  );
const keysWindow = (s) =>
  s.document.activeElement?.closest(".xp-window")?.dataset.game;

// In the XP VM, a program that cmd starts, with or without START, opens on
// top and takes the keys. The Command Prompt gets them back when it is
// the active window again.
test("a program that the Command Prompt starts opens on top, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  fs.createFile(fs.USER_PROFILE, "a.txt", { content: "hi" });
  for (const line of ["notepad a.txt", "start notepad"]) {
    await h.enter(line);
    expect([line, activeWindows(s)]).toEqual([line, ["__notepad"]]);
    expect([line, keysWindow(s)]).toEqual([line, "__notepad"]);
    s.document
      .querySelector('.xp-window[data-game="__notepad"] .close-btn')
      .click();
    await settle();
    expect(activeWindows(s)).toEqual(["__command-prompt"]);
    expect(s.document.activeElement).toBe(h.input);
  }
  // The Enter is cmd's: Notepad, which opens at once now that it is
  // loaded, gets no line break, so it has no change to save.
  h.input.value = "start notepad";
  const enter = new s.window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  h.input.dispatchEvent(enter);
  expect(enter.defaultPrevented).toBeTrue();
  await settle();
  expect(activeWindows(s)).toEqual(["__notepad"]);
  s.document
    .querySelector('.xp-window[data-game="__notepad"] .close-btn')
    .click();
  await settle();
  expect(s.document.querySelector(".xp-dialog")).toBeNull();
  // A click on the window gives the keys to the prompt a moment later.
  // A program that opens in that moment stays on top.
  h.win
    .querySelector(".title-text")
    .dispatchEvent(new s.window.PointerEvent("pointerdown", { bubbles: true }));
  fs.open(fs.resolvePath(`${fs.getPath(fs.USER_PROFILE)}\\a.txt`));
  await settle();
  expect(activeWindows(s)).toEqual(["__notepad"]);
  expect(keysWindow(s)).toBe("__notepad");
  s.document
    .querySelector('.xp-window[data-game="__notepad"] .close-btn')
    .click();
  await settle();
  await h.enter("start cmd");
  expect(activeWindows(s)).toEqual(["__command-prompt#2"]);
  expect(keysWindow(s)).toBe("__command-prompt#2");
});

// Like XP, a cmd from Task Manager's New Task opens on top and takes the
// keys, also when cmd is loaded and opens before the dialog closes. Task
// Manager gives its control the keys when it is the active window again.
test("New Task's cmd opens on top of Task Manager, like XP", async () => {
  const s = await login(await loadShell());
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Escape",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  const manager = s.document.querySelector(
    '.xp-window[data-game="__task-manager"]',
  );
  const newTask = manager.querySelector(".tm-new-task");
  for (const index of [0, 1]) {
    newTask.focus();
    newTask.click();
    await settle();
    const dialog = s.document.querySelector(".run-dialog");
    dialog.querySelector(".shell-dialog-input").value = "cmd";
    dialog.querySelector('[data-action="run"]').click();
    await settle();
    const prompt = promptWindows(s)[index];
    expect(activeWindows(s)).toEqual([prompt.dataset.game]);
    expect(s.document.activeElement).toBe(
      prompt.querySelector(".xp-terminal-prompt input"),
    );
    manager
      .querySelector(".title-text")
      .dispatchEvent(
        new s.window.PointerEvent("pointerdown", { bubbles: true }),
      );
    await settle();
    expect(activeWindows(s)).toEqual(["__task-manager"]);
    expect(s.document.activeElement).toBe(newTask);
  }
});

// In the XP VM: START /D starts in a folder, and a folder that is not
// there gives "The current directory is invalid.". /B runs in the same
// window, /I takes the first environment, /MIN and /MAX show the new
// window so, and /WAIT waits for the window to close. An unknown switch
// gives "Invalid switch".
test("START takes its switches, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const work = fs.createFolder(fs.USER_PROFILE, "my work");
  const workPath = fs.getPath(work.id);
  const profile = fs.getPath(fs.USER_PROFILE);
  const prompt = () =>
    h.win.querySelector(".xp-terminal-prompt span").textContent;
  await h.enter("cls");
  await h.enter("start /d nope cmd");
  await h.enter("start /foo notepad");
  expect(h.output.textContent).toBe(
    `\n${profile}>start /d nope cmd\nThe current directory is invalid.\n\n${profile}>start /foo notepad\nInvalid switch - "/foo".\n\n`,
  );
  expect(promptWindows(s)).toHaveLength(1);
  // /D: the new window starts in the folder, with the variables of this
  // cmd. With /I, it has the first variables.
  await h.enter("set NAME=one");
  await h.enter(`start /d "${workPath}" cmd`);
  const second = promptIn(s, promptWindows(s)[1]);
  expect(second.prompt()).toBe(`${workPath}>`);
  await second.enter("echo %NAME%");
  expect(second.text()).toContain("\none\n");
  await h.enter(`start /i /d"${workPath}" cmd`);
  const third = promptIn(s, promptWindows(s)[2]);
  expect(third.prompt()).toBe(`${workPath}>`);
  await third.enter("echo %NAME%");
  expect(third.text()).toContain("\n%NAME%\n");
  // /B: a new cmd runs in this window, and EXIT goes back.
  await h.enter("cls");
  await h.enter("start /b echo hi");
  expect(promptWindows(s)).toHaveLength(3);
  expect(h.output.textContent).toBe(`\n${profile}>start /b echo hi\nhi\n\n`);
  await h.enter("exit");
  expect(h.win.isConnected).toBeTrue();
  await h.enter(`start /b /d "${workPath}" cmd`);
  expect(promptWindows(s)).toHaveLength(3);
  expect(h.output.textContent).toContain("Microsoft Windows XP");
  expect(prompt()).toBe(`${workPath}>`);
  await h.enter("exit");
  expect(prompt()).toBe(`${profile}>`);
  // /MIN and /MAX.
  await h.enter("start /min cmd");
  expect(promptWindows(s)[3].style.display).toBe("none");
  await h.enter("start /max cmd");
  expect(promptWindows(s)[4].classList.contains("maximized")).toBeTrue();
  // /WAIT: the prompt comes back when the window closes.
  await h.enter("start /wait notepad");
  expect(activeWindows(s)).toEqual(["__notepad"]);
  expect(h.input.disabled).toBeTrue();
  s.document
    .querySelector('.xp-window[data-game="__notepad"] .close-btn')
    .click();
  await settle();
  expect(h.input.disabled).toBeFalse();
  expect(prompt()).toBe(`${profile}>`);
  // The switches of priority and memory change nothing here. START /B
  // with no command runs a new cmd in this window.
  await h.enter("cls");
  await h.enter("start /low /separate /b");
  expect(h.output.textContent).toContain(
    `${profile}>start /low /separate /b\nMicrosoft Windows XP`,
  );
  await h.enter("exit");
  expect(promptWindows(s)).toHaveLength(5);
  // /WAIT for a cmd that closes at once.
  await h.enter("start /wait cmd /c echo hi");
  expect(promptWindows(s)).toHaveLength(5);
  expect(h.input.disabled).toBeFalse();
  // /MAX keeps a maximized window maximized.
  await h.enter("start /max notepad");
  await h.enter("start /max notepad");
  expect(
    s.document
      .querySelector('.xp-window[data-game="__notepad"]')
      .classList.contains("maximized"),
  ).toBeTrue();
});

// In the XP VM, the title is "<title> - <command line>" while a command
// runs or asks, with the spaces as typed. A cmd in the window takes that
// title as its own, and EXIT gives back the title before it.
test("the window title shows the command line while it runs, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const foo = fs.createFolder(fs.USER_PROFILE, "foo");
  fs.createFile(foo.id, "a.txt");
  const title = () => h.win.querySelector(".title-text").textContent;
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 800 },
  );
  await h.enter("title Build");
  expect(title()).toBe("Build");
  await h.enter("del   foo");
  expect(title()).toBe("Build - del   foo");
  // The task bar and Alt+Tab show the same title.
  await runBox(s, "notepad");
  expect(activeWindows(s)).toEqual(["__notepad"]);
  expect(
    s.document.querySelector('.task-button[data-game="__command-prompt"]')
      .title,
  ).toBe("Build - del   foo");
  s.document.activeElement.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Tab",
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(s.document.getElementById("window-switcher").textContent).toBe(
    "Build - del   foo",
  );
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keyup", { key: "Alt", bubbles: true }),
  );
  await settle();
  expect(activeWindows(s)).toEqual(["__command-prompt"]);
  // The answer is no command line.
  await h.enter("n");
  expect(title()).toBe("Build");
  await h.enter("cmd");
  expect(title()).toBe("Build - cmd");
  await h.enter("del foo");
  expect(title()).toBe("Build - cmd - del foo");
  await h.enter("n");
  expect(title()).toBe("Build - cmd");
  await h.enter("title Inner");
  expect(title()).toBe("Inner");
  await h.enter("exit");
  expect(title()).toBe("Build");
});

const openTaskManager = async (s) => {
  s.document
    .getElementById("taskbar")
    .dispatchEvent(
      new s.window.MouseEvent("contextmenu", { bubbles: true, clientY: 700 }),
    );
  s.document.querySelector('[data-taskbar-action="task-manager"]').click();
  await settle();
  return s.document.querySelector('.xp-window[data-game="__task-manager"]');
};

// In the XP VM, each cmd is a cmd.exe process, also a cmd in a cmd, and
// each Command Prompt window is an application with the cmd icon.
test("Task Manager shows each cmd of each Command Prompt, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  await runBox(s, "cmd");
  const second = promptIn(s, promptWindows(s)[1]);
  await second.enter("title Second");
  await h.enter("cmd");
  const tm = await openTaskManager(s);
  const command = async (name) => {
    tm.querySelector(`[data-tm-command="${name}"]`).click();
    await settle();
  };
  const refresh = async () => {
    tm.querySelector('[data-tm-menu="view"]').click();
    await command("refresh");
  };
  const tasks = () =>
    [...tm.querySelectorAll(".tm-tasks .tm-row")].filter((row) =>
      /cmd|Second/.test(row.textContent),
    );
  const cmdProcesses = () =>
    [...tm.querySelectorAll(".tm-processes .tm-row")].filter(
      (row) => row.firstElementChild.textContent === "cmd.exe",
    );
  const icon = h.win.querySelector(".title-icon img").getAttribute("src");
  tm.querySelector('[data-tm-tab="applications"]').click();
  expect(tasks().map((row) => row.firstElementChild.textContent)).toEqual([
    "C:\\WINDOWS\\system32\\cmd.exe - cmd",
    "Second",
  ]);
  expect(
    tasks().map((row) => row.querySelector("img").getAttribute("src")),
  ).toEqual([icon, icon]);
  tm.querySelector('[data-tm-tab="processes"]').click();
  await refresh();
  expect(cmdProcesses()).toHaveLength(3);
  // End Process on the cmd in the cmd gives the window to the first cmd.
  // The list has the newest process first: the second window, then the
  // cmd in the first window, then the first cmd. An idle cmd that ends
  // leaves a blank line.
  const before = h.output.textContent;
  cmdProcesses()[1].click();
  await command("end-process");
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector('[data-action="yes"]')
    .click();
  await settle();
  await refresh();
  expect(cmdProcesses()).toHaveLength(2);
  expect(h.output.textContent).toBe(`${before}\n`);
  expect(h.win.isConnected).toBeTrue();
  expect(h.win.querySelector(".title-text").textContent).toBe(
    "C:\\WINDOWS\\system32\\cmd.exe",
  );
  // End Task closes only the window that is selected.
  tm.querySelector('[data-tm-tab="applications"]').click();
  tasks()[1].click();
  await command("end-task");
  expect(second.win.isConnected).toBeFalse();
  expect(h.win.isConnected).toBeTrue();
  tm.querySelector('[data-tm-tab="processes"]').click();
  await refresh();
  expect(cmdProcesses()).toHaveLength(1);
  // A cmd that waits for a window ends at once, and the cmd under it
  // shows its prompt. The window that it waited for stays open.
  const notepad = () =>
    s.document.querySelector('.xp-window[data-game="__notepad"]');
  const prompt = () =>
    h.win.querySelector(".xp-terminal-prompt span").textContent;
  const profilePrompt = prompt();
  await h.enter("cmd");
  await h.enter("cls");
  await h.enter("start /wait notepad");
  expect(h.input.disabled).toBeTrue();
  await refresh();
  cmdProcesses()[0].click();
  await command("end-process");
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector('[data-action="yes"]')
    .click();
  await settle();
  expect(h.input.disabled).toBeFalse();
  expect(prompt()).toBe(profilePrompt);
  expect(h.win.querySelector(".title-text").textContent).toBe(
    "C:\\WINDOWS\\system32\\cmd.exe",
  );
  const shown = h.output.textContent;
  expect(shown).toBe(`\n${profilePrompt}start /wait notepad\n\n`);
  expect(h.input.value).toBe("");
  expect(notepad()).not.toBeNull();
  notepad().querySelector(".close-btn").click();
  await settle();
  expect(h.output.textContent).toBe(shown);
  expect(h.input.disabled).toBeFalse();
  // A window that closes while it waits stops its command line. The line
  // does not close a new window that has the same place.
  h.win.querySelector(".close-btn").click();
  await settle();
  await runBox(s, "cmd /c start /wait notepad");
  const waiting = promptWindows(s)[0];
  const game = waiting.dataset.game;
  waiting.querySelector(".close-btn").click();
  await settle();
  await runBox(s, "cmd");
  const next = promptWindows(s)[0];
  expect(next.dataset.game).toBe(game);
  notepad().querySelector(".close-btn").click();
  await settle();
  expect(notepad()).toBeNull();
  expect(next.isConnected).toBeTrue();
  // End Process on the first cmd of a window closes the window.
  await refresh();
  expect(cmdProcesses()).toHaveLength(1);
  cmdProcesses()[0].click();
  await command("end-process");
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector('[data-action="yes"]')
    .click();
  await settle();
  expect(next.isConnected).toBeFalse();
  expect(promptWindows(s)).toHaveLength(0);
});

// Log Off closes each Command Prompt, also one with a cmd in it and one
// with an open question. Each cmd frees its folder.
test("Log Off closes each Command Prompt and frees its folders", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const a = fs.createFolder(fs.USER_PROFILE, "a");
  const b = fs.createFolder(a.id, "b");
  const c = fs.createFolder(fs.USER_PROFILE, "c");
  fs.createFile(c.id, "x.txt");
  await h.enter("cd a");
  await h.enter("cmd");
  await h.enter("cd b");
  await runBox(s, "cmd");
  const second = promptIn(s, promptWindows(s)[1]);
  await second.enter("cd c");
  await second.enter("del .");
  expect(second.prompt()).toContain("Are you sure (Y/N)?");
  for (const folder of [a, b, c])
    expect(() => fs.checkChange("delete", folder.id)).toThrow();
  s.document.getElementById("start-button").click();
  s.document.getElementById("log-off-button").click();
  s.document.getElementById("logoff-confirm").click();
  await settle();
  expect(s.document.getElementById("welcome-screen").hidden).toBeFalse();
  expect(promptWindows(s)).toHaveLength(0);
  for (const folder of [a, b, c])
    expect(() => fs.checkChange("delete", folder.id)).not.toThrow();
  expect(fs.getChildren(c.id)).toHaveLength(1);
});

// In the XP VM, a crowded task bar puts the Command Prompt windows on one
// button: "3 Windows Command Processor", with the cmd icon, and the menu
// of a group.
test("a crowded taskbar groups the Command Prompt windows, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  await runBox(s, "cmd");
  await runBox(s, "cmd");
  Object.defineProperties(s.document.getElementById("desktop"), {
    clientWidth: { configurable: true, value: 1024 },
    clientHeight: { configurable: true, value: 738 },
  });
  const container = s.document.getElementById("task-buttons");
  Object.defineProperty(container, "clientWidth", { value: 240 });
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  const group = () => container.querySelector(".task-button-grouped");
  expect(group().textContent).toBe("3 Windows Command Processor");
  expect(group().querySelector("img").getAttribute("src")).toBe(
    h.win.querySelector(".title-icon img").getAttribute("src"),
  );
  group().click();
  const menu = s.document.getElementById("taskbar-overflow-menu");
  expect(
    [...menu.querySelectorAll("button")].map((item) => item.textContent),
  ).toEqual(Array(3).fill("C:\\WINDOWS\\system32\\cmd.exe"));
  const choose = async (label) => {
    group().dispatchEvent(
      new s.window.MouseEvent("contextmenu", { bubbles: true }),
    );
    [...menu.querySelectorAll("button")]
      .find((item) => item.textContent === label)
      .click();
    await settle();
  };
  await choose("Tile Vertically");
  expect(new Set(promptWindows(s).map((win) => win.style.left)).size).toBe(3);
  await choose("Minimize Group");
  expect(
    promptWindows(s).every((win) => win.style.display === "none"),
  ).toBeTrue();
  await choose("Close Group");
  expect(promptWindows(s)).toHaveLength(0);
});

// In the XP VM, each new Command Prompt window is 26 pixels down and to
// the right of the one before it, from the place of the first one, and
// the cascade starts again at the top when a window does not fit. All the
// windows of the program keep one saved place.
test("Command Prompt windows cascade from the saved place and wrap, like XP", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        windowPlacements: JSON.stringify({
          "__command-prompt": { left: 100, top: 50, width: 500, height: 300 },
          "__command-prompt#2": { left: 600, top: 400, width: 200, height: 99 },
        }),
      },
    }),
  );
  Object.defineProperties(s.document.getElementById("desktop"), {
    clientWidth: { configurable: true, value: 1024 },
    clientHeight: { configurable: true, value: 738 },
  });
  const places = () =>
    promptWindows(s).map((win) => [
      parseFloat(win.style.left),
      parseFloat(win.style.top),
      parseFloat(win.style.width),
    ]);
  for (let index = 0; index < 20; index++) await runBox(s, "cmd");
  const opened = places();
  expect(opened.slice(0, 3)).toEqual([
    [100, 50, 500],
    [126, 76, 500],
    [152, 102, 500],
  ]);
  const wrap = opened.findIndex(
    ([left, top], index) => index > 0 && left === 100 && top === 50,
  );
  // The 15th window ends at 50 + 26 * 14 + 300 = 714 pixels, in the 738
  // pixels of the desktop. The 16th one would end at 740, so it wraps.
  expect(wrap).toBe(15);
  opened.forEach(([left, top], index) =>
    expect([left, top]).toEqual([
      100 + 26 * (index % wrap),
      50 + 26 * (index % wrap),
    ]),
  );
  const saved = () =>
    JSON.parse(s.window.localStorage.getItem("windowPlacements"));
  // A cascaded copy that maximizes or closes keeps no place. The first one
  // keeps the place of the program, and the old place of a window number
  // goes.
  promptWindows(s)[1].querySelector(".maximize-btn").click();
  await settle();
  expect(promptWindows(s)[1].classList.contains("maximized")).toBeTrue();
  expect(saved()["__command-prompt"].left).toBe(100);
  promptWindows(s)[1].querySelector(".close-btn").click();
  await settle();
  expect(saved()["__command-prompt"].left).toBe(100);
  promptWindows(s)[0].querySelector(".close-btn").click();
  await settle();
  expect(Object.keys(saved()).filter((key) => key.includes("#"))).toEqual([]);
  expect(saved()["__command-prompt"]).toEqual({
    left: 100,
    top: 50,
    width: 500,
    height: 300,
  });
});

const windowOf = (s, game) =>
  s.document.querySelector(`.xp-window[data-game="${game}"]`);
const answerDialog = async (s, action) => {
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector(`[data-action="${action}"]`)
    .click();
  await settle();
};
const closeWindow = async (s, game) => {
  windowOf(s, game).querySelector(".close-btn").click();
  await settle();
};

// In the XP VM, notepad.exe asks its question for a new file in its own
// process: START /WAIT waits until that Notepad closes, and /MAX shows it
// maximized after the answer.
test("START /WAIT and /MAX act on the Notepad that opens after its question, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  const maximized = () =>
    windowOf(s, "__notepad").classList.contains("maximized");
  await h.enter("start /wait notepad nope.txt");
  expect(s.document.querySelector(".xp-dialog").textContent).toContain(
    "Cannot find the nope.txt file.",
  );
  expect(h.input.disabled).toBeTrue();
  await answerDialog(s, "yes");
  expect(fs.findChild(fs.USER_PROFILE, "nope.txt")).toBeTruthy();
  expect(windowOf(s, "__notepad")).not.toBeNull();
  expect(h.input.disabled).toBeTrue();
  await closeWindow(s, "__notepad");
  expect(h.input.disabled).toBeFalse();
  await h.enter("start /max notepad other.txt");
  await answerDialog(s, "yes");
  expect(maximized()).toBeTrue();
  await closeWindow(s, "__notepad");
  await h.enter("start /max notepad third.txt");
  await answerDialog(s, "no");
  expect(maximized()).toBeTrue();
  await closeWindow(s, "__notepad");
  // Cancel opens no Notepad, so /WAIT has nothing to wait for.
  await h.enter("start /wait notepad fourth.txt");
  await answerDialog(s, "cancel");
  expect(windowOf(s, "__notepad")).toBeNull();
  expect(h.input.disabled).toBeFalse();
});

// In the XP VM, START opens a document with ShellExecuteEx: /WAIT waits
// for the Notepad that opens it, and /MIN shows that Notepad minimized. A
// folder, and explorer.exe, go to the Explorer that runs, so START does
// not wait for them.
test("START /WAIT and /MIN act on the program of a document, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const fs = s.window.VirtualFS;
  fs.createFile(fs.USER_PROFILE, "a.txt", { content: "hi" });
  await h.enter("start /wait a.txt");
  expect(windowOf(s, "__notepad").querySelector("textarea").value).toBe("hi");
  expect(h.input.disabled).toBeTrue();
  await closeWindow(s, "__notepad");
  expect(h.input.disabled).toBeFalse();
  await h.enter("start /min a.txt");
  expect(windowOf(s, "__notepad").style.display).toBe("none");
  await closeWindow(s, "__notepad");
  await h.enter("start /wait C:\\");
  expect(windowOf(s, "__my-documents")).not.toBeNull();
  expect(h.input.disabled).toBeFalse();
  await closeWindow(s, "__my-documents");
  await h.enter("start /wait explorer");
  expect(windowOf(s, "__my-documents")).not.toBeNull();
  expect(h.input.disabled).toBeFalse();
});

// In the XP VM, taskmgr.exe and explorer.exe give the work to the copy
// that runs, and START returns at once. The open window keeps its state.
// calc.exe starts a second copy in XP. Here Calculator has one window,
// so START brings it to the top like Run does, and does not wait for it
// or change it: it is not the window of the new process.
test("START does not wait for or change a window that was open before, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const state = (game) => {
    const win = windowOf(s, game);
    return [win.style.display === "none", win.classList.contains("maximized")];
  };
  // With no Task Manager open, taskmgr is a new process to wait for.
  await h.enter("start /wait taskmgr");
  expect(windowOf(s, "__task-manager")).not.toBeNull();
  expect(h.input.disabled).toBeTrue();
  await closeWindow(s, "__task-manager");
  expect(h.input.disabled).toBeFalse();
  for (const [program, game] of [
    ["taskmgr", "__task-manager"],
    ["calc", "__calculator"],
    ["explorer", "__my-documents"],
  ]) {
    await h.enter(`start ${program}`);
    expect(state(game)).toEqual([false, false]);
    await h.enter(`start /wait ${program}`);
    expect(h.input.disabled).toBeFalse();
    await h.enter(`start /min ${program}`);
    await h.enter(`start /max ${program}`);
    expect(state(game)).toEqual([false, false]);
    expect(h.input.disabled).toBeFalse();
  }
});

// In the XP VM, START /MAX maximizes winmine.exe and mshearts.exe, which
// have no Maximize box, but calc.exe opens at its own size. The title bar
// and the system menu do not maximize Calculator, and its Size and
// Maximize commands are off. Task Manager's Maximize maximizes it, and
// then it can restore.
test("a window with no Maximize box maximizes only like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const maximized = (game) => windowOf(s, game).classList.contains("maximized");
  await h.enter("start /max winmine");
  expect(maximized("__minesweeper")).toBeTrue();
  await h.enter("start /max calc");
  const calc = windowOf(s, "__calculator");
  expect(maximized("__calculator")).toBeFalse();
  const button = calc.querySelector(".maximize-btn");
  expect(button.disabled).toBeTrue();
  expect(button.getAttribute("aria-disabled")).toBe("true");
  calc
    .querySelector(".title-bar")
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  await settle();
  expect(maximized("__calculator")).toBeFalse();
  calc.querySelector(".title-bar").dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  const menu = s.document.getElementById("window-system-menu");
  const enabled = () =>
    [...menu.querySelectorAll("[data-command]")]
      .filter((item) => !item.disabled)
      .map((item) => item.dataset.command);
  expect(enabled()).toEqual(["move", "minimize", "close"]);
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await settle();
  // A window that can maximize has all of them.
  const prompt = h.win;
  prompt.querySelector(".title-bar").dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(enabled()).toEqual(["move", "size", "minimize", "maximize", "close"]);
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await settle();
  // Task Manager's Maximize.
  const tm = await openTaskManager(s);
  tm.querySelector('[data-tm-tab="applications"]').click();
  [...tm.querySelectorAll(".tm-tasks .tm-row")]
    .find((row) => row.textContent.includes("Calculator"))
    .click();
  tm.querySelector('[data-tm-menu="windows"]').click();
  tm.querySelector('[data-tm-command="maximize"]').click();
  await settle();
  expect(maximized("__calculator")).toBeTrue();
  expect(button.disabled).toBeFalse();
  expect(button.hasAttribute("aria-disabled")).toBeFalse();
  button.click();
  await settle();
  expect(maximized("__calculator")).toBeFalse();
  expect(button.disabled).toBeTrue();
});

// In the XP VM, START /I gives the new cmd the variables that this cmd
// had when it started, not the ones that SET gave it later.
test("START /I gives the first variables of this cmd, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  await h.enter("set FOO=1");
  await h.enter("start cmd");
  const second = promptIn(s, promptWindows(s)[1]);
  await second.enter("set BAR=2");
  await second.enter("start /i cmd");
  const third = promptIn(s, promptWindows(s)[2]);
  await third.enter("echo %FOO% %BAR%");
  expect(third.text()).toContain("\n1 %BAR%\n");
  // START /B /I starts the cmd in this window, with the same variables.
  await second.enter("start /b /i cmd");
  await second.enter("echo %FOO% %BAR%");
  expect(second.text()).toContain("\n1 %BAR%\n");
});

// Task Manager's list of a Command Prompt, paused so that it keeps the
// processes that it showed.
const pausedTaskManager = async (s) => {
  const tm = await openTaskManager(s);
  const command = async (name) => {
    tm.querySelector(`[data-tm-command="${name}"]`).click();
    await settle();
  };
  const viewCommand = async (name) => {
    tm.querySelector('[data-tm-menu="view"]').click();
    await command(name);
  };
  tm.querySelector('[data-tm-tab="processes"]').click();
  await viewCommand("speed-paused");
  const cmdRows = () =>
    [...tm.querySelectorAll(".tm-processes .tm-row")].filter(
      (row) => row.firstElementChild.textContent === "cmd.exe",
    );
  return {
    cmdRows,
    refresh: () => viewCommand("refresh"),
    // End Process on a row, with Yes to the warning.
    end: async (row) => {
      row.click();
      await command("end-process");
      await answerDialog(s, "yes");
    },
  };
};

// In the XP VM, End Process on a process that ended after a paused list
// showed it gives XP's error, and the list stays as it is. The cmd that
// has the same place now does not end.
test("End Process on a cmd that ended before does nothing, like XP", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  const tm = await pausedTaskManager(s);
  await h.enter("cmd");
  await tm.refresh();
  // The newest process first: the cmd in the cmd, then the first cmd.
  const [inner] = tm.cmdRows();
  await h.enter("exit");
  await h.enter("cls");
  await h.enter("start /wait notepad");
  expect(h.input.disabled).toBeTrue();
  await tm.end(inner);
  const error = [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  expect(error.textContent).toContain("Unable to Terminate Process");
  expect(error.textContent).toContain("The operation could not be completed.");
  expect(error.textContent).toContain(
    "The operation is not valid for this process.",
  );
  await answerDialog(s, "ok");
  expect(inner.isConnected).toBeTrue();
  expect(h.input.disabled).toBeTrue();
  expect(h.output.textContent).toBe("\n");
  await closeWindow(s, "__notepad");
  expect(h.input.disabled).toBeFalse();
  // A new cmd in the window is a new process: the old row does not end it.
  await h.enter("cmd");
  await tm.end(inner);
  await answerDialog(s, "ok");
  await h.enter("title Inner");
  expect(h.win.querySelector(".title-text").textContent).toBe("Inner");
  // A closed window is gone too, also when a new one has its place.
  await tm.refresh();
  const [newest] = tm.cmdRows();
  await closeWindow(s, "__command-prompt");
  await runBox(s, "cmd");
  await tm.end(newest);
  expect(
    [...s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
  ).toContain("The operation is not valid for this process.");
  await answerDialog(s, "ok");
  expect(promptWindows(s)).toHaveLength(1);
});

// In the XP VM, End Process on a cmd at the pause of DIR /P stops the
// listing, and the cmd under it shows its prompt. Pasted lines that are
// left run at once in the cmd under it.
test("End Process stops a pause and gives the pasted lines to the cmd under it", async () => {
  const h = await openCommandPrompt();
  const { s } = h;
  manyFiles(h, 30);
  const tm = await pausedTaskManager(s);
  const prompt = () =>
    h.win.querySelector(".xp-terminal-prompt span").textContent;
  const profilePrompt = prompt();
  await h.enter("cd Many");
  await h.enter("cmd");
  await tm.refresh();
  await h.enter("cls");
  await h.enter("dir /p");
  expect(h.output.textContent.endsWith(PAUSE)).toBeTrue();
  await tm.end(tm.cmdRows()[0]);
  expect(h.output.textContent.endsWith(`${PAUSE}\n`)).toBeTrue();
  expect(h.input.disabled).toBeFalse();
  expect(prompt()).toBe(`${profilePrompt.slice(0, -1)}\\Many>`);
  // A key after it is a key at the prompt, not at the pause.
  await h.press("x");
  expect(h.output.textContent.endsWith(`${PAUSE}\n`)).toBeTrue();
  await h.enter("echo next");
  expect(h.output.textContent.endsWith("echo next\nnext\n\n")).toBeTrue();
  // The pasted lines after START /WAIT run in the first cmd at once.
  await h.enter("cmd");
  await tm.refresh();
  await h.enter("cls");
  paste(h, "start /wait notepad\necho one\necho two\n");
  await settle();
  expect(h.input.disabled).toBeTrue();
  await tm.end(tm.cmdRows()[0]);
  await settle();
  const many = prompt();
  expect(h.output.textContent).toBe(
    `\n${many}start /wait notepad\n\n${many}echo one\none\n\n${many}echo two\ntwo\n\n`,
  );
  expect(h.input.disabled).toBeFalse();
  await closeWindow(s, "__notepad");
  expect(h.output.textContent.endsWith("two\n\n")).toBeTrue();
});
