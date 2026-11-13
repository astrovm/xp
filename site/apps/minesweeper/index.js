import { applicationMetadata } from "./metadata.js";
import { defineApplication } from "../core/application.js";
import { wireMenuBar } from "../core/menu-bar.js";
import {
  MINESWEEPER_LEVELS,
  adjacentMineCount,
  createMinefield,
  neighborsOf,
} from "./game.js";

const ASSET_ROOT = "/assets/xp/minesweeper";
const SETTINGS_KEY = "minesweeperSettings";
const DEFAULT_SETTINGS = Object.freeze({
  difficulty: "beginner",
  customLevel: Object.freeze({ rows: 20, columns: 20, mines: 80 }),
  marks: true,
  color: true,
  sound: true,
});
const DIGIT_FRAMES = Object.freeze({
  "-": 0,
  9: 2,
  8: 3,
  7: 4,
  6: 5,
  5: 6,
  4: 7,
  3: 8,
  2: 9,
  1: 10,
  0: 11,
});

const playSound = (name, enabled) => {
  if (!enabled) return;
  const audio = new Audio(`${ASSET_ROOT}/${name}.wav`);
  audio.volume = 0.55;
  void audio.play().catch(() => {});
};

const createCounter = (label) => {
  const counter = document.createElement("output");
  counter.className = "minesweeper-counter";
  counter.setAttribute("aria-label", label);
  return counter;
};

const setCounter = (counter, value) => {
  const normalized = Math.max(-99, Math.min(999, value));
  const text =
    normalized < 0
      ? `-${String(Math.abs(normalized)).padStart(2, "0")}`
      : String(normalized).padStart(3, "0");
  counter.replaceChildren(
    ...[...text].map((character) => {
      const digit = document.createElement("span");
      digit.style.backgroundPositionY = `${DIGIT_FRAMES[character] * -23}px`;
      digit.setAttribute("aria-hidden", "true");
      return digit;
    }),
  );
  counter.dataset.value = String(normalized);
  counter.setAttribute("aria-valuenow", String(normalized));
  counter.setAttribute("aria-valuetext", String(normalized));
};

const readSettings = () => {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    const difficulty = [...Object.keys(MINESWEEPER_LEVELS), "custom"].includes(
      value?.difficulty,
    )
      ? value.difficulty
      : DEFAULT_SETTINGS.difficulty;
    const rows = Math.max(
      9,
      Math.min(24, Number(value?.customLevel?.rows) || 20),
    );
    const columns = Math.max(
      9,
      Math.min(30, Number(value?.customLevel?.columns) || 20),
    );
    const mines = Math.max(
      10,
      Math.min(Number(value?.customLevel?.mines) || 80, rows * columns - 9),
    );
    return {
      difficulty,
      customLevel: { rows, columns, mines },
      marks:
        typeof value?.marks === "boolean"
          ? value.marks
          : DEFAULT_SETTINGS.marks,
      color:
        typeof value?.color === "boolean"
          ? value.color
          : DEFAULT_SETTINGS.color,
      sound:
        typeof value?.sound === "boolean"
          ? value.sound
          : DEFAULT_SETTINGS.sound,
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      customLevel: { ...DEFAULT_SETTINGS.customLevel },
    };
  }
};

const createMenu = (label, items, setAccessKeyText) => {
  const group = document.createElement("div");
  group.className = "minesweeper-menu-group";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "minesweeper-menu-trigger";
  setAccessKeyText(trigger, label);
  trigger.setAttribute("role", "menuitem");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  const popup = document.createElement("div");
  popup.className = "minesweeper-popup";
  popup.hidden = true;
  popup.setAttribute("role", "menu");
  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement("hr");
      separator.setAttribute("role", "separator");
      popup.appendChild(separator);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.command = item.command;
    button.innerHTML = `<span data-check></span><span>${item.label}</span><kbd>${item.key || ""}</kbd>`;
    popup.appendChild(button);
  }
  group.append(trigger, popup);
  return { group, popup };
};

