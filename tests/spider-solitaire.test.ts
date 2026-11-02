// @ts-nocheck -- Spider Solitaire's window, played through Happy DOM.
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { recordCardCanvas } from "./helpers/card-canvas";

afterEach(cleanupShells);

// Playing a whole game takes 7 to 10 seconds of CPU, more than Bun's 5 second
// default, which only `bun run test` raises (`--timeout 30000`).
setDefaultTimeout(30_000);

// The XP VM dealt its Easy game at this clock.
const VM_TIME = 1791198413000;
const WIDTH = 1024;
const HEIGHT = 692;
const COLUMN_X = [28, 127, 226, 325, 424, 523, 622, 721, 820, 919];
const BACK = "assets/xp/spider/CardBack.png";
const EMPTY = "assets/xp/spider/Empty.png";
const SUITS = "CDHS";
const RANKS = "A23456789TJQK";
const face = (name) =>
  `assets/xp/spider/cards/${SUITS.indexOf(name[1]) * 13 + RANKS.indexOf(name[0]) + 1}.png`;
const card = (name) => RANKS.indexOf(name[0]) * 4 + SUITS.indexOf(name[1]);
const up = (name) => ({ card: card(name), up: true });
const down = (name) => ({ card: card(name), up: false });
const run = (suit = "S") =>
  RANKS.split("")
    .reverse()
    .map((rank) => up(`${rank}${suit}`));
const savedGame = (overrides = {}) =>
  JSON.stringify({
    suits: 1,
    seed: 1,
    columns: Array.from({ length: 10 }, () => []),
    stock: [],
    completed: [],
    moves: 0,
    score: 500,
    ...overrides,
  });

