// @ts-nocheck -- Explorer layout compared against the XP SP3 VM.
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
  await flushShell();
  await flushShell();
};

const openFolder = async (s, folderId) => {
  s.window.VirtualFS.open(folderId);
  await settle();
  return [...s.document.querySelectorAll(".xp-window")].at(-1);
};
const names = (win) =>
  [...win.querySelectorAll(".explorer-item b")].map((b) => b.textContent);
const places = (win) =>
  [
    ...win.querySelectorAll(
      ".explorer-places-section .explorer-section-body button",
    ),
  ].map((button) => button.textContent);
const tasks = (win) =>
  [...win.querySelectorAll(".explorer-sidebar > section:first-child button")]
    .filter((button) => !button.classList.contains("explorer-section-toggle"))
    .map((button) => button.textContent);
const details = (win) =>
  [
    ...win.querySelectorAll(
      ".explorer-details-section .explorer-section-body > *",
    ),
  ].map((line) => line.textContent);

test("My Computer lists the real folders and drives in XP's groups", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const win = await openFolder(s, fs.MY_COMPUTER);
  expect(
    [...win.querySelectorAll(".explorer-group-heading")].map(
      (heading) => heading.textContent,
    ),
  ).toEqual([
    "Files Stored on This Computer",
    "Hard Disk Drives",
    "Devices with Removable Storage",
  ]);
  expect(names(win)).toEqual([
    "Shared Documents",
    "astro's Documents",
    "Local Disk (C:)",
    "Local Disk (D:)",
    "Removable Disk (F:)",
  ]);
  expect(win.querySelector(".explorer-main h2").hidden).toBeTrue();
  expect(places(win)).toEqual([
    "My Documents",
    "Shared Documents",
    "Control Panel",
  ]);
  expect(details(win)).toEqual(["My Computer", "System Folder"]);
  expect(tasks(win)).toEqual([
    "View system information",
    "Add or remove programs",
    "Change a setting",
  ]);

  win
    .querySelector(`.explorer-item[data-node-id="${fs.SHARED_DOCUMENTS}"]`)
    .dispatchEvent(new s.window.MouseEvent("dblclick"));
  await settle();
  expect(win.querySelector(".title-text").textContent).toBe("Shared Documents");
  expect(win.querySelector(".explorer-address input").value).toBe(
    "Shared Documents",
  );
  expect(places(win)).toEqual(["All Users", "My Documents", "My Computer"]);
  win.querySelector('[data-place="parent"]').click();
  await settle();
  expect(win.querySelector(".explorer-address input").value).toBe(
    "C:\\Documents and Settings\\All Users",
  );
  win
    .querySelector(".explorer-places-section [data-place='control-panel']")
    ?.click();
});

test("Other Places follows the folder being shown", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const win = await openFolder(s, fs.MY_DOCUMENTS);
  expect(win.querySelector(".explorer-address input").value).toBe(
    "My Documents",
  );
  expect(places(win)).toEqual(["Desktop", "Shared Documents", "My Computer"]);
  expect(names(win)).toEqual(["My Music", "My Pictures"]);
  expect(win.querySelectorAll(".explorer-item small").length).toBe(0);

  const visit = async (place) => {
    win.querySelector(`[data-place="${place}"]`).click();
    await settle();
  };
  await visit("desktop");
  expect(places(win)).toEqual([
    "My Computer",
    "My Documents",
    "Shared Documents",
  ]);
  await visit("documents");
  win
    .querySelector(`.explorer-item[data-node-id="${fs.MY_PICTURES}"]`)
    .dispatchEvent(new s.window.MouseEvent("dblclick"));
  await settle();
  expect(places(win)).toEqual(["My Documents", "My Computer"]);
  await visit("computer");
  win
    .querySelector(`.explorer-item[data-node-id="${fs.DRIVE_C}"]`)
    .dispatchEvent(new s.window.MouseEvent("dblclick"));
  await settle();
  expect(places(win)).toEqual([
    "My Computer",
    "My Documents",
    "Shared Documents",
  ]);
  fs.open(fs.RECYCLE_BIN);
  await settle();
  const bin = [...s.document.querySelectorAll(".xp-window")].at(-1);
  expect(places(bin)).toEqual(["Desktop", "My Documents", "My Computer"]);
});

