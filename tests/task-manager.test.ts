// @ts-nocheck -- Windows Task Manager through the real shell.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  clickStartAction,
  flushShell,
  loadShell,
  login,
} from "./helpers/shell-harness";
import { pointerAt } from "./helpers/hit-test";
import { checkMenuBar } from "./helpers/menu-bar";

afterEach(cleanupShells);

const settle = async () => {
  await flushShell();
  await flushShell();
};
const windowOf = (s, id) =>
  s.document.querySelector(`.xp-window[data-game="${id}"]`);
const openTaskManager = async (s) => {
  s.document
    .getElementById("taskbar")
    .dispatchEvent(
      new s.window.MouseEvent("contextmenu", { bubbles: true, clientY: 700 }),
    );
  s.document.querySelector('[data-taskbar-action="task-manager"]').click();
  await settle();
  return windowOf(s, "__task-manager");
};
const tab = (tm, id) => tm.querySelector(`[data-tm-tab="${id}"]`).click();
const menu = (tm, name) => tm.querySelector(`[data-tm-menu="${name}"]`).click();
const command = async (tm, name) => {
  tm.querySelector(`[data-tm-command="${name}"]`).click();
  await settle();
};
const menuCommand = async (tm, name, item) => {
  menu(tm, name);
  await command(tm, item);
};
const rows = (tm, list) =>
  [...tm.querySelectorAll(`.tm-${list} .tm-row`)].map((row) =>
    [...row.children].map((cell) => cell.textContent),
  );
const row = (tm, list, text) =>
  [...tm.querySelectorAll(`.tm-${list} .tm-row`)].find(
    (entry) => entry.firstElementChild.textContent === text,
  );
const answer = async (s, action) => {
  [...s.document.querySelectorAll(".xp-dialog")]
    .at(-1)
    .querySelector(`[data-action="${action}"]`)
    .click();
  await settle();
};
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
const runCommand = async (s, text) => {
  clickStartAction(s, "run");
  const dialog = s.document.querySelector(".run-dialog");
  dialog.querySelector("#run-command").value = text;
  dialog.querySelector('[data-action="run"]').click();
  await settle();
};
const openNotepad = async (s) => {
  const fs = s.window.VirtualFS;
  fs.open(fs.createFile(fs.MY_DOCUMENTS, "draft.txt").id);
  await settle();
};

