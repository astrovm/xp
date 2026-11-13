import { applicationMetadata } from "./metadata.js";
import { defineApplication } from "../core/application.js";
import { wireMenuBar } from "../core/menu-bar.js";
import {
  BACKS,
  CARD_HEIGHT,
  CARD_WIDTH,
  loadCardArt,
  loadCardFaces,
  measureBoard,
  prepareBoard,
  shrinkLikeGdi,
} from "../cards/cards.js";
import { openTemplateDialog } from "../cards/template-dialog.js";
import {
  DECK,
  FOUNDATIONS,
  TABLEAU,
  WASTE,
  canDrop,
  canRecycle,
  canTurnDeckOver,
  clonePiles,
  deal,
  drawCards,
  foundationFor,
  isWon,
  moveCards,
  moveEvent,
  recycle,
  scoreAfter,
  seedFromTime,
  timeBonus,
} from "./game.js";

const SETTINGS_KEY = "solitaireSettings";
const GREEN = "#008000";
const MENUS = [
  [
    "&Game",
    [
      ["&Deal", "deal", "F2", "Deal a new game"],
      "-",
      ["&Undo", "undo", "", "Undo last action"],
      ["De&ck...", "deck", "", "Choose new deck back"],
      ["&Options...", "options", "", "Change Solitaire options"],
      "-",
      ["E&xit", "exit", "", "Exit Solitaire"],
    ],
  ],
  ["&Help", [["&About Solitaire", "about", "", "About Solitaire"]]],
];

const readSettings = () => {
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (value && typeof value === "object") saved = value;
  } catch {
    // Unreadable settings fall back to XP's defaults.
  }
  const flag = (value, fallback) =>
    typeof value === "boolean" ? value : fallback;
  return {
    // Without a saved back, sol.exe picks one at random.
    back: BACKS.includes(saved.back)
      ? saved.back
      : BACKS[Math.floor(Math.random() * BACKS.length)],
    draw: saved.draw === 1 ? 1 : 3,
    scoring: ["standard", "vegas", "none"].includes(saved.scoring)
      ? saved.scoring
      : "standard",
    timed: flag(saved.timed, true),
    statusBar: flag(saved.statusBar, true),
    outline: flag(saved.outline, false),
    cumulative: flag(saved.cumulative, false),
  };
};

