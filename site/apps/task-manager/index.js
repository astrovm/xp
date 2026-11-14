import { defineApplication } from "../core/application.js";
import { wireMenuBar } from "../core/menu-bar.js";
import { applicationMetadata } from "./metadata.js";

const USER = globalThis.VirtualFS.USER_NAME;
// Full paths, so the build can fingerprint them.
const TRAY_ICONS = [
  "assets/xp/task-manager/tray-0.png",
  "assets/xp/task-manager/tray-1.png",
  "assets/xp/task-manager/tray-2.png",
  "assets/xp/task-manager/tray-3.png",
  "assets/xp/task-manager/tray-4.png",
  "assets/xp/task-manager/tray-5.png",
  "assets/xp/task-manager/tray-6.png",
  "assets/xp/task-manager/tray-7.png",
  "assets/xp/task-manager/tray-8.png",
  "assets/xp/task-manager/tray-9.png",
  "assets/xp/task-manager/tray-10.png",
  "assets/xp/task-manager/tray-11.png",
];
const PHYSICAL_MEMORY_K = 523696;
const COMMIT_LIMIT_K = 1280180;
// View → Update Speed, from taskmgr.exe's menu help strings.
const UPDATE_SPEEDS = { high: 500, normal: 2000, low: 4000, paused: 0 };
const GRAPH_GRID = 12;
// A frame later than this counts as busy time.
const FRAME_BUDGET = 20;
// XP draws kernel time in red. The browser can't tell it apart, so it's an
// estimate of the share XP typically shows.
const KERNEL_SHARE = 0.4;

// The reference install's processes, oldest first. Each is
// [image, user, memory K, handles, threads].
const BASE_PROCESSES = [
  ["System Idle Process", "SYSTEM", 16, 0, 1],
  ["System", "SYSTEM", 212, 254, 56],
  ["smss.exe", "SYSTEM", 372, 21, 3],
  ["csrss.exe", "SYSTEM", 2844, 383, 11],
  ["winlogon.exe", "SYSTEM", 5224, 507, 19],
  ["services.exe", "SYSTEM", 2932, 262, 16],
  ["lsass.exe", "SYSTEM", 980, 335, 19],
  ["svchost.exe", "SYSTEM", 4208, 196, 17],
  ["svchost.exe", "NETWORK SERVICE", 3872, 231, 10],
  ["svchost.exe", "SYSTEM", 16024, 1189, 61],
  ["svchost.exe", "NETWORK SERVICE", 2644, 82, 5],
  ["svchost.exe", "LOCAL SERVICE", 4096, 152, 12],
  ["explorer.exe", USER, 10888, 351, 13],
  ["spoolsv.exe", "SYSTEM", 4356, 121, 10],
  ["alg.exe", "LOCAL SERVICE", 3320, 104, 6],
  ["wscntfy.exe", USER, 1840, 39, 1],
  ["wuauclt.exe", "SYSTEM", 6432, 182, 5],
];
// Ending these is refused, as XP refuses its critical system processes.
const CRITICAL = new Set([
  "System Idle Process",
  "System",
  "smss.exe",
  "csrss.exe",
  "winlogon.exe",
  "services.exe",
  "lsass.exe",
]);

// Programs that run in their own process, with XP's image names and a
// typical working set. Folders and Control Panel run inside explorer.exe.
const PROGRAM_IMAGES = {
  __notepad: ["notepad.exe", 2932],
  __paint: ["mspaint.exe", 5428],
  __minesweeper: ["winmine.exe", 2412],
  __pinball: ["PINBALL.EXE", 9836],
  "__command-prompt": ["cmd.exe", 1612],
  "__volume-control": ["sndvol32.exe", 2148],
  "__task-manager": ["taskmgr.exe", 3744],
  __calculator: ["calc.exe", 3360],
  __hearts: ["mshearts.exe", 3360],
};
const GAME_IMAGES = {
  swf: ["SAFlashPlayer.exe", 18240],
  iframe: ["iexplore.exe", 21364],
};

