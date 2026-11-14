// @ts-nocheck -- Task buttons, grouping and Task Manager through the real shell.
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
  await flushShell();
  await flushShell();
};
const press = (s, target, key, options = {}) =>
  target.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
const context = (s, target) =>
  target.dispatchEvent(
    new s.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 700,
    }),
  );
const overflowMenu = (s) => s.document.getElementById("taskbar-overflow-menu");
const windowOf = (s, id) =>
  s.document.querySelector(`.xp-window[data-game="${id}"]`);
const hidden = (s, id) => windowOf(s, id).style.display === "none";

async function openWindows(options = {}) {
  const s = await login(await loadShell(options));
  const fs = s.window.VirtualFS;
  for (const action of ["documents", "pictures", "music"])
    clickStartAction(s, action);
  fs.open(fs.createFile(fs.MY_DOCUMENTS, "memo.txt").id);
  await settle();
  return s;
}

test("the task overflow menu groups Explorer windows and marks attention", async () => {
  const s = await openWindows();
  s.window.XPShell.setWindowAttention("__my-pictures");
  const overflow = s.document.querySelector(
    "#task-buttons .task-button-grouped",
  );
  expect(overflow.className).toContain("needs-attention");
  expect(overflow.getAttribute("aria-label")).toContain("needs attention");
  overflow.click();
  const menu = overflowMenu(s);
  expect(menu.querySelector(".taskbar-group-heading").textContent).toBe(
    "Windows Explorer (3)",
  );
  const items = [...menu.querySelectorAll(".taskbar-overflow-item")];
  expect(items).toHaveLength(4);
  expect(
    items.some((item) => item.className.includes("needs-attention")),
  ).toBeTrue();
  context(s, items[0]);
  expect(s.document.getElementById("window-system-menu").hidden).toBeFalse();
  press(s, s.document.body, "Escape");
  overflow.click();
  overflowMenu(s).querySelector(".taskbar-overflow-item").click();
  await settle();
});

test("grouped Explorer buttons list, arrange, minimize and close their windows", async () => {
  const s = await openWindows({
    initialStorage: {
      taskbarSettings: JSON.stringify({ group: true, locked: false }),
    },
  });
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    {
      value: 330,
    },
  );
  s.window.dispatchEvent(new s.window.Event("resize"));
  const group = () =>
    s.document.querySelector("#task-buttons .task-button-grouped");
  expect(group().textContent).toContain("3 Windows Explorer");
  group().click();
  const members = [...overflowMenu(s).querySelectorAll("button")];
  expect(members.map((item) => item.textContent)).toEqual([
    "My Documents",
    "My Pictures",
    "My Music",
  ]);
  members[1].click();
  await settle();
  const groupMenu = () => {
    context(s, group());
    return overflowMenu(s);
  };
  const choose = async (label) => {
    [...groupMenu().querySelectorAll("button")]
      .find((item) => item.textContent === label)
      .click();
    await settle();
  };
  for (const label of ["Cascade", "Tile Horizontally", "Tile Vertically"])
    await choose(label);
  await choose("Minimize Group");
  expect(
    ["__my-documents", "__my-pictures", "__my-music"].every((id) =>
      hidden(s, id),
    ),
  ).toBeTrue();
  expect(
    [...groupMenu().querySelectorAll("button")].find(
      (item) => item.textContent === "Minimize Group",
    ).disabled,
  ).toBeTrue();
  press(s, s.document.body, "Escape");
  await choose("Close Group");
  expect(!!windowOf(s, "__my-documents")).toBeFalse();
  expect(!!windowOf(s, "__my-music")).toBeFalse();
});

test("task buttons minimize the active window and restore it on the next click", async () => {
  const s = await login(await loadShell());
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    {
      value: 800,
    },
  );
  clickStartAction(s, "documents");
  await settle();
  const button = () =>
    s.document.querySelector('.task-button[data-game="__my-documents"]');
  button().click();
  await settle();
  expect(hidden(s, "__my-documents")).toBeTrue();
  expect(button().getAttribute("aria-label")).toContain("minimized");
  button().click();
  await settle();
  expect(hidden(s, "__my-documents")).toBeFalse();
  context(s, button());
  expect(s.document.getElementById("window-system-menu").hidden).toBeFalse();
});

