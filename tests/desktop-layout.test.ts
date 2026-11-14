// @ts-nocheck -- Happy DOM supplies the shell geometry and pointer events.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
afterEach(cleanupShells);
const frame = (s) =>
  new Promise((resolve) => s.window.requestAnimationFrame(resolve));
const key = (s, el, value) =>
  el.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    }),
  );
function menu(s, id = null) {
  const el = id
    ? s.document.querySelector(`[data-desktop-id="${id}"]`)
    : s.document.getElementById("desktop-icons");
  el.dispatchEvent(
    new s.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  return s.document.getElementById("desktop-context-menu");
}
async function action(s, name, id = null) {
  menu(s, id).querySelector(`[data-action="${name}"]`).click();
  await flushShell();
  await frame(s);
}
function geometry(s, width = 1024, height = 738) {
  const surface = s.document.getElementById("desktop-icons");
  Object.defineProperties(surface, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  for (const icon of surface.querySelectorAll(".desktop-icon")) {
    for (const [prop, style] of [
      ["offsetLeft", "left"],
      ["offsetTop", "top"],
    ])
      Object.defineProperty(icon, prop, {
        configurable: true,
        get: () => parseFloat(icon.style[style]) || 0,
      });
    Object.defineProperties(icon, {
      offsetWidth: { configurable: true, value: width <= 480 ? 60 : 75 },
      offsetHeight: { configurable: true, value: width <= 480 ? 58 : 75 },
    });
  }
}
async function drag(
  s,
  icon,
  target = null,
  { x = 190, y = 140, cancel = false } = {},
) {
  geometry(s);
  s.document.elementsFromPoint = () =>
    target ? [s.document.body, target] : [];
  for (const [type, clientX, clientY] of [
    ["pointerdown", 10, 10],
    ["pointermove", x, y],
    [cancel ? "pointercancel" : "pointerup", x, y],
  ])
    icon.dispatchEvent(
      new s.window.PointerEvent(type, {
        button: 0,
        pointerId: 1,
        clientX,
        clientY,
        bubbles: true,
      }),
    );
  await flushShell();
  await flushShell();
}
test.each([true, false])(
  "desktop dragging saves positions with align-to-grid %s",
  async (alignToGrid) => {
    const s = await login(
      await loadShell({
        initialStorage: {
          desktopLayoutSettings: JSON.stringify({
            alignToGrid,
            autoArrange: false,
          }),
        },
      }),
    );
    geometry(s);
    await action(s, "refresh");
    const icon = s.document.querySelector('[data-desktop-id="__my-computer"]');
    await drag(s, icon);
    const position = JSON.parse(
      s.window.localStorage.getItem("desktopIconPositions"),
    )["__my-computer"];
    expect(position).toEqual(
      alignToGrid ? { left: 150, top: 150 } : { left: 180, top: 130 },
    );
    await action(s, "refresh");
    const restored = s.document.querySelector(
      '[data-desktop-id="__my-computer"]',
    );
    expect([restored.style.left, restored.style.top]).toEqual([
      `${position.left}px`,
      `${position.top}px`,
    ]);
  },
);
test("auto-arrange restores the grid after dragging and desktop visibility can be toggled", async () => {
  const s = await login(await loadShell());
  geometry(s);
  await action(s, "auto-arrange");
  const icon = s.document.querySelector('[data-desktop-id="__my-computer"]');
  const original = [icon.style.left, icon.style.top];
  await drag(s, icon);
  expect([icon.style.left, icon.style.top]).toEqual(original);
  expect(s.window.localStorage.getItem("desktopIconPositions")).toBeNull();
  for (const name of ["auto-arrange", "align-grid", "align-grid"])
    await action(s, name);
  expect(
    JSON.parse(s.window.localStorage.getItem("desktopLayoutSettings")),
  ).toMatchObject({ autoArrange: false, alignToGrid: true });
  await action(s, "show-icons");
  expect(s.document.getElementById("desktop-icons").hidden).toBeTrue();
  await action(s, "show-icons");
  expect(s.document.getElementById("desktop-icons").hidden).toBeFalse();
});
test("dropping desktop files on folders moves them and dropping on Recycle Bin recycles them", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.DESKTOP, "Drop Folder");
  const move = fs.createFile(fs.DESKTOP, "move.txt", { content: "keep me" });
  const recycle = fs.createFile(fs.DESKTOP, "recycle.txt", {
    content: "recover me",
  });
  await flushShell();
  const icon = (id) => s.document.querySelector(`[data-desktop-id="${id}"]`);
  // A drag never touches the clipboard, like XP.
  const ops = s.window.FileOperations;
  ops.copy([recycle.id]);
  await drag(s, icon(move.id), icon(folder.id));
  expect(fs.getNode(move.id).parent).toBe(folder.id);
  expect(fs.getNode(move.id).content).toBe("keep me");
  expect(ops.getClipboard()).toEqual({ mode: "copy", ids: [recycle.id] });
  // Like XP, one file asks with Yes and No. No leaves the file, its icon
  // and the clipboard.
  const clash = fs.createFile(fs.DESKTOP, "move.txt");
  await flushShell();
  const start = [icon(clash.id).style.left, icon(clash.id).style.top];
  await drag(s, icon(clash.id), icon(folder.id));
  // The icon hides while the question is open.
  expect(icon(clash.id).style.visibility).toBe("hidden");
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector('[data-action="no"]')
    .click();
  await flushShell();
  await flushShell();
  expect(fs.getNode(clash.id).parent).toBe(fs.DESKTOP);
  expect([icon(clash.id).style.left, icon(clash.id).style.top]).toEqual(start);
  expect(icon(clash.id).style.visibility).toBe("");
  expect(ops.getClipboard()).toEqual({ mode: "copy", ids: [recycle.id] });
  // Icons still waiting to move stay hidden when the Desktop redraws after
  // the first moved item.
  const first = fs.createFile(fs.DESKTOP, "first.txt");
  const second = fs.createFile(fs.DESKTOP, "second.txt");
  const third = fs.createFile(fs.DESKTOP, "third.txt");
  await flushShell();
  s.document
    .querySelectorAll(".desktop-icon")
    .forEach((item) =>
      item.classList.toggle(
        "selected",
        [first.id, second.id].includes(item.dataset.desktopId),
      ),
    );
  const pasteWithConflicts = ops.pasteWithConflicts;
  let waiting = null;
  let afterOtherDrop = null;
  let otherIds = null;
  let finish;
  const finished = new Promise((resolve) => (finish = resolve));
  ops.pasteWithConflicts = async (destinationId, resolver, { items }) => {
    if (items.ids.includes(third.id)) {
      otherIds = items.ids;
      await fs.move(third.id, destinationId);
      return { cancelled: false, results: [] };
    }
    await fs.move(first.id, destinationId);
    await flushShell();
    waiting = icon(second.id).style.visibility;
    // Another drop that ends first leaves this drop's icons hidden, and
    // never takes them, even while they still look selected.
    icon(second.id).classList.add("selected");
    icon(third.id).classList.add("selected");
    await drag(s, icon(third.id), icon(folder.id));
    afterOtherDrop = icon(second.id).style.visibility;
    await fs.move(second.id, destinationId);
    finish();
    return { cancelled: false, results: [] };
  };
  try {
    await drag(s, icon(first.id), icon(folder.id));
    await finished;
    await flushShell();
  } finally {
    ops.pasteWithConflicts = pasteWithConflicts;
  }
  expect(waiting).toBe("hidden");
  expect(afterOtherDrop).toBe("hidden");
  expect(otherIds).toEqual([third.id]);
  expect(fs.getNode(third.id).parent).toBe(folder.id);
  expect(fs.getNode(second.id).parent).toBe(folder.id);
  expect(
    [...s.document.querySelectorAll(".desktop-icon")].every(
      (item) => item.style.visibility === "",
    ),
  ).toBeTrue();
  await drag(s, icon(recycle.id), icon("__recycle-bin"));
  expect(fs.getNode(recycle.id).parent).toBe(fs.RECYCLE_BIN);
  expect(fs.getNode(recycle.id).content).toBe("recover me");
  expect(s.document.querySelectorAll(".drop-target").length).toBe(0);
  // Items deleted while the drag runs stay deleted, and the rest still go.
  const late = fs.createFile(fs.DESKTOP, "late.txt");
  const stays = fs.createFile(fs.DESKTOP, "stays.txt");
  await flushShell();
  const selectOnly = (ids) =>
    s.document
      .querySelectorAll(".desktop-icon")
      .forEach((item) =>
        item.classList.toggle("selected", ids.includes(item.dataset.desktopId)),
      );
  selectOnly([late.id, stays.id]);
  const startDrag = (item) =>
    ["pointerdown", "pointermove"].forEach((type, index) =>
      item.dispatchEvent(
        new s.window.PointerEvent(type, {
          button: 0,
          pointerId: 1,
          clientX: index ? 190 : 10,
          clientY: index ? 140 : 10,
          bubbles: true,
        }),
      ),
    );
  const endDrag = async (item, target) => {
    s.document.elementsFromPoint = () => [s.document.body, target];
    item.dispatchEvent(
      new s.window.PointerEvent("pointerup", {
        button: 0,
        pointerId: 1,
        clientX: 190,
        clientY: 140,
        bubbles: true,
      }),
    );
    await flushShell();
    await flushShell();
  };
  const lateIcon = icon(late.id);
  startDrag(lateIcon);
  await fs.remove(late.id);
  await endDrag(lateIcon, icon("__recycle-bin"));
  expect(fs.isInRecycleBin(late.id)).toBeTrue();
  expect(fs.isInRecycleBin(stays.id)).toBeTrue();
  expect(
    [...s.document.querySelectorAll(".xp-dialog")].some((dialog) =>
      dialog.textContent.includes("cannot delete"),
    ),
  ).toBeFalse();
  fs.restore(stays.id);
  await flushShell();
  selectOnly([stays.id]);
  const staysIcon = icon(stays.id);
  startDrag(staysIcon);
  await fs.remove(stays.id);
  await endDrag(staysIcon, icon(folder.id));
  expect(fs.isInRecycleBin(stays.id)).toBeTrue();
  // A failed delete shows an alert.
  const removeToBin = s.window.FileOperations.removeToBin;
  s.window.FileOperations.removeToBin = async () => {
    throw new Error("Storage is full.");
  };
  try {
    const folderStart = [icon(folder.id).style.left, icon(folder.id).style.top];
    await drag(s, icon(folder.id), icon("__recycle-bin"));
    await flushShell();
    expect(
      [...s.document.querySelectorAll(".xp-dialog")].at(-1)?.textContent,
    ).toContain("Storage is full.");
    expect(fs.getNode(folder.id).parent).toBe(fs.DESKTOP);
    // The icon goes back to its place.
    expect([icon(folder.id).style.left, icon(folder.id).style.top]).toEqual(
      folderStart,
    );
    expect(icon(folder.id).style.visibility).toBe("");
  } finally {
    s.window.FileOperations.removeToBin = removeToBin;
  }
});
test("desktop files can be created, renamed outside the field, copied, cut, and opened through menus", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS,
    ops = s.window.FileOperations;
  await action(s, "new-text");
  const input = s.document.querySelector(".desktop-rename");
  input.value = "Draft.txt";
  s.document.body.dispatchEvent(
    new s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  await flushShell();
  const file = fs.findChild(fs.DESKTOP, "Draft.txt");
  expect(file.name).toBe("Draft.txt");
  await action(s, "rename", file.id);
  key(s, s.document.querySelector(".desktop-rename"), "Escape");
  await flushShell();
  await action(s, "copy", file.id);
  expect(ops.getClipboard().mode).toBe("copy");
  await action(s, "cut", file.id);
  expect(ops.getClipboard().mode).toBe("cut");
  const elsewhere = fs.createFile(fs.MY_DOCUMENTS, "Elsewhere.txt", {
    content: "transfer",
  });
  ops.copy([elsewhere.id]);
  await action(s, "paste");
  expect(fs.findChild(fs.DESKTOP, "Elsewhere.txt").content).toBe("transfer");
  await action(s, "item-properties", file.id);
  expect(s.document.querySelector(".xp-dialog").textContent).toContain(
    "Draft.txt",
  );
  s.document.querySelector('.xp-dialog [data-action="ok"]').click();
  await action(s, "open", file.id);
  expect(s.document.querySelector(".notepad-editor") !== null).toBeTrue();
  await action(s, "new-bitmap");
  key(s, s.document.querySelector(".desktop-rename"), "Enter");
  await flushShell();
  expect(fs.findChild(fs.DESKTOP, "New Bitmap Image.bmp").ext).toBe(".bmp");
  await action(s, "properties");
  expect(
    s.document.querySelector('.xp-window[data-game="__display-properties"]') !==
      null,
  ).toBeTrue();
});
test("desktop size and modified sorts order actual files, with name tie breaks", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const a = fs.createFile(fs.DESKTOP, "A.txt", { size: 10 });
  const b = fs.createFile(fs.DESKTOP, "B.txt", { size: 2 });
  const c = fs.createFile(fs.DESKTOP, "C.txt", { size: 2 });
  await flushShell();
  const ids = new Set([a.id, b.id, c.id]);
  const order = () =>
    [...s.document.querySelectorAll(".desktop-icon")]
      .map((el) => el.dataset.desktopId)
      .filter((id) => ids.has(id));
  await action(s, "sort-size");
  expect(order()).toEqual([b.id, c.id, a.id]);
  await action(s, "sort-modified");
  const expected = [a, b, c]
    .sort((x, y) => y.modified - x.modified || x.name.localeCompare(y.name))
    .map((node) => node.id);
  expect(order()).toEqual(expected);
});
test("desktop restores valid saved positions, relocates collisions and rejects out-of-bounds coordinates", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        desktopIconPositions: JSON.stringify({
          "__my-computer": { left: 75, top: 0 },
          "__my-documents": { left: 75, top: 0 },
          "__recycle-bin": { left: -20, top: 9999 },
        }),
      },
    }),
  );
  geometry(s);
  await action(s, "refresh");
  const icons = [...s.document.querySelectorAll(".desktop-icon")];
  const positions = icons.map((icon) => [
    parseFloat(icon.style.left),
    parseFloat(icon.style.top),
  ]);
  expect(positions[0]).toEqual([75, 0]);
  expect(new Set(positions.map(String)).size).toBe(positions.length);
  expect(
    positions.every(
      ([left, top]) => left >= 0 && left <= 949 && top >= 0 && top <= 663,
    ),
  ).toBeTrue();
  geometry(s, 200, 100);
  await action(s, "sort-name");
  expect(
    s.document
      .getElementById("desktop-icons")
      .classList.contains("desktop-icons-overflow"),
  ).toBeTrue();
});

