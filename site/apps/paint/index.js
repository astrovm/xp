import { applicationMetadata } from "./metadata.js";
import { defineApplication } from "../core/application.js";
import { showXPAboutDialog } from "../core/about-dialog.js";
import { wireMenuBar } from "../core/menu-bar.js";
import { createCanvasEngine } from "./canvas-engine.js";
import {
  showAttributesDialog,
  showEditColorsDialog,
  showTransformDialog,
} from "./dialogs.js";
import { encodeCanvas, extensionFor } from "./file-formats.js";
import { installPaintScrollbars } from "./scrollbars.js";

export const PAINT_COLORS = [
  "#000000",
  "#808080",
  "#800000",
  "#808000",
  "#008000",
  "#008080",
  "#000080",
  "#800080",
  "#808040",
  "#004040",
  "#0080ff",
  "#004080",
  "#8000ff",
  "#804000",
  "#ffffff",
  "#c0c0c0",
  "#ff0000",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0000ff",
  "#ff00ff",
  "#ffff80",
  "#00ff80",
  "#80ffff",
  "#8080ff",
  "#ff0080",
  "#ff8040",
];
const BASIC_COLORS = [
  "#ff8080",
  "#ffff80",
  "#80ff80",
  "#00ff80",
  "#80ffff",
  "#0080ff",
  "#ff80c0",
  "#ff80ff",
  "#ff0000",
  "#ffff00",
  "#80ff00",
  "#00ff40",
  "#00ffff",
  "#0080c0",
  "#8080c0",
  "#ff00ff",
  "#804040",
  "#ff8040",
  "#00ff00",
  "#008080",
  "#004080",
  "#8080ff",
  "#800040",
  "#ff0080",
  "#800000",
  "#ff8000",
  "#008000",
  "#008040",
  "#0000ff",
  "#0000a0",
  "#800080",
  "#8000ff",
  "#400000",
  "#804000",
  "#004000",
  "#004040",
  "#000080",
  "#000040",
  "#400040",
  "#400080",
  "#000000",
  "#808000",
  "#808040",
  "#808080",
  "#408080",
  "#c0c0c0",
  "#400040",
  "#ffffff",
];

const TOOLS = [
  ["select", "Free-Form Select"],
  ["rect-select", "Select"],
  ["eraser", "Eraser/Color Eraser"],
  ["fill", "Fill With Color"],
  ["picker", "Pick Color"],
  ["magnifier", "Magnifier"],
  ["pencil", "Pencil"],
  ["brush", "Brush"],
  ["airbrush", "Airbrush"],
  ["text", "Text"],
  ["line", "Line"],
  ["curve", "Curve"],
  ["rectangle", "Rectangle"],
  ["polygon", "Polygon"],
  ["ellipse", "Ellipse"],
  ["rounded", "Rounded Rectangle"],
];

const separator = ["separator"];
const disabled = (command, label, shortcut = "") => [
  command,
  label,
  shortcut,
  { disabled: true },
];
const check = (command, label, shortcut = "") => [
  command,
  label,
  shortcut,
  { check: true },
];
const MENU_ITEMS = {
  File: [
    ["new", "New", "Ctrl+N"],
    ["open", "Open...", "Ctrl+O"],
    ["save", "Save", "Ctrl+S"],
    ["save-as", "Save As..."],
    separator,
    disabled("wallpaper-tiled", "Set As Background (Tiled)"),
    disabled("wallpaper-centered", "Set As Background (Centered)"),
    separator,
    ["exit", "Exit", "Alt+F4"],
  ],
  Edit: [
    ["undo", "Undo", "Ctrl+Z"],
    ["redo", "Repeat", "F4"],
    separator,
    ["cut", "Cut", "Ctrl+X"],
    ["copy", "Copy", "Ctrl+C"],
    ["paste", "Paste", "Ctrl+V"],
    disabled("paste-from", "Paste From..."),
    separator,
    ["clear", "Clear Selection", "Del"],
    ["select-all", "Select All", "Ctrl+A"],
  ],
  View: [
    check("toolbox", "Tool Box", "Ctrl+T"),
    check("colorbox", "Color Box", "Ctrl+L"),
    check("status", "Status Bar"),
    disabled("text-toolbar", "Text Toolbar"),
    separator,
    disabled("zoom", "Zoom"),
    ["view-bitmap", "View Bitmap", "Ctrl+F"],
  ],
  Image: [
    ["flip", "Flip/Rotate...", "Ctrl+R"],
    ["stretch", "Stretch/Skew...", "Ctrl+W"],
    ["invert", "Invert Colors", "Ctrl+I"],
    ["attributes", "Attributes...", "Ctrl+E"],
    ["clear-image", "Clear Image", "Ctrl+Shift+N"],
    check("opaque", "Draw Opaque"),
  ],
  Colors: [["edit-colors", "Edit Colors..."]],
  Help: [["help", "Help Topics", "F1"], separator, ["about", "About Paint"]],
};

