import { applicationMetadata } from "./metadata.js";
import { defineApplication } from "../core/application.js";
import { wireMenuBar } from "../core/menu-bar.js";
import { createRandom } from "../freecell/game.js";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  measureBoard,
  prepareBoard,
} from "../cards/cards.js";
import { dialogUnitsY, openTemplateDialog } from "../cards/template-dialog.js";
import { drawText, loadSystemFont, measureText } from "../cards/system-font.js";
import {
  COLUMNS,
  MAX_UNDO,
  RUN_BONUS,
  START_SCORE,
  addScore,
  canDrop,
  canPickUp,
  cloneColumns,
  deal,
  dealRow,
  faceDownCount,
  findHints,
  hasCompleteRun,
  moveCards,
  rankOf,
  seedFromTime,
  suitOf,
  undoMove,
} from "./game.js";

const SETTINGS_KEY = "spiderSettings";
const SAVE_KEY = "spiderSavedGame";
// spider.exe sets corner pixels to this green when it draws a card over the
// table instead of repainting it.
const GREEN = "#008000";
const SCORE_GREEN = "#007f00";
const DIFFICULTIES = { 1: "easy", 2: "medium", 4: "difficult" };

// Listed in full so the build can fingerprint each file. spider.exe numbers
// its faces by suit, then rank.
const FACE_URLS = [
  "assets/xp/spider/cards/1.png",
  "assets/xp/spider/cards/2.png",
  "assets/xp/spider/cards/3.png",
  "assets/xp/spider/cards/4.png",
  "assets/xp/spider/cards/5.png",
  "assets/xp/spider/cards/6.png",
  "assets/xp/spider/cards/7.png",
  "assets/xp/spider/cards/8.png",
  "assets/xp/spider/cards/9.png",
  "assets/xp/spider/cards/10.png",
  "assets/xp/spider/cards/11.png",
  "assets/xp/spider/cards/12.png",
  "assets/xp/spider/cards/13.png",
  "assets/xp/spider/cards/14.png",
  "assets/xp/spider/cards/15.png",
  "assets/xp/spider/cards/16.png",
  "assets/xp/spider/cards/17.png",
  "assets/xp/spider/cards/18.png",
  "assets/xp/spider/cards/19.png",
  "assets/xp/spider/cards/20.png",
  "assets/xp/spider/cards/21.png",
  "assets/xp/spider/cards/22.png",
  "assets/xp/spider/cards/23.png",
  "assets/xp/spider/cards/24.png",
  "assets/xp/spider/cards/25.png",
  "assets/xp/spider/cards/26.png",
  "assets/xp/spider/cards/27.png",
  "assets/xp/spider/cards/28.png",
  "assets/xp/spider/cards/29.png",
  "assets/xp/spider/cards/30.png",
  "assets/xp/spider/cards/31.png",
  "assets/xp/spider/cards/32.png",
  "assets/xp/spider/cards/33.png",
  "assets/xp/spider/cards/34.png",
  "assets/xp/spider/cards/35.png",
  "assets/xp/spider/cards/36.png",
  "assets/xp/spider/cards/37.png",
  "assets/xp/spider/cards/38.png",
  "assets/xp/spider/cards/39.png",
  "assets/xp/spider/cards/40.png",
  "assets/xp/spider/cards/41.png",
  "assets/xp/spider/cards/42.png",
  "assets/xp/spider/cards/43.png",
  "assets/xp/spider/cards/44.png",
  "assets/xp/spider/cards/45.png",
  "assets/xp/spider/cards/46.png",
  "assets/xp/spider/cards/47.png",
  "assets/xp/spider/cards/48.png",
  "assets/xp/spider/cards/49.png",
  "assets/xp/spider/cards/50.png",
  "assets/xp/spider/cards/51.png",
  "assets/xp/spider/cards/52.png",
];
const BACK_URL = "assets/xp/spider/CardBack.png";
const EMPTY_URL = "assets/xp/spider/Empty.png";
const FELT_URL = "assets/xp/spider/Felt.png";
const ABOUT_URL = "assets/xp/spider/About.png";
const SUIT_ICONS = {
  club: "assets/xp/spider/Club.png",
  diamond: "assets/xp/spider/Diamond.png",
  heart: "assets/xp/spider/Heart.png",
  spade: "assets/xp/spider/Spade.png",
};
const SOUNDS = {
  deal: "assets/xp/spider/Deal.wav",
  drop: "assets/xp/spider/Drop.wav",
  hint: "assets/xp/spider/Hint.wav",
  noMoves: "assets/xp/spider/NoMoves.wav",
  pickUp: "assets/xp/spider/PickUp.wav",
  win: "assets/xp/spider/Win.wav",
};

const faceId = (card) => suitOf(card) * 13 + rankOf(card) + 1;

const MENUS = [
  [
    "&Game",
    [
      ["&New Game", "new", "F2"],
      ["&Restart This Game", "restart", ""],
      "-",
      ["&Undo", "undo", "Ctrl+Z"],
      ["&Deal Next Row", "deal", "D"],
      ["Show An Available &Move", "hint", "M"],
      "-",
      ["D&ifficulty...", "difficulty", "F3"],
      ["S&tatistics...", "statistics", "F4"],
      ["O&ptions...", "options", "F5"],
      "-",
      ["&Save This Game", "save", "Ctrl+S"],
      ["&Open Last Saved Game", "open", "Ctrl+O"],
      "-",
      ["E&xit", "exit", ""],
    ],
  ],
  ["&Deal!", "deal"],
  [
    "&Help",
    [["&Contents", "contents", "F1"], "-", ["&About Spider...", "about", ""]],
  ],
];

const emptyStats = () => ({
  high: 0,
  wins: 0,
  losses: 0,
  mostWins: 0,
  mostLosses: 0,
  current: 0,
  winning: false,
});

const readJson = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
};

const readSettings = () => {
  const saved = readJson(SETTINGS_KEY) ?? {};
  const flag = (value, fallback) =>
    typeof value === "boolean" ? value : fallback;
  const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
  const stats = Object.fromEntries(
    Object.values(DIFFICULTIES).map((name) => {
      const value = saved.stats?.[name] ?? {};
      return [
        name,
        {
          high: count(value.high),
          wins: count(value.wins),
          losses: count(value.losses),
          mostWins: count(value.mostWins),
          mostLosses: count(value.mostLosses),
          current: count(value.current),
          winning: flag(value.winning, false),
        },
      ];
    }),
  );
  // spider.exe's registry defaults.
  return {
    suits: [1, 2, 4].includes(saved.suits) ? saved.suits : 1,
    animate: flag(saved.animate, true),
    saveOnExit: flag(saved.saveOnExit, false),
    loadAtStart: flag(saved.loadAtStart, false),
    promptSave: flag(saved.promptSave, true),
    promptLoad: flag(saved.promptLoad, true),
    sound: flag(saved.sound, true),
    stats,
  };
};

// A saved game, checked card by card so a damaged save can't break play.
const isEntry = (entry) =>
  entry &&
  Number.isInteger(entry.card) &&
  entry.card >= 0 &&
  entry.card < 52 &&
  typeof entry.up === "boolean";
