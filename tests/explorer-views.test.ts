// @ts-nocheck -- Real Explorer windows driven through Happy DOM events.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

const ART = "data:image/png;base64,iVBORw0KGgo=";
const SAMPLES = [
  "/assets/xp/sample-pictures/blue-hills.jpg",
  "/assets/xp/sample-pictures/sunset.jpg",
  "/assets/xp/sample-pictures/water-lilies.jpg",
  "/assets/xp/sample-pictures/winter.jpg",
];

async function openShell(options) {
  const s = await login(await loadShell(options));
  const fs = s.window.VirtualFS;
  // VirtualFS opens every folder in the same Explorer window.
  const explorer = () =>
    s.document.querySelector('.xp-window[data-game="__my-documents"]');
  const open = async (folderId) => {
    fs.open(folderId);
    await flushShell();
  };
  const items = (win) => win.querySelector(".explorer-items");
  const item = (win, id) =>
    win.querySelector(`.explorer-item[data-node-id="${id}"]`);
  const pick = async (win, command) => {
    win.querySelector(`[data-explorer-command="${command}"]`).click();
    await flushShell();
  };
  const viewMenu = async (win, view) => {
    win.querySelector('[data-explorer-menu="view"]').click();
    await pick(win, view);
  };
  return { s, fs, explorer, open, items, item, pick, viewMenu };
}

test("Sample Pictures opens in Filmstrip, other picture folders in Thumbnails, and other folders in Tiles", async () => {
  const h = await openShell();
  const { fs } = h;
  const album = fs.createFolder(fs.MY_PICTURES, "Album");
  await h.open(fs.MY_PICTURES);
  const pictures = h.explorer();
  expect(h.items(pictures).dataset.view).toBe("thumbnails");
  h.item(pictures, fs.SAMPLE_PICTURES).dispatchEvent(
    new h.s.window.MouseEvent("dblclick"),
  );
  await flushShell();
  expect(h.items(pictures).dataset.view).toBe("filmstrip");
  await h.open(album.id);
  expect(h.items(h.explorer()).dataset.view).toBe("thumbnails");
  await h.open(fs.MY_DOCUMENTS);
  expect(h.items(h.explorer()).dataset.view).toBe("tiles");
});

test("Explorer keeps the view of each folder, also after a reload", async () => {
  const h = await openShell();
  const { fs } = h;
  const first = fs.createFolder(fs.MY_DOCUMENTS, "First");
  const second = fs.createFolder(fs.MY_DOCUMENTS, "Second");
  await h.open(first.id);
  const win = h.explorer();
  await h.viewMenu(win, "details");
  expect(h.items(win).dataset.view).toBe("details");
  // Another folder keeps its own view.
  win.querySelector('[data-explorer-action="up"]').click();
  await flushShell();
  h.item(win, second.id).dispatchEvent(new h.s.window.MouseEvent("dblclick"));
  await flushShell();
  expect(h.items(win).dataset.view).toBe("tiles");
  await h.viewMenu(win, "list");
  // Back in the first folder, its view comes back.
  win.querySelector('[data-explorer-action="back"]').click();
  await flushShell();
  win.querySelector('[data-explorer-action="back"]').click();
  await flushShell();
  expect(h.items(win).dataset.view).toBe("details");
  // The Views menu marks the folder's view.
  win.querySelector('[data-explorer-menu="view"]').click();
  expect(
    win.querySelector('[data-explorer-command="details"]').textContent,
  ).toContain("•");
  expect(
    win.querySelector('[data-explorer-command="list"]').textContent,
  ).not.toContain("•");
  // A picture folder can leave Thumbnails too.
  await h.open(fs.MY_PICTURES);
  const pictures = h.explorer();
  await h.viewMenu(pictures, "icons");
  expect(h.items(pictures).dataset.view).toBe("icons");

  const saved = h.s.window.localStorage.getItem("explorerFolderViews");
  expect(JSON.parse(saved)).toEqual([
    [first.id, "details"],
    [second.id, "list"],
    [fs.MY_PICTURES, "icons"],
  ]);
  const reloaded = await openShell({
    initialStorage: { explorerFolderViews: saved },
  });
  // Test files live only in memory, so the check uses a well-known folder.
  await reloaded.open(reloaded.fs.MY_PICTURES);
  expect(reloaded.items(reloaded.explorer()).dataset.view).toBe("icons");
});

