// @ts-nocheck -- XP's caption animations through the real shell.
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
  for (let i = 0; i < 4; i++) await flushShell();
};

// Gives a window real geometry, as the browser's layout would.
function geometry(s, win, rect = {}) {
  const desktop = s.document.getElementById("desktop");
  Object.defineProperties(desktop, {
    clientWidth: { configurable: true, value: 1024 },
    clientHeight: { configurable: true, value: 768 },
  });
  Object.assign(win.style, {
    left: "100px",
    top: "80px",
    width: "500px",
    height: "400px",
    ...rect,
  });
  for (const [prop, style] of Object.entries({
    offsetLeft: "left",
    offsetTop: "top",
    offsetWidth: "width",
    offsetHeight: "height",
  }))
    Object.defineProperty(win, prop, {
      configurable: true,
      get: () => parseFloat(win.style[style]) || 0,
    });
  win.getBoundingClientRect = () => ({
    left: win.offsetLeft,
    top: win.offsetTop,
    width: win.offsetWidth,
    height: win.offsetHeight,
    right: win.offsetLeft + win.offsetWidth,
    bottom: win.offsetTop + win.offsetHeight,
  });
  win.getAnimations ??= () => [];
}

// A restored caption is the window's width without its 4px frame on each side.
const CAPTION_WIDTH = 492;
const WHOLE_ANIMATION = 400;

async function documents({ windowAnimations = true } = {}) {
  const s = await login(await loadShell({ windowAnimations }));
  clickStartAction(s, "documents");
  await settle();
  const win = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  geometry(s, win);
  // A task button only appears when the taskbar has room for it.
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    {
      value: 800,
      configurable: true,
    },
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  const taskButton = () =>
    s.document.querySelector('.task-button[data-game="__my-documents"]');
  // Happy DOM has no layout, so the button needs a rectangle for the caption
  // to aim at.
  if (taskButton())
    taskButton().getBoundingClientRect = () => ({
      left: 104,
      top: 742,
      width: 160,
      height: 26,
      right: 264,
      bottom: 768,
    });
  const ghost = () => s.document.querySelector(".window-ghost");
  return { s, win, taskButton, ghost };
}

test("minimizing slides the caption to the task button and hides the window", async () => {
  const { s, win, taskButton, ghost } = await documents();

  win.querySelector(".minimize-btn").click();

  // XP draws the caption the way DrawCaption does: Luna's 25px caption bar
  // with the window's icon and title, and no buttons or theme art.
  const bar = ghost();
  expect(bar.textContent).toBe("My Documents");
  expect(bar.querySelector(".title-buttons")).toBeNull();
  expect(bar.querySelector(".window-ghost-icon")).not.toBeNull();
  expect(bar.classList.contains("active")).toBeTrue();
  expect(bar.style.height).toBe("25px");
  expect(parseFloat(bar.style.width)).toBe(CAPTION_WIDTH);
  // The caption is drawn once at the window's width; the gradient starts at
  // the title.
  const caption = bar.querySelector(".window-ghost-caption");
  expect(caption.style.width).toBe(`${CAPTION_WIDTH}px`);
  expect(caption.style.backgroundPosition).toBe("26px 0px");
  expect(caption.style.backgroundSize).toBe(`${CAPTION_WIDTH - 26}px 100%`);
  expect(parseFloat(bar.style.top)).toBe(84);
  // The window stays where it is until its caption has arrived.
  expect(win.style.display).toBe("");

  await s.advanceTime(16);
  const first = parseFloat(bar.style.top);
  await s.advanceTime(64);
  const second = parseFloat(bar.style.top);
  expect(second).toBeGreaterThan(first);
  expect(win.style.display).toBe("");

  await s.advanceTime(WHOLE_ANIMATION);
  // The caption ends on the task button, not on the window.
  expect(ghost()).toBeNull();
  expect(win.style.display).toBe("none");
  expect(taskButton().getAttribute("aria-label")).toContain("minimized");
});

