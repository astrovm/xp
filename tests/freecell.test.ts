// @ts-nocheck -- FreeCell's window, played through Happy DOM.
import { afterEach, expect, test } from "bun:test";
import {
  applyStep,
  cloneBoard,
  deal,
  planAutoMoves,
  planColumnMove,
} from "../site/apps/freecell/game.js";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { checkMenuBar } from "./helpers/menu-bar";
import { face, recordCardCanvas } from "./helpers/card-canvas";

afterEach(cleanupShells);

const record = (window, options = {}) =>
  recordCardCanvas(window, {
    board: "freecell-board",
    width: 632,
    height: 426,
    ...options,
  });

const COLUMNS = [7, 85, 163, 241, 319, 397, 475, 553];
const SUITS = "CDHS";
const RANKS = "A23456789TJQK";
const KING = (name) => `assets/xp/freecell/King${name}.png`;

const open = async ({
  settings,
  storage = {},
  failImages = false,
  screenHeight,
  width,
} = {}) => {
  let frames;
  const s = await login(
    await loadShell({
      initialStorage: {
        freecellSettings: JSON.stringify({ quick: true, ...settings }),
        ...storage,
      },
      beforeScripts: (window) => {
        frames = record(window, {
          failImages,
          screenHeight,
          ...(width ? { width } : {}),
        });
      },
    }),
  );
  s.window.history.replaceState(null, "", "#freecell");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await flushShell();
  await flushShell();
  const win = s.document.querySelector('.xp-window[data-game="__freecell"]');
  const canvas = win.querySelector("canvas");
  const settle = async (times = 6) => {
    for (let index = 0; index < times; index += 1) await flushShell();
  };
  let model = null;
  const mouse = async (
    [x, y],
    { button = 0, detail = 1, type = "mousedown" } = {},
  ) => {
    canvas.dispatchEvent(
      new s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
    canvas.dispatchEvent(
      new s.window.MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        button,
        detail,
      }),
    );
    await settle();
  };
  const hover = ([x, y]) =>
    canvas.dispatchEvent(
      new s.window.MouseEvent("mousemove", {
        bubbles: true,
        clientX: x,
        clientY: y,
      }),
    );
  const key = async (name, init = {}) => {
    win.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        ...init,
      }),
    );
    await settle();
  };
  const dialog = () => [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  const answer = async (id) => {
    dialog().querySelector(`[data-action="${id}"]`).click();
    await settle();
  };
  const frame = () => frames.at(-1);
  const drawnAt = (x, y) =>
    frame()
      .filter(([, left, top]) => left === x && top === y)
      .map(([image]) => image)
      .at(-1);
  const menu = async (name, command) => {
    win.querySelector(`[data-freecell-menu="${name}"]`).click();
    const item = win.querySelector(`.tm-menu [data-command="${command}"]`);
    if (item.disabled) {
      win.querySelector(`[data-freecell-menu="${name}"]`).click();
      return false;
    }
    item.click();
    await settle();
    return true;
  };
  const title = () => win.querySelector(".title-text").textContent;
  const cardsLeft = () => win.querySelector(".freecell-cards-left").textContent;
  // Deals a numbered game through Select Game, and follows it in a model so
  // tests can click the bottom card of any column.
  const play = async (number) => {
    await key("F3");
    if (dialog().textContent.includes("resign")) await answer("yes");
    dialog().querySelector("input").value = String(number);
    await answer("ok");
    model = deal(number);
  };
  const bottom = (index) => [
    COLUMNS[index - 1] + 30,
    106 + 18 * (model.columns[index - 1].length - 1) + 50,
  ];
  const place = (target) =>
    target.column ? bottom(target.column) : cell(target.row);
  // Plays a move the way the window does, then mirrors it in the model.
  const move = async (from, to, steps = [{ from, to }]) => {
    await mouse(place(from));
    await mouse(to.column ? [COLUMNS[to.column - 1] + 30, 400] : cell(to.row));
    steps.forEach((step) => applyStep(model, step));
    planAutoMoves(model).forEach((step) => applyStep(model, step));
  };
  return {
    s,
    win,
    canvas,
    frames,
    settle,
    mouse,
    hover,
    key,
    dialog,
    answer,
    drawnAt,
    menu,
    title,
    cardsLeft,
    play,
    move,
    bottom,
    model: () => model,
  };
};