test("Explorer remembers the newest 400 folder views and ignores bad saved views", async () => {
  const old = Array.from({ length: 400 }, (_, index) => [
    `old-${index}`,
    "list",
  ]);
  const h = await openShell({
    initialStorage: { explorerFolderViews: JSON.stringify(old) },
  });
  await h.open(h.fs.MY_DOCUMENTS);
  await h.viewMenu(h.explorer(), "icons");
  const saved = JSON.parse(
    h.s.window.localStorage.getItem("explorerFolderViews"),
  );
  expect(saved).toHaveLength(400);
  expect(saved[0]).toEqual(["old-1", "list"]);
  expect(saved.at(-1)).toEqual([h.fs.MY_DOCUMENTS, "icons"]);

  for (const bad of [
    "not json",
    JSON.stringify({ [h.fs.MY_DOCUMENTS]: "list" }),
    JSON.stringify([[h.fs.MY_DOCUMENTS, "filmstrip"]]),
    JSON.stringify([[7, "list"]]),
    JSON.stringify(["list"]),
  ]) {
    const other = await openShell({
      initialStorage: { explorerFolderViews: bad },
    });
    await other.open(other.fs.MY_DOCUMENTS);
    expect(other.items(other.explorer()).dataset.view).toBe("tiles");
  }
});

test("the Views toolbar button opens the views, like XP", async () => {
  const h = await openShell();
  await h.open(h.fs.MY_DOCUMENTS);
  const win = h.explorer();
  const button = win.querySelector('[data-explorer-action="view"]');
  button.click();
  const menu = win.querySelector(".explorer-menu");
  expect(menu.hidden).toBeFalse();
  expect(menu.dataset.explorerMenuName).toBe("views");
  expect(
    [...menu.querySelectorAll("[data-explorer-command]")].map(
      (entry) => entry.dataset.explorerCommand,
    ),
  ).toEqual(["thumbnails", "tiles", "icons", "list", "details"]);
  expect(menu.querySelector(".checked").dataset.explorerCommand).toBe("tiles");
  // Opening the menu leaves the view as it was.
  expect(h.items(win).dataset.view).toBe("tiles");
  await h.pick(win, "list");
  expect(h.items(win).dataset.view).toBe("list");
  expect(menu.hidden).toBeTrue();
});