test("restoring brings the caption back from the task button", async () => {
  const { s, win, taskButton, ghost } = await documents();
  win.querySelector(".minimize-btn").click();
  await s.advanceTime(WHOLE_ANIMATION);
  // Like Chrome, a hidden window cannot take the focus.
  const items = win.querySelector(".explorer-items");
  for (const element of [items, win]) {
    const focus = element.focus;
    element.focus = (options) => {
      if (win.style.display !== "none") focus.call(element, options);
    };
  }

  taskButton().focus();
  taskButton().click();
  const bar = ghost();
  expect(bar.textContent).toContain("My Documents");
  // The caption starts on the task button, not on the window.
  expect(parseFloat(bar.style.top)).toBe(742);
  expect(parseFloat(bar.style.left)).toBe(108);
  expect(parseFloat(bar.style.width)).toBe(152);
  // It is drawn at the window's wider caption, active, and cropped to the
  // button.
  expect(bar.classList.contains("active")).toBeTrue();
  expect(bar.querySelector(".window-ghost-caption").style.width).toBe(
    `${CAPTION_WIDTH}px`,
  );
  expect(win.style.display).toBe("none");

  await s.advanceTime(WHOLE_ANIMATION);
  expect(ghost()).toBeNull();
  expect(win.style.display).toBe("flex");
  expect(parseFloat(win.style.left)).toBe(100);
  // The window gets the keys when it shows.
  expect(s.document.activeElement === items).toBeTrue();
});

test("maximizing and restoring step the caption to and from the work area", async () => {
  const { s, win, ghost } = await documents();

  win.querySelector(".maximize-btn").click();
  expect(parseFloat(ghost().style.width)).toBe(CAPTION_WIDTH);
  expect(win.classList.contains("maximized")).toBeFalse();
  await s.advanceTime(WHOLE_ANIMATION);
  expect(ghost()).toBeNull();
  expect(win.classList.contains("maximized")).toBeTrue();

  win.querySelector(".maximize-btn").click();
  expect(parseFloat(ghost().style.width)).toBeGreaterThan(CAPTION_WIDTH);
  expect(win.classList.contains("maximized")).toBeTrue();
  await s.advanceTime(WHOLE_ANIMATION);
  expect(ghost()).toBeNull();
  expect(win.classList.contains("maximized")).toBeFalse();
  expect([win.style.left, win.style.top, win.style.width]).toEqual([
    "100px",
    "80px",
    "500px",
  ]);
});

test("a caption animation that is interrupted finishes at once", async () => {
  const { s, win, taskButton, ghost } = await documents();

  win.querySelector(".minimize-btn").click();
  await s.advanceTime(32);
  taskButton().click();

  // Only the restore runs now, and it leaves the window alone until its own
  // caption has arrived.
  expect(s.document.querySelectorAll(".window-ghost")).toHaveLength(1);
  expect(win.style.display).toBe("");
  await s.advanceTime(WHOLE_ANIMATION);
  expect(ghost()).toBeNull();
  expect(win.style.display).toBe("flex");
});

test("minimizing again while a restore is still running wins", async () => {
  const { s, win, taskButton, ghost } = await documents();
  win.querySelector(".minimize-btn").click();
  await s.advanceTime(WHOLE_ANIMATION);

  taskButton().click();
  await s.advanceTime(32);
  win.querySelector(".minimize-btn").click();

  // The restore gave up, so the window never appears.
  await s.advanceTime(WHOLE_ANIMATION);
  expect(ghost()).toBeNull();
  expect(win.style.display).toBe("none");
  expect(taskButton().getAttribute("aria-label")).toContain("minimized");
});

