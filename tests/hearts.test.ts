// @ts-nocheck -- Hearts' window, played through Happy DOM.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { checkMenuBar } from "./helpers/menu-bar";
import { face, recordCardCanvas, siteFiles } from "./helpers/card-canvas";

afterEach(cleanupShells);

// Playing a whole game takes 7 to 10 seconds of CPU, more than Bun's 5 second
// default, which only `bun run test` raises (`--timeout 30000`).
setDefaultTimeout(30_000);

const BACK = "assets/xp/cards/backs/54.png";
// time(NULL) values whose first rand() is a game number: 714 and 10132
// were played in the XP VM; the third is a game the human wins.
const GAME_714 = 1790009753000;
const GAME_10132 = 1790012637000;
const WINNING_GAME = 1790009973000;
// The bottom hand's first card, from mshearts.exe's layout of a 530 by 397
// table.
const HAND = { x: 139, y: 298 };
const slotPoint = (index, dy = 50) => [HAND.x + index * 15 + 7, HAND.y + dy];

const open = async ({
  storage = {},
  time = GAME_714,
  failImages = false,
  failFont = false,
  rejectPlay = false,
  name = "astro",
} = {}) => {
  let frames;
  const files = siteFiles({ failFont });
  // Animation frames and the game's pauses wait for the test to run them.
  const queued = [];
  const sounds = [];
  const marks = [];
  // The pass button's caption: each System font pixel's color.
  const caption = [];
  const s = await login(
    await loadShell({
      initialStorage: storage,
      fetchObject: files.fetchObject,
      beforeScripts: (window) => {
        frames = recordCardCanvas(window, {
          board: "hearts-board",
          width: 530,
          height: 401,
          failImages,
        });
        // The 2-pixel pass marks, per frame.
        const proto = window.HTMLCanvasElement.prototype;
        const getContext = proto.getContext;
        proto.getContext = function (...args) {
          const context = getContext.apply(this, args);
          if (this.closest?.(".hearts-pass")) {
            context.clearRect = () => (caption.length = 0);
            context.fillRect = () => caption.push(context.fillStyle);
          }
          if (this.classList.contains("hearts-board") && !context.marked) {
            const fillRect = context.fillRect;
            context.fillRect = (x, y, width, height) => {
              if (width >= 500) marks.length = 0;
              if (width === 2 && height === 2) marks.push(`${x},${y}`);
              return fillRect(x, y, width, height);
            };
            context.marked = true;
          }
          return context;
        };
        window.Date.now = () => time;
        const realFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) => {
          // The shell's window animations keep their own frames.
          if (!/heartsFrame/.test(new Error().stack))
            return realFrame(callback);
          queued.push({ kind: "frame", callback });
          return queued.length;
        };
        const realTimeout = window.setTimeout.bind(window);
        const realClear = window.clearTimeout.bind(window);
        window.setTimeout = (callback, ms = 0, ...args) => {
          // Only Hearts' own pauses wait for the test: the inverted card's
          // and the finished trick's. Tests find them by function name.
          if (!/flashCard|heartsPause/.test(new Error().stack))
            return realTimeout(callback, ms, ...args);
          const entry = { kind: "timer", ms, callback };
          queued.push(entry);
          return entry;
        };
        window.clearTimeout = (id) => {
          const index = queued.indexOf(id);
          if (index !== -1) queued.splice(index, 1);
          else realClear(id);
        };
        window.Audio = class {
          constructor(src) {
            this.src = src;
            sounds.push(this);
          }
          play() {
            this.playing = true;
            // Browsers refuse sound before the page is used.
            return rejectPlay
              ? Promise.reject(new Error("NotAllowedError"))
              : Promise.resolve();
          }
          pause() {
            this.playing = false;
          }
        };
      },
    }),
  );
  s.window.history.replaceState(null, "", "#hearts");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  const settle = async (times = 4) => {
    for (let index = 0; index < times; index += 1) await flushShell();
  };
  await settle(6);
  // The board draws once its font is read.
  await files.read();
  await settle(6);
  const win = s.document.querySelector('.xp-window[data-game="__hearts"]');
  const canvas = win.querySelector(".hearts-board");
  const dialog = () => [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  const answer = async (id) => {
    dialog().querySelector(`[data-action="${id}"]`).click();
    await settle();
  };
  // Runs queued frames and timers until nothing waits, or `limit` steps.
  const run = async (limit = Infinity) => {
    let steps = 0;
    while (queued.length && steps < limit) {
      queued.shift().callback(0);
      steps += 1;
      await flushShell();
    }
    await settle(2);
    return steps;
  };
  const press = async ([x, y], init = {}) => {
    canvas.dispatchEvent(
      new s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
    canvas.dispatchEvent(
      new s.window.MouseEvent("mousedown", {
        bubbles: true,
        clientX: x,
        clientY: y,
        button: 0,
        ...init,
      }),
    );
    await settle(2);
  };
  const key = async (name, init = {}, target = win) => {
    target.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
    await settle();
  };
  const status = () => win.querySelector(".hearts-status").textContent;
  const button = () => win.querySelector(".hearts-pass");
  const lastFrame = () => frames.at(-1);
  const drawnAt = (x, y) =>
    lastFrame()
      .filter(([, left, top]) => left === x && top === y)
      .map(([image]) => image)
      .at(-1);
  const menu = async (name, command) => {
    win.querySelector(`[data-hearts-menu="${name}"]`).click();
    win.querySelector(`.tm-menu [data-command="${command}"]`).click();
    await settle();
  };
  const h = {
    s,
    win,
    canvas,
    frames,
    queued,
    sounds,
    marks,
    caption,
    dialog,
    answer,
    run,
    press,
    key,
    status,
    button,
    drawnAt,
    lastFrame,
    menu,
    settle,
  };
  if (name !== null) {
    dialog().querySelector("input").value = name;
    await answer("ok");
  }
  return h;
};

const storedSettings = (h) =>
  JSON.parse(h.s.window.localStorage.getItem("heartsSettings"));
const labels = (h) =>
  [...h.win.querySelectorAll(".hearts-name")].map((label) => label.textContent);
// Passes K♣, K♦ and K♠, as the VM's first hand did, and accepts.
const passKings = async (h) => {
  for (const index of [2, 7, 10]) await h.press(slotPoint(index));
  h.button().click();
  await h.settle();
  h.button().click();
  await h.settle();
};

describe("starting", () => {
  test("asks for a name in the welcome dialog before dealing", async () => {
    const h = await open({ name: null });
    expect(h.win.querySelector(".title-text").textContent).toBe(
      "The Microsoft Hearts Network",
    );
    expect(h.win.classList.contains("dialog-frame")).toBeTrue();
    expect(h.status()).toBe("Welcome to the Microsoft Hearts Network.");
    expect(h.dialog().getAttribute("aria-label")).toBe(
      "The Microsoft Hearts Network",
    );
    const input = h.dialog().querySelector("input");
    expect(input.maxLength).toBe(14);
    // OK without a name keeps the dialog open, the caret back in the box.
    await h.answer("ok");
    expect(h.dialog()).toBeDefined();
    expect(h.s.document.activeElement).toBe(input);
    input.value = "astro";
    await h.answer("ok");
    expect(h.s.document.querySelector(".xp-dialog")).toBeNull();
    expect(storedSettings(h).name).toBe("astro");
    expect(h.status()).toBe("Select three cards to pass to Pauline.");
  });

  test("F7, F8 and F9 wait until the name is in", async () => {
    const h = await open({ name: null });
    await h.key("F9");
    expect(h.s.document.querySelectorAll(".xp-dialog")).toHaveLength(1);
    h.dialog().closest(".xp-dialog-overlay").remove();
    await h.key("F9");
    expect(h.dialog()).toBeUndefined();
    await h.key("F8");
    expect(h.s.window.localStorage.getItem("heartsSettings")).toBeNull();
  });

  test("Quit and the close box end Hearts", async () => {
    for (const action of ["quit", "close"]) {
      const h = await open({ name: null });
      if (action === "quit") await h.answer("quit");
      else {
        h.dialog().querySelector(".close-btn").click();
        await h.settle();
      }
      expect(h.win.isConnected).toBeFalse();
      cleanupShells();
    }
  });

  test("fills in the saved name every time it opens", async () => {
    const h = await open({
      name: null,
      storage: { heartsSettings: JSON.stringify({ name: "Juan" }) },
    });
    expect(h.dialog().querySelector("input").value).toBe("Juan");
  });

  test("keeps long, emoji and spaced names, up to 14 characters", async () => {
    for (const [saved, shown] of [
      ["A very long player name", "A very long pl"],
      ["❤️ Juan", "❤️ Juan"],
      ["Хорхе", "Хорхе"],
      [" ", " "],
    ]) {
      const h = await open({
        name: null,
        storage: { heartsSettings: JSON.stringify({ name: saved }) },
      });
      expect(h.dialog().querySelector("input").value).toBe(shown);
      await h.answer("ok");
      expect(labels(h)[0]).toBe(shown);
      cleanupShells();
    }
  });

  test("falls back to XP's defaults for missing or damaged settings", async () => {
    for (const saved of [
      "{not json",
      JSON.stringify(null),
      JSON.stringify({ speed: "warp", sound: "yes", names: "Ben", name: 5 }),
      JSON.stringify({ names: ["", 7, "Zed"] }),
    ]) {
      const h = await open({
        name: null,
        storage: { heartsSettings: saved },
      });
      expect(h.dialog().querySelector("input").value).toBe("");
      h.dialog().querySelector("input").value = "astro";
      await h.answer("ok");
      expect(labels(h).slice(1, 3)).toEqual(["Pauline", "Michele"]);
      expect(["Ben", "Zed"]).toContain(labels(h)[3]);
      expect(storedSettings(h)).toMatchObject({
        sound: false,
        speed: "normal",
      });
      cleanupShells();
    }
  });

  test("keeps playing when its settings can't be saved", async () => {
    const h = await open({ name: null });
    const storage = h.s.window.localStorage;
    Object.defineProperty(h.s.window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
          if (key === "heartsSettings") throw new Error("full");
          storage.setItem(key, value);
        },
        removeItem: (key) => storage.removeItem(key),
      },
    });
    h.dialog().querySelector("input").value = "astro";
    await h.answer("ok");
    expect(h.status()).toBe("Select three cards to pass to Pauline.");
    expect(storage.getItem("heartsSettings")).toBeNull();
  });

  test("tells the player when the cards can't load, and still deals", async () => {
    const h = await open({ failImages: true, name: null });
    await h.settle();
    const alert = [...h.s.document.querySelectorAll(".xp-dialog")].find(
      (element) => element.textContent.includes("The cards didn't load."),
    );
    expect(alert).toBeDefined();
    alert.querySelector("button").click();
    await h.settle();
    h.dialog().querySelector("input").value = "astro";
    await h.answer("ok");
    expect(h.status()).toBe("Select three cards to pass to Pauline.");
    expect(h.lastFrame()).toEqual([]);
  });

  test("draws the pass button's caption in the System font, gray while disabled", async () => {
    const h = await open();
    expect(new Set(h.caption)).toEqual(new Set(["#a1a192"]));
    const pixels = h.caption.length;
    for (const index of [2, 7, 10]) await h.press(slotPoint(index));
    expect(new Set(h.caption)).toEqual(new Set(["#000"]));
    expect(h.caption).toHaveLength(pixels);
  });

  test("labels the pass button even without the System font", async () => {
    const h = await open({ failFont: true });
    expect(h.caption).toEqual([]);
    expect(h.button().getAttribute("aria-label")).toBe("Pass Left");
  });
});