test("taskbar menus activate items from the keyboard and ignore nested menus", async () => {
  const s = await login(await loadShell());
  context(s, s.document.getElementById("taskbar"));
  const menu = s.document.getElementById("taskbar-context-menu");
  const lock = menu.querySelector('[data-taskbar-action="lock"]');
  lock.focus();
  press(s, lock, "Enter");
  expect(menu.hidden).toBeTrue();
  context(s, s.document.getElementById("taskbar"));
  const nested = s.document.createElement("div");
  nested.setAttribute("role", "menu");
  const inner = s.document.createElement("button");
  nested.append(inner);
  menu.append(nested);
  press(s, inner, "ArrowDown");
  nested.remove();
  press(s, menu, "x");
  const empty = s.document.getElementById("taskbar-overflow-menu");
  empty.replaceChildren();
  empty.hidden = false;
  press(s, empty, "ArrowDown");
  const toolbars = menu.querySelector('[data-taskbar-action="toolbars"]');
  toolbars.focus();
  press(s, toolbars, " ");
});

test("taskbar properties switch Start menu styles and customize notifications", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        taskbarSettings: JSON.stringify({ group: true, locked: false }),
        startMenuStyle: "classic",
      },
    }),
  );
  const open = () => {
    context(s, s.document.getElementById("taskbar"));
    s.document.querySelector('[data-taskbar-action="properties"]').click();
    return [...s.document.querySelectorAll(".taskbar-properties-dialog")].at(
      -1,
    );
  };
  const dialog = open();
  const preview = () =>
    dialog.querySelector(".taskbar-start-menu-preview").getAttribute("src");
  const style = (value) => {
    const radio = dialog.querySelector(
      `[name="taskbar-start-menu-style"][value="${value}"]`,
    );
    radio.checked = true;
    radio.dispatchEvent(new s.window.Event("change", { bubbles: true }));
  };
  dialog.querySelector('[data-taskbar-properties-tab="start-menu"]').click();
  style("start");
  expect(preview()).toContain("StartMenuPreview");
  style("classic");
  expect(preview()).toContain("ClassicStartMenuPreview");
  dialog.querySelector("[data-customize-tray]").click();
  const customize = () =>
    s.document.querySelector(".taskbar-customize-notifications");
  customize().querySelector("select").value = "show";
  customize().querySelector('[data-action="defaults"]').click();
  expect(customize().querySelector("select").value).toBe("auto");
  customize().querySelector('[data-action="cancel"]').click();
  expect(customize()).toBeNull();
  dialog.querySelector('[data-action="cancel"]').click();
  expect(dialog.isConnected).toBeFalse();
});

test("the taskbar Toolbars submenu toggles toolbars and arranges windows from the menu", async () => {
  const s = await login(
    await loadShell({
      initialStorage: {
        clockOffsetMs: "soon",
        taskbarSettings: JSON.stringify({ edge: "top", locked: false }),
      },
    }),
  );
  const menu = () => {
    context(s, s.document.getElementById("taskbar"));
    return s.document.getElementById("taskbar-context-menu");
  };
  Object.defineProperty(s.window, "innerWidth", {
    configurable: true,
    value: -1,
  });
  const toolbars = s.document.querySelector(
    '#taskbar-context-menu [data-taskbar-action="toolbars"]',
  );
  menu();
  toolbars.click();
  const submenu = s.document.getElementById("taskbar-toolbar-submenu");
  expect(submenu.style.left).not.toBe("calc(100% - 2px)");
  press(s, toolbars, "a");
  press(s, toolbars, "ArrowRight");
  press(s, submenu, "a");
  press(s, submenu, "ArrowLeft");
  expect(toolbars.getAttribute("aria-expanded")).toBe("false");
  press(s, toolbars, "ArrowRight");
  press(s, submenu, "Escape");
  submenu.dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  for (const toolbar of ["desktop", "quick-launch"]) {
    menu();
    s.document
      .querySelector(
        `#taskbar-toolbar-submenu [data-taskbar-toolbar="${toolbar}"]`,
      )
      .click();
  }
  const settings = JSON.parse(s.window.localStorage.getItem("taskbarSettings"));
  expect(settings.desktopToolbar).toBeTrue();
  menu().dispatchEvent(new s.window.MouseEvent("click", { bubbles: true }));
  clickStartAction(s, "documents");
  clickStartAction(s, "pictures");
  await settle();
  s.document
    .querySelector('.xp-window[data-game="__my-documents"] .maximize-btn')
    .click();
  for (const action of ["cascade", "tile-horizontal", "properties"]) {
    menu().querySelector(`[data-taskbar-action="${action}"]`).click();
    await settle();
  }
  expect(!!s.document.querySelector(".taskbar-properties-dialog")).toBeTrue();
  expect(s.document.getElementById("taskbar-clock").textContent).not.toBe("");
});