const createMenuBar = (shell, run, panelVisible) => {
  const bar = document.createElement("div");
  bar.className = "paint-menu-bar";
  bar.setAttribute("role", "menubar");
  const menus = wireMenuBar({
    windowElement: shell.windowElement,
    bar,
    showMenu: (trigger) => {
      const menu = trigger.nextElementSibling;
      menu.hidden = false;
      return menu;
    },
  });
  for (const [name, items] of Object.entries(MENU_ITEMS)) {
    const group = document.createElement("div");
    group.className = "paint-menu-group";
    const trigger = document.createElement("button");
    trigger.type = "button";
    shell.setAccessKeyText(trigger, `&${name}`);
    trigger.setAttribute("role", "menuitem");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "paint-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    for (const [command, label, shortcut = "", options = {}] of items) {
      if (command === "separator") {
        menu.appendChild(document.createElement("hr"));
        continue;
      }
      const item = document.createElement("button");
      item.type = "button";
      item.dataset.paintCommand = command;
      item.setAttribute("role", "menuitem");
      item.disabled = options.disabled || false;
      item.innerHTML = `<span class="paint-menu-check"></span><span></span><span></span>`;
      item.children[1].textContent = label;
      item.children[2].textContent = shortcut;
      if (options.check && panelVisible(command))
        item.children[0].textContent = "✓";
      item.addEventListener("click", () => {
        menus.close();
        run(command);
      });
      menu.appendChild(item);
    }
    group.append(trigger, menu);
    bar.appendChild(group);
  }
  return bar;
};

// The shell gives the picture's address: stored picture data, or an XP
// sample picture. A file with neither is not a picture Paint can read.
// The picture types Paint opens, and the ones it saves. Browsers cannot
// encode GIF, so Paint saves a GIF picture as another type.
const PICTURE_TYPES = [".bmp", ".dib", ".gif", ".jpg", ".jpeg", ".png"];
const SAVE_TYPES = PICTURE_TYPES.filter((type) => type !== ".gif");

