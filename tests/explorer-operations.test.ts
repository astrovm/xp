// @ts-nocheck -- Real shell file operations with synthetic browser drops.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";

afterEach(cleanupShells);

const settle = async (predicate = () => true) => {
  for (let i = 0; i < 40 && !predicate(); i++) await flushShell();
  expect(Boolean(predicate())).toBeTrue();
};
const dialogText = (s) =>
  [...s.document.querySelectorAll(".xp-dialog")].at(-1)?.textContent || "";
const answer = async (s, id) => {
  await settle(() =>
    [...s.document.querySelectorAll(".xp-dialog")]
      .at(-1)
      ?.querySelector(`[data-action="${id}"]`),
  );
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector(`[data-action="${id}"]`)
    .click();
  await flushShell();
  await flushShell();
};

const emptyFromDesktop = async (s) => {
  s.document.querySelector('[data-desktop-id="__recycle-bin"]').dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  s.document
    .querySelector('#desktop-context-menu [data-action="empty-recycle-bin"]')
    .click();
  await flushShell();
};

test("emptying the Recycle Bin asks for one or many items and reports failures", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS;
  const first = fs.createFile(fs.DESKTOP, "first.txt");
  fs.remove(first.id);
  await emptyFromDesktop(s);
  expect(dialogText(s)).toContain("delete this item?");
  await answer(s, "no");
  expect(fs.getChildren(fs.RECYCLE_BIN)).toHaveLength(1);

  fs.remove(fs.createFile(fs.DESKTOP, "second.txt").id);
  await emptyFromDesktop(s);
  expect(dialogText(s)).toContain("delete these 2 items?");
  const emptyBin = s.window.FileOperations.emptyRecycleBin;
  s.window.FileOperations.emptyRecycleBin = async () => {
    throw new Error("");
  };
  try {
    await answer(s, "yes");
    expect(dialogText(s)).toContain("The file operation failed.");
    await answer(s, "ok");
  } finally {
    s.window.FileOperations.emptyRecycleBin = emptyBin;
  }
  await emptyFromDesktop(s);
  await answer(s, "yes");
  expect(fs.getChildren(fs.RECYCLE_BIN)).toHaveLength(0);
});

test("pasting several items shows cancellable progress and reports failures", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS,
    ops = s.window.FileOperations;
  const source = fs.createFolder(fs.MY_DOCUMENTS, "Source");
  const destination = fs.createFolder(fs.MY_DOCUMENTS, "Destination");
  const files = ["a.txt", "b.txt", "c.txt"].map((name) =>
    fs.createFile(source.id, name),
  );
  fs.open(destination.id);
  await flushShell();
  const win = s.document.querySelector(
    '.xp-window[data-game="__my-documents"]',
  );
  const surface = win.querySelector(".explorer-items");
  const paste = () => {
    surface.focus();
    surface.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  ops.cut(files.map((file) => file.id));
  paste();
  paste();
  await settle(() => !s.document.querySelector(".xp-dialog"));
  expect(fs.getChildren(destination.id)).toHaveLength(3);

  ops.copy(files.map((file) => file.id));
  const pasteWithConflicts = ops.pasteWithConflicts;
  ops.pasteWithConflicts = (destinationId, resolve, options) =>
    pasteWithConflicts(destinationId, resolve, {
      ...options,
      onProgress: (progress) => {
        options.onProgress(progress);
        s.document.querySelector(".xp-dialog .dlg-buttons button").click();
      },
    });
  try {
    paste();
    await settle(() => !s.document.querySelector(".xp-dialog"));
  } finally {
    ops.pasteWithConflicts = pasteWithConflicts;
  }
  expect(fs.getChildren(destination.id)).toHaveLength(4);

  ops.copy(files.map((file) => file.id));
  ops.pasteWithConflicts = async () => {
    throw new Error("");
  };
  const originalError = s.window.console.error;
  s.window.console.error = () => {};
  try {
    paste();
    await settle(() =>
      dialogText(s).includes("The file operation could not be completed."),
    );
  } finally {
    ops.pasteWithConflicts = pasteWithConflicts;
    s.window.console.error = originalError;
  }
});