const open = async ({
  settings = { animate: false },
  storage = {},
  failImages = false,
  failFont = false,
  time = VM_TIME,
  width = WIDTH,
  height = HEIGHT,
  start = "easy",
  wait = true,
} = {}) => {
  let frames;
  const sounds = [];
  const clock = { now: 0 };
  const s = await login(
    await loadShell({
      initialStorage: {
        spiderSettings: JSON.stringify(settings),
        ...storage,
      },
      fetchObject: async (url) => {
        if (failFont) return new Response(null, { status: 404 });
        const path = String(url).replace(/^.*?assets\//, "assets/");
        return new Response(
          await Bun.file(
            new URL(`../site/${path}`, import.meta.url),
          ).arrayBuffer(),
        );
      },
      beforeScripts: (window) => {
        frames = recordCardCanvas(window, {
          board: "spider-board",
          width,
          height,
          failImages,
        });
        window.Date.now = () => time;
        // The clock creeps on each read too, so code that waits on it
        // (like Happy DOM's window animations) moves along.
        Object.defineProperty(window.performance, "now", {
          configurable: true,
          value: () => (clock.now += 0.01),
        });
        // Each frame moves the clock 20 ms, so animations finish on their
        // own.
        window.requestAnimationFrame = (callback) => {
          clock.now += 20;
          return window.setTimeout(callback, 0);
        };
        window.Audio = class {
          constructor(source) {
            if (source.includes("/spider/"))
              sounds.push(source.replace(/^.*\//, ""));
          }
          // Browsers can refuse to play before the page is used.
          play() {
            return Promise.reject(new Error("blocked"));
          }
          pause() {}
        };
      },
    }),
  );
  s.window.history.replaceState(null, "", "#spider-solitaire");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  const settle = async (times = 8) => {
    for (let index = 0; index < times; index += 1) await flushShell();
  };
  await settle();
  const win = s.document.querySelector(
    '.xp-window[data-game="__spider-solitaire"]',
  );
  const canvas = win.querySelector("canvas");
  const dialog = () => [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  const dialogTitle = () =>
    dialog()?.querySelector(".xp-dialog-title, .title-text")?.textContent;
  const answer = async (id) => {
    dialog().querySelector(`[data-action="${id}"]`).click();
    await settle();
  };
  // Waits for animations: every frame advances the clock.
  const idle = async (times = 40) => settle(times);
  if (start) {
    dialog().querySelector(`input[type="radio"]`);
    const radios = [...dialog().querySelectorAll('input[type="radio"]')];
    radios[["easy", "medium", "difficult"].indexOf(start)].checked = true;
    await answer("ok");
    if (wait) await idle(120);
  }
  const fire = (type, [x, y], init = {}) =>
    canvas.dispatchEvent(
      new s.window.MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
        ...init,
      }),
    );
  const click = async (point, init = {}) => {
    fire("mousedown", point, init);
    fire("mouseup", point, init);
    await idle();
  };
  const drag = async (from, to) => {
    canvas.dispatchEvent(
      new s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
    fire("mousedown", from);
    fire("mousemove", [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
    fire("mousemove", to);
    fire("mouseup", to);
    await idle();
  };
  const key = async (name, init = {}) => {
    win.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key: name,
        code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
        bubbles: true,
        ...init,
      }),
    );
    await idle();
  };
  const drawnAt = (x, y) =>
    frames
      .at(-1)
      .filter(([, left, top]) => left === x && top === y)
      .map(([image]) => image)
      .at(-1);
  const menuButton = (name) =>
    win.querySelector(`[data-spider-menu="${name}"]`);
  const menu = async (name, command) => {
    menuButton(name).click();
    const item = win.querySelector(`.tm-menu [data-command="${command}"]`);
    if (item.disabled) {
      menuButton(name).click();
      return false;
    }
    item.click();
    await idle();
    return true;
  };
  const score = () => canvas.getAttribute("aria-label");
  const stored = () =>
    JSON.parse(s.window.localStorage.getItem("spiderSettings"));
  return {
    s,
    win,
    canvas,
    frames,
    sounds,
    clock,
    settle,
    idle,
    fire,
    click,
    drag,
    key,
    dialog,
    dialogTitle,
    answer,
    drawnAt,
    menuButton,
    menu,
    score,
    stored,
  };
};

// Where each column's top card sits after the VM deal.
const TOP_Y = [45, 45, 45, 45, 38, 38, 38, 38, 38, 38];
const VM_TOPS = ["6S", "7S", "3S", "KS", "JS", "AS", "5S", "8S", "5S", "4S"];

test("Spider opens maximized on the Difficulty dialog, then deals spider.exe's game", async () => {
  const h = await open({ start: null });
  expect(h.win.querySelector(".title-text").textContent).toBe("Spider");
  expect(h.win.classList.contains("maximized")).toBeTrue();
  expect(h.dialogTitle()).toBe("Difficulty");
  // Before a game, the table shows ten empty slots and nothing to deal.
  expect(h.drawnAt(28, 10)).toBe(EMPTY);
  expect(h.menuButton("deal").classList.contains("disabled")).toBeTrue();
  expect(h.score()).toBe("Spider Solitaire. Score: 0. Moves: 0.");
  await h.answer("ok");
  await h.idle();
  expect(COLUMN_X.map((x, column) => h.drawnAt(x, TOP_Y[column]))).toEqual(
    VM_TOPS.map(face),
  );
  expect(h.drawnAt(28, 10)).toBe(BACK);
  // Five stock piles, 12 pixels apart from the bottom right.
  expect([919, 907, 895, 883, 871].map((x) => h.drawnAt(x, 586))).toEqual(
    Array(5).fill(BACK),
  );
  expect(h.drawnAt(859, 586)).toBeUndefined();
  expect(h.score()).toBe("Spider Solitaire. Score: 500. Moves: 0.");
  expect(h.menuButton("deal").classList.contains("disabled")).toBeFalse();
  // The high score starts at the opening 500.
  expect(h.stored().stats.easy.high).toBe(500);
});

test("cards drag onto a card one higher, turn over what they uncover, and undo", async () => {
  const h = await open();
  // The 5 of spades onto the 6.
  await h.drag([640, 60], [40, 80]);
  expect(h.sounds).toEqual(["PickUp.wav", "Drop.wav"]);
  expect(h.drawnAt(28, 73)).toBe(face("5S"));
  expect(h.drawnAt(622, 31)).toBe(face("TS"));
  expect(h.score()).toBe("Spider Solitaire. Score: 499. Moves: 1.");
  // Undo turns the 10 back down and counts as a move.
  await h.key("z", { ctrlKey: true });
  expect(h.drawnAt(622, 31)).toBe(BACK);
  expect(h.drawnAt(622, 38)).toBe(face("5S"));
  expect(h.score()).toBe("Spider Solitaire. Score: 498. Moves: 2.");
  expect(await h.menu("game", "undo")).toBeFalse();
  // Cards dropped where nothing takes them go back.
  await h.drag([140, 60], [500, 400]);
  expect(h.drawnAt(127, 45)).toBe(face("7S"));
  expect(h.score()).toBe("Spider Solitaire. Score: 498. Moves: 2.");
  // A face-down card, a broken run or the table can't be picked up.
  h.sounds.length = 0;
  await h.drag([40, 15], [140, 80]);
  await h.drag([500, 300], [140, 80]);
  await h.drag([10, 60], [140, 80]);
  expect(h.sounds).toEqual([]);
  // Moving the 6 onto the 7, then the 5 onto the 6, makes a run that picks
  // up whole; undo takes each move back.
  await h.drag([40, 50], [140, 80]);
  expect(h.drawnAt(127, 73)).toBe(face("6S"));
  await h.drag([640, 60], [140, 110]);
  expect(h.drawnAt(127, 101)).toBe(face("5S"));
  await h.drag([140, 50], [740, 60]);
  expect([66, 94, 122].map((y) => h.drawnAt(721, y))).toEqual(
    ["7S", "6S", "5S"].map(face),
  );
  await h.menu("game", "undo");
  expect(h.drawnAt(127, 101)).toBe(face("5S"));
});

test("the stock deals a row on a click, D or Deal!, but never onto an empty column", async () => {
  const h = await open();
  await h.click([900, 650]);
  expect(COLUMN_X.map((x, column) => h.drawnAt(x, TOP_Y[column] + 28))).toEqual(
    ["QS", "TS", "9S", "TS", "QS", "8S", "KS", "KS", "8S", "7S"].map(face),
  );
  expect(h.sounds.filter((name) => name === "Deal.wav")).toHaveLength(1);
  expect(h.drawnAt(871, 586)).toBeUndefined();
  // Dealing doesn't count as a move, and it clears Undo.
  expect(h.score()).toBe("Spider Solitaire. Score: 500. Moves: 0.");
  await h.key("d");
  await h.menu("game", "deal");
  h.menuButton("deal").click();
  await h.idle();
  expect(h.drawnAt(919, 586)).toBe(BACK);
  // A modifier key or the menu bar after the last deal deals nothing.
  await h.key("d", { shiftKey: true });
  await h.click([925, 650]);
  expect(h.drawnAt(919, 586)).toBeUndefined();
  expect(h.menuButton("deal").classList.contains("disabled")).toBeTrue();
  h.menuButton("deal").click();
  await h.key("d");
  expect(await h.menu("game", "deal")).toBeFalse();
});

test("an empty column stops the deal with spider.exe's message", async () => {
  const columns = Array.from({ length: 10 }, (_, column) =>
    column ? [up("9H")] : [],
  );
  const h = await open({
    settings: { animate: false, loadAtStart: true },
    storage: {
      spiderSavedGame: savedGame({
        columns,
        stock: Array.from({ length: 10 }, () => card("2C")),
      }),
    },
    start: null,
  });
  await h.click([925, 650]);
  expect(h.dialog().textContent).toContain(
    "You are not allowed to deal a new row while there are any empty slots.",
  );
  expect(h.dialog().querySelector(".dlg-icon")).toBeNull();
  await h.answer("ok");
  expect(h.drawnAt(919, 586)).toBe(BACK);
});

test("the score box and M show available moves in turn, or say there are none", async () => {
  const h = await open();
  await h.click([512, 640]);
  expect(h.sounds).toEqual(["Hint.wav"]);
  await h.key("m");
  await h.key("M", { code: "KeyM", shiftKey: true });
  expect(h.sounds).toEqual(["Hint.wav", "Hint.wav"]);
  // The seven moves cycle back to the first.
  for (let index = 0; index < 6; index += 1) await h.key("m");
  expect(h.sounds).toHaveLength(8);
  // The 3 of spades onto the 4 empties nothing; a lone ace has no moves.
  const lone = Array.from({ length: 10 }, (_, column) =>
    column ? [up("AH")] : [up("AS")],
  );
  const stuck = await open({
    settings: { animate: false, loadAtStart: true },
    storage: { spiderSavedGame: savedGame({ columns: lone }) },
    start: null,
  });
  await stuck.click([512, 640]);
  expect(stuck.sounds).toEqual(["NoMoves.wav"]);
  // The menu's Show An Available Move says so too.
  expect(await stuck.menu("game", "hint")).toBeTrue();
  expect(stuck.sounds).toEqual(["NoMoves.wav", "NoMoves.wav"]);
});

test("the right button shows a covered card whole while it's held", async () => {
  const h = await open();
  await h.drag([640, 60], [40, 80]);
  h.fire("mousedown", [40, 50], { button: 2, buttons: 2 });
  await h.idle();
  expect(h.frames.at(-1).at(-1)).toEqual([face("6S"), 28, 45]);
  // A drag can't start while a card shows.
  h.fire("mousedown", [40, 80]);
  await h.idle();
  expect(h.sounds.at(-1)).toBe("Drop.wav");
  h.fire("mouseup", [40, 50], { button: 2, buttons: 0 });
  // The browser's context menu stays away.
  const menu = new h.s.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  h.canvas.dispatchEvent(menu);
  expect(menu.defaultPrevented).toBeTrue();
  await h.idle();
  expect(h.frames.at(-1).at(-1)).not.toEqual([face("6S"), 28, 45]);
  // Face-down cards, empty table and the middle button show nothing.
  for (const [point, button] of [
    [[40, 15], 2],
    [[500, 400], 2],
    [[10, 60], 2],
    [[40, 50], 1],
  ]) {
    h.fire("mousedown", point, { button, buttons: 0 });
    h.fire("mouseup", point, { button, buttons: 0 });
    await h.idle();
    expect(h.frames.at(-1).at(-1)).not.toEqual([face("6S"), 28, 45]);
  }
  // Moving without the button held drags nothing.
  h.fire("mousedown", [140, 50]);
  h.fire("mousemove", [500, 300], { buttons: 0 });
  h.fire("mouseup", [140, 50]);
  await h.idle();
  expect(h.drawnAt(127, 45)).toBe(face("7S"));
});

const nearlyWon = (overrides = {}) =>
  savedGame({
    columns: [
      run().slice(0, 12),
      [up("AS")],
      ...Array.from({ length: 8 }, () => []),
    ],
    completed: [3, 3, 3, 3, 3, 3, 3],
    moves: 100,
    score: 1100,
    ...overrides,
  });

test("a finished run goes home for 100 points, and the last one wins with fireworks", async () => {
  const h = await open({
    settings: { animate: false, loadAtStart: true },
    storage: { spiderSavedGame: nearlyWon() },
    start: null,
  });
  expect(h.drawnAt(28 + 72, 586)).toBe(face("KS"));
  await h.drag([140, 20], [40, 330]);
  expect(h.dialogTitle()).toBe("Game Over");
  expect(h.dialog().textContent).toContain("Congratulations, you won!");
  expect(h.score()).toBe("Spider Solitaire. Score: 1199. Moves: 101.");
  expect(h.sounds.slice(-2)).toEqual(["Deal.wav", "Win.wav"]);
  expect(h.drawnAt(28 + 84, 586)).toBe(face("KS"));
  expect(h.stored().stats.easy).toMatchObject({
    wins: 1,
    current: 1,
    winning: true,
    mostWins: 1,
    high: 1199,
  });
  h.s.document.dispatchEvent(
    new h.s.window.MouseEvent("mouseup", { bubbles: true, button: 2 }),
  );
  expect(h.score()).toBe("Spider Solitaire. Score: 1199. Moves: 101.");
  expect(h.dialogTitle()).toBe("Game Over");
  // The fireworks run behind the dialog; sparks die out and burst again.
  const frames = h.frames.length;
  await h.idle(10);
  expect(h.frames.length).toBeGreaterThan(frames);
  h.clock.now += 7000;
  await h.idle(10);
  h.clock.now += 7000;
  await h.idle(10);
  // No keeps the fireworks going; the next command stops them.
  await h.answer("no");
  await h.idle(10);
  expect(await h.menu("game", "hint")).toBeFalse();
  expect(await h.menu("game", "save")).toBeFalse();
  await h.key("F2");
  expect(h.dialog()).toBeUndefined();
  expect(COLUMN_X.map((x, column) => h.drawnAt(x, TOP_Y[column]))).toEqual(
    VM_TOPS.map(face),
  );
});

test("Yes starts another game, and runs fly home card by card when animated", async () => {
  const h = await open({
    settings: { animate: true, loadAtStart: true, sound: false },
    storage: { spiderSavedGame: nearlyWon() },
    start: null,
  });
  await h.drag([140, 20], [40, 330]);
  await h.idle(200);
  expect(h.dialogTitle()).toBe("Game Over");
  expect(h.sounds).toEqual([]);
  await h.answer("yes");
  await h.idle(200);
  expect(h.drawnAt(919, 38)).toBe(face("4S"));
});

test("a finished run turns over the card under it, and dealing can finish runs", async () => {
  const columns = [
    [down("9H"), ...run().slice(0, 12)],
    [up("AS")],
    ...Array.from({ length: 8 }, () => [up("5D")]),
  ];
  const h = await open({
    settings: { animate: false, loadAtStart: true },
    storage: { spiderSavedGame: savedGame({ columns }) },
    start: null,
  });
  await h.drag([140, 20], [40, 340]);
  expect(h.drawnAt(28, 10)).toBe(face("9H"));
  expect(h.score()).toBe("Spider Solitaire. Score: 599. Moves: 1.");
  expect(await h.menu("game", "undo")).toBeFalse();
  // A dealt ace can finish a run too.
  const dealt = [
    run().slice(0, 12),
    ...Array.from({ length: 9 }, () => [up("9D")]),
  ];
  const deal = await open({
    settings: { animate: true, loadAtStart: true },
    storage: {
      spiderSavedGame: savedGame({
        columns: dealt,
        stock: [card("AS"), ...Array.from({ length: 9 }, () => card("2C"))],
      }),
    },
    start: null,
  });
  await deal.click([925, 650]);
  await deal.idle(200);
  expect(deal.drawnAt(28, 586)).toBe(face("KS"));
  expect(deal.drawnAt(28, 10)).toBe(EMPTY);
  expect(deal.score()).toBe("Spider Solitaire. Score: 600. Moves: 0.");
});

test("New Game and Restart ask once a card has moved, and leaving counts a loss", async () => {
  const h = await open();
  // Nothing moved yet: F2 deals straight away.
  await h.key("F2");
  expect(h.dialog()).toBeUndefined();
  expect(await h.menu("game", "restart")).toBeTrue();
  expect(h.dialog()).toBeUndefined();
  await h.drag([640, 60], [40, 80]);
  await h.key("n", { ctrlKey: true });
  expect(h.dialog().textContent).toContain(
    "Are you sure you want to start a new game?",
  );
  // spider.exe's questions default to No.
  expect(h.dialog().querySelector(".xp-btn.default").dataset.action).toBe("no");
  await h.answer("no");
  expect(h.drawnAt(28, 73)).toBe(face("5S"));
  await h.menu("game", "restart");
  expect(h.dialog().textContent).toContain(
    "Are you sure you want to restart this game from the beginning?",
  );
  await h.answer("no");
  await h.menu("game", "restart");
  await h.answer("yes");
  expect(h.drawnAt(28, 73)).toBeUndefined();
  expect(h.drawnAt(622, 38)).toBe(face("5S"));
  expect(h.stored().stats.easy).toMatchObject({
    losses: 1,
    current: 1,
    winning: false,
    mostLosses: 1,
  });
  // A deal counts as playing too.
  await h.key("d");
  await h.key("F2");
  await h.answer("yes");
  expect(h.stored().stats.easy.losses).toBe(2);
  expect(h.stored().stats.easy.mostLosses).toBe(2);
});

test("Difficulty deals one, two or four suits, asking to save a game in play", async () => {
  const h = await open({ start: "medium" });
  const suitsShown = () =>
    new Set(
      h.frames
        .at(-1)
        .map(([image]) => image)
        .filter((image) => image.includes("/cards/"))
        .map((image) =>
          Math.floor((Number(image.match(/(\d+)\.png/)[1]) - 1) / 13),
        ),
    );
  expect([...suitsShown()].every((suit) => suit >= 2)).toBeTrue();
  expect(h.stored().suits).toBe(2);
  await h.key("F3");
  expect(h.dialogTitle()).toBe("Difficulty");
  expect(h.dialog().querySelectorAll(".xp-template-image")).toHaveLength(7);
  const radios = () => [...h.dialog().querySelectorAll('input[type="radio"]')];
  expect(radios()[1].checked).toBeTrue();
  radios()[2].checked = true;
  await h.answer("cancel");
  expect(h.stored().suits).toBe(2);
  await h.key("F3");
  radios()[2].checked = true;
  await h.answer("ok");
  await h.idle();
  expect(h.stored().suits).toBe(4);
  // Once a card has moved, Difficulty offers to save first.
  const game = await open();
  await game.drag([640, 60], [40, 80]);
  await game.key("F3");
  expect(game.dialog().textContent).toContain(
    "Do you want to save this game before closing it?",
  );
  expect(game.dialog().querySelector(".xp-btn.default").dataset.action).toBe(
    "cancel",
  );
  await game.answer("cancel");
  expect(game.dialog()).toBeUndefined();
  await game.key("F3");
  await game.answer("no");
  expect(game.dialogTitle()).toBe("Difficulty");
  await game.answer("cancel");
  await game.key("F3");
  await game.answer("yes");
  expect(game.dialogTitle()).toBe("Difficulty");
  expect(
    JSON.parse(game.s.window.localStorage.getItem("spiderSavedGame")).moves,
  ).toBe(1);
  await game.answer("ok");
  await game.idle();
  expect(game.stored().stats.easy.losses).toBe(1);
});

test("Statistics shows each difficulty's record and resets it", async () => {
  const stats = {
    easy: {
      high: 900,
      wins: 3,
      losses: 1,
      mostWins: 2,
      mostLosses: 1,
      current: 2,
      winning: true,
    },
    medium: { high: -5, wins: 1.5, losses: "x", winning: "yes" },
  };
  const h = await open({ settings: { animate: false, stats } });
  await h.key("F4");
  expect(h.dialogTitle()).toBe("Spider Statistics");
  const lines = () =>
    [...h.dialog().querySelectorAll(".spider-stats-text")].map(
      (line) => line.textContent,
    );
  expect(lines()).toEqual([
    "900",
    "Wins:3",
    "Losses:1",
    "Win Rate:75 %",
    "Most Wins:2",
    "Most Losses:1",
    "Current:2 Wins",
  ]);
  const tab = (name) =>
    h.dialog().querySelector(`.spider-stats-tabs [data-tab="${name}"]`);
  expect(tab("easy").getAttribute("aria-selected")).toBe("true");
  tab("medium").click();
  // Unreadable records count from zero.
  expect(lines()).toEqual([
    "0",
    "Wins:0",
    "Losses:0",
    "Win Rate:0 %",
    "Most Wins:0",
    "Most Losses:0",
    "Current:0 Losses",
  ]);
  await h.answer("reset");
  expect(h.dialog().textContent).toContain(
    "Are you sure you want to reset all game statistics?",
  );
  await h.answer("no");
  tab("easy").click();
  expect(lines()[1]).toBe("Wins:3");
  await h.answer("reset");
  await h.answer("yes");
  // The game in play keeps its score as the high score.
  expect(lines()[0]).toBe("500");
  expect(lines()[1]).toBe("Wins:0");
  await h.answer("ok");
  expect(h.dialog()).toBeUndefined();
  expect(h.stored().stats.easy.wins).toBe(0);
});

test("Options saves spider.exe's six settings, and sound effects follow them", async () => {
  const h = await open({ settings: {} });
  await h.key("F5");
  expect(h.dialogTitle()).toBe("Spider Options");
  const boxes = () => [
    ...h.dialog().querySelectorAll('input[type="checkbox"]'),
  ];
  expect(boxes().map((box) => box.checked)).toEqual([
    true,
    false,
    false,
    true,
    true,
    true,
  ]);
  boxes()[5].checked = false;
  await h.answer("cancel");
  expect(h.stored().sound).toBeTrue();
  await h.key("F5");
  boxes().forEach((box) => {
    box.checked = !box.checked;
  });
  await h.answer("ok");
  expect(h.stored()).toMatchObject({
    animate: false,
    saveOnExit: true,
    loadAtStart: true,
    promptSave: false,
    promptLoad: false,
    sound: false,
  });
  h.sounds.length = 0;
  await h.drag([640, 60], [40, 80]);
  expect(h.sounds).toEqual([]);
});

test("About Spider shows its art and copyright; Contents does nothing", async () => {
  const h = await open();
  await h.menu("help", "about");
  expect(h.dialogTitle()).toBe("About Spider");
  expect(h.dialog().querySelector(".spider-about-art").src).toContain(
    "assets/xp/spider/About.png",
  );
  expect(h.dialog().querySelector(".spider-about-text").textContent).toBe(
    "© 1998-2000 Microsoft Corporation.  \nAll rights reserved.",
  );
  await h.answer("ok");
  await h.key("F1");
  await h.menu("help", "contents");
  expect(h.dialog()).toBeUndefined();
});

test("games save and open, asking before they replace or discard one", async () => {
  const h = await open();
  expect(await h.menu("game", "open")).toBeFalse();
  await h.drag([640, 60], [40, 80]);
  await h.key("s", { ctrlKey: true });
  expect(h.dialog()).toBeUndefined();
  expect(await h.menu("game", "open")).toBeTrue();
  // Open asks before discarding the game in play.
  expect(h.dialog().textContent).toContain(
    "Are you sure you want to discard the game you are currently playing, and load your previously saved game?",
  );
  await h.answer("no");
  await h.drag([930, 60], [40, 110]);
  expect(h.drawnAt(28, 101)).toBe(face("4S"));
  // Saving again asks before replacing the saved game.
  await h.menu("game", "save");
  expect(h.dialog().textContent).toContain(
    "A saved game already exists.  Are you sure you want to replace your previously saved game with your current game?",
  );
  await h.answer("no");
  await h.key("o", { ctrlKey: true });
  await h.answer("yes");
  expect(h.drawnAt(28, 101)).toBeUndefined();
  expect(h.drawnAt(28, 73)).toBe(face("5S"));
  expect(h.score()).toBe("Spider Solitaire. Score: 499. Moves: 1.");
  expect(await h.menu("game", "undo")).toBeFalse();
  // A save that storage refuses says so.
  const storage = h.s.window.localStorage;
  Object.defineProperty(h.s.window, "localStorage", {
    configurable: true,
    value: {
      getItem: (name) => storage.getItem(name),
      setItem: () => {
        throw new Error("full");
      },
    },
  });
  await h.menu("game", "save");
  await h.answer("yes");
  expect(h.dialog().textContent).toContain("Unable to save game.");
  await h.answer("ok");
});

test("Difficulty keeps the current game when its save is cancelled or fails", async () => {
  const h = await open({ storage: { spiderSavedGame: savedGame() } });
  await h.drag([640, 60], [40, 80]);
  await h.key("F3");
  await h.answer("yes");
  await h.answer("no");
  expect(h.dialog()).toBeUndefined();
  expect(h.score()).toBe("Spider Solitaire. Score: 499. Moves: 1.");
  const storage = h.s.window.localStorage;
  Object.defineProperty(h.s.window, "localStorage", {
    configurable: true,
    value: {
      getItem: (name) => storage.getItem(name),
      setItem: () => {
        throw new Error("full");
      },
    },
  });
  await h.key("F3");
  await h.answer("yes");
  await h.answer("yes");
  expect(h.dialog().textContent).toContain("Unable to save game.");
  await h.answer("ok");
  expect(h.dialog()).toBeUndefined();
  expect(h.score()).toBe("Spider Solitaire. Score: 499. Moves: 1.");
});

test("releasing a card outside Spider's board ends the drag", async () => {
  const h = await open();
  h.fire("mousedown", [640, 60]);
  h.fire("mousemove", [500, 400]);
  h.s.document.dispatchEvent(
    new h.s.window.MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 1100,
      clientY: 720,
    }),
  );
  await h.idle();
  await h.drag([640, 60], [40, 80]);
  expect(h.score()).toBe("Spider Solitaire. Score: 499. Moves: 1.");
});