test("Task Manager opens as XP's window with five pages, a status bar and a tray icon", async () => {
  const s = await login(await loadShell());
  const tm = await openTaskManager(s);
  expect([tm.style.left, tm.style.top]).toEqual(["10px", "10px"]);
  expect(tm.querySelector(".title-text").textContent).toBe(
    "Windows Task Manager",
  );
  expect(windowOf(s, "__task-manager").style.zIndex).toBe("6800");
  const tray = s.document.querySelector(
    '.tray-icon[aria-label="Windows Task Manager"]',
  );
  expect(tray.title).toMatch(/^CPU Usage: \d+%$/);
  expect(tray.style.backgroundImage).toContain("tray-");
  const status = () =>
    [...tm.querySelectorAll(".tm-status span")].map((pane) => pane.textContent);
  expect(status()[0]).toBe("Processes: 18");
  expect(status()[2]).toMatch(/^Commit Charge: \d+M \/ 1250M$/);

  const menus = () =>
    [...tm.querySelectorAll(".tm-menu-bar > button")].map(
      (button) => button.textContent,
    );
  expect(menus()).toEqual([
    "File",
    "Options",
    "View",
    "Windows",
    "Shut Down",
    "Help",
  ]);
  expect(tm.querySelector(".tm-tasks").textContent).toBe("TaskStatus");

  tab(tm, "processes");
  expect(menus()).not.toContain("Windows");
  expect(rows(tm, "processes")[0]).toEqual([
    "taskmgr.exe",
    "astro",
    expect.stringMatching(/^\d\d$/),
    expect.stringMatching(/^\d,\d{3} K$/),
  ]);
  // Its memory is its base working set plus what its window holds.
  expect(
    Number.parseInt(rows(tm, "processes")[0][3].replace(",", "")),
  ).toBeGreaterThan(3744);
  expect(rows(tm, "processes").at(-1)[0]).toBe("System Idle Process");
  const header = (index) =>
    tm.querySelector(`.tm-processes [data-tm-sort="${index}"]`).click();
  header(0);
  expect(rows(tm, "processes")[0][0]).toBe("alg.exe");
  header(0);
  expect(rows(tm, "processes")[0][0]).toBe("wuauclt.exe");
  header(1);
  expect(rows(tm, "processes")[0][1]).toBe("astro");
  expect(rows(tm, "processes").at(-1)[1]).toBe("SYSTEM");
  header(3);
  expect(rows(tm, "processes")[0][0]).toBe("System Idle Process");
  const allUsers = tm.querySelector(".tm-all-users input");
  allUsers.checked = true;
  allUsers.dispatchEvent(new s.window.Event("change"));
  expect(rows(tm, "processes")).toHaveLength(18);

  tab(tm, "performance");
  const value = (key) =>
    tm.querySelector(`[data-tm-value="${key}"]`).textContent;
  expect(value("processes")).toBe("18");
  expect(value("physical-total")).toBe("523696");
  expect(value("commit-limit")).toBe("1280180");
  expect(Number(value("commit-peak"))).toBeGreaterThanOrEqual(
    Number(value("commit-total")),
  );
  const [off, on] = tm.querySelectorAll(".tm-cpu-usage .tm-meter i");
  expect(
    Number.parseInt(off.style.height) + Number.parseInt(on.style.height),
  ).toBe(28);

  tab(tm, "networking");
  expect(menus()).toEqual(["File", "Options", "View", "Shut Down", "Help"]);
  menu(tm, "file");
  expect(tm.querySelector(".tm-menu").textContent).toBe("Exit Task Manager");
  expect(rows(tm, "adapters")).toEqual([
    ["Local Area Connection", "0 %", "100 Mbps", "Operational"],
  ]);
  row(tm, "adapters", "Local Area Connection").click();

  tab(tm, "users");
  expect(rows(tm, "users")).toEqual([["astro", "0", "Active", "", "Console"]]);
  expect(tm.querySelector(".tm-send-message").disabled).toBeTrue();
  row(tm, "users", "astro").click();

  // The page and settings come back with the next Task Manager.
  await menuCommand(tm, "file", "exit");
  expect(windowOf(s, "__task-manager")).toBeNull();
  expect(s.document.querySelector(".tray-icon[aria-label]")).not.toBeNull();
  expect(
    s.document.querySelector('.tray-icon[aria-label="Windows Task Manager"]'),
  ).toBeNull();
  const again = await openTaskManager(s);
  expect(
    again.querySelector('[data-tm-tab="users"]').getAttribute("aria-selected"),
  ).toBe("true");
  expect(again.querySelector('[data-tm-page="users"]').hidden).toBeFalse();
});

