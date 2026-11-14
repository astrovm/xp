// @ts-nocheck -- Modeless dialogs, such as Run, among the windows, like XP.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  clickStartAction,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

const settle = async () => {
  for (let index = 0; index < 4; index += 1) await flushShell();
};
const key = (s, target, name, init = {}) => {
  const event = new s.window.KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};
const openRun = async (s) => {
  clickStartAction(s, "run");
  await settle();
  return s.document.querySelector(".run-dialog");
};
const openProperties = async (s) => {
  s.document.querySelector("#taskbar").dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  s.document.querySelector('[data-taskbar-action="properties"]').click();
  await settle();
  return s.document.querySelector(".taskbar-properties-dialog");
};
const openNotepad = async (s) => {
  clickStartAction(s, "run");
  await settle();
  const run = s.document.querySelector(".run-dialog");
  run.querySelector(".run-dialog .shell-dialog-input").value = "notepad";
  run.querySelector('[data-action="run"]').click();
  await settle();
  return s.document.querySelector('.xp-window[data-game="__notepad"]');
};
const layer = (element) => Number(element.style.zIndex);
const overlayOf = (dialog) => dialog.parentElement;

test("each of two modeless dialogs gets only its own keys", async () => {
  const s = await login(await loadShell());
  const run = await openRun(s);
  const properties = await openProperties(s);
  expect(s.document.querySelectorAll(".xp-dialog").length).toBe(2);
  // Escape in Run closes Run, although Properties opened after it.
  key(s, run.querySelector(".run-dialog .shell-dialog-input"), "Escape");
  expect(run.isConnected).toBeFalse();
  expect(properties.isConnected).toBeTrue();
  key(s, properties.querySelector("button"), "Escape");
  expect(properties.isConnected).toBeFalse();
});

test("Run and Properties open once, and opening them again brings them up", async () => {
  const s = await login(await loadShell());
  const run = await openRun(s);
  run.querySelector(".run-dialog .shell-dialog-input").value = "typed";
  const properties = await openProperties(s);
  expect(properties.classList.contains("active")).toBeTrue();
  expect(await openRun(s)).toBe(run);
  expect(s.document.querySelectorAll(".run-dialog").length).toBe(1);
  expect(run.querySelector(".run-dialog .shell-dialog-input").value).toBe(
    "typed",
  );
  expect(run.classList.contains("active")).toBeTrue();
  expect(properties.classList.contains("active")).toBeFalse();
  expect(layer(overlayOf(run))).toBeGreaterThan(layer(overlayOf(properties)));
  await openProperties(s);
  expect(s.document.querySelectorAll(".taskbar-properties-dialog").length).toBe(
    1,
  );
  expect(layer(overlayOf(properties))).toBeGreaterThan(layer(overlayOf(run)));
  expect(properties.classList.contains("active")).toBeTrue();
  expect(run.classList.contains("active")).toBeFalse();
});

test("Run and Create New Task give their Open boxes different ids", async () => {
  const s = await login(await loadShell());
  const run = await openRun(s);
  s.document.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Escape",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  const manager = s.document.querySelector(
    '.xp-window[data-game="__task-manager"]',
  );
  manager.querySelector(".tm-new-task").click();
  await settle();
  const boxes = [
    ...s.document.querySelectorAll(".run-dialog .shell-dialog-input"),
  ];
  expect(boxes.length).toBe(2);
  expect(new Set(boxes.map((box) => box.id)).size).toBe(2);
  const lists = boxes.map((box) => box.getAttribute("list"));
  expect(new Set(lists).size).toBe(2);
  boxes.forEach((box, index) =>
    expect(s.document.getElementById(lists[index]).tagName).toBe("DATALIST"),
  );
  expect(run.isConnected).toBeTrue();
  // Create New Task runs its command and closes. Run stays open.
  boxes[1].value = "notepad";
  boxes[1].closest(".run-dialog").querySelector('[data-action="run"]').click();
  await settle();
  expect(s.document.querySelectorAll(".run-dialog").length).toBe(1);
  expect(
    !!s.document.querySelector('.xp-window[data-game="__notepad"]'),
  ).toBeTrue();
  expect(run.isConnected).toBeTrue();
});