test("an icon with no free grid slot left is placed below the grid", async () => {
  const s = await login(await loadShell());
  geometry(s, 100, 100);
  const ids = [...s.document.querySelectorAll(".desktop-icon")].map(
    (icon) => icon.dataset.desktopId,
  );
  const positions = Object.fromEntries(
    ids
      .slice(0, -1)
      .map((id, index) => [id, { left: 4, top: 35 + 62 * index }]),
  );
  s.window.localStorage.setItem(
    "desktopIconPositions",
    JSON.stringify(positions),
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  await flushShell();
  const last = s.document.querySelector(`[data-desktop-id="${ids.at(-1)}"]`);
  expect(last.style.top).toBe(`${4 + 62 * ids.length}px`);
});

test("desktop drags over the desktop, files, or the dragged folder move nothing", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.DESKTOP, "Keep");
  const file = fs.createFile(fs.DESKTOP, "stay.txt");
  const other = fs.createFile(fs.DESKTOP, "other.txt");
  await flushShell();
  const icon = (id) => s.document.querySelector(`[data-desktop-id="${id}"]`);
  await drag(s, icon(file.id), icon(other.id));
  await drag(s, icon(folder.id), icon(folder.id));
  expect(fs.getNode(file.id).parent).toBe(fs.DESKTOP);
  expect(fs.getNode(folder.id).parent).toBe(fs.DESKTOP);
  expect(fs.getChildren(folder.id)).toEqual([]);
});