const readSavedGame = () => {
  const saved = readJson(SAVE_KEY);
  if (
    !saved ||
    ![1, 2, 4].includes(saved.suits) ||
    !Number.isInteger(saved.seed) ||
    !Array.isArray(saved.columns) ||
    saved.columns.length !== COLUMNS ||
    !saved.columns.every(
      (cards) => Array.isArray(cards) && cards.every(isEntry),
    ) ||
    !Array.isArray(saved.stock) ||
    saved.stock.length % COLUMNS !== 0 ||
    !saved.stock.every((card) => isEntry({ card, up: false })) ||
    !Array.isArray(saved.completed) ||
    !saved.completed.every((suit) => [0, 1, 2, 3].includes(suit)) ||
    !Number.isInteger(saved.moves) ||
    !Number.isInteger(saved.score)
  )
    return null;
  return saved;
};

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Spider's cards didn't load."));
    image.src = src;
  });

// The three corner pixels at each of a card's corners.
const TOP_CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [CARD_WIDTH - 1, 0],
  [CARD_WIDTH - 2, 0],
  [CARD_WIDTH - 1, 1],
];
const BOTTOM_CORNERS = TOP_CORNERS.map(([x, y]) => [x, CARD_HEIGHT - 1 - y]);

// A card with its corners cleared, so the table shows through. Red number
// cards are drawn without an outline; spider.exe adds a black one.
const renderCard = (image, outline) => {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  for (const [x, y] of [...TOP_CORNERS, ...BOTTOM_CORNERS])
    context.clearRect(x, y, 1, 1);
  if (outline) {
    context.fillStyle = "#000";
    const right = CARD_WIDTH - 1;
    const bottom = CARD_HEIGHT - 1;
    context.fillRect(2, 0, right - 3, 1);
    context.fillRect(2, bottom, right - 3, 1);
    context.fillRect(0, 2, 1, bottom - 3);
    context.fillRect(right, 2, 1, bottom - 3);
    for (const [x, y] of [
      [1, 1],
      [right - 1, 1],
      [1, bottom - 1],
      [right - 1, bottom - 1],
    ])
      context.fillRect(x, y, 1, 1);
  }
  return canvas;
};

let artPromise = null;
const loadArt = () => {
  artPromise ??= Promise.all([
    ...FACE_URLS.map(loadImage),
    loadImage(BACK_URL),
    loadImage(EMPTY_URL),
    loadImage(FELT_URL),
  ])
    .then((images) => {
      const faces = images.slice(0, 52).map((image, index) => {
        const id = index + 1;
        const redNumber = (id >= 14 && id <= 23) || (id >= 27 && id <= 36);
        return renderCard(image, redNumber);
      });
      // The felt tiles every 63 pixels across and 64 down.
      const felt = document.createElement("canvas");
      felt.width = 63;
      felt.height = 64;
      felt.getContext("2d").drawImage(images[54], 0, 0);
      return {
        faces,
        back: renderCard(images[52], false),
        empty: images[53],
        felt,
      };
    })
    .catch((error) => {
      artPromise = null;
      throw error;
    });
  return artPromise;
};

// Fireworks pixels: a filled circle in a black outline, like GDI's Ellipse
// with the default pen.
const circleCache = new Map();
const circlePixels = (diameter) => {
  if (circleCache.has(diameter)) return circleCache.get(diameter);
  const radius = diameter / 2;
  const inside = (x, y) =>
    x >= 0 &&
    y >= 0 &&
    x < diameter &&
    y < diameter &&
    (x + 0.5 - radius) ** 2 + (y + 0.5 - radius) ** 2 <= radius ** 2;
  const fill = [];
  const outline = [];
  for (let y = 0; y < diameter; y += 1)
    for (let x = 0; x < diameter; x += 1) {
      if (!inside(x, y)) continue;
      const edge =
        !inside(x - 1, y) ||
        !inside(x + 1, y) ||
        !inside(x, y - 1) ||
        !inside(x, y + 1);
      (edge ? outline : fill).push([x, y]);
    }
  const pixels = { fill, outline };
  circleCache.set(diameter, pixels);
  return pixels;
};

