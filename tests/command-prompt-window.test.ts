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
  expect(h.output.textContent).toBe("");
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
