// @ts-nocheck -- Solitaire's window, played through Happy DOM.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { checkMenuBar } from "./helpers/menu-bar";
import { face, recordCardCanvas } from "./helpers/card-canvas";

afterEach(cleanupShells);

const BACK = "assets/xp/cards/backs/56.png";
// The XP VM dealt seed 30162; this clock reproduces it.
const DEAL_TIME = 1790014930000;
const TABLEAU = [11, 93, 175, 257, 339, 421, 503];

const open = async ({
  settings = {},
  storage = {},
  failImages = false,
  time = DEAL_TIME,
  width = 585,
  height = 384,
} = {}) => {
  let frames;
  const s = await login(
    await loadShell({
      initialStorage: {
        solitaireSettings: JSON.stringify({ back: 56, ...settings }),
        ...storage,
      },
      beforeScripts: (window) => {
        frames = recordCardCanvas(window, {
          board: "solitaire-board",
          width,
          height,
          failImages,
        });
        window.Date.now = () => time;
      },
    }),
  );
  s.window.history.replaceState(null, "", "#solitaire");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await flushShell();
  await flushShell();
  const win = s.document.querySelector('.xp-window[data-game="__solitaire"]');
  const canvas = win.querySelector("canvas");
  const settle = async (times = 6) => {
    for (let index = 0; index < times; index += 1) await flushShell();
  };
  await settle();
  const fire = (type, [x, y], init = {}) =>
    canvas.dispatchEvent(
      new s.window.MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
        detail: 1,
        ...init,
      }),
    );
  const press = async (point, init = {}) => {
    canvas.dispatchEvent(
      new s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
    fire("mousedown", point, init);
    await settle();
  };
  const drag = async (from, to) => {
    fire("mousedown", from);
    fire("mousemove", [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
    fire("mousemove", to);
    fire("mouseup", to);
    await settle();
  };
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
  const drawnAt = (x, y) =>
    frames
      .at(-1)
      .filter(([, left, top]) => left === x && top === y)
      .map(([image]) => image)
      .at(-1);
  const menu = async (name, command) => {
    win.querySelector(`[data-solitaire-menu="${name}"]`).click();
    const item = win.querySelector(`.tm-menu [data-command="${command}"]`);
    if (item.disabled) {
      win.querySelector(`[data-solitaire-menu="${name}"]`).click();
      return false;
    }
    item.click();
    await settle();
    return true;
  };
  const score = () => win.querySelector(".solitaire-score").textContent;
  const help = () => win.querySelector(".solitaire-help").textContent;
  return {
    s,
    win,
    canvas,
    frames,
    settle,
    fire,
    press,
    drag,
    key,
    dialog,
    answer,
    drawnAt,
    menu,
    score,
    help,
  };
};

const DECK_TOP = [50, 57];

test("the deal draws at full size, and scales down to fit a phone", async () => {
  const full = await open();
  expect(full.frames.transform).toEqual([1, 0, 0, 1, 0, 0]);
  // 390 pixels show sol.exe's 585 pixel table at two thirds size, cards
  // where they always are, and taps land on the scaled cards.
  const phone = await open({ width: 390, height: 400 });
  expect(phone.frames.transform[0]).toBeCloseTo(390 / 585, 6);
  expect(phone.drawnAt(503, 125)).toBe(face("7S"));
  // 12 pixels in is 18 on the table: the deck, whose top card starts at 15.
  await phone.press([12, 40]);
  expect(phone.drawnAt(121, 7)).toBe(face("7C"));
});

test("a new deal cancels a card's pending slide back", async () => {
  const h = await open();
  const pending = [];
  h.s.window.requestAnimationFrame = (callback) => pending.push(callback);
  await h.drag([45, 157], [400, 330]);
  expect(pending.length).toBeGreaterThan(0);
  await h.key("F2");
  while (pending.length) {
    pending.shift()();
    await h.settle(1);
  }
  expect(h.drawnAt(11, 107)).toBe(face("QD"));
  expect(h.score()).toBe("Score: 0 Time: 0");
});

test("repeated Escape and pointer events leave one slide back running", async () => {
  const h = await open();
  const pending = [];
  h.s.window.requestAnimationFrame = (callback) => pending.push(callback);
  h.fire("mousedown", [45, 157]);
  h.fire("mousemove", [400, 330]);
  await h.key("Escape");
  expect(pending).toHaveLength(1);
  const frameCount = h.frames.length;
  await h.key("Escape");
  h.fire("mousemove", [500, 350]);
  h.fire("mouseup", [500, 350]);
  expect(pending).toHaveLength(1);
  expect(h.frames).toHaveLength(frameCount);
  while (pending.length) {
    pending.shift()();
    await h.settle(1);
  }
  expect(h.drawnAt(11, 107)).toBe(face("QD"));
  await h.press(DECK_TOP);
  expect(h.drawnAt(121, 7)).toBe(face("7C"));
  expect(h.score()).toBe("Score: 0 Time: 0");
});

test("releasing a card outside the board ends the drag", async () => {
  const h = await open({ settings: { outline: true } });
  h.fire("mousedown", [45, 157]);
  h.fire("mousemove", [400, 330]);
  h.s.document.dispatchEvent(
    new h.s.window.MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 700,
      clientY: 450,
    }),
  );
  await h.settle();
  await h.press(DECK_TOP);
  expect(h.drawnAt(121, 7)).toBe(face("7C"));
});