const mountSolitaire = (context) => {
  const { dialogs } = context;
  const root = document.createElement("div");
  root.className = "xp-native-program xp-solitaire";
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="cards-menu-bar" role="menubar"></div>
    <canvas class="solitaire-board" role="application" aria-label="Solitaire"></canvas>
    <div class="solitaire-status"><span class="solitaire-help"></span><span class="solitaire-score"></span></div>`;
  const menuBar = root.querySelector(".cards-menu-bar");
  const canvas = root.querySelector("canvas");
  const status = root.querySelector(".solitaire-status");
  const helpText = root.querySelector(".solitaire-help");
  const scoreText = root.querySelector(".solitaire-score");
  const graphics = canvas.getContext("2d");

  let settings = readSettings();
  let faces = null;
  let art = null;
  let piles = Array.from({ length: 13 }, () => []);
  // How many of the waste's top cards fan out to the right.
  let fan = 0;
  let score = 0;
  let passes = 0;
  let ticks = 0;
  let started = false;
  let active = false;
  let undoState = null;
  let drag = null;
  let winning = null;
  let layout = null;

  const saveSettings = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Settings stay for this session when storage is unavailable.
    }
  };

  // ---- Layout, from sol.exe's client width ----
  const measure = () => {
    const minGap = Math.floor(CARD_WIDTH / 8) + 3;
    const { width, height } = measureBoard(canvas, CARD_WIDTH * 7 + minGap * 8);
    const gap = Math.max(minGap, Math.floor((width - CARD_WIDTH * 7) / 8));
    layout = { width, height, gap };
  };
  const pileBase = (pile) => {
    const { gap } = layout;
    if (pile === DECK) return { x: gap, y: 5 };
    if (pile === WASTE) return { x: gap * 2 + CARD_WIDTH, y: 5 };
    if (FOUNDATIONS.includes(pile))
      return {
        x: CARD_WIDTH * 3 + gap * 4 + (pile - 2) * (CARD_WIDTH + gap),
        y: 5,
      };
    return { x: gap + (pile - 6) * (CARD_WIDTH + gap), y: 107 };
  };
  // Piles stack every few cards a little down and to the right; the waste
  // fans its newest cards, and the tableau steps 3 pixels per face-down
  // card and 15 per face-up card.
  const cardPosition = (pile, index, cards = piles[pile]) => {
    const base = pileBase(pile);
    const stacked = (count, every) => ({
      x: base.x + Math.floor(count / every) * 2,
      y: base.y + Math.floor(count / every),
    });
    if (pile === DECK) return stacked(index, 10);
    if (FOUNDATIONS.includes(pile)) return stacked(index, 4);
    if (pile === WASTE) {
      const below = cards.length - fan;
      if (index < below) return stacked(index, 10);
      const anchor = stacked(Math.max(0, below - 1), 10);
      return {
        x: anchor.x + (index - below) * 14,
        y: anchor.y + (index - below),
      };
    }
    let y = base.y;
    for (let card = 0; card < index; card += 1) y += cards[card].up ? 15 : 3;
    return { x: base.x, y };
  };
  const contains = ({ x, y }, point) =>
    point.x >= x &&
    point.x < x + CARD_WIDTH &&
    point.y >= y &&
    point.y < y + CARD_HEIGHT;

  // ---- Drawing ----
  const drawCard = ({ card, up }, x, y) => {
    if (!faces || !art) return;
    graphics.drawImage(
      up ? faces[card].normal : art.backs[settings.back],
      x,
      y,
    );
  };
  const draw = () => {
    prepareBoard(canvas, graphics, layout);
    if (winning) return;
    graphics.fillStyle = GREEN;
    graphics.fillRect(0, 0, layout.width, layout.height);
    piles.forEach((cards, pile) => {
      const base = pileBase(pile);
      if (!cards.length && art) {
        if (pile === DECK)
          graphics.drawImage(
            canRecycle({
              scoring: settings.scoring,
              draw: settings.draw,
              passes,
            })
              ? art.o
              : art.x,
            base.x,
            base.y,
          );
        if (FOUNDATIONS.includes(pile))
          graphics.drawImage(art.empty, base.x, base.y);
      }
      const shown =
        drag?.moving && drag.source === pile ? drag.index : cards.length;
      for (let index = 0; index < shown; index += 1) {
        const { x, y } = cardPosition(pile, index);
        drawCard(cards[index], x, y);
      }
    });
    if (!drag?.moving) return;
    const { x, y } = drag;
    if (settings.outline) {
      // Outline dragging inverts a frame around the cards and a line at
      // each card's top, and inverts the card it would land on.
      graphics.globalCompositeOperation = "difference";
      graphics.fillStyle = "#fff";
      const height = (drag.cards.length - 1) * drag.step + CARD_HEIGHT;
      graphics.fillRect(x, y, CARD_WIDTH, 1);
      graphics.fillRect(x, y + height, CARD_WIDTH + 1, 1);
      graphics.fillRect(x, y + 1, 1, height - 1);
      graphics.fillRect(x + CARD_WIDTH, y, 1, height);
      for (let card = 1; card < drag.cards.length; card += 1)
        graphics.fillRect(x, y + card * drag.step, CARD_WIDTH, 1);
      if (drag.target !== null) {
        const cards = piles[drag.target];
        const spot = cards.length
          ? cardPosition(drag.target, cards.length - 1)
          : pileBase(drag.target);
        graphics.fillRect(spot.x, spot.y, CARD_WIDTH, CARD_HEIGHT);
      }
      graphics.globalCompositeOperation = "source-over";
      return;
    }
    drag.cards.forEach((card, index) =>
      drawCard(card, x, y + index * drag.step),
    );
  };

  const resize = () => {
    measure();
    draw();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  // ---- Status bar: menu help on the left, score and time on the right ----
  const showStatus = () => {
    status.hidden = !settings.statusBar;
    const parts = [];
    if (settings.scoring !== "none") {
      const negative = score < 0;
      const amount = Math.abs(score);
      const value = `${negative ? "-" : ""}${settings.scoring === "vegas" ? "$" : ""}${amount}`;
      parts.push(
        `Score: <span class="${negative ? "negative" : ""}">${value} </span>`,
      );
    }
    if (settings.timed) parts.push(`Time: ${ticks >> 2}`);
    scoreText.innerHTML = parts.join("");
  };
  const setHelp = (text) => {
    helpText.textContent = text;
  };

  // ---- Menus, styled like Task Manager's, with sol.exe's status help ----
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
        const [itemLabel, command, shortcut, help] = item;
        const entry = document.createElement("button");
        entry.type = "button";
        entry.setAttribute("role", "menuitem");
        entry.dataset.command = command;
        entry.disabled = command === "undo" && (!undoState || Boolean(drag));
        const text = document.createElement("span");
        context.setAccessKeyText(text, itemLabel);
        const key = document.createElement("kbd");
        key.textContent = shortcut;
        entry.append(text, key);
        entry.addEventListener("pointerenter", () => setHelp(help));
        entry.addEventListener("pointerleave", () => setHelp(""));
        entry.addEventListener("click", () => {
          menus.close();
          void run(command);
        });
        menu.append(entry);
      });
      menuBar.append(menu);
      return menu;
    },
    hideMenu: (menu) => {
      menu.remove();
      setHelp("");
    },
  });
  MENUS.forEach(([label, items]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.dataset.solitaireMenu = label.replace(/&/g, "").toLowerCase();
    context.setAccessKeyText(button, label);
    menuItems.set(button, items);
    menuBar.append(button);
  });

  // ---- Games ----
  const addScore = (event) => {
    score = scoreAfter(
      { score, scoring: settings.scoring, draw: settings.draw, passes },
      event,
    );
  };

  // A new deal. Vegas with Cumulative Score keeps the running total unless
  // the options just changed.
  const dealGame = (resetScore = false) => {
    stopWin();
    piles = deal(seedFromTime());
    fan = 0;
    passes = 0;
    ticks = 0;
    started = false;
    active = true;
    undoState = null;
    drag = null;
    const keep =
      settings.scoring === "vegas" && settings.cumulative && !resetScore;
    if (!keep) score = 0;
    addScore("deal");
    setHelp("");
    showStatus();
    draw();
  };

  const remember = () => {
    undoState = { piles: clonePiles(piles), fan, score, passes };
  };
  // Undo is only offered when there's a move to undo and no drag.
  const undo = () => {
    ({ piles, fan, score, passes } = undoState);
    undoState = null;
    showStatus();
    draw();
  };

  // Moves cards between piles, scoring and remembering the move for Undo.
  const move = (source, index, target) => {
    remember();
    const removed = moveCards(piles, source, index, target);
    if (source === WASTE) fan = Math.max(0, fan - removed.length);
    const event = moveEvent(source, target);
    if (event) addScore(event);
    showStatus();
    draw();
    checkWin();
  };

  const checkWin = () => {
    if (isWon(piles)) void win();
  };

  const clickDeck = (point, oneCard) => {
    const base = pileBase(DECK);
    if (!piles[DECK].length) {
      if (!contains(base, point)) return false;
      const state = { scoring: settings.scoring, draw: settings.draw, passes };
      if (!canTurnDeckOver(state, piles[WASTE].length)) return true;
      remember();
      passes += 1;
      recycle(piles);
      fan = 0;
      addScore("recycle");
    } else {
      const top = cardPosition(DECK, piles[DECK].length - 1);
      if (!contains(top, point)) return false;
      remember();
      fan = drawCards(piles, oneCard ? 1 : settings.draw);
    }
    showStatus();
    draw();
    return true;
  };

  // The card a press picks up: the waste's top card, any foundation card,
  // or a face-up tableau card with everything on it.
  const pickUp = (point) => {
    for (let pile = WASTE; pile <= 12; pile += 1) {
      const cards = piles[pile];
      if (!cards.length) continue;
      const last = cards.length - 1;
      if (TABLEAU.includes(pile) && !cards[last].up) {
        if (contains(cardPosition(pile, last), point)) return { flip: pile };
        continue;
      }
      const lowest = pile === WASTE ? last : 0;
      for (let index = last; index >= lowest; index -= 1) {
        if (!cards[index].up) break;
        if (contains(cardPosition(pile, index), point))
          return { source: pile, index };
      }
    }
    return null;
  };

  // The pile the dragged cards would land on: the first one whose top card
  // (or empty space) overlaps the first dragged card and takes it.
  const dropTarget = () => {
    const rect = { x: drag.x, y: drag.y };
    const overlaps = (spot, width, height) =>
      rect.x < spot.x + width &&
      spot.x < rect.x + CARD_WIDTH &&
      rect.y < spot.y + height &&
      spot.y < rect.y + CARD_HEIGHT;
    const cards = drag.cards.map(({ card }) => card);
    for (const pile of [...FOUNDATIONS, ...TABLEAU]) {
      if (pile === drag.source) continue;
      const pileCards = piles[pile];
      const spot = pileCards.length
        ? cardPosition(pile, pileCards.length - 1)
        : pileBase(pile);
      const height =
        pileCards.length || FOUNDATIONS.includes(pile)
          ? CARD_HEIGHT
          : layout.height;
      if (overlaps(spot, CARD_WIDTH, height) && canDrop(piles, pile, cards))
        return pile;
    }
    return null;
  };

  const pointerPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / layout.width;
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
  };

  const toFoundation = (pile) => {
    const cards = piles[pile];
    const last = cards.at(-1);
    if (!last?.up) return false;
    const target = foundationFor(piles, last.card);
    if (target === undefined) return false;
    move(pile, cards.length - 1, target);
    return true;
  };

  canvas.addEventListener("pointerdown", () =>
    root.focus({ preventScroll: true }),
  );
  canvas.addEventListener("mousedown", (event) => {
    if (!active || winning || drag) return;
    const point = pointerPoint(event);
    if (event.button === 2) {
      // The right button sends each pile's top card home, one pass.
      for (const pile of [DECK, WASTE, ...TABLEAU]) toFoundation(pile);
      return;
    }
    if (event.button !== 0) return;
    started = true;
    if (event.detail === 2) {
      // A double-click sends the card under it home.
      for (const pile of [WASTE, ...TABLEAU]) {
        const cards = piles[pile];
        if (
          cards.length &&
          contains(cardPosition(pile, cards.length - 1), point)
        ) {
          toFoundation(pile);
          return;
        }
      }
      return;
    }
    const oneCard = event.ctrlKey && event.altKey && event.shiftKey;
    if (clickDeck(point, oneCard)) return;
    const picked = pickUp(point);
    if (!picked) return;
    if (picked.flip !== undefined) {
      piles[picked.flip].at(-1).up = true;
      undoState = null;
      addScore("turnOver");
      showStatus();
      draw();
      return;
    }
    const start = cardPosition(picked.source, picked.index);
    drag = {
      ...picked,
      cards: piles[picked.source].slice(picked.index),
      step: TABLEAU.includes(picked.source) ? 15 : 0,
      offsetX: start.x - point.x,
      offsetY: start.y - point.y,
      x: start.x,
      y: start.y,
      startX: start.x,
      startY: start.y,
      moving: false,
      target: null,
    };
  });

  const followPointer = (event) => {
    if (!drag || drag.sliding) return;
    const point = pointerPoint(event);
    drag.x = point.x + drag.offsetX;
    drag.y = point.y + drag.offsetY;
    drag.moving = true;
    drag.target = dropTarget();
    draw();
  };
  canvas.addEventListener("mousemove", followPointer);

  // Dropped cards that land nowhere slide back, one step per 35 pixels. A
  // new deal or undo during the slide ends it.
  const slideBack = async () => {
    const sliding = drag;
    if (sliding.sliding) return;
    sliding.sliding = true;
    if (!settings.outline) {
      const distance = Math.hypot(
        sliding.x - sliding.startX,
        sliding.y - sliding.startY,
      );
      const steps = Math.floor(distance / 35);
      const fromX = sliding.x;
      const fromY = sliding.y;
      for (let step = 1; step <= steps; step += 1) {
        sliding.x = Math.round(
          fromX + ((sliding.startX - fromX) * step) / steps,
        );
        sliding.y = Math.round(
          fromY + ((sliding.startY - fromY) * step) / steps,
        );
        draw();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (drag !== sliding) return;
      }
    }
    drag = null;
    draw();
  };
  // The drop is heard anywhere, so releasing the button off the board still
  // ends the drag.
  const drop = (event) => {
    if (!drag || drag.sliding || event.button !== 0) return;
    if (drag.moving) followPointer(event);
    const { target, source, index } = drag;
    if (target === null) {
      void slideBack();
      return;
    }
    drag = null;
    move(source, index, target);
  };
  document.addEventListener("mouseup", drop);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  // ---- Winning: the cards bounce off the table, kings first ----
  const stopWin = () => {
    if (!winning) return;
    winning.stop = true;
    winning = null;
  };
  const win = async () => {
    active = false;
    undoState = null;
    let bonus = 0;
    if (settings.scoring === "standard" && settings.timed) {
      bonus = timeBonus(ticks >> 2);
      score += bonus;
    }
    showStatus();
    setHelp(
      `${settings.scoring === "standard" ? `Bonus: ${bonus}  ` : ""}Press Esc or a mouse button to stop...`,
    );
    const animation = { stop: false };
    winning = animation;
    const random = Math.random;
    const floor = layout.height - CARD_HEIGHT;
    // sol.exe waits 5 ms between steps.
    let clock = performance.now();
    const step = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let rank = 12; rank >= 0 && !animation.stop; rank -= 1)
      for (const pile of FOUNDATIONS) {
        if (animation.stop) break;
        let dx = Math.floor(random() * 110) - 65;
        if (Math.abs(dx) < 15) dx = -20;
        let dy = Math.floor(random() * 110) - 75;
        const start = cardPosition(pile, rank);
        let x = start.x;
        let y = start.y;
        const card = { card: piles[pile][rank].card, up: true };
        while (x > -CARD_WIDTH && x < layout.width && !animation.stop) {
          drawCard(card, x, y);
          x += Math.trunc(dx / 10);
          y += Math.trunc(dy / 10);
          dy += 3;
          if (y > floor && dy > 0) dy = Math.trunc((dy * -8) / 10);
          clock += 5;
          if (clock > performance.now()) await step();
        }
      }
    if (winning !== animation) return;
    winning = null;
    setHelp("");
    // The table clears before Deal Again? asks.
    graphics.fillStyle = GREEN;
    graphics.fillRect(0, 0, layout.width, layout.height);
    const again = await dialogs.message({
      title: "Solitaire",
      text: "Deal Again?",
      icon: "warning",
      buttons: [
        { id: "yes", label: "&Yes", isDefault: true },
        { id: "no", label: "&No", isCancel: true },
      ],
    });
    if (again === "yes") dealGame();
    else draw();
  };
  const stopOnInput = (event) => {
    if (!winning) return;
    if (event.type === "keydown" && event.key !== "Escape") return;
    winning.stop = true;
  };
  context.windowElement.addEventListener("keydown", stopOnInput);
  canvas.addEventListener("pointerdown", stopOnInput);

  // ---- The clock: a tick every 250 ms once the game starts ----
  const timer = setInterval(() => {
    if (!active || !started || !settings.timed) return;
    // A minimized window stops the clock, like sol.exe when iconic.
    if (context.windowElement.style.display === "none") return;
    ticks = Math.min(ticks + 1, 0x7ffe);
    if (ticks % 40 === 0) addScore("timer");
    showStatus();
  }, 250);

  // ---- Dialogs ----
  const template = (options) =>
    openTemplateDialog({
      dialogs,
      setAccessKeyText: context.setAccessKeyText,
      owner: { window: context.windowElement, client: canvas },
      ...options,
    });

  const showDeck = () => {
    const ids = BACKS;
    const rects = [
      [8, 4],
      [36, 4],
      [64, 4],
      [92, 4],
      [120, 4],
      [148, 4],
      [8, 48],
      [36, 48],
      [64, 48],
      [92, 48],
      [120, 48],
      [148, 48],
    ];
    const { dialog } = template({
      title: "Select Card Back",
      size: [178, 112],
      position: [11, 12],
      help: true,
      controls: [
        ...ids.map((id, index) => ({
          type: "button",
          id: `back-${id}`,
          label: "",
          rect: [...rects[index], 26, 42],
        })),
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [44, 94, 40, 14],
          isDefault: true,
        },
        {
          type: "button",
          id: "cancel",
          label: "Cancel",
          rect: [94, 94, 40, 14],
        },
      ],
    });
    let chosen = settings.back;
    const buttons = ids.map((id) =>
      dialog.body.querySelector(`[data-action="back-${id}"]`),
    );
    // Each back is stretched into its button, inside a frame that shows the
    // selection.
    buttons.forEach((button, index) => {
      button.classList.remove("xp-btn");
      button.classList.add("solitaire-back");
      const preview = document.createElement("canvas");
      preview.width = 33;
      preview.height = 62;
      if (art)
        preview
          .getContext("2d")
          .drawImage(shrinkLikeGdi(art.backs[ids[index]], 33, 62), 0, 0);
      button.append(preview);
      button.classList.toggle("selected", ids[index] === chosen);
      button.addEventListener("focus", () => {
        chosen = ids[index];
        buttons.forEach((other, otherIndex) =>
          other.classList.toggle("selected", ids[otherIndex] === chosen),
        );
      });
      button.addEventListener("dblclick", () => dialog.close("ok"));
    });
    const close = dialog.close;
    dialog.close = (result) => {
      if (result?.startsWith("back-")) {
        buttons[ids.indexOf(Number(result.slice(5)))].focus();
        return;
      }
      if (result === "ok") {
        settings.back = chosen;
        saveSettings();
        draw();
      }
      close(result);
    };
    buttons[ids.indexOf(chosen)].focus();
  };

  const showOptions = () => {
    const { dialog, elements } = template({
      title: "Options",
      size: [134, 101],
      position: [50, 31],
      help: true,
      controls: [
        { type: "group", label: "&Draw", rect: [4, 4, 60, 36] },
        {
          type: "radio",
          id: "drawOne",
          group: "draw",
          label: "Draw &One",
          rect: [8, 13, 52, 12],
        },
        {
          type: "radio",
          id: "drawThree",
          group: "draw",
          label: "Draw &Three",
          rect: [8, 25, 52, 12],
        },
        { type: "group", label: "&Scoring", rect: [68, 4, 56, 48] },
        {
          type: "radio",
          id: "standard",
          group: "scoring",
          label: "St&andard",
          rect: [72, 14, 43, 12],
        },
        {
          type: "radio",
          id: "vegas",
          group: "scoring",
          label: "&Vegas",
          rect: [72, 26, 36, 12],
        },
        {
          type: "radio",
          id: "none",
          group: "scoring",
          label: "&None",
          rect: [72, 38, 30, 12],
        },
        {
          type: "checkbox",
          id: "timed",
          label: "T&imed game",
          rect: [8, 44, 52, 12],
        },
        {
          type: "checkbox",
          id: "statusBar",
          label: "Status &bar",
          rect: [8, 56, 52, 12],
        },
        {
          type: "checkbox",
          id: "outline",
          label: "Out&line dragging",
          rect: [8, 68, 76, 12],
        },
        {
          type: "checkbox",
          id: "cumulative",
          label: "&Cumulative",
          rect: [72, 56, 62, 12],
        },
        {
          type: "text",
          id: "scoreLabel",
          label: "Score",
          rect: [84, 68, 20, 12],
        },
        {
          type: "button",
          id: "ok",
          label: "OK",
          rect: [36, 84, 36, 14],
          isDefault: true,
        },
        {
          type: "button",
          id: "cancel",
          label: "Cancel",
          rect: [76, 84, 40, 14],
        },
      ],
    });
    elements[settings.draw === 1 ? "drawOne" : "drawThree"].checked = true;
    elements[settings.scoring].checked = true;
    elements.timed.checked = settings.timed;
    elements.statusBar.checked = settings.statusBar;
    elements.outline.checked = settings.outline;
    elements.cumulative.checked = settings.cumulative;
    // Cumulative Score applies to Vegas only.
    const syncVegas = () => {
      const vegas = elements.vegas.checked;
      elements.cumulative.disabled = !vegas;
      elements.scoreLabel.classList.toggle("disabled", !vegas);
    };
    syncVegas();
    ["standard", "vegas", "none"].forEach((name) =>
      elements[name].addEventListener("change", syncVegas),
    );
    dialog.onResult((result) => {
      if (result !== "ok") return;
      const draw = elements.drawOne.checked ? 1 : 3;
      const scoring = ["standard", "vegas", "none"].find(
        (name) => elements[name].checked,
      );
      const redeal =
        draw !== settings.draw ||
        scoring !== settings.scoring ||
        elements.timed.checked !== settings.timed;
      settings = {
        ...settings,
        draw,
        scoring,
        timed: elements.timed.checked,
        statusBar: elements.statusBar.checked,
        outline: elements.outline.checked,
        cumulative: elements.cumulative.checked,
      };
      saveSettings();
      showStatus();
      if (redeal) dealGame(true);
    });
  };

  const run = async (command) => {
    if (command === "deal") return dealGame();
    if (command === "undo") return undo();
    if (command === "deck") return showDeck();
    if (command === "options") return showOptions();
    if (command === "about")
      return context.openAboutWindows({
        application: "Solitaire",
        icon: "assets/xp/solitaire/Solitaire-32.png",
        otherStuff: "Developed for Microsoft by Wes Cherry",
      });
    return context.close();
  };

  // Alt+Shift+2 wins on the spot, sol.exe's hidden shortcut.
  const handleKeydown = (event) => {
    if (document.querySelector(".xp-dialog-overlay") || winning) return;
    if (event.key === "F2") {
      event.preventDefault();
      void run("deal");
    } else if (event.key === "Escape" && drag) {
      void slideBack();
    } else if (event.altKey && event.shiftKey && event.code === "Digit2") {
      event.preventDefault();
      if (!active) return;
      piles = piles.map(() => []);
      FOUNDATIONS.forEach((pile, suit) => {
        piles[pile] = Array.from({ length: 13 }, (_, rank) => ({
          card: rank * 4 + suit,
          up: true,
        }));
      });
      fan = 0;
      draw();
      checkWin();
    }
  };
  context.windowElement.addEventListener("keydown", handleKeydown);

  // ---- Start: sol.exe deals as soon as it opens ----
  measure();
  void Promise.all([loadCardFaces(), loadCardArt()])
    .then(([loadedFaces, loadedArt]) => {
      faces = loadedFaces;
      art = loadedArt;
      draw();
    })
    .catch((error) => dialogs.alert(error.message, "Solitaire", "error"));
  dealGame();
  queueMicrotask(() => root.focus({ preventScroll: true }));

  return {
    element: root,
    unmount() {
      stopWin();
      clearInterval(timer);
      context.windowElement.removeEventListener("keydown", stopOnInput);
      resizeObserver.disconnect();
      document.removeEventListener("mouseup", drop);
      context.windowElement.removeEventListener("keydown", handleKeydown);
    },
  };
};

export const solitaireApplication = defineApplication({
  ...applicationMetadata,
  mount: mountSolitaire,
});