describe("the deal and the pass", () => {
  test("lays out the VM's deal of game 714", async () => {
    const h = await open();
    // The human's sorted hand, 15 pixels apart.
    expect(h.drawnAt(139, 298)).toBe(face("2C"));
    expect(h.drawnAt(169, 298)).toBe(face("KC"));
    expect(h.drawnAt(319, 298)).toBe(face("TH"));
    // Pauline down the left, Michele across the top, Ben up the right.
    for (const [x, y] of [
      [9, 60],
      [9, 240],
      [319, 3],
      [139, 3],
      [450, 240],
      [450, 60],
    ])
      expect(h.drawnAt(x, y)).toBe(BACK);
    const placed = [...h.win.querySelectorAll(".hearts-name")].map((label) => [
      label.textContent,
      label.style.left || `right ${label.style.right}`,
      label.style.top,
    ]);
    expect(placed).toEqual([
      ["astro", "right 394px", "378px"],
      ["Pauline", "11px", "44px"],
      ["Michele", "393px", "3px"],
      ["Ben", "right 11px", "336px"],
    ]);
    const pass = h.button();
    expect(pass.hidden).toBeFalse();
    expect(pass.disabled).toBeTrue();
    expect(pass.getAttribute("aria-label")).toBe("Pass Left");
    expect([pass.style.left, pass.style.top]).toEqual(["213px", "233px"]);
    // The white marks beside the cards each computer means to pass, where
    // the VM showed them.
    expect([...h.marks].sort()).toEqual(
      [
        "83,187",
        "83,202",
        "83,217",
        "248,102",
        "308,102",
        "353,102",
        "447,164",
        "447,194",
        "447,209",
      ].sort(),
    );
  });

  test("a dialog over the table clears the pass marks", async () => {
    const h = await open();
    await h.key("F9");
    expect(h.marks).toEqual([]);
  });

  test("selects up to three cards, raising them, and lights the button", async () => {
    const h = await open();
    await h.press(slotPoint(2));
    await h.press(slotPoint(7));
    expect(h.drawnAt(169, 278)).toBe(face("KC"));
    expect(h.button().disabled).toBeTrue();
    await h.press(slotPoint(10));
    expect(h.button().disabled).toBeFalse();
    expect(h.s.document.activeElement).toBe(h.button());
    // A fourth card waits until one is put back.
    await h.press(slotPoint(0));
    expect(h.drawnAt(139, 298)).toBe(face("2C"));
    // Above an unraised card nothing happens; above a raised one it counts.
    await h.press(slotPoint(0, -10));
    expect(h.drawnAt(139, 298)).toBe(face("2C"));
    // Too far right of any raised card's reach.
    await h.press(slotPoint(12, -10));
    expect(h.drawnAt(319, 298)).toBe(face("TH"));
    await h.press(slotPoint(10, -10));
    expect(h.button().disabled).toBeTrue();
    expect(h.drawnAt(289, 298)).toBe(face("KS"));
    // Over the raised band of the next card, the raised K♦ to its left wins.
    await h.press([HAND.x + 8 * 15 + 3, HAND.y - 10]);
    expect(h.drawnAt(244, 298)).toBe(face("KD"));
    expect(h.drawnAt(244, 278)).toBeUndefined();
    // Beside the hand, past its last card, or off its rows: nothing.
    for (const point of [
      [100, 330],
      [HAND.x + 252, 330],
      [200, 260],
      [200, 400],
    ])
      await h.press(point);
    expect(h.drawnAt(319, 298)).toBe(face("TH"));
    // Only the left button picks cards.
    await h.press(slotPoint(5), { button: 2 });
    expect(h.drawnAt(214, 298)).toBe(face("9D"));
    // Past the last card's left part, the click still finds it.
    await h.press([HAND.x + 12 * 15 + 70, 330]);
    expect(h.drawnAt(319, 278)).toBe(face("TH"));
  });

  test("passes left to Pauline and takes Ben's cards, raised until OK", async () => {
    const h = await open();
    for (const index of [2, 7, 10]) await h.press(slotPoint(index));
    h.button().click();
    await h.settle();
    expect(h.status()).toBe("Press OK to accept cards.");
    expect(h.button().getAttribute("aria-label")).toBe("OK");
    // Ben passed the jack and ace of clubs and the ace of hearts.
    expect(h.drawnAt(169, 278)).toBe(face("JC"));
    expect(h.drawnAt(184, 278)).toBe(face("AC"));
    expect(h.drawnAt(319, 278)).toBe(face("AH"));
    expect(h.marks).toEqual([]);
    // Cards can't be picked while waiting for OK.
    await h.press(slotPoint(0));
    expect(h.drawnAt(139, 298)).toBe(face("2C"));
    h.button().click();
    await h.settle();
    expect(h.button().hidden).toBeTrue();
    expect(h.drawnAt(319, 298)).toBe(face("AH"));
    expect(h.status()).toBe("Select a card to play.");
    // A stray click on the hidden button does nothing.
    h.button().click();
    expect(h.status()).toBe("Select a card to play.");
  });

  test("ignores the pass button until three cards are chosen", async () => {
    const h = await open();
    await h.press(slotPoint(0));
    h.button().disabled = false;
    h.button().click();
    await h.settle();
    expect(h.status()).toBe("Select three cards to pass to Pauline.");
  });
});