test("the Views menu closes on other toolbar buttons, toggles, and gives focus back on Escape", async () => {
  const h = await openShell();
  const { fs } = h;
  const child = fs.createFolder(fs.MY_DOCUMENTS, "Child");
  await h.open(child.id);
  const win = h.explorer();
  const button = win.querySelector('[data-explorer-action="view"]');
  const menu = win.querySelector(".explorer-menu");
  expect(button.getAttribute("aria-haspopup")).toBe("menu");
  button.click();
  expect(button.getAttribute("aria-expanded")).toBe("true");
  // Another toolbar button closes the menu before it acts.
  win.querySelector('[data-explorer-action="up"]').click();
  await flushShell();
  expect(menu.hidden).toBeTrue();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  // A second click on Views closes its menu.
  button.click();
  expect(menu.hidden).toBeFalse();
  button.click();
  expect(menu.hidden).toBeTrue();
  // Escape closes the menu and focuses the Views button.
  button.click();
  menu.querySelector("[data-explorer-command]").focus();
  menu.dispatchEvent(
    new h.s.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(menu.hidden).toBeTrue();
  expect(h.s.document.activeElement).toBe(button);
  // A click outside the window closes it too.
  button.click();
  h.s.document.body.dispatchEvent(
    new h.s.window.MouseEvent("pointerdown", { bubbles: true }),
  );
  expect(menu.hidden).toBeTrue();
  expect(button.getAttribute("aria-expanded")).toBe("false");
});

test("a new view shows in every Explorer window on that folder", async () => {
  const h = await openShell();
  const { fs } = h;
  await h.open(fs.MY_DOCUMENTS);
  const documents = h.explorer();
  h.s.document
    .querySelector('[data-desktop-id="__my-computer"]')
    .dispatchEvent(new h.s.window.MouseEvent("dblclick", { bubbles: true }));
  await flushShell();
  const computer = h.s.document.querySelector(
    '.xp-window[data-game="__my-computer"]',
  );
  h.item(computer, fs.MY_DOCUMENTS).dispatchEvent(
    new h.s.window.MouseEvent("dblclick"),
  );
  await flushShell();
  expect(h.items(computer).dataset.view).toBe("tiles");
  await h.viewMenu(documents, "details");
  expect(h.items(computer).dataset.view).toBe("details");
});

test("Thumbnails view shows pictures, and folders show up to 4 of their pictures", async () => {
  const h = await openShell();
  const { fs } = h;
  const art = fs.createFile(fs.MY_PICTURES, "art.png", { content: ART });
  const broken = fs.createFile(fs.MY_PICTURES, "broken.png", {
    content: "data:image/png;base64,AAAA",
  });
  const notes = fs.createFile(fs.MY_PICTURES, "notes.txt", {
    content: "hello",
  });
  const empty = fs.createFolder(fs.MY_PICTURES, "Empty");
  const words = fs.createFolder(fs.MY_PICTURES, "Words");
  fs.createFile(words.id, "a.txt", { content: "text" });
  fs.createFolder(words.id, "Inner");
  const mixed = fs.createFolder(fs.MY_PICTURES, "Mixed");
  // Pictures sort by name, and only the first 4 show.
  for (const name of ["e.png", "c.png", "a.png", "d.png", "b.png"])
    fs.createFile(mixed.id, name, { content: `${ART}#${name}` });
  fs.createFile(mixed.id, "0.txt", { content: "text" });

  await h.open(fs.MY_PICTURES);
  const win = h.explorer();
  const picture = (id) =>
    h.item(win, id).querySelector("img.thumbnail-picture");
  const previews = (id) =>
    [...h.item(win, id).querySelectorAll(".folder-thumbnail-pictures img")].map(
      (image) => image.getAttribute("src"),
    );

  expect(picture(art.id).getAttribute("src")).toBe(ART);
  expect(picture(notes.id)).toBeNull();
  expect(previews(fs.SAMPLE_PICTURES)).toEqual(SAMPLES);
  expect(previews(mixed.id)).toEqual(
    ["a.png", "b.png", "c.png", "d.png"].map((name) => `${ART}#${name}`),
  );
  // A folder without pictures keeps its folder icon.
  for (const folder of [empty, words]) {
    expect(
      h.item(win, folder.id).querySelector(".folder-thumbnail"),
    ).toBeNull();
    expect(
      h.item(win, folder.id).querySelector(".explorer-item-icon img"),
    ).not.toBeNull();
  }
  // A picture the browser cannot draw shows its icon instead.
  picture(broken.id).dispatchEvent(new h.s.window.Event("error"));
  expect(picture(broken.id)).toBeNull();
  expect(
    h.item(win, broken.id).querySelector(".explorer-item-icon img"),
  ).not.toBeNull();
  // A preview the browser cannot draw leaves the others.
  h.item(win, mixed.id)
    .querySelector(".folder-thumbnail-pictures img")
    .dispatchEvent(new h.s.window.Event("error"));
  expect(previews(mixed.id)).toEqual(
    ["b.png", "c.png", "d.png"].map((name) => `${ART}#${name}`),
  );

  // A folder whose previews all fail shows its folder icon.
  const lone = fs.createFolder(fs.MY_PICTURES, "Lone");
  fs.createFile(lone.id, "only.png", { content: ART });
  h.item(win, lone.id)
    .querySelector(".folder-thumbnail-pictures img")
    .dispatchEvent(new h.s.window.Event("error"));
  expect(h.item(win, lone.id).querySelector(".folder-thumbnail")).toBeNull();
  expect(
    h.item(win, lone.id).querySelector(".explorer-item-icon img"),
  ).not.toBeNull();

  // Other views show icons.
  await h.viewMenu(win, "tiles");
  expect(win.querySelector(".thumbnail-picture, .folder-thumbnail")).toBeNull();
});

test("Details view lists the name, type and size of each item in its own column", async () => {
  const h = await openShell();
  const { fs } = h;
  const file = fs.createFile(fs.MY_DOCUMENTS, "big.txt", {
    content: "x".repeat(28521),
  });
  await h.open(fs.MY_DOCUMENTS);
  const win = h.explorer();
  await h.viewMenu(win, "details");
  const header = (target) =>
    [...target.querySelector(".explorer-details-header").children].map(
      (cell) => cell.textContent,
    );
  expect(header(win)).toEqual(["Name", "Size", "Type", "Date Modified"]);
  const row = h.item(win, file.id);
  expect([...row.children].map((cell) => cell.className)).toEqual([
    "explorer-item-icon",
    "explorer-item-label",
    "explorer-detail-size",
    "explorer-detail-type",
    "explorer-detail-modified",
  ]);
  expect(row.querySelector(".explorer-item-label b").textContent).toBe(
    "big.txt",
  );
  expect(row.querySelector(".explorer-detail-size").textContent).toBe("28 KB");
  expect(row.querySelector(".explorer-detail-type").textContent).toBe(
    "Text Document",
  );
  expect(row.querySelector(".explorer-detail-modified").textContent).toBe(
    h.s.window.XPDialogs.formatDetailsDate(fs.getNode(file.id).modified),
  );
  // Folders leave the size empty.
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Box");
  expect(
    h.item(win, folder.id).querySelector(".explorer-detail-size").textContent,
  ).toBe("");
  // My Computer has no drive sizes, so it shows only the name and type.
  await h.open(fs.MY_COMPUTER);
  await h.viewMenu(win, "details");
  expect(header(win)).toEqual(["Name", "Type"]);
  expect(
    [...h.item(win, fs.DRIVE_C).children].map((cell) => cell.textContent),
  ).toEqual(["", "Local Disk (C:)", "Local Disk"]);
});

test("drives, My Computer and the Recycle Bin keep their icons in Thumbnails", async () => {
  const h = await openShell();
  const { fs } = h;
  fs.createFile(fs.DRIVE_C, "root.png", { content: ART });
  fs.remove(fs.createFile(fs.MY_DOCUMENTS, "gone.png", { content: ART }).id);
  await h.open(fs.MY_COMPUTER);
  const win = h.explorer();
  await h.viewMenu(win, "thumbnails");
  expect(win.querySelector(".folder-thumbnail")).toBeNull();
  // My Documents keeps My Computer's plain folder icon when its preview fails.
  fs.createFile(fs.MY_DOCUMENTS, "photo.png", { content: ART });
  await flushShell();
  h.item(win, fs.MY_DOCUMENTS)
    .querySelector(".folder-thumbnail-pictures img")
    .dispatchEvent(new h.s.window.Event("error"));
  expect(
    h
      .item(win, fs.MY_DOCUMENTS)
      .querySelector(".explorer-item-icon img")
      .getAttribute("src"),
  ).toContain("NewFolder.png");
  expect(
    h.item(win, fs.DRIVE_C).querySelector(".explorer-item-icon img"),
  ).not.toBeNull();
  // The Recycle Bin and My Computer show where a folder lists them, such as
  // the Desktop in the file dialogs.
  for (const id of [fs.RECYCLE_BIN, fs.MY_COMPUTER]) {
    const icon = h.s.document.createElement("span");
    icon.textContent = "icon";
    h.s.window.XPDialogs.fillThumbnail(icon, fs.getNode(id), () => null);
    expect(icon.textContent).toBe("icon");
  }
});

// The harness draws nothing, so a picture loads with the given size, or
// fails. Only the next image the page creates is affected.
function stubNextPicture(h, { width = 8, height = 6, fail = false } = {}) {
  const document = h.s.document;
  const createElement = document.createElement;
  document.createElement = function (name, ...args) {
    const element = createElement.call(this, name, ...args);
    if (name !== "img") return element;
    document.createElement = createElement;
    Object.defineProperty(element, "src", {
      set() {
        Object.defineProperties(element, {
          naturalWidth: { value: width },
          naturalHeight: { value: height },
        });
        queueMicrotask(() =>
          element.dispatchEvent(new h.s.window.Event(fail ? "error" : "load")),
        );
      },
    });
    return element;
  };
}

function recordCanvas(h) {
  const drawn = [];
  const proto = h.s.window.HTMLCanvasElement.prototype;
  const getContext = proto.getContext;
  proto.getContext = function (...args) {
    const context = getContext.apply(this, args);
    context.setTransform = (...matrix) =>
      drawn.push({ width: this.width, height: this.height, matrix });
    return context;
  };
  return drawn;
}

async function openFilmstrip(h, files) {
  const { fs } = h;
  const folder = fs.createFolder(fs.MY_PICTURES, "Strip");
  const nodes = files.map(([name, content]) =>
    fs.createFile(folder.id, name, { content }),
  );
  await h.open(folder.id);
  const win = h.explorer();
  await h.viewMenu(win, "filmstrip");
  const preview = () =>
    win.querySelector(".explorer-filmstrip-preview img")?.getAttribute("src");
  const button = (action) =>
    win.querySelector(`[data-filmstrip-action="${action}"]`);
  const selected = () =>
    [...win.querySelectorAll(".explorer-item.selected")].map(
      (item) => item.dataset.nodeId,
    );
  const key = (key, options = {}, target = h.items(win)) =>
    target.dispatchEvent(
      new h.s.window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        ...options,
      }),
    );
  return { folder, nodes, win, preview, button, selected, key };
}

