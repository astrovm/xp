import { createPaintHistory } from "./history.js";

const copyImage = (context) =>
  context.getImageData(0, 0, context.canvas.width, context.canvas.height);

const floodFill = (context, x, y, color) => {
  const { width, height } = context.canvas;
  const image = copyImage(context);
  const px = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const py = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const start = (py * width + px) * 4;
  const target = [...image.data.slice(start, start + 4)];
  const fill = color.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
  fill.push(255);
  if (target.every((value, index) => value === fill[index])) return false;
  const stack = [[px, py]];
  while (stack.length) {
    const [nextX, nextY] = stack.pop();
    if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
    const offset = (nextY * width + nextX) * 4;
    if (target.some((value, index) => image.data[offset + index] !== value))
      continue;
    image.data.set(fill, offset);
    stack.push(
      [nextX - 1, nextY],
      [nextX + 1, nextY],
      [nextX, nextY - 1],
      [nextX, nextY + 1],
    );
  }
  context.putImageData(image, 0, 0);
  return true;
};

const drawRoundedRect = (context, x, y, width, height) => {
  const radius = Math.min(8, Math.abs(width) / 2, Math.abs(height) / 2);
  context.roundRect(x, y, width, height, radius);
};

export const createCanvasEngine = ({ canvas, frame, onChange, onPosition }) => {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const history = createPaintHistory();
  let tool = "pencil";
  let primary = "#000000";
  let secondary = "#ffffff";
  let drawing = false;
  let start = null;
  let previous = null;
  let preview = null;
  let polygon = [];
  let selection = null;
  let clipboard = null;
  let movingSelection = false;
  let selectionPixels = null;
  const settings = {
    lineWidth: 1,
    eraserSize: 10,
    sprayRadius: 7,
    opaque: true,
  };

  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * canvas.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * canvas.height),
    };
  };
  const capture = () => history.capture(copyImage(context));
  const changed = () => onChange?.();
  const restore = (image) => {
    if (!image) return false;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    context.putImageData(image, 0, 0);
    changed();
    return true;
  };
  const clearSelectionOverlay = () =>
    frame.querySelector(".paint-selection")?.remove();
  const showSelection = (x, y, width, height) => {
    clearSelectionOverlay();
    const overlay = document.createElement("div");
    overlay.className = "paint-selection";
    Object.assign(overlay.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    frame.appendChild(overlay);
  };
  const drawSelectionPixels = (pixels, x, y) => {
    if (settings.opaque) {
      context.putImageData(pixels, x, y);
      return;
    }
    const transparent = new ImageData(
      new Uint8ClampedArray(pixels.data),
      pixels.width,
      pixels.height,
    );
    const background = secondary
      .match(/[a-f\d]{2}/gi)
      .map((part) => parseInt(part, 16));
    for (let index = 0; index < transparent.data.length; index += 4) {
      if (
        transparent.data[index] === background[0] &&
        transparent.data[index + 1] === background[1] &&
        transparent.data[index + 2] === background[2]
      ) {
        transparent.data[index + 3] = 0;
      }
    }
    const buffer = document.createElement("canvas");
    buffer.width = transparent.width;
    buffer.height = transparent.height;
    buffer.getContext("2d").putImageData(transparent, 0, 0);
    context.drawImage(buffer, x, y);
  };
  const commitText = (textarea) => {
    const value = textarea.value;
    if (value) {
      capture();
      context.fillStyle = primary;
      context.font = "13px Arial";
      context.textBaseline = "top";
      value
        .split("\n")
        .forEach((line, index) =>
          context.fillText(
            line,
            Number.parseInt(textarea.style.left),
            Number.parseInt(textarea.style.top) + index * 16,
          ),
        );
      changed();
    }
    textarea.remove();
  };
  const beginText = ({ x, y }) => {
    frame.querySelector(".paint-text-editor")?.blur();
    const textarea = document.createElement("textarea");
    textarea.className = "paint-text-editor";
    textarea.setAttribute("aria-label", "Text to insert");
    Object.assign(textarea.style, { left: `${x}px`, top: `${y}px` });
    textarea.addEventListener("blur", () => commitText(textarea), {
      once: true,
    });
    textarea.addEventListener("keydown", (event) => {
      // The keys of an input method stay in the text.
      if (globalThis.XPDialogs.isComposingKey(event)) return;
      // Ctrl+Esc and Alt+Esc belong to the shell and keep the text.
      // Esc drops the text, and the picture takes the keys back.
      if (event.key === "Escape" && !event.ctrlKey && !event.altKey) {
        textarea.remove();
        canvas.focus({ preventScroll: true });
      }
      if (event.ctrlKey && event.key === "Enter") textarea.blur();
    });
    frame.appendChild(textarea);
    textarea.focus();
  };
  const drawShape = (next) => {
    context.putImageData(preview, 0, 0);
    context.beginPath();
    const width = next.x - start.x;
    const height = next.y - start.y;
    if (tool === "line") {
      context.moveTo(start.x, start.y);
      context.lineTo(next.x, next.y);
    } else if (tool === "curve") {
      context.moveTo(start.x, start.y);
      context.quadraticCurveTo(start.x, next.y, next.x, next.y);
    } else if (tool === "ellipse") {
      context.ellipse(
        (start.x + next.x) / 2,
        (start.y + next.y) / 2,
        Math.abs(width) / 2,
        Math.abs(height) / 2,
        0,
        0,
        Math.PI * 2,
      );
    } else if (tool === "rounded")
      drawRoundedRect(context, start.x, start.y, width, height);
    else context.rect(start.x, start.y, width, height);
    context.stroke();
  };
  const onPointerDown = (event) => {
    if (event.button > 2) return;
    start = point(event);
    previous = start;
    const color = event.button === 2 ? secondary : primary;
    if (
      ["select", "rect-select"].includes(tool) &&
      selection &&
      start.x >= selection.x &&
      start.x <= selection.x + selection.width &&
      start.y >= selection.y &&
      start.y <= selection.y + selection.height
    ) {
      capture();
      selectionPixels = context.getImageData(
        selection.x,
        selection.y,
        selection.width,
        selection.height,
      );
      context.fillStyle = secondary;
      context.fillRect(
        selection.x,
        selection.y,
        selection.width,
        selection.height,
      );
      preview = copyImage(context);
      movingSelection = true;
      drawing = true;
      return;
    }
    if (tool === "picker") {
      const pixel = context.getImageData(start.x, start.y, 1, 1).data;
      const picked = `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
      if (event.button === 2) secondary = picked;
      else primary = picked;
      onChange?.({ colors: [primary, secondary], dirty: false });
      return;
    }
    if (tool === "fill") {
      capture();
      if (floodFill(context, start.x, start.y, color)) changed();
      return;
    }
    if (tool === "magnifier") {
      canvas.classList.toggle("zoomed");
      return;
    }
    if (tool === "text") {
      // The press must not give the keys back to the picture, or the new
      // text box loses them at once and closes.
      event.preventDefault();
      beginText(start);
      return;
    }
    if (tool === "polygon") {
      if (!polygon.length) {
        capture();
        polygon = [start];
      } else {
        context.beginPath();
        context.moveTo(polygon.at(-1).x, polygon.at(-1).y);
        context.lineTo(start.x, start.y);
        context.stroke();
        polygon.push(start);
        changed();
      }
      return;
    }
    capture();
    preview = copyImage(context);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth =
      tool === "brush"
        ? settings.lineWidth
        : tool === "eraser"
          ? settings.eraserSize
          : settings.lineWidth;
    context.lineCap = "round";
    if (tool === "eraser") context.strokeStyle = secondary;
    drawing = true;
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    const next = point(event);
    onPosition?.(next);
    if (!drawing) return;
    if (movingSelection) {
      const x = selection.x + next.x - start.x;
      const y = selection.y + next.y - start.y;
      context.putImageData(preview, 0, 0);
      drawSelectionPixels(selectionPixels, x, y);
      showSelection(x, y, selection.width, selection.height);
    } else if (["pencil", "brush", "eraser"].includes(tool)) {
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(next.x, next.y);
      context.stroke();
      previous = next;
    } else if (tool === "airbrush") {
      for (let index = 0; index < 12; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * settings.sprayRadius;
        context.fillRect(
          next.x + Math.cos(angle) * distance,
          next.y + Math.sin(angle) * distance,
          1,
          1,
        );
      }
    } else if (["select", "rect-select"].includes(tool)) {
      context.putImageData(preview, 0, 0);
      showSelection(
        Math.min(start.x, next.x),
        Math.min(start.y, next.y),
        Math.abs(next.x - start.x),
        Math.abs(next.y - start.y),
      );
    } else drawShape(next);
  };
  const onPointerUp = (event) => {
    if (!drawing) return;
    drawing = false;
    const end = point(event);
    if (movingSelection) {
      selection.x += end.x - start.x;
      selection.y += end.y - start.y;
      movingSelection = false;
      selectionPixels = null;
      changed();
    } else if (["select", "rect-select"].includes(tool)) {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.max(1, Math.abs(end.x - start.x));
      const height = Math.max(1, Math.abs(end.y - start.y));
      selection = { x, y, width, height };
    } else changed();
  };
  const onDoubleClick = () => {
    if (tool !== "polygon" || polygon.length < 2) return;
    context.beginPath();
    context.moveTo(polygon.at(-1).x, polygon.at(-1).y);
    context.lineTo(polygon[0].x, polygon[0].y);
    context.stroke();
    polygon = [];
    changed();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("dblclick", onDoubleClick);

  return {
    setTool(value) {
      tool = value;
      polygon = [];
      clearSelectionOverlay();
    },
    setColors(first, second) {
      primary = first;
      secondary = second;
    },
    setOption(name, value) {
      settings[name] = Number(value);
    },
    get colors() {
      return [primary, secondary];
    },
    get image() {
      return copyImage(context);
    },
    replace(image) {
      canvas.width = image.width;
      canvas.height = image.height;
      context.putImageData(image, 0, 0);
      history.clear();
      clearSelectionOverlay();
    },
    reset(width, height, color = "#ffffff") {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
      history.clear();
      selection = null;
      clearSelectionOverlay();
    },
    fill(color = "#ffffff") {
      capture();
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      changed();
    },
    undo() {
      return restore(history.undo(copyImage(context)));
    },
    redo() {
      return restore(history.redo(copyImage(context)));
    },
    invert() {
      capture();
      const image = copyImage(context);
      for (let index = 0; index < image.data.length; index += 4) {
        image.data[index] = 255 - image.data[index];
        image.data[index + 1] = 255 - image.data[index + 1];
        image.data[index + 2] = 255 - image.data[index + 2];
      }
      context.putImageData(image, 0, 0);
      changed();
    },
    resize(width, height) {
      capture();
      const image = document.createElement("canvas");
      image.width = canvas.width;
      image.height = canvas.height;
      image.getContext("2d").drawImage(canvas, 0, 0);
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      changed();
    },
    transform({
      operation,
      angle,
      horizontalStretch,
      verticalStretch,
      horizontalSkew,
      verticalSkew,
    }) {
      capture();
      const source = document.createElement("canvas");
      source.width = canvas.width;
      source.height = canvas.height;
      source.getContext("2d").drawImage(canvas, 0, 0);
      let width = canvas.width;
      let height = canvas.height;
      if (operation === "rotate" && angle !== 180)
        [width, height] = [height, width];
      if (horizontalStretch != null) {
        width = Math.max(1, Math.round((width * horizontalStretch) / 100));
        height = Math.max(1, Math.round((height * verticalStretch) / 100));
      }
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.save();
      if (operation === "horizontal") {
        context.translate(width, 0);
        context.scale(-1, 1);
      } else if (operation === "vertical") {
        context.translate(0, height);
        context.scale(1, -1);
      } else if (operation === "rotate") {
        context.translate(width / 2, height / 2);
        context.rotate((angle * Math.PI) / 180);
        context.translate(-source.width / 2, -source.height / 2);
      } else if (horizontalSkew || verticalSkew) {
        context.transform(
          1,
          Math.tan((verticalSkew * Math.PI) / 180),
          Math.tan((horizontalSkew * Math.PI) / 180),
          1,
          0,
          0,
        );
      }
      context.drawImage(source, 0, 0, width, height);
      context.restore();
      changed();
    },
    copy(cut = false) {
      const area = selection || {
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
      };
      clipboard = context.getImageData(area.x, area.y, area.width, area.height);
      if (cut) {
        capture();
        context.fillStyle = secondary;
        context.fillRect(area.x, area.y, area.width, area.height);
        changed();
      }
    },
    paste() {
      if (!clipboard) return false;
      capture();
      drawSelectionPixels(clipboard, 0, 0);
      selection = {
        x: 0,
        y: 0,
        width: clipboard.width,
        height: clipboard.height,
      };
      showSelection(0, 0, clipboard.width, clipboard.height);
      changed();
      return true;
    },
    selectAll() {
      selection = { x: 0, y: 0, width: canvas.width, height: canvas.height };
      showSelection(0, 0, canvas.width, canvas.height);
    },
    clearSelection() {
      if (!selection) return false;
      capture();
      context.fillStyle = secondary;
      context.fillRect(
        selection.x,
        selection.y,
        selection.width,
        selection.height,
      );
      selection = null;
      clearSelectionOverlay();
      changed();
      return true;
    },
    destroy() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("dblclick", onDoubleClick);
    },
  };
};