test("Task Manager menus check options, change the update speed and close on outside clicks", async () => {
  const s = await login(
    await loadShell({ initialStorage: { taskManager: "{" } }),
  );
  Object.defineProperty(
    s.document.getElementById("task-buttons"),
    "clientWidth",
    { value: 800 },
  );
  const tm = await openTaskManager(s);
  const item = (name) => tm.querySelector(`[data-tm-command="${name}"]`);
  menu(tm, "options");
  expect(item("always-on-top").className).toContain("checked");
  expect(item("minimize-on-use").className).toContain("checked");
  expect(item("hide-when-minimized").className).not.toContain("checked");
  menu(tm, "options");
  expect(tm.querySelector(".tm-menu")).toBeNull();

  // Always On Top keeps Task Manager above windows that open later.
  await menuCommand(tm, "options", "always-on-top");
  expect(tm.style.zIndex).not.toBe("6800");
  await menuCommand(tm, "options", "always-on-top");
  expect(tm.style.zIndex).toBe("6800");

  // Hide When Minimized drops the task button; the tray icon brings it back.
  await menuCommand(tm, "options", "hide-when-minimized");
  tm.querySelector(".minimize-btn").click();
  await settle();
  expect(
    s.document.querySelector('.task-button[data-game="__task-manager"]'),
  ).toBeNull();
  const tray = s.document.querySelector(
    '.tray-icon[aria-label="Windows Task Manager"]',
  );
  tray.dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  await settle();
  expect(tm.style.display).not.toBe("none");
  tray.dispatchEvent(new s.window.MouseEvent("click", { detail: 1 }));
  tm.querySelector(".minimize-btn").click();
  await settle();
  tray.click();
  await settle();
  expect(tm.style.display).not.toBe("none");
  expect(
    s.document.querySelector('.task-button[data-game="__task-manager"]'),
  ).not.toBeNull();

  // View → Update Speed, with Paused stopping the refresh.
  menu(tm, "view");
  const speed = tm.querySelector(".tm-submenu");
  expect(speed.textContent).toContain("Update Speed");
  speed.click();
  expect(speed.querySelector(".tm-menu").className).toContain("open");
  expect(item("speed-normal").className).toContain("radio");
  await command(tm, "speed-paused");
  const list = tm.querySelector(".tm-tasks");
  const before = list.firstElementChild;
  await s.advanceTime(5000);
  expect(list.firstElementChild).toBe(before);
  await menuCommand(tm, "view", "refresh");
  expect(list.firstElementChild).not.toBe(before);
  for (const name of ["speed-high", "speed-low", "speed-normal"]) {
    menu(tm, "view");
    await command(tm, name);
  }
  const current = list.firstElementChild;
  await s.advanceTime(2000);
  expect(list.firstElementChild).not.toBe(current);

  // Applications views.
  for (const view of ["large", "small", "details"]) {
    await menuCommand(tm, "view", `view-${view}`);
    expect(list.dataset.view).toBe(view);
  }

  // Performance → Show Kernel Times.
  tab(tm, "performance");
  await menuCommand(tm, "view", "kernel-times");
  menu(tm, "view");
  expect(item("kernel-times").className).toContain("checked");

  // Presses on a title or in the menu keep it; presses elsewhere close it,
  // also on the bar's empty part, like XP.
  tm.querySelector('[data-tm-menu="view"]').dispatchEvent(
    new s.window.Event("pointerdown", { bubbles: true }),
  );
  tm.querySelector(".tm-menu").dispatchEvent(
    new s.window.Event("pointerdown", { bubbles: true }),
  );
  expect(tm.querySelector(".tm-menu")).not.toBeNull();
  tm.querySelector(".tm-menu-bar").dispatchEvent(
    new s.window.Event("pointerdown", { bubbles: true }),
  );
  expect(tm.querySelector(".tm-menu")).toBeNull();
  menu(tm, "view");
  s.document.body.dispatchEvent(
    new s.window.Event("pointerdown", { bubbles: true }),
  );
  expect(tm.querySelector(".tm-menu")).toBeNull();
  expect(JSON.parse(s.window.localStorage.getItem("taskManager"))).toEqual(
    expect.objectContaining({
      alwaysOnTop: true,
      hideWhenMinimized: true,
      kernelTimes: true,
      speed: "normal",
      tab: "performance",
      view: "details",
    }),
  );
  tm.querySelector(".close-btn").click();
  await settle();
  s.document.body.dispatchEvent(
    new s.window.Event("pointerdown", { bubbles: true }),
  );
});