test("desktop icons ignore secondary-button presses, tiny movements, and clicks that end a drag", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "drag.txt");
  await flushShell();
  geometry(s);
  s.document.elementsFromPoint = () => [];
  const icon = s.document.querySelector(`[data-desktop-id="${file.id}"]`);
  const pointer = (type, clientX, clientY, button = 0) =>
    icon.dispatchEvent(
      new s.window.PointerEvent(type, {
        button,
        pointerId: 1,
        clientX,
        clientY,
        bubbles: true,
      }),
    );
  pointer("pointerdown", 10, 10, 2);
  expect(icon.classList.contains("selected")).toBeFalse();

  const before = [icon.style.left, icon.style.top];
  pointer("pointerdown", 10, 10);
  pointer("pointermove", 12, 11);
  pointer("pointerup", 12, 11);
  expect([icon.style.left, icon.style.top]).toEqual(before);
  expect(icon.classList.contains("selected")).toBeTrue();

  const computer = s.document.querySelector(
    '[data-desktop-id="__my-computer"]',
  );
  computer.click();
  pointer("pointerdown", 10, 10);
  pointer("pointermove", 190, 140);
  pointer("pointerup", 190, 140);
  expect([icon.style.left, icon.style.top]).not.toEqual(before);
  icon.click();
  icon.dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  await flushShell();
  expect(s.document.querySelector(".notepad-window")).toBeNull();
});