test("Solitaire deals on opening, like sol.exe", async () => {
  const h = await open();
  expect(h.win.querySelector(".title-text").textContent).toBe("Solitaire");
  expect(h.score()).toBe("Score: 0 Time: 0");
  // The 24 cards left stack 2 pixels right and 1 down every ten cards.
  expect(h.drawnAt(11, 5)).toBe(BACK);
  expect(h.drawnAt(15, 7)).toBe(BACK);
  expect(h.drawnAt(257, 5)).toBe("assets/xp/cards/Empty.png");
  expect(TABLEAU.map((x, index) => h.drawnAt(x, 107 + 3 * index))).toEqual(
    ["QD", "KC", "8S", "5S", "5C", "AS", "7S"].map((name) => face(name)),
  );
  expect(h.drawnAt(93, 107)).toBe(BACK);
  // The clock waits for the first press.
  await h.s.advanceTime(1000);
  expect(h.score()).toBe("Score: 0 Time: 0");
});

test("drawing fans three cards, and older draws collapse into the waste", async () => {
  const h = await open();
  await h.press(DECK_TOP);
  expect([h.drawnAt(93, 5), h.drawnAt(107, 6), h.drawnAt(121, 7)]).toEqual([
    face("TH"),
    face("6H"),
    face("7C"),
  ]);
  await h.press(DECK_TOP);
  expect([h.drawnAt(93, 5), h.drawnAt(107, 6), h.drawnAt(121, 7)]).toEqual([
    face("JS"),
    face("3S"),
    face("QH"),
  ]);
  // Undo puts the last draw back.
  await h.menu("game", "undo");
  expect(h.drawnAt(121, 7)).toBe(face("7C"));
  expect(await h.menu("game", "undo")).toBeFalse();
  // A press beside the deck or on the table draws nothing.
  await h.press([88, 50]);
  await h.press([300, 330]);
  expect(h.drawnAt(121, 7)).toBe(face("7C"));
});