test("Task Manager ends, switches to and arranges real windows", async () => {
  const s = await login(await loadShell());
  withRuffle(s);
  await runCommand(s, "bike-mania");
  await openNotepad(s);
  clickStartAction(s, "documents");
  await settle();
  const tm = await openTaskManager(s);
  expect(rows(tm, "tasks").map(([task, status]) => [task, status])).toEqual([
    ["Bike Mania", "Running"],
    ["draft.txt - Notepad", "Running"],
    ["My Documents", "Running"],
  ]);
  const selected = () =>
    tm.querySelector('.tm-tasks [aria-selected="true"]').textContent;
  expect(selected()).toContain("Bike Mania");

  // The Windows menu acts on the selected window.
  row(tm, "tasks", "My Documents").click();
  await menuCommand(tm, "windows", "maximize");
  expect(windowOf(s, "__my-documents").className).toContain("maximized");
  await menuCommand(tm, "windows", "maximize");
  await menuCommand(tm, "windows", "minimize");
  expect(windowOf(s, "__my-documents").style.display).toBe("none");
  await menuCommand(tm, "windows", "bring-to-front");
  expect(windowOf(s, "__my-documents").style.display).not.toBe("none");
  for (const name of ["cascade", "tile-horizontal", "tile-vertical"])
    await menuCommand(tm, "windows", name);
  expect(windowOf(s, "__notepad").style.left).not.toBe("");

  // Switch To activates the window and minimizes Task Manager.
  row(tm, "tasks", "draft.txt - Notepad").click();
  row(tm, "tasks", "draft.txt - Notepad").dispatchEvent(
    new s.window.MouseEvent("dblclick", { bubbles: true }),
  );
  await settle();
  expect(windowOf(s, "__notepad").className).toContain("active");
  expect(tm.style.display).toBe("none");
  await openTaskManager(s);
  tm.querySelector(".tm-pane").dispatchEvent(
    new s.window.MouseEvent("dblclick", { bubbles: true }),
  );
  await menuCommand(tm, "options", "minimize-on-use");
  await command(tm, "switch-to");
  expect(tm.style.display).not.toBe("none");

  // Programs run in their own processes; folders run inside Explorer.
  tab(tm, "processes");
  const images = () => rows(tm, "processes").map(([image]) => image);
  expect(images().slice(0, 3)).toEqual([
    "taskmgr.exe",
    "notepad.exe",
    "SAFlashPlayer.exe",
  ]);
  expect(
    Number.parseInt(rows(tm, "processes")[2][3].replace(",", "")),
  ).toBeGreaterThanOrEqual(18240);

  // Critical processes can't be ended; the rest end after XP's warning.
  await command(tm, "end-process");
  row(tm, "processes", "csrss.exe").click();
  await command(tm, "end-process");
  expect(s.document.querySelector(".xp-dialog").textContent).toContain(
    "This is a critical system process.",
  );
  await answer(s, "ok");
  row(tm, "processes", "notepad.exe").click();
  await command(tm, "end-process");
  await answer(s, "no");
  expect(windowOf(s, "__notepad")).not.toBeNull();
  await command(tm, "end-process");
  await answer(s, "yes");
  expect(windowOf(s, "__notepad")).toBeNull();
  expect(images()).not.toContain("notepad.exe");
  row(tm, "processes", "explorer.exe").click();
  await command(tm, "end-process");
  await answer(s, "yes");
  expect(windowOf(s, "__my-documents")).toBeNull();
  expect(images()).toContain("explorer.exe");
  row(tm, "processes", "spoolsv.exe").click();
  await command(tm, "end-process");
  await answer(s, "yes");
  expect(images()).not.toContain("spoolsv.exe");

  // End Task closes the selected window.
  tab(tm, "applications");
  tm.querySelector(".tm-tasks [data-tm-sort]").click();
  expect(rows(tm, "tasks").map(([task]) => task)).toEqual(["Bike Mania"]);
  await command(tm, "end-task");
  expect(windowOf(s, "bike-mania")).toBeNull();
  expect(tm.querySelector(".tm-tasks .tm-row")).toBeNull();

  // With nothing selected, the window commands do nothing.
  await command(tm, "end-task");
  await command(tm, "switch-to");
  for (const name of ["bring-to-front", "minimize", "maximize"])
    await menuCommand(tm, "windows", name);

  tab(tm, "processes");
  row(tm, "processes", "taskmgr.exe").click();
  await command(tm, "end-process");
  await answer(s, "yes");
  expect(windowOf(s, "__task-manager")).toBeNull();
});

