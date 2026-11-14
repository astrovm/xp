import { applicationMetadata } from "./metadata.js";
import { defineApplication } from "../core/application.js";
import { wireMenuBar } from "../core/menu-bar.js";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  loadCardFaces,
  measureBoard,
  prepareBoard,
} from "../cards/cards.js";
import { openTemplateDialog } from "../cards/template-dialog.js";
import {
  EMPTY,
  FREE_CELLS,
  canMoveToCell,
  canStack,
  cardAt,
  cardsLeft,
  cloneBoard,
  deal,
  emptyColumnCount,
  freeCellCount,
  isValidGameNumber,
  maxMovable,
  planAutoMoves,
  planColumnMove,
  randomGameNumber,
  remainingMoves,
  applyStep,
  revertStep,
  runLength,
} from "./game.js";

const SETTINGS_KEY = "freecellSettings";
const STATISTICS_KEY = "freecellStatistics";
const GREEN = "#007f00";
const LIGHT_GREEN = "#00ff00";
const KINGS = {
  right: "assets/xp/freecell/KingRight.png",
  left: "assets/xp/freecell/KingLeft.png",
  smile: "assets/xp/freecell/KingSmile.png",
};
const MENUS = [
  [
    "&Game",
    [
      ["&New Game", "new", "F2"],
      ["&Select Game", "select", "F3"],
      ["&Restart Game", "restart"],
      "-",
      ["S&tatistics...", "statistics", "F4"],
      ["&Options...", "options", "F5"],
      "-",
      ["&Undo", "undo", "F10"],
      "-",
      ["E&xit", "exit"],
    ],
  ],
  ["&Help", [["&About FreeCell...", "about"]]],
];
const KEY_COMMANDS = {
  F2: "new",
  F3: "select",
  F4: "statistics",
  F5: "options",
  F10: "undo",
};

const readJson = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Settings stay for this session when storage is unavailable.
  }
};
const flag = (value, fallback) =>
  typeof value === "boolean" ? value : fallback;
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

// Options and statistics, kept where freecell.exe keeps its registry
// values.
const readSettings = () => {
  const saved = readJson(SETTINGS_KEY);
  return {
    messages: flag(saved.messages, true),
    quick: flag(saved.quick, false),
    doubleClick: flag(saved.doubleClick, true),
  };
};
const readStatistics = () => {
  const saved = readJson(STATISTICS_KEY);
  return {
    won: count(saved.won),
    lost: count(saved.lost),
    streak: count(saved.streak),
    streakType: saved.streakType === "won" ? "won" : "lost",
    wins: count(saved.wins),
    losses: count(saved.losses),
  };
};

const percent = (won, lost) =>
  won + lost ? Math.floor((won * 100) / (won + lost)) : 0;

const loadImage = (src) => {
  const image = new Image();
  image.src = src;
  return image;
};

