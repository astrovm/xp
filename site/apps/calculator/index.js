import { applicationMetadata } from "./metadata.js";
import { defineApplication } from "../core/application.js";
import { wireMenuBar } from "../core/menu-bar.js";
import {
  dialogUnitsX,
  dialogUnitsY,
  openTemplateDialog,
} from "../cards/template-dialog.js";
import {
  RADIXES,
  WORD_BITS,
  createCalculator,
  pasteCommands,
} from "./engine.js";

const SETTINGS_KEY = "calculatorSettings";
const DING = "assets/xp/sounds/ding.wav";
const ICON = "assets/xp/calculator/Calculator-32.png";
const RED = "red";
const BLUE = "blue";
const PURPLE = "purple";

// Controls from calc.exe's dialog templates, in dialog units:
// [command, label, x, y, width, height, color]. Labels come from the
// string table, which calc.exe writes over the template's.
const key = (command, label, x, y, color, width = 24, height = 18) => [
  command,
  label,
  x,
  y,
  width,
  height,
  color,
];
const digitKeys = (columns, rows, color = BLUE) =>
  [
    ["7", "8", "9"],
    ["4", "5", "6"],
    ["1", "2", "3"],
  ].flatMap((row, rowIndex) =>
    row.map((digit, column) =>
      key(`digit${digit}`, digit, columns[column], rows[rowIndex], color),
    ),
  );

// Dialog 102. The client area ends at its marker control, 128 units down.
const STANDARD = {
  size: [169, 128],
  display: [5, 1, 159, 14],
  memory: [8, 24, 18, 16],
  keys: [
    key("back", "Backspace", 36, 23, RED, 42),
    key("clearEntry", "CE", 80, 23, RED, 41),
    key("clear", "C", 123, 23, RED, 41),
    key("mc", "MC", 5, 45, RED),
    key("mr", "MR", 5, 65, RED),
    key("ms", "MS", 5, 85, RED),
    key("mplus", "M+", 5, 105, RED),
    ...digitKeys([36, 62, 88], [45, 65, 85]),
    key("digit0", "0", 36, 105, BLUE),
    key("sign", "+/-", 62, 105, BLUE),
    key("point", ".", 88, 105, BLUE),
    key("div", "/", 114, 45, RED),
    key("mul", "*", 114, 65, RED),
    key("sub", "-", 114, 85, RED),
    key("add", "+", 114, 105, RED),
    key("sqrt", "sqrt", 140, 45, BLUE),
    key("percent", "%", 140, 65, BLUE),
    key("reciprocal", "1/x", 140, 85, BLUE),
    key("equals", "=", 140, 105, RED),
  ],
};