describe("play", () => {
  test("rejects a wrong lead, inverting the card for a quarter second", async () => {
    const h = await open();
    await passKings(h);
    await h.press(slotPoint(6));
    expect(h.status()).toBe("You must lead the two of clubs.");
    expect(h.drawnAt(229, 298)).toBe(face("9D", true));
    // Clicks and space wait while the card is inverted.
    await h.press(slotPoint(0));
    await h.key(" ");
    expect(h.drawnAt(139, 298)).toBe(face("2C"));
    expect(h.queued.at(-1)).toMatchObject({ kind: "timer", ms: 250 });
    await h.run(1);
    expect(h.drawnAt(229, 298)).toBe(face("9D"));
  });

  test("plays the VM's first two tricks, the computers answering in turn", async () => {
    const h = await open();
    await passKings(h);
    await h.press(slotPoint(0));
    // A double click while the two of clubs slides is ignored.
    await h.press(slotPoint(1));
    await h.press(slotPoint(1));
    await h.run(10);
    expect(h.drawnAt(225, 180)).toBe(face("2C"));
    expect(h.status()).toBe("Waiting for Pauline to move...");
    // Pauline, Michele and Ben follow with their highest clubs.
    while (h.queued[0]?.kind === "frame") await h.run(1);
    expect(h.drawnAt(200, 145)).toBe(face("KC"));
    expect(h.drawnAt(235, 120)).toBe(face("6C"));
    expect(h.drawnAt(260, 155)).toBe(face("4C"));
    expect(h.status()).toBe("Waiting for Ben to move...");
    // The trick waits a second, then goes to Pauline.
    expect(h.queued[0]).toMatchObject({ kind: "timer", ms: 1000 });
    await h.run();
    // Pauline leads the two of diamonds; the others follow low.
    expect(h.drawnAt(200, 145)).toBe(face("2D"));
    expect(h.drawnAt(235, 120)).toBe(face("5D"));
    expect(h.drawnAt(260, 155)).toBe(face("4D"));
    expect(h.status()).toBe("Select a card to play.");
    // The two of clubs left a gap in the hand.
    expect(h.drawnAt(139, 298)).toBeUndefined();
    await h.press(slotPoint(1));
    expect(h.status()).toBe("You must follow suit.  Play a diamond.");
    await h.run(1);
    // Space plays the leftmost card that's allowed: the three of diamonds.
    await h.key(" ");
    while (h.queued[0]?.kind === "frame") await h.run(1);
    expect(h.drawnAt(225, 180)).toBe(face("3D"));
  });

  test("space waits for the human's turn and leaves the button its own key", async () => {
    const h = await open();
    await h.key(" ");
    expect(h.status()).toBe("Select three cards to pass to Pauline.");
    for (const index of [2, 7, 10]) await h.press(slotPoint(index));
    await h.key(" ", {}, h.button());
    expect(h.status()).toBe("Select three cards to pass to Pauline.");
    h.button().click();
    await h.settle();
    h.button().click();
    await h.settle();
    await h.key(" ");
    await h.run(10);
    expect(h.drawnAt(225, 180)).toBe(face("2C"));
    // Space during the computers' turns does nothing.
    await h.key(" ");
    await h.run();
    expect(h.status()).toBe("Select a card to play.");
  });

  test("closing the window mid-animation stops the game cleanly", async () => {
    const h = await open();
    await passKings(h);
    await h.press(slotPoint(0));
    await h.run(3);
    h.win.querySelector(".close-btn").click();
    await h.settle();
    expect(h.win.isConnected).toBeFalse();
    const drawn = h.frames.length;
    await h.run();
    expect(h.frames.length).toBe(drawn);
    // Opening again starts over with the welcome dialog.
    h.s.window.history.replaceState(null, "", "#");
    h.s.window.history.replaceState(null, "", "#hearts");
    h.s.window.dispatchEvent(new h.s.window.HashChangeEvent("hashchange"));
    await h.settle(6);
    const again = h.s.document.querySelector(
      '.xp-window[data-game="__hearts"]',
    );
    expect(again.querySelector(".hearts-status").textContent).toBe(
      "Welcome to the Microsoft Hearts Network.",
    );
  });

  test("closing the window during the trick's pause cancels it", async () => {
    const h = await open();
    await passKings(h);
    await h.press(slotPoint(0));
    while (h.queued[0]?.kind === "frame") await h.run(1);
    expect(h.queued[0]).toMatchObject({ kind: "timer", ms: 1000 });
    h.win.querySelector(".close-btn").click();
    await h.settle();
    expect(h.queued.some(({ kind }) => kind === "timer")).toBeFalse();
  });

  test("closing the window while the trick is gathered stops it", async () => {
    const h = await open();
    await passKings(h);
    await h.press(slotPoint(0));
    while (h.queued[0]?.kind === "frame") await h.run(1);
    await h.run(3);
    h.win.querySelector(".close-btn").click();
    await h.settle();
    await h.run();
    expect(h.win.isConnected).toBeFalse();
  });

  test("closing the window during a flash clears it", async () => {
    const h = await open();
    await passKings(h);
    await h.press(slotPoint(6));
    h.win.querySelector(".close-btn").click();
    await h.settle();
    expect(h.queued).toEqual([]);
  });
});