test("the Views menu offers Filmstrip only in picture folders", async () => {
  const h = await openShell();
  const { fs } = h;
  await h.open(fs.MY_PICTURES);
  const win = h.explorer();
  const entries = () =>
    [...win.querySelectorAll(".explorer-menu [data-explorer-command]")].map(
      (entry) => entry.textContent.replace("•", ""),
    );
  win.querySelector('[data-explorer-action="view"]').click();
  expect(entries()).toEqual([
    "Filmstrip",
    "Thumbnails",
    "Tiles",
    "Icons",
    "List",
    "Details",
  ]);
  // A second click closes the menu.
  win.querySelector('[data-explorer-action="view"]').click();
  await h.open(fs.MY_DOCUMENTS);
  win.querySelector('[data-explorer-action="view"]').click();
  expect(entries()).not.toContain("Filmstrip");
  // A saved Filmstrip view applies only where XP offers it.
  const other = await openShell({
    initialStorage: {
      explorerFolderViews: JSON.stringify([
        [fs.MY_DOCUMENTS, "filmstrip"],
        [fs.MY_PICTURES, "filmstrip"],
      ]),
    },
  });
  await other.open(other.fs.MY_DOCUMENTS);
  expect(other.items(other.explorer()).dataset.view).toBe("tiles");
  await other.open(other.fs.MY_PICTURES);
  expect(other.items(other.explorer()).dataset.view).toBe("filmstrip");
});

