import { applicationMetadata } from "./metadata.js";
import { defineApplication } from "../core/application.js";
import { wireMenuBar } from "../core/menu-bar.js";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  loadCardArt,
  loadCardFaces,
} from "../cards/cards.js";
import { openTemplateDialog } from "../cards/template-dialog.js";
import { drawText, loadSystemFont, measureText } from "../cards/system-font.js";
import {
  DEFAULT_NAMES,
  GONE,
  HAND_SIZE,
  IN_HAND,
  NO_PASS,
  ON_TABLE,
  PASS_LABELS,
  PASS_OFFSETS,
  PLACES,
  PLAY_SPEEDS,
  SELECTED,
  addToSheet,
  checkMove,
  chooseComputerPasses,
  choosePlay,
  collectTrick,
  createGenerator,
  createRound,
  dealHands,
  exchangeCards,
  finishTrick,
  gatherSpeed,
  glidePath,
  isGameOver,
  lowestScore,
  newGameSeed,
  placeOf,
  playCard,
  scoreRound,
  selectedCount,
  startPlay,
  trickComplete,
} from "./game.js";

const SETTINGS_KEY = "heartsSettings";
const TITLE = "The Microsoft Hearts Network";
const GREEN = "#007f00";
const BACK = 54;
const NAME_LIMIT = 14;
// The client area: the table, 530 by 401, over a 23-pixel status bar. The
// cards are laid out in the 397 pixels above the bar's 27-pixel allowance.
const WIDTH = 530;
const BOARD_HEIGHT = 401;
const HEIGHT = 397;
const BUTTON = { width: 105, height: 28 };
const SOUNDS = {
  hearts: "assets/xp/hearts/HeartsBroken.wav",
  queen: "assets/xp/hearts/Queen.wav",
};
const ICON = "assets/xp/hearts/Hearts-32.png";
const SPEEDS = ["slow", "normal", "fast"];

const MENUS = [
  [
    "&Game",
    [
      ["&Options...", "options", "F7"],
      ["&Sound", "sound", "F8"],
      ["S&core...", "score", "F9"],
      "-",
      ["E&xit", "exit", ""],
    ],
  ],
  [
    "&Help",
    [
      ["&Quote...", "quote", ""],
      ["&About Hearts", "about", ""],
    ],
  ],
];

// The registry's name, sound, speed and computer names. Names keep XP's
// 14-character limit; a missing or empty one falls back to the default.
const cleanName = (value) =>
  typeof value === "string" && value ? value.slice(0, NAME_LIMIT) : "";
export const readSettings = () => {
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (value && typeof value === "object") saved = value;
  } catch {
    // Unreadable settings fall back to XP's defaults.
  }
  const names = Array.isArray(saved.names) ? saved.names : [];
  return {
    name: cleanName(saved.name),
    sound: saved.sound === true,
    speed: SPEEDS.includes(saved.speed) ? saved.speed : "normal",
    names: DEFAULT_NAMES.map((name, index) => cleanName(names[index]) || name),
  };
};

