// @ts-nocheck -- Browser-level Minesweeper actions use Happy DOM.
import { afterEach, expect, test } from "bun:test";
import {
  createMinefield,
  MINESWEEPER_LEVELS,
} from "../site/apps/minesweeper/game.js";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
} from "./helpers/shell-harness";
import { checkMenuBar } from "./helpers/menu-bar";
afterEach(cleanupShells);
async function setup(initialStorage = {}) {
  const s = await login(await loadShell({ initialStorage }));
  s.window.history.replaceState(null, "", "#minesweeper");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await flushShell();
  const win = s.document.querySelector('.xp-window[data-game="__minesweeper"]'),
    root = win.querySelector(".xp-minesweeper");
  const cells = () => [...win.querySelectorAll('[role="gridcell"]')],
    command = (id) => win.querySelector(`[data-command="${id}"]`).click(),
    mark = (cell) =>
      cell.dispatchEvent(
        new s.window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        }),
      );
  return { s, win, root, cells, command, mark };
}
test("Minesweeper cycles marks, preferences, custom bounds, help and restart", async () => {
  const h = await setup(),
    cell = h.cells()[0];
  h.mark(cell);
  expect(cell.dataset.mark).toBe("flag");
  h.mark(cell);
  expect(cell.dataset.mark).toBe("question");
  h.command("marks");
  expect(cell.dataset.mark).toBe("");
  h.mark(cell);
  h.mark(cell);
  expect(cell.dataset.mark).toBe("");
  h.command("color");
  expect(h.root.classList.contains("monochrome")).toBeTrue();
  h.command("sound");
  h.command("custom");
  const dialog = h.s.document.querySelector(".minesweeper-custom-dialog");
  for (const [name, value] of [
    ["rows", 1000],
    ["columns", 10.5],
    ["mines", 1000],
  ])
    dialog.querySelector(`[name="${name}"]`).value = String(value);
  dialog.querySelector('[data-action="ok"]').click();
  const settings = JSON.parse(
    h.s.window.localStorage.getItem("minesweeperSettings"),
  );
  expect(settings.customLevel).toEqual({ rows: 24, columns: 10, mines: 231 });
  expect(h.cells().length).toBe(240);
  h.command("beginner");
  expect(h.cells().length).toBe(81);
  for (const command of [
    "best-times",
    "about",
    "contents",
    "search-help",
    "using-help",
  ]) {
    h.command(command);
    expect(!!h.s.document.querySelector(".xp-dialog")).toBeTrue();
    h.s.document.querySelector('.xp-dialog [data-action="ok"]').click();
  }
  h.root.dispatchEvent(
    new h.s.window.KeyboardEvent("keydown", { key: "F1", bubbles: true }),
  );
  h.s.document.querySelector('.xp-dialog [data-action="ok"]').click();
  h.root.dispatchEvent(
    new h.s.window.KeyboardEvent("keydown", { key: "F2", bubbles: true }),
  );
  expect(h.cells().every((c) => c.dataset.tile === "covered")).toBeTrue();
  h.win.querySelector(".minesweeper-menu-trigger").click();
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(h.win.querySelector(".minesweeper-popup").hidden).toBeTrue();
  h.command("exit");
  expect(h.win.isConnected).toBeFalse();
});
test("Minesweeper wins a deterministic field, reveals a loss, and resets its timer", async () => {
  const h = await setup({
    minesweeperSettings: JSON.stringify({ sound: false }),
  });
  const random = Math.random;
  let mines;
  try {
    Math.random = () => 0.5;
    mines = createMinefield(MINESWEEPER_LEVELS.beginner, 40);
    h.cells()[40].click();
  } finally {
    Math.random = random;
  }
  const cells = h.cells();
  expect(cells[40].dataset.open).toBe("true");
  await h.s.advanceTime(1000);
  expect(h.win.querySelector('[aria-label="Elapsed time"]').dataset.value).toBe(
    "1",
  );
  for (const index of mines) h.mark(cells[index]);
  const numbered = cells.find((c) => c.dataset.tile?.startsWith("number-"));
  numbered?.dispatchEvent(
    new h.s.window.MouseEvent("dblclick", { bubbles: true }),
  );
  cells.forEach((cell, index) => {
    if (!mines.has(index)) cell.click();
  });
  expect(h.win.querySelector(".minesweeper-face").dataset.face).toBe("won");
  expect(
    h.win.querySelector('[aria-label="Mines remaining"]').dataset.value,
  ).toBe("0");
  h.win.querySelector(".minesweeper-face").click();
  try {
    Math.random = () => 0.5;
    h.cells()[40].click();
  } finally {
    Math.random = random;
  }
  const target = h.cells()[[...mines][0]];
  target.dispatchEvent(
    new h.s.window.MouseEvent("mousedown", { button: 0, bubbles: true }),
  );
  target.dispatchEvent(new h.s.window.MouseEvent("mouseup", { bubbles: true }));
  target.click();
  expect(target.dataset.tile).toBe("exploded");
  expect(h.win.querySelector(".minesweeper-face").dataset.face).toBe("lost");
  h.cells()[0].click();
  h.mark(h.cells()[0]);
  h.command("new");
  expect(h.win.querySelector('[aria-label="Elapsed time"]').dataset.value).toBe(
    "0",
  );
});