test("Task Manager starts tasks, shows About and runs Shut Down commands", async () => {
  const s = await login(await loadShell());
  const tm = await openTaskManager(s);
  await command(tm, "new-task");
  expect(s.document.querySelector(".run-dialog .title-text").textContent).toBe(
    "Create New Task",
  );
  // Like XP, New Task keeps the keys of Task Manager. Run itself is
  // modeless.
  expect(
    s.document.querySelector(".run-dialog").getAttribute("aria-modal"),
  ).toBe("true");
  s.document.querySelector('.run-dialog [data-action="cancel"]').click();
  await menuCommand(tm, "help", "about");
  const about = s.document.querySelector(".about-windows-dialog");
  expect(about.querySelector(".title-text").textContent).toBe(
    "About Windows Task Manager",
  );
  expect(about.querySelector(".about-windows-icon").src).toContain(
    "icon-32.png",
  );
  expect(about.textContent).toContain("Microsoft ® Windows Task Manager");
  await answer(s, "ok");

  await menuCommand(tm, "shutdown", "stand-by");
  expect(s.document.getElementById("standby-screen").hidden).toBeFalse();
  s.document.getElementById("standby-resume").click();

  tab(tm, "users");
  await command(tm, "logoff-user");
  await answer(s, "no");
  expect(s.document.getElementById("desktop").hidden).toBeFalse();
  await command(tm, "disconnect");
  expect(s.document.getElementById("welcome-screen").hidden).toBeFalse();
});

test("Task Manager's Shut Down menu turns off, restarts, logs off and switches users", async () => {
  for (const [name, check] of [
    ["turn-off", (s) => !s.document.getElementById("turn-off-screen").hidden],
    ["restart", (s) => !s.document.getElementById("boot-screen").hidden],
    ["log-off", (s) => !s.document.getElementById("welcome-screen").hidden],
    ["switch-user", (s) => !s.document.getElementById("welcome-screen").hidden],
    ["logoff-user", (s) => !s.document.getElementById("welcome-screen").hidden],
  ]) {
    const s = await login(await loadShell());
    const tm = await openTaskManager(s);
    if (name === "logoff-user") {
      tab(tm, "users");
      await command(tm, name);
      await answer(s, "yes");
    } else await menuCommand(tm, "shutdown", name);
    await s.advanceTime(2000);
    expect([name, check(s)]).toEqual([name, true]);
  }
});