test("releasing a right-button peek outside Spider's board allows the next drag", async () => {
  const h = await open();
  await h.drag([640, 60], [40, 80]);
  h.fire("mousedown", [40, 50], { button: 2, buttons: 2 });
  await h.idle();
  expect(h.frames.at(-1).at(-1)).toEqual([face("6S"), 28, 45]);
  h.s.document.dispatchEvent(
    new h.s.window.MouseEvent("mouseup", {
      bubbles: true,
      button: 2,
      clientX: 1100,
      clientY: 720,
    }),
  );
  await h.idle();
  expect(h.frames.at(-1).at(-1)).not.toEqual([face("6S"), 28, 45]);
  await h.drag([40, 50], [140, 80]);
  expect(h.score()).toBe("Spider Solitaire. Score: 498. Moves: 2.");
  expect(h.drawnAt(127, 73)).toBe(face("6S"));
  expect(h.drawnAt(127, 101)).toBe(face("5S"));
});

test("damaged saves don't open, and odd settings fall back to spider.exe's", async () => {
  const bad = [
    "{",
    "null",
    savedGame({ suits: 3 }),
    savedGame({ seed: "x" }),
    savedGame({ columns: [] }),
    savedGame({ columns: Array.from({ length: 10 }, () => "x") }),
    savedGame({
      columns: Array.from({ length: 10 }, () => [{ card: 60, up: true }]),
    }),
    savedGame({ stock: "x" }),
    savedGame({ stock: [1, 2, 3] }),
    savedGame({ stock: Array.from({ length: 10 }, () => 99) }),
    savedGame({ completed: "x" }),
    savedGame({ completed: [7] }),
    savedGame({ moves: "x" }),
    savedGame({ score: null }),
  ];
  for (const save of bad) {
    const h = await open({
      settings: { loadAtStart: true, suits: 3, animate: "x" },
      storage: { spiderSavedGame: save },
      start: null,
    });
    // Without a readable save, Spider starts on Difficulty.
    expect(h.dialogTitle()).toBe("Difficulty");
  }
  const h = await open({
    storage: { spiderSettings: "{" },
    settings: undefined,
    start: null,
  });
  expect(h.dialogTitle()).toBe("Difficulty");
});

