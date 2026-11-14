// @ts-nocheck -- Calculator's window, used through Happy DOM.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { checkMenuBar } from "./helpers/menu-bar";

afterEach(cleanupShells);

const open = async ({
  storage = {},
  clipboard = "",
  clipboardFails = false,
  noClipboard = false,
  failStorage = false,
} = {}) => {
  const sounds = [];
  const copied = [];
  const s = await login(
    await loadShell({
      initialStorage: storage,
      beforeScripts: (window) => {
        window.Audio = class {
          constructor(source) {
            this.source = source;
            sounds.push(this);
          }
          // Browsers can refuse to play before the page is used.
          play() {
            return Promise.reject(new Error("blocked"));
          }
          pause() {
            this.paused = true;
          }
        };
        Object.defineProperty(window.navigator, "clipboard", {
          configurable: true,
          value: noClipboard
            ? undefined
            : {
                writeText: (text) => {
                  copied.push(text);
                  return clipboardFails
                    ? Promise.reject(new Error("denied"))
                    : Promise.resolve();
                },
                readText: () =>
                  clipboardFails
                    ? Promise.reject(new Error("denied"))
                    : Promise.resolve(clipboard),
              },
        });
      },
    }),
  );
  if (failStorage)
    s.window.localStorage.setItem = () => {
      throw new Error("full");
    };
  s.window.history.replaceState(null, "", "#calculator");
  s.window.dispatchEvent(new s.window.HashChangeEvent("hashchange"));
  const settle = async (times = 6) => {
    for (let index = 0; index < times; index += 1) await flushShell();
  };
  await settle();
  const win = s.document.querySelector('.xp-window[data-game="__calculator"]');
  const display = () => win.querySelector(".calculator-display").textContent;
  const button = (command) =>
    win.querySelector(`.calculator-key[data-command="${command}"]`);
  const click = (...commands) =>
    commands.forEach((command) => button(command).click());
  const key = (name, init = {}) => {
    const event = new s.window.KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    win.querySelector(".xp-calculator").dispatchEvent(event);
    return event;
  };
  const type = (text) => [...text].forEach((character) => key(character));
  const menu = async (name, command) => {
    win.querySelector(`[data-calculator-menu="${name}"]`).click();
    const item = win.querySelector(`.tm-menu [data-command="${command}"]`);
    item.click();
    await settle();
  };
  const menuItems = (name) => {
    win.querySelector(`[data-calculator-menu="${name}"]`).click();
    const items = [...win.querySelectorAll(".tm-menu > button")].map(
      (item) =>
        `${item.textContent}${item.classList.contains("radio") ? " (o)" : ""}${item.classList.contains("checked") ? " (v)" : ""}`,
    );
    win.querySelector(`[data-calculator-menu="${name}"]`).click();
    return items;
  };
  const paste = (text, data = true) => {
    const event = new s.window.Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    event.clipboardData = data ? { getData: () => text } : null;
    win.querySelector(".xp-calculator").dispatchEvent(event);
  };
  const saved = () =>
    JSON.parse(s.window.localStorage.getItem("calculatorSettings"));
  const statisticsBox = () =>
    [...s.document.querySelectorAll(".xp-dialog")].find(
      (dialog) =>
        dialog.querySelector(".title-text").textContent === "Statistics Box",
    );
  return {
    s,
    win,
    display,
    button,
    click,
    key,
    type,
    menu,
    menuItems,
    paste,
    saved,
    settle,
    sounds,
    copied,
    statisticsBox,
  };
};

