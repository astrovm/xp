// @ts-nocheck -- XP's rules for every text box: Ctrl+A and dropped text.
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
const ctrlA = (s, element, init = { ctrlKey: true }) => {
  const event = new s.window.KeyboardEvent("keydown", {
    key: "a",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  element.dispatchEvent(event);
  return event.defaultPrevented;
};
// A drag event with the data of a drag. Happy DOM keeps no dataTransfer,
// so the test gives one.
const drag = (s, element, type, data) => {
  const types = Object.keys(data);
  const transfer = {
    types,
    dropEffect: "move",
    getData: (format) => data[format] ?? "",
  };
  const event = new s.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  element.dispatchEvent(event);
  return { taken: event.defaultPrevented, effect: transfer.dropEffect };
};
const openDocuments = async (s) => {
  clickStartAction(s, "documents");
  await settle();
  return s.document.querySelector('.xp-window[data-game="__my-documents"]');
};

test("Ctrl+A selects all in no one-line box of the shell, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Alpha");
  const win = await openDocuments(s);
  const address = win.querySelector(".explorer-address input");
  expect(ctrlA(s, address)).toBeTrue();
  expect(ctrlA(s, address, { metaKey: true })).toBeTrue();
  // The rename box of an Explorer item.
  const item = win.querySelector(`.explorer-item[data-node-id="${folder.id}"]`);
  item.dispatchEvent(new s.window.MouseEvent("contextmenu", { bubbles: true }));
  win.querySelector('.explorer-context-menu [data-command="rename"]').click();
  await settle();
  const rename = win.querySelector(".explorer-rename");
  expect(ctrlA(s, rename)).toBeTrue();
  // Every type of one-line box, a number box too, such as the boxes of
  // Paint's Attributes and Minesweeper's Custom Field.
  for (const type of [
    "text",
    "search",
    "url",
    "tel",
    "email",
    "password",
    "number",
  ]) {
    const box = s.document.createElement("input");
    box.type = type;
    s.document.body.append(box);
    expect(ctrlA(s, box)).toBeTrue();
    box.remove();
  }
  // Like Windows, Ctrl+A is the A of the layout: the key of its place on
  // the keyboard for a layout of another script, such as Russian or Greek.
  for (const [key, code, taken] of [
    ["ф", "KeyA", true],
    ["α", "KeyA", true],
    ["A", "KeyA", true],
    // AZERTY has A where QWERTY has Q, and Q where QWERTY has A.
    ["a", "KeyQ", true],
    ["q", "KeyA", false],
  ])
    expect(ctrlA(s, address, { ctrlKey: true, key, code })).toBe(taken);
  // A multi-line box, such as Notepad's, keeps Ctrl+A. So do Ctrl+Alt+A,
  // A alone, and a control that is not a text box.
  const area = s.document.createElement("textarea");
  const check = s.document.createElement("input");
  check.type = "checkbox";
  s.document.body.append(area, check);
  expect(ctrlA(s, area)).toBeFalse();
  expect(ctrlA(s, check)).toBeFalse();
  expect(ctrlA(s, address, { ctrlKey: true, altKey: true })).toBeFalse();
  expect(ctrlA(s, address, {})).toBeFalse();
});