test("cards drag between piles, double-clicks go home, and moves score", async () => {
  const h = await open();
  await h.press(DECK_TOP);
  await h.press(DECK_TOP);
  // The queen of hearts onto the king of clubs: +5.
  await h.drag([156, 57], [128, 160]);
  expect(h.drawnAt(93, 125)).toBe(face("QH"));
  expect(h.drawnAt(107, 6)).toBe(face("3S"));
  expect(h.score()).toBe("Score: 5 Time: 0");
  // The ace of spades home: +10.
  await h.press([456, 172], { detail: 2 });
  expect(h.drawnAt(257, 5)).toBe(face("AS"));
  expect(h.score()).toBe("Score: 15 Time: 0");
  // Turning over a face-down card: +5, and it can't be undone.
  await h.press([456, 169]);
  expect(h.drawnAt(421, 119)).not.toBe(BACK);
  expect(h.score()).toBe("Score: 20 Time: 0");
  expect(await h.menu("game", "undo")).toBeFalse();
  // A card dropped where it doesn't fit slides back.
  const pending = [];
  h.s.window.requestAnimationFrame = (callback) => pending.push(callback);
  await h.drag([45, 157], [400, 330]);
  expect(pending.length).toBeGreaterThan(0);
  while (pending.length) {
    pending.shift()();
    await h.settle(1);
  }
  await h.settle();
  expect(h.drawnAt(11, 107)).toBe(face("QD"));
  // Undo restores the last move and its score.
  await h.press([456, 172], { detail: 2 });
  await h.menu("game", "undo");
  // Double-clicking a card that can't go home does nothing.
  await h.press([45, 157], { detail: 2 });
  await h.press([300, 330], { detail: 2 });
  expect(h.drawnAt(11, 107)).toBe(face("QD"));
});