// Where each seat's cards go, from mshearts.exe's player layout: the hand's
// first slot and its step, the played card, where a gathered trick leaves
// the table, the pass marks and the name.
const hand = (x, y, dx, dy) => ({ x, y, dx, dy });
const layoutSeats = () => {
  const centerX = Math.trunc(WIDTH / 2) - Math.trunc(CARD_WIDTH / 2);
  const centerY = Math.trunc(HEIGHT / 2) - Math.trunc(CARD_HEIGHT / 2);
  const across = Math.trunc((WIDTH - CARD_WIDTH - 180) / 2);
  const side = Math.trunc((HEIGHT - CARD_HEIGHT - 180) / 2);
  const bottom = hand(across, HEIGHT - CARD_HEIGHT - 3, 15, 0);
  const left = hand(9, side, 0, 15);
  const top = hand(across + 180, 3, -15, 0);
  const right = hand(WIDTH - CARD_WIDTH - 9, side + 180, 0, -15);
  return [
    {
      hand: bottom,
      played: { x: centerX - 5, y: centerY + 30 },
      away: { x: centerX - 5, y: CARD_HEIGHT + HEIGHT },
      name: { right: WIDTH - (bottom.x - 3), top: HEIGHT - 16 - 3 },
    },
    {
      hand: left,
      played: { x: centerX - 30, y: centerY - 5 },
      away: { x: -CARD_WIDTH, y: centerY - 5 },
      marks: { x: CARD_WIDTH + 12, y: left.y + 7 },
      name: { left: 11, top: left.y - 16 },
    },
    {
      hand: top,
      played: { x: centerX + 5, y: centerY - 30 },
      away: { x: centerX + 5, y: -CARD_HEIGHT },
      marks: { x: top.x - 7 + CARD_WIDTH, y: CARD_HEIGHT + 6 },
      name: { left: across + 183 + CARD_WIDTH, top: 3 },
    },
    {
      hand: right,
      played: { x: centerX + 30, y: centerY + 5 },
      away: { x: WIDTH, y: centerY + 5 },
      marks: { x: right.x - 3, y: right.y - 7 + CARD_HEIGHT },
      name: { right: 11, top: right.y + CARD_HEIGHT },
    },
  ];
};
const SEATS = layoutSeats();
export const PASS_BUTTON = {
  left: Math.trunc(WIDTH / 2) - Math.trunc(BUTTON.width / 2),
  top: HEIGHT - CARD_HEIGHT - BUTTON.height - 40,
};

const slotPosition = (seat, index) => {
  const { x, y, dx, dy } = SEATS[seat].hand;
  return { x: x + dx * index, y: y + dy * index };
};