test("closing asks to save a game in play, or saves it on its own", async () => {
  const h = await open();
  const close = async () => {
    h.win.querySelector(".close-btn").click();
    await h.idle();
  };
  await h.drag([640, 60], [40, 80]);
  await close();
  expect(h.dialog().textContent).toContain(
    "Do you want to save this game before closing it?",
  );
  await h.answer("cancel");
  expect(h.win.isConnected).toBeTrue();
  await close();
  await h.answer("yes");
  expect(h.win.isConnected).toBeFalse();
  expect(
    JSON.parse(h.s.window.localStorage.getItem("spiderSavedGame")).moves,
  ).toBe(1);
  // No closes without saving and counts a loss.
  const lose = await open();
  await lose.drag([640, 60], [40, 80]);
  lose.win.querySelector(".close-btn").click();
  await lose.idle();
  await lose.answer("no");
  expect(lose.win.isConnected).toBeFalse();
  expect(lose.stored().stats.easy.losses).toBe(1);
  // A declined replace keeps the window open.
  const keep = await open({
    storage: { spiderSavedGame: savedGame() },
  });
  await keep.drag([640, 60], [40, 80]);
  keep.win.querySelector(".close-btn").click();
  await keep.idle();
  await keep.answer("yes");
  await keep.answer("no");
  expect(keep.win.isConnected).toBeTrue();
  // Save on exit saves quietly; when it can't, the game counts as lost.
  const auto = await open({
    settings: { animate: false, saveOnExit: true, promptSave: false },
  });
  await auto.drag([640, 60], [40, 80]);
  auto.win.querySelector(".close-btn").click();
  await auto.idle();
  expect(auto.win.isConnected).toBeFalse();
  const full = await open({
    settings: { animate: false, saveOnExit: true },
    storage: { spiderSavedGame: savedGame() },
  });
  await full.drag([640, 60], [40, 80]);
  full.win.querySelector(".close-btn").click();
  await full.idle();
  await full.answer("no");
  expect(full.win.isConnected).toBeFalse();
  expect(full.stored().stats.easy.losses).toBe(1);
  // Before any game, or after a win, Spider just closes.
  const fresh = await open({ start: null });
  await fresh.answer("cancel");
  fresh.win.querySelector(".close-btn").click();
  await fresh.idle();
  expect(fresh.win.isConnected).toBeFalse();
});