// taskmgr.exe's menus, by page. Items are [label, command, help] with "-"
// for separators; a nested array is a submenu.
const UPDATE_SPEED_MENU = [
  "&Update Speed",
  [
    ["&High", "speed-high"],
    ["&Normal", "speed-normal"],
    ["&Low", "speed-low"],
    ["&Paused", "speed-paused"],
  ],
];
const OPTIONS = [
  ["&Always On Top", "always-on-top"],
  ["&Minimize On Use", "minimize-on-use"],
  ["&Hide When Minimized", "hide-when-minimized"],
];
const SHUT_DOWN = [
  ["Stand &By", "stand-by"],
  ["T&urn Off", "turn-off"],
  ["&Restart", "restart"],
  [`&Log Off ${USER}`, "log-off"],
  ["&Switch User", "switch-user", "WinKey+L"],
];
// There is no Help and Support Center, so Help only has About.
const HELP = [["&About Task Manager", "about"]];
const FILE_MENU = [
  ["&New Task (Run...)", "new-task"],
  "-",
  ["E&xit Task Manager", "exit"],
];
const MENUS = {
  applications: [
    ["&File", FILE_MENU],
    ["&Options", OPTIONS],
    [
      "&View",
      [
        ["&Refresh Now", "refresh"],
        UPDATE_SPEED_MENU,
        "-",
        ["Lar&ge Icons", "view-large"],
        ["S&mall Icons", "view-small"],
        ["&Details", "view-details"],
      ],
    ],
    [
      "&Windows",
      [
        ["Tile &Horizontally", "tile-horizontal"],
        ["Tile &Vertically", "tile-vertical"],
        ["&Minimize", "minimize"],
        ["Ma&ximize", "maximize"],
        ["&Cascade", "cascade"],
        ["&Bring To Front", "bring-to-front"],
      ],
    ],
    ["Sh&ut Down", SHUT_DOWN],
    ["&Help", HELP],
  ],
  processes: [
    ["&File", FILE_MENU],
    ["&Options", OPTIONS],
    ["&View", [["&Refresh Now", "refresh"], UPDATE_SPEED_MENU]],
    ["Sh&ut Down", SHUT_DOWN],
    ["&Help", HELP],
  ],
  performance: [
    ["&File", FILE_MENU],
    ["&Options", OPTIONS],
    [
      "&View",
      [
        ["&Refresh Now", "refresh"],
        UPDATE_SPEED_MENU,
        "-",
        ["&Show Kernel Times", "kernel-times"],
      ],
    ],
    ["Sh&ut Down", SHUT_DOWN],
    ["&Help", HELP],
  ],
  networking: [
    ["&File", [["E&xit Task Manager", "exit"]]],
    [
      "&Options",
      [
        ...OPTIONS,
        "-",
        ["&Tab Always Active", "tab-always-active"],
        ["A&uto Scale", "auto-scale"],
        ["&Reset", "reset"],
        ["&Show Scale", "show-scale"],
      ],
    ],
    [
      "&View",
      [
        ["&Refresh Now", "refresh"],
        UPDATE_SPEED_MENU,
        "-",
        [
          "&Network Adapter History",
          [
            ["Bytes &Sent", "history-sent", "(Red)"],
            ["Bytes &Received", "history-received", "(Yellow)"],
            ["Bytes &Total", "history-total", "(Green)"],
          ],
        ],
      ],
    ],
    ["Sh&ut Down", SHUT_DOWN],
    ["&Help", HELP],
  ],
  users: [
    ["&File", FILE_MENU],
    ["&Options", OPTIONS],
    ["&View", [["&Refresh Now", "refresh"], UPDATE_SPEED_MENU]],
    ["Sh&ut Down", SHUT_DOWN],
    ["&Help", HELP],
  ],
};
const TABS = [
  ["applications", "Applications"],
  ["processes", "Processes"],
  ["performance", "Performance"],
  ["networking", "Networking"],
  ["users", "Users"],
];
const SETTINGS_KEY = "taskManager";
const DEFAULT_SETTINGS = {
  tab: "applications",
  alwaysOnTop: true,
  minimizeOnUse: true,
  hideWhenMinimized: false,
  kernelTimes: false,
  speed: "normal",
  view: "details",
  tabAlwaysActive: false,
  autoScale: true,
  showScale: true,
  history: { sent: false, received: false, total: true },
};

const readSettings = () => {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    // Unreadable settings fall back to XP's defaults.
  }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    history: { ...DEFAULT_SETTINGS.history, ...stored.history },
  };
};

const escapeText = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const formatK = (value) => `${value.toLocaleString("en-US")} K`;

const groupBox = (className, title, rows) =>
  `<fieldset class="dlg-group ${className}"><legend>${title}</legend>${rows
    .map(
      ([label, key]) =>
        `<span>${label}</span><span data-tm-value="${key}"></span>`,
    )
    .join("")}</fieldset>`;

