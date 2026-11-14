// @ts-nocheck -- Taskbar layout and settings through the real shell.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

const settings = (s) =>
  JSON.parse(s.window.localStorage.getItem("taskbarSettings"));
const press = (s, target, key, options = {}) =>
  target.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
const pointer = (s, target, type, x = 0, y = 0, options = {}) =>
  target.dispatchEvent(
    new s.window.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      clientX: x,
      clientY: y,
      ...options,
    }),
  );
const openTaskbarMenu = (s) =>
  s.document.getElementById("taskbar").dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 700,
    }),
  );
const shell = async (taskbarSettings) => {
  const s = await login(
    await loadShell({
      initialStorage: {
        taskbarSettings: JSON.stringify(taskbarSettings),
      },
    }),
  );
  s.document.getElementById("taskbar").setPointerCapture = () => {};
  return s;
};

test("malformed taskbar settings fall back to safe values", async () => {
  const s = await shell({
    edge: "diagonal",
    rows: "many",
    width: "wide",
    quickLaunchItems: "none",
    folders: "none",
    toolbarOrder: "none",
    toolbarLayouts: [],
    locked: true,
  });
  openTaskbarMenu(s);
  s.document.querySelector('[data-taskbar-action="lock"]').click();
  expect(settings(s)).toMatchObject({
    edge: "bottom",
    rows: 1,
    width: 106,
    quickLaunchItems: ["__show-desktop"],
    folders: [],
    toolbarOrder: [],
    toolbarLayouts: {},
    locked: false,
  });
});

test("an auto-hidden taskbar waits for open menus before hiding", async () => {
  const s = await shell({ autoHide: true, locked: false });
  const bar = s.document.getElementById("taskbar");
  pointer(s, bar, "pointerleave");
  await s.advanceTime(600);
  expect(bar.classList.contains("auto-hidden")).toBeTrue();
  pointer(s, bar, "pointerenter");
  expect(bar.classList.contains("auto-hidden")).toBeFalse();
  s.document.getElementById("start-button").click();
  pointer(s, bar, "pointerleave");
  await s.advanceTime(600);
  expect(bar.classList.contains("auto-hidden")).toBeFalse();
  s.document.getElementById("start-button").click();
  s.document.activeElement.blur();
  await s.advanceTime(600);
  expect(bar.classList.contains("auto-hidden")).toBeTrue();
  expect(bar.style.zIndex).toBe("8000");
});

test("hidden tray icons expand and collapse after inactivity", async () => {
  const s = await shell({
    hideInactive: true,
    volumeBehavior: "hide",
    locked: false,
  });
  const expand = s.document.getElementById("tray-expand");
  const volume = s.document.getElementById("tray-volume-button");
  expect(volume.hidden).toBeTrue();
  expand.click();
  expect(volume.hidden).toBeFalse();
  s.document.getElementById("tray-volume-popup").hidden = false;
  await s.advanceTime(2100);
  expect(volume.hidden).toBeFalse();
  s.document.getElementById("tray-volume-popup").hidden = true;
  pointer(s, s.document.getElementById("taskbar-tray"), "pointerenter");
  pointer(s, s.document.getElementById("taskbar-tray"), "pointerleave");
  pointer(s, volume, "pointerdown");
  // In Chrome the press gives the volume icon the keys, with no focus ring.
  // When it hides, the arrow next to it takes them, so they never go to the
  // page.
  volume.focus();
  const matches = s.window.Element.prototype.matches;
  s.window.Element.prototype.matches = function (selector) {
    return selector !== ":focus-visible" && matches.call(this, selector);
  };
  await s.advanceTime(2100);
  s.window.Element.prototype.matches = matches;
  expect(volume.hidden).toBeTrue();
  expect(s.document.activeElement === expand).toBeTrue();
});

test("large docked toolbars and edges change the taskbar layout", async () => {
  for (const [edge, extra] of [
    [
      "right",
      {
        desktopToolbar: true,
        toolbarLayouts: { desktop: { largeIcons: true } },
      },
    ],
    [
      "top",
      {
        folders: ["my-documents"],
        toolbarLayouts: { "my-documents": { largeIcons: true } },
        onTop: false,
      },
    ],
  ]) {
    const s = await shell({ edge, locked: false, ...extra });
    const bar = s.document.getElementById("taskbar");
    expect(bar.style.left).toBeDefined();
    expect(bar.classList.contains("vertical")).toBe(edge === "right");
    pointer(s, s.document.getElementById("desktop"), "pointerdown");
    if (edge === "top") expect(bar.style.zIndex).toBe("90");
  }
});