test("opens in Standard view, laid out from dialog 102", async () => {
  const h = await open();
  expect(h.win.style.width).toBe("260px");
  expect(h.win.style.height).toBe("260px");
  expect(h.win.classList.contains("dialog-frame")).toBeTrue();
  expect(Boolean(h.win.querySelector(".resize-handle"))).toBeFalse();
  expect(h.win.querySelector(".maximize-btn").disabled).toBeTrue();
  expect(h.display()).toBe("0.");
  const client = h.win.querySelector(".calculator-client");
  expect(client.style.width).toBe("254px");
  expect(client.style.height).toBe("208px");
  const display = h.win.querySelector(".calculator-display");
  expect([display.style.left, display.style.top]).toEqual(["8px", "2px"]);
  expect([display.style.width, display.style.height]).toEqual([
    "239px",
    "23px",
  ]);
  const memoryClear = h.button("mc");
  expect([memoryClear.style.left, memoryClear.style.top]).toEqual([
    "8px",
    "73px",
  ]);
  expect([memoryClear.style.width, memoryClear.style.height]).toEqual([
    "36px",
    "29px",
  ]);
  expect(memoryClear.classList.contains("red")).toBeTrue();
  expect(h.button("digit7").classList.contains("blue")).toBeTrue();
  expect(h.button("sqrt").textContent).toBe("sqrt");
  expect(h.win.querySelectorAll(".calculator-key")).toHaveLength(27);
  expect(Boolean(h.win.querySelector(".calculator-choice"))).toBeFalse();
  expect(h.win.querySelector(".title-text").textContent).toBe("Calculator");
});

test("buttons calculate", async () => {
  const h = await open();
  h.click("digit2", "add", "digit3", "mul", "digit4", "equals");
  expect(h.display()).toBe("20.");
  h.click("clear", "digit9", "sqrt");
  expect(h.display()).toBe("3.");
  h.click("ms");
  expect(h.win.querySelector(".calculator-indicator").textContent).toBe(" M");
  h.click("mc");
  expect(h.win.querySelector(".calculator-indicator").textContent).toBe("");
  h.click("digit1", "div", "digit0", "equals");
  expect(h.display()).toBe("Cannot divide by zero.");
  h.click("digit5");
  expect(h.sounds.at(-1).source).toBe("assets/xp/sounds/ding.wav");
  h.click("digit5");
  expect(h.sounds.at(-2).paused).toBeTrue();
  h.click("clearEntry");
  expect(h.display()).toBe("0.");
});

test("the keyboard follows calc.exe's accelerators", async () => {
  const h = await open();
  h.type("12+3=");
  expect(h.display()).toBe("15.");
  h.key("Escape");
  h.type("200+10%");
  expect(h.display()).toBe("20.");
  h.key("Enter");
  expect(h.display()).toBe("220.");
  h.key("Escape");
  h.type("9@");
  expect(h.display()).toBe("3.");
  h.type("4r");
  expect(h.display()).toBe("0.25");
  h.key("Escape");
  h.type("123");
  h.key("Backspace");
  expect(h.display()).toBe("12.");
  h.key("F9");
  expect(h.display()).toBe("-12.");
  h.key("Delete");
  expect(h.display()).toBe("0.");
  h.type("1,5");
  expect(h.display()).toBe("1.5");
  // A Russian layout types "ь" on the M key. Like Windows, Ctrl+M follows
  // the place of the key.
  h.key("ь", { ctrlKey: true, code: "KeyM" });
  expect(h.win.querySelector(".calculator-indicator").textContent).toBe(" M");
  h.key("Escape");
  h.key("r", { ctrlKey: true });
  expect(h.display()).toBe("1.5");
  h.key("p", { ctrlKey: true });
  h.key("r", { ctrlKey: true });
  expect(h.display()).toBe("3.");
  h.key("l", { ctrlKey: true });
  expect(h.win.querySelector(".calculator-indicator").textContent).toBe("");
  // Keys without a command, Alt and Meta combinations, and Ctrl+Shift
  // combinations other than Ctrl+Shift+K do nothing.
  for (const [name, init] of [
    ["q", {}],
    ["?", {}],
    ["5", { altKey: true }],
    ["5", { metaKey: true }],
    ["z", { ctrlKey: true }],
    ["s", { ctrlKey: true, shiftKey: true }],
  ])
    expect([name, h.key(name, init).defaultPrevented]).toEqual([name, false]);
  expect(h.display()).toBe("3.");
  // The flash: the button looks pressed for 20 ms.
  h.key("7");
  expect(h.button("digit7").classList.contains("pressed")).toBeTrue();
  await h.s.advanceTime(40);
  expect(h.button("digit7").classList.contains("pressed")).toBeFalse();
  // Keys for buttons Standard lacks still work.
  h.key("Escape");
  h.type("30s");
  expect(h.display()).toBe("0.5");
});