// Dialog 101, 163 units tall.
const SCIENTIFIC = {
  size: [316, 163],
  display: [5, 1, 305, 14],
  memory: [126, 38, 18, 16],
  parentheses: [93, 38, 18, 16],
  groups: [
    [5, 14, 141, 20],
    [147, 14, 163, 20],
    [5, 34, 84, 20],
  ],
  radixes: [
    ["hex", "Hex", 8],
    ["dec", "Dec", 41],
    ["oct", "Oct", 74],
    ["bin", "Bin", 107],
  ].map(([command, label, x]) => [command, label, x, 21, 30, 10]),
  angles: [
    ["degrees", "Degrees", 150],
    ["radians", "Radians", 204],
    ["grads", "Grads", 258],
  ].map(([command, label, x]) => [command, label, x, 21, 41, 10]),
  words: [
    ["qword", "Qword", 150],
    ["dword", "Dword", 190],
    ["word", "Word", 230],
    ["byte", "Byte", 270],
  ].map(([command, label, x]) => [command, label, x, 21, 38, 10]),
  checks: [
    ["inv", "Inv", 8, 41, 34, 10],
    ["hyp", "Hyp", 49, 41, 34, 10],
  ],
  keys: [
    key("back", "Backspace", 177, 38, RED, 43),
    key("clearEntry", "CE", 222, 38, RED, 43),
    key("clear", "C", 267, 38, RED, 43),
    key("sta", "Sta", 5, 60, BLUE),
    key("ave", "Ave", 5, 80, BLUE),
    key("sum", "Sum", 5, 100, BLUE),
    key("s", "s", 5, 120, BLUE),
    key("dat", "Dat", 5, 140, BLUE),
    key("fe", "F-E", 38, 60, PURPLE),
    key("dms", "dms", 38, 80, PURPLE),
    key("sin", "sin", 38, 100, PURPLE),
    key("cos", "cos", 38, 120, PURPLE),
    key("tan", "tan", 38, 140, PURPLE),
    key("open", "(", 64, 60, PURPLE),
    key("exp", "Exp", 64, 80, PURPLE),
    key("pow", "x^y", 64, 100, PURPLE),
    key("cube", "x^3", 64, 120, PURPLE),
    key("square", "x^2", 64, 140, PURPLE),
    key("close", ")", 90, 60, PURPLE),
    key("ln", "ln", 90, 80, PURPLE),
    key("log", "log", 90, 100, PURPLE),
    key("factorial", "n!", 90, 120, PURPLE),
    key("reciprocal", "1/x", 90, 140, PURPLE),
    key("mc", "MC", 123, 60, RED),
    key("mr", "MR", 123, 80, RED),
    key("ms", "MS", 123, 100, RED),
    key("mplus", "M+", 123, 120, RED),
    key("pi", "pi", 123, 140, BLUE),
    ...digitKeys([156, 182, 208], [60, 80, 100]),
    key("digit0", "0", 156, 120, BLUE),
    key("sign", "+/-", 182, 120, BLUE),
    key("point", ".", 208, 120, BLUE),
    ..."ABCDEF"
      .split("")
      .map((digit, index) =>
        key(`digit${10 + index}`, digit, 156 + index * 26, 140, BLUE),
      ),
    key("div", "/", 234, 60, RED),
    key("mul", "*", 234, 80, RED),
    key("sub", "-", 234, 100, RED),
    key("add", "+", 234, 120, RED),
    key("mod", "Mod", 260, 60, RED),
    key("or", "Or", 260, 80, RED),
    key("lsh", "Lsh", 260, 100, RED),
    key("equals", "=", 260, 120, RED),
    key("and", "And", 286, 60, RED),
    key("xor", "Xor", 286, 80, RED),
    key("not", "Not", 286, 100, RED),
    key("int", "Int", 286, 120, RED),
  ],
};

// calc.exe's accelerators: typed characters, then keys whatever the
// Shift state, then Ctrl combinations.
const CHARACTER_KEYS = {
  "!": "factorial",
  "#": "cube",
  "@": "square",
  "/": "div",
  "*": "mul",
  "%": "mod",
  "-": "sub",
  "=": "equals",
  "+": "add",
  "&": "and",
  "|": "or",
  "~": "not",
  "^": "xor",
  "(": "open",
  ")": "close",
  ";": "int",
  "<": "lsh",
  ".": "point",
  ",": "point",
};
"0123456789".split("").forEach((digit) => {
  CHARACTER_KEYS[digit] = `digit${digit}`;
});
const LETTER_KEYS = {
  S: "sin",
  O: "cos",
  T: "tan",
  R: "reciprocal",
  Y: "pow",
  M: "dms",
  N: "ln",
  L: "log",
  V: "fe",
  X: "exp",
  I: "inv",
  H: "hyp",
  P: "pi",
};
"ABCDEF".split("").forEach((digit, index) => {
  LETTER_KEYS[digit] = `digit${10 + index}`;
});
const NAMED_KEYS = {
  Backspace: "back",
  Delete: "clearEntry",
  Escape: "clear",
  F2: "degrees",
  F3: "radians",
  F4: "grads",
  F5: "hex",
  F6: "dec",
  F7: "oct",
  F8: "bin",
  F9: "sign",
  F12: "qword",
  Enter: "equals",
  Insert: "dat",
};
const CONTROL_KEYS = {
  s: "sta",
  m: "ms",
  p: "mplus",
  l: "mc",
  r: "mr",
  a: "ave",
  t: "sum",
  d: "s",
};