// A free or home cell.
const cell = (row) => [
  row < 4 ? 71 * row + 30 : 632 - 284 + 71 * (row - 4) + 30,
  40,
];
const col = (column) => ({ column });
const free = (row) => ({ column: 0, row });

test("FreeCell opens on an empty table and deals numbered games", async () => {
  const h = await open();
  expect([h.title(), h.cardsLeft()]).toEqual(["FreeCell", "Cards Left: 0"]);
  expect(h.drawnAt(300, 21)).toBe(KING("Right"));
  // Without a game, clicks and the number keys do nothing.
  await h.mouse([40, 160]);
  await h.key("1");
  expect(await h.menu("game", "restart")).toBeFalse();
  expect(await h.menu("game", "undo")).toBeFalse();

  // Invalid numbers ask again; closing the dialog keeps the table.
  await h.key("F3");
  expect(h.dialog().textContent).toContain("from 1 to 1000000");
  for (const value of ["0", "abc", "1000001"]) {
    h.dialog().querySelector("input").value = value;
    await h.answer("ok");
  }
  expect(h.dialog().querySelector(".title-text").textContent).toBe(
    "Game Number",
  );
  h.dialog().querySelector(".close-btn").click();
  await h.settle();
  expect(h.title()).toBe("FreeCell");

  await h.play(1);
  expect([h.title(), h.cardsLeft()]).toEqual([
    "FreeCell Game #1",
    "Cards Left: 52",
  ]);
  expect(h.drawnAt(7, 106)).toBe(face("JD"));
  expect(h.drawnAt(7, 214)).toBe(face("6S"));
  expect(h.drawnAt(553, 196)).toBe(face("TC"));
  expect(h.drawnAt(0, 0)).toBeUndefined();

  // New Game deals a suggested number without asking.
  await h.key("F2");
  await h.answer("no");
  await h.menu("game", "new");
  await h.answer("yes");
  expect(h.title()).toMatch(/^FreeCell Game #\d+$/);
});

test("cards move by clicks, go home on their own, and undo together", async () => {
  const h = await open();
  await h.play(1);
  // A selected card draws inverted, and the king looks at the free cells.
  await h.mouse(h.bottom(6));
  expect(h.drawnAt(397, 196)).toBe(face("3D", true));
  await h.mouse(cell(0));
  expect(h.drawnAt(0, 0)).toBe(face("3D"));
  expect(h.drawnAt(300, 21)).toBe(KING("Left"));

  // Uncovering the aces sends them and the two of clubs home.
  await h.mouse([COLUMNS[5] + 30, 106 + 18 * 4 + 50]);
  await h.mouse(cell(1));
  expect(h.cardsLeft()).toBe("Cards Left: 49");
  expect(h.drawnAt(348, 0)).toBe(face("2C"));
  expect(h.drawnAt(419, 0)).toBe(face("AS"));
  expect(h.drawnAt(300, 21)).toBe(KING("Right"));

  await h.key("F10");
  expect(h.cardsLeft()).toBe("Cards Left: 52");
  expect(h.drawnAt(397, 178)).toBe(face("2C"));
  // Undo has one level.
  expect(await h.menu("game", "undo")).toBeFalse();
  await h.key("F10");

  // Illegal moves explain themselves, then drop the selection.
  await h.mouse(cell(0));
  await h.mouse([COLUMNS[2] + 30, 400]);
  expect(h.dialog().textContent).toContain("That move is not allowed.");
  await h.answer("ok");
  await h.mouse(cell(0));
  await h.mouse(cell(4));
  expect(h.dialog().textContent).toContain("That move is not allowed.");
  await h.answer("ok");
  // Clicking the selected cell again, or outside the table, cancels.
  await h.mouse(cell(0));
  await h.mouse(cell(0));
  await h.mouse(cell(0));
  await h.mouse([300, 40]);
  expect(h.drawnAt(0, 0)).toBe(face("3D"));

  expect(await h.menu("game", "restart")).toBeTrue();
  expect(h.dialog().textContent).toContain("Do you want to resign this game?");
  await h.answer("yes");
  expect(h.title()).toBe("FreeCell Game #1");
  expect(h.drawnAt(397, 196)).toBe(face("3D"));
});

test("empty columns ask whether to move the run or one card", async () => {
  const h = await open();
  await h.play(1);
  // Column 6 empties in five moves.
  await h.move(col(6), free(0));
  await h.move(col(6), free(1));
  await h.move(col(6), free(1));
  await h.move(col(6), free(2));
  await h.move(free(2), col(7));
  expect(h.model().columns[5]).toEqual([]);
  // The eight of clubs and seven of hearts form a run.
  await h.mouse(h.bottom(7));
  await h.mouse([COLUMNS[5] + 30, 400]);
  expect(h.dialog().querySelector(".title-text").textContent).toBe(
    "Move to Empty Column...",
  );
  expect(h.dialog().querySelector(".close-btn")).toBeNull();
  await h.answer("cancel");
  expect(h.drawnAt(397, 106)).toBeUndefined();

  await h.mouse(h.bottom(7));
  await h.mouse([COLUMNS[5] + 30, 400]);
  await h.answer("single");
  expect(h.drawnAt(397, 106)).toBe(face("7H"));
  await h.key("F10");

  await h.mouse(h.bottom(7));
  await h.mouse([COLUMNS[5] + 30, 400]);
  await h.answer("column");
  expect([h.drawnAt(397, 106), h.drawnAt(397, 124)]).toEqual([
    face("8C"),
    face("7H"),
  ]);
  await h.key("F10");

  // A free cell card moves into the empty column, and a lone card moves
  // there without asking.
  await h.mouse(cell(0));
  await h.mouse([COLUMNS[5] + 30, 400]);
  expect(h.drawnAt(397, 106)).toBe(face("3D"));
  await h.key("F10");
  await h.mouse(h.bottom(1));
  await h.mouse([COLUMNS[5] + 30, 400]);
  expect(h.drawnAt(397, 106)).toBe(face("6S"));
});

test("long runs park in empty columns, and moves beyond the free space are refused", async () => {
  const h = await open();
  await h.play(2499);
  await h.move(col(1), free(0));
  await h.move(col(5), free(1));
  await h.move(col(5), free(2));
  await h.move(col(5), col(7));
  const before = cloneBoard(h.model());
  const steps = planColumnMove(before, 7, 2);
  expect(steps.length).toBeGreaterThan(3);
  await h.move(col(7), col(2), steps);
  const moved = h.model().columns[1];
  expect(h.drawnAt(85, 106 + 18 * (moved.length - 1))).toBe(
    face(`${RANKS[moved.at(-1) >> 2]}${SUITS[moved.at(-1) % 4]}`),
  );

  const g = await open();
  await g.play(6);
  await g.move(col(1), free(0));
  await g.move(col(1), free(1));
  await g.move(col(1), free(2));
  await g.move(col(5), free(3));
  await g.mouse(g.bottom(2));
  await g.mouse(g.bottom(5));
  expect(g.dialog().textContent).toContain(
    "That move requires moving 2 cards.You only have enough free space to move 1.",
  );
  await g.answer("ok");
});

test("without messages, illegal moves keep the selection", async () => {
  const h = await open({ settings: { messages: false } });
  await h.play(6);
  await h.move(col(1), free(0));
  await h.move(col(1), free(1));
  await h.move(col(1), free(2));
  await h.move(col(5), free(3));
  await h.mouse(h.bottom(2));
  await h.mouse(h.bottom(5));
  await h.mouse(h.bottom(3));
  expect(h.dialog()).toBeUndefined();
  expect(h.drawnAt(85, 106 + 18 * 6)).toMatch(/ inverted$/);
  await h.mouse(cell(4));
  expect(h.drawnAt(85, 106 + 18 * 6)).toMatch(/ inverted$/);
  // With no free cell, an empty column takes one card without asking.
  await h.mouse([COLUMNS[0] + 30, 400]);
  expect(h.dialog()).toBeUndefined();
});

test("double-clicks send cards to free cells, and right-clicks reveal covered cards", async () => {
  const h = await open();
  await h.play(1);
  await h.mouse(h.bottom(1));
  await h.mouse(h.bottom(1), { detail: 2 });
  expect(h.drawnAt(0, 0)).toBe(face("6S"));
  // A first press that's already a double-click selects, then moves.
  await h.mouse([COLUMNS[0] + 30, 106 + 18 * 5 + 50], { detail: 2 });
  expect(h.drawnAt(71, 0)).toBe(face("6D"));
  await h.mouse([300, 40], { detail: 2 });
  await h.move(col(2), free(2));
  await h.move(col(2), free(3));
  // With the free cells full, a double-click just cancels.
  await h.mouse(h.bottom(3));
  await h.mouse(h.bottom(3), { detail: 2 });
  expect(h.drawnAt(163, 214)).toBe(face("2H"));

  // Holding the right button shows a covered card until it's released.
  await h.mouse([COLUMNS[0] + 30, 115], { button: 2 });
  expect(h.drawnAt(7, 106)).toBe(face("JD"));
  expect(h.frames.at(-1).at(-1)[0]).toBe(face("JD"));
  await h.mouse([COLUMNS[0] + 30, 115], { button: 2, type: "mouseup" });
  expect(h.frames.at(-1).at(-1)[0]).not.toBe(face("JD"));
  await h.mouse([COLUMNS[0] + 30, 115], { button: 0, type: "mouseup" });
  // The bottom card and empty spaces have nothing to reveal.
  await h.mouse(h.bottom(3), { button: 2 });
  await h.mouse([300, 40], { button: 2 });
  await h.mouse([COLUMNS[0] + 30, 400], { button: 1 });
  h.canvas.dispatchEvent(
    new h.s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );

  const off = await open({ settings: { doubleClick: false } });
  await off.play(1);
  await off.mouse(off.bottom(1));
  await off.mouse(off.bottom(1), { detail: 2 });
  expect(off.drawnAt(0, 0)).toBeUndefined();
});

test("the cursor shows legal targets and the king follows the pointer", async () => {
  const h = await open();
  h.hover([30, 40]);
  expect(h.canvas.dataset.cursor).toBe("");
  await h.play(1);
  h.hover(cell(5));
  expect(h.drawnAt(300, 21)).toBe(KING("Right"));
  h.hover(cell(1));
  expect(h.drawnAt(300, 21)).toBe(KING("Left"));
  h.hover(cell(2));
  // The seven of clubs can take the six of diamonds.
  await h.mouse(h.bottom(1));
  h.hover(cell(0));
  expect(h.canvas.dataset.cursor).toBe("up");
  h.hover(cell(4));
  expect(h.canvas.dataset.cursor).toBe("");
  h.hover([300, 40]);
  expect(h.canvas.dataset.cursor).toBe("");
  h.hover([COLUMNS[2] + 30, 400]);
  expect(h.canvas.dataset.cursor).toBe("");
  h.hover(h.bottom(1));
  expect(h.canvas.dataset.cursor).toBe("");
  await h.mouse(h.bottom(1));
  await h.move(col(6), free(0));
  await h.mouse(cell(0));
  // Three of diamonds from a free cell onto a black four.
  h.hover(h.bottom(2));
  expect(h.canvas.dataset.cursor).toBe("");
  await h.mouse(cell(0));
  await h.mouse(h.bottom(8));
  h.hover(h.bottom(3));
  expect(h.canvas.dataset.cursor).toBe("");
  await h.mouse(h.bottom(8));

  const g = await open();
  await g.play(1);
  await g.move(col(6), free(0));
  await g.move(col(6), free(1));
  await g.move(col(6), free(1));
  await g.move(col(6), free(2));
  // Seven of hearts onto the eight of clubs; empty columns always show up.
  await g.mouse(cell(2));
  g.hover(g.bottom(7));
  expect(g.canvas.dataset.cursor).toBe("down");
  await g.mouse(cell(2));
  await g.mouse(g.bottom(7));
  g.hover([COLUMNS[5] + 30, 400]);
  expect(g.canvas.dataset.cursor).toBe("up");
  await g.mouse(g.bottom(7));
  await g.move(cell(2) && free(2), col(7));
  await g.mouse(g.bottom(7));
  g.hover(g.bottom(5));
  expect(g.canvas.dataset.cursor).toBe("");
});

test("the number keys play columns, free cells and home", async () => {
  const h = await open();
  await h.play(1);
  // 6 selects column six, and 0 sends it to the first free cell.
  await h.key("6");
  expect(h.drawnAt(397, 196)).toBe(face("3D", true));
  await h.key("0");
  expect(h.drawnAt(0, 0)).toBe(face("3D"));
  // Without a selection, 9 does nothing and 0 picks the first full cell.
  await h.key("9");
  await h.key("0");
  expect(h.drawnAt(0, 0)).toBe(face("3D", true));
  // 0 again moves the selection to the next full cell, or drops it.
  await h.key("0");
  expect(h.drawnAt(0, 0)).toBe(face("3D"));
  await h.key("1");
  await h.key("0");
  expect(h.drawnAt(71, 0)).toBe(face("6S"));
  await h.key("0");
  await h.key("0");
  expect(h.drawnAt(71, 0)).toBe(face("6S", true));
  await h.key("0");
  expect(h.drawnAt(71, 0)).toBe(face("6S"));
  // 9 sends a card home, to its suit's cell or the first empty one.
  await h.key("6");
  await h.key("9");
  expect(h.dialog().textContent).toContain("That move is not allowed.");
  await h.answer("ok");
  await h.key("6");
  await h.key("2");
  expect(h.dialog().textContent).toContain("That move is not allowed.");
  await h.answer("ok");
  // With the free cells full, 0 tries the first one.
  await h.play(1);
  for (let count = 0; count < 4; count += 1) {
    await h.key("1");
    await h.key("0");
  }
  await h.key("2");
  await h.key("0");
  expect(h.dialog().textContent).toContain("That move is not allowed.");
  await h.answer("ok");
  // A selected column's key shows its cards one by one.
  await h.key("5");
  await h.key("5");
  expect(h.frames.at(-1).at(-1)[0]).toBe(face("5D"));
  expect(h.canvas.dataset.cursor).toBe("wait");
  await h.key("1");
  await h.s.advanceTime(300);
  await h.settle();
  expect(h.frames.at(-1).at(-1)[0]).toBe(face("AD"));
  await h.s.advanceTime(300 * 5);
  await h.settle();
  expect(h.canvas.dataset.cursor).toBe("");
  expect(h.drawnAt(319, 196)).toBe(face("6C"));
});

test("Ctrl+Shift+F10 wins or loses the next move, and Game Over offers another game", async () => {
  const h = await open();
  await h.play(1);
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  expect(h.dialog().textContent).toContain("Choose Abort to Win");
  await h.answer("ignore");
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  await h.answer("abort");
  await h.move(col(1), free(0));
  expect(h.cardsLeft()).toBe("Cards Left: 0");
  // The big smiling king fills the table, and the dialog sits where its
  // template puts it.
  expect(
    h.frames
      .at(-1)
      .some(
        ([image, x, y, width]) =>
          image === KING("Smile") && x === 10 && y === 106 && width === 320,
      ),
  ).toBeTrue();
  expect(h.dialog().querySelector(".close-btn")).toBeNull();
  expect(h.dialog().textContent).toContain("Congratulations, you win!");
  // Select Game starts checked after Select Game was used.
  expect(h.dialog().querySelector("input").checked).toBeTrue();
  await h.answer("no");
  // The game is over: clicks do nothing and the king doesn't turn.
  await h.mouse(h.bottom(2));
  h.hover(cell(0));
  expect(await h.menu("game", "undo")).toBeFalse();

  await h.play(2);
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  await h.answer("abort");
  await h.move(col(1), free(0));
  h.dialog().querySelector("input").checked = false;
  await h.answer("yes");
  expect(h.title()).toMatch(/^FreeCell Game #\d+$/);

  await h.play(3);
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  await h.answer("abort");
  await h.move(col(1), free(0));
  await h.answer("yes");
  expect(h.dialog().querySelector(".title-text").textContent).toBe(
    "Game Number",
  );
  h.dialog().querySelector("input").value = "4";
  await h.answer("ok");
  expect(h.title()).toBe("FreeCell Game #4");

  // Retry loses after the next move. Same game deals it again.
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  await h.answer("retry");
  await h.mouse(h.bottom(1));
  await h.mouse(cell(0));
  expect(h.dialog().textContent).toContain(
    "Sorry, you lose.There are no more legal moves.",
  );
  expect(h.dialog().querySelector("input").checked).toBeTrue();
  await h.answer("yes");
  expect(h.title()).toBe("FreeCell Game #4");
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  await h.answer("retry");
  await h.mouse(h.bottom(1));
  await h.mouse(cell(0));
  h.dialog().querySelector("input").checked = false;
  await h.answer("yes");
  expect(h.dialog().querySelector(".title-text").textContent).toBe(
    "Game Number",
  );
  h.dialog().querySelector(".close-btn").click();
  await h.settle();
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  await h.answer("retry");

  // Statistics count each game once, with streaks.
  await h.key("F4");
  const text = h.dialog().textContent;
  expect(text).toContain("This session");
  expect(text).toContain("60%");
  // The random game resigned between the second and third wins broke the
  // streak; replaying game 4 didn't count twice.
  expect(text).toContain("1 loss");
  await h.answer("ok");
  const saved = JSON.parse(
    h.s.window.localStorage.getItem("freecellStatistics"),
  );
  expect(saved).toMatchObject({ won: 3, lost: 2, wins: 2, losses: 1 });
});

test("a lost game can be left or replaced by a new one", async () => {
  const h = await open();
  await h.play(-1);
  for (const target of [0, 1, 2, 3]) await h.move(col(5), free(target));
  expect(h.dialog().textContent).toContain("Sorry, you lose.");
  await h.answer("no");
  expect(h.title()).toBe("FreeCell Game #-1");
  await h.mouse(h.bottom(1));
  // F2 now starts without asking to resign.
  await h.key("F2");
  expect(h.dialog()).toBeUndefined();
  expect(h.title()).not.toBe("FreeCell Game #-1");

  // Game -1 is hidden: it doesn't count in the statistics.
  await h.key("F4");
  expect(h.dialog().textContent).toContain("0%");
  await h.answer("ok");
});

test("one move left flashes the window four times", async () => {
  const h = await open();
  await h.play(1);
  for (const target of [0, 1, 2, 3]) await h.move(col(1), free(target));
  const flashing = () => h.win.classList.contains("freecell-flash");
  const states = [];
  for (let tick = 0; tick < 5; tick += 1) {
    await h.s.advanceTime(400);
    states.push(flashing());
  }
  expect(states).toEqual([true, false, true, false, false]);
  // A new game stops a warning in progress.
  await h.key("F10");
  await h.move(col(1), free(3));
  await h.s.advanceTime(400);
  expect(flashing()).toBeTrue();
  await h.key("F2");
  await h.answer("yes");
  expect(flashing()).toBeFalse();
});

test("statistics, options and About use freecell.exe's dialogs", async () => {
  const h = await open({
    storage: {
      freecellStatistics: JSON.stringify({
        won: 3,
        lost: 1,
        streak: 1,
        streakType: "won",
        wins: 2,
        losses: 1,
      }),
    },
  });
  await h.key("F4");
  let lines = [...h.dialog().querySelectorAll(".freecell-statistics-line")].map(
    (line) => line.textContent,
  );
  expect(lines).toContain("Total75%");
  expect(lines).toContain("current:1 win");
  // Clear asks first.
  await h.answer("clear");
  await h.answer("no");
  expect(h.dialog().textContent).toContain("75%");
  await h.answer("clear");
  await h.answer("yes");
  lines = [...h.dialog().querySelectorAll(".freecell-statistics-line")].map(
    (line) => line.textContent,
  );
  expect(lines).toContain("Total0%");
  expect(lines).toContain("current:0");
  await h.answer("ok");

  await h.menu("game", "options");
  const boxes = () => [...h.dialog().querySelectorAll("input")];
  expect(boxes().map((box) => box.checked)).toEqual([true, true, true]);
  boxes()[0].checked = false;
  await h.answer("cancel");
  await h.key("F5");
  boxes()[1].checked = false;
  await h.answer("ok");
  expect(
    JSON.parse(h.s.window.localStorage.getItem("freecellSettings")),
  ).toEqual({ messages: true, quick: false, doubleClick: true });

  await h.menu("help", "about");
  expect(h.dialog().textContent).toContain("Microsoft ® FreeCell");
  expect(h.dialog().textContent).toContain("by Jim Horne");
  await h.answer("ok");

  // Menus close when clicked again or outside.
  h.win.querySelector('[data-freecell-menu="game"]').click();
  h.win.querySelector('[data-freecell-menu="game"]').click();
  expect(h.win.querySelector(".tm-menu")).toBeNull();
  h.win.querySelector('[data-freecell-menu="help"]').click();
  // A press on a title keeps the menus; one on the bar's empty part closes
  // them, like XP.
  h.win
    .querySelector('[data-freecell-menu="help"]')
    .dispatchEvent(
      new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
  expect(h.win.querySelector(".tm-menu")).not.toBeNull();
  h.win
    .querySelector(".cards-menu-bar")
    .dispatchEvent(
      new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
  expect(h.win.querySelector(".tm-menu")).toBeNull();
  h.win.querySelector('[data-freecell-menu="help"]').click();
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(h.win.querySelector(".tm-menu")).toBeNull();
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  // Shortcuts wait while a dialog is open.
  await h.key("F4");
  await h.key("F5");
  expect(h.s.document.querySelectorAll(".xp-dialog")).toHaveLength(1);
});

test("closing a game in progress asks to resign it", async () => {
  const h = await open();
  await h.play(1);
  await h.menu("game", "exit");
  expect(h.dialog().textContent).toContain("Do you want to resign this game?");
  await h.answer("no");
  expect(
    h.s.document.querySelector('.xp-window[data-game="__freecell"]'),
  ).not.toBeNull();
  h.win.querySelector(".close-btn").click();
  await h.settle();
  await h.answer("yes");
  expect(
    h.s.document.querySelector('.xp-window[data-game="__freecell"]'),
  ).toBeNull();
  expect(
    JSON.parse(h.s.window.localStorage.getItem("freecellStatistics")),
  ).toMatchObject({ lost: 1, losses: 1, streak: 1 });
});

test("moves slide one frame per 37 pixels unless Quick play is on", async () => {
  const h = await open({ settings: { quick: false } });
  await h.play(1);
  const count = h.frames.length;
  await h.mouse(h.bottom(6));
  await h.mouse(cell(0));
  for (let index = 0; index < 20; index += 1) await h.settle(2);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await h.settle();
  expect(h.drawnAt(0, 0)).toBe(face("3D"));
  // The slide drew the card on its way, with a busy cursor.
  expect(h.frames.length - count).toBeGreaterThan(5);
});

test("small screens tighten the columns, and the window follows its size", async () => {
  const h = await open({ screenHeight: 300 });
  await h.play(1);
  expect(h.drawnAt(7, 100)).toBe(face("JD"));
  expect(h.drawnAt(7, 114)).toBe(face("KD"));
  h.s.window.cardGameResize();
  expect(h.drawnAt(7, 114)).toBe(face("KD"));
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  await h.answer("abort");
  await h.move(col(1), free(0));
  expect(
    h.frames
      .at(-1)
      .some(
        ([image, , , width, height]) =>
          image === KING("Smile") && width === 256 && height === 192,
      ),
  ).toBeTrue();
});

test("the click that activates FreeCell only activates it", async () => {
  const h = await open();
  await h.play(1);
  h.win.classList.remove("active");
  await h.mouse(h.bottom(6));
  expect(h.drawnAt(397, 196)).toBe(face("3D"));
  await h.mouse(h.bottom(6));
  expect(h.drawnAt(397, 196)).toBe(face("3D", true));
});

test("unreadable settings fall back to XP's defaults, and missing cards say so", async () => {
  const h = await open({
    storage: {
      freecellStatistics: "not json",
      freecellSettings: "[1]",
    },
    failImages: true,
  });
  expect(h.dialog().textContent).toContain("The cards didn't load.");
  await h.answer("ok");
  h.s.window.localStorage.setItem = () => {
    throw new Error("full");
  };
  await h.key("F5");
  await h.answer("ok");
  await h.key("F4");
  expect(h.dialog().textContent).toContain("0%");
});

test("clicks outside the table, home cells and empty places select nothing", async () => {
  const h = await open();
  await h.play(1);
  for (const point of [[3, 400], [631, 400], [100, 100], cell(5), cell(2)]) {
    await h.mouse(point);
    await h.mouse([COLUMNS[0] + 30, 106 + 18 * 6 + 50], {
      button: 2,
      type: "mouseup",
    });
  }
  // 0 with every free cell empty selects nothing.
  await h.key("0");
  expect(
    h.frames.at(-1).some(([image]) => image.endsWith(" inverted")),
  ).toBeFalse();
  // 9 aims at the suit's home cell once it has one.
  await h.move(col(6), free(0));
  await h.move(col(6), free(1));
  await h.key("1");
  await h.key("9");
  expect(h.dialog().textContent).toContain("That move is not allowed.");
  await h.answer("ok");
  // An empty column's key selects nothing.
  await h.move(col(6), free(1));
  await h.move(col(6), free(2));
  await h.move(free(2), col(7));
  await h.key("6");
  expect(
    h.frames.at(-1).some(([image]) => image.endsWith(" inverted")),
  ).toBeFalse();
  // With the free cells full, a run moves to an empty column one card at a
  // time without asking.
  await h.move(col(1), free(2));
  await h.move(col(1), free(3));
  await h.mouse(h.bottom(7));
  await h.mouse([COLUMNS[5] + 30, 400]);
  expect(h.dialog()).toBeUndefined();
  expect(h.drawnAt(397, 106)).toBe(face("7H"));
});

test("a lost game restarts from the menu, or a new one starts", async () => {
  const h = await open();
  await h.key("F2");
  const first = h.title();
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  await h.answer("retry");
  // Any legal move ends the game.
  for (const column of [1, 2, 3, 4, 5, 6, 7, 8]) {
    if (h.dialog()) break;
    await h.key(String(column));
    await h.key("0");
  }
  h.dialog().querySelector("input").checked = false;
  await h.answer("yes");
  // A new game starts without asking for a number.
  expect(h.dialog()).toBeUndefined();
  expect(h.title()).toMatch(/^FreeCell Game #\d+$/);
  expect(first).toMatch(/^FreeCell Game #\d+$/);
  const second = h.title();
  await h.key("F10", { ctrlKey: true, shiftKey: true });
  await h.answer("retry");
  await h.key("1");
  await h.key("0");
  await h.answer("no");
  // Restart replays the game that just ended.
  await h.menu("game", "restart");
  expect(h.title()).toBe(second);
});

test("animations block new moves, undo and new games until they finish", async () => {
  const h = await open({ settings: { quick: false } });
  await h.play(1);
  // Hold the frames so the slides wait for the test.
  const pending = [];
  h.s.window.requestAnimationFrame = (callback) => pending.push(callback);
  const runFrames = async () => {
    while (pending.length) {
      pending.shift()();
      await h.settle(1);
    }
  };
  await h.mouse(h.bottom(6));
  canvasDown(h, cell(0));
  await h.settle();
  await runFrames();
  await h.settle();
  expect(h.drawnAt(0, 0)).toBe(face("3D"));
  // A long slide runs while everything else waits.
  await h.mouse(h.bottom(1));
  canvasDown(h, cell(3));
  await h.settle();
  expect(pending.length).toBe(1);
  h.hover(cell(1));
  expect(h.canvas.dataset.cursor).toBe("wait");
  await h.key("F10");
  await h.key("F2");
  await h.key("1");
  canvasDown(h, h.bottom(2));
  await h.settle();
  expect(h.dialog()).toBeUndefined();
  await runFrames();
  await h.settle();
  expect(h.drawnAt(213, 0)).toBe(face("6S"));
  h.hover(cell(1));
  expect(h.canvas.dataset.cursor).toBe("");
});

// Presses without waiting, for moves made while an animation runs.
const canvasDown = (h, [x, y]) => {
  h.canvas.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  h.canvas.dispatchEvent(
    new h.s.window.MouseEvent("mousedown", {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      detail: 1,
    }),
  );
};

test("the cursor points down at columns that take the selected run", async () => {
  const h = await open();
  await h.play(2499);
  await h.move(col(1), free(0));
  await h.move(col(5), free(1));
  await h.move(col(5), free(2));
  await h.move(col(5), col(7));
  await h.mouse(h.bottom(7));
  h.hover(h.bottom(2));
  expect(h.canvas.dataset.cursor).toBe("down");
});

test("Statistics name longer streaks in words", async () => {
  for (const [streakType, words] of [
    ["won", "3 wins"],
    ["lost", "2 losses"],
  ]) {
    const h = await open({
      storage: {
        freecellStatistics: JSON.stringify({
          won: 3,
          lost: 2,
          streak: words[0] === "3" ? 3 : 2,
          streakType,
          wins: 3,
          losses: 2,
        }),
      },
    });
    await h.key("F4");
    expect(h.dialog().textContent).toContain(`current:${words}`);
  }
});

test("without card images the table still plays", async () => {
  const h = await open({ failImages: true });
  await h.answer("ok");
  await h.play(1);
  expect(h.cardsLeft()).toBe("Cards Left: 52");
  expect(h.drawnAt(7, 106)).toBeUndefined();
});

test("the table draws at full size, and scales down to fit a phone", async () => {
  const full = await open();
  expect(full.frames.transform).toEqual([1, 0, 0, 1, 0, 0]);
  // Eight cards side by side need 568 pixels.
  const phone = await open({ width: 390 });
  expect(phone.frames.transform[0]).toBeCloseTo(390 / 568, 6);
});

test("FreeCell's menus follow XP's menu bar rules", async () => {
  const h = await open();
  await checkMenuBar({
    s: h.s,
    win: h.win,
    control: h.win.querySelector(".xp-freecell"),
    accessKey: "g",
    settle: flushShell,
  });
});