test("the taskbar docks to the nearest edge and resizes from its handle", async () => {
  const s = await shell({ locked: false });
  const bar = s.document.getElementById("taskbar");
  pointer(s, bar, "pointerdown", 500, 760, { button: 2 });
  pointer(s, bar, "pointermove", 5, 400);
  expect(settings(s).edge).toBeUndefined();
  pointer(s, bar, "pointerdown", 500, 760);
  pointer(s, bar, "pointermove", 5, 400, { pointerId: 2 });
  pointer(s, bar, "pointermove", 5, 400);
  pointer(s, bar, "pointerup", 5, 400);
  expect(settings(s).edge).toBe("left");
  const handle = s.document.getElementById("taskbar-resize");
  pointer(s, handle, "pointerdown", 100, 400);
  pointer(s, handle, "pointermove", 200, 400);
  pointer(s, handle, "pointercancel", 200, 400);
  expect(settings(s).width).toBe(200);
  pointer(s, bar, "pointerdown", 500, 400);
  pointer(s, bar, "pointermove", 500, 5);
  pointer(s, bar, "lostpointercapture", 500, 5);
  expect(settings(s).edge).toBe("top");
  pointer(s, handle, "pointerdown", 500, 30);
  pointer(s, handle, "pointermove", 500, 80);
  pointer(s, handle, "pointerup", 500, 80);
  expect(settings(s).rows).toBeGreaterThan(1);
  pointer(s, bar, "pointerdown", 500, 60);
  pointer(s, bar, "pointermove", 1015, 400);
  pointer(s, bar, "pointerup", 1015, 400);
  expect(settings(s).edge).toBe("right");
  pointer(s, handle, "pointerdown", 900, 400);
  pointer(s, handle, "pointermove", 800, 400);
  pointer(s, handle, "pointerup", 800, 400);
  expect(settings(s).width).toBeGreaterThan(99);
});