// Like XP's owned windows, a modeless dialog of a program, such as the
// Statistics Box of Calculator, comes up with its window.
test("a program's modeless dialog comes up with its window", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        calculatorSettings: JSON.stringify({ view: "scientific" }),
      },
    }),
  );
  s.window.history.replaceState(null, "", "#calculator");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await settle();
  const calculator = s.document.querySelector(
    '.xp-window[data-game="__calculator"]',
  );
  calculator.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  const statistics = s.document.querySelector(
    '.xp-dialog-modeless[data-owner="__calculator"]',
  );
  expect(!!statistics).toBeTrue();
  const notepad = await openNotepad(s);
  expect(layer(notepad)).toBeGreaterThan(layer(statistics));
  calculator.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  await settle();
  expect(layer(calculator)).toBeGreaterThan(layer(notepad));
  expect(layer(statistics)).toBeGreaterThan(layer(calculator));
  // The dialog that takes the keys brings its window up too. The window
  // keeps its taskbar button but draws inactive.
  notepad.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  notepad.querySelector("textarea").focus();
  await settle();
  expect(layer(notepad)).toBeGreaterThan(layer(calculator));
  statistics.querySelector(".calculator-statistics").focus();
  await settle();
  expect(layer(calculator)).toBeGreaterThan(layer(notepad));
  expect(layer(statistics)).toBeGreaterThan(layer(calculator));
  expect(calculator.classList.contains("active")).toBeFalse();
  expect(notepad.classList.contains("active")).toBeFalse();
});

test("Run goes behind a window that is used after it, and draws inactive", async () => {
  const s = await login(await loadShell());
  const notepad = await openNotepad(s);
  const runAgain = await openRun(s);
  expect(overlayOf(runAgain).parentElement.id).toBe("desktop");
  // A window that opens or is pressed after Run goes above it.
  notepad.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  notepad.querySelector("textarea").focus();
  await settle();
  expect(layer(notepad)).toBeGreaterThan(layer(overlayOf(runAgain)));
  expect(runAgain.classList.contains("active")).toBeFalse();
  expect(notepad.classList.contains("active")).toBeTrue();
  // Run that takes the keys goes on top, and the window draws inactive.
  runAgain.querySelector(".run-dialog .shell-dialog-input").focus();
  expect(layer(overlayOf(runAgain))).toBeGreaterThan(layer(notepad));
  expect(runAgain.classList.contains("active")).toBeTrue();
  expect(notepad.classList.contains("active")).toBeFalse();
  // A modal dialog of the window that closes leaves Run inactive.
  notepad.querySelector("textarea").focus();
  expect(runAgain.classList.contains("active")).toBeFalse();
  const message = s.window.XPDialogs.alert("Hello", "Notepad", "info");
  await settle();
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector('[data-action="ok"]')
    .click();
  await message;
  await settle();
  expect(runAgain.classList.contains("active")).toBeFalse();
});

test("Log Off closes Run", async () => {
  const s = await login(await loadShell());
  const run = await openRun(s);
  s.document.getElementById("start-button").click();
  s.document.getElementById("log-off-button").click();
  s.document.getElementById("logoff-confirm").click();
  await settle();
  expect(s.document.getElementById("welcome-screen").hidden).toBeFalse();
  expect(run.isConnected).toBeFalse();
  expect(s.document.querySelector(".xp-dialog")).toBeNull();
});

// Spider's test file has its case, because Spider needs its font files.
test("an open Run leaves the card games their keys, but a modal dialog does not", async () => {
  for (const [hash, gameKey] of [
    ["freecell", "F2"],
    ["hearts", "F9"],
    ["solitaire", "F2"],
  ]) {
    const s = await login(await loadShell());
    s.window.history.replaceState(null, "", `#${hash}`);
    s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
    await settle();
    const game = s.document.querySelector(`.xp-window[data-game="__${hash}"]`);
    // Hearts asks for a name first.
    const name = s.document.querySelector(".xp-dialog input.xp-input");
    if (name) name.value = "Tester";
    s.document.querySelector('.xp-dialog [data-action="ok"]')?.click();
    await settle();
    expect(s.window.XPDialogs.isModalOpen()).toBeFalse();
    const run = await openRun(s);
    expect(run.isConnected).toBeTrue();
    expect([hash, key(s, game, gameKey).defaultPrevented]).toEqual([
      hash,
      true,
    ]);
    await settle();
    [...s.document.querySelectorAll(".xp-dialog:not(.run-dialog)")].forEach(
      (dialog) => dialog.querySelector(".close-btn")?.click(),
    );
    await settle();
    void s.window.XPDialogs.alert("Modal", "Test", "info");
    await settle();
    expect(key(s, game, gameKey).defaultPrevented).toBeFalse();
    cleanupShells();
  }
});