test("Ctrl-clicking a desktop icon from the keyboard toggles its selection", async () => {
  const s = await login(await loadShell());
  const computer = s.document.querySelector(
    '[data-desktop-id="__my-computer"]',
  );
  const click = () =>
    computer.dispatchEvent(
      new s.window.MouseEvent("click", { bubbles: true, ctrlKey: true }),
    );
  click();
  expect(computer.classList.contains("selected")).toBeTrue();
  click();
  expect(computer.classList.contains("selected")).toBeFalse();
});

test("desktop sorts place folders by their type and break date ties by name", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const text = fs.createFile(fs.DESKTOP, "notes.txt");
  const folder = fs.createFolder(fs.DESKTOP, "Album");
  const bitmap = fs.createFile(fs.DESKTOP, "photo.bmp");
  await flushShell();
  const ids = new Set([text.id, folder.id, bitmap.id]);
  for (const node of [text, folder, bitmap])
    fs.getNode(node.id).modified = 1_000;
  await action(s, "sort-modified");
  expect(
    [...s.document.querySelectorAll(".desktop-icon")]
      .map((el) => el.dataset.desktopId)
      .filter((id) => ids.has(id)),
  ).toEqual([folder.id, text.id, bitmap.id]);
  await action(s, "sort-type");
  expect(
    [...s.document.querySelectorAll(".desktop-icon")]
      .map((el) => el.dataset.desktopId)
      .filter((id) => ids.has(id)),
  ).toEqual([bitmap.id, text.id, folder.id]);
});
test("keys never select a desktop icon that is still moving away", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  fs.createFile(fs.DESKTOP, "kept.txt");
  const moving = fs.createFile(fs.DESKTOP, "zz moving.txt");
  await flushShell();
  const icons = [...s.document.querySelectorAll(".desktop-icon")];
  const movingIcon = icons.find((item) => item.dataset.desktopId === moving.id);
  expect(icons.at(-1)).toBe(movingIcon);
  movingIcon.classList.add("desktop-moving");
  icons[0].focus();
  icons[0].dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(movingIcon.classList.contains("selected")).toBeFalse();
  expect(icons.at(-2).classList.contains("selected")).toBeTrue();
});