const mountMinesweeper = (context, instance) => {
  const root = document.createElement("div");
  root.className = "xp-native-program xp-minesweeper";
  root.tabIndex = 0;
  // The board gets the keys when the window becomes active.
  root.dataset.defaultFocus = "";
  const menuBar = document.createElement("div");
  menuBar.className = "minesweeper-menu-bar";
  menuBar.setAttribute("role", "menubar");
  const content = document.createElement("section");
  content.className = "minesweeper-content";
  const scorePanel = document.createElement("div");
  scorePanel.className = "minesweeper-score-panel";
  const mineCounter = createCounter("Mines remaining");
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "minesweeper-face";
  reset.setAttribute("aria-label", "New game");
  const timeCounter = createCounter("Elapsed time");
  const boardFrame = document.createElement("div");
  boardFrame.className = "minesweeper-board-frame";
  const board = document.createElement("div");
  board.className = "xp-minesweeper-board";
  board.setAttribute("role", "grid");
  board.setAttribute("aria-label", "Minesweeper board");
  boardFrame.appendChild(board);
  scorePanel.append(mineCounter, reset, timeCounter);
  content.append(scorePanel, boardFrame);
  root.append(menuBar, content);

  const savedSettings = readSettings();
  let difficulty = savedSettings.difficulty;
  let customLevel = savedSettings.customLevel;
  let level =
    difficulty === "custom"
      ? { ...customLevel }
      : MINESWEEPER_LEVELS[difficulty];
  let mines = null;
  let elapsed = 0;
  let flags = 0;
  let timer = null;
  let status = "ready";
  let marks = savedSettings.marks;
  let color = savedSettings.color;
  let sound = savedSettings.sound;

  const saveSettings = () => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ difficulty, customLevel, marks, color, sound }),
      );
    } catch {
      // A storage failure must not stop a game from starting.
    }
  };

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const startTimer = () => {
    timer = setInterval(() => {
      if (!root.isConnected) return stopTimer();
      elapsed = Math.min(999, elapsed + 1);
      setCounter(timeCounter, elapsed);
    }, 1000);
  };
  const setFace = (face) => {
    reset.dataset.face = face;
  };
  const resizeWindow = () => {
    const owner = instance.window.el;
    const width = level.columns * 16 + 26;
    // Board rows plus the menu, score panel, frame, content padding, title bar,
    // and the shell's bottom frame. The old calculation counted only one side
    // of the content padding, so the board extended six pixels below the shell.
    const height = level.rows * 16 + 121;
    owner.style.width = `${width}px`;
    owner.style.height = `${height}px`;
    owner.style.minWidth = `${width}px`;
    owner.style.minHeight = `${height}px`;
  };
  const updateMenuChecks = () => {
    gameMenu.popup.querySelectorAll("[data-command]").forEach((button) => {
      const command = button.dataset.command;
      const checked =
        command === difficulty ||
        (command === "marks" && marks) ||
        (command === "color" && color) ||
        (command === "sound" && sound);
      button.querySelector("[data-check]").textContent = checked ? "✓" : "";
    });
  };
  const revealAllMines = (explodedIndex) => {
    [...board.children].forEach((cell, index) => {
      if (mines.has(index)) {
        cell.dataset.tile = index === explodedIndex ? "exploded" : "mine";
      } else if (cell.dataset.mark === "flag") {
        cell.dataset.tile = "wrong";
      }
    });
  };
  const finish = (won, explodedIndex = -1) => {
    status = won ? "won" : "lost";
    stopTimer();
    setFace(won ? "won" : "lost");
    if (won) {
      [...board.children].forEach((cell, index) => {
        if (mines.has(index) && cell.dataset.mark !== "flag") {
          cell.dataset.mark = "flag";
          cell.dataset.tile = "flag";
        }
      });
      flags = level.mines;
      setCounter(mineCounter, 0);
      playSound("Win", sound);
    } else {
      revealAllMines(explodedIndex);
      playSound("Lose", sound);
    }
  };
  const reveal = (index) => {
    const cell = board.children[index];
    if (
      status === "won" ||
      status === "lost" ||
      cell.dataset.open === "true" ||
      cell.dataset.mark === "flag"
    ) {
      return;
    }
    if (!mines) {
      mines = createMinefield(level, index);
      status = "playing";
      startTimer();
    }
    cell.dataset.open = "true";
    if (mines.has(index)) {
      finish(false, index);
      return;
    }
    const count = adjacentMineCount(index, level, mines);
    cell.dataset.tile = count ? `number-${count}` : "open";
    cell.setAttribute(
      "aria-label",
      count ? `${count} adjacent mines` : "Open empty cell",
    );
    if (!count) {
      neighborsOf(index, level.rows, level.columns).forEach(reveal);
    }
    if (
      board.querySelectorAll('[data-open="true"]').length ===
      level.rows * level.columns - level.mines
    ) {
      finish(true);
    }
  };
  const chord = (index) => {
    const cell = board.children[index];
    if (cell.dataset.open !== "true" || !mines) return;
    const neighbors = neighborsOf(index, level.rows, level.columns);
    const adjacentFlags = neighbors.filter(
      (neighbor) => board.children[neighbor].dataset.mark === "flag",
    ).length;
    if (adjacentFlags === adjacentMineCount(index, level, mines)) {
      neighbors.forEach(reveal);
    }
  };
  const cycleMark = (cell) => {
    if (cell.dataset.open === "true" || status === "won" || status === "lost")
      return;
    const current = cell.dataset.mark || "";
    const next =
      current === "" ? "flag" : current === "flag" && marks ? "question" : "";
    if (current === "flag") flags -= 1;
    if (next === "flag") flags += 1;
    cell.dataset.mark = next;
    cell.dataset.tile = next || "covered";
    setCounter(mineCounter, level.mines - flags);
    playSound("Click", sound);
  };
  const initialize = (nextDifficulty = difficulty) => {
    stopTimer();
    difficulty = nextDifficulty;
    level =
      difficulty === "custom"
        ? { ...customLevel }
        : MINESWEEPER_LEVELS[difficulty];
    mines = null;
    elapsed = 0;
    flags = 0;
    status = "ready";
    setCounter(mineCounter, level.mines);
    setCounter(timeCounter, 0);
    setFace("normal");
    board.replaceChildren();
    board.style.gridTemplateColumns = `repeat(${level.columns}, 16px)`;
    root.classList.toggle("monochrome", !color);
    for (let index = 0; index < level.rows * level.columns; index += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.dataset.tile = "covered";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `Covered cell ${index + 1}`);
      cell.addEventListener("mousedown", (event) => {
        if (event.button === 0 && cell.dataset.open !== "true")
          setFace("surprised");
      });
      cell.addEventListener("mouseup", () => setFace("normal"));
      cell.addEventListener("click", () => reveal(index));
      cell.addEventListener("dblclick", () => chord(index));
      cell.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        cycleMark(cell);
      });
      board.appendChild(cell);
    }
    resizeWindow();
    updateMenuChecks();
    saveSettings();
  };

  const showCustomDialog = () => {
    const dialog = context.dialogs.createDialog({ title: "Custom Field" });
    dialog.el.classList.add("minesweeper-custom-dialog");
    const fields = [
      ["Height:", "rows", customLevel.rows, 9, 24],
      ["Width:", "columns", customLevel.columns, 9, 30],
      ["Mines:", "mines", customLevel.mines, 10, 668],
    ];
    for (const [label, name, value, min, max] of fields) {
      const row = document.createElement("label");
      row.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.name = name;
      input.min = min;
      input.max = max;
      input.value = value;
      row.appendChild(input);
      dialog.body.appendChild(row);
    }
    dialog.onResult((result) => {
      if (result !== "ok") return;
      const values = Object.fromEntries(
        [...dialog.body.querySelectorAll("input")].map((input) => [
          input.name,
          Number(input.value),
        ]),
      );
      const rows = Math.max(9, Math.min(24, Math.trunc(values.rows)));
      const columns = Math.max(9, Math.min(30, Math.trunc(values.columns)));
      customLevel = {
        rows,
        columns,
        mines: Math.max(
          10,
          Math.min(Math.trunc(values.mines), rows * columns - 9),
        ),
      };
      initialize("custom");
    });
    context.dialogs.addButtonRow(dialog, [
      { id: "ok", label: "OK", isDefault: true },
      { id: "cancel", label: "Cancel", isCancel: true },
    ]);
  };

  const gameMenu = createMenu(
    "&Game",
    [
      { label: "New", command: "new", key: "F2" },
      { separator: true },
      { label: "Beginner", command: "beginner" },
      { label: "Intermediate", command: "intermediate" },
      { label: "Expert", command: "expert" },
      { label: "Custom...", command: "custom" },
      { separator: true },
      { label: "Marks (?)", command: "marks" },
      { label: "Color", command: "color" },
      { label: "Sound", command: "sound" },
      { separator: true },
      { label: "Best Times...", command: "best-times" },
      { separator: true },
      { label: "Exit", command: "exit" },
    ],
    context.setAccessKeyText,
  );
  const helpMenu = createMenu(
    "&Help",
    [
      { label: "Contents", command: "contents", key: "F1" },
      { label: "Search for Help on...", command: "search-help" },
      { label: "Using Help", command: "using-help" },
      { separator: true },
      { label: "About Minesweeper...", command: "about" },
    ],
    context.setAccessKeyText,
  );
  menuBar.append(gameMenu.group, helpMenu.group);
  const menus = wireMenuBar({
    windowElement: context.windowElement,
    bar: menuBar,
    showMenu: (trigger) => {
      const popup = trigger.nextElementSibling;
      popup.hidden = false;
      return popup;
    },
  });
  gameMenu.popup.addEventListener("click", (event) => {
    const command = event.target.closest("[data-command]")?.dataset.command;
    if (!command) return;
    menus.close();
    if (command === "new") initialize();
    else if (MINESWEEPER_LEVELS[command]) initialize(command);
    else if (command === "custom") showCustomDialog();
    else if (command === "marks") {
      marks = !marks;
      if (!marks) {
        board.querySelectorAll('[data-mark="question"]').forEach((cell) => {
          cell.dataset.mark = "";
          cell.dataset.tile = "covered";
        });
      }
      updateMenuChecks();
      saveSettings();
    } else if (command === "color") {
      color = !color;
      root.classList.toggle("monochrome", !color);
      updateMenuChecks();
      saveSettings();
    } else if (command === "sound") {
      sound = !sound;
      updateMenuChecks();
      saveSettings();
    } else if (command === "best-times") {
      context.showMessage(
        "Best Times",
        "Beginner: Anonymous     999 seconds\nIntermediate: Anonymous     999 seconds\nExpert: Anonymous     999 seconds",
      );
    } else context.close(); // Exit is the only remaining Game command.
  });
  helpMenu.popup.addEventListener("click", (event) => {
    const command = event.target.closest("[data-command]")?.dataset.command;
    if (!command) return;
    menus.close();
    if (command === "about") {
      context.showMessage(
        "About Minesweeper",
        "Minesweeper\nCopyright © 1981-2001 Microsoft Corporation",
      );
    } else {
      context.showMessage(
        "Minesweeper Help",
        "Uncover every square that does not contain a mine. Use the numbers to determine where mines are hidden.",
      );
    }
  });
  reset.addEventListener("click", () => initialize());
  const handleKeydown = (event) => {
    if (event.key === "F2") {
      event.preventDefault();
      initialize();
    } else if (event.key === "F1") {
      event.preventDefault();
      context.showMessage(
        "Minesweeper Help",
        "Uncover every square that does not contain a mine.",
      );
    }
  };
  root.addEventListener("keydown", handleKeydown);
  initialize();
  return {
    element: root,
    unmount() {
      stopTimer();
    },
  };
};

export const minesweeperApplication = defineApplication({
  ...applicationMetadata,
  mount: mountMinesweeper,
});
