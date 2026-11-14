// @ts-nocheck -- Browser entry callbacks and drag events are synthetic fixtures.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
} from "./helpers/shell-harness";
afterEach(cleanupShells);
const settle = async (predicate) => {
  for (let i = 0; i < 40 && !predicate(); i++) await flushShell();
  expect(Boolean(predicate())).toBeTrue();
};
async function setup() {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const parent = fs.createFolder(fs.MY_DOCUMENTS, "Imports");
  const target = fs.createFolder(parent.id, "Destination");
  fs.open(parent.id);
  await flushShell();
  const drop = (entries = [], payload = "", destination = target.id) => {
    const el = s.document.querySelector(
      `.explorer-item[data-node-id="${destination}"]`,
    );
    const event = new s.window.Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: [],
        types: ["Files"],
        getData: () => payload,
        items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
      },
    });
    el.dispatchEvent(event);
  };
  const file = (name, text = "contents", type = "text/plain") => ({
    isFile: true,
    name,
    file: (ok) => ok(new s.window.File([text], name, { type })),
  });
  const folder = (name, batches) => ({
    isDirectory: true,
    name,
    createReader: () => {
      const remaining = [...batches, []];
      return { readEntries: (ok) => ok(remaining.shift() || []) };
    },
  });
  const choose = async (action) => {
    const button = () =>
      [...s.document.querySelectorAll(".xp-dialog")]
        .filter(
          (dialog) =>
            action === "ok" || dialog.textContent.includes("already contains"),
        )
        .at(-1)
        ?.querySelector(`[data-action="${action}"]`);
    await settle(button);
    button().click();
    await flushShell();
  };
  return { s, fs, target, drop, file, folder, choose };
}
test("dropping directory entries imports all reader batches and nested text/binary files", async () => {
  const h = await setup();
  h.drop([
    h.folder("Tree", [
      [h.file("first.txt")],
      [
        h.folder("Nested", [
          [h.file("data.bin", "bytes", "application/octet-stream")],
        ]),
      ],
    ]),
  ]);
  await settle(
    () =>
      h.fs.findChild(h.fs.findChild(h.target.id, "Tree")?.id, "Nested") &&
      !h.s.document.querySelector(".xp-dialog"),
  );
  const root = h.fs.findChild(h.target.id, "Tree");
  expect(h.fs.findChild(root.id, "first.txt").content).toBe("contents");
  const nested = h.fs.findChild(root.id, "Nested");
  // Binary files keep their bytes as a data URL, like desktop uploads.
  expect(h.fs.findChild(nested.id, "data.bin")).toMatchObject({
    content: "data:application/octet-stream;base64,Ynl0ZXM=",
    size: 5,
  });
});
// XP asks with Yes, Yes to All, No and Cancel. No keeps the old item and
// goes on. Cancel keeps the old item and stops.
for (const choice of ["yes", "no", "cancel"]) {
  test(`external file conflict ${choice} preserves the chosen content`, async () => {
    const h = await setup();
    const old = h.fs.createFile(h.target.id, "duplicate.txt", {
      content: "old",
    });
    h.drop([h.file("duplicate.txt", "new"), h.file("after.txt")]);
    await h.choose(choice);
    await settle(() => !h.s.document.querySelector(".xp-dialog"));
    const children = h.fs.getChildren(h.target.id);
    if (choice === "yes") {
      expect(h.fs.getNode(old.id)).toBeNull();
      expect(h.fs.findChild(h.target.id, "duplicate.txt").content).toBe("new");
    } else {
      expect(h.fs.getNode(old.id).content).toBe("old");
      expect(children.some((node) => node.content === "new")).toBe(false);
    }
    expect(children.some((node) => node.name.includes("(2)"))).toBe(false);
    expect(Boolean(h.fs.findChild(h.target.id, "after.txt"))).toBe(
      choice !== "cancel",
    );
  });
  test(`external folder conflict ${choice} applies to the directory tree`, async () => {
    const h = await setup();
    const old = h.fs.createFolder(h.target.id, "Tree");
    const kept = h.fs.createFile(old.id, "old.txt", { content: "old" });
    h.drop([h.folder("Tree", [[h.file("new.txt")]])]);
    await h.choose(choice);
    await settle(() => !h.s.document.querySelector(".xp-dialog"));
    // A Yes puts the new items in the folder that is there.
    expect(h.fs.getChildren(h.target.id).map((node) => node.id)).toEqual([
      old.id,
    ]);
    expect(h.fs.getNode(kept.id).content).toBe("old");
    expect(Boolean(h.fs.findChild(old.id, "new.txt"))).toBe(choice === "yes");
  });
}
test("Yes to All replaces each later file without a question", async () => {
  const h = await setup();
  const old = h.fs.createFolder(h.target.id, "Tree");
  h.fs.createFile(old.id, "a.txt", { content: "old a" });
  h.fs.createFile(old.id, "b.txt", { content: "old b" });
  h.drop([
    h.folder("Tree", [[h.file("a.txt", "new a"), h.file("b.txt", "new b")]]),
  ]);
  const question = () =>
    [...h.s.document.querySelectorAll(".xp-dialog")].find((dialog) =>
      dialog.textContent.includes("already contains"),
    );
  await settle(question);
  const dialog = question();
  expect(dialog.querySelector(".title-text").textContent).toBe(
    "Confirm Folder Replace",
  );
  expect(
    [...dialog.querySelectorAll("button[data-action]")].map(
      (button) => button.textContent,
    ),
  ).toEqual(["Yes", "Yes to All", "No", "Cancel"]);
  await h.choose("all");
  await settle(() => h.fs.findChild(old.id, "b.txt")?.content === "new b");
  expect(h.fs.findChild(old.id, "a.txt").content).toBe("new a");
  expect(h.s.document.querySelector(".xp-dialog")).toBeNull();
});
test("a file cannot take the name of a folder, and a folder cannot take the name of a file", async () => {
  const h = await setup();
  h.fs.createFolder(h.target.id, "item");
  h.drop([h.file("item", "new")]);
  await settle(() =>
    h.s.document
      .querySelector(".xp-dialog")
      ?.textContent.includes(
        "Cannot copy item: A folder with the name you specified already exists.",
      ),
  );
  await h.choose("ok");
  h.fs.createFile(h.target.id, "box");
  h.drop([h.folder("box", [[h.file("inside.txt")]])]);
  await settle(() =>
    h.s.document
      .querySelector(".xp-dialog")
      ?.textContent.includes(
        "Cannot copy box: A file with the name you specified already exists.",
      ),
  );
  expect(h.fs.getChildren(h.target.id).map((node) => node.name)).toEqual([
    "item",
    "box",
  ]);
});
test("directory reader failures remove the partial import and report the error", async () => {
  const h = await setup();
  h.drop([
    {
      isDirectory: true,
      name: "Broken",
      createReader: () => ({
        readEntries: (_ok, fail) =>
          fail(new Error("Synthetic directory permission denied")),
      }),
    },
  ]);
  await settle(() =>
    h.s.document
      .querySelector(".xp-dialog")
      ?.textContent.includes("permission denied"),
  );
  expect(h.fs.findChild(h.target.id, "Broken")).toBeNull();
  await h.choose("ok");
});
test("file-read failure removes its newly created directory and reports the error", async () => {
  const h = await setup();
  h.drop([
    h.folder("Broken", [
      [
        {
          isFile: true,
          file: (_ok, fail) => fail(new Error("Synthetic file read failed")),
        },
      ],
    ]),
  ]);
  await settle(() =>
    h.s.document
      .querySelector(".xp-dialog")
      ?.textContent.includes("file read failed"),
  );
  expect(h.fs.findChild(h.target.id, "Broken")).toBeNull();
});
test("invalid internal drag data reports an error without changing destination", async () => {
  const h = await setup();
  h.drop([], '{"not":"an array"}');
  await settle(() =>
    h.s.document
      .querySelector(".xp-dialog")
      ?.textContent.includes("Invalid dropped item list"),
  );
  expect(h.fs.getChildren(h.target.id)).toEqual([]);
});