test("Filmstrip shows the first picture, and Previous and Next wrap like XP", async () => {
  const h = await openShell();
  const art = (name) => `${ART}#${name}`;
  const f = await openFilmstrip(h, [
    ["a.png", art("a")],
    ["b.png", art("b")],
    ["c.png", art("c")],
  ]);
  const [a, b, c] = f.nodes;
  expect(f.win.querySelector(".explorer-main").dataset.view).toBe("filmstrip");
  expect(f.button("previous").title).toBe("Previous Image (Left Arrow)");
  // XP's own button pictures.
  expect(
    ["previous", "next", "rotate-clockwise", "rotate-counterclockwise"].map(
      (action) => f.button(action).querySelector("img").getAttribute("src"),
    ),
  ).toEqual([
    "assets/xp/explorer/filmstrip-previous.png",
    "assets/xp/explorer/filmstrip-next.png",
    "assets/xp/explorer/filmstrip-rotate-clockwise.png",
    "assets/xp/explorer/filmstrip-rotate-counterclockwise.png",
  ]);
  expect(f.preview()).toBe(art("a"));
  expect(f.selected()).toEqual([]);
  // Thumbnails fill the strip.
  expect(
    h.item(f.win, b.id).querySelector("img.thumbnail-picture").src,
  ).toContain("#b");
  f.button("previous").click();
  expect(f.selected()).toEqual([c.id]);
  expect(f.preview()).toBe(art("c"));
  f.button("next").click();
  expect(f.selected()).toEqual([a.id]);
  // The arrow keys step too; other keys and Alt or Ctrl arrows do not.
  f.key("ArrowRight");
  expect(f.selected()).toEqual([b.id]);
  f.key("ArrowLeft");
  f.key("ArrowLeft");
  expect(f.selected()).toEqual([c.id]);
  for (const [key, options] of [
    ["ArrowLeft", { altKey: true }],
    ["ArrowLeft", { ctrlKey: true }],
    ["k", {}],
    ["Home", {}],
  ])
    f.key(key, options);
  expect(f.selected()).toEqual([c.id]);
  // A click picks the picture.
  h.item(f.win, b.id).click();
  expect(f.preview()).toBe(art("b"));
  // A click on the preview area keeps the selection.
  f.win
    .querySelector(".explorer-filmstrip-preview")
    .dispatchEvent(
      new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
  expect(f.selected()).toEqual([b.id]);
  // A new render, such as a new file, keeps the selection and the preview.
  h.fs.createFile(f.folder.id, "d.png", { content: art("d") });
  await flushShell();
  expect(f.selected()).toEqual([b.id]);
  expect(f.preview()).toBe(art("b"));
  // Keys in the rename box do not step.
  f.key("F2", {}, h.item(f.win, b.id));
  const rename = f.win.querySelector(".explorer-rename");
  f.key("ArrowRight", {}, rename);
  expect(f.selected()).toEqual([b.id]);
  f.key("Escape", {}, rename);
  // Another view drops the Filmstrip, and the arrows stop stepping there.
  await h.viewMenu(f.win, "thumbnails");
  expect(f.win.querySelector(".explorer-filmstrip")).toBeNull();
  expect(f.win.querySelector(".explorer-main").dataset.view).toBe("thumbnails");
  f.key("ArrowRight");
  expect(f.selected()).toEqual([b.id]);
  // A new folder clears the selection.
  await h.open(h.fs.MY_PICTURES);
  expect(f.selected()).toEqual([]);
});

test("Filmstrip rotates pictures and saves them in their own type", async () => {
  const h = await openShell();
  const drawn = recordCanvas(h);
  const f = await openFilmstrip(h, [
    ["a.png", ART],
    ["b.jpg", "data:image/jpeg;base64,AAAA"],
    ["c.bmp", "data:image/bmp;base64,AAAA"],
    ["d.gif", "data:image/gif;base64,AAAA"],
    ["e.txt", "text"],
  ]);
  const [png, jpg, bmp, gif, text] = f.nodes;
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await flushShell();
  };
  expect(f.button("rotate-clockwise").title).toBe("Rotate Clockwise");
  stubNextPicture(h, { width: 8, height: 6 });
  f.button("rotate-clockwise").click();
  await settle();
  expect(drawn.at(-1)).toEqual({
    width: 6,
    height: 8,
    matrix: [0, 1, -1, 0, 6, 0],
  });
  expect(h.fs.getContent(png.id)).toBe("data:image/png;base64,");

  h.item(f.win, jpg.id).click();
  stubNextPicture(h, { width: 8, height: 6 });
  f.key("l", { ctrlKey: true });
  await settle();
  expect(drawn.at(-1)).toEqual({
    width: 6,
    height: 8,
    matrix: [0, -1, 1, 0, 0, 8],
  });
  expect(h.fs.getContent(jpg.id)).toBe("data:image/jpeg;base64,");

  h.item(f.win, bmp.id).click();
  stubNextPicture(h, { width: 2, height: 1 });
  f.key("K", { ctrlKey: true });
  await settle();
  expect(h.fs.getContent(bmp.id)).toStartWith("data:image/bmp;base64,");

  // XP cannot rotate a GIF without losing it, and other files have no
  // picture.
  for (const node of [gif, text]) {
    h.item(f.win, node.id).click();
    expect(f.button("rotate-clockwise").disabled).toBeTrue();
    expect(f.button("rotate-counterclockwise").disabled).toBeTrue();
    f.key("k", { ctrlKey: true });
    await settle();
  }
  expect(h.fs.getContent(gif.id)).toBe("data:image/gif;base64,AAAA");
  expect(f.preview()).toBeUndefined();
  expect(f.win.querySelector(".explorer-filmstrip-preview").textContent).toBe(
    "No preview available.",
  );

  // A picture the browser cannot read shows an error, and a later rotation
  // still runs.
  h.item(f.win, png.id).click();
  stubNextPicture(h, { fail: true });
  f.button("rotate-counterclockwise").click();
  await settle();
  const dialog = h.s.document.querySelector(".xp-dialog");
  expect(dialog.textContent).toContain("Windows cannot read this picture.");
  dialog.querySelector(".dlg-buttons button").click();
  await settle();
  const before = drawn.length;
  stubNextPicture(h);
  f.button("rotate-clockwise").click();
  await settle();
  expect(drawn).toHaveLength(before + 1);
  // An error without a message gets XP's general one.
  const setContent = h.fs.setContent;
  h.fs.setContent = () => {
    throw new Error("");
  };
  stubNextPicture(h);
  f.button("rotate-clockwise").click();
  await settle();
  h.fs.setContent = setContent;
  const failed = h.s.document.querySelector(".xp-dialog");
  expect(failed.textContent).toContain("Windows cannot rotate this picture.");
  failed.querySelector(".dlg-buttons button").click();
});