const mountHearts = (context) => {
  const { dialogs } = context;
  const root = document.createElement("div");
  root.className = "xp-native-program xp-hearts";
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="cards-menu-bar" role="menubar"></div>
    <div class="hearts-edge"><div class="hearts-client">
      <canvas class="hearts-board" role="application" aria-label="Hearts"></canvas>
      <div class="hearts-names"></div>
      <button type="button" class="xp-btn hearts-pass" hidden><canvas width="${BUTTON.width}" height="${BUTTON.height}"></canvas></button>
      <div class="hearts-status" role="status"></div>
    </div></div>`;
  const menuBar = root.querySelector(".cards-menu-bar");
  const canvas = root.querySelector(".hearts-board");
  const namesLayer = root.querySelector(".hearts-names");
  const passButton = root.querySelector(".hearts-pass");
  const passLabel = passButton.querySelector("canvas");
  const status = root.querySelector(".hearts-status");
  const graphics = canvas.getContext("2d");
  Object.assign(passButton.style, {
    left: `${PASS_BUTTON.left}px`,
    top: `${PASS_BUTTON.top}px`,
    width: `${BUTTON.width}px`,
    height: `${BUTTON.height}px`,
  });
  context.setTitle(TITLE);
  // A fixed frame: three pixels, like a dialog's, under a 29-pixel caption.
  context.windowElement.classList.add("dialog-frame");

  let settings = readSettings();
  let faces = null;
  let art = null;
  let systemFont = null;
  // mshearts.exe seeds the C runtime's generator with time(NULL) at start.
  const generator = createGenerator(Math.floor(Date.now() / 1000));
  let names = ["", ...settings.names];
  let scores = [0, 0, 0, 0];
  let sheet = [];
  let passMode = 0;
  let round = null;
  // welcome, passing, accepting, turn, busy, score
  let phase = "welcome";
  let marksShown = false;
  let gliding = null;
  let flash = null;
  let flashTimer = null;
  let generation = 0;
  let currentSound = null;
  const timers = new Set();

  const saveSettings = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Settings stay for this session when storage is unavailable.
    }
  };
  const setStatus = (text) => {
    status.textContent = text;
  };
  setStatus("Welcome to the Microsoft Hearts Network.");

  const playSound = (name) => {
    if (!settings.sound) return;
    // sndPlaySound cuts off whatever was playing.
    currentSound?.pause();
    currentSound = new Audio(SOUNDS[name]);
    void currentSound.play().catch(() => {});
  };
  const stopSound = () => {
    currentSound?.pause();
    currentSound = null;
  };

  // ---- Drawing ----
  const drawCard = (card, x, y, inverted = false) => {
    if (!faces) return;
    graphics.drawImage(
      inverted ? faces[card].inverted : faces[card].normal,
      x,
      y,
    );
  };
  const drawBack = (x, y) => {
    if (art) graphics.drawImage(art.backs[BACK], x, y);
  };

  const showNames = () => {
    namesLayer.replaceChildren(
      ...names.map((name, seat) => {
        const label = document.createElement("span");
        label.className = "hearts-name";
        label.dataset.seat = String(seat);
        label.textContent = name;
        const place = SEATS[seat].name;
        label.style.top = `${place.top}px`;
        if ("left" in place) label.style.left = `${place.left}px`;
        else label.style.right = `${place.right}px`;
        return label;
      }),
    );
  };

  // At the end of a hand each seat's point cards lie where its hand was,
  // centered as if it still held them.
  const drawTaken = (seat) => {
    const cards = round.taken[seat];
    const start = Math.trunc((14 - cards.length) / 2);
    cards.forEach((card, index) => {
      const { x, y } = slotPosition(seat, start + index);
      drawCard(card, x, y);
    });
  };

  const drawSeat = (seat) => {
    const slots = round.slots[seat];
    if (phase === "score") {
      drawTaken(seat);
      return;
    }
    slots.forEach((slot, index) => {
      if (slot.state === ON_TABLE || slot.state === GONE) return;
      const { x, y } = slotPosition(seat, index);
      if (seat !== 0) drawBack(x, y);
      else drawCard(slot.card, x, slot.state === SELECTED ? y - 20 : y);
    });
    const card = round.trick.played[seat];
    if (card === null || gliding?.card === card) return;
    if (round.gathered?.includes(seat)) return;
    const { x, y } = SEATS[seat].played;
    drawCard(card, x, y);
  };

  const draw = () => {
    const density = Math.ceil(window.devicePixelRatio - 0.01);
    if (canvas.width !== WIDTH * density) canvas.width = WIDTH * density;
    if (canvas.height !== BOARD_HEIGHT * density)
      canvas.height = BOARD_HEIGHT * density;
    graphics.setTransform(density, 0, 0, density, 0, 0);
    graphics.imageSmoothingEnabled = false;
    graphics.fillStyle = GREEN;
    graphics.fillRect(0, 0, WIDTH, BOARD_HEIGHT);
    if (!round) return;
    // Seats draw from the trick's leader, so played cards stack in order.
    const first = Math.max(0, round.trick.leader);
    for (let offset = 0; offset < 4; offset += 1)
      drawSeat((first + offset) % 4);
    if (marksShown) {
      // White marks beside the cards each computer chose to pass.
      graphics.fillStyle = "#fff";
      for (let seat = 1; seat < 4; seat += 1) {
        const {
          marks,
          hand: { dx, dy },
        } = SEATS[seat];
        round.slots[seat].forEach((slot, index) => {
          if (slot.state === SELECTED)
            graphics.fillRect(marks.x + dx * index, marks.y + dy * index, 2, 2);
        });
      }
    }
    if (gliding) drawCard(gliding.card, gliding.x, gliding.y);
    if (flash) drawCard(flash.card, flash.x, flash.y, true);
  };

  // The pass button's caption uses the System font, as a button with no
  // font of its own does.
  const drawPassLabel = () => {
    const label = passLabel.getContext("2d");
    label.clearRect(0, 0, BUTTON.width, BUTTON.height);
    const text = passButton.dataset.label || "";
    passButton.setAttribute("aria-label", text);
    if (!systemFont) return;
    const x = Math.trunc((BUTTON.width - measureText(systemFont, text)) / 2);
    const y = Math.trunc((BUTTON.height - systemFont.height) / 2);
    // Luna grays a disabled button's text without XP Classic's emboss.
    drawText(
      label,
      systemFont,
      text,
      x,
      y,
      passButton.disabled ? "#a1a192" : "#000",
    );
  };
  const setPassButton = ({ label, enabled, shown = true }) => {
    if (label !== undefined) passButton.dataset.label = label;
    if (enabled !== undefined) passButton.disabled = !enabled;
    passButton.hidden = !shown;
    drawPassLabel();
  };

  // ---- Timing ----
  const heartsPause = (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, ms);
      timers.add(timer);
    });
  const heartsFrame = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  // Moves a card across the table one step a frame. Returns false when a
  // new game or closing the window interrupted it.
  const glide = async (card, from, to, speed) => {
    const run = generation;
    for (const point of glidePath(from, to, speed)) {
      gliding = { card, ...point };
      draw();
      await heartsFrame();
      if (run !== generation) return false;
    }
    gliding = null;
    return true;
  };

  // ---- Play ----
  const startGame = () => {
    generation += 1;
    newGameSeed(generator);
    // Computers join each new game with the names Options last saved.
    names = [settings.name, ...settings.names];
    scores = [0, 0, 0, 0];
    sheet = [];
    passMode = 0;
    showNames();
    void dealHand();
  };

  const dealHand = async () => {
    round = createRound(dealHands(generator.next), passMode);
    gliding = null;
    if (passMode !== NO_PASS) {
      chooseComputerPasses(round);
      marksShown = true;
      phase = "passing";
      setPassButton({ label: PASS_LABELS[passMode], enabled: false });
      setStatus(
        `Select three cards to pass to ${names[PASS_OFFSETS[passMode]]}.`,
      );
      draw();
      return;
    }
    passMode = 0;
    draw();
    await beginPlay();
  };

  const beginPlay = async () => {
    startPlay(round);
    draw();
    await nextTurn();
  };

  const nextTurn = async () => {
    const seat = round.trick.current;
    if (seat === 0) {
      phase = "turn";
      setStatus("Select a card to play.");
      return;
    }
    phase = "busy";
    const index = choosePlay(
      round.slots[seat],
      round.memory[seat],
      round,
      seat,
    );
    setStatus(`Waiting for ${names[seat]} to move...`);
    await playAnimated(seat, index);
  };

  const playAnimated = async (seat, index) => {
    phase = "busy";
    const { card } = round.slots[seat][index];
    const from = slotPosition(seat, index);
    playCard(round, seat, index).forEach(playSound);
    if (
      !(await glide(
        card,
        from,
        SEATS[seat].played,
        PLAY_SPEEDS[settings.speed],
      ))
    )
      return;
    draw();
    if (trickComplete(round)) await finishTrickFlow();
    else await nextTurn();
  };

  const finishTrickFlow = async () => {
    const winner = finishTrick(round);
    // The trick stays on the table for a second. Closing the window clears
    // the timer, so the rest never runs.
    await heartsPause(1000);
    const { trick } = round;
    round.gathered = [];
    for (let offset = 3; offset >= 0; offset -= 1) {
      const seat = (trick.leader + offset) % 4;
      round.gathered.push(seat);
      if (
        !(await glide(
          trick.played[seat],
          SEATS[seat].played,
          SEATS[winner].away,
          gatherSpeed(settings.speed),
        ))
      )
        return;
    }
    round.gathered = null;
    collectTrick(round, winner);
    draw();
    if (round.tricksLeft) await nextTurn();
    else await endHand();
  };

  const endHand = async () => {
    stopSound();
    ({ scores } = scoreRound(round, scores));
    sheet = addToSheet(sheet, scores);
    phase = "score";
    setStatus("Score");
    draw();
    const run = generation;
    await showScore();
    if (run !== generation) return;
    // At 100 the next game starts by itself.
    if (isGameOver(scores)) startGame();
    else await dealHand();
  };

  // ---- The human's moves ----

  // The slot under a point in the bottom hand, the way mshearts.exe finds
  // it: the column under the pointer, or the nearest card to its left whose
  // right edge still reaches it. Above the cards only a raised card counts.
  const slotAt = ({ x, y }) => {
    const { x: left, y: top } = SEATS[0].hand;
    const slots = round.slots[0];
    if (y < top - 20 || y > top + CARD_HEIGHT) return -1;
    if (x < left || x > left + 180 + CARD_WIDTH) return -1;
    const column = Math.min(Math.trunc((x - left) / 15), HAND_SIZE - 1);
    const reaches = (index) => index * 15 + left + CARD_WIDTH >= x;
    const raisedOnly = y < top && slots[column].state !== SELECTED;
    for (let index = column; index >= 0; index -= 1) {
      if (index !== column && !reaches(index)) return -1;
      const slot = slots[index];
      if (raisedOnly ? slot.state === SELECTED : slot.state <= SELECTED)
        return index;
    }
    return -1;
  };

  const togglePass = (index) => {
    const slot = round.slots[0][index];
    const count = selectedCount(round.slots[0]);
    if (slot.state === SELECTED) {
      if (count === 3) setPassButton({ enabled: false });
      slot.state = IN_HAND;
    } else {
      if (count === 3) return;
      if (count === 2) {
        setPassButton({ enabled: true });
        passButton.focus({ preventScroll: true });
      }
      slot.state = SELECTED;
    }
    draw();
  };

  // An illegal card shows inverted for a quarter second.
  const flashCard = (index) => {
    const { x, y } = slotPosition(0, index);
    flash = { card: round.slots[0][index].card, x, y };
    draw();
    flashTimer = setTimeout(() => {
      flashTimer = null;
      flash = null;
      draw();
    }, 250);
  };

  const tryPlay = (index, silent = false) => {
    const problem = checkMove(round.slots[0], index, round);
    if (problem) {
      // Keyboard play keeps quiet about suits but still reports the rest.
      if (!silent || !problem.followSuit) setStatus(problem.text);
      if (!silent) flashCard(index);
      return false;
    }
    void playAnimated(0, index);
    return true;
  };

  const pointerPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / WIDTH;
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
  };

  canvas.addEventListener("pointerdown", () =>
    root.focus({ preventScroll: true }),
  );
  canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || flash || !round) return;
    if (phase !== "passing" && phase !== "turn") return;
    const index = slotAt(pointerPoint(event));
    if (index === -1) return;
    if (phase === "passing") togglePass(index);
    else tryPlay(index);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  passButton.addEventListener("click", () => {
    if (phase === "passing") {
      if (selectedCount(round.slots[0]) !== 3) return;
      exchangeCards(round);
      // Left, right, across, then the no-pass hand.
      passMode += 1;
      marksShown = false;
      phase = "accepting";
      setPassButton({ label: "OK", enabled: true });
      passButton.focus({ preventScroll: true });
      setStatus("Press OK to accept cards.");
      draw();
    } else if (phase === "accepting") {
      setPassButton({ label: "", shown: false });
      root.focus({ preventScroll: true });
      void beginPlay();
    }
  });

  // ---- Menus ----
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
        entry.classList.toggle(
          "checked",
          command === "sound" && settings.sound,
        );
        const text = document.createElement("span");
        context.setAccessKeyText(text, itemLabel);
        const key = document.createElement("kbd");
        key.textContent = shortcut;
        entry.append(text, key);
        entry.addEventListener("click", () => {
          menus.close();
          run(command);
        });
        menu.append(entry);
      });
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
    button.dataset.heartsMenu = label.replace(/&/g, "").toLowerCase();
    context.setAccessKeyText(button, label);
    menuItems.set(button, items);
    menuBar.append(button);
  });

  // ---- Dialogs ----
  const template = (options) => {
    // A dialog over the table repaints it, which clears the pass marks.
    marksShown = false;
    draw();
    return openTemplateDialog({
      dialogs,
      setAccessKeyText: context.setAccessKeyText,
      owner: { window: context.windowElement, client: canvas },
      ...options,
    });
  };
  // Centered over the client area. mshearts.exe means to leave out the
  // status bar but subtracts a height it never sets.
  const overTable = ({ width, height }) => {
    const rect = root.querySelector(".hearts-client").getBoundingClientRect();
    return {
      left: rect.left + Math.trunc((rect.width - width) / 2),
      top: rect.top + Math.trunc((rect.height - height) / 2),
    };
  };

  const showWelcome = () => {
    const { dialog, elements } = template({
      title: TITLE,
      size: [235, 50],
      position: [10, 26],
      controls: [
        {
          type: "text",
          label: "Welcome to the Microsoft Hearts Network.",
          rect: [15, 12, 165, 8],
        },
        { type: "text", label: "What is your name?", rect: [15, 27, 70, 8] },
        {
          type: "edit",
          id: "name",
          label: "What is your name?",
          rect: [95, 25, 65, 12],
        },
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [176, 7, 50, 14],
          isDefault: true,
        },
        { type: "button", id: "quit", label: "Quit", rect: [176, 24, 50, 14] },
      ],
    });
    const input = elements.name;
    input.maxLength = NAME_LIMIT;
    input.value = settings.name;
    input.focus();
    const close = dialog.close;
    dialog.close = (result) => {
      // OK needs a name; without one the caret goes back to the box.
      if (result === "ok" && !input.value) {
        input.focus();
        return;
      }
      close(result);
    };
    dialog.onResult((result) => {
      if (result !== "ok") {
        context.close();
        return;
      }
      settings = { ...settings, name: input.value };
      saveSettings();
      startGame();
    });
  };

  const showOptions = () => {
    const { dialog, elements } = template({
      title: "Hearts Options",
      size: [180, 148],
      position: [20, 25],
      controls: [
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [124, 9, 50, 14],
          isDefault: true,
        },
        {
          type: "button",
          id: "cancel",
          label: "Cancel",
          rect: [124, 26, 50, 14],
        },
        { type: "group", label: "Animation speed", rect: [5, 5, 100, 57] },
        {
          type: "radio",
          id: "slow",
          group: "speed",
          label: "&Slow",
          rect: [10, 18, 85, 10],
        },
        {
          type: "radio",
          id: "normal",
          group: "speed",
          label: "&Normal",
          rect: [10, 32, 85, 10],
        },
        {
          type: "radio",
          id: "fast",
          group: "speed",
          label: "&Fast",
          rect: [10, 46, 85, 10],
        },
        {
          type: "group",
          label: "&Computer player names",
          rect: [5, 69, 100, 71],
        },
        ...[84, 101, 118].map((y, index) => ({
          type: "edit",
          id: `name${index + 1}`,
          label: `Computer player ${index + 1}`,
          rect: [10, y, 50, 14],
        })),
      ],
    });
    elements[settings.speed].checked = true;
    const inputs = [elements.name1, elements.name2, elements.name3];
    inputs.forEach((input, index) => {
      input.maxLength = NAME_LIMIT;
      input.value = settings.names[index];
    });
    dialog.onResult((result) => {
      if (result !== "ok") return;
      settings = {
        ...settings,
        speed: SPEEDS.find((speed) => elements[speed].checked),
        // The new names play from the next game.
        names: inputs.map(
          (input, index) => cleanName(input.value) || DEFAULT_NAMES[index],
        ),
      };
      saveSettings();
    });
  };

  const showQuote = () => {
    const { dialog } = template({
      title: `Quote for ${TITLE}`,
      size: [165, 73],
      position: [25, 50],
      controls: [
        { type: "image", src: ICON, rect: [16, 15, 21, 20] },
        {
          type: "text",
          label: "I come not, friends, to steal away your hearts...",
          rect: [50, 5, 104, 17],
          center: true,
        },
        {
          type: "text",
          label: "- Julius Caesar, Act III, scene ii",
          rect: [50, 30, 104, 9],
          center: true,
        },
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [76, 52, 50, 14],
          isDefault: true,
        },
      ],
    });
    dialog.el.classList.add("hearts-quote");
    dialog.onResult(stopSound);
  };

  // The Score Sheet: each column's name, the earlier totals struck out and
  // the latest below them. The lowest score shows blue, or dark red once
  // someone reaches 100, when the title says the game is over.
  const showScore = () =>
    new Promise((resolve) => {
      const latest = sheet.at(-1);
      const over = latest ? isGameOver(latest) : false;
      let title = "Score Sheet";
      if (over)
        title =
          latest[0] === lowestScore(latest)
            ? "Game Over -- You Win"
            : "Game Over";
      else if (latest) title += ` -- ${PLACES[placeOf(latest)]}`;
      const { dialog } = template({
        title,
        size: [238, 112],
        position: overTable,
        controls: [
          {
            type: "button",
            id: "ok",
            label: "OK",
            rect: [190, 14, 40, 14],
            isDefault: true,
          },
        ],
      });
      dialog.el.classList.add("hearts-score");
      const width = parseInt(dialog.body.style.width, 10);
      const column = Math.trunc((width - 5) / 5);
      names.forEach((name, seat) => {
        const sheetColumn = document.createElement("div");
        sheetColumn.className = "hearts-score-column";
        sheetColumn.dataset.seat = String(seat);
        Object.assign(sheetColumn.style, {
          left: `${column * seat - 5}px`,
          width: `${column + 20}px`,
        });
        if (latest && latest[seat] === lowestScore(latest))
          sheetColumn.classList.add(over ? "winner" : "leader");
        const heading = document.createElement("div");
        heading.textContent = name;
        sheetColumn.append(heading);
        sheet.forEach((row, index) => {
          const line = document.createElement("div");
          line.textContent = String(row[seat]);
          if (index < sheet.length - 1) line.className = "struck";
          sheetColumn.append(line);
        });
        dialog.body.append(sheetColumn);
      });
      if (over) {
        const icon = document.createElement("img");
        icon.className = "hearts-score-icon";
        icon.src = ICON;
        icon.alt = "";
        icon.style.left = `${Math.trunc((column - 32) / 2) + column * 4}px`;
        dialog.body.append(icon);
      }
      dialog.onResult(() => resolve());
    });

  const toggleSound = () => {
    settings = { ...settings, sound: !settings.sound };
    if (!settings.sound) stopSound();
    saveSettings();
  };

  const run = (command) => {
    if (command === "options") return showOptions();
    if (command === "sound") return toggleSound();
    if (command === "score") return void showScore();
    if (command === "quote") return showQuote();
    if (command === "about")
      return context.openAboutWindows({
        application: "Hearts Network",
        icon: ICON,
      });
    return context.close();
  };

  const handleKeydown = (event) => {
    if (event.defaultPrevented || globalThis.XPDialogs.isModalOpen()) return;
    const commands = { F7: "options", F8: "sound", F9: "score" };
    if (commands[event.key]) {
      // The name question of the welcome is modal, so these keys wait
      // until the name is in.
      event.preventDefault();
      run(commands[event.key]);
      return;
    }
    // Esc closes an open menu; otherwise it hides the game, mshearts.exe's
    // boss key. Ctrl+Esc and Alt+Esc belong to the shell.
    if (event.key === "Escape" && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (menus.isOpen()) menus.close();
      else context.minimize();
      return;
    }
    // Space plays the leftmost card that's allowed.
    if (event.key !== " " || event.target === passButton) return;
    event.preventDefault();
    if (phase !== "turn" || flash) return;
    round.slots[0].some(
      (slot, index) => slot.card !== -1 && tryPlay(index, true),
    );
  };
  context.windowElement.addEventListener("keydown", handleKeydown);

  // ---- Start: mshearts.exe asks for a name every time it opens ----
  draw();
  void Promise.all([loadCardFaces(), loadCardArt()])
    .then(([loadedFaces, loadedArt]) => {
      faces = loadedFaces;
      art = loadedArt;
      draw();
    })
    .catch((error) => dialogs.alert(error.message, "Hearts", "error"));
  void loadSystemFont()
    .then((font) => {
      systemFont = font;
      drawPassLabel();
    })
    .catch(() => {});
  queueMicrotask(showWelcome);

  return {
    element: root,
    unmount() {
      generation += 1;
      timers.forEach(clearTimeout);
      clearTimeout(flashTimer);
      stopSound();
      context.windowElement.removeEventListener("keydown", handleKeydown);
    },
  };
};

export const heartsApplication = defineApplication({
  ...applicationMetadata,
  mount: mountHearts,
});