test("Scientific view, with bases, word sizes, angles, Inv and Hyp", async () => {
  const h = await open();
  await h.menu("view", "scientific");
  expect(h.win.style.width).toBe("480px");
  expect(h.win.style.height).toBe("317px");
  expect(h.saved()).toEqual({ view: "scientific", grouping: false });
  expect(h.win.querySelectorAll(".calculator-key")).toHaveLength(58);
  expect(h.button("sin").classList.contains("purple")).toBeTrue();
  expect(h.button("pi").classList.contains("blue")).toBeTrue();
  expect(h.button("digit10").disabled).toBeTrue();
  expect(h.button("ave").disabled).toBeTrue();
  const radio = (command) =>
    h.win.querySelector(`.calculator-choice input`) &&
    [...h.win.querySelectorAll(".calculator-choice")].find(
      (choice) => choice.textContent === command,
    );
  expect(radio("Dec").querySelector("input").checked).toBeTrue();
  expect(radio("Degrees").querySelector("input").checked).toBeTrue();
  expect(radio("Qword").hidden).toBeTrue();
  h.type("2+3*4=");
  expect(h.display()).toBe("14.");
  h.type("255");
  radio("Hex").querySelector("input").click();
  expect(h.display()).toBe("FF");
  expect(radio("Degrees").hidden).toBeTrue();
  expect(radio("Qword").querySelector("input").checked).toBeTrue();
  expect(h.button("digit10").disabled).toBeFalse();
  expect(h.button("sin").disabled).toBeTrue();
  expect(h.button("digit9").disabled).toBeFalse();
  h.key("F4");
  expect(radio("Byte").querySelector("input").checked).toBeTrue();
  h.key("F8");
  expect(h.display()).toBe("11111111");
  expect(h.button("digit2").disabled).toBeTrue();
  h.key("F6");
  h.key("F3");
  expect(radio("Radians").querySelector("input").checked).toBeTrue();
  h.key("Escape");
  h.type("1");
  const inv = radio("Inv").querySelector("input");
  inv.click();
  expect(inv.checked).toBeTrue();
  radio("Hyp").querySelector("input").click();
  expect(radio("Hyp").querySelector("input").checked).toBeTrue();
  h.type("s");
  expect(h.display()).toBe("0.88137358701954302523260932497979");
  expect(inv.checked).toBeFalse();
  h.type("(2+3");
  expect(h.win.querySelectorAll(".calculator-indicator")[1].textContent).toBe(
    "(=1",
  );
  h.type(")");
  expect(h.win.querySelectorAll(".calculator-indicator")[1].textContent).toBe(
    "",
  );
  h.type("7%3=");
  expect(h.display()).toBe("1.");
  await h.menu("view", "standard");
  expect(h.win.style.width).toBe("260px");
  expect(h.saved()).toEqual({ view: "standard", grouping: false });
  // Choosing the current view again changes nothing.
  await h.menu("view", "standard");
  expect(h.win.style.width).toBe("260px");
});

