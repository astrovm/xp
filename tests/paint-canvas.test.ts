// @ts-nocheck -- A small pixel-backed canvas verifies the app's drawing logic without a browser GPU.
import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRequire } from "node:module";
import { createCanvasEngine } from "../site/apps/paint/canvas-engine.js";
const previousDocument = globalThis.document,
  previousImageData = globalThis.ImageData,
  previousDialogs = globalThis.XPDialogs;
// The pure key rules of the shell's dialogs, which Paint reads from
// globalThis.XPDialogs like in the page.
const dialogs = createRequire(import.meta.url)("../site/js/dialogs.js");
let w;
afterEach(() => {
  w?.close();
  globalThis.document = previousDocument;
  globalThis.ImageData = previousImageData;
  globalThis.XPDialogs = previousDialogs;
});
function setup() {
  w = new Window();
  globalThis.document = w.document;
  globalThis.XPDialogs = dialogs;
  globalThis.ImageData = class {
    constructor(data, width, height) {
      Object.assign(this, { data, width, height });
    }
  };
  const calls = [];
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (this.context) return this.context;
    let data = new Uint8ClampedArray(this.width * this.height * 4);
    // Retain the canvas as callbacks execute with the context as their receiver.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const canvas = this;
    const ensure = () => {
      if (data.length !== canvas.width * canvas.height * 4)
        data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    };
    const c = {
      canvas,
      fillStyle: "#ffffff",
      getImageData(x, y, width, height) {
        ensure();
        const out = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row++)
          for (let col = 0; col < width; col++) {
            const index = ((y + row) * canvas.width + x + col) * 4;
            out.set(data.slice(index, index + 4), (row * width + col) * 4);
          }
        return { data: out, width, height };
      },
      putImageData(image, x, y) {
        ensure();
        for (let row = 0; row < image.height; row++)
          for (let col = 0; col < image.width; col++) {
            const offset = ((y + row) * canvas.width + x + col) * 4;
            if (offset >= 0 && offset + 4 <= data.length)
              data.set(
                image.data.slice(
                  (row * image.width + col) * 4,
                  (row * image.width + col + 1) * 4,
                ),
                offset,
              );
          }
      },
      fillRect(x, y, width, height) {
        ensure();
        calls.push(["fillRect", x, y, width, height]);
        const rgba = [
          ...this.fillStyle.match(/[a-f\d]{2}/gi).map((x) => parseInt(x, 16)),
          255,
        ];
        for (
          let row = Math.max(0, Math.floor(y));
          row < Math.min(canvas.height, y + height);
          row++
        )
          for (
            let col = Math.max(0, Math.floor(x));
            col < Math.min(canvas.width, x + width);
            col++
          )
            data.set(rgba, (row * canvas.width + col) * 4);
      },
    };
    for (const name of [
      "beginPath",
      "moveTo",
      "lineTo",
      "stroke",
      "quadraticCurveTo",
      "ellipse",
      "roundRect",
      "rect",
      "save",
      "translate",
      "scale",
      "rotate",
      "transform",
      "restore",
      "fillText",
      "drawImage",
    ])
      c[name] = (...args) => calls.push([name, ...args]);
    this.context = c;
    return c;
  };
  const frame = w.document.createElement("div"),
    canvas = w.document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 6;
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 8,
    height: 6,
  });
  frame.append(canvas);
  w.document.body.append(frame);
  const changes = [],
    positions = [];
  const engine = createCanvasEngine({
    canvas,
    frame,
    onChange: (x) => changes.push(x),
    onPosition: (x) => positions.push(x),
  });
  const pointer = (type, x, y, button = 0) =>
    canvas.dispatchEvent(
      new w.PointerEvent(type, {
        clientX: x,
        clientY: y,
        button,
        pointerId: 1,
      }),
    );
  const draw = (tool) => {
    engine.setTool(tool);
    pointer("pointerdown", 1, 1);
    pointer("pointermove", 4, 4);
    pointer("pointerup", 4, 4);
  };
  return { engine, canvas, frame, calls, changes, positions, pointer, draw };
}
test("flood fill, color picking, inversion, undo and redo preserve pixels", () => {
  const h = setup(),
    e = h.engine;
  e.reset(8, 6);
  expect(e.undo()).toBeFalse();
  expect(e.redo()).toBeFalse();
  expect(e.paste()).toBeFalse();
  expect(e.clearSelection()).toBeFalse();
  e.setColors("#ff0000", "#00ff00");
  e.setTool("fill");
  h.pointer("pointerdown", 2, 2);
  expect([...e.image.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  const count = h.changes.length;
  h.pointer("pointerdown", 2, 2);
  expect(h.changes.length).toBe(count);
  e.setTool("picker");
  h.pointer("pointerdown", 2, 2, 2);
  expect(e.colors).toEqual(["#ff0000", "#ff0000"]);
  h.pointer("pointerdown", 2, 2);
  e.invert();
  expect([...e.image.data.slice(0, 4)]).toEqual([0, 255, 255, 255]);
  expect(e.undo()).toBeTrue();
  expect([...e.image.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  expect(e.redo()).toBeTrue();
  e.fill("#010203");
  expect([...e.image.data.slice(0, 4)]).toEqual([1, 2, 3, 255]);
  e.fill();
  expect([...e.image.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
});
test("each drawing tool emits the expected canvas operation and reports changes", () => {
  const h = setup();
  h.engine.reset(8, 6);
  h.engine.setOption("lineWidth", 3);
  for (const [tool, operation] of [
    ["pencil", "lineTo"],
    ["brush", "lineTo"],
    ["eraser", "lineTo"],
    ["line", "lineTo"],
    ["curve", "quadraticCurveTo"],
    ["ellipse", "ellipse"],
    ["rounded", "roundRect"],
    ["rectangle", "rect"],
    ["airbrush", "fillRect"],
  ]) {
    h.calls.length = 0;
    const before = h.changes.length;
    h.draw(tool);
    expect(h.calls.some((c) => c[0] === operation)).toBeTrue();
    expect(h.changes.length).toBe(before + 1);
  }
  expect(h.positions.at(-1)).toEqual({ x: 4, y: 4 });
  h.engine.setTool("magnifier");
  h.pointer("pointerdown", 0, 0);
  expect(h.canvas.classList.contains("zoomed")).toBeTrue();
  h.engine.setTool("polygon");
  h.pointer("pointerdown", 1, 1);
  h.pointer("pointerdown", 5, 1);
  h.pointer("pointerdown", 5, 4);
  h.canvas.dispatchEvent(new w.MouseEvent("dblclick"));
  expect(h.calls.at(-1)[0]).toBe("stroke");
  h.engine.destroy();
  const before = h.changes.length;
  h.draw("pencil");
  expect(h.changes.length).toBe(before);
});
test("selection can move, copy, cut, paste transparently and clear", () => {
  const h = setup(),
    e = h.engine;
  e.reset(8, 6);
  e.fill("#abcdef");
  h.draw("rect-select");
  expect(h.frame.querySelector(".paint-selection").style.width).toBe("3px");
  h.pointer("pointerdown", 2, 2);
  h.pointer("pointermove", 3, 3);
  h.pointer("pointerup", 3, 3);
  expect(h.frame.querySelector(".paint-selection").style.left).toBe("2px");
  e.copy(true);
  expect(e.paste()).toBeTrue();
  expect(h.frame.querySelector(".paint-selection").style.left).toBe("0px");
  e.setOption("opaque", 0);
  e.setColors("#000000", "#abcdef");
  expect(e.paste()).toBeTrue();
  expect(h.calls.at(-1)[0]).toBe("drawImage");
  expect(e.clearSelection()).toBeTrue();
  expect(h.frame.querySelector(".paint-selection")).toBeNull();
  e.selectAll();
  expect(h.frame.querySelector(".paint-selection").style.width).toBe("8px");
  e.reset(8, 6);
  e.copy();
  expect(e.paste()).toBeTrue();
});
test("text commits on keyboard confirmation and can be canceled", () => {
  const h = setup();
  h.engine.setTool("text");
  // The press keeps the keys in the new box, so the browser cannot move
  // them to the picture.
  const press = new w.PointerEvent("pointerdown", {
    clientX: 1,
    clientY: 2,
    button: 0,
    pointerId: 1,
    cancelable: true,
  });
  h.canvas.dispatchEvent(press);
  expect(press.defaultPrevented).toBeTrue();
  let editor = h.frame.querySelector("textarea");
  editor.value = "one\ntwo";
  // The Enter and Esc that end an input method composition stay in the
  // text.
  for (const init of [
    { key: "Enter", ctrlKey: true, isComposing: true },
    { key: "Escape", keyCode: 229 },
  ])
    editor.dispatchEvent(new w.KeyboardEvent("keydown", init));
  expect(editor.isConnected).toBeTrue();
  expect(h.calls.some((c) => c[0] === "fillText")).toBeFalse();
  editor.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
  );
  expect(h.calls.filter((c) => c[0] === "fillText")).toEqual([
    ["fillText", "one", 1, 2],
    ["fillText", "two", 1, 18],
  ]);
  expect(h.frame.querySelector("textarea")).toBeNull();
  h.pointer("pointerdown", 1, 1);
  editor = h.frame.querySelector("textarea");
  // Ctrl+Esc and Alt+Esc belong to the shell and keep the text.
  editor.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "Escape", ctrlKey: true }),
  );
  editor.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "Escape", altKey: true }),
  );
  expect(editor.isConnected).toBeTrue();
  h.canvas.tabIndex = 0;
  editor.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.frame.querySelector("textarea")).toBeNull();
  // Esc gives the keys back to the picture.
  expect(w.document.activeElement === h.canvas).toBeTrue();
  h.pointer("pointerdown", 1, 1);
  h.frame.querySelector("textarea").blur();
  expect(h.frame.querySelector("textarea")).toBeNull();
});
test("resize, transforms and replacement maintain image dimensions and history", () => {
  const h = setup(),
    e = h.engine;
  e.reset(8, 6);
  e.resize(10, 12);
  expect([h.canvas.width, h.canvas.height]).toEqual([10, 12]);
  expect(e.undo()).toBeTrue();
  expect([h.canvas.width, h.canvas.height]).toEqual([8, 6]);
  for (const operation of ["horizontal", "vertical"]) {
    e.transform({ operation });
    expect(h.calls.some((c) => c[0] === "scale")).toBeTrue();
  }
  e.transform({ operation: "rotate", angle: 90 });
  expect([h.canvas.width, h.canvas.height]).toEqual([6, 8]);
  e.transform({ operation: "rotate", angle: 180 });
  expect([h.canvas.width, h.canvas.height]).toEqual([6, 8]);
  e.transform({
    horizontalStretch: 200,
    verticalStretch: 50,
    horizontalSkew: 5,
    verticalSkew: 3,
  });
  expect([h.canvas.width, h.canvas.height]).toEqual([12, 4]);
  expect(h.calls.some((c) => c[0] === "transform")).toBeTrue();
  e.replace({
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
  });
  expect(e.undo()).toBeFalse();
  expect([...e.image.data]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
});
test("ignores extra mouse buttons, stray releases and double-clicks outside a polygon", () => {
  const h = setup();
  h.engine.reset(8, 6);
  h.engine.setTool("pencil");
  const before = h.changes.length;
  h.calls.length = 0;
  h.pointer("pointerdown", 1, 1, 3);
  h.pointer("pointermove", 4, 4, 3);
  h.pointer("pointerup", 4, 4, 3);
  h.pointer("pointerup", 2, 2);
  h.canvas.dispatchEvent(new w.MouseEvent("dblclick"));
  h.engine.setTool("polygon");
  h.pointer("pointerdown", 1, 1);
  h.canvas.dispatchEvent(new w.MouseEvent("dblclick"));
  expect(h.changes.length).toBe(before);
  expect(h.calls.filter((c) => c[0] === "lineTo")).toEqual([]);
});
test("stretching skews only along the axes that are given an angle", () => {
  const h = setup(),
    e = h.engine;
  e.reset(8, 6);
  const transforms = () => h.calls.filter((c) => c[0] === "transform");
  e.transform({ horizontalStretch: 100, verticalStretch: 100 });
  expect(transforms()).toEqual([]);
  e.transform({
    horizontalStretch: 100,
    verticalStretch: 100,
    horizontalSkew: 0,
    verticalSkew: 45,
  });
  expect(transforms()).toHaveLength(1);
  const [, a, b, c, d] = transforms()[0];
  expect([a, c, d]).toEqual([1, 0, 1]);
  expect(b).toBeCloseTo(1);
});
