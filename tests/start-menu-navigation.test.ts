// @ts-nocheck -- Navigate the real shell menus using Happy DOM events.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  clickStartAction,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
afterEach(cleanupShells);
const key = (s, el, value, extra = {}) =>
  el.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...extra,
    }),
  );
const hover = (s, el, type = "pointerenter") =>
  el.dispatchEvent(new s.window.PointerEvent(type));
const panels = (s) => [...s.document.querySelectorAll(".start-program-flyout")];
test("All Programs hover opens after its delay, nested keyboard menus launch Explorer, and leaving closes them", async () => {
  const s = await login(await loadShell());
  s.document.getElementById("start-button").click();
  const all = s.document.getElementById("all-programs-button");
  hover(s, all);
  await s.advanceTime(219);
  expect(panels(s).length).toBe(0);
  await s.advanceTime(1);
  expect(panels(s).length).toBe(1);
  const accessories = panels(s)[0].querySelector(
    '[data-program-id="accessories"]',
  );
  hover(s, accessories);
  await s.advanceTime(220);
  expect(panels(s).length).toBe(2);
  const entertainment = panels(s)[1].querySelector(
    '[data-program-id="entertainment"]',
  );
  key(s, entertainment, "ArrowRight");
  expect(panels(s).length).toBe(3);
  expect(s.document.activeElement.dataset.programId).toBe("volume-control");
  key(s, entertainment, "Enter");
  panels(s)[1].querySelector('[data-program-id="windows-explorer"]').click();
  expect(panels(s).length).toBe(0);
  expect(
    s.document.querySelector('.xp-window[data-game="__my-documents"]') !== null,
  ).toBeTrue();
  s.document.getElementById("start-button").click();
  key(s, all, "ArrowDown");
  expect(panels(s).length).toBe(1);
  hover(s, panels(s)[0], "pointerleave");
  await s.advanceTime(419);
  expect(panels(s).length).toBe(1);
  hover(s, panels(s)[0]);
  await s.advanceTime(1);
  expect(panels(s).length).toBe(1);
  hover(s, panels(s)[0], "pointerleave");
  await s.advanceTime(420);
  expect(panels(s).length).toBe(0);
});
test.each(["click", "hover", "keyboard"])(
  "classic Start folders support %s navigation and document access keys",
  async (method) => {
    const s = await login(
      await loadShell({ initialStorage: { startMenuStyle: "classic" } }),
    );
    s.document.getElementById("start-button").click();
    const places = s.document.getElementById("start-menu-places");
    const documents = places.querySelector('[data-access-key="d"]');
    if (method === "click") documents.click();
    else if (method === "keyboard") key(s, documents, "ArrowRight");
    else {
      hover(s, documents);
      await s.advanceTime(220);
    }
    expect(panels(s).length).toBe(1);
    expect(panels(s)[0].textContent).toContain("My Pictures");
    panels(s)[0].querySelector("button").focus();
    // AltGr sends Ctrl and Alt, and types a character. Like XP, it
    // chooses no item.
    key(s, panels(s)[0], "π", { ctrlKey: true, altKey: true, code: "KeyP" });
    expect(panels(s).length).toBe(1);
    key(s, panels(s)[0], "p");
    expect(
      s.document.querySelector('.xp-window[data-game="__my-pictures"]') !==
        null,
    ).toBeTrue();
    expect(s.document.getElementById("start-menu").hidden).toBeTrue();
    s.document.getElementById("start-button").click();
    key(s, places, "r", { ctrlKey: true });
    expect(s.document.querySelector(".run-dialog") === null).toBeTrue();
    key(s, places, "r");
    expect(s.document.activeElement.dataset.startAction).toBe("run");
    s.document.activeElement.click();
    expect(s.document.querySelector(".run-dialog") !== null).toBeTrue();
  },
);
test("recent documents has an empty state and Internet Games can be launched from All Programs", async () => {
  const s = await login(await loadShell());
  clickStartAction(s, "recent");
  const empty = panels(s)[0].querySelector(".start-program-empty");
  expect(empty.textContent).toBe("(Empty)");
  expect(empty.disabled).toBeTrue();
  s.document.getElementById("start-button").click();
  s.document.getElementById("start-button").click();
  const all = s.document.getElementById("all-programs-button");
  all.click();
  all.click();
  expect(panels(s).length).toBe(0);
  key(s, all, "ArrowRight");
  panels(s)[0].querySelector('[data-program-id="internet-games"]').click();
  await flushShell();
  expect(
    s.document.querySelector('.xp-window[data-game="__internet-games"]') !==
      null,
  ).toBeTrue();
});
test("Run Browse uses the selected file path and cancel preserves the command", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const file = fs.createFile(fs.MY_DOCUMENTS, "Browse.txt", {
    content: "selected through Browse",
  });
  clickStartAction(s, "run");
  const run = s.document.querySelector(".run-dialog"),
    input = run.querySelector(".run-command");
  input.value = "keep this command";
  run.querySelector('[data-action="browse"]').click();
  await flushShell();
  const dialog = [...s.document.querySelectorAll(".xp-dialog")].find(
    (el) => el !== run,
  );
  dialog.querySelector('[data-action="cancel"]').click();
  await flushShell();
  expect(input.value).toBe("keep this command");
  expect(s.document.activeElement === input).toBeTrue();
  run.querySelector('[data-action="browse"]').click();
  await flushShell();
  s.document.getElementById("dlg-file-name").value = "Browse.txt";
  const browse = [...s.document.querySelectorAll(".xp-dialog")].find(
    (el) => el !== run,
  );
  browse.querySelector('[data-action="accept"]').click();
  await flushShell();
  // Like XP, Browse puts quotes around a path with a space, and Run opens
  // the quoted path.
  expect(fs.getPath(file.id)).toContain(" ");
  expect(input.value).toBe(`"${fs.getPath(file.id)}"`);
  run.querySelector('[data-action="run"]').click();
  await flushShell();
  expect(s.document.querySelector(".notepad-editor").value).toBe(
    "selected through Browse",
  );
});