test("the View menu follows the base, and digit grouping persists", async () => {
  const h = await open({
    storage: { calculatorSettings: JSON.stringify({ view: "scientific" }) },
  });
  expect(h.win.style.width).toBe("480px");
  // Centered on Happy DOM's empty desktop, which leaves the 8-pixel margin.
  expect(h.win.style.left).toBe("8px");
  expect(h.menuItems("edit")).toEqual(["CopyCtrl+C", "PasteCtrl+V"]);
  expect(h.menuItems("help")).toEqual(["About Calculator"]);
  expect(h.menuItems("view")).toEqual([
    "Standard",
    "Scientific (o)",
    "HexF5",
    "DecimalF6 (o)",
    "OctalF7",
    "BinaryF8",
    "DegreesF2 (o)",
    "RadiansF3",
    "GradsF4",
    "Digit grouping",
  ]);
  await h.menu("view", "hex");
  expect(h.menuItems("view")).toEqual([
    "Standard",
    "Scientific (o)",
    "HexF5 (o)",
    "DecimalF6",
    "OctalF7",
    "BinaryF8",
    "QwordF12 (o)",
    "DwordF2",
    "WordF3",
    "ByteF4",
    "Digit grouping",
  ]);
  await h.menu("view", "grouping");
  expect(h.saved()).toEqual({ view: "scientific", grouping: true });
  h.type("ffffffff");
  expect(h.display()).toBe("FFFF FFFF");
  expect(h.menuItems("view").at(-1)).toBe("Digit grouping (v)");
  // Clicking a menu twice closes it, and so does a click elsewhere.
  const viewMenu = h.win.querySelector('[data-calculator-menu="view"]');
  viewMenu.click();
  viewMenu.click();
  expect(Boolean(h.win.querySelector(".tm-menu"))).toBeFalse();
  viewMenu.click();
  h.win
    .querySelector(".tm-menu")
    .dispatchEvent(
      new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
    );
  expect(Boolean(h.win.querySelector(".tm-menu"))).toBeTrue();
  viewMenu.click();
  viewMenu.click();
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  expect(Boolean(h.win.querySelector(".tm-menu"))).toBeFalse();
  h.s.document.body.dispatchEvent(
    new h.s.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  // A key closes an open menu and still runs.
  viewMenu.click();
  h.key("Escape");
  expect(Boolean(h.win.querySelector(".tm-menu"))).toBeFalse();
});

test("missing, corrupt or unwritable settings fall back to Standard", async () => {
  for (const value of ["{", "null", '"scientific"', '{"view":"other"}']) {
    const h = await open({ storage: { calculatorSettings: value } });
    expect(h.win.style.width).toBe("260px");
    cleanupShells();
  }
  const h = await open({ failStorage: true });
  await h.menu("view", "scientific");
  expect(h.win.style.width).toBe("480px");
});

test("Copy and Paste", async () => {
  const h = await open({ clipboard: "12*3=" });
  h.type("8");
  await h.menu("edit", "copy");
  expect(h.copied).toEqual(["8"]);
  h.key("c", { ctrlKey: true });
  h.key("Insert", { ctrlKey: true });
  expect(h.copied).toEqual(["8", "8", "8"]);
  h.type("+0.5=");
  h.key("c", { ctrlKey: true });
  expect(h.copied.at(-1)).toBe("8.5");
  await h.menu("edit", "paste");
  expect(h.display()).toBe("36.");
  h.key("Insert", { shiftKey: true });
  await h.settle();
  expect(h.display()).toBe("36.");
  // Ctrl+V waits for the browser's paste event.
  expect(h.key("v", { ctrlKey: true }).defaultPrevented).toBeFalse();
  expect(
    h.key("м", { ctrlKey: true, code: "KeyV" }).defaultPrevented,
  ).toBeFalse();
  h.paste("2+2=");
  expect(h.display()).toBe("4.");
  // Garbage stops the paste at the first character calc.exe has no key for.
  h.key("Escape");
  h.paste("12😀3");
  expect(h.display()).toBe("12.");
  h.key("Escape");
  h.paste("١٢٣");
  expect(h.display()).toBe("0.");
  h.paste("1/0=5+");
  expect(h.display()).toBe("Cannot divide by zero.");
  h.key("Escape");
  h.paste("", false);
  expect(h.display()).toBe("0.");
  // Standard's % is percent, in pastes too.
  h.paste("200+10%");
  expect(h.display()).toBe("20.");
});

test("a refused or missing clipboard changes nothing", async () => {
  const h = await open({ clipboardFails: true });
  h.type("5");
  await h.menu("edit", "copy");
  await h.menu("edit", "paste");
  expect(h.display()).toBe("5.");
  cleanupShells();
  const bare = await open({ noClipboard: true });
  bare.type("5");
  await bare.menu("edit", "copy");
  await bare.menu("edit", "paste");
  expect(bare.display()).toBe("5.");
});

test("About Calculator, from the menu or Ctrl+Shift+K", async () => {
  const h = await open();
  await h.menu("help", "about");
  const about = [...h.s.document.querySelectorAll(".xp-dialog")].at(-1);
  expect(about.querySelector(".title-text").textContent).toBe(
    "About Calculator",
  );
  expect(about.querySelector(".about-windows-icon").getAttribute("src")).toBe(
    "assets/xp/calculator/Calculator-32.png",
  );
  // Keys go to the dialog while it is open.
  h.type("5");
  expect(h.display()).toBe("0.");
  about.querySelector('[data-action="ok"]').click();
  h.key("K", { ctrlKey: true, shiftKey: true });
  expect(h.s.document.querySelectorAll(".about-windows-dialog")).toHaveLength(
    1,
  );
});

test("the Statistics Box", async () => {
  const h = await open({
    storage: { calculatorSettings: JSON.stringify({ view: "scientific" }) },
  });
  h.key("s", { ctrlKey: true });
  const box = h.statisticsBox();
  expect(Boolean(box)).toBeTrue();
  expect(box.parentElement.classList.contains("xp-dialog-modeless")).toBeTrue();
  expect(h.button("ave").disabled).toBeFalse();
  const list = box.querySelector(".calculator-statistics");
  const count = () =>
    [...box.querySelectorAll(".xp-template-text")].at(-1).textContent;
  expect(count()).toBe("0");
  // Keys typed in the box stay there.
  list.dispatchEvent(
    new h.s.window.KeyboardEvent("keydown", { key: "5", bubbles: true }),
  );
  expect(h.display()).toBe("0.");
  const action = (id) => box.querySelector(`[data-action="${id}"]`).click();
  const before = h.sounds.length;
  action("load");
  action("cd");
  expect(h.sounds.length - before).toBe(2);
  h.type("1");
  h.key("Insert");
  h.type("2");
  h.click("dat");
  h.type("4.5");
  h.key("Insert");
  expect([...list.options].map((option) => option.text)).toEqual([
    "1.",
    "2.",
    "4.5",
  ]);
  expect(list.selectedIndex).toBe(2);
  expect(count()).toBe("3");
  h.key("a", { ctrlKey: true });
  expect(h.display()).toBe("2.5");
  h.key("t", { ctrlKey: true });
  expect(h.display()).toBe("7.5");
  h.key("d", { ctrlKey: true });
  expect(h.display()).toBe("1.8027756377319946465596106337352");
  list.selectedIndex = 0;
  action("load");
  expect(h.display()).toBe("1.");
  list.selectedIndex = 1;
  list.dispatchEvent(new h.s.window.MouseEvent("dblclick", { bubbles: true }));
  expect(h.display()).toBe("2.");
  action("cd");
  expect([...list.options].map((option) => option.text)).toEqual(["1.", "4.5"]);
  expect(list.selectedIndex).toBe(1);
  action("ret");
  expect(
    h.s.document.activeElement === h.win.querySelector(".xp-calculator"),
  ).toBeTrue();
  // Sta again focuses the open box.
  h.click("sta");
  expect(h.s.document.activeElement === list).toBeTrue();
  action("cad");
  expect(list.options).toHaveLength(0);
  expect(count()).toBe("0");
  // Closing the box clears it and disables the statistics keys.
  box.querySelector(".close-btn").click();
  expect(Boolean(h.statisticsBox())).toBeFalse();
  expect(h.button("ave").disabled).toBeTrue();
  // Changing the view closes it too.
  h.click("sta");
  await h.menu("view", "standard");
  expect(Boolean(h.statisticsBox())).toBeFalse();
});

test("closing Calculator closes its Statistics Box", async () => {
  const h = await open({
    storage: { calculatorSettings: JSON.stringify({ view: "scientific" }) },
  });
  h.click("sta");
  h.win.querySelector(".close-btn").click();
  await h.settle();
  expect(Boolean(h.statisticsBox())).toBeFalse();
  expect(
    Boolean(h.s.document.querySelector('.xp-window[data-game="__calculator"]')),
  ).toBeFalse();
});

test("Calculator's menus follow XP's menu bar rules", async () => {
  const h = await open();
  await checkMenuBar({
    s: h.s,
    win: h.win,
    control: h.win.querySelector(".xp-calculator"),
    accessKey: "e",
    settle: flushShell,
  });
});