const imageFromFile = async (url) => {
  if (!url) throw new Error("No picture data");
  const image = document.createElement("img");
  await new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", reject, { once: true });
    image.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

const mountPaint = (shell, instance) => {
  const root = document.createElement("div");
  root.className = "xp-native-program xp-native-paint";
  const canvas = document.createElement("canvas");
  canvas.width = 516;
  canvas.height = 384;
  canvas.className = "paint-canvas";
  canvas.setAttribute("aria-label", "Drawing canvas");
  canvas.tabIndex = 0;
  // The canvas gets the keys when the window becomes active.
  canvas.dataset.defaultFocus = "";
  canvas.getContext("2d").fillStyle = "#ffffff";
  canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
  let fileId = null;
  let fileName = "untitled";
  let dirty = false;
  let editRevision = 0;
  let savedContent;
  let tool = "rect-select";
  const panelState = {
    toolbox: true,
    colorbox: true,
    status: true,
    opaque: true,
  };
  const setTitle = () => shell.setTitle(`${fileName} - Paint`);
  const updateFileCommandState = () => {
    for (const command of ["wallpaper-tiled", "wallpaper-centered"]) {
      root.querySelector(`[data-paint-command="${command}"]`).disabled =
        !fileId;
    }
  };

  const body = document.createElement("div");
  body.className = "paint-body";
  const toolbox = document.createElement("div");
  toolbox.className = "paint-toolbox";
  toolbox.dataset.paintPanel = "toolbox";
  const toolOptions = document.createElement("div");
  toolOptions.className = "paint-tool-options";
  toolOptions.dataset.tool = tool;
  const workspaceShell = document.createElement("div");
  workspaceShell.className = "paint-workspace-shell";
  const workspace = document.createElement("div");
  workspace.className = "paint-workspace";
  const canvasFrame = document.createElement("div");
  canvasFrame.className = "paint-canvas-frame";
  canvasFrame.appendChild(canvas);
  workspace.appendChild(canvasFrame);
  workspaceShell.appendChild(workspace);
  body.append(toolbox, workspaceShell);

  const status = document.createElement("div");
  status.className = "paint-status";
  status.dataset.paintPanel = "status";
  status.innerHTML = `<span data-paint-help>For Help, click Help Topics on the Help Menu.</span><span data-paint-position></span><span data-paint-size></span>`;
  const engine = createCanvasEngine({
    canvas,
    frame: canvasFrame,
    onChange(detail) {
      if (detail?.colors) {
        [primary, secondary] = detail.colors;
        updateCurrent();
      }
      if (detail?.dirty !== false) {
        dirty = true;
        editRevision++;
      }
    },
    onPosition({ x, y }) {
      status.querySelector("[data-paint-position]").textContent =
        `${x}, ${y}px`;
    },
  });
  const renderToolOptions = () => {
    toolOptions.replaceChildren();
    const choices =
      tool === "eraser"
        ? [5, 10, 15, 20].map((value) => ["eraserSize", value])
        : tool === "airbrush"
          ? [5, 8, 12].map((value) => ["sprayRadius", value])
          : [
                "brush",
                "line",
                "curve",
                "rectangle",
                "polygon",
                "ellipse",
                "rounded",
              ].includes(tool)
            ? [1, 2, 3, 5].map((value) => ["lineWidth", value])
            : [];
    for (const [name, value] of choices) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "paint-tool-option";
      option.setAttribute("aria-label", `${value} pixel option`);
      option.style.setProperty(
        "--paint-option-size",
        `${Math.min(16, value)}px`,
      );
      option.addEventListener("click", () => {
        engine.setOption(name, value);
        toolOptions
          .querySelectorAll("button")
          .forEach((item) =>
            item.classList.toggle("selected", item === option),
          );
      });
      toolOptions.appendChild(option);
    }
    toolOptions.firstElementChild?.classList.add("selected");
  };

  for (const [index, [id, label]] of TOOLS.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `paint-tool paint-tool-${id}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.tool = id;
    button.style.setProperty("--paint-tool-index", String(index));
    button.classList.toggle("selected", id === tool);
    button.addEventListener("click", () => {
      tool = id;
      engine.setTool(id);
      toolOptions.dataset.tool = tool;
      renderToolOptions();
      toolbox
        .querySelectorAll(".paint-tool")
        .forEach((item) => item.classList.toggle("selected", item === button));
    });
    toolbox.appendChild(button);
  }
  toolbox.appendChild(toolOptions);
  renderToolOptions();

  const colors = document.createElement("div");
  colors.className = "paint-color-box";
  colors.dataset.paintPanel = "colorbox";
  const current = document.createElement("div");
  current.className = "paint-current-colors";
  let primary = "#000000";
  let secondary = "#ffffff";
  const updateCurrent = () => {
    current.style.setProperty("--paint-primary", primary);
    current.style.setProperty("--paint-secondary", secondary);
    engine.setColors(primary, secondary);
  };
  updateCurrent();
  colors.appendChild(current);
  const palette = document.createElement("div");
  palette.className = "paint-palette-grid";
  for (const color of PAINT_COLORS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "paint-swatch";
    swatch.style.backgroundColor = color;
    swatch.title = color;
    swatch.addEventListener("click", () => {
      primary = color;
      updateCurrent();
    });
    swatch.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      secondary = color;
      updateCurrent();
    });
    palette.appendChild(swatch);
  }
  colors.appendChild(palette);

  const loadFile = async (file) => {
    try {
      engine.replace(await imageFromFile(shell.pictureUrl(file)));
      fileId = file.id;
      fileName = file.name;
      savedContent = file.content;
      dirty = false;
      setTitle();
      updateFileCommandState();
    } catch {
      shell.showMessage(
        "Paint",
        `Paint cannot read this file.\nThis is not a valid bitmap file, or its format is not currently supported.`,
      );
    }
  };
  const save = async (saveAs) => {
    // Save and Save As keep the open file's type, unless Paint cannot
    // write it.
    const canWriteType = SAVE_TYPES.includes(`.${extensionFor(fileName)}`);
    // A deleted picture is in the Recycle Bin, or gone: Save asks where
    // to save it, like Save As.
    const canSaveInPlace = fileId && canWriteType && shell.folderOf(fileId);
    let destination =
      canSaveInPlace && !saveAs ? { inPlace: true, name: fileName } : null;
    if (!destination) {
      // The dialog adds .bmp unless a type Paint saves is typed. A new
      // picture, or one of a type Paint cannot write, starts without one.
      destination = await shell.saveFile({
        title: "Save As",
        defaultName:
          fileId && canWriteType ? fileName : fileName.replace(/\.[^.]+$/, ""),
        // Like XP, Save As starts in the open picture's folder.
        startFolder: (fileId && shell.folderOf(fileId)) || shell.myPictures,
        filter: SAVE_TYPES,
        defaultExtension: ".bmp",
        allFiles: false,
      });
    }
    if (!destination) return false;
    try {
      const revisionToSave = editRevision;
      const content = await encodeCanvas(canvas, destination.name);
      // Save writes the open picture. Save As finds the file again when
      // Paint writes, after the Replace question and the encoding.
      const file = destination.inPlace
        ? await shell.setFileContent(fileId, content, {
            expectedContent: savedContent,
          })
        : await shell.writeFile(
            destination.parentId,
            destination.name,
            content,
            {
              keepId: fileId,
              expectedContent: savedContent,
            },
          );
      fileId = file.id;
      fileName = file.name;
      savedContent = content;
      dirty = editRevision !== revisionToSave;
      setTitle();
      updateFileCommandState();
      return !dirty;
    } catch (error) {
      await shell.dialogs.alert(
        error.message || "The picture could not be saved.",
        "Paint",
        "error",
      );
      return false;
    }
  };
  const confirmSaveChanges = async () => {
    if (!dirty) return true;
    const answer = await shell.dialogs.message({
      title: "Paint",
      text: `Save changes to ${fileName}?`,
      icon: "warning",
      buttons: shell.dialogs.BUTTON_SETS.yesNoCancel,
      defaultButton: "yes",
    });
    if (answer === "cancel") return false;
    return answer === "no" || save(false);
  };
  const run = async (command) => {
    if (command === "new") {
      if (!(await confirmSaveChanges())) return;
      engine.reset(516, 384);
      fileId = null;
      fileName = "untitled";
      dirty = false;
      setTitle();
      updateFileCommandState();
    } else if (command === "open") {
      if (!(await confirmSaveChanges())) return;
      const file = await shell.openFile({
        title: "Open",
        startFolder: shell.myPictures,
        filter: PICTURE_TYPES,
      });
      if (file) await loadFile(file);
    } else if (command === "save") await save(false);
    else if (command === "save-as") await save(true);
    else if (command === "exit") shell.close();
    else if (command === "undo") engine.undo();
    else if (command === "redo") engine.redo();
    else if (command === "cut") engine.copy(true);
    else if (command === "copy") engine.copy(false);
    else if (command === "paste") engine.paste();
    else if (command === "clear") engine.clearSelection();
    else if (command === "select-all") {
      toolbox.querySelector('[data-tool="rect-select"]').click();
      engine.selectAll();
      canvas.focus();
    } else if (command === "clear-image") engine.fill(secondary);
    else if (command === "invert") engine.invert();
    else if (command === "flip" || command === "stretch") {
      const values = await showTransformDialog(shell.dialogs, command);
      if (values) engine.transform(values);
    } else if (command === "attributes") {
      const values = await showAttributesDialog(shell.dialogs, canvas);
      if (values) engine.resize(values.width, values.height);
    } else if (command === "edit-colors") {
      const value = await showEditColorsDialog(
        shell.dialogs,
        BASIC_COLORS,
        primary,
      );
      if (value) {
        primary = value;
        updateCurrent();
      }
    } else if (command.startsWith("wallpaper-"))
      shell.setWallpaper(canvas.toDataURL());
    else if (command === "view-bitmap")
      root.classList.toggle("paint-bitmap-view");
    else if (command === "about")
      showXPAboutDialog(shell.dialogs, {
        title: "About Paint",
        product: "Microsoft ® Paint",
        version: "Version 5.1 (Build 2600.xpsp.080413-2111 : Service Pack 3)",
        copyright: "Copyright © 2007 Microsoft Corporation",
        icon: "assets/xp/icons/PaintLarge.png",
      });
    else if (command === "help")
      shell.showMessage(
        "Paint Help",
        "Select a tool, then drag on the drawing area. Use File to open or save pictures.",
      );
    else if (["toolbox", "colorbox", "status"].includes(command)) {
      panelState[command] = !panelState[command];
      root
        .querySelector(`[data-paint-panel="${command}"]`)
        .toggleAttribute("hidden", !panelState[command]);
      root.querySelector(
        `[data-paint-command="${command}"] .paint-menu-check`,
      ).textContent = panelState[command] ? "✓" : "";
    } else {
      // Draw Opaque is the only remaining enabled command.
      panelState.opaque = !panelState.opaque;
      engine.setOption("opaque", panelState.opaque);
      root.querySelector(
        '[data-paint-command="opaque"] .paint-menu-check',
      ).textContent = panelState.opaque ? "✓" : "";
    }
  };

  root.append(createMenuBar(shell, run, (command) => panelState[command]));
  root.append(body, colors, status);
  updateFileCommandState();
  const removeScrollbars = installPaintScrollbars(
    workspaceShell,
    workspace,
    canvas,
  );
  root.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const command = modifier
      ? {
          n: "new",
          o: "open",
          s: "save",
          z: "undo",
          x: "cut",
          c: "copy",
          v: "paste",
          i: "invert",
          e: "attributes",
          r: "flip",
          w: "stretch",
          a: "select-all",
          t: "toolbox",
          l: "colorbox",
          f: "view-bitmap",
        }[key]
      : event.key === "F4"
        ? "redo"
        : event.key === "Delete"
          ? "clear"
          : null;
    if (command) {
      event.preventDefault();
      run(command);
    }
  });
  setTitle();
  if (instance.file) void loadFile(instance.file);
  return {
    element: root,
    beforeClose: confirmSaveChanges,
    async openFile(file) {
      if (!(await confirmSaveChanges())) return false;
      await loadFile(file);
      return true;
    },
    unmount() {
      removeScrollbars();
      engine.destroy();
    },
  };
};

export const paintApplication = defineApplication({
  ...applicationMetadata,
  mount: mountPaint,
});