test("Esc hides Spider, and closes an open menu first", async () => {
  const h = await open();
  h.menuButton("game").click();
  await h.key("Escape");
  expect(h.win.querySelector(".tm-menu")).toBeNull();
  expect(h.win.style.display).not.toBe("none");
  h.menuButton("game").click();
  await h.key("d");
  expect(h.win.querySelector(".tm-menu")).not.toBeNull();
  // A second click or a click outside closes the menu.
  h.menuButton("game").click();
  expect(h.win.querySelector(".tm-menu")).toBeNull();
  h.menuButton("help").click();
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(h.win.querySelector(".tm-menu")).toBeNull();
  // Keys do nothing behind a dialog.
  await h.key("F5");
  await h.key("F4");
  expect(h.dialogTitle()).toBe("Spider Options");
  await h.answer("cancel");
  // Alt+F4 closes, asking to save the game in play; other keys do nothing.
  await h.key("F4", { altKey: true });
  expect(h.dialog().textContent).toContain(
    "Do you want to save this game before closing it?",
  );
  await h.answer("cancel");
  await h.key("q");
  expect(h.dialog()).toBeUndefined();
  await h.key("Escape");
  expect(h.win.style.display).toBe("none");
});

test("cards that fail to load, or a missing font, say so", async () => {
  const art = await open({ failImages: true, start: null });
  expect(art.dialog().textContent).toContain("Spider's cards didn't load.");
  const font = await open({ failFont: true, start: null });
  expect(font.dialog().textContent).toContain("The System font didn't load.");
});