const mountTaskManager = (context, { window: win }) => {
  const settings = readSettings();
  const saveSettings = () =>
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  const root = document.createElement("div");
  root.className = "task-manager";
  root.innerHTML = `
    <div class="tm-menu-bar" role="menubar"></div>
    <div class="tm-tabs" role="tablist" aria-label="Windows Task Manager">${TABS.map(
      ([id, label]) =>
        `<button type="button" role="tab" data-tm-tab="${id}">${label}</button>`,
    ).join("")}</div>
    <div class="tm-pane">
      <section class="tm-page" data-tm-page="applications">
        <div class="tm-list tm-tasks" data-tm-list="tasks" role="listbox" tabindex="0" aria-label="Tasks"></div>
        <button type="button" class="xp-btn tm-end-task" data-tm-command="end-task"><u>E</u>nd Task</button>
        <button type="button" class="xp-btn tm-switch-to" data-tm-command="switch-to"><u>S</u>witch To</button>
        <button type="button" class="xp-btn tm-new-task" data-tm-command="new-task"><u>N</u>ew Task...</button>
      </section>
      <section class="tm-page" data-tm-page="processes">
        <div class="tm-list tm-processes" data-tm-list="processes" role="listbox" tabindex="0" aria-label="Processes"></div>
        <label class="tm-all-users"><input type="checkbox"><span><u>S</u>how processes from all users</span></label>
        <button type="button" class="xp-btn tm-end-process" data-tm-command="end-process"><u>E</u>nd Process</button>
      </section>
      <section class="tm-page" data-tm-page="performance">
        <fieldset class="dlg-group tm-cpu-usage"><legend>CPU Usage</legend><div class="tm-meter"><i></i><i></i><canvas width="68" height="21"></canvas></div></fieldset>
        <fieldset class="dlg-group tm-cpu-history"><legend>CPU Usage History</legend><canvas class="tm-graph" width="229" height="57"></canvas></fieldset>
        <fieldset class="dlg-group tm-pf-usage"><legend>PF Usage</legend><div class="tm-meter"><i></i><i></i><canvas width="68" height="21"></canvas></div></fieldset>
        <fieldset class="dlg-group tm-pf-history"><legend>Page File Usage History</legend><canvas class="tm-graph" width="229" height="57"></canvas></fieldset>
        ${groupBox("tm-totals", "Totals", [
          ["Handles", "handles"],
          ["Threads", "threads"],
          ["Processes", "processes"],
        ])}
        ${groupBox("tm-physical", "Physical Memory (K)", [
          ["Total", "physical-total"],
          ["Available", "physical-available"],
          ["System Cache", "system-cache"],
        ])}
        ${groupBox("tm-commit", "Commit Charge (K)", [
          ["Total", "commit-total"],
          ["Limit", "commit-limit"],
          ["Peak", "commit-peak"],
        ])}
        ${groupBox("tm-kernel", "Kernel Memory (K)", [
          ["Total", "kernel-total"],
          ["Paged", "kernel-paged"],
          ["Nonpaged", "kernel-nonpaged"],
        ])}
      </section>
      <section class="tm-page" data-tm-page="networking">
        <fieldset class="dlg-group tm-adapter"><legend>Local Area Connection</legend><canvas class="tm-graph" width="350" height="222"></canvas></fieldset>
        <div class="tm-list tm-adapters" data-tm-list="adapters" role="listbox" tabindex="0" aria-label="Adapters"></div>
      </section>
      <section class="tm-page" data-tm-page="users">
        <div class="tm-list tm-users" data-tm-list="users" role="listbox" tabindex="0" aria-label="Users"></div>
        <button type="button" class="xp-btn tm-disconnect" data-tm-command="disconnect"><u>D</u>isconnect</button>
        <button type="button" class="xp-btn tm-logoff" data-tm-command="logoff-user"><u>L</u>ogoff</button>
        <button type="button" class="xp-btn tm-send-message" disabled><u>S</u>end Message...</button>
      </section>
    </div>
    <div class="tm-status"><span></span><span></span><span></span></div>`;
  const $ = (selector) => root.querySelector(selector);
  const menuBar = $(".tm-menu-bar");
  const statusPanes = root.querySelectorAll(".tm-status span");

  // Processes: one per program window, the rest from the reference install.
  let nextPid = 4;
  const createProcess = (
    [image, user, memory, handles, threads],
    windowId,
    part = 0,
  ) => ({
    pid: (nextPid += 4),
    image,
    user,
    base: memory,
    memory,
    handles,
    threads,
    windowId,
    part,
    cpu: 0,
    cpuTime: 0,
  });
  const processes = BASE_PROCESSES.map((entry) => createProcess(entry, null));
  const processImage = (task) =>
    PROGRAM_IMAGES[task.applicationId ?? task.gameId] || GAME_IMAGES[task.type];
  const tasks = () =>
    [...context.openWindows.values()].filter(
      (task) => task.gameId !== win.gameId,
    );
  // A window's real footprint: its canvas and image pixels, and its elements.
  const footprint = (task) => {
    let bytes = task.el.getElementsByTagName("*").length * 512;
    task.el
      .querySelectorAll("canvas")
      .forEach((canvas) => (bytes += canvas.width * canvas.height * 4));
    task.el
      .querySelectorAll("img")
      .forEach(
        (image) => (bytes += image.naturalWidth * image.naturalHeight * 4),
      );
    return Math.round(bytes / 1024);
  };
  // A window can have more than one process: each cmd of a Command
  // Prompt window is its own cmd.exe, like XP.
  const processCountOf = (task) =>
    task.mountedApplication?.processCount?.() ?? 1;
  const syncProcesses = () => {
    const windows = new Map(
      [...context.openWindows.values()]
        .filter(processImage)
        .map((task) => [task.gameId, task]),
    );
    for (let index = processes.length - 1; index >= 0; index--) {
      const { windowId, part } = processes[index];
      const task = windows.get(windowId);
      if (windowId && !(task && part < processCountOf(task)))
        processes.splice(index, 1);
    }
    windows.forEach((task, id) => {
      const [image, memory] = processImage(task);
      for (let part = 0; part < processCountOf(task); part++)
        if (
          !processes.some(
            (process) => process.windowId === id && process.part === part,
          )
        )
          processes.push(
            createProcess([image, USER, memory, 120, 4], id, part),
          );
    });
    // Programs grow with what they show; folder windows live in Explorer.
    // The first process of a window has what the window shows.
    processes.forEach((process) => {
      if (process.windowId)
        process.memory =
          process.base +
          (process.part ? 0 : footprint(windows.get(process.windowId)));
      else if (process.image === "explorer.exe")
        process.memory =
          process.base +
          tasks()
            .filter((task) => !processImage(task))
            .reduce((total, task) => total + footprint(task), 0);
    });
  };

  // CPU: how late each animation frame ran. That counts all of the page's
  // main-thread work, which is where Flash and emulated programs run too.
  let busy = 0;
  let lastFrame = 0;
  let frame = 0;
  const onFrame = (time) => {
    if (lastFrame) busy += Math.max(0, time - lastFrame - FRAME_BUDGET);
    lastFrame = time;
    frame = window.requestAnimationFrame(onFrame);
  };
  frame = window.requestAnimationFrame(onFrame);
  const cpuHistory = [];
  const pfHistory = [];
  let cpuTotal = 0;
  let kernelShare = 0;
  let lastSample = performance.now();
  let peakCommit = 0;
  const sample = () => {
    const now = performance.now();
    const elapsed = Math.max(1, now - lastSample);
    lastSample = now;
    cpuTotal = Math.min(100, Math.round((busy / elapsed) * 100));
    busy = 0;
    kernelShare = Math.round(cpuTotal * KERNEL_SHARE);
    sampleNetwork(elapsed);
    // The work belongs to the active program, or to the shell.
    processes.forEach((process) => (process.cpu = 0));
    const active = [...context.openWindows.values()].find((task) =>
      task.el.classList.contains("active"),
    );
    (
      processes.find(
        (process) =>
          active && process.windowId === active.gameId && !process.part,
      ) || processes.find((process) => process.image === "explorer.exe")
    ).cpu = cpuTotal;
    processes[0].cpu = 100 - cpuTotal;
    processes.forEach(
      (process) => (process.cpuTime += (process.cpu * elapsed) / 100),
    );
    cpuHistory.unshift([cpuTotal, kernelShare]);
    cpuHistory.length = Math.min(cpuHistory.length, 400);
    pfHistory.unshift(commitTotal());
    pfHistory.length = Math.min(pfHistory.length, 400);
    peakCommit = Math.max(peakCommit, commitTotal());
  };
  const sum = (key) =>
    processes.reduce((total, process) => total + process[key], 0);
  // XP counts the kernel's pools and the system cache on top of processes.
  const commitTotal = () => sum("memory") + 15352;

  // Lists: a header and rows. Columns are [label, width, right padding],
  // with the padding only for XP's right-aligned columns.
  const selection = {
    tasks: null,
    processes: null,
    users: USER,
    adapters: null,
  };
  const alignment = (padding) =>
    padding ? ` class="right" style="padding-right: ${padding}px"` : "";
  const renderList = (list, key, columns, rows) => {
    // A column header with the keys gets them back after the rebuild.
    const header = document.activeElement.closest("[data-tm-sort]");
    const headerKeys = list.contains(header) ? header.dataset.tmSort : null;
    list.style.setProperty(
      "--tm-columns",
      columns.map(([, width]) => `${width}px`).join(" "),
    );
    list.innerHTML = `<div class="tm-list-header">${columns
      .map(
        ([label, , padding], index) =>
          `<button type="button" data-tm-sort="${index}"${padding ? ' class="right"' : ""}><span>${label}</span></button>`,
      )
      .join("")}<span></span></div>${rows
      .map(
        (row) =>
          `<div class="tm-row" role="option" data-tm-id="${escapeText(row.id)}" aria-selected="${row.id === selection[key]}">${row.cells
            .map(
              (cell, index) =>
                `<span${alignment(columns[index][2])}>${index ? escapeText(cell) : `${row.icon || ""}<span class="tm-label">${escapeText(cell)}</span>`}</span>`,
            )
            .join("")}</div>`,
      )
      .join("")}`;
    if (headerKeys !== null)
      list.querySelector(`[data-tm-sort="${headerKeys}"]`).focus();
  };
  const iconHtml = (task) =>
    context.createGameIconElement(task.applicationId ?? task.gameId, "tm-icon")
      .outerHTML;
  const renderTasks = () => {
    const list = $(".tm-tasks");
    const current = tasks();
    if (!current.some((task) => task.gameId === selection.tasks))
      selection.tasks = current[0]?.gameId ?? null;
    list.dataset.view = settings.view;
    renderList(
      list,
      "tasks",
      [
        ["Task", 255],
        ["Status", 100],
      ],
      current.map((task) => ({
        id: task.gameId,
        icon: iconHtml(task),
        cells: [task.el.querySelector(".title-text").textContent, "Running"],
      })),
    );
  };
  let processSort = null;
  const processRows = () => {
    const rows = processes
      .map((process) => ({
        id: String(process.pid),
        process,
        cells: [
          process.image,
          process.user,
          String(process.cpu).padStart(2, "0"),
          formatK(process.memory),
        ],
      }))
      .reverse();
    if (processSort) {
      const [column, direction] = processSort;
      const value = (row) =>
        [
          row.process.image.toLowerCase(),
          row.process.user.toLowerCase(),
          row.process.cpu,
          row.process.memory,
        ][column];
      rows.sort(
        (a, b) =>
          (value(a) > value(b) ? 1 : value(a) < value(b) ? -1 : 0) * direction,
      );
    }
    return rows;
  };
  const renderProcesses = () => {
    renderList(
      $(".tm-processes"),
      "processes",
      [
        ["Image Name", 107],
        ["User Name", 107],
        ["CPU", 35, 9],
        ["Mem Usage", 70, 7],
      ],
      processRows(),
    );
  };
  const renderUsers = () => {
    renderList(
      $(".tm-users"),
      "users",
      [
        ["User", 120],
        ["ID", 35, 6],
        ["Status", 93],
        ["Client Name", 100],
        ["Session", 124],
      ],
      [
        {
          id: USER,
          icon: `<img class="tm-icon" src="assets/xp/task-manager/user.png" alt="">`,
          cells: [USER, "0", "Active", "", "Console"],
        },
      ],
    );
  };

  // Networking: one adapter, graphing what the page downloads. Browsers
  // don't report uploads, so Bytes Sent stays at zero.
  const LINK_SPEED = 100_000_000;
  let received = 0;
  const network = new window.PerformanceObserver((list) =>
    list.getEntries().forEach((entry) => (received += entry.transferSize)),
  );
  network.observe({ type: "resource" });
  const networkHistory = [];
  const sampleNetwork = (elapsed) => {
    const percent = ((received * 8) / LINK_SPEED / (elapsed / 1000)) * 100;
    received = 0;
    if (settings.tab === "networking" || settings.tabAlwaysActive)
      networkHistory.unshift({ sent: 0, received: percent, total: percent });
    networkHistory.length = Math.min(networkHistory.length, 400);
  };
  const formatPercent = (value) => `${value ? value.toFixed(2) : 0} %`;
  // XP's auto scale steps through 1, 10 and 100 percent.
  const networkScale = () =>
    settings.autoScale
      ? [1, 10, 100].find((limit) =>
          networkHistory.every((sample) => sample.total <= limit),
        ) || 100
      : 100;
  // Canvases draw at the page's render density (the whole ratio the display
  // scale lays out at), in XP's logical pixels, so lines and labels stay
  // sharp on zoomed and high-density screens.
  const prepare = (canvas, width, height) => {
    const density = Math.ceil(window.devicePixelRatio - 0.01);
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const graphics = canvas.getContext("2d");
    const snap = (value) => Math.round(value * density);
    // One-pixel lines keep one width everywhere instead of rounding to 1 or
    // 2 device pixels.
    const thin = Math.max(1, Math.floor(density));
    const size = (start, length) =>
      length === 1 ? thin : snap(start + length) - snap(start);
    const fill = (x, y, w, h) =>
      graphics.fillRect(snap(x), snap(y), size(x, w), size(y, h));
    const text = (value, x, y, fontSize, align) => {
      graphics.font = `${fontSize * density}px Arial`;
      graphics.textAlign = align;
      graphics.fillText(value, x * density, y * density);
    };
    const line = (points, color) => {
      graphics.strokeStyle = color;
      graphics.lineWidth = thin;
      graphics.beginPath();
      points.forEach(([x, y]) =>
        graphics.lineTo((x + 0.5) * density, (y + 0.5) * density),
      );
      graphics.stroke();
    };
    // GDI draws graph and meter labels without smoothing.
    const binarize = (x, y, w, h) => {
      const label = graphics.getImageData(snap(x), snap(y), snap(w), snap(h));
      for (let index = 0; index < label.data.length; index += 4) {
        label.data[index] = (label.data[index] >> 7) * 255;
        label.data[index + 1] = (label.data[index + 1] >> 7) * 255;
        label.data[index + 2] = 0;
        label.data[index + 3] = 255;
      }
      graphics.putImageData(label, snap(x), snap(y));
    };
    return { graphics, fill, text, line, binarize };
  };

  const renderNetworking = () => {
    const [width, height] = [350, 222];
    const { graphics, fill, text, line, binarize } = prepare(
      root.querySelector(".tm-adapter canvas"),
      width,
      height,
    );
    const scale = networkScale();
    // Show Scale gives the labels a 36px column and a yellow axis.
    const left = settings.showScale ? 37 : 0;
    graphics.fillStyle = "#000";
    fill(0, 0, width, height);
    graphics.fillStyle = "#008040";
    for (let y = 4; y < height - 1; y += 31) fill(left, y, width - left, 1);
    for (let x = width - 1 - graphOffset; x >= left; x -= GRAPH_GRID)
      fill(x, 0, 1, height);
    if (settings.showScale) {
      fill(36, 0, 1, height);
      graphics.fillStyle = "#ff0";
      fill(36, 0, 1, 4);
      for (let y = 5; y < height; y += 31)
        fill(36, y, 1, Math.min(30, height - y));
      text(`${scale} %`, 32, 10, 10, "right");
      text(`${scale / 2} %`, 32, 115, 10, "right");
      text("0 %", 32, 220, 10, "right");
      binarize(0, 0, 36, height);
    }
    [
      ["sent", "#f00"],
      ["received", "#ff0"],
      ["total", "#0f0"],
    ]
      .filter(([key]) => settings.history[key])
      .forEach(([key, color]) =>
        line(
          networkHistory.map((sample, step) => [
            width - 1 - step * 2,
            height - 1 - Math.round((sample[key] / scale) * (height - 1)),
          ]),
          color,
        ),
      );
    renderList(
      $(".tm-adapters"),
      "adapters",
      [
        ["Adapter Name", 96],
        ["Network Utilization", 96, 7],
        ["Link Speed", 60],
        ["State", 96, 7],
      ],
      [
        {
          id: "lan",
          cells: [
            "Local Area Connection",
            formatPercent(networkHistory[0]?.total ?? 0),
            "100 Mbps",
            navigator.onLine ? "Operational" : "Disconnected",
          ],
        },
      ],
    );
  };

  // Performance: XP's LED meters and scrolling history graphs. A meter's
  // 28 bar rows light from the bottom; the label is a canvas below them.
  const drawMeter = (meter, fraction, text) => {
    const lit = Math.round(28 * fraction);
    const [off, on] = meter.querySelectorAll("i");
    off.style.height = `${28 - lit}px`;
    on.style.top = `${34 - lit}px`;
    on.style.height = `${lit}px`;
    on.style.backgroundPosition = `0 ${lit - 28}px`;
    const label = prepare(meter.querySelector("canvas"), 68, 21);
    label.graphics.fillStyle = "#000";
    label.fill(0, 0, 68, 21);
    label.graphics.fillStyle = "#0f0";
    label.text(text, 34, 15, 11, "center");
    label.binarize(0, 0, 68, 21);
  };
  let graphOffset = 0;
  const drawGraph = (canvas, values, scale, color, kernel) => {
    const [width, height] = [229, 57];
    const { graphics, fill, line } = prepare(canvas, width, height);
    graphics.fillStyle = "#000";
    fill(0, 0, width, height);
    graphics.fillStyle = "#008040";
    for (let y = GRAPH_GRID - 1; y < height; y += GRAPH_GRID)
      fill(0, y, width, 1);
    for (let x = width - 1 - graphOffset; x >= 0; x -= GRAPH_GRID)
      fill(x, 0, 1, height);
    const plot = (index, stroke) =>
      line(
        values.map((value, step) => [
          width - 1 - step * 2,
          height - 1 - Math.round((value[index] / scale) * (height - 1)),
        ]),
        stroke,
      );
    if (kernel) plot(1, "#f00");
    plot(0, color);
  };
  const setValue = (key, value) => {
    root.querySelector(`[data-tm-value="${key}"]`).textContent = value;
  };
  const renderPerformance = () => {
    const [cpuMeter, pfMeter] = root.querySelectorAll(".tm-meter");
    const [cpuGraph, pfGraph] = root.querySelectorAll(".tm-graph");
    const commit = commitTotal();
    drawMeter(cpuMeter, cpuTotal / 100, `${cpuTotal} %`);
    drawMeter(
      pfMeter,
      commit / COMMIT_LIMIT_K,
      `${(commit / 1024).toFixed(1)} MB`,
    );
    drawGraph(cpuGraph, cpuHistory, 100, "#0f0", settings.kernelTimes);
    drawGraph(
      pfGraph,
      pfHistory.map((value) => [value]),
      COMMIT_LIMIT_K,
      "#ff0",
      false,
    );
    const memory = sum("memory");
    setValue("handles", sum("handles"));
    setValue("threads", sum("threads"));
    setValue("processes", processes.length);
    setValue("physical-total", PHYSICAL_MEMORY_K);
    setValue("physical-available", PHYSICAL_MEMORY_K - memory - 42868);
    setValue("system-cache", 60988);
    setValue("commit-total", commit);
    setValue("commit-limit", COMMIT_LIMIT_K);
    setValue("commit-peak", peakCommit);
    setValue("kernel-total", 12264);
    setValue("kernel-paged", 9444);
    setValue("kernel-nonpaged", 2820);
  };

  const renderStatus = () => {
    const commit = Math.round(commitTotal() / 1024);
    statusPanes[0].textContent = `Processes: ${processes.length}`;
    statusPanes[1].textContent = `CPU Usage: ${cpuTotal}%`;
    statusPanes[2].textContent = `Commit Charge: ${commit}M / ${Math.round(COMMIT_LIMIT_K / 1024)}M`;
  };

  // The tray icon fills with CPU usage in twelve steps, like XP's.
  const trayIcon = context.addTrayIcon("Windows Task Manager", () => {
    context.restoreWindow(win.gameId);
    context.focusWindow(win.gameId);
  });
  const renderTray = () => {
    trayIcon.style.backgroundImage = `url("${TRAY_ICONS[Math.min(11, Math.floor(cpuTotal / 9))]}")`;
    trayIcon.title = `CPU Usage: ${cpuTotal}%`;
  };

  const renderers = {
    applications: renderTasks,
    processes: renderProcesses,
    performance: renderPerformance,
    networking: renderNetworking,
    users: renderUsers,
  };
  const refresh = () => {
    syncProcesses();
    sample();
    renderers[settings.tab]();
    renderStatus();
    renderTray();
    graphOffset = (graphOffset + 2) % GRAPH_GRID;
  };
  let timer = 0;
  const schedule = () => {
    clearInterval(timer);
    const delay = UPDATE_SPEEDS[settings.speed];
    timer = delay ? setInterval(refresh, delay) : 0;
  };

  // Menus.
  const isChecked = {
    "always-on-top": () => settings.alwaysOnTop,
    "minimize-on-use": () => settings.minimizeOnUse,
    "hide-when-minimized": () => settings.hideWhenMinimized,
    "kernel-times": () => settings.kernelTimes,
    "tab-always-active": () => settings.tabAlwaysActive,
    "auto-scale": () => settings.autoScale,
    "show-scale": () => settings.showScale,
    "history-sent": () => settings.history.sent,
    "history-received": () => settings.history.received,
    "history-total": () => settings.history.total,
  };
  const isRadio = {
    "speed-high": () => settings.speed === "high",
    "speed-normal": () => settings.speed === "normal",
    "speed-low": () => settings.speed === "low",
    "speed-paused": () => settings.speed === "paused",
    "view-large": () => settings.view === "large",
    "view-small": () => settings.view === "small",
    "view-details": () => settings.view === "details",
  };
  // Submenu parents are divs, so their items aren't buttons inside a
  // button. Hovering or clicking one opens its submenu.
  const buildMenu = (items) => {
    const menu = document.createElement("div");
    menu.className = "tm-menu";
    menu.setAttribute("role", "menu");
    items.forEach((item) => {
      if (item === "-") {
        menu.insertAdjacentHTML(
          "beforeend",
          '<div class="tm-menu-separator"></div>',
        );
        return;
      }
      const [label, command, shortcut = ""] = item;
      const submenu = Array.isArray(command);
      const entry = document.createElement(submenu ? "div" : "button");
      entry.setAttribute("role", "menuitem");
      const text = document.createElement("span");
      context.setAccessKeyText(text, label);
      entry.append(text);
      entry.insertAdjacentHTML("beforeend", `<kbd>${shortcut}</kbd>`);
      if (submenu) {
        // The keys can rest on a submenu's parent, like on an item.
        entry.className = "tm-submenu";
        entry.tabIndex = -1;
        entry.setAttribute("aria-haspopup", "menu");
        entry.setAttribute("aria-expanded", "false");
        entry.append(buildMenu(command));
      } else {
        entry.type = "button";
        entry.dataset.tmCommand = command;
        entry.classList.toggle("checked", Boolean(isChecked[command]?.()));
        entry.classList.toggle("radio", Boolean(isRadio[command]?.()));
      }
      menu.append(entry);
    });
    return menu;
  };
  // Each page builds its own titles, so the items go with the title.
  const menuItems = new WeakMap();
  const menus = wireMenuBar({
    windowElement: win.el,
    bar: menuBar,
    showMenu: (button) => {
      const menu = buildMenu(menuItems.get(button));
      menu.style.left = `${button.offsetLeft}px`;
      menuBar.append(menu);
      return menu;
    },
    hideMenu: (menu) => menu.remove(),
  });
  const renderMenuBar = () => {
    menus.close();
    menuBar.replaceChildren(
      ...MENUS[settings.tab].map(([label, items]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        button.dataset.tmMenu = label.replace(/[& ]/g, "").toLowerCase();
        context.setAccessKeyText(button, label);
        menuItems.set(button, items);
        return button;
      }),
    );
  };

  // Commands.
  const selectedTask = () => context.openWindows.get(selection.tasks);
  const selectedProcess = () =>
    processes.find((process) => String(process.pid) === selection.processes);
  const applyWindowOptions = () => {
    context.setWindowTopmost(win.gameId, settings.alwaysOnTop);
    win.hideWhenMinimized = settings.hideWhenMinimized;
    context.renderTaskButtons();
  };
  const toggleSetting = (key) => {
    settings[key] = !settings[key];
    saveSettings();
  };
  const endProcess = async () => {
    const process = selectedProcess();
    if (!process) return;
    if (CRITICAL.has(process.image)) {
      await context.XPDialogs.alert(
        "The operation could not be completed.\n\nThis is a critical system process.  Task Manager cannot end this process.",
        "Unable to Terminate Process",
        "error",
      );
      return;
    }
    const confirmed = await context.XPDialogs.confirm(
      "WARNING: Terminating a process can cause undesired\nresults including loss of data and system instability. The\nprocess will not be given the chance to save its state or\ndata before it is terminated.  Are you sure you want to\nterminate the process?",
      "Task Manager Warning",
      "warning",
    );
    if (!confirmed) return;
    if (process.image === "taskmgr.exe") {
      context.closeGameWindow(win.gameId);
      return;
    }
    const task = context.openWindows.get(process.windowId);
    if (process.part && task?.mountedApplication?.endProcess) {
      task.mountedApplication.endProcess(process.part);
    } else if (process.windowId) {
      await context.closeGameWindow(process.windowId, {
        skipBeforeClose: true,
      });
    } else if (process.image === "explorer.exe") {
      // Explorer's folder windows close with it. The shell keeps running, as
      // if Winlogon had restarted it.
      tasks()
        .filter((task) => !processImage(task))
        .forEach((task) => context.closeGameWindow(task.gameId));
    } else {
      processes.splice(processes.indexOf(process), 1);
    }
    refresh();
  };
  const commands = {
    "new-task": () =>
      context.openRunDialog({ title: "Create New Task", modal: true }),
    exit: () => context.closeGameWindow(win.gameId),
    "always-on-top": () => {
      toggleSetting("alwaysOnTop");
      applyWindowOptions();
    },
    "minimize-on-use": () => toggleSetting("minimizeOnUse"),
    "hide-when-minimized": () => {
      toggleSetting("hideWhenMinimized");
      applyWindowOptions();
    },
    "kernel-times": () => {
      toggleSetting("kernelTimes");
      refresh();
    },
    refresh,
    "tab-always-active": () => toggleSetting("tabAlwaysActive"),
    "auto-scale": () => {
      toggleSetting("autoScale");
      renderNetworking();
    },
    "show-scale": () => {
      toggleSetting("showScale");
      renderNetworking();
    },
    reset: () => {
      networkHistory.length = 0;
      renderNetworking();
    },
    ...Object.fromEntries(
      ["sent", "received", "total"].map((line) => [
        `history-${line}`,
        () => {
          settings.history[line] = !settings.history[line];
          saveSettings();
          renderNetworking();
        },
      ]),
    ),
    ...Object.fromEntries(
      Object.keys(UPDATE_SPEEDS).map((speed) => [
        `speed-${speed}`,
        () => {
          settings.speed = speed;
          saveSettings();
          schedule();
        },
      ]),
    ),
    ...Object.fromEntries(
      ["large", "small", "details"].map((view) => [
        `view-${view}`,
        () => {
          settings.view = view;
          saveSettings();
          renderTasks();
        },
      ]),
    ),
    "tile-horizontal": () =>
      context.arrangeTaskbarWindows("tile-horizontal", tasks()),
    "tile-vertical": () =>
      context.arrangeTaskbarWindows("tile-vertical", tasks()),
    cascade: () => context.arrangeTaskbarWindows("cascade", tasks()),
    minimize: () => selectedTask() && context.minimizeWindow(selection.tasks),
    maximize: () => {
      const task = selectedTask();
      if (!task) return;
      context.restoreWindow(task.gameId);
      if (!task.maximized) context.toggleMaximize(task.gameId);
    },
    "bring-to-front": () => {
      if (!selectedTask()) return;
      context.restoreWindow(selection.tasks);
      context.focusWindow(selection.tasks);
      context.focusWindow(win.gameId);
    },
    "switch-to": () => {
      if (!selectedTask()) return;
      context.restoreWindow(selection.tasks);
      context.focusWindow(selection.tasks);
      if (settings.minimizeOnUse) context.minimizeWindow(win.gameId);
    },
    "end-task": async () => {
      if (!selectedTask()) return;
      await context.closeGameWindow(selection.tasks);
      refresh();
    },
    "end-process": endProcess,
    "stand-by": () => context.setSuspended(true),
    "turn-off": () => context.turnOff(),
    restart: () => context.restart(),
    "log-off": () => context.logOff(),
    "switch-user": () => context.switchUser(),
    disconnect: () => context.switchUser(),
    "logoff-user": async () => {
      if (
        await context.XPDialogs.confirm(
          "Are you sure you want to logoff the selected user(s)?",
          "Windows Task Manager",
          "question",
        )
      )
        context.logOff();
    },
    about: () =>
      context.openAboutWindows({
        application: "Windows Task Manager",
        icon: "assets/xp/task-manager/icon-32.png",
      }),
  };
  root.addEventListener("click", (event) => {
    const command = event.target.closest("[data-tm-command]");
    if (command) {
      menus.close();
      commands[command.dataset.tmCommand]();
      return;
    }
    const tab = event.target.closest("[data-tm-tab]");
    if (tab) {
      showTab(tab.dataset.tmTab);
      return;
    }
    const sort = event.target.closest("[data-tm-sort]");
    if (sort && sort.closest(".tm-processes")) {
      const column = Number(sort.dataset.tmSort);
      processSort = [column, processSort?.[0] === column ? -processSort[1] : 1];
      renderProcesses();
      return;
    }
    const row = event.target.closest(".tm-row");
    if (row) {
      const list = row.closest(".tm-list");
      const key = list.dataset.tmList;
      selection[key] = row.dataset.tmId;
      list
        .querySelectorAll(".tm-row")
        .forEach((entry) =>
          entry.setAttribute("aria-selected", String(entry === row)),
        );
    }
  });
  root.addEventListener("dblclick", (event) => {
    if (event.target.closest(".tm-tasks .tm-row")) commands["switch-to"]();
  });
  $(".tm-all-users input").addEventListener("change", renderProcesses);

  const showTab = (id) => {
    settings.tab = id;
    saveSettings();
    root.querySelectorAll("[data-tm-tab]").forEach((tab) => {
      const selected = tab.dataset.tmTab === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    root
      .querySelectorAll("[data-tm-page]")
      .forEach((page) => (page.hidden = page.dataset.tmPage !== id));
    renderMenuBar();
    renderers[id]();
  };

  applyWindowOptions();
  showTab(settings.tab);
  refresh();
  schedule();
  return {
    element: root,
    unmount() {
      clearInterval(timer);
      window.cancelAnimationFrame(frame);
      network.disconnect();
      trayIcon.remove();
    },
  };
};

export const taskManagerApplication = defineApplication({
  ...applicationMetadata,
  mount: mountTaskManager,
});