test("vertical taskbars group Explorer windows and overflow by height", async () => {
  const s = await openWindows({
    initialStorage: {
      taskbarSettings: JSON.stringify({
        edge: "left",
        group: true,
        locked: false,
      }),
    },
  });
  const container = s.document.getElementById("task-buttons");
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: 60,
  });
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  expect(
    s.document.querySelector("#task-buttons .task-button-grouped").textContent,
  ).toMatch(/Windows Explorer|windows/);
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: 400,
  });
  s.window.dispatchEvent(new s.window.Event("resize"));
  await settle();
  expect(container.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
});

const withRuffle = (s) => {
  s.window.RufflePlayer = {
    newest: () => ({
      createPlayer: () => {
        const player = s.document.createElement("ruffle-player");
        player.load = () => {};
        return player;
      },
    }),
  };
};
const runCommand = async (s, command) => {
  clickStartAction(s, "run");
  const dialog = s.document.querySelector(".run-dialog");
  dialog.querySelector(".run-command").value = command;
  dialog.querySelector('[data-action="run"]').click();
  await settle();
};
const openDirtyNotepad = async (s) => {
  const fs = s.window.VirtualFS;
  fs.open(fs.createFile(fs.MY_DOCUMENTS, "draft.txt").id);
  await settle();
  const editor = s.document.querySelector(".notepad-window textarea");
  editor.value = "unsaved";
  editor.dispatchEvent(new s.window.Event("input", { bubbles: true }));
};

test("the overflow menu names untitled game windows and marks minimized ones", async () => {
  const s = await login(await loadShell());
  withRuffle(s);
  await runCommand(s, "bike-mania");
  await openDirtyNotepad(s);
  clickStartAction(s, "documents");
  await settle();
  s.document
    .querySelector('.xp-window[data-game="__notepad"] .minimize-btn')
    .click();
  await settle();
  s.document.querySelector("#task-buttons .task-button-grouped").click();
  const menu = overflowMenu(s);
  expect(menu.querySelector(".taskbar-group-heading")).toBeNull();
  const labels = [...menu.querySelectorAll(".taskbar-overflow-item")].map(
    (item) => [item.textContent, item.getAttribute("aria-label")],
  );
  expect(labels).toContainEqual(["Bike Mania", "Bike Mania"]);
  expect(labels.some(([, label]) => label.endsWith(", minimized"))).toBeTrue();
});

test("Task Manager selects only the first task and keeps windows that refuse to end", async () => {
  const s = await login(await loadShell());
  withRuffle(s);
  await runCommand(s, "bike-mania");
  await openDirtyNotepad(s);
  context(s, s.document.getElementById("taskbar"));
  s.document.querySelector('[data-taskbar-action="task-manager"]').click();
  await settle();
  const manager = windowOf(s, "__task-manager");
  const rows = () => [...manager.querySelectorAll(".tm-tasks .tm-row")];
  expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
    "true",
    "false",
  ]);
  expect(rows()[0].textContent).toContain("Bike Mania");
  rows()[1].click();
  manager.querySelector('[data-tm-command="end-task"]').click();
  await settle();
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector('[data-action="cancel"]')
    .click();
  await settle();
  expect(rows()).toHaveLength(2);
  expect(windowOf(s, "__notepad")).not.toBeNull();
});

test("arranging windows does nothing while every window is minimized", async () => {
  const s = await login(await loadShell());
  clickStartAction(s, "documents");
  await settle();
  const win = windowOf(s, "__my-documents");
  const before = [win.style.left, win.style.top];
  win.querySelector(".minimize-btn").click();
  await settle();
  context(s, s.document.getElementById("taskbar"));
  const cascade = s.document.querySelector('[data-taskbar-action="cascade"]');
  expect(cascade.disabled).toBeTrue();
  context(s, s.document.getElementById("taskbar"));
  s.document.querySelector('[data-taskbar-action="task-manager"]').click();
  await settle();
  const manager = windowOf(s, "__task-manager");
  manager.querySelector('[data-tm-menu="windows"]').click();
  manager.querySelector('[data-tm-command="cascade"]').click();
  await settle();
  expect([win.style.left, win.style.top]).toEqual(before);
  expect(win.style.display).toBe("none");
});

test("Taskbar Properties leaves Group similar buttons unchecked when grouping is off", async () => {
  const s = await login(
    await loadShell({
      initialStorage: { taskbarSettings: JSON.stringify({ group: false }) },
    }),
  );
  context(s, s.document.getElementById("taskbar"));
  s.document.querySelector('[data-taskbar-action="properties"]').click();
  expect(
    s.document.querySelector('[data-taskbar-setting="group"]').checked,
  ).toBeFalse();
});
