// @ts-nocheck -- The Command Prompt window driven through the real shell.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

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