test("Ctrl+Shift+Esc opens Task Manager, which measures CPU from late frames and graphs downloads", async () => {
  let frame;
  let canceled = false;
  let download;
  let disconnected = false;
  const s = await login(
    await loadShell({
      beforeScripts: (window) => {
        window.requestAnimationFrame = (callback) => {
          frame = callback;
          return 7;
        };
        window.cancelAnimationFrame = (id) => (canceled = id === 7);
        window.PerformanceObserver = class {
          constructor(callback) {
            download = callback;
          }
          observe() {}
          disconnect() {
            disconnected = true;
          }
        };
      },
    }),
  );
  withRuffle(s);
  await runCommand(s, "bike-mania");
  s.document.body.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Escape",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
  await settle();
  const tm = windowOf(s, "__task-manager");
  const cpu = () =>
    tm.querySelector(".tm-status span:nth-child(2)").textContent;

  // Frames that run late count as busy time for the active program.
  frame(0);
  frame(16);
  frame(1e9);
  await menuCommand(tm, "view", "refresh");
  expect(cpu()).toBe("CPU Usage: 100%");
  expect(
    s.document.querySelector('.tray-icon[aria-label="Windows Task Manager"]')
      .style.backgroundImage,
  ).toContain("tray-11");
  tab(tm, "processes");
  expect(row(tm, "processes", "taskmgr.exe").children[2].textContent).toBe(
    "100",
  );
  s.document
    .querySelector('.xp-window[data-game="bike-mania"]')
    .dispatchEvent(new s.window.Event("pointerdown", { bubbles: true }));
  frame(2e9);
  // The update timer samples while the other program stays active. A press
  // on Task Manager's menu makes Task Manager active, like XP.
  await s.advanceTime(2000);
  expect(
    row(tm, "processes", "SAFlashPlayer.exe").children[2].textContent,
  ).toBe("100");
  clickStartAction(s, "documents");
  await settle();
  await s.advanceTime(2000);
  expect(row(tm, "processes", "explorer.exe").children[2].textContent).toBe(
    "00",
  );

  // Networking graphs the page's downloads against the 100 Mbps link.
  tab(tm, "networking");
  const utilization = () => rows(tm, "adapters")[0][1];
  download({ getEntries: () => [{ transferSize: 50_000 }] });
  await menuCommand(tm, "view", "refresh");
  expect(utilization()).not.toBe("0 %");
  download({ getEntries: () => [{ transferSize: 1e12 }] });
  await menuCommand(tm, "view", "refresh");
  for (const name of [
    "auto-scale",
    "auto-scale",
    "show-scale",
    "show-scale",
    "tab-always-active",
    "reset",
  ])
    await menuCommand(tm, "options", name);
  for (const line of ["sent", "received", "total"]) {
    menu(tm, "view");
    await command(tm, `history-${line}`);
  }
  menu(tm, "options");
  expect(
    tm.querySelector('[data-tm-command="tab-always-active"]').className,
  ).toContain("checked");
  menu(tm, "options");
  expect(
    JSON.parse(s.window.localStorage.getItem("taskManager")).history,
  ).toEqual({ sent: true, received: true, total: false });

  // Off the page, history only grows with Tab Always Active.
  tab(tm, "users");
  await menuCommand(tm, "view", "refresh");
  Object.defineProperty(s.window.navigator, "onLine", { value: false });
  tab(tm, "networking");
  expect(rows(tm, "adapters")[0][3]).toBe("Disconnected");

  tm.querySelector(".close-btn").click();
  await settle();
  expect([canceled, disconnected]).toEqual([true, true]);
});

test("Task Manager's menus follow XP's menu bar rules", async () => {
  const s = await login(await loadShell());
  const tm = await openTaskManager(s);
  await checkMenuBar({
    s,
    win: tm,
    control: tm.querySelector('[data-tm-tab][aria-selected="true"]'),
    accessKey: "f",
    settle,
  });
});