async function dropSetup() {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const parent = fs.createFolder(fs.MY_DOCUMENTS, "Imports");
  const target = fs.createFolder(parent.id, "Destination");
  fs.open(parent.id);
  await flushShell();
  const element = () =>
    s.document.querySelector(`.explorer-item[data-node-id="${target.id}"]`);
  const drag = (type, dataTransfer) => {
    const event = new s.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    element().dispatchEvent(event);
    return event;
  };
  const file = (name, text = "contents", type = "text/plain") =>
    new s.window.File([text], name, { type });
  return { s, fs, target, element, drag, file };
}

test("drops accept plain file lists and ignore unsupported entries", async () => {
  const h = await dropSetup();
  h.drag("drop", {
    getData: () => "",
    items: [
      { webkitGetAsEntry: () => ({ isFile: false, isDirectory: false }) },
    ],
  });
  await settle(() => !h.s.document.querySelector(".xp-dialog"));
  h.drag("drop", { getData: () => "", files: [h.file("plain.txt", "plain")] });
  await settle(() => h.fs.findChild(h.target.id, "plain.txt"));
  expect(h.fs.findChild(h.target.id, "plain.txt").content).toBe("plain");
  h.drag("drop", { getData: () => "" });
  await settle(() => !h.s.document.querySelector(".xp-dialog"));
});

test("drag-over highlights only droppable content", async () => {
  const h = await dropSetup();
  expect(h.drag("dragover", {}).defaultPrevented).toBeFalse();
  expect(
    h.drag("dragover", { types: ["application/x-astro-vfs-ids"] })
      .defaultPrevented,
  ).toBeTrue();
  // Like a browser, a drag of files from the computer shows that it has
  // files, but not the files, until the drop.
  expect(
    h.drag("dragover", { types: ["Files"], files: [] }).defaultPrevented,
  ).toBe(true);
  h.element().dispatchEvent(new h.s.window.Event("dragleave"));
  expect(h.element().classList.contains("drop-target")).toBeFalse();
});

test("cancelling an import stops remaining files and folders", async () => {
  const h = await dropSetup();
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  const cancel = () =>
    h.s.document.querySelector(".xp-dialog .dlg-buttons button").click();
  h.drag("drop", {
    getData: () => "",
    items: [
      {
        webkitGetAsEntry: () => ({
          isFile: true,
          file: async (ok) => {
            await blocked;
            ok(h.file("late.txt"));
          },
        }),
      },
      {
        webkitGetAsEntry: () => ({
          isDirectory: true,
          name: "Skipped",
          createReader: () => ({ readEntries: (ok) => ok([]) }),
        }),
      },
    ],
  });
  await flushShell();
  cancel();
  release();
  await settle(() => !h.s.document.querySelector(".xp-dialog"));
  expect(h.fs.getChildren(h.target.id)).toEqual([]);

  let releaseFolder;
  const folderBlocked = new Promise((resolve) => (releaseFolder = resolve));
  h.drag("drop", {
    getData: () => "",
    items: [
      {
        webkitGetAsEntry: () => ({
          isDirectory: true,
          name: "Partial",
          createReader: () => {
            let read = false;
            return {
              readEntries: async (ok) => {
                await folderBlocked;
                ok(
                  read
                    ? []
                    : [
                        {
                          isFile: true,
                          file: (done) => done(h.file("inner.txt")),
                        },
                      ],
                );
                read = true;
              },
            };
          },
        }),
      },
    ],
  });
  // Like XP, nothing is made while the files are read, so Cancel on the
  // Copying box leaves the folder empty.
  await settle(() => h.s.document.querySelector(".xp-dialog"));
  expect(h.fs.findChild(h.target.id, "Partial")).toBeNull();
  cancel();
  releaseFolder();
  await settle(() => !h.s.document.querySelector(".xp-dialog"));
  expect(h.fs.findChild(h.target.id, "Partial")).toBeNull();
});

test("import failures report their error and default messages", async () => {
  const h = await dropSetup();
  h.drag("drop", {
    getData: () => "",
    files: [h.file("bad?name.txt")],
  });
  await settle(() =>
    dialogText(h.s).includes(
      "A file name cannot contain any of the following characters",
    ),
  );
  await answer(h.s, "ok");
  h.drag("drop", {
    getData: () => {
      throw new Error("");
    },
  });
  await settle(() =>
    dialogText(h.s).includes("The dropped files could not be imported."),
  );
});

