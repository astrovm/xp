"use strict";

const TASKBAR_SETTINGS_KEY = "taskbarSettings";
const taskbarDefaults = {
  edge: "bottom",
  rows: 1,
  width: 106,
  locked: true,
  autoHide: false,
  onTop: true,
  group: true,
  quickLaunch: false,
  quickLaunchItems: ["__show-desktop"],
  desktopToolbar: false,
  folders: [],
  toolbarOrder: [],
  toolbarLayouts: {},
  hideInactive: true,
  volumeBehavior: "auto",
};
const getTaskbarSettings = () => {
  const saved = readJsonStorage(
    TASKBAR_SETTINGS_KEY,
    {},
    (value) => value && typeof value === "object",
  );
  const settings = { ...taskbarDefaults, ...saved };
  if (!["bottom", "top", "left", "right"].includes(settings.edge))
    settings.edge = "bottom";
  settings.rows = Math.max(
    1,
    Math.min(100, Math.round(Number(settings.rows)) || 1),
  );
  settings.width = Math.max(99, Math.min(4096, Number(settings.width) || 106));
  settings.quickLaunchItems = Array.isArray(settings.quickLaunchItems)
    ? [
        ...new Set(
          settings.quickLaunchItems.filter((id) => typeof id === "string"),
        ),
      ]
    : ["__show-desktop"];
  settings.folders = Array.isArray(settings.folders)
    ? settings.folders.filter((id) => typeof id === "string")
    : [];
  settings.toolbarOrder = Array.isArray(settings.toolbarOrder)
    ? [...new Set(settings.toolbarOrder.filter((id) => typeof id === "string"))]
    : [];
  if (
    !settings.toolbarLayouts ||
    typeof settings.toolbarLayouts !== "object" ||
    Array.isArray(settings.toolbarLayouts)
  )
    settings.toolbarLayouts = {};
  return settings;
};
const saveTaskbarSettings = (changes) => {
  writeJsonStorage(TASKBAR_SETTINGS_KEY, {
    ...getTaskbarSettings(),
    ...changes,
  });
  applyTaskbarSettings();
};
let taskbarHideTimer;
let taskbarVolumeLastUsed = Date.now();
let taskbarTrayExpanded = false;
let trayCollapseTimer;
const scheduleTrayCollapse = () => {
  clearTimeout(trayCollapseTimer);
  if (!taskbarTrayExpanded) return;
  trayCollapseTimer = setTimeout(() => {
    const tray = document.getElementById("taskbar-tray");
    if (
      tray.matches(":hover") ||
      (tray.contains(document.activeElement) &&
        document.activeElement.matches(":focus-visible")) ||
      !document.getElementById("tray-volume-popup").hidden ||
      !document.getElementById("tray-volume-menu").hidden
    ) {
      scheduleTrayCollapse();
      return;
    }
    taskbarTrayExpanded = false;
    renderTrayVisibility();
  }, 2000);
};

const revealTaskbar = () => {
  clearTimeout(taskbarHideTimer);
  document.getElementById("taskbar").classList.remove("auto-hidden");
};
const scheduleTaskbarHide = () => {
  clearTimeout(taskbarHideTimer);
  if (!getTaskbarSettings().autoHide) return;
  taskbarHideTimer = setTimeout(() => {
    const bar = document.getElementById("taskbar");
    if (
      bar.matches(":hover") ||
      (bar.contains(document.activeElement) &&
        document.activeElement.matches(":focus-visible")) ||
      [
        "start-menu",
        "taskbar-context-menu",
        "taskbar-overflow-menu",
        "tray-volume-popup",
        "tray-volume-menu",
      ].some((id) => !document.getElementById(id).hidden)
    ) {
      scheduleTaskbarHide();
      return;
    }
    bar.classList.add("auto-hidden");
  }, 500);
};