test("Task Manager's Update Speed submenu works from the keys and the pointer", async () => {
  const s = await login(await loadShell());
  const tm = await openTaskManager(s);
  const active = () => s.document.activeElement;
  const key = async (target, name, init = {}) => {
    target.dispatchEvent(
      new s.window.KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
    await settle();
  };
  const control = tm.querySelector('[data-tm-tab][aria-selected="true"]');
  control.focus();
  await key(control, "v", { altKey: true });
  const parent = tm.querySelector(".tm-submenu");
  const submenu = parent.querySelector(".tm-menu");
  // The keys rest on the submenu's parent, like on an item.
  await key(active(), "ArrowDown");
  expect(active() === parent).toBeTrue();
  expect(parent.getAttribute("aria-haspopup")).toBe("menu");
  // Right opens the submenu with the keys on its first item; Left closes it.
  await key(parent, "ArrowRight");
  expect(submenu.classList.contains("open")).toBeTrue();
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  expect(active().dataset.tmCommand).toBe("speed-high");
  await key(active(), "ArrowUp");
  expect(active().dataset.tmCommand).toBe("speed-paused");
  await key(active(), "ArrowLeft");
  expect(active() === parent).toBeTrue();
  expect(submenu.classList.contains("open")).toBeFalse();
  // Enter opens it too, and Escape closes only the submenu, like XP.
  await key(parent, "Enter");
  expect(active().dataset.tmCommand).toBe("speed-high");
  await key(active(), "Escape");
  expect(active() === parent).toBeTrue();
  expect(submenu.classList.contains("open")).toBeFalse();
  expect(tm.querySelector(".tm-menu") === null).toBeFalse();
  // The pointer on another item closes a submenu that the keys opened.
  await key(parent, " ");
  expect(submenu.classList.contains("open")).toBeTrue();
  const refresh = tm.querySelector('[data-tm-command="refresh"]');
  refresh.dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(submenu.classList.contains("open")).toBeFalse();
  expect(active() === refresh).toBeTrue();
  // The pointer on the parent keeps its submenu, and an item in the
  // submenu takes the keys.
  await key(refresh, "ArrowDown");
  await key(parent, "ArrowRight");
  parent.dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(submenu.classList.contains("open")).toBeTrue();
  const low = submenu.querySelector('[data-tm-command="speed-low"]');
  low.dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(active() === low).toBeTrue();
  // The submenu's own edge is not its parent: the pointer there moves
  // nothing, and a click there closes nothing.
  submenu.dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(active() === low).toBeTrue();
  submenu.click();
  expect(submenu.classList.contains("open")).toBeTrue();
  expect(active() === low).toBeTrue();
  // A gray item cannot take the keys, so the pointer on one gives them to
  // the parent before its submenu closes.
  refresh.disabled = true;
  refresh.dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  expect(submenu.classList.contains("open")).toBeFalse();
  expect(active() === parent).toBeTrue();
  refresh.disabled = false;
  await key(parent, "ArrowRight");
  low.dispatchEvent(
    new s.window.PointerEvent("pointerover", { bubbles: true }),
  );
  // A click on the parent toggles the submenu.
  parent.click();
  expect(submenu.classList.contains("open")).toBeFalse();
  parent.click();
  expect(submenu.classList.contains("open")).toBeTrue();
  // Keys outside a submenu do not move to its parent when it closes.
  refresh.focus();
  pointerAt(s, refresh, "pointerover");
  expect(submenu.classList.contains("open")).toBeFalse();
  expect(active() === refresh).toBeTrue();
  parent.click();
  expect(submenu.classList.contains("open")).toBeTrue();
  // Choosing an item closes every menu and gives the keys back.
  low.click();
  await settle();
  expect(tm.querySelector(".tm-menu")).toBeNull();
  expect(active() === control).toBeTrue();
  expect(JSON.parse(s.window.localStorage.getItem("taskManager")).speed).toBe(
    "low",
  );
});

test("a Task Manager column header keeps the keys when the list is drawn again", async () => {
  const s = await login(await loadShell());
  const tm = await openTaskManager(s);
  tab(tm, "processes");
  await settle();
  const header = (index) =>
    tm.querySelector(`.tm-processes [data-tm-sort="${index}"]`);
  const name = header(0);
  name.focus();
  name.click();
  await settle();
  expect(name.isConnected).toBeFalse();
  expect(s.document.activeElement === header(0)).toBeTrue();
  // The same after the list updates on its own.
  await s.advanceTime(2000);
  expect(s.document.activeElement === header(0)).toBeTrue();
  // The list itself keeps the keys.
  tm.querySelector(".tm-processes").focus();
  header(1).click();
  await settle();
  expect(
    s.document.activeElement === tm.querySelector(".tm-processes"),
  ).toBeTrue();
});