test("folder drops skip entries that are neither files nor folders", async () => {
  const h = await dropSetup();
  let read = false;
  h.drag("drop", {
    getData: () => "",
    items: [
      {
        webkitGetAsEntry: () => ({
          isDirectory: true,
          name: "Mixed",
          createReader: () => ({
            readEntries: (ok) => {
              const first = !read;
              read = true;
              ok(
                first
                  ? [
                      { isFile: false, isDirectory: false, name: "odd" },
                      {
                        isFile: true,
                        file: (done) => done(h.file("kept.txt")),
                      },
                    ]
                  : [],
              );
            },
          }),
        }),
      },
    ],
  });
  await settle(() => !h.s.document.querySelector(".xp-dialog"));
  const folder = h.fs.findChild(h.target.id, "Mixed");
  expect(h.fs.getChildren(folder.id).map(({ name }) => name)).toEqual([
    "kept.txt",
  ]);
});

// Like XP, the import reads every file before it makes the first one, so
// Cancel while a file is read imports none of them.
test("cancelling a plain file drop imports none of the files", async () => {
  const h = await dropSetup();
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  // The first file reads until the test releases it. Cancel comes first,
  // so the second file is never read.
  const first = h.file("first.txt");
  let reading = false;
  first.text = () => {
    reading = true;
    return blocked.then(() => "late");
  };
  const second = h.file("second.txt");
  let secondRead = false;
  second.text = async () => {
    secondRead = true;
    return "second";
  };
  h.drag("drop", {
    getData: () => "",
    files: [first, second],
  });
  // Cancel comes while the first file is read, after every question.
  await settle(() => reading);
  expect(dialogText(h.s)).toContain("Copying...");
  h.s.document.querySelector(".xp-dialog .dlg-buttons button").click();
  release();
  await settle(() => !h.s.document.querySelector(".xp-dialog"));
  expect(h.fs.getChildren(h.target.id)).toEqual([]);
  expect(secondRead).toBeFalse();
});

test("shell shortcuts wait while a replace question is open, and Escape cancels the paste", async () => {
  const s = await login(await loadShell()),
    fs = s.window.VirtualFS,
    ops = s.window.FileOperations;
  const source = fs.createFolder(fs.MY_DOCUMENTS, "Source");
  const destination = fs.createFolder(fs.MY_DOCUMENTS, "Destination");
  const file = fs.createFile(source.id, "same.txt", { content: "new" });
  fs.createFile(destination.id, "same.txt", { content: "old" });
  fs.open(destination.id);
  await flushShell();
  const surface = s.document.querySelector(
    '.xp-window[data-game="__my-documents"] .explorer-items',
  );
  const paste = () => {
    surface.focus();
    surface.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  ops.copy([file.id]);
  paste();
  await settle(() =>
    dialogText(s).includes(
      "This folder already contains a file named 'same.txt'.",
    ),
  );
  paste();
  await flushShell();
  expect(s.document.querySelectorAll(".xp-dialog")).toHaveLength(1);
  s.document.activeElement.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await settle(() => !s.document.querySelector(".xp-dialog"));
  expect(fs.getChildren(destination.id).map(({ content }) => content)).toEqual([
    "old",
  ]);
});

test("Empty Recycle Bin is unavailable while the bin is already empty", async () => {
  const s = await login(await loadShell());
  s.document
    .querySelector('[data-desktop-id="__recycle-bin"]')
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  await flushShell();
  const win = s.document.querySelector('.xp-window[data-game="__recycle-bin"]');
  // XP hides the Recycle Bin tasks while the bin is empty.
  expect(
    win.querySelector(".explorer-sidebar > section:first-child").hidden,
  ).toBeTrue();
  s.document.querySelector('[data-desktop-id="__recycle-bin"]').dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(
    s.document.querySelector(
      '#desktop-context-menu [data-action="empty-recycle-bin"]',
    ).disabled,
  ).toBeTrue();
});

test("folder drops with invalid names report the error without creating anything", async () => {
  const h = await dropSetup();
  h.drag("drop", {
    getData: () => "",
    items: [
      {
        webkitGetAsEntry: () => ({
          isDirectory: true,
          name: "bad?folder",
          createReader: () => ({ readEntries: (ok) => ok([]) }),
        }),
      },
    ],
  });
  await settle(() =>
    dialogText(h.s).includes(
      "A file name cannot contain any of the following characters",
    ),
  );
  expect(h.fs.getChildren(h.target.id)).toEqual([]);
});