const layoutTaskbar = (monitor, left, top) => {
  const settings = getTaskbarSettings();
  const bar = document.getElementById("taskbar");
  const desktop = document.getElementById("desktop");
  const vertical = ["left", "right"].includes(settings.edge);
  const largeToolbar = Object.entries(settings.toolbarLayouts).some(
    ([id, layout]) =>
      layout?.largeIcons &&
      !layout.floating &&
      (id === QUICK_LAUNCH
        ? settings.quickLaunch
        : id === fs.DESKTOP
          ? settings.desktopToolbar
          : settings.folders.includes(id)),
  );
  const thickness = vertical
    ? Math.min(settings.width, monitor.width / 2)
    : Math.min(
        Math.max(
          getTaskbarHeight() +
            (settings.locked ? 0 : 4) +
            (settings.rows - 1) * 26,
          largeToolbar ? 40 + (settings.locked ? 0 : 4) : 0,
        ),
        monitor.height / 2,
      );
  const reserved = settings.autoHide ? 2 : settings.onTop ? thickness : 0;
  const inset = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    [settings.edge]: reserved,
  };
  Object.assign(desktop.style, {
    left: `${left + inset.left}px`,
    top: `${top + inset.top}px`,
    right: "auto",
    bottom: "auto",
    width: `${monitor.width - inset.left - inset.right}px`,
    height: `${monitor.height - inset.top - inset.bottom}px`,
  });
  desktop.style.setProperty(
    "--desktop-taskbar-height",
    `${inset.top + inset.bottom}px`,
  );
  Object.assign(bar.style, {
    left: `${left + (settings.edge === "right" ? monitor.width - thickness : 0)}px`,
    top: `${top + (settings.edge === "bottom" ? monitor.height - thickness : 0)}px`,
    width: `${vertical ? thickness : monitor.width}px`,
    height: `${vertical ? monitor.height : thickness}px`,
    right: "auto",
    bottom: "auto",
    zIndex: settings.onTop || settings.autoHide ? "8000" : "90",
  });
  bar.dataset.edge = settings.edge;
  bar.style.setProperty("--taskbar-thickness", `${thickness}px`);
  bar.classList.toggle("vertical", vertical);
  bar.classList.toggle("unlocked", !settings.locked);
  if (!settings.autoHide) revealTaskbar();
};

const renderTrayVisibility = () => {
  const settings = getTaskbarSettings();
  const hidden =
    settings.hideInactive &&
    (settings.volumeBehavior === "hide" ||
      (settings.volumeBehavior === "auto" &&
        Date.now() - taskbarVolumeLastUsed >= 10 * 60 * 1000));
  const expand = document.getElementById("tray-expand");
  expand.hidden = !hidden;
  expand.textContent = taskbarTrayExpanded ? "›" : "‹";
  expand.setAttribute(
    "aria-label",
    taskbarTrayExpanded ? "Hide inactive icons" : "Show hidden icons",
  );
  expand.setAttribute("aria-expanded", String(taskbarTrayExpanded));
  const volume = document.getElementById("tray-volume-button");
  const hideVolume = hidden && !taskbarTrayExpanded;
  // A control that hides loses the keys to the page. The arrow next to it
  // takes them instead.
  if (hideVolume && document.activeElement === volume)
    expand.focus({ preventScroll: true });
  volume.hidden = hideVolume;
};

const applyTaskbarSettings = () => {
  const settings = getTaskbarSettings();
  taskbarLocked = settings.locked;
  const lock = document.querySelector('[data-taskbar-action="lock"]');
  lock.setAttribute("aria-checked", String(settings.locked));
  lock.querySelector(".context-check").textContent = settings.locked ? "✓" : "";
  // Reflow icons and windows once, after the toolbars settle the work area.
  applySimulatedMonitor(activeMonitorResolution, { reflow: false });
  renderTaskbarToolbars();
  renderTrayVisibility();
  updateClockDisplay();
  if (iconsBuilt) layoutDesktopIcons();
  if (loggedIn) keepWindowsInWorkArea();
  renderTaskButtons();
  scheduleTaskbarHide();
};