const openStatistics = async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        calculatorSettings: JSON.stringify({ view: "scientific" }),
      },
    }),
  );
  s.window.history.replaceState(null, "", "#calculator");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  await settle();
  const calculator = s.document.querySelector(
    '.xp-window[data-game="__calculator"]',
  );
  key(s, calculator, "s", { ctrlKey: true });
  await settle();
  const statistics = s.document.querySelector(
    '.xp-dialog-modeless[data-owner="__calculator"]',
  );
  return { s, calculator, statistics };
};

// Like XP, Calculator is active again when its Statistics Box gives the
// keys back, with RET or when the box closes.
test("a window is active again when its dialog gives the keys back", async () => {
  const { s, calculator, statistics } = await openStatistics();
  const list = () => statistics.querySelector(".calculator-statistics");
  list().focus();
  await settle();
  expect(calculator.classList.contains("active")).toBeFalse();
  statistics.querySelector('[data-action="ret"]').click();
  await settle();
  expect(calculator.contains(s.document.activeElement)).toBeTrue();
  expect(calculator.classList.contains("active")).toBeTrue();
  expect(s.document.title).toBe("Calculator");
  list().focus();
  await settle();
  expect(calculator.classList.contains("active")).toBeFalse();
  statistics.querySelector(".title-bar .close-btn").click();
  await settle();
  expect(statistics.isConnected).toBeFalse();
  expect(calculator.classList.contains("active")).toBeTrue();
});

// Like XP, the Statistics Box hides while Calculator is minimized, and
// shows again when Calculator is restored.
test("a window's dialog hides while the window is minimized", async () => {
  const { s, calculator, statistics } = await openStatistics();
  statistics.querySelector(".calculator-statistics").focus();
  await settle();
  calculator.querySelector(".minimize-btn").click();
  await settle();
  expect(statistics.hidden).toBeTrue();
  // Happy DOM gives the taskbar no width, so Calculator's task button is
  // in the overflow menu.
  s.document.querySelector('#task-buttons [data-group="overflow"]').click();
  s.document.querySelector(".taskbar-overflow-item").click();
  await settle();
  expect(statistics.hidden).toBeFalse();
  expect(calculator.classList.contains("active")).toBeTrue();
  // Show Desktop hides it too, and brings it back.
  const showDesktop = async () => {
    s.document.getElementById("taskbar").dispatchEvent(
      new s.window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 750,
      }),
    );
    s.document
      .querySelector(
        '#taskbar-context-menu [data-taskbar-action="show-desktop"]',
      )
      .click();
    await settle();
  };
  await showDesktop();
  expect(statistics.hidden).toBeTrue();
  await showDesktop();
  expect(statistics.hidden).toBeFalse();
});

// Each press of a modeless dialog takes a new layer. The layers are
// numbered again before they reach the topmost windows (6800), so a
// window never goes above a topmost window or a shell dialog.
test("the window layers stay below the topmost windows", async () => {
  const s = await login(await loadShell());
  const notepad = await openNotepad(s);
  const run = await openRun(s);
  const box = run.querySelector(".shell-dialog-input");
  for (let index = 0; index < 7000; index += 1)
    run.dispatchEvent(
      new s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
  expect(layer(overlayOf(run))).toBeLessThan(6800);
  expect(layer(overlayOf(run))).toBeGreaterThan(layer(notepad));
  notepad.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  await settle();
  expect(layer(notepad)).toBeGreaterThan(layer(overlayOf(run)));
  expect(layer(notepad)).toBeLessThan(6800);
  box.focus();
  expect(layer(overlayOf(run))).toBeGreaterThan(layer(notepad));
  expect(layer(overlayOf(run))).toBeLessThan(6800);
  // Each of the 7000 presses runs the real activation, so the test needs
  // more than the default time.
}, 60000);