test("Minesweeper wins without flags, marks wrong flags on loss, and plays sounds", async () => {
  const h = await setup();
  h.s.window.Audio.prototype.play = () => Promise.reject(new Error("muted"));
  const random = Math.random;
  const firstClick = () => {
    Math.random = () => 0.5;
    try {
      h.cells()[40].click();
    } finally {
      Math.random = random;
    }
  };
  Math.random = () => 0.5;
  const mines = createMinefield(MINESWEEPER_LEVELS.beginner, 40);
  Math.random = random;
  firstClick();
  h.cells().forEach((cell, index) => {
    if (!mines.has(index)) cell.click();
  });
  expect(h.win.querySelector(".minesweeper-face").dataset.face).toBe("won");
  expect(h.cells()[[...mines][0]].dataset.mark).toBe("flag");

  h.command("new");
  firstClick();
  const safe = h
    .cells()
    .findIndex(
      (cell, index) => !mines.has(index) && cell.dataset.open !== "true",
    );
  h.mark(h.cells()[safe]);
  h.cells()[[...mines][0]].click();
  expect(h.cells()[safe].dataset.tile).toBe("wrong");
});

test("Minesweeper shows negative mine counts and ignores unrelated input", async () => {
  const h = await setup({ minesweeperSettings: "{broken" });
  h.cells()
    .slice(0, 11)
    .forEach((cell) => h.mark(cell));
  expect(
    h.win.querySelector('[aria-label="Mines remaining"]').dataset.value,
  ).toBe("-1");
  h.cells()[20].dispatchEvent(
    new h.s.window.MouseEvent("dblclick", { bubbles: true }),
  );
  h.cells()[20].dispatchEvent(
    new h.s.window.MouseEvent("mousedown", { button: 2, bubbles: true }),
  );
  const popup = h.win.querySelector(".minesweeper-popup");
  popup.dispatchEvent(new h.s.window.MouseEvent("click", { bubbles: true }));
  const [game, help] = h.win.querySelectorAll(".minesweeper-menu-trigger");
  game.click();
  help.click();
  expect(popup.hidden).toBeTrue();
  help.nextElementSibling.dispatchEvent(
    new h.s.window.MouseEvent("click", { bubbles: true }),
  );
  h.root.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  h.root.dispatchEvent(
    new h.s.window.KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  h.command("marks");
  h.command("marks");
  h.command("custom");
  h.s.document
    .querySelector('.minesweeper-custom-dialog [data-action="cancel"]')
    .click();
  expect(h.cells()).toHaveLength(81);
});

test("Minesweeper restores a custom field, chords only with matching flags, and stops its timer once detached", async () => {
  const h = await setup({
    minesweeperSettings: JSON.stringify({
      difficulty: "custom",
      customLevel: { rows: 10, columns: 10, mines: 10 },
    }),
  });
  expect(h.cells()).toHaveLength(100);
  h.cells()[0].click();
  const numbered = h
    .cells()
    .find((cell) => cell.dataset.tile?.startsWith("number-"));
  numbered?.dispatchEvent(
    new h.s.window.MouseEvent("dblclick", { bubbles: true }),
  );
  h.root.remove();
  await h.s.advanceTime(1000);
});

test("Minesweeper's menus follow XP's menu bar rules", async () => {
  const h = await setup();
  await checkMenuBar({
    s: h.s,
    win: h.win,
    control: h.root,
    accessKey: "g",
    settle: flushShell,
  });
  // Choosing an item closes the menu and gives the keys back first.
  h.root.focus();
  h.root.dispatchEvent(
    new h.s.window.KeyboardEvent("keydown", {
      key: "g",
      altKey: true,
      bubbles: true,
    }),
  );
  h.command("expert");
  expect(h.win.querySelector(".minesweeper-popup:not([hidden])")).toBeNull();
  expect(h.s.document.activeElement === h.root).toBeTrue();
  expect(h.cells()).toHaveLength(480);
});

test("Minesweeper keeps the keys on the same square of a new game", async () => {
  const h = await setup();
  const square = h.cells()[5];
  square.focus();
  square.dispatchEvent(
    new h.s.window.KeyboardEvent("keydown", { key: "F2", bubbles: true }),
  );
  expect(square.isConnected).toBeFalse();
  expect(h.s.document.activeElement === h.cells()[5]).toBeTrue();
  // A smaller field gives them to its last square.
  h.command("intermediate");
  h.cells()[200].focus();
  h.command("beginner");
  expect(h.s.document.activeElement === h.cells().at(-1)).toBeTrue();
});