const openNewTaskbarToolbar = () => {
  const dialog = XPDialogs.createDialog({ title: "New Toolbar" });
  dialog.el.classList.add("taskbar-new-toolbar-dialog");
  dialog.body.innerHTML = `<p>Choose a folder</p><div class="toolbar-folder-tree" role="tree" aria-label="Folders"></div><label class="toolbar-folder-path">Folder: <input aria-label="Folder"></label><div class="toolbar-folder-buttons"></div>`;
  const tree = dialog.body.querySelector(".toolbar-folder-tree");
  const path = dialog.body.querySelector("input");
  let selected = fs.MY_DOCUMENTS;
  const choose = (id) => {
    selected = id;
    path.value = fs.getNode(id).name;
    for (const row of tree.querySelectorAll("[data-folder]")) {
      row.setAttribute("aria-selected", String(row.dataset.folder === id));
    }
  };
  const render = () => {
    tree.replaceChildren();
    const ancestors = new Set();
    let parent = fs.getNode(selected)?.parent;
    while (parent && !ancestors.has(parent)) {
      ancestors.add(parent);
      parent = fs.getNode(parent)?.parent;
    }
    // Desktop and My Documents are separate roots whose folder children are
    // added once each.
    const add = (id, parent, depth = 0) => {
      const node = fs.getNode(id);
      const row = document.createElement("button");
      row.type = "button";
      row.dataset.folder = id;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(depth + 1));
      row.style.paddingLeft = `${depth * 16 + 4}px`;
      const icon = document.createElement("img");
      icon.src =
        id === fs.DESKTOP
          ? "assets/xp/icons/ShowDesktop.png"
          : id === fs.MY_DOCUMENTS
            ? "assets/xp/icons/MyDocuments.png"
            : "assets/xp/icons/NewFolder.png";
      icon.alt = "";
      const text = document.createElement("span");
      text.textContent = node.name;
      row.append(icon, text);
      row.addEventListener("click", () => choose(id));
      parent.append(row);
      const children = fs
        .getChildren(id)
        .filter((child) => child.type === "folder");
      if (children.length) {
        row.setAttribute("aria-expanded", "false");
        const toggle = document.createElement("span");
        toggle.className = "toolbar-tree-toggle";
        toggle.textContent = "+";
        toggle.setAttribute("aria-hidden", "true");
        row.prepend(toggle);
        const group = document.createElement("div");
        group.setAttribute("role", "group");
        group.hidden = true;
        const expand = () => {
          group.hidden = !group.hidden;
          toggle.textContent = group.hidden ? "+" : "−";
          row.setAttribute("aria-expanded", String(!group.hidden));
          if (!group.children.length)
            children.forEach((child) => add(child.id, group, depth + 1));
        };
        if (ancestors.has(id)) expand();
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          expand();
        });
        row.addEventListener("dblclick", expand);
        row.addEventListener("keydown", (event) => {
          if (
            (event.key === "ArrowRight" && group.hidden) ||
            (event.key === "ArrowLeft" && !group.hidden)
          ) {
            event.preventDefault();
            expand();
          }
        });
        parent.append(group);
      }
    };
    add(fs.DESKTOP, tree);
    add(fs.MY_DOCUMENTS, tree, 1);
    choose(selected);
  };
  render();
  tree.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
    )
      return;
    const rows = [...tree.querySelectorAll("[data-folder]")].filter(
      (row) => !row.closest("[hidden]"),
    );
    const index = rows.indexOf(event.target);
    const next =
      event.key === "Home"
        ? rows[0]
        : event.key === "End"
          ? rows.at(-1)
          : rows[
              Math.max(
                0,
                Math.min(
                  rows.length - 1,
                  index + (event.key === "ArrowDown" ? 1 : -1),
                ),
              )
            ];
    // The Desktop and My Documents rows are always visible.
    event.preventDefault();
    next.focus();
    choose(next.dataset.folder);
  });
  const buttons = dialog.body.querySelector(".toolbar-folder-buttons");
  buttons.append(
    XPDialogs.createDialogButton(
      { id: "new-folder", label: "Make New Folder" },
      async () => {
        try {
          const node = await fileOps.createFolder(selected, "New Folder");
          selected = node.id;
          render();
        } catch (error) {
          void XPDialogs.alert(error.message, "New Toolbar", "error");
        }
      },
    ),
    XPDialogs.createDialogButton({ id: "ok", label: "OK" }, () => {
      // Like XP, the box takes no "." or ".." in a path, also where the
      // path is full.
      const dots = path.value
        .split(/[\\/]/)
        .some((part) => part.trim() === "." || part.trim() === "..");
      const id =
        path.value === fs.getNode(selected)?.name
          ? selected
          : !dots && fs.resolvePath(path.value);
      if (fs.getNode(id)?.type !== "folder") {
        void XPDialogs.alert(
          `Cannot find '${path.value}'. Make sure the path or Internet address is correct.`,
          "Toolbar",
          "error",
        );
        return;
      }
      saveTaskbarSettings({
        folders: [...new Set([...getTaskbarSettings().folders, id])],
      });
      dialog.close("ok");
    }),
    XPDialogs.createDialogButton({ id: "cancel", label: "Cancel" }, () =>
      dialog.close("cancel"),
    ),
  );
};

