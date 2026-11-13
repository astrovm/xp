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

test("picture folders open in Thumbnails, and other folders in Tiles", async () => {
  const h = await openShell();
  const { fs } = h;
  await h.open(fs.MY_PICTURES);
  const pictures = h.explorer();
  expect(h.items(pictures).dataset.view).toBe("thumbnails");
  h.item(pictures, fs.SAMPLE_PICTURES).dispatchEvent(
    new h.s.window.MouseEvent("dblclick"),
  );
  await flushShell();
  expect(h.items(pictures).dataset.view).toBe("thumbnails");
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
  expect(
    [...win.querySelector(".explorer-details-header").children].map(
      (cell) => cell.textContent,
    ),
  ).toEqual(["Name", "Type", "Size"]);
  const row = h.item(win, file.id);
  expect([...row.children].map((cell) => cell.className)).toEqual([
    "explorer-item-icon",
    "explorer-item-label",
    "explorer-detail-type",
    "explorer-detail-size",
  ]);
  expect(row.querySelector(".explorer-item-label b").textContent).toBe(
    "big.txt",
  );
  expect(row.querySelector(".explorer-detail-size").textContent).toBe("28 KB");
  // Folders leave the size empty.
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Box");
  expect(
    h.item(win, folder.id).querySelector(".explorer-detail-size").textContent,
  ).toBe("");
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
