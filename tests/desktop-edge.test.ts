// @ts-nocheck -- Desktop icons, renaming, and context menus through the real shell.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

const settle = async () => {
  for (let i = 0; i < 4; i++) await flushShell();
};
const icon = (s, id) =>
  s.document.querySelector(`.desktop-icon[data-desktop-id="${id}"]`);
const press = (s, target, key, options = {}) =>
  target.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
const contextMenu = (s, target) => {
  target.dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    }),
  );
  return s.document.getElementById("desktop-context-menu");
};
const choose = async (s, action) => {
  s.document
    .querySelector(`#desktop-context-menu [data-action="${action}"]`)
    .click();
  await settle();
};

test("legacy icon positions move from game ids to their desktop files", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        desktopIconPositions: JSON.stringify({
          "bike-mania": { left: 300, top: 200 },
        }),
      },
    }),
  );
  const fs = s.window.VirtualFS;
  const [file] = fs.findByApp("bike-mania");
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  const positions = JSON.parse(
    s.window.localStorage.getItem("desktopIconPositions"),
  );
  expect(positions["bike-mania"]).toBeUndefined();
  expect(positions[file.id]).toEqual({ left: 300, top: 200 });
});

test("desktop icons sort by type and date and select ranges from the keyboard and mouse", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const a = fs.createFile(fs.DESKTOP, "a.txt");
  const b = fs.createFile(fs.DESKTOP, "b.txt");
  const folder = fs.createFolder(fs.DESKTOP, "Folder");
  await settle();
  for (const sort of ["sort-type", "sort-modified"]) {
    contextMenu(s, s.document.getElementById("desktop-icons"));
    s.document
      .querySelector('#desktop-context-menu [data-action="arrange-by"]')
      ?.click();
    await choose(s, sort);
  }
  icon(s, a.id).click();
  icon(s, folder.id).dispatchEvent(
    new s.window.MouseEvent("click", { bubbles: true, shiftKey: true }),
  );
  expect(icon(s, b.id).classList.contains("selected")).toBeTrue();
  icon(s, b.id).dataset.pointerSelected = "true";
  icon(s, b.id).dispatchEvent(
    new s.window.MouseEvent("click", { bubbles: true, ctrlKey: true }),
  );
  expect(icon(s, b.id).classList.contains("selected")).toBeFalse();
  press(s, icon(s, a.id), "Enter");
  await settle();
  expect(!!s.document.querySelector(".notepad-window")).toBeTrue();
});