test("tasks and Details follow the selection", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Work");
  const note = fs.createFile(folder.id, "note.txt", { content: "hello" });
  const other = fs.createFile(folder.id, "other.txt", { content: "" });
  const win = await openFolder(s, folder.id);
  const item = (id) =>
    win.querySelector(`.explorer-item[data-node-id="${id}"]`);
  expect(tasks(win)).toEqual(["Make a new folder"]);
  expect(details(win)).toEqual(["Work", "File folder"]);
  expect(places(win)).toEqual([
    "My Documents",
    "Shared Documents",
    "My Computer",
  ]);

  item(note.id).click();
  expect(tasks(win)).toEqual(["Rename this file", "Delete this file"]);
  expect(details(win)[0]).toBe("note.txt");
  expect(details(win)[1]).toBe("TXT file");
  expect(details(win)[2]).toContain("Date Modified:");
  expect(details(win)[3]).toBe("Size: 5 bytes");

  item(other.id).dispatchEvent(
    new s.window.MouseEvent("click", { ctrlKey: true, bubbles: true }),
  );
  expect(tasks(win)).toEqual(["Delete the selected items"]);
  expect(details(win)).toEqual(["2 items selected."]);

  item(note.id).click();
  [...win.querySelectorAll(".explorer-sidebar button")]
    .find((button) => button.textContent === "Rename this file")
    .click();
  const input = win.querySelector(".explorer-rename");
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(4);
  input.value = "memo.txt";
  input.dispatchEvent(new s.window.FocusEvent("blur"));
  await settle();
  expect(fs.getNode(note.id).name).toBe("memo.txt");
  // A late blur after the rename finished changes nothing.
  input.value = "late.txt";
  input.dispatchEvent(new s.window.FocusEvent("blur"));
  await settle();
  expect(fs.getNode(note.id).name).toBe("memo.txt");

  const memo = item(note.id);
  memo.click();
  [...win.querySelectorAll(".explorer-sidebar button")]
    .find((button) => button.textContent === "Delete this file")
    .click();
  await settle();
  expect(
    [...s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
  ).toContain("memo.txt");
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector('[data-action="yes"]')
    .click();
  await settle();
  expect(fs.isInRecycleBin(note.id)).toBeTrue();

  item(other.id).click();
  item(other.id).dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
    }),
  );
  [...win.querySelectorAll(".explorer-item")].forEach((entry) =>
    entry.classList.add("selected"),
  );
  win.querySelector(".explorer-item").click();
  win
    .querySelector(".explorer-item")
    .dispatchEvent(
      new s.window.MouseEvent("click", { ctrlKey: true, bubbles: true }),
    );

  const nested = fs.createFolder(folder.id, "Inner");
  await settle();
  item(nested.id).click();
  expect(tasks(win)).toEqual(["Rename this folder", "Delete this folder"]);
  [...win.querySelectorAll(".explorer-sidebar button")]
    .find((button) => button.textContent === "Rename this folder")
    .click();
  const folderInput = win.querySelector(".explorer-rename");
  expect(folderInput.selectionEnd).toBe(5);
  folderInput.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await settle();
  expect(fs.getNode(nested.id).name).toBe("Inner");
});

test("selecting several files offers Delete the selected items", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Batch");
  const first = fs.createFile(folder.id, "a.txt", { content: "" });
  const second = fs.createFile(folder.id, "b.txt", { content: "" });
  const win = await openFolder(s, folder.id);
  const item = (id) =>
    win.querySelector(`.explorer-item[data-node-id="${id}"]`);
  item(first.id).click();
  item(second.id).dispatchEvent(
    new s.window.MouseEvent("click", { ctrlKey: true, bubbles: true }),
  );
  [...win.querySelectorAll(".explorer-sidebar button")]
    .find((button) => button.textContent === "Delete the selected items")
    .click();
  await settle();
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector('[data-action="yes"]')
    .click();
  await settle();
  expect(fs.isInRecycleBin(first.id)).toBeTrue();
  expect(fs.isInRecycleBin(second.id)).toBeTrue();

  const kept = fs.createFile(folder.id, "c.txt", { content: "" });
  await settle();
  item(kept.id).click();
  const rename = s.window.FileOperations.rename;
  s.window.FileOperations.rename = async () => {
    throw new Error("");
  };
  try {
    [...win.querySelectorAll(".explorer-sidebar button")]
      .find((button) => button.textContent === "Rename this file")
      .click();
    const input = win.querySelector(".explorer-rename");
    input.value = "d.txt";
    input.dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
  } finally {
    s.window.FileOperations.rename = rename;
  }
  const error = [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  expect(error.querySelector(".title-text").textContent).toBe(
    "Error Renaming File or Folder",
  );
  expect(error.textContent).toContain("The file operation failed.");
});

