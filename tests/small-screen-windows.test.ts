// @ts-nocheck -- Windows and card boards on a phone-sized screen.
import { afterEach, expect, test } from "bun:test";
import { measureBoard, prepareBoard } from "../site/apps/cards/cards.js";
import {
  cleanupShells,
  clickStartAction,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

const settle = async () => {
  for (let i = 0; i < 6; i++) await flushShell();
};

// A 390 by 844 phone: the desktop ends above the 30 pixel taskbar.
const openPhone = async () => {
  const s = await login(await loadShell());
  Object.defineProperties(s.document.getElementById("desktop"), {
    clientWidth: { configurable: true, value: 390 },
    clientHeight: { configurable: true, value: 814 },
  });
  Object.defineProperties(s.window, {
    innerWidth: { configurable: true, value: 390 },
    innerHeight: { configurable: true, value: 844 },
  });
  return s;
};

const runCommand = async (s, command) => {
  clickStartAction(s, "run");
  const dialog = s.document.querySelector(".run-dialog");
  dialog.querySelector("#run-command").value = command;
  dialog.querySelector('[data-action="run"]').click();
  await settle();
};

const windowFor = (s, id) =>
  s.document.querySelector(`.xp-window[data-game="${id}"]`);

test("programs with an XP position move back onto a narrow screen", async () => {
  const s = await openPhone();
  await runCommand(s, "notepad");
  const win = windowFor(s, "__notepad");
  expect(win.style.width).toBe("374px");
  // XP opens Notepad at (44, 58); 44 would push its right edge off screen.
  expect(win.style.left).toBe("16px");
  expect(win.style.top).toBe("58px");
});

test("fixed-size dialogs shrink to the screen and scale their client area", async () => {
  const s = await openPhone();
  s.document.getElementById("desktop-icons").dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  s.document
    .querySelector('#desktop-context-menu [data-action="properties"]')
    .click();
  await settle();
  const win = windowFor(s, "__display-properties");
  // 404 by 455 at 390 / 404 of its size.
  expect(win.style.width).toBe("390px");
  expect(win.style.height).toBe("439px");
  expect(win.style.left).toBe("0px");
  const client = win.querySelector(".display-properties-content");
  expect(Number(client.style.zoom)).toBeCloseTo(390 / 404, 6);
});

test("fixed-size windows fit once when the page reports no layout sizes", async () => {
  const s = await openPhone();
  const sizes = ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop"];
  const proto = s.window.HTMLElement.prototype;
  // Happy DOM shares its element classes across windows, so the originals
  // have to go back, not just away.
  const originals = sizes.map((name) =>
    Object.getOwnPropertyDescriptor(proto, name),
  );
  for (const name of sizes)
    Object.defineProperty(proto, name, {
      configurable: true,
      get: () => undefined,
    });
  try {
    s.document.getElementById("desktop-icons").dispatchEvent(
      new s.window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      }),
    );
    s.document
      .querySelector('#desktop-context-menu [data-action="properties"]')
      .click();
    await settle();
  } finally {
    sizes.forEach((name, index) =>
      Object.defineProperty(proto, name, originals[index]),
    );
  }
  // Fitted from the sizes it was given, without refitting forever.
  const win = windowFor(s, "__display-properties");
  expect(win.style.width).toBe("390px");
  expect(win.style.height).toBe("439px");
});

test("fixed-size programs refit when they resize themselves", async () => {
  const s = await openPhone();
  s.window.history.replaceState(null, "", "#minesweeper");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await settle();
  const win = windowFor(s, "__minesweeper");
  const client = win.querySelector(".xp-native-program");
  // Beginner fits, so nothing scales.
  expect(win.style.width).toBe("170px");
  expect(client.style.zoom).toBe("");

  const choose = async (command) => {
    win.querySelector(`[data-command="${command}"]`).click();
    await settle();
  };
  // Expert's board is 506 by 377, wider than the phone.
  await choose("expert");
  expect(win.style.width).toBe("390px");
  expect(win.style.minWidth).toBe("390px");
  expect(Number(client.style.zoom)).toBeCloseTo(390 / 506, 6);
  expect(win.style.height).toBe(`${Math.floor(377 * (390 / 506))}px`);

  // Back to Beginner, the window is its own size again.
  await choose("beginner");
  expect(win.style.width).toBe("170px");
  expect(win.style.height).toBe("265px");
  expect(win.style.minWidth).toBe("170px");
  expect(client.style.zoom).toBe("");

  // Moving the window keeps the fit.
  win.style.left = "40px";
  await settle();
  expect(win.style.width).toBe("170px");
});

test("fixed-size windows keep a deliberate offscreen pixel when they fit", async () => {
  const s = await openPhone();
  s.document
    .getElementById("tray-volume-button")
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  await settle();
  const win = windowFor(s, "__volume-control");
  // sndvol32 opens one pixel above the screen's top edge.
  expect(win.style.top).toBe("-1px");
  expect(win.style.width).toBe("247px");
});