test("the browser never starts its own drag from a desktop icon picture", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "picture.txt");
  await flushShell();
  const icon = s.document.querySelector(`[data-desktop-id="${file.id}"]`);
  const image = icon.querySelector("img");
  expect(image !== null).toBeTrue();
  // Chrome cancels the pointer when its own drag of the picture starts.
  const start = new s.window.Event("dragstart", {
    bubbles: true,
    cancelable: true,
  });
  image.dispatchEvent(start);
  expect(start.defaultPrevented).toBeTrue();
});

test("only the top window under the pointer gets a desktop icon's drop, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.DESKTOP, "Behind");
  const file = fs.createFile(fs.DESKTOP, "dragged.txt");
  await flushShell();
  const icon = (id) => s.document.querySelector(`[data-desktop-id="${id}"]`);
  // A window that takes no items covers the folder and the Recycle Bin.
  const covering = s.document.createElement("div");
  covering.className = "xp-window";
  const inside = s.document.createElement("span");
  covering.append(inside);
  s.document.getElementById("desktop").append(covering);
  geometry(s);
  const start = [icon(file.id).style.left, icon(file.id).style.top];
  for (const target of [icon(folder.id), icon("__recycle-bin")]) {
    s.document
      .querySelectorAll(".desktop-icon")
      .forEach((item) =>
        item.classList.toggle("selected", item === icon(file.id)),
      );
    // The dragged icon under the pointer does not count.
    s.document.elementsFromPoint = () => [
      icon(file.id),
      inside,
      covering,
      target,
      s.document.body,
    ];
    for (const [type, clientX, clientY] of [
      ["pointerdown", 10, 10],
      ["pointermove", 190, 140],
      ["pointerup", 190, 140],
    ])
      icon(file.id).dispatchEvent(
        new s.window.PointerEvent(type, {
          button: 0,
          pointerId: 1,
          clientX,
          clientY,
          bubbles: true,
        }),
      );
    await flushShell();
    await flushShell();
  }
  expect(fs.getNode(file.id).parent).toBe(fs.DESKTOP);
  expect(fs.isInRecycleBin(file.id)).toBeFalse();
  expect(s.document.querySelectorAll(".drop-target").length).toBe(0);
  // The icon goes back to its place.
  expect([icon(file.id).style.left, icon(file.id).style.top]).toEqual(start);
});