test("a protected selection keeps only the folder task", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const win = await openFolder(s, fs.MY_DOCUMENTS);
  win.querySelector(`.explorer-item[data-node-id="${fs.MY_MUSIC}"]`).click();
  expect(tasks(win)).toEqual(["Make a new folder"]);
  expect(details(win)).toEqual(["My Music", "System Folder"]);
  const drive = await openFolder(s, fs.DRIVE_C);
  expect(tasks(drive)).toEqual(["Make a new folder"]);
  const profile = await openFolder(s, fs.USER_PROFILE);
  expect(
    profile.querySelector(".explorer-sidebar > section:first-child").hidden,
  ).toBeTrue();
});

test("Explorer never browses into the Recycle Bin's folders", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.DESKTOP, "Old");
  fs.createFolder(folder.id, "Inner");
  const open = await openFolder(s, folder.id);
  fs.remove(folder.id);
  await settle();
  // A window showing a folder that goes to the Recycle Bin moves to My
  // Computer.
  expect(names(open)).toContain("Local Disk (C:)");
  const bin = await openFolder(s, fs.RECYCLE_BIN);
  const item = bin.querySelector(`.explorer-item[data-node-id="${folder.id}"]`);
  // A deleted folder takes no drops.
  expect(item.dataset.dropDestinationId).toBeUndefined();
  // Like XP, opening a deleted folder shows its Properties.
  item.dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  await settle();
  expect(
    [...s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
  ).toContain("Old Properties");
  expect(names(bin)).toEqual(["Old"]);
  // The Folders tree lists no deleted folders.
  const row = bin.querySelector(
    `.explorer-tree-item[data-node-id="${fs.RECYCLE_BIN}"]`,
  );
  expect(row.textContent).toBe("  Recycle Bin");
  row.dispatchEvent(new s.window.MouseEvent("dblclick"));
  expect(
    !!bin.querySelector(`.explorer-tree-item[data-node-id="${folder.id}"]`),
  ).toBeFalse();
  // Items in the Recycle Bin keep their names: F2 does not rename them.
  bin
    .querySelector(`.explorer-item[data-node-id="${folder.id}"]`)
    .dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key: "F2", bubbles: true }),
    );
  expect(!!bin.querySelector(".explorer-rename")).toBeFalse();
  // Run cannot find an item by its place in the Recycle Bin.
  clickStartAction(s, "run");
  const run = s.document.querySelector(".run-dialog");
  run.querySelector("#run-command").value = "Recycle Bin\\Old";
  run.querySelector('[data-action="run"]').click();
  await settle();
  expect(s.document.querySelector(".run-dialog").textContent).toContain(
    "Windows cannot find 'Recycle Bin\\Old'",
  );
  // Opening it by its id does not browse into it either.
  fs.open(folder.id);
  await settle();
  expect(names(open)).not.toContain("Inner");
});

test("the Recycle Bin's File menu deletes for good and never renames", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "old.txt");
  fs.remove(file.id);
  const bin = await openFolder(s, fs.RECYCLE_BIN);
  bin.querySelector(`.explorer-item[data-node-id="${file.id}"]`).click();
  const command = (name) =>
    bin.querySelector(`.explorer-menu [data-explorer-command="${name}"]`);
  bin.querySelector('[data-explorer-menu="file"]').click();
  expect(command("rename").disabled).toBeTrue();
  command("delete").click();
  await settle();
  const dialog = [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  expect(dialog.textContent).toContain("permanently delete the selected items");
  dialog.querySelector('[data-action="yes"]').click();
  await settle();
  expect(!!fs.getNode(file.id)).toBeFalse();
  // An item restored while the question is open, for example in another
  // tab, is not deleted.
  const kept = fs.createFile(fs.DESKTOP, "kept.txt");
  fs.remove(kept.id);
  await settle();
  bin.querySelector(`.explorer-item[data-node-id="${kept.id}"]`).click();
  bin.querySelector('[data-explorer-menu="file"]').click();
  command("delete").click();
  await settle();
  fs.restore(kept.id);
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector('[data-action="yes"]')
    .click();
  await settle();
  expect(fs.getNode(kept.id).parent).toBe(fs.DESKTOP);
  expect(
    [...s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
  ).toContain("File operation");
});