test("columns squeeze to fit above the stock, and narrow windows overlap them", async () => {
  const columns = [
    Array.from({ length: 30 }, (_, index) => up(index % 2 ? "5S" : "6H")),
    ...Array.from({ length: 9 }, () => []),
  ];
  const h = await open({
    settings: { animate: false, loadAtStart: true },
    storage: { spiderSavedGame: savedGame({ columns }) },
    start: null,
    width: 600,
    height: 400,
  });
  // 400 - 106 leaves 294 pixels: the step shrinks until the last card fits
  // 16 pixels above the stock row.
  const step = (294 - 16 - 10) / 29;
  expect(h.drawnAt(0, 10 + 29 * Math.floor(step))).toBe(face("5S"));
  // The columns overlap by 10 pixels: a column starts every 61.
  expect(h.drawnAt(61, 10)).toBe(EMPTY);
  // A drop past the last column's right edge still finds it.
  // Too short a table leaves the steps alone.
  h.s.window.cardGameResize?.();
});

test("a phone-narrow table scales all ten columns down instead of cutting them off", async () => {
  const columns = [...Array.from({ length: 9 }, () => []), [up("KS")]];
  const h = await open({
    settings: { animate: false, loadAtStart: true },
    storage: { spiderSavedGame: savedGame({ columns }) },
    start: null,
    width: 390,
    height: 700,
  });
  // The deal is laid out 732 wide, a column every 73, and drawn scaled down.
  expect(h.drawnAt(2, 10)).toBe(EMPTY);
  expect(h.drawnAt(659, 10)).toBe(face("KS"));
});