test("Filmstrip rotations of one window run one after another", async () => {
  const h = await openShell();
  recordCanvas(h);
  const f = await openFilmstrip(h, [["a.png", ART]]);
  const [png] = f.nodes;
  const writes = [];
  const setContent = h.fs.setContent;
  h.fs.setContent = (id, content, options) => {
    writes.push(options.expectedContent);
    return setContent(id, `${content}${writes.length}`, options);
  };
  stubNextPicture(h);
  f.button("rotate-clockwise").click();
  f.button("rotate-clockwise").click();
  // The second rotation loads the picture only after the first one saved.
  await flushShell();
  stubNextPicture(h);
  for (let i = 0; i < 6; i += 1) await flushShell();
  expect(writes).toEqual([ART, "data:image/png;base64,1"]);
  expect(h.fs.getContent(png.id)).toBe("data:image/png;base64,2");
});

test("an empty Filmstrip and a broken picture leave the preview empty", async () => {
  const h = await openShell();
  const f = await openFilmstrip(h, []);
  for (const action of [
    "previous",
    "next",
    "rotate-clockwise",
    "rotate-counterclockwise",
  ])
    expect(f.button(action).disabled).toBeTrue();
  expect(f.preview()).toBeUndefined();
  f.key("ArrowRight");
  // Disabled buttons do nothing.
  f.button("next").dispatchEvent(
    new h.s.window.MouseEvent("click", { bubbles: true }),
  );
  expect(f.selected()).toEqual([]);

  const broken = h.fs.createFile(f.folder.id, "broken.png", {
    content: "data:image/png;base64,AAAA",
  });
  await flushShell();
  expect(f.button("next").disabled).toBeFalse();
  f.win
    .querySelector(".explorer-filmstrip-preview img")
    .dispatchEvent(new h.s.window.Event("error"));
  expect(f.preview()).toBeUndefined();
  expect(f.win.querySelector(".explorer-filmstrip-preview").textContent).toBe(
    "No preview available.",
  );
  expect(h.item(f.win, broken.id)).not.toBeNull();
  // A folder shows no preview.
  const inner = h.fs.createFolder(f.folder.id, "Inner");
  await flushShell();
  h.item(f.win, inner.id).click();
  expect(f.win.querySelector(".explorer-filmstrip-preview").textContent).toBe(
    "",
  );
});

test("files show XP's icon for their type", async () => {
  const h = await openShell();
  const { fs } = h;
  const names = {
    "a.bmp": "BitmapImage.png",
    "b.gif": "ImageDocument.png",
    "c.png": "ImageDocument.png",
    "d.JPG": "JpegImage.png",
    "e.jpeg": "JpegImage.png",
    "f.txt": "TextDocument.png",
    "g.zip": "GenericFile.png",
    README: "GenericFile.png",
  };
  const ids = Object.keys(names).map(
    (name) => fs.createFile(fs.MY_DOCUMENTS, name, { content: "" }).id,
  );
  await h.open(fs.MY_DOCUMENTS);
  const win = h.explorer();
  expect(
    ids.map((id) =>
      h
        .item(win, id)
        .querySelector(".explorer-item-icon img")
        .getAttribute("src"),
    ),
  ).toEqual(Object.values(names).map((icon) => `assets/xp/icons/${icon}`));
});