test("the right button sends every pile's top card home", async () => {
  const h = await open();
  await h.press([400, 330], { button: 2 });
  expect(h.drawnAt(257, 5)).toBe(face("AS"));
  expect(h.score()).toBe("Score: 10 Time: 0");
  await h.press([400, 330], { button: 1 });
  h.canvas.dispatchEvent(
    new h.s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
});

test("Draw Three recycles freely but costs 20 points after the third pass", async () => {
  const h = await open();
  await h.press([400, 330], { button: 2 });
  for (let pass = 1; pass <= 4; pass += 1) {
    for (let draw = 0; draw < 8; draw += 1) await h.press(DECK_TOP);
    expect(h.drawnAt(11, 5)).toBe("assets/xp/cards/O.png");
    await h.press([46, 50]);
  }
  expect(h.score()).toBe("Score: 0 Time: 0");
  // With nothing in the waste, the empty deck does nothing.
  const empty = await open();
  for (let draw = 0; draw < 8; draw += 1) await empty.press(DECK_TOP);
  await empty.press([88, 104]);
});

test("Vegas counts dollars, limits passes, and Cumulative Score carries over", async () => {
  const h = await open({ settings: { scoring: "vegas", cumulative: true } });
  expect(h.score()).toBe("Score: -$52 Time: 0");
  expect(h.win.querySelector(".solitaire-score .negative")).not.toBeNull();
  // Three passes with Draw Three, then the deck shows an X.
  for (let pass = 0; pass < 3; pass += 1) {
    for (let draw = 0; draw < 8; draw += 1) await h.press(DECK_TOP);
    await h.press([46, 50]);
  }
  expect(h.drawnAt(11, 5)).toBe("assets/xp/cards/X.png");
  await h.press([400, 330], { button: 2 });
  // Two aces go home: +$10.
  expect(h.score()).toBe("Score: -$42 Time: 0");
  await h.key("F2");
  expect(h.score()).toBe("Score: -$94 Time: 0");

  const one = await open({ settings: { scoring: "vegas", draw: 1 } });
  for (let draw = 0; draw < 24; draw += 1) await one.press(DECK_TOP);
  expect(one.drawnAt(11, 5)).toBe("assets/xp/cards/X.png");
  await one.press([46, 50]);
  expect(one.drawnAt(93, 5)).toBeDefined();

  const standardOne = await open({ settings: { draw: 1, timed: false } });
  expect(standardOne.score()).toBe("Score: 0 ");
  for (let draw = 0; draw < 24; draw += 1) await standardOne.press(DECK_TOP);
  await standardOne.press([46, 50]);

  const none = await open({ settings: { scoring: "none" } });
  expect(none.score()).toBe("Time: 0");
});

test("timed games lose 2 points every 10 seconds and win a time bonus", async () => {
  const h = await open();
  await h.press(DECK_TOP);
  await h.press(DECK_TOP);
  await h.drag([156, 57], [128, 160]);
  await h.press([456, 172], { detail: 2 });
  await h.s.advanceTime(10_000);
  expect(h.score()).toBe("Score: 13 Time: 10");
  // A minimized window stops the clock.
  h.win.style.display = "none";
  await h.s.advanceTime(5_000);
  expect(h.score()).toBe("Score: 13 Time: 10");
  h.win.style.display = "";
  await h.s.advanceTime(20_250);
  expect(h.score()).toBe("Score: 9 Time: 30");
  // Alt+Shift+2 wins: the bonus shows while the cards bounce.
  h.s.window.requestAnimationFrame = () => {};
  await h.key("2", { altKey: true, shiftKey: true, code: "Digit2" });
  expect(h.help()).toBe("Bonus: 23310  Press Esc or a mouse button to stop...");
  expect(h.score()).toBe("Score: 23319 Time: 30");
  // Esc stops the bouncing cards, then Deal Again? asks.
  await h.key("Escape");
  await h.s.advanceTime(0);
});

test("the winning cards bounce until done, then Deal Again? asks", async () => {
  const h = await open({ settings: { scoring: "none", timed: false } });
  let frame = 0;
  h.s.window.requestAnimationFrame = (callback) => {
    frame += 1;
    queueMicrotask(callback);
  };
  h.s.window.performance.now = () => frame * 1000;
  await h.key("2", { altKey: true, shiftKey: true, code: "Digit2" });
  for (let wait = 0; wait < 40 && !h.dialog(); wait += 1) await h.settle(4);
  expect(h.dialog().textContent).toContain("Deal Again?");
  expect(h.help()).toBe("");
  await h.answer("no");
  // The game is over: presses do nothing.
  await h.press(DECK_TOP);
  await h.key("2", { altKey: true, shiftKey: true, code: "Digit2" });
  await h.key("F2");
  await h.key("2", { altKey: true, shiftKey: true, code: "Digit2" });
  for (let wait = 0; wait < 40 && !h.dialog(); wait += 1) await h.settle(4);
  await h.answer("yes");
  expect(h.drawnAt(11, 107)).toBe(face("QD"));
  // A mouse press stops a win in progress.
  h.s.window.requestAnimationFrame = () => {};
  await h.key("2", { altKey: true, shiftKey: true, code: "Digit2" });
  await h.press([300, 300]);
  await h.key("a");
});

test("Options change the draw, scoring, timer, status bar and dragging", async () => {
  const h = await open();
  await h.menu("game", "options");
  const box = (id) =>
    h.dialog().querySelectorAll("input")[
      [
        "drawOne",
        "drawThree",
        "standard",
        "vegas",
        "none",
        "timed",
        "statusBar",
        "outline",
        "cumulative",
      ].indexOf(id)
    ];
  expect(box("drawThree").checked).toBeTrue();
  expect(box("cumulative").disabled).toBeTrue();
  box("vegas").checked = true;
  box("vegas").dispatchEvent(new h.s.window.Event("change"));
  expect(box("cumulative").disabled).toBeFalse();
  await h.answer("cancel");
  expect(h.score()).toBe("Score: 0 Time: 0");

  await h.menu("game", "options");
  box("drawOne").checked = true;
  box("statusBar").checked = false;
  box("outline").checked = true;
  await h.answer("ok");
  expect(h.win.querySelector(".solitaire-status").hidden).toBeTrue();
  await h.press(DECK_TOP);
  expect(h.drawnAt(93, 5)).toBeDefined();
  // Outline dragging shows a frame; the cards stay until dropped.
  await h.drag([456, 157], [400, 330]);
  h.fire("mousedown", [456, 157]);
  h.fire("mousemove", [292, 70]);
  h.fire("mousemove", [292, 60]);
  h.fire("mouseup", [292, 60]);
  await h.settle();
  // A status-bar-only change keeps the game.
  await h.menu("game", "options");
  box("statusBar").checked = true;
  await h.answer("ok");
  expect(h.win.querySelector(".solitaire-status").hidden).toBeFalse();
  expect(
    JSON.parse(h.s.window.localStorage.getItem("solitaireSettings")),
  ).toMatchObject({ draw: 1, outline: true, statusBar: true });
});

test("Deck picks one of cards.dll's twelve backs", async () => {
  const h = await open();
  await h.menu("game", "deck");
  const backs = () => [...h.dialog().querySelectorAll(".solitaire-back")];
  expect(backs()).toHaveLength(12);
  expect(backs()[6].classList.contains("selected")).toBeTrue();
  backs()[0].click();
  expect(backs()[0].classList.contains("selected")).toBeTrue();
  await h.answer("cancel");
  expect(h.drawnAt(11, 5)).toBe(BACK);
  await h.menu("game", "deck");
  backs()[1].click();
  await h.answer("ok");
  expect(h.drawnAt(11, 5)).toBe("assets/xp/cards/backs/55.png");
  await h.menu("game", "deck");
  backs()[0].click();
  backs()[0].dispatchEvent(new h.s.window.MouseEvent("dblclick"));
  await h.settle();
  expect(h.dialog()).toBeUndefined();
  expect(h.drawnAt(11, 5)).toBe("assets/xp/cards/backs/54.png");
});

test("menus show sol.exe's help in the status bar, About, and Exit", async () => {
  const h = await open();
  h.win.querySelector('[data-solitaire-menu="game"]').click();
  const deal = h.win.querySelector('.tm-menu [data-command="deal"]');
  deal.dispatchEvent(new h.s.window.PointerEvent("pointerenter"));
  expect(h.help()).toBe("Deal a new game");
  deal.dispatchEvent(new h.s.window.PointerEvent("pointerleave"));
  expect(h.help()).toBe("");
  h.win.querySelector('[data-solitaire-menu="game"]').click();
  h.win.querySelector('[data-solitaire-menu="help"]').click();
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(h.win.querySelector(".tm-menu")).toBeNull();
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  h.win.querySelector('[data-solitaire-menu="help"]').click();
  // A press on a title keeps the menus; one on the bar's empty part closes
  // them, like XP.
  h.win
    .querySelector('[data-solitaire-menu="help"]')
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
  await h.menu("help", "about");
  expect(h.dialog().textContent).toContain(
    "Developed for Microsoft by Wes Cherry",
  );
  await h.answer("ok");
  // Shortcuts wait while a dialog is open.
  await h.menu("game", "options");
  await h.key("F2");
  await h.answer("cancel");
  // Esc drops a drag in progress.
  h.fire("mousedown", [45, 157]);
  h.fire("mousemove", [300, 300]);
  await h.key("Escape");
  await h.key("F2");
  h.s.window.cardGameResize();
  await h.menu("game", "exit");
  expect(
    h.s.document.querySelector('.xp-window[data-game="__solitaire"]'),
  ).toBeNull();
});

test("missing cards and unreadable settings fall back gracefully", async () => {
  const h = await open({
    storage: { solitaireSettings: "not json" },
    failImages: true,
  });
  expect(h.dialog().textContent).toContain("The cards didn't load.");
  await h.answer("ok");
  expect(h.score()).toBe("Score: 0 Time: 0");
  h.s.window.localStorage.setItem = () => {
    throw new Error("full");
  };
  await h.menu("game", "deck");
  await h.answer("ok");
  const other = await open({ storage: { solitaireSettings: "[1]" } });
  expect(other.score()).toBe("Score: 0 Time: 0");
});

test("runs move between tableau piles, kings fill empty piles, and outline drags invert", async () => {
  const h = await open({ settings: { outline: true } });
  // The queen of diamonds onto the king of clubs empties the first pile.
  h.fire("mousedown", [46, 157]);
  h.fire("mousemove", [130, 160]);
  expect(h.frames.at(-1).length).toBeGreaterThan(0);
  h.fire("mouseup", [130, 175]);
  await h.settle();
  expect(h.drawnAt(93, 125)).toBe(face("QD"));
  // The king and queen move together onto the empty pile: no score.
  h.fire("mousedown", [128, 115]);
  h.fire("mousemove", [60, 115]);
  h.fire("mouseup", [46, 112]);
  await h.settle();
  expect([h.drawnAt(11, 107), h.drawnAt(11, 122)]).toEqual([
    face("KC"),
    face("QD"),
  ]);
  expect(h.score()).toBe("Score: 0 Time: 0");
  // A press that doesn't move drops nowhere, and moves without a drag do
  // nothing.
  h.fire("mousedown", [46, 125]);
  h.fire("mouseup", [46, 125]);
  h.fire("mousemove", [100, 100]);
  h.fire("mouseup", [100, 100]);
  h.fire("mouseup", [100, 100], { button: 2 });
  await h.settle();
  // Ctrl+Alt+Shift draws a single card.
  await h.press(DECK_TOP, { ctrlKey: true, altKey: true, shiftKey: true });
  expect(h.drawnAt(93, 5)).toBe(face("TH"));
  // A press passes over a face-down top card it doesn't touch.
  await h.press([456, 172], { detail: 2 });
  await h.press([538, 200]);
  await h.key("2", { altKey: true });
  // The waste's top card can't go home: nothing happens.
  await h.press([128, 55], { detail: 2 });
  await h.menu("game", "options");
  h.dialog().querySelectorAll("input")[1].checked = true;
  await h.answer("ok");
});

test("a new deal or closing the window stops the winning cards", async () => {
  const h = await open();
  const pending = [];
  h.s.window.requestAnimationFrame = (callback) => pending.push(callback);
  const pump = async (count) => {
    for (let index = 0; index < count && pending.length; index += 1) {
      pending.shift()();
      await h.settle(1);
    }
  };
  await h.key("2", { altKey: true, shiftKey: true, code: "Digit2" });
  // The table stays still while the cards bounce, even when resized.
  h.s.window.cardGameResize();
  await pump(3);
  // Esc stops the current card; the next pile sees the stop.
  await h.key("Escape");
  await pump(5);
  expect(h.dialog().textContent).toContain("Deal Again?");
  await h.answer("yes");
  // A new deal replaces a win in progress.
  await h.key("2", { altKey: true, shiftKey: true, code: "Digit2" });
  await pump(2);
  await h.menu("game", "deal");
  await pump(5);
  expect(h.dialog()).toBeUndefined();
  expect(h.drawnAt(11, 107)).toBe(face("QD"));
  await h.key("2", { altKey: true, shiftKey: true, code: "Digit2" });
  h.win.querySelector(".close-btn").click();
  await h.settle();
  await pump(3);
});

test("without saved settings, sol.exe's defaults and a random back apply", async () => {
  let frames;
  const s = await login(
    await loadShell({
      beforeScripts: (window) => {
        frames = recordCardCanvas(window, {
          board: "solitaire-board",
          width: 585,
          height: 384,
        });
        window.Math.random = () => 0.99;
        window.Date.now = () => DEAL_TIME;
      },
    }),
  );
  s.window.history.replaceState(null, "", "#solitaire");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  for (let index = 0; index < 8; index += 1) await flushShell();
  expect(frames.at(-1).find(([, x, y]) => x === 11 && y === 5)[0]).toBe(
    "assets/xp/cards/backs/65.png",
  );
});

test("Solitaire's menus follow XP's menu bar rules", async () => {
  const h = await open();
  await checkMenuBar({
    s: h.s,
    win: h.win,
    control: h.win.querySelector(".xp-solitaire"),
    accessKey: "g",
    settle: flushShell,
  });
});