const setupTaskbarLayout = () => {
  const bar = document.getElementById("taskbar");
  const handle = document.getElementById("taskbar-resize");
  document.addEventListener("pointerdown", (event) => {
    document
      .querySelectorAll(".taskbar-toolbar.floating.active")
      .forEach((toolbar) => {
        if (!toolbar.contains(event.target)) toolbar.classList.remove("active");
      });
  });
  bar.addEventListener("pointerenter", revealTaskbar);
  bar.addEventListener("pointerdown", () => {
    bar.style.zIndex = "8000";
  });
  document.addEventListener("pointerdown", (event) => {
    const settings = getTaskbarSettings();
    if (
      !settings.onTop &&
      !settings.autoHide &&
      !event.target.closest(
        "#taskbar, #start-menu, #taskbar-context-menu, #taskbar-overflow-menu",
      )
    )
      bar.style.zIndex = "90";
  });
  bar.addEventListener("focusin", revealTaskbar);
  bar.addEventListener("pointerleave", scheduleTaskbarHide);
  bar.addEventListener("focusout", scheduleTaskbarHide);
  let drag = null;
  // Saving relays out the desktop, windows, toolbars and task buttons. Pointer
  // moves can outpace frames and mostly repeat the current size, so apply at
  // most one change per frame and only when a setting actually differs.
  let dragChanges = null;
  let dragFrame = 0;
  const flushDragSave = () => {
    cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    const pending = dragChanges;
    dragChanges = null;
    if (!pending) return;
    const current = getTaskbarSettings();
    if (Object.entries(pending).some(([key, value]) => current[key] !== value))
      saveTaskbarSettings(pending);
  };
  const queueDragSave = (changes) => {
    dragChanges = { ...dragChanges, ...changes };
    dragFrame ||= requestAnimationFrame(flushDragSave);
  };
  bar.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      getTaskbarSettings().locked ||
      event.target.closest("button, input, .taskbar-toolbar")
    )
      return;
    const settings = getTaskbarSettings();
    drag = { id: event.pointerId, resize: event.target === handle, settings };
    bar.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  bar.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const monitor = getSimulatedMonitorSize(activeMonitorResolution);
    const left = Math.max(0, (getViewportWidth() - monitor.width) / 2);
    const top = Math.max(0, (getViewportHeight() - monitor.height) / 2);
    const x = event.clientX - left,
      y = event.clientY - top;
    if (drag.resize) {
      const edge = drag.settings.edge;
      if (["left", "right"].includes(edge)) {
        queueDragSave({
          width: Math.max(
            99,
            Math.min(
              monitor.width / 2,
              edge === "left" ? x : monitor.width - x,
            ),
          ),
        });
      } else {
        const size = edge === "top" ? y : monitor.height - y;
        queueDragSave({
          rows: Math.max(
            1,
            Math.min(100, Math.round((size - getTaskbarHeight()) / 26) + 1),
          ),
        });
      }
    } else {
      const distances = {
        left: x,
        right: monitor.width - x,
        top: y,
        bottom: monitor.height - y,
      };
      const edge = Object.keys(distances).sort(
        (a, b) => distances[a] - distances[b],
      )[0];
      if (
        distances[edge] < Math.min(monitor.width, monitor.height) / 4 &&
        edge !== getTaskbarSettings().edge
      )
        queueDragSave({ edge });
    }
  });
  const finish = () => {
    drag = null;
    flushDragSave();
  };
  bar.addEventListener("pointerup", finish);
  bar.addEventListener("pointercancel", finish);
  bar.addEventListener("lostpointercapture", finish);
  document.getElementById("tray-expand").addEventListener("click", () => {
    taskbarTrayExpanded = !taskbarTrayExpanded;
    renderTrayVisibility();
    scheduleTrayCollapse();
  });
  document
    .getElementById("tray-volume-button")
    .addEventListener("pointerdown", () => {
      taskbarVolumeLastUsed = Date.now();
    });
  const tray = document.getElementById("taskbar-tray");
  tray.addEventListener("pointerenter", () => clearTimeout(trayCollapseTimer));
  tray.addEventListener("pointerleave", scheduleTrayCollapse);
  tray.addEventListener("focusout", scheduleTrayCollapse);
  document.addEventListener("pointerdown", (event) => {
    if (
      !event.target.closest(
        "#taskbar-tray, #tray-volume-popup, #tray-volume-menu",
      )
    )
      scheduleTrayCollapse();
  });
  setInterval(renderTrayVisibility, 30000);
  fs.subscribe(() => {
    renderTaskbarToolbars();
    renderTaskButtons();
  });
  applyTaskbarSettings();
};