test("empty columns take any card, and hints point at them", async () => {
  const columns = [
    [up("9H")],
    [up("4C")],
    ...Array.from({ length: 8 }, () => []),
  ];
  const h = await open({
    settings: { animate: false, loadAtStart: true, suits: 4 },
    storage: { spiderSavedGame: savedGame({ columns }) },
    start: null,
  });
  await h.click([512, 640]);
  expect(h.sounds).toEqual(["Hint.wav"]);
  // A lone card moves to an empty column, leaving its slot empty.
  await h.drag([140, 20], [240, 20]);
  expect(h.drawnAt(226, 10)).toBe(face("4C"));
  expect(h.drawnAt(127, 10)).toBe(EMPTY);
  // Presses above the cards, or on empty slots, pick up nothing.
  h.sounds.length = 0;
  await h.click([40, 5]);
  for (const y of [50, 150]) {
    h.fire("mousedown", [140, y], { button: 2, buttons: 2 });
    h.fire("mouseup", [140, y], { button: 2, buttons: 0 });
  }
  await h.idle();
  expect(h.sounds).toEqual([]);
});

test("Undo keeps spider.exe's last 150 moves", async () => {
  const columns = [
    [up("6S")],
    [up("6H")],
    [up("5S")],
    ...Array.from({ length: 7 }, () => [up("KD")]),
  ];
  const h = await open({
    settings: { animate: false, loadAtStart: true, sound: false },
    storage: { spiderSavedGame: savedGame({ columns }) },
    start: null,
  });
  for (let move = 0; move < 151; move += 1) {
    // The 5 of spades goes to the 6 of hearts, then back and forth
    // between the two sixes.
    const point = move === 0 ? [240, 20] : move % 2 ? [140, 50] : [40, 50];
    const to = move % 2 ? [40, 60] : [140, 60];
    h.fire("mousedown", point);
    h.fire("mousemove", to);
    h.fire("mouseup", to);
    await h.settle(2);
  }
  await h.idle();
  expect(h.score()).toBe("Spider Solitaire. Score: 349. Moves: 151.");
  for (let move = 0; move < 150; move += 1) {
    await h.key("z", { ctrlKey: true });
  }
  expect(await h.menu("game", "undo")).toBeFalse();
  expect(h.score()).toBe("Spider Solitaire. Score: 199. Moves: 301.");
});