test("the New Toolbar dialog browses folders and adds the chosen one", async () => {
  const s = await shell({ locked: false });
  const fs = s.window.VirtualFS;
  const parent = fs.createFolder(fs.MY_DOCUMENTS, "Parent");
  fs.createFolder(parent.id, "Child");
  const open = () => {
    openTaskbarMenu(s);
    s.document.querySelector('[data-taskbar-toolbar="new"]').click();
    return [...s.document.querySelectorAll(".taskbar-new-toolbar-dialog")].at(
      -1,
    );
  };
  let dialog = open();
  const row = (id) => dialog.querySelector(`[data-folder="${id}"]`);
  const tree = () => dialog.querySelector(".toolbar-folder-tree");
  press(s, row(fs.MY_DOCUMENTS), "ArrowRight");
  expect(row(fs.MY_DOCUMENTS).getAttribute("aria-expanded")).toBe("true");
  press(s, row(fs.MY_DOCUMENTS), "ArrowLeft");
  expect(row(fs.MY_DOCUMENTS).getAttribute("aria-expanded")).toBe("false");
  row(fs.MY_DOCUMENTS).dispatchEvent(new s.window.MouseEvent("dblclick"));
  row(parent.id).querySelector(".toolbar-tree-toggle").click();
  row(parent.id).click();
  for (const key of ["End", "Home", "ArrowDown", "ArrowUp", "a"])
    press(
      s,
      s.document.activeElement.closest("[data-folder]") || row(fs.DESKTOP),
      key,
    );
  row(fs.DESKTOP).focus();
  press(s, row(fs.DESKTOP), "End");
  press(s, s.document.activeElement, "ArrowUp");
  press(s, tree(), "Home");
  dialog.querySelector('[data-action="new-folder"]').click();
  await flushShell();
  expect(dialog.querySelector("input").value).toBe("New Folder");
  // Like XP, a missing folder and any "." or ".." in the path fail,
  // also in a full path to a folder that is there.
  for (const typed of [
    "C:\\missing",
    "..",
    `${fs.getPath(parent.id)}\\..\\${parent.name}`,
    `${fs.getPath(parent.id)}\\.`,
  ]) {
    dialog.querySelector("input").value = typed;
    dialog.querySelector('[data-action="ok"]').click();
    await flushShell();
    const error = [...s.document.querySelectorAll(".xp-dialog")].at(-1);
    expect(error.querySelector(".title-text").textContent).toBe("Toolbar");
    expect(error.textContent).toContain(
      `Cannot find '${typed}'. Make sure the path or Internet address is correct.`,
    );
    error.querySelector('[data-action="ok"]').click();
    await flushShell();
  }
  dialog.querySelector("input").value = fs.getPath(parent.id);
  dialog.querySelector('[data-action="ok"]').click();
  expect(settings(s).folders).toContain(parent.id);
  dialog = open();
  dialog.querySelector('[data-action="cancel"]').click();
  expect(dialog.isConnected).toBeFalse();
  dialog = open();
  const createFolder = s.window.FileOperations.createFolder;
  s.window.FileOperations.createFolder = async () => {
    throw new Error("disk is read-only");
  };
  try {
    dialog.querySelector('[data-action="new-folder"]').click();
    await flushShell();
    expect(
      [...s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
    ).toContain("disk is read-only");
  } finally {
    s.window.FileOperations.createFolder = createFolder;
  }
});

test("floating toolbars lose their active state when clicking elsewhere", async () => {
  const s = await shell({
    locked: false,
    quickLaunch: true,
    toolbarLayouts: { "__quick-launch": { floating: true } },
  });
  const toolbar = s.document.querySelector(".quick-launch-toolbar");
  pointer(s, toolbar, "pointerdown");
  expect(toolbar.classList.contains("active")).toBeTrue();
  pointer(s, toolbar, "pointerdown");
  expect(toolbar.classList.contains("active")).toBeTrue();
  pointer(s, s.document.getElementById("desktop"), "pointerdown");
  expect(toolbar.classList.contains("active")).toBeFalse();
});

test("taskbar settings drop duplicate and invalid toolbar order entries", async () => {
  const s = await shell({ toolbarOrder: ["a", 5, "a", "b"], locked: true });
  openTaskbarMenu(s);
  s.document.querySelector('[data-taskbar-action="lock"]').click();
  expect(settings(s).toolbarOrder).toEqual(["a", "b"]);
});

test("locked horizontal taskbars with large toolbar icons grow without a resize grip", async () => {
  for (const [extra, height] of [
    [{ quickLaunch: true }, "40px"],
    [{ quickLaunch: false }, "30px"],
  ]) {
    const s = await shell({
      locked: true,
      ...extra,
      toolbarLayouts: { "__quick-launch": { largeIcons: true } },
    });
    expect(s.document.getElementById("taskbar").style.height).toBe(height);
  }
});

test("expanded tray icons stay while a tray control has keyboard focus", async () => {
  const s = await shell({
    hideInactive: true,
    volumeBehavior: "hide",
    locked: false,
  });
  const expand = s.document.getElementById("tray-expand");
  const volume = s.document.getElementById("tray-volume-button");
  expand.click();
  const matches = s.window.Element.prototype.matches;
  s.window.Element.prototype.matches = function (selector) {
    return selector === ":focus-visible"
      ? this === expand
      : matches.call(this, selector);
  };
  try {
    expand.focus();
    await s.advanceTime(2100);
    expect(volume.hidden).toBeFalse();
    expand.blur();
    await s.advanceTime(2100);
    expect(volume.hidden).toBeTrue();
  } finally {
    s.window.Element.prototype.matches = matches;
  }
});

test("taskbar drags save only real changes and ignore releases away from an edge", async () => {
  const s = await shell({ locked: false, edge: "top" });
  const bar = s.document.getElementById("taskbar");
  const handle = s.document.getElementById("taskbar-resize");
  const writes = [];
  const storage = s.window.localStorage;
  Object.defineProperty(s.window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.getItem(key),
      removeItem: (key) => storage.removeItem(key),
      setItem(key, value) {
        if (key === "taskbarSettings") writes.push(JSON.parse(value));
        storage.setItem(key, value);
      },
    },
  });
  pointer(s, bar, "pointerdown", 500, 10);
  pointer(s, bar, "pointerup", 500, 10);
  expect(writes).toEqual([]);
  pointer(s, bar, "pointerdown", 500, 10);
  pointer(s, bar, "pointermove", 500, 380);
  pointer(s, bar, "pointerup", 500, 380);
  expect(writes).toEqual([]);
  pointer(s, handle, "pointerdown", 500, 30);
  pointer(s, handle, "pointermove", 500, 40);
  pointer(s, handle, "pointerup", 500, 40);
  expect(writes).toEqual([]);
  pointer(s, handle, "pointerdown", 500, 30);
  pointer(s, handle, "pointermove", 500, 90);
  pointer(s, handle, "pointerup", 500, 90);
  expect(writes.at(-1)).toMatchObject({ edge: "top", rows: 3 });
});

test("the New Toolbar dialog adds the folder chosen in its tree", async () => {
  const s = await shell({ locked: false });
  openTaskbarMenu(s);
  s.document.querySelector('[data-taskbar-toolbar="new"]').click();
  const dialog = s.document.querySelector(".taskbar-new-toolbar-dialog");
  const fs = s.window.VirtualFS;
  dialog.querySelector(`[data-folder="${fs.MY_DOCUMENTS}"]`).click();
  expect(dialog.querySelector("input").value).toBe("My Documents");
  dialog.querySelector('[data-action="ok"]').click();
  expect(settings(s).folders).toEqual([fs.MY_DOCUMENTS]);
});

test("a bottom taskbar grows rows when its handle is dragged up", async () => {
  const s = await shell({ locked: false });
  const handle = s.document.getElementById("taskbar-resize");
  pointer(s, handle, "pointerdown", 500, 740);
  pointer(s, handle, "pointermove", 500, 690);
  pointer(s, handle, "pointerup", 500, 690);
  expect(settings(s)).toMatchObject({ edge: "bottom", rows: 3 });
});