const mountFreeCell = (context) => {
  const { dialogs } = context;
  const root = document.createElement("div");
  root.className = "xp-native-program xp-freecell";
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="cards-menu-bar" role="menubar"></div>
    <span class="freecell-cards-left" aria-live="polite"></span>
    <canvas class="freecell-board" role="application" aria-label="FreeCell"></canvas>`;
  const menuBar = root.querySelector(".cards-menu-bar");
  const cardsLeftLabel = root.querySelector(".freecell-cards-left");
  const canvas = root.querySelector("canvas");
  const graphics = canvas.getContext("2d");
  const kings = Object.fromEntries(
    Object.entries(KINGS).map(([name, src]) => [name, loadImage(src)]),
  );
  Object.values(kings).forEach((image) =>
    image.addEventListener("load", () => draw()),
  );

  let settings = readSettings();
  let statistics = readStatistics();
  const session = { won: 0, lost: 0 };
  let faces = null;
  let board = null;
  // The game being played, 0 once it's over.
  let gameNumber = 0;
  // The last game counted in the statistics, so replays count once.
  let countedGame = 0;
  let lastGame = 0;
  let inProgress = false;
  let selectGameNext = false;
  let selection = null;
  let undoSteps = null;
  let king = "right";
  let won = false;
  let busy = false;
  let revealed = null;
  let moving = null;
  let flashTimer = null;
  let layout = null;
  // Ctrl+Shift+F10's hidden choice for the next move: "win" or "lose".
  let outcome = null;

  // ---- Layout, from freecell.exe's client width ----
  const measure = () => {
    const { width, height } = measureBoard(canvas, CARD_WIDTH * 8);
    const small = window.screen.height < 351;
    const gap = Math.max(0, Math.floor((width - CARD_WIDTH * 8) / 9));
    const columns = Array.from(
      { length: 8 },
      (_, index) => Math.floor((index * (width - gap)) / 8) + gap,
    );
    const step = Math.floor((CARD_HEIGHT * 9) / 46);
    layout = {
      width,
      height,
      columns,
      homeLeft: width - CARD_WIDTH * 4,
      top: CARD_HEIGHT + (small ? 4 : 10),
      step: small ? Math.floor((step * 4) / 5) : step,
      kingX: Math.floor((width - 32) / 2),
      kingY: Math.floor((CARD_HEIGHT - 32) / 3),
      small,
    };
  };

  const placePosition = ({ column, row }) => {
    if (column === 0)
      return {
        x:
          row < FREE_CELLS
            ? CARD_WIDTH * row
            : layout.homeLeft + CARD_WIDTH * (row - FREE_CELLS),
        y: 0,
      };
    return {
      x: layout.columns[column - 1],
      y: layout.top + layout.step * row,
    };
  };

  // The card position under the pointer. Clicks below or beside a column
  // still name that column, as in freecell.exe.
  const hitTest = (x, y) => {
    if (y < CARD_HEIGHT) {
      if (x < CARD_WIDTH * 4)
        return { column: 0, row: Math.floor(x / CARD_WIDTH), hit: true };
      const home = x - layout.homeLeft;
      if (home >= 0 && home < CARD_WIDTH * 4)
        return {
          column: 0,
          row: FREE_CELLS + Math.floor(home / CARD_WIDTH),
          hit: true,
        };
      return null;
    }
    if (y < layout.top || x < layout.columns[0]) return null;
    const pitch = layout.columns[1] - layout.columns[0];
    const column = Math.floor((x - layout.columns[0]) / pitch) + 1;
    if (column > 8) return null;
    const cards = board.columns[column - 1];
    if (!cards.length || x > layout.columns[column - 1] + CARD_WIDTH)
      return { column, row: cards.length - 1, hit: false };
    const row = Math.min(Math.floor((y - layout.top) / layout.step), 21);
    if (row < cards.length - 1) return { column, row, hit: true };
    const last = cards.length - 1;
    return {
      column,
      row: last,
      hit: y - layout.top <= last * layout.step + CARD_HEIGHT,
    };
  };

  // ---- Drawing ----
  const drawEmptyCell = (x, y) => {
    graphics.fillStyle = GREEN;
    graphics.fillRect(x, y, CARD_WIDTH, CARD_HEIGHT);
    graphics.fillStyle = "#000";
    graphics.fillRect(x, y + 1, 1, CARD_HEIGHT - 2);
    graphics.fillRect(x, y, CARD_WIDTH - 1, 1);
    graphics.fillStyle = LIGHT_GREEN;
    graphics.fillRect(x + CARD_WIDTH - 1, y + 1, 1, CARD_HEIGHT - 2);
    graphics.fillRect(x + 1, y + CARD_HEIGHT - 1, CARD_WIDTH - 1, 1);
  };
  const drawCard = (card, x, y, inverted = false) => {
    if (!faces) return;
    graphics.drawImage(faces[card][inverted ? "inverted" : "normal"], x, y);
  };
  const isSelected = (place) =>
    selection &&
    selection.column === place.column &&
    selection.row === place.row;

  const draw = () => {
    prepareBoard(canvas, graphics, layout);
    graphics.fillStyle = GREEN;
    graphics.fillRect(0, 0, layout.width, layout.height);
    const shown = moving ? moving.board : board;
    for (let row = 0; row < 8; row += 1) {
      const { x, y } = placePosition({ column: 0, row });
      const card = shown.cells[row];
      if (card === EMPTY) drawEmptyCell(x, y);
      else drawCard(card, x, y, isSelected({ column: 0, row }));
    }
    // King box: a light top-left edge and a black bottom-right edge.
    const { kingX, kingY } = layout;
    graphics.fillStyle = LIGHT_GREEN;
    graphics.fillRect(kingX - 3, kingY - 2, 1, 36);
    graphics.fillRect(kingX - 3, kingY - 3, 37, 1);
    graphics.fillStyle = "#000";
    graphics.fillRect(kingX + 34, kingY - 2, 1, 36);
    graphics.fillRect(kingX - 2, kingY + 34, 37, 1);
    if (!won && kings[king].complete)
      graphics.drawImage(kings[king], kingX, kingY);
    shown.columns.forEach((cards, index) =>
      cards.forEach((card, row) => {
        const place = { column: index + 1, row };
        const { x, y } = placePosition(place);
        drawCard(card, x, y, isSelected(place));
      }),
    );
    if (revealed) {
      const { x, y } = placePosition(revealed);
      drawCard(board.columns[revealed.column - 1][revealed.row], x, y);
    }
    if (moving) drawCard(moving.card, moving.x, moving.y);
    if (won) {
      const size = layout.small ? [256, 192] : [320, 320];
      graphics.drawImage(kings.smile, 10, CARD_HEIGHT + 10, ...size);
    }
  };

  const resize = () => {
    measure();
    draw();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  // ---- Status ----
  const showCardsLeft = () => {
    cardsLeftLabel.textContent = `Cards Left: ${cardsLeft(board)}`;
  };

  // ---- Menus, styled like Task Manager's ----
  const commandEnabled = (command) =>
    command === "restart"
      ? Boolean(lastGame || gameNumber)
      : command === "undo"
        ? Boolean(undoSteps)
        : true;
  const buildMenu = (items) => {
    const menu = document.createElement("div");
    menu.className = "tm-menu";
    menu.setAttribute("role", "menu");
    items.forEach((item) => {
      if (item === "-") {
        menu.insertAdjacentHTML(
          "beforeend",
          '<div class="tm-menu-separator"></div>',
        );
        return;
      }
      const [itemLabel, command, shortcut = ""] = item;
      const entry = document.createElement("button");
      entry.type = "button";
      entry.setAttribute("role", "menuitem");
      entry.dataset.command = command;
      entry.disabled = !commandEnabled(command);
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
    return menu;
  };
  const menuItems = new Map();
  const menus = wireMenuBar({
    windowElement: context.windowElement,
    bar: menuBar,
    showMenu: (button) => {
      const menu = buildMenu(menuItems.get(button));
      menu.style.left = `${button.offsetLeft}px`;
      menuBar.append(menu);
      return menu;
    },
    hideMenu: (menu) => menu.remove(),
  });
  MENUS.forEach(([label, items]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.dataset.freecellMenu = label.replace(/&/g, "").toLowerCase();
    context.setAccessKeyText(button, label);
    menuItems.set(button, items);
    menuBar.append(button);
  });

  // ---- Statistics ----
  const saveStatistics = () => writeJson(STATISTICS_KEY, statistics);
  const recordResult = (result) => {
    if (gameNumber <= 0 || gameNumber === countedGame) {
      countedGame = gameNumber;
      return;
    }
    countedGame = gameNumber;
    statistics[result] += 1;
    session[result] += 1;
    statistics.streak =
      statistics.streakType === result ? statistics.streak + 1 : 1;
    statistics.streakType = result;
    const best = result === "won" ? "wins" : "losses";
    statistics[best] = Math.max(statistics[best], statistics.streak);
    saveStatistics();
  };

  const template = (options) =>
    openTemplateDialog({
      dialogs,
      setAccessKeyText: context.setAccessKeyText,
      owner: { window: context.windowElement, client: canvas },
      ...options,
    });

  // ---- Games ----
  const startGame = (number) => {
    stopFlashing();
    gameNumber = number;
    lastGame = number;
    board = deal(number);
    inProgress = true;
    won = false;
    selection = null;
    undoSteps = null;
    king = "right";
    context.setTitle(`FreeCell Game #${number}`);
    showCardsLeft();
    draw();
  };

  // Asks for a game number until it's valid. Cancel keeps the current game.
  const askGameNumber = () =>
    new Promise((resolve) => {
      const { dialog, elements } = template({
        title: "Game Number",
        size: [120, 75],
        help: true,
        controls: [
          {
            type: "text",
            label: "Select a game number",
            rect: [0, 7, 121, 8],
            center: true,
          },
          {
            type: "text",
            label: "from 1 to 1000000",
            rect: [0, 17, 121, 8],
            center: true,
          },
          {
            type: "edit",
            id: "number",
            label: "Game number",
            rect: [45, 32, 40, 12],
          },
          {
            type: "button",
            id: "ok",
            label: "OK",
            rect: [40, 54, 40, 14],
            isDefault: true,
          },
        ],
      });
      const input = elements.number;
      input.value = String(randomGameNumber());
      dialog.onResult((result) => {
        if (result !== "ok") return resolve(null);
        const number = Number(input.value.trim());
        resolve(isValidGameNumber(number) ? number : askGameNumber());
      });
      input.focus();
      input.select();
    });

  // Leaving a game in progress counts as a loss once confirmed.
  const confirmResign = async () => {
    if (!inProgress) return true;
    const accepted = await dialogs.confirm(
      "Do you want to resign this game?",
      "FreeCell",
      "question",
    );
    if (accepted) {
      recordResult("lost");
      inProgress = false;
    }
    return accepted;
  };

  const newGame = async (mode, number) => {
    if (busy) return;
    if (!(await confirmResign())) return;
    if (mode === "select") {
      selectGameNext = true;
      const chosen = await askGameNumber();
      if (chosen === null) return;
      startGame(chosen);
    } else {
      if (mode === "new") selectGameNext = false;
      startGame(number ?? randomGameNumber());
    }
  };

  // ---- Moves ----
  const frame = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  // Takes a card off a place. A card leaving home uncovers the one below.
  const takeCard = (work, place) => {
    if (place.column) return work.columns[place.column - 1].pop();
    const card = work.cells[place.row];
    work.cells[place.row] =
      place.row >= FREE_CELLS && card >= 4 ? card - 4 : EMPTY;
    return card;
  };
  const positionOf = (work, place, offset) =>
    placePosition(
      place.column
        ? {
            column: place.column,
            row: work.columns[place.column - 1].length + offset,
          }
        : place,
    );

  // Slides each card along a straight line, one step per frame, with a
  // step for every 37 pixels of travel.
  const animate = async (steps, reverse = false) => {
    for (const step of steps) {
      const source = reverse ? step.to : step.from;
      const target = reverse ? step.from : step.to;
      const start = positionOf(board, source, -1);
      const work = cloneBoard(board);
      const card = takeCard(work, source);
      const end = positionOf(work, target, 0);
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const frames = settings.quick ? 1 : Math.floor(distance / 37);
      for (let index = 1; index < frames; index += 1) {
        moving = {
          board: work,
          card,
          x: start.x + Math.trunc(((end.x - start.x) * index) / frames),
          y: start.y + Math.trunc(((end.y - start.y) * index) / frames),
        };
        draw();
        await frame();
      }
      moving = null;
      if (reverse) revertStep(board, step);
      else {
        applyStep(board, step);
        if (target.column === 0)
          king = target.row < FREE_CELLS ? "left" : "right";
      }
      showCardsLeft();
      draw();
    }
  };

  const stopFlashing = () => {
    clearInterval(flashTimer);
    flashTimer = null;
    context.windowElement.classList.remove("freecell-flash");
  };
  // One move left: FlashWindow every 400 ms, four times, then back to
  // normal.
  const warnLastMove = () => {
    stopFlashing();
    let ticks = 4;
    flashTimer = setInterval(() => {
      ticks -= 1;
      if (!ticks) stopFlashing();
      else context.windowElement.classList.toggle("freecell-flash");
    }, 400);
  };

  // Game Over asks to play again. Winning offers the Select Game dialog;
  // losing offers the same game.
  const askPlayAgain = (won) => {
    const { dialog, elements } = template({
      title: "Game Over",
      size: won ? [135, 80] : [135, 90],
      position: won ? [172, 85] : "center",
      systemMenu: false,
      controls: won
        ? [
            {
              type: "text",
              label: "Congratulations, you win!\n \nDo you want to play again?",
              rect: [15, 8, 105, 31],
              center: true,
            },
            {
              type: "button",
              id: "yes",
              label: "&Yes",
              rect: [15, 58, 40, 14],
              isDefault: true,
            },
            { type: "button", id: "no", label: "&No", rect: [80, 58, 40, 14] },
            {
              type: "checkbox",
              id: "choice",
              label: "&Select game",
              rect: [15, 43, 63, 12],
            },
          ]
        : [
            {
              type: "text",
              label:
                "Sorry, you lose.There are no more legal moves.\nDo you want to play again?",
              rect: [15, 6, 120, 40],
            },
            {
              type: "button",
              id: "yes",
              label: "&Yes",
              rect: [15, 70, 40, 14],
              isDefault: true,
            },
            { type: "button", id: "no", label: "&No", rect: [80, 70, 40, 14] },
            {
              type: "checkbox",
              id: "choice",
              label: "&Same game",
              rect: [15, 55, 62, 12],
            },
          ],
    });
    elements.choice.checked = won ? selectGameNext : true;
    return new Promise((resolve) =>
      dialog.onResult((result) =>
        resolve(result === "yes" ? elements.choice.checked : null),
      ),
    );
  };

  const showWin = async () => {
    outcome = null;
    recordResult("won");
    inProgress = false;
    undoSteps = null;
    won = true;
    gameNumber = 0;
    draw();
    const choice = await askPlayAgain(true);
    if (choice === null) return;
    selectGameNext = choice;
    await newGame(choice ? "select" : "new");
  };

  const showLoss = async () => {
    outcome = null;
    recordResult("lost");
    inProgress = false;
    undoSteps = null;
    const number = gameNumber;
    gameNumber = 0;
    const sameGame = await askPlayAgain(false);
    if (sameGame === null) return;
    if (sameGame) startGame(number);
    else await newGame(selectGameNext ? "select" : "new");
  };

  // Plays a move and the automatic moves after it, then checks the end of
  // the game. Undo reverses the whole set.
  const play = async (steps) => {
    selection = null;
    const work = cloneBoard(board);
    steps.forEach((step) => applyStep(work, step));
    const all = [...steps, ...planAutoMoves(work, outcome === "win")];
    busy = true;
    draw();
    await animate(all);
    busy = false;
    undoSteps = all;
    if (!cardsLeft(board)) return showWin();
    const moves = outcome === "lose" ? 0 : remainingMoves(board);
    if (!moves) return showLoss();
    if (moves === 1) warnLastMove();
    draw();
  };

  const deselect = () => {
    selection = null;
    draw();
  };

  const illegal = async (text = "That move is not allowed.") => {
    if (!settings.messages) return;
    await dialogs.alert(text, "FreeCell", "info");
    deselect();
  };

  const askMoveColumn = () =>
    new Promise((resolve) => {
      const { dialog } = template({
        title: "Move to Empty Column...",
        size: [150, 80],
        systemMenu: false,
        controls: [
          {
            type: "button",
            id: "column",
            label: "Move &column",
            rect: [30, 15, 90, 14],
            isDefault: true,
          },
          {
            type: "button",
            id: "single",
            label: "Move &single card",
            rect: [30, 35, 90, 14],
          },
          {
            type: "button",
            id: "cancel",
            label: "Cancel",
            rect: [55, 57, 40, 14],
          },
        ],
      });
      dialog.onResult((result) =>
        resolve(result === "column" || result === "single" ? result : null),
      );
    });

  const select = (place) => {
    if (place.column === 0) {
      if (place.row >= FREE_CELLS || board.cells[place.row] === EMPTY) return;
      selection = { column: 0, row: place.row };
      king = "left";
    } else {
      const cards = board.columns[place.column - 1];
      if (!cards.length) return;
      selection = { column: place.column, row: cards.length - 1 };
    }
    draw();
  };

  const moveSelection = async (target) => {
    const from = selection;
    if (!target) return deselect();
    const card = cardAt(board, from);
    if (target.column === 0) {
      if (from.column === 0 && from.row === target.row) return deselect();
      if (!canMoveToCell(board, card, target.row)) return illegal();
      return play([{ from, to: target }]);
    }
    const destination = board.columns[target.column - 1];
    if (from.column === 0) {
      if (destination.length && !canStack(card, destination.at(-1)))
        return illegal();
      return play([{ from, to: { column: target.column } }]);
    }
    if (from.column === target.column) return deselect();
    if (!destination.length) {
      let carried = runLength(board, from.column, target.column);
      if (!freeCellCount(board) && carried > 1) carried = 1;
      let single = carried === 1;
      if (!single) {
        const choice = await askMoveColumn();
        if (!choice) return deselect();
        single = choice === "single";
      }
      return play(
        planColumnMove(board, from.column, target.column, { single }),
      );
    }
    const carried = runLength(board, from.column, target.column);
    if (!carried) return illegal();
    const allowed = maxMovable(freeCellCount(board), emptyColumnCount(board));
    if (carried > allowed)
      return illegal(
        `That move requires moving ${carried} cards.You only have enough free space to move ${allowed}.`,
      );
    return play(planColumnMove(board, from.column, target.column));
  };

  // Double-clicking a column's bottom card sends it to the first free cell.
  const moveToFreeCell = (column) => {
    const row = [0, 1, 2, 3].find((index) => board.cells[index] === EMPTY);
    if (row === undefined) return false;
    void play([{ from: { column, row: 0 }, to: { column: 0, row } }]);
    return true;
  };

  const pointerPlace = (event) => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / layout.width;
    return hitTest(
      (event.clientX - rect.left) / scale,
      (event.clientY - rect.top) / scale,
    );
  };

  let activatedByClick = false;
  canvas.addEventListener("pointerdown", () => {
    activatedByClick = !context.windowElement.classList.contains("active");
    root.focus({ preventScroll: true });
  });
  canvas.addEventListener("mousedown", (event) => {
    if (!gameNumber || busy) return;
    if (event.button === 2) {
      const place = pointerPlace(event);
      const cards = place?.column ? board.columns[place.column - 1] : [];
      if (place?.hit && place.row < cards.length - 1) {
        revealed = { column: place.column, row: place.row };
        draw();
      }
      return;
    }
    if (event.button !== 0) return;
    // The click that activates the window only activates it.
    if (activatedByClick) {
      activatedByClick = false;
      return;
    }
    const place = pointerPlace(event);
    if (event.detail === 2 && settings.doubleClick && place?.column) {
      if (!selection) select(place);
      if (selection?.column === place.column && moveToFreeCell(place.column))
        return;
    }
    if (selection) void moveSelection(place);
    else if (place?.hit) select(place);
  });
  const hideRevealed = () => {
    if (!revealed) return;
    revealed = null;
    draw();
  };
  canvas.addEventListener("mouseup", (event) => {
    if (event.button === 2) hideRevealed();
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  // The cursor shows where the selection can go, and the king looks
  // toward the cells under the pointer.
  canvas.addEventListener("mousemove", (event) => {
    canvas.dataset.cursor = busy ? "wait" : "";
    if (busy) return;
    const place = pointerPlace(event);
    if (place?.column === 0 && !won) {
      const next = place.row < FREE_CELLS ? "left" : "right";
      if (next !== king) {
        king = next;
        draw();
      }
    }
    if (!selection) return;
    const card = cardAt(board, selection);
    if (!place) return;
    if (place.column === 0) {
      if (canMoveToCell(board, card, place.row)) canvas.dataset.cursor = "up";
      return;
    }
    const destination = board.columns[place.column - 1];
    if (!destination.length) {
      canvas.dataset.cursor = "up";
      return;
    }
    if (!place.hit || place.column === selection.column) return;
    const legal =
      selection.column === 0
        ? canStack(card, destination.at(-1))
        : (() => {
            const carried = runLength(board, selection.column, place.column);
            return (
              carried &&
              carried <=
                maxMovable(freeCellCount(board), emptyColumnCount(board))
            );
          })();
    if (legal) canvas.dataset.cursor = "down";
  });

  // Pressing a selected column's key again shows each of its cards in turn,
  // 300 ms apart, then drops the selection.
  const showColumn = async (column) => {
    busy = true;
    canvas.dataset.cursor = "wait";
    for (let row = 0; row < board.columns[column - 1].length; row += 1) {
      revealed = { column, row };
      draw();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    revealed = null;
    busy = false;
    canvas.dataset.cursor = "";
    deselect();
  };

  // ---- Keyboard: 1 to 8 pick columns, 0 the free cells, 9 home ----
  const pressNumber = (key) => {
    const cells = [0, 1, 2, 3];
    if (key === "0") {
      if (selection?.column === 0) {
        // A selected free cell passes the selection to the next full one.
        const after = selection.row;
        deselect();
        const row = cells.find(
          (index) => index > after && board.cells[index] !== EMPTY,
        );
        if (row !== undefined) select({ column: 0, row });
        return;
      }
      if (!selection) {
        const row = cells.find((index) => board.cells[index] !== EMPTY);
        if (row !== undefined) select({ column: 0, row });
        return;
      }
      const row = cells.find((index) => board.cells[index] === EMPTY) ?? 0;
      return moveSelection({ column: 0, row });
    }
    if (key === "9") {
      if (!selection) return;
      const slot = board.homeSlots[cardAt(board, selection) % 4];
      return moveSelection({
        column: 0,
        row: slot === EMPTY ? FREE_CELLS : slot,
      });
    }
    const column = Number(key);
    const cards = board.columns[column - 1];
    if (selection?.column === column && cards.length > 1)
      return showColumn(column);
    const target = { column, row: cards.length - 1, hit: true };
    if (selection) return moveSelection(target);
    select(target);
  };

  const run = async (command) => {
    if (command === "new") return newGame("new");
    if (command === "select") return newGame("select");
    if (command === "restart")
      return newGame("restart", inProgress ? gameNumber : lastGame);
    if (command === "statistics") return showStatistics();
    if (command === "options") return showOptions();
    if (command === "undo") return undo();
    if (command === "about")
      return context.openAboutWindows({
        application: "FreeCell",
        icon: "assets/xp/freecell/FreeCell-32.png",
        otherStuff: "by Jim Horne",
      });
    return context.close();
  };

  const undo = async () => {
    if (!undoSteps || busy) return;
    const steps = undoSteps;
    undoSteps = null;
    selection = null;
    busy = true;
    await animate([...steps].reverse(), true);
    busy = false;
    draw();
  };

  const chooseOutcome = async () => {
    const choice = await dialogs.message({
      title: "User-Friendly User Interface",
      text: "Choose Abort to Win,\nRetry to Lose,\nor Ignore to Cancel.",
      icon: "question",
      buttons: [
        { id: "abort", label: "&Abort", isDefault: true },
        { id: "retry", label: "&Retry" },
        { id: "ignore", label: "&Ignore" },
      ],
    });
    outcome = choice === "abort" ? "win" : choice === "retry" ? "lose" : null;
  };

  // Shortcuts work anywhere in the window, like a menu's accelerators.
  const handleKeydown = (event) => {
    if (globalThis.XPDialogs.isModalOpen()) return;
    if (event.key === "F10" && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      void chooseOutcome();
      return;
    }
    const command = KEY_COMMANDS[event.key];
    if (command) {
      event.preventDefault();
      if (command === "undo" && !undoSteps) return;
      void run(command);
      return;
    }
    if (!/^[0-9]$/.test(event.key) || !gameNumber || busy) return;
    void pressNumber(event.key);
  };
  context.windowElement.addEventListener("keydown", handleKeydown);

  // ---- Dialogs ----
  const showStatistics = () => {
    const { dialog, elements } = template({
      title: "FreeCell Statistics",
      size: [150, 135],
      help: true,
      controls: [
        { type: "text", id: "session", label: "", rect: [11, 10, 130, 30] },
        { type: "text", id: "total", label: "", rect: [11, 42, 130, 30] },
        { type: "text", id: "streaks", label: "", rect: [11, 74, 130, 40] },
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [20, 115, 40, 14],
          isDefault: true,
        },
        {
          type: "button",
          id: "clear",
          label: "&Clear",
          rect: [90, 115, 40, 14],
        },
      ],
    });
    // freecell.exe's own strings, with their tabs at the stops XP's text
    // reaches: every 40 pixels, after the labels' measured widths.
    const lines = (element, rows) => {
      element.replaceChildren(
        ...rows.map((cells) => {
          const line = document.createElement("div");
          line.className = "freecell-statistics-line";
          cells.forEach(([x, text]) => {
            const cell = document.createElement("span");
            cell.style.left = `${x}px`;
            cell.textContent = text;
            line.append(cell);
          });
          return line;
        }),
      );
    };
    const render = () => {
      const { streak, streakType } = statistics;
      const current = !streak
        ? "0"
        : streakType === "won"
          ? streak === 1
            ? "1 win"
            : `${streak} wins`
          : streak === 1
            ? "1 loss"
            : `${streak} losses`;
      const block = (title, won, lost) => [
        [
          [0, title],
          [160, `${percent(won, lost)}%`],
        ],
        [
          [40, "won:"],
          [120, String(won)],
        ],
        [
          [40, "lost:"],
          [120, String(lost)],
        ],
      ];
      lines(elements.session, block("This session", session.won, session.lost));
      lines(elements.total, block("Total", statistics.won, statistics.lost));
      lines(elements.streaks, [
        [[0, "Streaks"]],
        [
          [40, "wins:"],
          [120, String(statistics.wins)],
        ],
        [
          [40, "losses:"],
          [120, String(statistics.losses)],
        ],
        [
          [40, "current:"],
          [120, current],
        ],
      ]);
    };
    render();
    // Clear asks first and keeps the dialog open.
    const close = dialog.close;
    dialog.close = async (result) => {
      if (result !== "clear") return close(result);
      const accepted = await dialogs.confirm(
        "Are you sure you want to delete all statistics?",
        "FreeCell",
        "question",
      );
      if (!accepted) return;
      Object.assign(statistics, {
        won: 0,
        lost: 0,
        streak: 0,
        streakType: "lost",
        wins: 0,
        losses: 0,
      });
      session.won = 0;
      session.lost = 0;
      saveStatistics();
      render();
    };
  };

  const showOptions = () => {
    const options = ["messages", "quick", "doubleClick"];
    const { dialog, elements } = template({
      title: "FreeCell Options",
      size: [203, 63],
      help: true,
      controls: [
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [148, 9, 50, 14],
          isDefault: true,
        },
        {
          type: "button",
          id: "cancel",
          label: "Cancel",
          rect: [148, 26, 50, 14],
        },
        {
          type: "checkbox",
          id: "messages",
          label: "Display &messages on illegal moves",
          rect: [6, 9, 136, 10],
        },
        {
          type: "checkbox",
          id: "quick",
          label: "&Quick play (no animation)",
          rect: [6, 26, 136, 10],
        },
        {
          type: "checkbox",
          id: "doubleClick",
          label: "&Double click moves card to free cell",
          rect: [6, 43, 136, 10],
        },
      ],
    });
    options.forEach((name) => {
      elements[name].checked = settings[name];
    });
    dialog.onResult((result) => {
      if (result !== "ok") return;
      options.forEach((name) => {
        settings[name] = elements[name].checked;
      });
      writeJson(SETTINGS_KEY, settings);
    });
  };

  // ---- Start ----
  measure();
  void loadCardFaces()
    .then((loaded) => {
      faces = loaded;
      draw();
    })
    .catch((error) => dialogs.alert(error.message, "FreeCell", "error"));
  // freecell.exe opens on an empty table until a game starts.
  board = { ...deal(1), columns: Array.from({ length: 8 }, () => []) };
  showCardsLeft();
  draw();
  queueMicrotask(() => root.focus({ preventScroll: true }));

  return {
    element: root,
    beforeClose: confirmResign,
    unmount() {
      stopFlashing();
      resizeObserver.disconnect();
      context.windowElement.removeEventListener("keydown", handleKeydown);
    },
  };
};

export const freecellApplication = defineApplication({
  ...applicationMetadata,
  mount: mountFreeCell,
});