const mountSpider = (context) => {
  const { dialogs } = context;
  const root = document.createElement("div");
  root.className = "xp-native-program xp-spider";
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="cards-menu-bar" role="menubar"></div>
    <canvas class="spider-board" role="application" aria-label="Spider Solitaire"></canvas>`;
  const menuBar = root.querySelector(".cards-menu-bar");
  const canvas = root.querySelector("canvas");
  const graphics = canvas.getContext("2d");

  let settings = readSettings();
  let art = null;
  let font = null;
  let unmounted = false;

  // ---- The game ----
  let playing = false;
  let over = false;
  let seed = 0;
  let suits = settings.suits;
  let columns = Array.from({ length: COLUMNS }, () => []);
  let stock = [];
  let completed = [];
  let moves = 0;
  let score = 0;
  let undoStack = [];
  let hints = null;
  let hintIndex = 0;
  // Each column's face-up step. spider.exe squeezes it after moves, deals
  // and resizes, not on a new deal.
  const steps = new Array(COLUMNS).fill(28);
  // Cards spider.exe drew straight onto the table with green corners, until
  // it repaints them.
  const residue = new Map();
  let busy = false;
  let drag = null;
  let peek = null;
  let flying = null;
  let highlight = null;
  let runPile = null;
  let fireworks = null;
  let layout = null;
  let currentSound = null;

  const dealsDone = () => (playing ? 5 - stock.length / COLUMNS : 0);

  const saveSettings = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Settings stay for this session when storage is unavailable.
    }
  };
  const stats = () => settings.stats[DIFFICULTIES[suits]];

  const playSound = (name) => {
    if (!settings.sound) return;
    // PlaySound cuts off whatever was playing.
    currentSound?.pause();
    currentSound = new Audio(SOUNDS[name]);
    void currentSound.play().catch(() => {});
  };

  // ---- Layout, from spider.exe's client size ----
  const measure = () => {
    // Narrow windows overlap the columns as XP does. On a phone they would
    // run off the right edge, so the whole deal scales down instead: ten
    // columns with a 2 pixel gap on each side.
    const { width, height } =
      canvas.clientWidth < 600
        ? measureBoard(canvas, 732)
        : { width: canvas.clientWidth, height: canvas.clientHeight };
    const gap = Math.trunc((width - 710) / 11);
    layout = { width, height, gap, margin: Math.max(0, gap) };
  };
  const columnX = (column) =>
    (layout.gap + CARD_WIDTH) * column + layout.margin;
  const bottomRow = () => layout.height - 106;
  const cardY = (column, index, cards = columns[column]) => {
    if (index === -1) return 10;
    const down = faceDownCount(cards);
    if (index < down) return index * 7 + 10;
    return (index - down) * steps[column] + 10 + down * 7;
  };
  // The rectangle from a card to the bottom of its column.
  const columnRect = (column, index) => {
    const cards = columns[column];
    const left = columnX(column);
    const top = cardY(column, index);
    const bottom = cards.length
      ? cardY(column, cards.length - 1) + CARD_HEIGHT
      : top + CARD_HEIGHT;
    return { left, top, right: left + CARD_WIDTH, bottom };
  };
  const stockX = (pile) =>
    (layout.gap + CARD_WIDTH) * 9 + layout.margin - pile * 12;
  const stockRect = () => ({
    left: stockX(Math.ceil(stock.length / COLUMNS) - 1),
    top: bottomRow(),
    right: stockX(0) + CARD_WIDTH,
    bottom: layout.height - 10,
  });
  const scoreRect = () => ({
    left: Math.trunc((layout.width - 200) / 2),
    top: bottomRow(),
    right: Math.trunc((layout.width + 200) / 2),
    bottom: layout.height - 10,
  });
  const intersects = (first, second) =>
    Math.max(first.left, second.left) < Math.min(first.right, second.right) &&
    Math.max(first.top, second.top) < Math.min(first.bottom, second.bottom);

  // Squeezes each column's face-up step, from 28 down, until its last card
  // ends above the stock row. Columns whose step changes repaint.
  const squeeze = () => {
    if (layout.height < 107) return;
    columns.forEach((cards, column) => {
      if (!cards.length) return;
      const before = steps[column];
      steps[column] = 28;
      while (true) {
        const top = cardY(column, cards.length - 1);
        if (top + CARD_HEIGHT < bottomRow()) break;
        if (steps[column] < 16 && top < bottomRow() - 16) break;
        if (steps[column] < 1) break;
        steps[column] -= 1;
      }
      if (steps[column] !== before) repaint(column, 0);
    });
  };

  // Hit tests, as spider.exe makes them: a column includes the pixel past
  // its right edge.
  const columnAt = (x) => {
    if (x < layout.margin) return -2;
    const offset = x - layout.margin;
    const pitch = layout.gap + CARD_WIDTH;
    const column = Math.trunc(offset / pitch);
    return offset % pitch < 72 && column < COLUMNS ? column : -2;
  };
  const indexAt = (column, y) => {
    if (y < 10) return -2;
    const offset = y - 10;
    const cards = columns[column];
    if (!cards.length && offset <= 95) return -1;
    const down = faceDownCount(cards);
    const step = steps[column];
    if (offset < down * 7) return Math.trunc(offset / 7);
    const limit = (cards.length - down - 1) * step + down * 7;
    if (offset < limit) return Math.trunc((offset - down * 7) / step) + down;
    if (offset < limit + 96) return cards.length - 1;
    return -2;
  };

  // ---- Residue: corners drawn green until the column repaints ----
  const markResidue = (entry, top, bottom) => {
    const marked = residue.get(entry) ?? { top: false, bottom: false };
    residue.set(entry, {
      top: marked.top || top,
      bottom: marked.bottom || bottom,
    });
  };
  const repaint = (column, from) => {
    columns[column]
      .slice(Math.max(0, from))
      .forEach((entry) => residue.delete(entry));
  };
  const repaintAll = () => residue.clear();

  // ---- Drawing ----
  const greenCorners = (x, y, top, bottom) => {
    graphics.fillStyle = GREEN;
    if (top)
      for (const [cornerX, cornerY] of TOP_CORNERS)
        graphics.fillRect(x + cornerX, y + cornerY, 1, 1);
    if (bottom)
      for (const [cornerX, cornerY] of BOTTOM_CORNERS)
        graphics.fillRect(x + cornerX, y + cornerY, 1, 1);
  };
  const drawCard = (entry, x, y, top, bottom) => {
    if (!art) return;
    graphics.drawImage(
      entry.up ? art.faces[faceId(entry.card) - 1] : art.back,
      x,
      y,
    );
    greenCorners(x, y, top, bottom);
  };
  const drawEmpty = (x, y) => {
    if (!art) return;
    graphics.drawImage(art.empty, x, y);
    greenCorners(x, y, true, true);
  };
  const drawScoreBox = () => {
    const box = scoreRect();
    graphics.fillStyle = SCORE_GREEN;
    graphics.fillRect(
      box.left,
      box.top,
      box.right - box.left,
      box.bottom - box.top,
    );
    graphics.fillStyle = "#000";
    graphics.fillRect(box.left, box.top, box.right - box.left, 1);
    graphics.fillRect(box.left, box.bottom - 1, box.right - box.left, 1);
    graphics.fillRect(box.left, box.top, 1, box.bottom - box.top);
    graphics.fillRect(box.right - 1, box.top, 1, box.bottom - box.top);
    canvas.setAttribute(
      "aria-label",
      `Spider Solitaire. Score: ${score}. Moves: ${moves}.`,
    );
    if (!font) return;
    const rows = [
      ["Score:", String(score), box.top + 30],
      ["Moves:", String(moves), box.top + 50],
    ];
    for (const [label, value, y] of rows) {
      drawText(
        graphics,
        font,
        label,
        box.left + 100 - measureText(font, label),
        y,
        "#fff",
      );
      drawText(graphics, font, value, box.left + 110, y, "#fff");
    }
  };
  const drawBoard = () => {
    graphics.fillStyle = GREEN;
    graphics.fillRect(0, 0, layout.width, layout.height);
    if (art)
      for (let y = 0; y < layout.height; y += 64)
        for (let x = 0; x < layout.width; x += 63)
          graphics.drawImage(art.felt, x, y);
    // Empty slots first, right to left: an empty slot never covers the
    // column to its left when columns overlap.
    for (let column = COLUMNS - 1; column >= 0; column -= 1)
      if (!columns[column].length) drawEmpty(columnX(column), 10);
    columns.forEach((cards, column) => {
      const lifted = drag?.source === column ? drag.index : cards.length;
      for (let index = 0; index < lifted; index += 1) {
        if (flying?.hidden === cards[index]) continue;
        const entry = cards[index];
        const marked = residue.get(entry);
        // While cards are lifted, the card under them shows green bottom
        // corners.
        const exposed = drag?.source === column && index === lifted - 1;
        drawCard(
          entry,
          columnX(column),
          cardY(column, index),
          Boolean(marked?.top),
          Boolean(marked?.bottom) || exposed,
        );
      }
      if (drag?.source === column && lifted === 0)
        drawEmpty(columnX(column), 10);
    });
    drawScoreBox();
    const piles = Math.ceil(stock.length / COLUMNS);
    for (let pile = 0; pile < piles; pile += 1)
      drawCard({ up: false }, stockX(pile), bottomRow(), true, true);
    completed.forEach((suit, index) => {
      const landing = runPile && index === completed.length - 1;
      if (landing && !runPile.landed) return;
      drawCard(
        landing ? runPile.landed : { card: 12 * 4 + suit, up: true },
        layout.margin + index * 12,
        bottomRow(),
        true,
        true,
      );
    });
  };
  const draw = () => {
    prepareBoard(canvas, graphics, layout);
    if (fireworks) {
      drawFireworks();
      return;
    }
    drawBoard();
    if (drag) {
      const { left, top } = drag.rect;
      drag.cards.forEach((entry, index) =>
        drawCard(
          entry,
          left,
          top + index * drag.step,
          true,
          index === drag.cards.length - 1,
        ),
      );
    }
    if (flying) drawCard(flying.entry, flying.x, flying.y, true, true);
    if (peek)
      drawCard(
        columns[peek.column][peek.index],
        columnX(peek.column),
        cardY(peek.column, peek.index),
        true,
        true,
      );
    if (highlight) {
      // InvertRect.
      graphics.globalCompositeOperation = "difference";
      graphics.fillStyle = "#fff";
      const { left, top, right, bottom } = highlight;
      graphics.fillRect(left, top, right - left, bottom - top);
      graphics.globalCompositeOperation = "source-over";
    }
  };

  const resize = () => {
    measure();
    squeeze();
    repaintAll();
    draw();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  // ---- Timing: spider.exe sleeps through its animations ----
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve));
  const pause = async (milliseconds) => {
    const end = performance.now() + milliseconds;
    while (!unmounted && performance.now() < end) await nextFrame();
  };
  // A card slides for 100 ms from one spot to another.
  const fly = async (entry, from, to, extra = {}) => {
    flying = { entry, x: from.x, y: from.y, ...extra };
    const start = performance.now();
    while (!unmounted) {
      const elapsed = performance.now() - start;
      if (elapsed > 100) break;
      flying.x = from.x + Math.trunc(((to.x - from.x) * elapsed) / 100);
      flying.y = from.y + Math.trunc(((to.y - from.y) * elapsed) / 100);
      draw();
      await nextFrame();
    }
    flying = null;
  };

  // ---- Menus ----
  const enabled = (command) => {
    if (command === "restart") return playing;
    if (command === "undo") return undoStack.length > 0;
    if (command === "deal") return playing && stock.length > 0;
    if (command === "hint" || command === "save") return playing && !over;
    if (command === "open") return Boolean(readSavedGame());
    return true;
  };
  const menuButtons = [];
  const menuItems = new Map();
  const menus = wireMenuBar({
    windowElement: context.windowElement,
    bar: menuBar,
    showMenu: (button) => {
      const menu = document.createElement("div");
      menu.className = "tm-menu";
      menu.setAttribute("role", "menu");
      menu.style.left = `${button.offsetLeft}px`;
      menuItems.get(button).forEach((item) => {
        if (item === "-") {
          menu.insertAdjacentHTML(
            "beforeend",
            '<div class="tm-menu-separator"></div>',
          );
          return;
        }
        const [itemLabel, command, shortcut] = item;
        const entry = document.createElement("button");
        entry.type = "button";
        entry.setAttribute("role", "menuitem");
        entry.dataset.command = command;
        entry.disabled = !enabled(command);
        const text = document.createElement("span");
        context.setAccessKeyText(text, itemLabel);
        const key = document.createElement("kbd");
        key.textContent = shortcut;
        entry.append(text, key);
        entry.addEventListener("click", () => {
          menus.close();
          void run(command);
        });
        menu.append(entry);
      });
      menuBar.append(menu);
      return menu;
    },
    hideMenu: (menu) => menu.remove(),
  });
  const refreshMenuBar = () => {
    menuButtons.forEach((button) => {
      if (button.dataset.command)
        button.classList.toggle("disabled", !enabled(button.dataset.command));
    });
  };
  MENUS.forEach(([label, items]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.spiderMenu = label.replace(/[&!]/g, "").toLowerCase();
    context.setAccessKeyText(button, label);
    menuButtons.push(button);
    menuBar.append(button);
    if (typeof items === "string") {
      // Deal! runs straight from the menu bar.
      button.dataset.command = items;
      button.addEventListener("click", () => {
        menus.close();
        if (enabled(items)) void run(items);
      });
      return;
    }
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    menuItems.set(button, items);
  });

  // ---- Message boxes, with spider.exe's buttons and defaults ----
  const ask = (text, buttons, defaultButton, icon = "question") =>
    dialogs
      .message({ title: "Spider", text, icon, buttons, defaultButton })
      .then((result) => {
        repaintAll();
        draw();
        return result;
      });
  // Like XP's message box, Yes/No has a gray close button.
  const YES_NO = [
    { id: "yes", label: "&Yes" },
    { id: "no", label: "&No" },
  ];
  const YES_NO_CANCEL = [
    { id: "yes", label: "&Yes" },
    { id: "no", label: "&No" },
    { id: "cancel", label: "Cancel", isCancel: true },
  ];
  const OK = [{ id: "ok", label: "OK", isDefault: true, isCancel: true }];
  const confirm = async (text) => (await ask(text, YES_NO, "no")) === "yes";
  const tell = (text) => ask(text, OK, "ok", "none");

  // ---- Statistics ----
  const recordResult = (won) => {
    const record = stats();
    if (won) {
      record.current = record.winning ? record.current + 1 : 1;
      record.winning = true;
      record.mostWins = Math.max(record.mostWins, record.current);
      record.wins += 1;
    } else {
      record.current = record.winning ? 1 : record.current + 1;
      record.winning = false;
      record.mostLosses = Math.max(record.mostLosses, record.current);
      record.losses += 1;
    }
    saveSettings();
  };
  // Leaving a game counts as a loss once a card has moved.
  const abandon = () => {
    if (playing && !over && (moves > 0 || dealsDone() > 0)) recordResult(false);
  };
  // The high score climbs with the score, as spider.exe keeps it.
  const changeScore = (points) => {
    score = addScore(score, points);
    if (score > stats().high) {
      stats().high = score;
      saveSettings();
    }
  };

  // ---- Games ----
  const newGame = async (gameSeed = seedFromTime()) => {
    abandon();
    over = false;
    playing = true;
    seed = gameSeed;
    suits = settings.suits;
    const dealt = deal(seed, suits);
    columns = dealt.columns;
    stock = dealt.stock;
    completed = [];
    moves = 0;
    score = 0;
    changeScore(START_SCORE);
    undoStack = [];
    hints = null;
    drag = null;
    peek = null;
    repaintAll();
    refreshMenuBar();
    // Five face-down rows land at once; the face-up row flies in from the
    // stock, card by card.
    const faceUp = columns.map((cards) => cards.pop());
    stock.unshift(...faceUp.map(({ card }) => card));
    if (!settings.animate) {
      stock.splice(0, COLUMNS);
      faceUp.forEach((entry, column) => columns[column].push(entry));
      draw();
      return;
    }
    busy = true;
    for (let column = 0; column < COLUMNS; column += 1) {
      const from = {
        x: stockX(Math.ceil(stock.length / COLUMNS) - 1),
        y: bottomRow(),
      };
      stock.shift();
      const entry = faceUp[column];
      columns[column].push(entry);
      const to = {
        x: columnX(column),
        y: cardY(column, columns[column].length - 1),
      };
      await fly(entry, from, to, { hidden: entry });
      if (unmounted) return;
      markResidue(entry, true, true);
      playSound("deal");
    }
    busy = false;
    draw();
  };

  const pushUndo = (record) => {
    undoStack.push(record);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    refreshMenuBar();
  };
  const clearUndo = () => {
    undoStack = [];
    refreshMenuBar();
  };

  // Moves dragged cards, counting a move and taking a point. Lifting the
  // cards left the card under them with green corners.
  const applyMove = (source, index, target) => {
    const targetTop = Math.max(0, columns[target].length - 1);
    const below = columns[source][index - 1];
    const record = moveCards(columns, source, index, target);
    if (record.turned) repaint(source, index - 1);
    else if (below) markResidue(below, false, true);
    repaint(target, targetTop);
    pushUndo(record);
    moves += 1;
    changeScore(-1);
    hints = null;
    squeeze();
  };

  // Undoing a move counts as a move too.
  const undo = () => {
    const record = undoStack.pop();
    refreshMenuBar();
    const top = Math.max(0, columns[record.source].length - 1);
    repaint(record.target, record.targetIndex);
    undoMove(columns, record);
    repaint(record.source, top);
    moves += 1;
    changeScore(-1);
    hints = null;
    squeeze();
    draw();
  };

  // A finished run flies to the bottom-left, ace first, and scores 100.
  const takeRun = async (column) => {
    const cards = columns[column];
    const first = cards.length - 13;
    completed.push(suitOf(cards.at(-1).card));
    const pile = {
      x: layout.margin + (completed.length - 1) * 12,
      y: bottomRow(),
    };
    if (settings.animate) {
      // The new pile shows each card as it lands.
      runPile = { landed: null };
      for (let index = cards.length - 1; index >= first; index -= 1) {
        const entry = cards[index];
        const from = { x: columnX(column), y: cardY(column, index) };
        cards.splice(index);
        await fly(entry, from, pile);
        if (unmounted) return;
        runPile.landed = entry;
        playSound("deal");
      }
      runPile = null;
    } else {
      cards.splice(first);
      playSound("deal");
    }
    clearUndo();
    hints = null;
    changeScore(RUN_BONUS);
    squeeze();
    const uncovered = cards.at(-1);
    if (uncovered && !uncovered.up) {
      uncovered.up = true;
      repaint(column, cards.length - 1);
    }
    draw();
    if (columns.every((entries) => !entries.length)) await win();
  };

  const finishRuns = async (candidates) => {
    for (const column of candidates)
      if (!unmounted && hasCompleteRun(columns[column])) await takeRun(column);
  };

  // Deals a face-up card on every column, as long as none is empty.
  const dealNext = async () => {
    if (columns.some((cards) => !cards.length)) {
      await tell(
        "You are not allowed to deal a new row while there are any empty slots.",
      );
      return;
    }
    busy = true;
    if (!settings.animate) {
      playSound("deal");
      dealRow(columns, stock);
      columns.forEach((cards) => markResidue(cards.at(-1), true, true));
    } else {
      for (let column = 0; column < COLUMNS; column += 1) {
        const from = {
          x: stockX(Math.ceil(stock.length / COLUMNS) - 1),
          y: bottomRow(),
        };
        const entry = { card: stock.shift(), up: true };
        columns[column].push(entry);
        const to = {
          x: columnX(column),
          y: cardY(column, columns[column].length - 1),
        };
        await fly(entry, from, to, { hidden: entry });
        if (unmounted) return;
        markResidue(entry, true, true);
        playSound("deal");
      }
    }
    hints = null;
    clearUndo();
    squeeze();
    busy = false;
    draw();
    busy = true;
    await finishRuns(columns.map((_, column) => column));
    busy = false;
  };

  // Show An Available Move inverts the cards to move, then where they go.
  const showHint = async () => {
    if (!hints) {
      hints = findHints(columns);
      hintIndex = 0;
    }
    if (!hints.length) {
      playSound("noMoves");
      return;
    }
    playSound("hint");
    const next = hints[hintIndex];
    hintIndex = (hintIndex + 1) % hints.length;
    busy = true;
    for (const [column, index] of [
      [next.source, next.index],
      [next.target, next.targetIndex],
    ]) {
      highlight = columnRect(column, index);
      draw();
      await pause(250);
      highlight = null;
      draw();
    }
    busy = false;
  };

  // ---- Pointer ----
  const pointerPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / layout.width;
    return {
      x: Math.floor((event.clientX - rect.left) / scale),
      y: Math.floor((event.clientY - rect.top) / scale),
    };
  };
  const hitCard = (point) => {
    const column = columnAt(point.x);
    if (column < 0) return null;
    return { column, index: indexAt(column, point.y) };
  };

  canvas.addEventListener("pointerdown", () =>
    root.focus({ preventScroll: true }),
  );
  canvas.addEventListener("mousedown", (event) => {
    if (busy || fireworks) return;
    const point = pointerPoint(event);
    const hit = hitCard(point);
    if (event.button === 0) {
      if (peek || over || !hit) return;
      if (!canPickUp(columns[hit.column], hit.index)) return;
      playSound("pickUp");
      const rect = columnRect(hit.column, hit.index);
      drag = {
        source: hit.column,
        index: hit.index,
        cards: columns[hit.column].slice(hit.index),
        step: steps[hit.column],
        rect,
        offsetX: point.x - rect.left,
        offsetY: point.y - rect.top,
      };
      draw();
    } else if (event.button === 2) {
      // The right button shows a face-up card whole while it's held.
      if (drag || !hit || hit.index < 0) return;
      if (hit.index < faceDownCount(columns[hit.column])) return;
      peek = hit;
      draw();
    }
  });
  canvas.addEventListener("mousemove", (event) => {
    if (!drag || !(event.buttons & 1)) return;
    const point = pointerPoint(event);
    const left = point.x - drag.offsetX;
    const top = point.y - drag.offsetY;
    drag.rect = {
      left,
      top,
      right: left + CARD_WIDTH,
      bottom: top + (drag.rect.bottom - drag.rect.top),
    };
    draw();
  });

  // Dropped cards go to the first column, left to right under them, whose
  // top card they overlap and that takes them.
  const dropTarget = () => {
    const { rect, source, index } = drag;
    const first = columnAt(rect.left);
    let last = columnAt(rect.right);
    if (last < 0) last = Math.min(first + 1, COLUMNS - 1);
    for (let column = Math.max(0, first); column <= last; column += 1) {
      const top = columnRect(column, columns[column].length - 1);
      if (intersects(rect, top) && canDrop(columns, source, index, column))
        return column;
    }
    return -1;
  };
  const finishDrag = async () => {
    playSound("drop");
    const target = dropTarget();
    const { source, index } = drag;
    drag = null;
    if (target < 0) {
      repaint(source, index);
      draw();
      return;
    }
    applyMove(source, index, target);
    draw();
    busy = true;
    await finishRuns([target]);
    busy = false;
  };

  // Letting go of a held card or peek is heard anywhere, so releasing the
  // button off the board still ends it.
  const release = (event) => {
    if (busy || fireworks) return false;
    if (event.button === 2) {
      if (!peek) return false;
      // Letting go redraws the column from that card, green corners and
      // all.
      columns[peek.column]
        .slice(peek.index)
        .forEach((entry) => markResidue(entry, true, true));
      peek = null;
      draw();
      return true;
    }
    if (event.button !== 0 || !drag) return false;
    void finishDrag();
    return true;
  };
  const releaseOffBoard = (event) => {
    if (event.target !== canvas) release(event);
  };
  document.addEventListener("mouseup", releaseOffBoard);
  canvas.addEventListener("mouseup", (event) => {
    if (busy || fireworks || release(event) || event.button !== 0) return;
    const point = pointerPoint(event);
    if (over) return;
    const deck = stockRect();
    if (
      stock.length &&
      point.x > deck.left &&
      point.x < deck.right &&
      point.y > deck.top &&
      point.y < deck.bottom
    )
      void run("deal", true);
    const box = scoreRect();
    if (
      point.x >= box.left &&
      point.x < box.right &&
      point.y >= box.top &&
      point.y < box.bottom
    )
      void run("hint", true);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  // ---- Winning: fireworks behind the Game Over dialog ----
  const win = async () => {
    over = true;
    refreshMenuBar();
    recordResult(true);
    startFireworks();
    playSound("win");
    const { dialog } = template({
      title: "Game Over",
      size: [166, 69],
      position: ({ width, height }) => {
        const rect = context.windowElement.getBoundingClientRect();
        return {
          left: rect.right - width - 20,
          top: rect.bottom - height - 10,
        };
      },
      controls: [
        {
          type: "button",
          id: "yes",
          label: "&Yes",
          rect: [25, 48, 50, 14],
          isDefault: true,
        },
        { type: "button", id: "no", label: "&No", rect: [91, 48, 50, 14] },
        {
          type: "text",
          label: "Congratulations, you won!",
          rect: [7, 7, 152, 8],
        },
        {
          type: "text",
          label: "Do you want to start another game?",
          rect: [7, 23, 152, 8],
        },
      ],
    });
    // The fireworks go on after No, until the next command.
    dialog.onResult((result) => {
      if (result === "yes") void run("new");
    });
  };

  // Two bursts of 100 sparks: each rises for a second, then bursts and
  // falls through the air, fading by its own color.
  const GRAVITY = -6.8;
  const DRAG = 1.8;
  const createBurst = (random, start) => {
    const spread = () => (random() - random()) / 32767;
    const launch = [spread() * 20, 30, 0];
    const speed = (random() / 32767) * 10 + 20;
    const red = random() % 2;
    const green = random() % 2;
    let blue = random() % 2;
    if (red === 0 && green === 0) blue = 1;
    const rates = [red ? -2 : -150, green ? -2 : -150, blue ? -2 : -150];
    const sparks = Array.from({ length: 100 }, () => {
      const z = spread();
      const y = spread();
      const x = spread();
      const length = Math.hypot(x, y, z);
      const velocity = [x, y, z].map(
        (value, axis) => launch[axis] + (speed * value) / length,
      );
      return {
        position: [0, 0, 0],
        velocity,
        color: [0.1, 0.1, 0.1],
        size: 0.2,
        age: 0,
        life: (spread() * 0.125 + 1) * 4,
      };
    });
    return { start, launch, rates, sparks };
  };
  const updateBurst = (burst, now, random) => {
    const time = now - burst.start - 1;
    let finished = 0;
    for (const spark of burst.sparks) {
      if (time >= 0) {
        const slowed = (1 - Math.exp(-DRAG * time)) / DRAG ** 2;
        spark.position = spark.velocity.map((value, axis) => {
          const gravity = axis === 1 ? GRAVITY : 0;
          return (gravity * time) / DRAG + (value * DRAG + gravity) * slowed;
        });
        spark.age = time / spark.life;
        const fade = spark.age ** 2;
        spark.color = burst.rates.map((rate) => Math.exp(rate * fade));
        spark.size = Math.exp(-fade);
        if (spark.age >= 1) finished += 1;
      } else {
        const jitter = ((random() - random()) / 32767 + 1) * 0.05;
        spark.position = burst.launch.map(
          (value) => (value * (time - jitter)) / 1.5,
        );
      }
    }
    return finished;
  };
  const drawBurst = (burst) => {
    const { width, height } = layout;
    const scale = Math.trunc(Math.min(width, height) / 50);
    for (const spark of burst.sparks) {
      if (spark.age >= 1) continue;
      const x = Math.trunc(width / 2) + Math.trunc(spark.position[0] * scale);
      const y =
        height - Math.trunc(height / 2) - Math.trunc(spark.position[1] * scale);
      const half = Math.trunc(Math.trunc(spark.size * 12) / 2);
      const { fill, outline } = circlePixels(half * 2);
      const [red, green, blue] = spark.color.map((value) =>
        Math.trunc(value * 255),
      );
      graphics.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      for (const [pixelX, pixelY] of fill)
        graphics.fillRect(x - half + pixelX, y - half + pixelY, 1, 1);
      graphics.fillStyle = "#000";
      for (const [pixelX, pixelY] of outline)
        graphics.fillRect(x - half + pixelX, y - half + pixelY, 1, 1);
    }
  };
  // "You Won!" cycles through the hues every ten seconds.
  const wonColor = (elapsed) => {
    const hue = ((elapsed % 10000) / 10000) * 6;
    const sector = Math.floor(hue);
    const rise = hue - sector;
    const fall = 1 - rise;
    const [red, green, blue] = [
      [1, rise, 0],
      [fall, 1, 0],
      [0, 1, rise],
      [0, fall, 1],
      [rise, 0, 1],
      [1, 0, fall],
    ][sector].map((value) => Math.trunc(value * 255));
    return `rgb(${red}, ${green}, ${blue})`;
  };
  const drawFireworks = () => {
    drawBoard();
    const now = performance.now();
    graphics.font = "bold 64px Arial";
    graphics.textAlign = "center";
    graphics.textBaseline = "alphabetic";
    graphics.fillStyle = wonColor(now - fireworks.began);
    graphics.fillText(
      "You Won!",
      Math.trunc(layout.width / 2),
      Math.trunc((layout.height - 74) / 2) + 58,
    );
    graphics.textAlign = "start";
    for (const burst of fireworks.bursts) drawBurst(burst);
  };
  const startFireworks = async () => {
    const random = createRandom(Date.now() & 0x7fffffff);
    const now = performance.now();
    const show = {
      began: now,
      random,
      bursts: [
        createBurst(random, now / 1000),
        createBurst(random, now / 1000),
      ],
      stop: false,
    };
    fireworks = show;
    while (!unmounted && !show.stop) {
      const seconds = performance.now() / 1000;
      show.bursts = show.bursts.map((burst) =>
        updateBurst(burst, seconds, random) === 100
          ? createBurst(random, seconds)
          : burst,
      );
      draw();
      await nextFrame();
    }
  };
  const stopFireworks = () => {
    if (!fireworks) return;
    fireworks.stop = true;
    fireworks = null;
    repaintAll();
    draw();
  };

  // ---- Dialogs ----
  const template = (options) =>
    openTemplateDialog({
      dialogs,
      setAccessKeyText: context.setAccessKeyText,
      owner: { window: context.windowElement, client: canvas },
      ...options,
    });
  // DS_CENTER: the middle of the desktop's work area.
  const centered = ({ width, height }) => {
    const desktop = context.getDesktopSize();
    return {
      left: Math.trunc((desktop.width - width) / 2),
      top: Math.trunc((desktop.height - height) / 2),
    };
  };
  const afterDialog = (dialog) =>
    dialog.onResult(() => {
      repaintAll();
      draw();
    });

  const chooseDifficulty = async () => {
    if (moves > 0 && playing && !over) {
      const answer = await ask(
        "Do you want to save this game before closing it?",
        YES_NO_CANCEL,
        "cancel",
      );
      if (answer === "cancel") return;
      // A save that's declined or fails keeps the game in play.
      if (answer === "yes" && !(await saveGame())) return;
    }
    const { dialog, elements } = template({
      title: "Difficulty",
      size: [197, 109],
      position: centered,
      controls: [
        {
          type: "text",
          label: "Select the game difficulty level that you want:",
          rect: [7, 7, 183, 19],
        },
        { type: "image", src: SUIT_ICONS.diamond, rect: [17, 62, 20, 20] },
        { type: "image", src: SUIT_ICONS.club, rect: [26, 62, 20, 20] },
        { type: "image", src: SUIT_ICONS.heart, rect: [35, 46, 20, 20] },
        { type: "image", src: SUIT_ICONS.heart, rect: [35, 62, 20, 20] },
        { type: "image", src: SUIT_ICONS.spade, rect: [44, 30, 20, 20] },
        { type: "image", src: SUIT_ICONS.spade, rect: [44, 46, 20, 20] },
        { type: "image", src: SUIT_ICONS.spade, rect: [44, 62, 20, 20] },
        {
          type: "radio",
          id: "easy",
          group: "difficulty",
          label: "&Easy: One Suit",
          rect: [52, 29, 138, 10],
        },
        {
          type: "radio",
          id: "medium",
          group: "difficulty",
          label: "&Medium: Two Suits",
          rect: [52, 45, 138, 10],
        },
        {
          type: "radio",
          id: "difficult",
          group: "difficulty",
          label: "&Difficult: Four Suits",
          rect: [52, 61, 138, 10],
        },
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [40, 88, 50, 14],
          isDefault: true,
        },
        {
          type: "button",
          id: "cancel",
          label: "Cancel",
          rect: [106, 88, 50, 14],
        },
      ],
    });
    elements[DIFFICULTIES[settings.suits]].checked = true;
    afterDialog(dialog);
    const result = await new Promise((resolve) => dialog.onResult(resolve));
    if (result !== "ok") return;
    settings.suits = elements.easy.checked
      ? 1
      : elements.medium.checked
        ? 2
        : 4;
    saveSettings();
    await newGame();
  };

  const showStatistics = () => {
    const { dialog, elements } = template({
      title: "Spider Statistics",
      size: [167, 198],
      position: centered,
      controls: [
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [22, 177, 50, 14],
          isDefault: true,
        },
        {
          type: "button",
          id: "reset",
          label: "&Reset",
          rect: [88, 177, 50, 14],
        },
        { type: "text", id: "page", label: "", rect: [7, 7, 153, 163] },
        { type: "group", label: "High Score", rect: [15, 25, 137, 24] },
        { type: "text", id: "high", label: "", rect: [26, 35, 107, 11] },
        { type: "group", label: "Percentage", rect: [15, 52, 137, 55] },
        { type: "text", id: "wins", label: "", rect: [26, 65, 107, 11] },
        { type: "text", id: "losses", label: "", rect: [26, 78, 107, 11] },
        { type: "text", id: "rate", label: "", rect: [26, 91, 107, 11] },
        { type: "group", label: "Streaks", rect: [15, 110, 137, 55] },
        { type: "text", id: "mostWins", label: "", rect: [26, 122, 107, 11] },
        {
          type: "text",
          id: "mostLosses",
          label: "",
          rect: [26, 136, 107, 11],
        },
        { type: "text", id: "current", label: "", rect: [26, 150, 107, 11] },
      ],
    });
    // The tab control's page starts under its 20-pixel tabs.
    elements.page.className = "xp-template-control spider-stats-page";
    elements.page.style.top = `${dialogUnitsY(7) + 20}px`;
    elements.page.style.height = `${dialogUnitsY(163) - 20}px`;
    const tabs = document.createElement("div");
    tabs.className = "spider-stats-tabs";
    tabs.setAttribute("role", "tablist");
    let shown = DIFFICULTIES[suits];
    // Each line's value sits at its tab stop, 80 pixels in.
    const line = (element, label, value) => {
      const number = document.createElement("span");
      number.className = "spider-stats-value";
      number.textContent = String(value);
      element.replaceChildren(label, number);
    };
    const fill = () => {
      const record = settings.stats[shown];
      const games = record.wins + record.losses;
      line(elements.high, "", record.high);
      line(elements.wins, "Wins:", record.wins);
      line(elements.losses, "Losses:", record.losses);
      line(
        elements.rate,
        "Win Rate:",
        `${games ? Math.trunc((record.wins * 100) / games) : 0} %`,
      );
      line(elements.mostWins, "Most Wins:", record.mostWins);
      line(elements.mostLosses, "Most Losses:", record.mostLosses);
      line(
        elements.current,
        "Current:",
        `${record.current} ${record.winning ? "Wins" : "Losses"}`,
      );
      tabs
        .querySelectorAll("button")
        .forEach((tab) =>
          tab.setAttribute("aria-selected", String(tab.dataset.tab === shown)),
        );
    };
    for (const [name, label] of [
      ["easy", "Easy"],
      ["medium", "Medium"],
      ["difficult", "Difficult"],
    ]) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.dataset.tab = name;
      tab.textContent = label;
      tab.addEventListener("click", () => {
        shown = name;
        fill();
      });
      tabs.append(tab);
    }
    elements.page.before(tabs);
    for (const id of [
      "high",
      "wins",
      "losses",
      "rate",
      "mostWins",
      "mostLosses",
      "current",
    ])
      elements[id].classList.add("spider-stats-text");
    fill();
    afterDialog(dialog);
    const close = dialog.close;
    dialog.close = async (result) => {
      if (result !== "reset") {
        close(result);
        return;
      }
      if (
        await confirm("Are you sure you want to reset all game statistics?")
      ) {
        Object.keys(settings.stats).forEach((name) => {
          settings.stats[name] = emptyStats();
        });
        // A game in play keeps its score as the high score.
        if (playing && !over) stats().high = score;
        saveSettings();
        fill();
      }
    };
  };

  const showOptions = () => {
    const boxes = [
      ["animate", "&Animate when dealing cards"],
      ["saveOnExit", "Automatically &save game on exit"],
      ["loadAtStart", "Automatically &open previous game at startup"],
      ["promptSave", "&Prompt before saving a game"],
      ["promptLoad", "Prompt &before opening a saved game"],
      ["sound", "Use sound &effects"],
    ];
    const { dialog, elements } = template({
      title: "Spider Options",
      size: [199, 140],
      position: centered,
      help: true,
      controls: [
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [41, 119, 50, 14],
          isDefault: true,
        },
        {
          type: "button",
          id: "cancel",
          label: "Cancel",
          rect: [107, 119, 50, 14],
        },
        ...boxes.map(([id, label], index) => ({
          type: "checkbox",
          id,
          label,
          rect: [9, 9 + index * 17, 174, 14],
        })),
      ],
    });
    boxes.forEach(([id]) => {
      elements[id].checked = settings[id];
    });
    afterDialog(dialog);
    dialog.onResult((result) => {
      if (result !== "ok") return;
      boxes.forEach(([id]) => {
        settings[id] = elements[id].checked;
      });
      saveSettings();
    });
  };

  const showAbout = () => {
    const { dialog } = template({
      title: "About Spider",
      size: [253, 183],
      position: centered,
      controls: [
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [102, 162, 50, 14],
          isDefault: true,
        },
      ],
    });
    // The art and copyright are painted in client pixels.
    const picture = document.createElement("img");
    picture.className = "spider-about-art";
    picture.src = ABOUT_URL;
    picture.alt = "";
    const copyright = document.createElement("div");
    copyright.className = "spider-about-text";
    copyright.textContent =
      "© 1998-2000 Microsoft Corporation.  \nAll rights reserved.";
    dialog.body.prepend(picture, copyright);
    afterDialog(dialog);
  };

  // ---- Saved games ----
  const saveGame = async () => {
    if (
      settings.promptSave &&
      readSavedGame() &&
      !(await confirm(
        "A saved game already exists.  Are you sure you want to replace your previously saved game with your current game?",
      ))
    )
      return false;
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          suits,
          seed,
          columns,
          stock,
          completed,
          moves,
          score,
        }),
      );
    } catch {
      await tell("Unable to save game.");
      return false;
    }
    refreshMenuBar();
    return true;
  };

  const openGame = async (prompt = true) => {
    // Open is only offered while a readable save exists.
    const saved = readSavedGame();
    if (
      prompt &&
      playing &&
      !over &&
      settings.promptLoad &&
      !(await confirm(
        "Are you sure you want to discard the game you are currently playing, and load your previously saved game?",
      ))
    )
      return;
    stopFireworks();
    settings.suits = saved.suits;
    saveSettings();
    suits = saved.suits;
    seed = saved.seed;
    columns = cloneColumns(saved.columns);
    stock = [...saved.stock];
    completed = [...saved.completed];
    moves = saved.moves;
    score = Math.max(0, saved.score);
    over = false;
    playing = true;
    undoStack = [];
    hints = null;
    refreshMenuBar();
    squeeze();
    repaintAll();
    draw();
  };

  // ---- Commands ----
  // `direct` commands come from clicks on the table, which spider.exe posts
  // whether or not the menu item is enabled.
  const run = async (command, direct = false) => {
    if (busy) return;
    if (!direct && !enabled(command)) return;
    stopFireworks();
    if (command === "new") {
      if (
        (moves === 0 && dealsDone() === 0) ||
        over ||
        (await confirm("Are you sure you want to start a new game?"))
      )
        await newGame();
    } else if (command === "restart") {
      if (
        (moves > 0 || dealsDone() > 0) &&
        (await confirm(
          "Are you sure you want to restart this game from the beginning?",
        ))
      )
        await newGame(seed);
    } else if (command === "undo") undo();
    else if (command === "deal") await dealNext();
    else if (command === "hint") await showHint();
    else if (command === "difficulty") await chooseDifficulty();
    else if (command === "statistics") showStatistics();
    else if (command === "options") showOptions();
    else if (command === "save") await saveGame();
    else if (command === "open") await openGame();
    else if (command === "about") showAbout();
    else if (command === "exit") context.close();
  };

  // spider.exe's accelerators. A letter follows the keyboard layout, like
  // Windows.
  const letter = (event) => globalThis.XPDialogs.shortcutKeyOf(event);
  const KEYS = [
    [(event) => event.key === "F1", "contents"],
    [(event) => event.key === "F2", "new"],
    [(event) => event.ctrlKey && letter(event) === "n", "new"],
    [(event) => event.key === "F3", "difficulty"],
    [(event) => event.key === "F4" && !event.altKey, "statistics"],
    [(event) => event.key === "F5", "options"],
    [(event) => event.ctrlKey && letter(event) === "z", "undo"],
    [(event) => event.ctrlKey && letter(event) === "s", "save"],
    [(event) => event.ctrlKey && letter(event) === "o", "open"],
    [(event) => letter(event) === "d", "deal"],
    [(event) => letter(event) === "m", "hint"],
  ];
  const handleKeydown = (event) => {
    if (globalThis.XPDialogs.isModalOpen()) return;
    if (menus.isOpen()) {
      if (event.key === "Escape") menus.close();
      return;
    }
    // Ctrl+Esc and Alt+Esc belong to the shell.
    if (event.key === "Escape" && !event.ctrlKey && !event.altKey) {
      // Esc hides Spider, the boss key.
      event.preventDefault();
      context.minimize();
      return;
    }
    const plain = !event.ctrlKey && !event.altKey && !event.shiftKey;
    const match = KEYS.find(
      ([test, command]) =>
        test(event) &&
        (["deal", "hint"].includes(command) ? plain : !event.shiftKey),
    );
    if (!match) return;
    event.preventDefault();
    void run(match[1]);
  };
  context.windowElement.addEventListener("keydown", handleKeydown);

  // ---- Start: the Difficulty dialog, or the saved game ----
  context.setTitle("Spider");
  measure();
  refreshMenuBar();
  void Promise.all([loadArt(), loadSystemFont()])
    .then(([loadedArt, loadedFont]) => {
      art = loadedArt;
      font = loadedFont;
      draw();
    })
    .catch((error) => dialogs.alert(error.message, "Spider", "error"));
  draw();
  queueMicrotask(() => {
    root.focus({ preventScroll: true });
    if (settings.loadAtStart && readSavedGame()) void openGame(false);
    else void chooseDifficulty();
  });

  // Closing asks to save a game in play.
  const beforeClose = async () => {
    if (!playing || over) return true;
    if (settings.saveOnExit) {
      if (!(await saveGame())) abandon();
      return true;
    }
    const answer = await ask(
      "Do you want to save this game before closing it?",
      YES_NO_CANCEL,
      "cancel",
    );
    if (answer === "cancel") return false;
    if (answer === "yes") return saveGame();
    abandon();
    return true;
  };

  return {
    element: root,
    beforeClose,
    unmount() {
      unmounted = true;
      if (fireworks) fireworks.stop = true;
      currentSound?.pause();
      resizeObserver.disconnect();
      document.removeEventListener("mouseup", releaseOffBoard);
      context.windowElement.removeEventListener("keydown", handleKeydown);
    },
  };
};

export const spiderApplication = defineApplication({
  ...applicationMetadata,
  mount: mountSpider,
});
