// @ts-nocheck -- Exercise Paint's real menus and dialogs with browser/storage boundaries.
import { afterEach, expect, test } from "bun:test";
import { cleanupShells, loadShell, flushShell } from "./helpers/shell-harness";
afterEach(cleanupShells);
async function setup() {
  const s = await loadShell(),
    titles = [],
    messages = [],
    writes = [],
    wallpapers = [],
    saveOptions = [];
  const getContext = s.window.HTMLCanvasElement.prototype.getContext;
  s.window.HTMLCanvasElement.prototype.getContext = function (...args) {
    const context = getContext.apply(this, args);
    for (const method of [
      "save",
      "restore",
      "translate",
      "rotate",
      "scale",
      "transform",
    ])
      context[method] = () => {};
    return context;
  };
  const createElement = s.document.createElement.bind(s.document);
  s.document.createElement = (name, ...args) => {
    const element = createElement(name, ...args);
    if (name === "img")
      Object.defineProperty(element, "src", {
        set(value) {
          Object.defineProperties(element, {
            naturalWidth: { value: 8 },
            naturalHeight: { value: 6 },
          });
          queueMicrotask(() =>
            element.dispatchEvent(
              new s.window.Event(value === "invalid" ? "error" : "load"),
            ),
          );
        },
      });
    return element;
  };
  const context = {
    dialogs: s.window.XPDialogs,
    myPictures: "pictures",
    pictureUrl: (file) => file.content || null,
    setTitle: (title) => titles.push(title),
    showMessage: (...args) => messages.push(args),
    close: () => messages.push(["close"]),
    setWallpaper: (value) => wallpapers.push(value),
    saveFile: async (options) => {
      saveOptions.push(options);
      return { parentId: "pictures", name: "drawing.bmp" };
    },
    openFile: async () => ({
      id: "opened",
      name: "image.png",
      content: "image-data",
    }),
    createFile: async (...args) => {
      writes.push(args);
      return { id: "saved", name: args[1] };
    },
    setFileContent: async (...args) => {
      writes.push(args);
      return { id: args[0], name: "drawing.bmp" };
    },
  };
  const mounted = s.window.XPApplicationRegistry.get("__paint").loaded.mount(
    context,
    {},
  );
  const root = mounted.element;
  s.document.body.append(root);
  const command = async (name) => {
    root.querySelector(`[data-paint-command="${name}"]`).click();
    await flushShell();
  };
  const answer = async (id) => {
    s.document.querySelector(`.xp-dialog [data-action="${id}"]`).click();
    await flushShell();
  };
  const key = async (key, ctrlKey = false) => {
    const event = new s.window.KeyboardEvent("keydown", {
      key,
      ctrlKey,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(event);
    await flushShell();
    return event.defaultPrevented;
  };
  return {
    s,
    root,
    mounted,
    context,
    titles,
    messages,
    writes,
    wallpapers,
    saveOptions,
    command,
    answer,
    key,
    canvas: root.querySelector("canvas"),
  };
}
test("Paint saves new and existing pictures, protects unsaved edits and reports failed writes", async () => {
  const h = await setup();
  expect(await h.mounted.beforeClose()).toBeTrue();
  expect(
    h.root.querySelector('[data-paint-command="wallpaper-tiled"]').disabled,
  ).toBeTrue();
  await h.command("clear-image");
  const canceled = h.mounted.beforeClose();
  await h.answer("cancel");
  expect(await canceled).toBeFalse();
  const discarded = h.mounted.beforeClose();
  await h.answer("no");
  expect(await discarded).toBeTrue();
  const saved = h.mounted.beforeClose();
  await h.answer("yes");
  expect(await saved).toBeTrue();
  expect(h.writes[0].slice(0, 2)).toEqual(["pictures", "drawing.bmp"]);
  // Save As lists the types Paint writes, with no All Files, and the
  // dialog adds .bmp to other names.
  expect(h.saveOptions[0]).toMatchObject({
    defaultName: "untitled",
    filter: [".bmp", ".dib", ".jpg", ".jpeg", ".png"],
    defaultExtension: ".bmp",
    allFiles: false,
  });
  expect(h.writes[0][2]).toStartWith("data:image/bmp;base64,Qk");
  expect(h.titles.at(-1)).toBe("drawing.bmp - Paint");
  await h.command("save");
  expect(h.writes[1][2]).toEqual({ expectedContent: h.writes[0][2] });
  await h.command("wallpaper-tiled");
  await h.command("wallpaper-centered");
  expect(h.wallpapers).toEqual([
    "data:image/png;base64,",
    "data:image/png;base64,",
  ]);
  h.context.saveFile = async () => null;
  await h.command("save-as");
  expect(h.writes.length).toBe(2);
  h.context.saveFile = async () => ({ existingId: "other", name: "other.png" });
  await h.command("save-as");
  expect(h.writes[2][2]).toEqual({ expectedContent: undefined });
  h.context.setFileContent = async () => {
    throw new Error("Document changed elsewhere");
  };
  await h.command("save");
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "Document changed elsewhere",
  );
  await h.answer("ok");
  h.context.setFileContent = async () => {
    throw {};
  };
  await h.command("save");
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "The picture could not be saved.",
  );
  await h.answer("ok");
  h.mounted.unmount();
});
test("Paint does not close after new edits arrive while a save is pending", async () => {
  const h = await setup();
  let finish;
  h.context.createFile = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await h.command("clear-image");
  const closing = h.mounted.beforeClose();
  await h.answer("yes");
  await h.command("invert");
  finish({ id: "saved", name: "drawing.bmp" });
  expect(await closing).toBeFalse();
  const again = h.mounted.beforeClose();
  await h.answer("cancel");
  expect(await again).toBeFalse();
});
test("Paint opens valid images, rejects damaged files and respects canceled replacement", async () => {
  const h = await setup();
  await h.command("open");
  expect([h.canvas.width, h.canvas.height]).toEqual([8, 6]);
  expect(h.titles.at(-1)).toBe("image.png - Paint");
  await h.command("clear-image");
  const rejected = h.mounted.openFile({
    id: "another",
    name: "other.png",
    content: "data",
  });
  await h.answer("cancel");
  expect(await rejected).toBeFalse();
  await h.command("new");
  await h.answer("cancel");
  expect(h.titles.at(-1)).toBe("image.png - Paint");
  await h.command("open");
  await h.answer("cancel");
  expect(h.titles.at(-1)).toBe("image.png - Paint");
  await h.command("new");
  await h.answer("no");
  expect(h.titles.at(-1)).toBe("untitled - Paint");
  expect([h.canvas.width, h.canvas.height]).toEqual([516, 384]);
  h.context.openFile = async () => null;
  await h.command("open");
  await h.mounted.openFile({ content: "invalid" });
  expect(h.messages.at(-1)[1]).toContain("Paint cannot read this file");
  // A file without picture data never reaches the image loader.
  h.messages.length = 0;
  await h.mounted.openFile({ id: "empty", name: "empty.png", content: "" });
  expect(h.messages.at(-1)[1]).toContain("Paint cannot read this file");
  await h.mounted.openFile({ id: "other", name: "other.bmp", content: "data" });
  expect(h.titles.at(-1)).toBe("other.bmp - Paint");
  // Browsers cannot write GIF, so Save asks for a new name and type.
  await h.mounted.openFile({ id: "anim", name: "anim.gif", content: "data" });
  const saves = [];
  h.context.saveFile = async (options) => {
    saves.push(options);
    return null;
  };
  await h.command("save");
  expect(saves).toEqual([expect.objectContaining({ defaultName: "anim" })]);
});
test("Paint tools, palette, menu checks and keyboard controls stay synchronized", async () => {
  const h = await setup();
  for (const [tool, count] of [
    ["eraser", 4],
    ["airbrush", 3],
    ["brush", 4],
    ["pencil", 0],
  ]) {
    h.root.querySelector(`.paint-tool[data-tool="${tool}"]`).click();
    const options = h.root.querySelectorAll(".paint-tool-option");
    expect(options.length).toBe(count);
    if (count) {
      options[count - 1].click();
      expect(options[count - 1].classList.contains("selected")).toBeTrue();
    }
    expect(h.root.querySelector(".paint-tool.selected").dataset.tool).toBe(
      tool,
    );
  }
  const swatch = h.root.querySelector('.paint-swatch[title="#ff0000"]');
  swatch.click();
  swatch.dispatchEvent(
    new h.s.window.MouseEvent("contextmenu", { cancelable: true }),
  );
  const current = h.root.querySelector(".paint-current-colors");
  expect(current.style.getPropertyValue("--paint-primary")).toBe("#ff0000");
  expect(current.style.getPropertyValue("--paint-secondary")).toBe("#ff0000");
  h.root.querySelector('.paint-tool[data-tool="picker"]').click();
  h.canvas.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", {
      button: 0,
      clientX: 1,
      clientY: 1,
    }),
  );
  expect(current.style.getPropertyValue("--paint-primary")).toBe("#000000");
  expect(current.style.getPropertyValue("--paint-secondary")).toBe("#ff0000");
  h.canvas.dispatchEvent(
    new h.s.window.PointerEvent("pointermove", { clientX: 2, clientY: 3 }),
  );
  expect(h.root.querySelector("[data-paint-position]").textContent).toContain(
    "px",
  );
  for (const panel of ["toolbox", "colorbox", "status"]) {
    await h.command(panel);
    expect(
      h.root.querySelector(`[data-paint-panel="${panel}"]`).hidden,
    ).toBeTrue();
    await h.command(panel);
    expect(
      h.root.querySelector(`[data-paint-command="${panel}"] .paint-menu-check`)
        .textContent,
    ).toBe("✓");
  }
  await h.command("opaque");
  expect(
    h.root.querySelector('[data-paint-command="opaque"] .paint-menu-check')
      .textContent,
  ).toBe("");
  await h.command("opaque");
  expect(await h.key("t", true)).toBeTrue();
  expect(
    h.root.querySelector('[data-paint-panel="toolbox"]').hidden,
  ).toBeTrue();
  await h.key("l", true);
  expect(
    h.root.querySelector('[data-paint-panel="colorbox"]').hidden,
  ).toBeTrue();
  await h.key("f", true);
  expect(h.root.classList.contains("paint-bitmap-view")).toBeTrue();
  await h.command("view-bitmap");
  expect(h.root.classList.contains("paint-bitmap-view")).toBeFalse();
  expect(await h.key("q", true)).toBeFalse();
  expect(await h.key("q")).toBeFalse();
  await h.command("select-all");
  expect(h.s.document.activeElement === h.canvas).toBeTrue();
  for (const command of ["copy", "cut", "paste", "clear", "undo", "redo"])
    await h.command(command);
  expect(await h.key("F4")).toBeTrue();
  expect(await h.key("Delete")).toBeTrue();
  const menu = h.root.querySelector(".paint-menu-group > button");
  menu.click();
  expect(h.root.querySelector(".paint-menu").hidden).toBeFalse();
  menu.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(h.root.querySelector(".paint-menu").hidden).toBeFalse();
  menu.click();
  expect(h.root.querySelector(".paint-menu").hidden).toBeTrue();
  menu.click();
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(h.root.querySelector(".paint-menu").hidden).toBeTrue();
  await h.command("help");
  expect(h.messages.at(-1)[0]).toBe("Paint Help");
  await h.command("about");
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "About Paint",
  );
  await h.answer("ok");
  await h.command("exit");
  expect(h.messages.at(-1)).toEqual(["close"]);
});
test("Paint accepts and cancels attributes, transformations and custom color dialogs", async () => {
  const h = await setup();
  await h.command("attributes");
  h.s.document.querySelector('[name="width"]').value = "20";
  h.s.document.querySelector('[name="height"]').value = "10";
  await h.answer("ok");
  expect([h.canvas.width, h.canvas.height]).toEqual([20, 10]);
  await h.command("flip");
  h.s.document.querySelector('[value="rotate"]').click();
  await h.answer("ok");
  expect([h.canvas.width, h.canvas.height]).toEqual([10, 20]);
  await h.command("stretch");
  const numbers = h.s.document.querySelectorAll(
    '.paint-transform-dialog input[type="number"]',
  );
  numbers[0].value = "200";
  numbers[1].value = "50";
  numbers[2].value = "10";
  await h.answer("ok");
  expect([h.canvas.width, h.canvas.height]).toEqual([20, 10]);
  await h.command("edit-colors");
  const swatches = h.s.document.querySelectorAll(
    ".paint-edit-color-grid button",
  );
  swatches[0].click();
  expect(swatches[0].classList.contains("selected")).toBeTrue();
  await h.answer("ok");
  expect(
    h.root
      .querySelector(".paint-current-colors")
      .style.getPropertyValue("--paint-primary"),
  ).toBe("#ff8080");
  for (const command of ["flip", "stretch", "attributes", "edit-colors"]) {
    await h.command(command);
    await h.answer("cancel");
    expect([h.canvas.width, h.canvas.height]).toEqual([20, 10]);
    await h.command(command);
    h.s.document.querySelector(".xp-dialog .close-btn").click();
    await flushShell();
    expect(h.s.document.querySelectorAll(".xp-dialog").length).toBe(0);
  }
});