describe("whole games", () => {
  // Plays as the VM run did: pass the last three cards, then press space.
  const playHand = async (h, statuses = []) => {
    for (let guard = 0; guard < 300; guard += 1) {
      if (h.dialog()) return;
      const pass = h.button();
      if (!pass.hidden) {
        if (pass.getAttribute("aria-label") !== "OK") {
          statuses.push(h.status());
          for (const index of [10, 11, 12]) await h.press(slotPoint(index));
        }
        pass.click();
        await h.settle(2);
      } else {
        if (statuses.length === 0) statuses.push(h.status());
        await h.key(" ");
      }
      await h.run();
    }
  };
  const sheetRows = (h) =>
    [...h.dialog().querySelectorAll(".hearts-score-column")].map((column) =>
      [...column.children].slice(1).map((line) => line.textContent),
    );

  test("replays VM game 10132 to Game Over, the moon included", async () => {
    const h = await open({
      time: GAME_10132,
      storage: { heartsSettings: JSON.stringify({ sound: true }) },
    });
    const titles = [];
    const passes = [];
    let last;
    for (let hand = 1; hand <= 7; hand += 1) {
      const statuses = [];
      await playHand(h, statuses);
      passes.push(statuses[0]);
      titles.push(h.dialog().getAttribute("aria-label"));
      last = sheetRows(h);
      expect(h.status()).toBe("Score");
      if (hand === 1) {
        // The human took every heart and the queen: 26 for everyone else,
        // as in the VM, with all 14 cards laid where the hand was.
        expect(last.map((rows) => rows.at(-1))).toEqual([
          "0",
          "26",
          "26",
          "26",
        ]);
        expect(h.dialog().querySelector('[data-seat="0"]').classList).toContain(
          "leader",
        );
        expect(h.lastFrame().filter(([, , y]) => y === HAND.y)).toHaveLength(
          14,
        );
        expect(h.sounds.map(({ src }) => src)).toEqual(
          expect.arrayContaining([
            "assets/xp/hearts/HeartsBroken.wav",
            "assets/xp/hearts/Queen.wav",
          ]),
        );
      }
      if (hand < 7) await h.answer("ok");
    }
    // Left, right, across, then no pass.
    expect(passes.slice(0, 3)).toEqual([
      "Select three cards to pass to Pauline.",
      "Select three cards to pass to Ben.",
      "Select three cards to pass to Michele.",
    ]);
    expect(passes[3]).not.toStartWith("Select three");
    expect(passes[4]).toBe("Select three cards to pass to Pauline.");
    expect(titles).toEqual([
      "Score Sheet -- First Place",
      "Score Sheet -- First Place",
      "Score Sheet -- Last Place",
      "Score Sheet -- Last Place",
      "Score Sheet -- Last Place",
      "Score Sheet -- Last Place",
      "Game Over",
    ]);
    // The VM's sheet after five hands.
    expect(last.map((rows) => rows.slice(0, 5))).toEqual([
      ["0", "21", "40", "53", "68"],
      ["26", "26", "26", "26", "26"],
      ["26", "27", "30", "33", "44"],
      ["26", "30", "34", "44", "44"],
    ]);
    expect(last.map((rows) => rows.at(-1))).toEqual(["102", "26", "45", "61"]);
    // Earlier totals are struck out; Pauline wins in dark red.
    expect(
      h.dialog().querySelector('[data-seat="0"] .struck').textContent,
    ).toBe("0");
    expect(h.dialog().querySelector('[data-seat="1"]').classList).toContain(
      "winner",
    );
    expect(h.dialog().querySelector(".hearts-score-icon").style.left).toBe(
      "299px",
    );
    // The next game starts by itself, its sheet empty.
    await h.answer("ok");
    expect(h.status()).toBe("Select three cards to pass to Pauline.");
    await h.key("F9");
    expect(h.dialog().getAttribute("aria-label")).toBe("Score Sheet");
    expect(sheetRows(h)).toEqual([[], [], [], []]);
  });

  test("announces a win when the human has the lowest score", async () => {
    const h = await open({ time: WINNING_GAME });
    let title = "";
    for (let hand = 1; hand <= 5; hand += 1) {
      await playHand(h);
      title = h.dialog().getAttribute("aria-label");
      if (hand < 5) await h.answer("ok");
    }
    expect(title).toBe("Game Over -- You Win");
    expect(h.dialog().querySelector('[data-seat="0"]').classList).toContain(
      "winner",
    );
  });
});

