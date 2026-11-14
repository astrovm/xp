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
  // Every type of one-line box.
  for (const type of ["text", "search", "url", "tel", "email", "password"]) {
    const box = s.document.createElement("input");
    box.type = type;
    s.document.body.append(box);
    expect(ctrlA(s, box)).toBeTrue();
    box.remove();
  }
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
  // A dropped file is left to the page, and so is a drop on what is not a
  // text box.
  expect(drag(s, area, "dragover", { Files: "" }).taken).toBeFalse();
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
  const input = run.querySelector("#run-command");
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
  // A drag with no text, and an empty text, change nothing.
  expect(drag(s, intro, "dragover", { Files: "" }).taken).toBeFalse();
  expect(drag(s, intro, "drop", { Files: "" }).taken).toBeFalse();
  drag(s, intro, "drop", { "text/plain": "" });
  const scripted = new s.window.Event("dragover", {
    bubbles: true,
    cancelable: true,
  });
  intro.dispatchEvent(scripted);
  expect(scripted.defaultPrevented).toBeFalse();
  expect(input.value).toBe("notepad C:\\a b.txt");
});
