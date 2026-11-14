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
  await h.enter("dir /p /b f0*");
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