test("nothing happens while cards fly, and closing mid-flight stops them", async () => {
  const h = await open({ settings: {}, wait: false });
  // The opening deal is still flying.
  await h.key("F5");
  h.fire("mousedown", [40, 50]);
  h.fire("mouseup", [40, 50]);
  const score = h.score();
  const sounds = h.sounds.length;
  h.s.document.dispatchEvent(
    new h.s.window.MouseEvent("mouseup", { bubbles: true, button: 0 }),
  );
  expect(h.score()).toBe(score);
  expect(h.sounds).toHaveLength(sounds);
  expect(h.dialog()).toBeUndefined();
  h.win.querySelector(".close-btn").click();
  h.dialog().querySelector('[data-action="no"]').click();
  await h.idle(60);
  expect(h.win.isConnected).toBeFalse();
  // Closing mid-deal.
  const dealing = await open({ settings: {} });
  dealing.fire("mousedown", [925, 650]);
  dealing.fire("mouseup", [925, 650]);
  dealing.win.querySelector(".close-btn").click();
  dealing.dialog().querySelector('[data-action="no"]').click();
  await dealing.idle(60);
  expect(dealing.win.isConnected).toBeFalse();
  // Closing while a run flies home.
  const runs = await open({
    settings: { loadAtStart: true },
    storage: {
      spiderSavedGame: savedGame({
        columns: [
          run().slice(0, 12),
          [up("AS")],
          ...Array.from({ length: 8 }, () => [up("9D")]),
        ],
      }),
    },
    start: null,
  });
  runs.fire("mousedown", [140, 20]);
  runs.fire("mousemove", [40, 330]);
  runs.fire("mouseup", [40, 330]);
  await runs.settle(3);
  runs.win.querySelector(".close-btn").click();
  runs.dialog().querySelector('[data-action="no"]').click();
  await runs.idle(60);
  expect(runs.win.isConnected).toBeFalse();
});

test("streaks continue, and a won game's table ignores clicks until the next game", async () => {
  const h = await open({
    settings: {
      animate: false,
      loadAtStart: true,
      stats: { easy: { wins: 2, current: 2, winning: true, mostWins: 2 } },
    },
    storage: { spiderSavedGame: nearlyWon() },
    start: null,
  });
  await h.drag([140, 20], [40, 330]);
  expect(h.stored().stats.easy).toMatchObject({ current: 3, mostWins: 3 });
  // Sparks die out one by one before a burst starts again.
  h.clock.now += 3900;
  await h.idle(5);
  // Clicks and presses do nothing behind the fireworks.
  h.sounds.length = 0;
  h.fire("mousedown", [512, 640]);
  h.fire("mouseup", [512, 640]);
  await h.answer("no");
  // Statistics stops the fireworks; the table still waits for a new game.
  await h.key("F4");
  await h.answer("ok");
  await h.click([512, 640]);
  expect(h.sounds).toEqual([]);
  // Closing a finished game asks nothing.
  const done = await open({
    settings: { animate: false, loadAtStart: true },
    storage: { spiderSavedGame: nearlyWon() },
    start: null,
  });
  await done.drag([140, 20], [40, 330]);
  await done.answer("no");
  done.win.querySelector(".close-btn").click();
  await done.idle();
  expect(done.win.isConnected).toBeFalse();
});

test("a loss after a win starts a losing streak, and Exit closes", async () => {
  const h = await open({
    settings: {
      animate: false,
      stats: { easy: { current: 4, winning: true } },
    },
  });
  await h.drag([640, 60], [40, 80]);
  await h.key("F2");
  await h.answer("yes");
  expect(h.stored().stats.easy).toMatchObject({ current: 1, winning: false });
  await h.menu("game", "exit");
  await h.answer("no");
  expect(h.win.isConnected).toBeFalse();
});

test("before any game, F2 deals and Reset leaves the high score at zero", async () => {
  const h = await open({
    settings: { animate: false, stats: { easy: { high: 700 } } },
    start: null,
  });
  await h.answer("cancel");
  await h.key("F4");
  await h.answer("reset");
  await h.answer("yes");
  expect(h.dialog().querySelector(".spider-stats-text").textContent).toBe("0");
  await h.answer("ok");
  await h.key("F2");
  expect(h.dialog()).toBeUndefined();
  expect(h.drawnAt(919, 38)).toBe(face("4S"));
});

test("tiny windows leave the columns as they are", async () => {
  const columns = [
    [...Array.from({ length: 10 }, () => down("2D")), up("6H"), up("5S")],
    ...Array.from({ length: 9 }, () => []),
  ];
  const storage = { spiderSavedGame: savedGame({ columns }) };
  const settings = { animate: false, loadAtStart: true };
  // 200 pixels squeeze the step down to nothing.
  const small = await open({ settings, storage, start: null, height: 200 });
  // With a step of 0, the 5 lies right on the 6.
  expect(small.drawnAt(28, 80)).toBe(face("5S"));
  expect(small.drawnAt(28, 81)).toBeUndefined();
  // Under 107 pixels, spider.exe doesn't squeeze at all.
  const tiny = await open({ settings, storage, start: null, height: 100 });
  expect(tiny.drawnAt(28, 80 + 28)).toBe(face("5S"));
});