test("renaming desktop files and system icons commits, cancels, and reports errors", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "rename.txt");
  await settle();
  const rename = async (value, finish) => {
    icon(s, file.id).click();
    contextMenu(s, icon(s, file.id));
    await choose(s, "rename");
    const input = s.document.querySelector(".desktop-rename");
    input.value = value;
    press(s, input, "a");
    await finish(input);
    await settle();
  };
  await rename("pointer.txt", async () => {
    s.document.body.dispatchEvent(
      new s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(fs.getNode(file.id).name).toBe("pointer.txt");
  await rename("blurred.txt", async (input) => {
    input.dispatchEvent(
      new s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
    input.dispatchEvent(new s.window.FocusEvent("blur"));
  });
  expect(fs.getNode(file.id).name).toBe("blurred.txt");
  // Like Explorer, a refused name shows an error and keeps the old name.
  await rename("bad?name.txt", async (input) => press(s, input, "Enter"));
  await flushShell();
  const error = [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  expect(error.textContent).toContain("Error Renaming File or Folder");
  expect(error.textContent).toContain("invalid characters");
  expect(fs.getNode(file.id).name).toBe("blurred.txt");
  error.querySelector('[data-action="ok"]').click();
  await flushShell();

  const system = async (value, finish) => {
    contextMenu(s, icon(s, "__my-computer"));
    await choose(s, "rename-my-computer");
    const input = s.document.querySelector(".desktop-rename");
    input.value = value;
    press(s, input, "a");
    finish(input);
    await settle();
  };
  await system("   ", (input) => press(s, input, "Enter"));
  expect(icon(s, "__my-computer").textContent).toContain("My Computer");
  await system("Workstation", (input) =>
    input.dispatchEvent(new s.window.FocusEvent("blur")),
  );
  expect(icon(s, "__my-computer").textContent).toContain("Workstation");
});

test("desktop menus flip submenus at the screen edge and navigate from the keyboard", async () => {
  const s = await login(await loadShell());
  Object.defineProperty(s.window, "innerWidth", {
    configurable: true,
    value: -1,
  });
  s.document.getElementById("desktop").getBoundingClientRect = () => ({
    bottom: -1,
  });
  const menu = contextMenu(s, s.document.getElementById("desktop-icons"));
  const parent = menu.querySelector(".context-parent button");
  parent.click();
  const submenu = parent.parentElement.querySelector(".context-submenu");
  expect(submenu.style.top).toBe("-3px");
  menu.dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  const first = menu.querySelector("button:not(:disabled)");
  first.focus();
  for (const key of ["End", "Home", "ArrowUp", "ArrowDown", "x"])
    press(s, s.document.activeElement, key);
  press(s, s.document.activeElement, "Escape");
  expect(menu.hidden).toBeTrue();
  expect(s.document.activeElement.id).toBe("desktop-icons");
});

test("desktop menu commands open items, display properties, and report failures", async () => {
  const s = await login(await loadShell());
  contextMenu(s, icon(s, "__my-computer"));
  await choose(s, "open");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__my-computer"]'),
  ).toBeTrue();
  contextMenu(s, s.document.getElementById("desktop-icons"));
  await choose(s, "properties");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__display-properties"]'),
  ).toBeTrue();
  const createFolder = s.window.FileOperations.createFolder;
  s.window.FileOperations.createFolder = async () => {
    throw new Error("");
  };
  try {
    contextMenu(s, s.document.getElementById("desktop-icons"));
    await choose(s, "new-folder");
  } finally {
    s.window.FileOperations.createFolder = createFolder;
  }
  expect(
    [...s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
  ).toContain("The file operation failed.");
});

test("uploading desktop files reports invalid names", async () => {
  const s = await login(await loadShell());
  let picker;
  const createElement = s.document.createElement.bind(s.document);
  s.document.createElement = (tag, ...args) => {
    const element = createElement(tag, ...args);
    if (tag === "input") {
      picker = element;
      element.click = () => {};
    }
    return element;
  };
  contextMenu(s, s.document.getElementById("desktop-icons"));
  await choose(s, "upload");
  s.document.createElement = createElement;
  Object.defineProperty(picker, "files", {
    value: [new s.window.File(["x"], "bad?name.txt", { type: "text/plain" })],
  });
  picker.dispatchEvent(new s.window.Event("change"));
  await settle();
  expect(
    [...s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
  ).toContain("invalid characters");
});

test("legacy icon positions yield to a position the desktop file already has", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const [file] = fs.findByApp("bike-mania");
  s.window.localStorage.setItem(
    "desktopIconPositions",
    JSON.stringify({
      "bike-mania": { left: 300, top: 200 },
      [file.id]: { left: 75, top: 150 },
    }),
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  const positions = JSON.parse(
    s.window.localStorage.getItem("desktopIconPositions"),
  );
  expect(positions["bike-mania"]).toBeUndefined();
  expect(positions[file.id]).toEqual({ left: 75, top: 150 });
});

test("desktop renames finish once even when focus leaves after committing", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "once.txt");
  await settle();
  const renames = [];
  const rename = s.window.FileOperations.rename;
  s.window.FileOperations.rename = async (...args) => {
    renames.push(args[1]);
    return rename(...args);
  };
  try {
    icon(s, file.id).click();
    contextMenu(s, icon(s, file.id));
    await choose(s, "rename");
    const input = s.document.querySelector(".desktop-rename");
    input.value = "done.txt";
    press(s, input, "Enter");
    input.dispatchEvent(new s.window.FocusEvent("blur"));
    await settle();
  } finally {
    s.window.FileOperations.rename = rename;
  }
  expect(renames).toEqual(["done.txt"]);

  contextMenu(s, icon(s, "__my-computer"));
  await choose(s, "rename-my-computer");
  const input = s.document.querySelector(".desktop-rename");
  input.value = "First";
  press(s, input, "Enter");
  input.value = "Second";
  input.dispatchEvent(new s.window.FocusEvent("blur"));
  await settle();
  expect(icon(s, "__my-computer").textContent).toContain("First");
});

test("Explore on the Recycle Bin menu opens the Recycle Bin", async () => {
  const s = await login(await loadShell());
  contextMenu(s, icon(s, "__recycle-bin"));
  await choose(s, "explore");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__recycle-bin"]'),
  ).toBeTrue();
});