test("a window without a task button still gets a caption to slide", async () => {
  const { s, win, ghost } = await documents();
  // A crowded taskbar folds windows into one overflow button, which has no
  // rectangle for the caption to aim at.
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    {
      value: 0,
      configurable: true,
    },
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();

  win.querySelector(".minimize-btn").click();
  const bar = ghost();
  expect(parseFloat(bar.style.left)).toBe(104);
  expect(parseFloat(bar.style.width)).toBe(CAPTION_WIDTH);

  await s.advanceTime(240);
  // The caption narrows to the width of the button it cannot find.
  expect(parseFloat(bar.style.width)).toBeLessThan(CAPTION_WIDTH);
  expect(parseFloat(bar.style.width)).toBeGreaterThan(80);
  expect(parseFloat(bar.style.top)).toBeGreaterThan(84);

  await s.advanceTime(WHOLE_ANIMATION);
  expect(ghost()).toBeNull();
  expect(win.style.display).toBe("none");
});

test("a window's own commands animate too", async () => {
  const { s, win, ghost } = await documents();
  win
    .querySelector(".title-bar")
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  expect(ghost()).not.toBeNull();
  await s.advanceTime(WHOLE_ANIMATION);
  expect(ghost()).toBeNull();
  expect(win.classList.contains("maximized")).toBeTrue();
});

test("a reduced-motion preference changes windows at once", async () => {
  const { win, taskButton, ghost } = await documents({
    windowAnimations: false,
  });

  win.querySelector(".minimize-btn").click();
  expect(ghost()).toBeNull();
  expect(win.style.display).toBe("none");

  taskButton().click();
  expect(ghost()).toBeNull();
  expect(win.style.display).toBe("flex");

  win.querySelector(".maximize-btn").click();
  expect(ghost()).toBeNull();
  expect(win.classList.contains("maximized")).toBeTrue();
});

test("closing a window clears its pending caption animation", async () => {
  for (const command of ["minimize", "maximize", "restore"]) {
    const { s, win, taskButton, ghost } = await documents();
    if (command === "restore") {
      win.querySelector(".minimize-btn").click();
      await s.advanceTime(WHOLE_ANIMATION);
      taskButton().click();
    } else win.querySelector(`.${command}-btn`).click();
    expect(ghost()).not.toBeNull();
    win.querySelector(".close-btn").click();
    expect(win.isConnected).toBeFalse();
    expect(ghost()).toBeNull();
    await s.advanceTime(WHOLE_ANIMATION);
    expect(taskButton()).toBeNull();
  }
});

test("Classic draws its 18px caption with Tahoma's offsets", async () => {
  const { s, win, ghost } = await documents();
  s.document.documentElement.dataset.xpAppearance = "classic";
  win.querySelector(".minimize-btn").click();
  const bar = ghost();
  expect(bar.style.height).toBe("18px");
  expect(bar.querySelector(".window-ghost-icon").style.left).toBe("2px");
  expect(bar.querySelector(".window-ghost-text").style.left).toBe("20px");
  await s.advanceTime(WHOLE_ANIMATION);
});

test("an inactive window's caption keeps its inactive colors", async () => {
  const { s, win, ghost } = await documents();
  win.classList.remove("active");
  win.querySelector(".minimize-btn").click();
  expect(ghost().classList.contains("active")).toBeFalse();
  await s.advanceTime(WHOLE_ANIMATION);
});

test("a window without caption art or text still minimizes and restores", async () => {
  const { s, win, taskButton, ghost } = await documents();
  win.querySelector(".title-icon").remove();
  win.querySelector(".title-text").textContent = "";
  win.querySelector(".minimize-btn").click();
  expect(ghost().querySelector(".window-ghost-icon")).toBeNull();
  expect(ghost().querySelector(".window-ghost-text").textContent).toBe("");
  expect(ghost().style.height).toBe("25px");
  await s.advanceTime(WHOLE_ANIMATION);
  expect(ghost()).toBeNull();
  expect(win.style.display).toBe("none");

  win.querySelector(".title-text").remove();
  taskButton().click();
  expect(ghost().querySelector(".window-ghost-icon")).toBeNull();
  expect(ghost().querySelector(".window-ghost-text").textContent).toBe("");
  await s.advanceTime(WHOLE_ANIMATION);
  expect(ghost()).toBeNull();
  expect(win.style.display).toBe("flex");
});