describe("menus and dialogs", () => {
  test("Options saves the speed and names for the next game", async () => {
    const h = await open();
    await h.key("F7");
    expect(h.dialog().getAttribute("aria-label")).toBe("Hearts Options");
    const inputs = [...h.dialog().querySelectorAll("input.xp-input")];
    expect(inputs.map((input) => input.value)).toEqual([
      "Pauline",
      "Michele",
      "Ben",
    ]);
    expect(inputs.every((input) => input.maxLength === 14)).toBeTrue();
    h.dialog().querySelector('input[type="radio"]').checked = true;
    inputs[0].value = "Ana";
    inputs[1].value = "";
    await h.answer("ok");
    expect(storedSettings(h)).toMatchObject({
      speed: "slow",
      names: ["Ana", "Michele", "Ben"],
    });
    // This game keeps its players.
    expect(labels(h)[1]).toBe("Pauline");
    // Cancel leaves everything as it was.
    await h.menu("game", "options");
    h.dialog().querySelectorAll('input[type="radio"]')[2].checked = true;
    await h.answer("cancel");
    expect(storedSettings(h).speed).toBe("slow");
  });

  test("animation speed sets the steps a card takes", async () => {
    const steps = {};
    for (const speed of ["slow", "normal", "fast"]) {
      const h = await open({
        storage: { heartsSettings: JSON.stringify({ speed }) },
      });
      await passKings(h);
      await h.press(slotPoint(0));
      let frames = 0;
      while (h.queued[0]?.kind === "frame") {
        await h.run(1);
        frames += 1;
        if (h.status().startsWith("Waiting")) break;
      }
      steps[speed] = frames;
      cleanupShells();
    }
    // About 146 pixels at 5, 15 or 60 a step, made even.
    expect(steps).toEqual({ slow: 30, normal: 10, fast: 2 });
  });

  test("Sound toggles its check mark and is saved", async () => {
    const h = await open();
    const item = () => {
      h.win.querySelector('[data-hearts-menu="game"]').click();
      const entry = h.win.querySelector('.tm-menu [data-command="sound"]');
      h.win.querySelector('[data-hearts-menu="game"]').click();
      return entry;
    };
    expect(item().classList.contains("checked")).toBeFalse();
    await h.key("F8");
    expect(item().classList.contains("checked")).toBeTrue();
    expect(storedSettings(h).sound).toBeTrue();
    await h.menu("game", "sound");
    expect(storedSettings(h).sound).toBeFalse();
  });

  test("turning Sound off stops a playing sound", async () => {
    const h = await open({
      storage: { heartsSettings: JSON.stringify({ sound: true }) },
    });
    await passKings(h);
    // Play on until a sound starts.
    const played = () =>
      h.sounds.filter(({ src }) => src.startsWith("assets/xp/hearts/"));
    for (let guard = 0; guard < 60 && !played().length; guard += 1) {
      await h.key(" ");
      await h.run();
    }
    const sound = played().at(-1);
    expect(sound.playing).toBeTrue();
    await h.key("F8");
    expect(sound.playing).toBeFalse();
  });

  test("a sound the browser refuses doesn't stop the game", async () => {
    const h = await open({
      rejectPlay: true,
      storage: { heartsSettings: JSON.stringify({ sound: true }) },
    });
    await passKings(h);
    for (let guard = 0; guard < 60; guard += 1) {
      await h.key(" ");
      await h.run();
      if (h.sounds.some(({ src }) => src.startsWith("assets/xp/hearts/")))
        break;
    }
    await h.settle();
    expect(h.status()).not.toBe("");
  });

  test("OK on a Score Sheet left open after closing the window deals nothing", async () => {
    const h = await open({ time: WINNING_GAME });
    for (let guard = 0; guard < 300 && !h.dialog(); guard += 1) {
      const pass = h.button();
      if (!pass.hidden) {
        if (pass.getAttribute("aria-label") !== "OK")
          for (const index of [10, 11, 12]) await h.press(slotPoint(index));
        pass.click();
        await h.settle(2);
      } else await h.key(" ");
      await h.run();
    }
    const sheet = h.dialog();
    h.win.querySelector(".close-btn").click();
    await h.settle();
    const drawn = h.frames.length;
    sheet.querySelector('[data-action="ok"]')?.click();
    await h.settle();
    expect(h.frames.length).toBe(drawn);
  });

  test("Quote shows Julius Caesar's line", async () => {
    const h = await open();
    await h.menu("help", "quote");
    expect(h.dialog().getAttribute("aria-label")).toBe(
      "Quote for The Microsoft Hearts Network",
    );
    expect(h.dialog().textContent).toContain(
      "I come not, friends, to steal away your hearts...",
    );
    expect(h.dialog().textContent).toContain(
      "- Julius Caesar, Act III, scene ii",
    );
    await h.answer("ok");
    expect(h.dialog()).toBeUndefined();
  });

  test("About Hearts names the Hearts Network", async () => {
    const h = await open();
    await h.menu("help", "about");
    expect(h.dialog().getAttribute("aria-label")).toBe("About Hearts Network");
    expect(h.dialog().querySelector(".about-windows-icon").src).toContain(
      "assets/xp/hearts/Hearts-32.png",
    );
  });

  test("the menus open, close and close from outside", async () => {
    const h = await open();
    const game = h.win.querySelector('[data-hearts-menu="game"]');
    game.click();
    expect(game.getAttribute("aria-expanded")).toBe("true");
    expect(
      [...h.win.querySelectorAll(".tm-menu > button")].map((entry) =>
        entry.textContent.trim(),
      ),
    ).toEqual(["Options...F7", "SoundF8", "Score...F9", "Exit"]);
    game.click();
    expect(h.win.querySelector(".tm-menu")).toBeNull();
    game.click();
    h.win
      .querySelector(".tm-menu")
      .dispatchEvent(
        new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
      );
    expect(h.win.querySelector(".tm-menu")).not.toBeNull();
    h.s.document.body.dispatchEvent(
      new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(h.win.querySelector(".tm-menu")).toBeNull();
    const help = h.win.querySelector('[data-hearts-menu="help"]');
    help.click();
    expect(
      [...h.win.querySelectorAll(".tm-menu > button")].map((entry) =>
        entry.textContent.trim(),
      ),
    ).toEqual(["Quote...", "About Hearts"]);
    // The table has no context menu.
    const menuEvent = new h.s.window.MouseEvent("contextmenu", {
      cancelable: true,
    });
    h.canvas.dispatchEvent(menuEvent);
    expect(menuEvent.defaultPrevented).toBeTrue();
  });

  test("Esc hides the window and Exit closes it", async () => {
    const h = await open();
    // With a menu open, Esc only closes the menu.
    h.win.querySelector('[data-hearts-menu="game"]').click();
    await h.key("Escape");
    expect(h.win.querySelector(".tm-menu")).toBeNull();
    expect(h.win.style.display).not.toBe("none");
    await h.key("Escape");
    expect(h.win.style.display).toBe("none");
    cleanupShells();
    const h2 = await open();
    await h2.menu("game", "exit");
    expect(h2.win.isConnected).toBeFalse();
  });

  test("keys a dialog handles don't reach the table", async () => {
    const h = await open();
    await h.key("F9");
    await h.key("Escape", {}, h.dialog());
    expect(h.dialog()).toBeUndefined();
    expect(h.win.style.display).not.toBe("none");
    // Other keys pass through untouched.
    await h.key("a");
    expect(h.status()).toBe("Select three cards to pass to Pauline.");
  });
});

test("Hearts' menus follow XP's menu bar rules", async () => {
  const h = await open();
  await checkMenuBar({
    s: h.s,
    win: h.win,
    control: h.win.querySelector(".xp-hearts"),
    accessKey: "g",
    settle: flushShell,
  });
});