test("no text box takes dropped text, like XP, but the Run dialog does", async () => {
  const s = await login(await loadShell());
  const win = await openDocuments(s);
  const address = win.querySelector(".explorer-address input");
  const area = s.document.createElement("textarea");
  const editable = s.document.createElement("div");
  editable.contentEditable = "true";
  s.document.body.append(area, editable);
  const text = { "text/plain": "dropped" };
  for (const target of [address, area, editable]) {
    for (const type of ["dragenter", "dragover"])
      expect(drag(s, target, type, text)).toEqual({
        taken: true,
        effect: "none",
      });
    expect(drag(s, target, "drop", text).taken).toBeTrue();
  }
  expect(address.value.includes("dropped")).toBeFalse();
  // A file from the computer is not text. No folder takes it here, so the
  // page refuses it. A drop of text on what is not a text box is left to
  // the page.
  expect(drag(s, area, "dragover", { Files: "" })).toEqual({
    taken: true,
    effect: "none",
  });
  expect(drag(s, s.document.body, "dragover", text).taken).toBeFalse();
  // An event with no drag data, such as one that a script sends, too.
  const bare = new s.window.Event("dragover", {
    bubbles: true,
    cancelable: true,
  });
  area.dispatchEvent(bare);
  expect(bare.defaultPrevented).toBeFalse();

  // The Run dialog takes text anywhere on it. The text goes at the end of
  // the Open box, after a space, and only its first line.
  clickStartAction(s, "run");
  const run = s.document.querySelector(".run-dialog");
  const input = run.querySelector(".run-command");
  input.value = "";
  expect(drag(s, input, "dragover", text)).toEqual({
    taken: true,
    effect: "copy",
  });
  expect(drag(s, input, "drop", { "text/plain": "notepad" }).taken).toBe(true);
  expect(input.value).toBe("notepad");
  const intro = run.querySelector(".run-dialog-intro");
  expect(drag(s, intro, "dragenter", text).effect).toBe("copy");
  drag(s, intro, "drop", { "text/plain": "C:\\a b.txt\r\nmore" });
  expect(input.value).toBe("notepad C:\\a b.txt");
  expect(s.document.activeElement === input).toBeTrue();
  expect([input.selectionStart, input.selectionEnd]).toEqual([18, 18]);
  // A file from the computer has no path here, so Run refuses it. A drag
  // with an empty text changes nothing.
  expect(drag(s, intro, "dragover", { Files: "" }).effect).toBe("none");
  expect(drag(s, intro, "drop", { Files: "" }).effect).toBe("none");
  drag(s, intro, "drop", { "text/plain": "" });
  const scripted = new s.window.Event("dragover", {
    bubbles: true,
    cancelable: true,
  });
  intro.dispatchEvent(scripted);
  expect(scripted.defaultPrevented).toBeFalse();
  expect(input.value).toBe("notepad C:\\a b.txt");
});

test("the Run dialog takes dragged items as paths, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const spaced = fs.createFile(fs.DESKTOP, "a b.txt", { content: "spaced" });
  const plain = fs.createFile(fs.DRIVE_C, "plain.txt");
  await flushShell();
  clickStartAction(s, "run");
  const run = s.document.querySelector(".run-dialog");
  const input = run.querySelector(".run-command");
  // Run is modeless, like XP, so an item can come from a window or the
  // desktop. Task Manager's New Task stays modal.
  expect(run.getAttribute("aria-modal")).toBe("false");
  const inputs = [];
  input.addEventListener("input", () => inputs.push(input.value));
  input.value = "";
  // Items from an Explorer window keep the move effect of their drag, so
  // the drop comes.
  const items = (ids) => ({
    "application/x-astro-vfs-ids": JSON.stringify(ids),
  });
  expect(drag(s, input, "dragover", items([plain.id]))).toEqual({
    taken: true,
    effect: "move",
  });
  expect(drag(s, input, "drop", items([plain.id])).taken).toBeTrue();
  const plainPath = fs.getPath(plain.id);
  expect(input.value).toBe(plainPath);
  // A path with a space gets quotes. Items that are gone give nothing.
  drag(s, input, "drop", items([spaced.id, "missing"]));
  const spacedPath = `"${fs.getPath(spaced.id)}"`;
  expect(input.value).toBe(`${plainPath} ${spacedPath}`);
  expect(inputs).toEqual([plainPath, `${plainPath} ${spacedPath}`]);
  // A bad item list changes nothing.
  drag(s, input, "drop", { "application/x-astro-vfs-ids": "{" });
  drag(s, input, "drop", { "application/x-astro-vfs-ids": "{}" });
  expect(input.value).toBe(`${plainPath} ${spacedPath}`);

  // A desktop icon dragged onto the dialog gives its path. The item stays
  // on the Desktop.
  input.value = "";
  const icon = s.document.querySelector(
    `.desktop-icon[data-desktop-id="${spaced.id}"]`,
  );
  s.document.elementsFromPoint = () => [run.querySelector(".run-dialog-intro")];
  [
    ["pointerdown", 10],
    ["pointermove", 190],
    ["pointerup", 190],
  ].forEach(([type, at]) =>
    icon.dispatchEvent(
      new s.window.PointerEvent(type, {
        button: 0,
        pointerId: 1,
        clientX: at,
        clientY: at,
        bubbles: true,
      }),
    ),
  );
  await settle();
  expect(input.value).toBe(spacedPath);
  expect(fs.getNode(spaced.id).parent).toBe(fs.DESKTOP);
  expect(run.classList.contains("drop-target")).toBeFalse();
  // Run opens the quoted path.
  run.querySelector('[data-action="run"]').click();
  await settle();
  expect(s.document.querySelector(".notepad-editor").value).toBe("spaced");
});