const commandForKey = (event) => {
  if (event.altKey || event.metaKey) return null;
  if (event.ctrlKey) {
    const letter = globalThis.XPDialogs.shortcutKeyOf(event);
    if (event.key === "Insert") return "copy";
    if (event.shiftKey) return letter === "k" ? "about" : null;
    if (letter === "c") return "copy";
    return CONTROL_KEYS[letter] || null;
  }
  if (event.shiftKey && event.key === "Insert") return "paste";
  if (NAMED_KEYS[event.key]) return NAMED_KEYS[event.key];
  if (/^[a-z]$/i.test(event.key))
    return LETTER_KEYS[event.key.toUpperCase()] || null;
  return CHARACTER_KEYS[event.key] || null;
};

const readSettings = () => {
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (value && typeof value === "object") saved = value;
  } catch {
    // Unreadable settings fall back to XP's defaults.
  }
  return {
    scientific: saved.view === "scientific",
    grouping: saved.grouping === true,
  };
};

const mountCalculator = (context) => {
  const { dialogs } = context;
  const root = document.createElement("div");
  root.className = "xp-native-program xp-calculator";
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="cards-menu-bar" role="menubar"></div>
    <div class="calculator-client"></div>`;
  const menuBar = root.querySelector(".cards-menu-bar");
  const client = root.querySelector(".calculator-client");
  context.windowElement.classList.add("dialog-frame");

  const settings = readSettings();
  const calculator = createCalculator({ scientific: settings.scientific });
  calculator.setGrouping(settings.grouping);
  let controls = {};
  let statistics = null;
  let sound = null;
  let beeps = 0;

  const saveSettings = () => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          view: settings.scientific ? "scientific" : "standard",
          grouping: settings.grouping,
        }),
      );
    } catch {
      // Settings stay for this session when storage is unavailable.
    }
  };

  const place = (element, [x, y, width, height]) => {
    Object.assign(element.style, {
      left: `${dialogUnitsX(x)}px`,
      top: `${dialogUnitsY(y)}px`,
      width: `${dialogUnitsX(width)}px`,
      height: `${dialogUnitsY(height)}px`,
    });
    client.append(element);
    return element;
  };

  // ---- The client area, rebuilt for each view ----
  const build = () => {
    const layout = settings.scientific ? SCIENTIFIC : STANDARD;
    client.replaceChildren();
    controls = { keys: {}, radios: {}, checks: {} };
    client.style.width = `${dialogUnitsX(layout.size[0])}px`;
    client.style.height = `${dialogUnitsY(layout.size[1])}px`;
    controls.display = place(document.createElement("div"), layout.display);
    controls.display.className = "calculator-display";
    controls.memory = place(document.createElement("div"), layout.memory);
    controls.memory.className = "calculator-indicator";
    if (layout.parentheses) {
      controls.parentheses = place(
        document.createElement("div"),
        layout.parentheses,
      );
      controls.parentheses.className = "calculator-indicator";
    }
    layout.groups?.forEach((rect) => {
      place(document.createElement("fieldset"), rect).className =
        "dlg-group calculator-group";
    });
    const choice = (type, [command, label, ...rect]) => {
      const element = place(document.createElement("label"), rect);
      element.className = "calculator-choice";
      const box = document.createElement("input");
      box.type = type;
      box.tabIndex = -1;
      box.addEventListener("click", () => run(command));
      const text = document.createElement("span");
      text.textContent = label;
      element.append(box, text);
      return { element, box };
    };
    [layout.radixes, layout.angles, layout.words].forEach((set) =>
      set?.forEach((definition) => {
        controls.radios[definition[0]] = choice("radio", definition);
      }),
    );
    layout.checks?.forEach((definition) => {
      controls.checks[definition[0]] = choice("checkbox", definition);
    });
    layout.keys.forEach(([command, label, x, y, width, height, color]) => {
      const button = place(document.createElement("button"), [
        x,
        y,
        width,
        height,
      ]);
      button.type = "button";
      button.tabIndex = -1;
      button.className = `xp-btn calculator-key ${color}`;
      button.dataset.command = command;
      button.textContent = label;
      button.addEventListener("click", () => run(command));
      controls.keys[command] = button;
    });
    // A 3-pixel dialog frame, the 29-pixel caption and the menu bar.
    const width = dialogUnitsX(layout.size[0]) + 6;
    const height = dialogUnitsY(layout.size[1]) + 52;
    context.setSize(width, height);
    return { width, height };
  };

  // ---- Showing the engine's state ----
  const render = () => {
    const radix = calculator.radix;
    controls.display.textContent = calculator.display;
    controls.memory.textContent = calculator.memory ? " M" : "";
    if (controls.parentheses)
      controls.parentheses.textContent = calculator.parentheses
        ? `(=${calculator.parentheses}`
        : "";
    if (!settings.scientific) return;
    const integerMode = radix !== 10;
    Object.entries(controls.radios).forEach(([command, { element, box }]) => {
      if (command in RADIXES) box.checked = RADIXES[command] === radix;
      else if (command in WORD_BITS) {
        element.hidden = !integerMode;
        box.checked = WORD_BITS[command] === calculator.bits;
      } else {
        element.hidden = integerMode;
        box.checked = command === calculator.angle;
      }
    });
    controls.checks.inv.box.checked = calculator.inv;
    controls.checks.hyp.box.checked = calculator.hyp;
    const decimalOnly = ["fe", "dms", "exp", "sin", "cos", "tan", "pi"];
    Object.entries(controls.keys).forEach(([command, button]) => {
      let disabled = false;
      if (command.startsWith("digit"))
        disabled = Number(command.slice(5)) >= radix;
      else if (decimalOnly.includes(command)) disabled = integerMode;
      else if (["ave", "sum", "s", "dat"].includes(command))
        disabled = !statistics;
      button.disabled = disabled;
    });
  };

  const beep = () => {
    // MessageBeep plays the scheme's Default Beep.
    sound?.pause();
    sound = new Audio(DING);
    void sound.play().catch(() => {});
  };

  // Runs one command the way WM_COMMAND does. Standard has no Mod, so its %
  // means percent.
  const press = (command) => {
    if (command === "mod" && !settings.scientific) command = "percent";
    if (command === "sta") openStatistics();
    calculator.press(command);
    if (calculator.beeps !== beeps) {
      beeps = calculator.beeps;
      beep();
    }
    if (command === "dat" && statistics) refreshStatistics(true);
  };

  // ---- Statistics Box: dialog 103, a modeless window of its own ----
  const refreshStatistics = (selectLast = false) => {
    const { list, count } = statistics;
    const previous = list.selectedIndex;
    list.replaceChildren(
      ...calculator.statistics.map((text) => new Option(text)),
    );
    const last = list.options.length - 1;
    list.selectedIndex = selectLast ? last : Math.min(previous, last);
    count.textContent = `${list.options.length}`;
  };
  const openStatistics = () => {
    if (statistics) {
      statistics.list.focus();
      return;
    }
    calculator.setStatisticsOpen(true);
    const { dialog, elements } = openTemplateDialog({
      dialogs,
      setAccessKeyText: context.setAccessKeyText,
      owner: { window: context.windowElement, client },
      title: "Statistics Box",
      size: [146, 86],
      modal: false,
      help: true,
      position: () => ({ left: dialogUnitsX(80), top: dialogUnitsY(80) }),
      controls: [
        {
          type: "button",
          id: "ret",
          label: "&RET",
          rect: [4, 58, 28, 14],
          isDefault: true,
        },
        { type: "button", id: "load", label: "&LOAD", rect: [40, 58, 28, 14] },
        { type: "button", id: "cd", label: "&CD", rect: [76, 58, 28, 14] },
        { type: "button", id: "cad", label: "C&AD", rect: [112, 58, 28, 14] },
        { type: "text", id: "label", label: "n=", rect: [0, 76, 74, 8] },
        { type: "text", id: "count", label: "0", rect: [74, 76, 32, 8] },
      ],
    });
    elements.label.classList.add("calculator-count-label");
    const list = document.createElement("select");
    list.size = 2;
    list.className = "xp-template-control calculator-statistics";
    Object.assign(list.style, {
      left: `${dialogUnitsX(3)}px`,
      top: `${dialogUnitsY(3)}px`,
      width: `${dialogUnitsX(140)}px`,
      // The list box keeps a whole number of rows, which leaves it 56
      // pixels tall rather than the template's 50 units.
      height: "56px",
    });
    dialog.body.prepend(list);
    statistics = { dialog, list, count: elements.count };
    const load = () => {
      if (list.selectedIndex < 0) return beep();
      calculator.loadStatistic(list.selectedIndex);
      render();
    };
    list.addEventListener("dblclick", load);
    // The buttons keep the box open; only closing it ends the statistics.
    const actions = {
      ret: () => root.focus({ preventScroll: true }),
      load,
      cd: () => {
        if (list.selectedIndex < 0) return beep();
        calculator.removeStatistic(list.selectedIndex);
        refreshStatistics();
      },
      cad: () => {
        calculator.clearStatistics();
        refreshStatistics();
      },
    };
    Object.entries(actions).forEach(([id, action]) => {
      const button = elements[id];
      const replacement = button.cloneNode(true);
      replacement.addEventListener("click", action);
      button.replaceWith(replacement);
      elements[id] = replacement;
      dialog.accessKeys.forEach((target, accessKey) => {
        if (target === button) dialog.accessKeys.set(accessKey, replacement);
      });
    });
    dialog.defaultButton = elements.ret;
    dialog.onResult(() => {
      statistics = null;
      calculator.setStatisticsOpen(false);
      calculator.clearStatistics();
      render();
    });
    list.focus();
  };
  const closeStatistics = () => statistics?.dialog.close();

  // ---- Clipboard ----
  const copy = () => {
    // calc.exe copies the display without a whole number's trailing point.
    const text = calculator.display.replace(/\.$/, "");
    void navigator.clipboard?.writeText(text).catch(() => {});
  };
  const paste = (text) => {
    for (const command of pasteCommands(text, calculator.radix)) {
      if (calculator.error) break;
      press(command);
    }
  };
  const pasteFromClipboard = () => {
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        paste(text);
        render();
      })
      .catch(() => {});
  };

  // ---- Menus ----
  const menus = () => {
    const view = [
      ["S&tandard", "standard", "", !settings.scientific, "radio"],
      ["&Scientific", "scientific", "", settings.scientific, "radio"],
      "-",
    ];
    if (settings.scientific) {
      const radix = calculator.radix;
      view.push(
        ["&Hex", "hex", "F5", radix === 16, "radio"],
        ["&Decimal", "dec", "F6", radix === 10, "radio"],
        ["&Octal", "oct", "F7", radix === 8, "radio"],
        ["&Binary", "bin", "F8", radix === 2, "radio"],
        "-",
      );
      if (radix === 10)
        view.push(
          [
            "D&egrees",
            "degrees",
            "F2",
            calculator.angle === "degrees",
            "radio",
          ],
          [
            "&Radians",
            "radians",
            "F3",
            calculator.angle === "radians",
            "radio",
          ],
          ["&Grads", "grads", "F4", calculator.angle === "grads", "radio"],
          "-",
        );
      else
        view.push(
          ["&Qword", "qword", "F12", calculator.bits === 64, "radio"],
          ["Dwo&rd", "dword", "F2", calculator.bits === 32, "radio"],
          ["&Word", "word", "F3", calculator.bits === 16, "radio"],
          ["B&yte", "byte", "F4", calculator.bits === 8, "radio"],
          "-",
        );
    }
    view.push([
      "D&igit grouping",
      "grouping",
      "",
      settings.grouping,
      "checked",
    ]);
    return [
      [
        "&Edit",
        [
          ["&Copy", "copy", "Ctrl+C"],
          ["&Paste", "paste", "Ctrl+V"],
        ],
      ],
      ["&View", view],
      ["&Help", [["&About Calculator", "about", ""]]],
    ];
  };
  const menuControl = wireMenuBar({
    windowElement: context.windowElement,
    bar: menuBar,
    showMenu: (button) => {
      const menu = document.createElement("div");
      menu.className = "tm-menu";
      menu.setAttribute("role", "menu");
      menu.style.left = `${button.offsetLeft}px`;
      const index = [...menuBar.children].indexOf(button);
      menus()[index][1].forEach((item) => {
        if (item === "-") {
          menu.insertAdjacentHTML(
            "beforeend",
            '<div class="tm-menu-separator"></div>',
          );
          return;
        }
        const [itemLabel, command, shortcut, marked, mark] = item;
        const entry = document.createElement("button");
        entry.type = "button";
        entry.setAttribute("role", "menuitem");
        entry.dataset.command = command;
        if (marked) entry.classList.add(mark);
        const text = document.createElement("span");
        context.setAccessKeyText(text, itemLabel);
        const shortcutText = document.createElement("kbd");
        shortcutText.textContent = shortcut;
        entry.append(text, shortcutText);
        entry.addEventListener("click", () => {
          menuControl.close();
          run(command);
        });
        menu.append(entry);
      });
      menuBar.append(menu);
      return menu;
    },
    hideMenu: (menu) => menu.remove(),
  });
  menus().forEach(([label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.dataset.calculatorMenu = label.replace(/&/g, "").toLowerCase();
    context.setAccessKeyText(button, label);
    menuBar.append(button);
  });
  const setView = (scientific) => {
    if (scientific === settings.scientific) return;
    // Changing the view closes the Statistics Box.
    closeStatistics();
    settings.scientific = scientific;
    calculator.setScientific(scientific);
    saveSettings();
    build();
  };

  // Menu, button and key commands all end here.
  const run = (command) => {
    if (command === "standard" || command === "scientific")
      setView(command === "scientific");
    else if (command === "grouping") {
      settings.grouping = !settings.grouping;
      calculator.setGrouping(settings.grouping);
      saveSettings();
    } else if (command === "copy") copy();
    else if (command === "paste") pasteFromClipboard();
    else if (command === "about")
      context.openAboutWindows({ application: "Calculator", icon: ICON });
    else press(command);
    render();
  };

  // Accelerators flash the button they stand for, as calc.exe does for
  // 20 ms.
  const flash = (command) => {
    const button = controls.keys[command];
    if (!button) return;
    button.classList.add("pressed");
    setTimeout(() => button.classList.remove("pressed"), 20);
  };
  const handleKeydown = (event) => {
    if (document.querySelector(".xp-dialog-overlay:not(.xp-dialog-modeless)"))
      return;
    // Ctrl+V arrives as a paste event, with the clipboard's text.
    if (event.ctrlKey && globalThis.XPDialogs.shortcutKeyOf(event) === "v")
      return;
    const command = commandForKey(event);
    if (!command) return;
    event.preventDefault();
    menuControl.close();
    flash(command);
    run(command);
  };
  const handlePaste = (event) => {
    event.preventDefault();
    paste(event.clipboardData?.getData("text/plain") || "");
    render();
  };
  context.windowElement.addEventListener("keydown", handleKeydown);
  context.windowElement.addEventListener("paste", handlePaste);

  // Opening in Scientific view centers the larger window.
  const { width, height } = build();
  if (settings.scientific) {
    const desktop = context.getDesktopSize();
    const style = context.windowElement.style;
    style.left = `${Math.max(8, Math.floor((desktop.width - width) / 2))}px`;
    style.top = `${Math.max(8, Math.floor((desktop.height - height) / 2))}px`;
  }
  render();
  queueMicrotask(() => root.focus({ preventScroll: true }));

  return {
    element: root,
    unmount() {
      closeStatistics();
      context.windowElement.removeEventListener("keydown", handleKeydown);
      context.windowElement.removeEventListener("paste", handlePaste);
    },
  };
};

export const calculatorApplication = defineApplication({
  ...applicationMetadata,
  mount: mountCalculator,
});