const canvas = (clientWidth, clientHeight) => ({
  clientWidth,
  clientHeight,
  width: 0,
  height: 0,
});
const graphics = () => {
  const calls = [];
  return {
    calls,
    imageSmoothingEnabled: null,
    setTransform: (...values) => calls.push(values),
  };
};

test("card boards keep their layout and scale down on a narrow screen", () => {
  expect(measureBoard(canvas(585, 384), 585)).toEqual({
    width: 585,
    height: 384,
  });
  expect(measureBoard(canvas(800, 600), 585)).toEqual({
    width: 800,
    height: 600,
  });
  // Half as wide shows the whole deal at half size, twice as tall inside.
  expect(measureBoard(canvas(292.5, 300), 585)).toEqual({
    width: 585,
    height: 600,
  });
  // Before layout, the board has no size to scale.
  expect(measureBoard(canvas(0, 0), 585)).toEqual({ width: 0, height: 0 });
});

test("card boards draw at the render density and smooth only uneven scales", () => {
  const previous = globalThis.window;
  globalThis.window = { devicePixelRatio: 2 };
  try {
    const board = canvas(390, 400);
    const crisp = graphics();
    prepareBoard(board, crisp, { width: 390, height: 400 });
    expect([board.width, board.height]).toEqual([780, 800]);
    expect(crisp.calls).toEqual([[2, 0, 0, 2, 0, 0]]);
    expect(crisp.imageSmoothingEnabled).toBeFalse();

    const scaled = graphics();
    prepareBoard(board, scaled, measureBoard(board, 585));
    expect([board.width, board.height]).toEqual([780, 800]);
    expect(scaled.calls[0][0]).toBeCloseTo(780 / 585, 6);
    expect(scaled.imageSmoothingEnabled).toBeTrue();

    // A 1.25 ratio renders at 2, like the rest of the page.
    globalThis.window = { devicePixelRatio: 1.25 };
    const unsized = canvas(0, 0);
    const empty = graphics();
    prepareBoard(unsized, empty, { width: 0, height: 0 });
    expect([unsized.width, unsized.height]).toEqual([0, 0]);
    expect(empty.calls).toEqual([[2, 0, 0, 2, 0, 0]]);
  } finally {
    globalThis.window = previous;
  }
});

test("fixed-size windows refit when the screen turns", async () => {
  const s = await openPhone();
  s.document.getElementById("desktop-icons").dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  s.document
    .querySelector('#desktop-context-menu [data-action="properties"]')
    .click();
  await settle();
  const win = windowFor(s, "__display-properties");
  const client = win.querySelector(".display-properties-content");
  const turn = async (width, height) => {
    Object.defineProperties(s.document.getElementById("desktop"), {
      clientWidth: { configurable: true, value: width },
      clientHeight: { configurable: true, value: height - 30 },
    });
    Object.defineProperties(s.window, {
      innerWidth: { configurable: true, value: width },
      innerHeight: { configurable: true, value: height },
    });
    s.window.dispatchEvent(new s.window.Event("resize"));
    await settle();
  };
  // Sideways, there's room across but only 360 pixels down.
  await turn(844, 390);
  expect(win.style.height).toBe("360px");
  expect(Number(client.style.zoom)).toBeCloseTo(360 / 455, 6);
  expect(win.style.top).toBe("0px");
  // Upright again on a bigger screen, the dialog is its own size.
  await turn(1024, 768);
  expect(win.style.width).toBe("404px");
  expect(win.style.height).toBe("455px");
  expect(client.style.zoom).toBe("");
  // It no longer holds the smaller size as its minimum.
  expect(win.style.minWidth).toBe("");
  expect(win.style.minHeight).toBe("");
});

test("a screen smaller than a window's frame leaves the window alone", async () => {
  const s = await openPhone();
  // A 50 pixel frame around the client area, on a 40 by 40 screen.
  const proto = s.window.HTMLElement.prototype;
  const offsetWidth = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get() {
      return this.classList.contains("xp-window") ? 50 : 0;
    },
  });
  Object.defineProperties(s.document.getElementById("desktop"), {
    clientWidth: { configurable: true, value: 40 },
    clientHeight: { configurable: true, value: 600 },
  });
  Object.defineProperty(s.window, "innerWidth", {
    configurable: true,
    value: 40,
  });
  try {
    s.document.getElementById("desktop-icons").dispatchEvent(
      new s.window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      }),
    );
    s.document
      .querySelector('#desktop-context-menu [data-action="properties"]')
      .click();
    await settle();
  } finally {
    Object.defineProperty(proto, "offsetWidth", offsetWidth);
  }
  const win = windowFor(s, "__display-properties");
  expect(win.style.width).toBe("404px");
  expect(win.querySelector(".display-properties-content").style.zoom).toBe("");
});
