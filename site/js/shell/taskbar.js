"use strict";

// ============================================
// Taskbar
// ============================================

const closeTaskbarMenus = () => {
  [
    "start-button-menu",
    "taskbar-context-menu",
    "taskbar-overflow-menu",
    "tray-volume-menu",
  ].forEach((id) => {
    const menu = document.getElementById(id);
    giveKeysBackFrom(menu);
    menu.hidden = true;
  });
};

// Public shell hook for windows that need to notify the user without stealing
// focus (for example, an app that has finished loading).
const setWindowAttention = (gameId, needsAttention = true) => {
  const win = openWindows.get(gameId);
  if (!win) return false;
  win.needsAttention = Boolean(needsAttention) && gameId !== focusedGameId;
  renderTaskButtons();
  return true;
};
window.XPShell = Object.assign(window.XPShell || {}, { setWindowAttention });

const positionTaskbarMenu = (menu, clientX, clientY) => {
  menu.hidden = false;
  menu.style.left = "0";
  menu.style.top = "0";
  menu.style.left = `${Math.max(2, Math.min(clientX, getViewportWidth() - menu.offsetWidth - 2))}px`;
  menu.style.top = `${Math.max(2, Math.min(getTaskbarSettings().edge === "bottom" ? clientY - menu.offsetHeight : clientY, getViewportHeight() - menu.offsetHeight - 2))}px`;
  menu.querySelector("button:not(:disabled)")?.focus();
};

const wireTaskbarMenuKeyboard = (menu) => {
  menu.addEventListener("keydown", (event) => {
    if (event.target.closest('[role="menu"]') !== menu) return;
    const items = [...menu.children]
      .map((child) =>
        child.matches("button")
          ? child
          : child.matches(".context-parent")
            ? child.firstElementChild
            : null,
      )
      .filter((item) => item?.matches("button:not(:disabled)"));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    let target = null;
    if (event.key === "ArrowDown") {
      target = items[(current + 1 + items.length) % items.length];
    } else if (event.key === "ArrowUp") {
      target = items[(current - 1 + items.length) % items.length];
    } else if (event.key === "Home") {
      target = items[0];
    } else if (event.key === "End") {
      target = items.at(-1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeTaskbarMenus();
      document.getElementById("start-button").focus();
      return;
    } else if (
      (event.key === "Enter" || event.key === " ") &&
      document.activeElement?.matches("button:not(:disabled)")
    ) {
      event.preventDefault();
      document.activeElement.click();
      return;
    }
    if (target) {
      event.preventDefault();
      target.focus();
    }
  });
};

// Task buttons and menu entries exist only for open windows.
const activateTaskButton = (gameId) => {
  const win = openWindows.get(gameId);
  if (gameId === focusedGameId && !win.minimized) {
    minimizeWindow(gameId, { animate: true });
  } else {
    restoreWindow(gameId, { animate: true });
    focusWindow(gameId);
  }
};

// Task buttons for single windows are reused across renders so a focus change
// only updates their state instead of rebuilding every button and listener.
const taskButtonCache = new Map();

const renderTaskButtons = () => {
  const container = document.getElementById("task-buttons");
  // Task Manager's Hide When Minimized drops its button while minimized.
  let windows = [...openWindows.entries()].filter(
    ([, win]) => !(win.minimized && win.hideWhenMinimized),
  );
  const explorerWindows = windows.filter(
    ([, win]) => win.type === "system" && win.currentFolderId,
  );
  const groupExplorer =
    getTaskbarSettings().group &&
    explorerWindows.length >= 3 &&
    (document.getElementById("taskbar").classList.contains("vertical")
      ? windows.length * 28 > container.clientHeight
      : windows.length * 110 >
        container.clientWidth * getTaskbarSettings().rows);
  if (groupExplorer) {
    const first = windows.indexOf(explorerWindows[0]);
    windows = windows.filter((entry) => !explorerWindows.includes(entry));
    windows.splice(first, 0, [
      "__explorer-group",
      {
        title: `${explorerWindows.length} Windows Explorer`,
        groupedWindows: explorerWindows,
      },
    ]);
  }
  const styles = getComputedStyle(container);
  const taskMinWidth =
    Number.parseFloat(styles.getPropertyValue("--task-button-min-width")) || 52;
  const overflowMinWidth =
    Number.parseFloat(styles.getPropertyValue("--task-overflow-min-width")) ||
    68;
  const taskGap = Number.parseFloat(styles.gap) || 0;
  const contentWidth = Math.max(
    0,
    container.clientWidth -
      (Number.parseFloat(styles.paddingLeft) || 0) -
      (Number.parseFloat(styles.paddingRight) || 0),
  );
  const vertical = document
    .getElementById("taskbar")
    .classList.contains("vertical");
  const rows = vertical
    ? Math.max(1, Math.floor(container.clientHeight / 28))
    : Math.max(
        1,
        Math.min(
          getTaskbarSettings().rows,
          Math.floor(
            (parseFloat(document.getElementById("taskbar").style.height) -
              getTaskbarHeight() -
              (getTaskbarSettings().locked ? 0 : 4)) /
              26,
          ) + 1,
        ),
      );
  const allTasksWidth =
    windows.length * taskMinWidth + Math.max(0, windows.length - 1) * taskGap;
  const hasOverflow = vertical
    ? windows.length > rows
    : allTasksWidth > contentWidth * rows;
  // The overflow control has a larger minimum than a normal task. Account
  // for that control and its separating gap up front so it cannot be clipped.
  const visibleCapacity = hasOverflow
    ? Math.max(
        0,
        vertical
          ? rows - 1
          : Math.floor(
              contentWidth /
                (Math.max(taskMinWidth, overflowMinWidth) + taskGap),
            ) *
              rows -
              1,
      )
    : windows.length;
  const visible = windows.slice(0, visibleCapacity);
  const hidden = windows
    .slice(visible.length)
    .flatMap((entry) => entry[1].groupedWindows || [entry]);
  container.style.display = "grid";
  container.style.gridTemplateColumns = vertical
    ? "minmax(0, 1fr)"
    : `repeat(${Math.max(1, Math.ceil((visible.length + (hidden.length ? 1 : 0)) / rows))}, minmax(0, 160px))`;
  container.style.gridAutoRows = "26px";
  container.style.rowGap = vertical ? "2px" : "0px";
  const nodes = [];

  const appendTaskButton = ([gameId, win]) => {
    if (win.groupedWindows) {
      const button = document.createElement("button");
      button.className = "task-button task-button-grouped";
      const groupIcon = document.createElement("img");
      groupIcon.src = "assets/xp/icons/NewFolder.png";
      groupIcon.alt = "";
      groupIcon.width = 16;
      groupIcon.height = 16;
      const groupLabel = document.createElement("span");
      groupLabel.className = "task-label";
      groupLabel.textContent = win.title;
      button.append(groupIcon, groupLabel);
      button.setAttribute("aria-haspopup", "menu");
      button.addEventListener("click", () => {
        closeTaskbarMenus();
        const menu = document.getElementById("taskbar-overflow-menu");
        menu.replaceChildren();
        for (const [id, member] of win.groupedWindows) {
          const item = document.createElement("button");
          // Grouped windows are Explorer windows, which are always titled.
          item.textContent = member.title;
          item.setAttribute("role", "menuitem");
          item.addEventListener("click", () => {
            closeTaskbarMenus();
            restoreWindow(id, { animate: true });
            focusWindow(id);
          });
          menu.append(item);
        }
        const rect = button.getBoundingClientRect();
        positionTaskbarMenu(menu, rect.left, rect.top);
      });
      button.classList.toggle(
        "active",
        win.groupedWindows.some(
          ([id, member]) => id === focusedGameId && !member.minimized,
        ),
      );
      button.classList.toggle(
        "needs-attention",
        win.groupedWindows.some(([, member]) => member.needsAttention),
      );
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        closeTaskbarMenus();
        const menu = document.getElementById("taskbar-overflow-menu");
        menu.replaceChildren();
        const members = win.groupedWindows.map(([, member]) => member);
        const arrangeGroup = (mode) => {
          win.groupedWindows.forEach(([id]) => restoreWindow(id));
          arrangeTaskbarWindows(mode, members);
        };
        for (const [label, action] of [
          ["Cascade", () => arrangeGroup("cascade")],
          ["Tile Horizontally", () => arrangeGroup("tile-horizontal")],
          ["Tile Vertically", () => arrangeGroup("tile-vertical")],
          [
            "Minimize Group",
            () => win.groupedWindows.forEach(([id]) => minimizeWindow(id)),
          ],
          [
            "Close Group",
            async () => {
              // Explorer windows have no close confirmation to refuse.
              for (const [id] of win.groupedWindows) await closeGameWindow(id);
            },
          ],
        ]) {
          const item = document.createElement("button");
          item.setAttribute("role", "menuitem");
          item.textContent = label;
          item.disabled =
            label === "Minimize Group" &&
            members.every((member) => member.minimized);
          item.addEventListener("click", () => {
            closeTaskbarMenus();
            void action();
          });
          menu.append(item);
        }
        positionTaskbarMenu(menu, event.clientX, event.clientY);
      });
      nodes.push(button);
      return;
    }
    const taskTitle = win.title || formatGameTitle(gameId);
    let cached = taskButtonCache.get(gameId);
    if (cached?.win !== win) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.game = gameId;
      const label = document.createElement("span");
      label.className = "task-label";
      btn.append(label);
      btn.addEventListener("click", () => activateTaskButton(gameId));
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        closeTaskbarMenus();
        openWindowSystemMenu(win, event.clientX, event.clientY);
      });
      cached = { win, btn, label, icon: null, iconSource: undefined };
      taskButtonCache.set(gameId, cached);
    }
    const { btn, label } = cached;
    const active = gameId === focusedGameId && !win.minimized;
    btn.className =
      "task-button" +
      (active ? " active" : "") +
      (win.needsAttention ? " needs-attention" : "");
    if (btn.title !== taskTitle) btn.title = taskTitle;
    btn.setAttribute(
      "aria-label",
      `${taskTitle}${win.minimized ? ", minimized" : ""}${win.needsAttention ? ", needs attention" : ""}`,
    );
    btn.setAttribute("aria-pressed", String(active));
    if (!cached.icon) {
      cached.icon = createGameIconElement(gameId, "task-icon");
      btn.prepend(cached.icon);
    }
    if (label.textContent !== taskTitle) label.textContent = taskTitle;
    nodes.push(btn);
  };
  visible.forEach(appendTaskButton);

  if (hidden.length) {
    const overflow = document.createElement("button");
    overflow.type = "button";
    const hiddenNeedsAttention = hidden.some(([, win]) => win.needsAttention);
    overflow.className =
      "task-button task-button-grouped" +
      (hiddenNeedsAttention ? " needs-attention" : "");
    overflow.textContent = `${hidden.length} windows`;
    overflow.setAttribute(
      "aria-label",
      `Open menu for ${hidden.length} additional windows${hiddenNeedsAttention ? ", including a window that needs attention" : ""}`,
    );
    overflow.setAttribute("aria-haspopup", "menu");
    overflow.addEventListener("click", () => {
      const menu = document.getElementById("taskbar-overflow-menu");
      menu.innerHTML = "";
      const explorerWindows = hidden.filter(
        ([, win]) => win.type === "system" && win.currentFolderId,
      );
      const appendWindowItem = ([gameId, win]) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className =
          "taskbar-overflow-item" +
          (win.needsAttention ? " needs-attention" : "");
        item.setAttribute("role", "menuitem");
        item.textContent = win.title || formatGameTitle(gameId);
        item.setAttribute(
          "aria-label",
          `${formatGameTitle(gameId)}${win.minimized ? ", minimized" : ""}${win.needsAttention ? ", needs attention" : ""}`,
        );
        item.addEventListener("click", () => {
          closeTaskbarMenus();
          activateTaskButton(gameId);
        });
        item.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          closeTaskbarMenus();
          openWindowSystemMenu(win, event.clientX, event.clientY);
        });
        menu.appendChild(item);
      };
      // Group only genuinely similar windows. Other applications stay
      // separate menu items rather than being presented as one app.
      if (explorerWindows.length > 1) {
        const heading = document.createElement("span");
        heading.className = "taskbar-group-heading";
        heading.setAttribute("role", "presentation");
        heading.textContent = `Windows Explorer (${explorerWindows.length})`;
        menu.appendChild(heading);
        explorerWindows.forEach(appendWindowItem);
      }
      hidden
        .filter(
          (entry) =>
            !explorerWindows.includes(entry) || explorerWindows.length <= 1,
        )
        .forEach(appendWindowItem);
      const rect = overflow.getBoundingClientRect();
      positionTaskbarMenu(menu, rect.left, rect.top);
    });
    nodes.push(overflow);
  }
  // Touch the DOM only when the button set or order changed, which keeps
  // hover and keyboard focus on reused buttons.
  const current = container.children;
  if (
    current.length !== nodes.length ||
    nodes.some((node, index) => current[index] !== node)
  )
    container.replaceChildren(...nodes);
  for (const [gameId, cached] of taskButtonCache) {
    if (openWindows.get(gameId) !== cached.win) taskButtonCache.delete(gameId);
  }
};

const arrangeTaskbarWindows = (mode, members = [...openWindows.values()]) => {
  const windows = members.filter((win) => !win.minimized);
  if (!windows.length) return;
  const { width, height } = getDesktopSize();
  windows.forEach((win, index) => {
    if (win.maximized) toggleMaximize(win.gameId);
    if (mode === "cascade") {
      const offset = index * 26;
      Object.assign(win.el.style, {
        left: `${Math.min(offset, width - 340)}px`,
        top: `${Math.min(offset, height - 240)}px`,
        width: `${Math.max(340, width - Math.min(offset, 130))}px`,
        height: `${Math.max(240, height - Math.min(offset, 130))}px`,
      });
    } else {
      const horizontal = mode === "tile-horizontal";
      const count = windows.length;
      Object.assign(
        win.el.style,
        horizontal
          ? {
              left: "0px",
              top: `${(index * height) / count}px`,
              width: `${width}px`,
              height: `${height / count}px`,
            }
          : {
              left: `${(index * width) / count}px`,
              top: "0px",
              width: `${width / count}px`,
              height: `${height}px`,
            },
      );
    }
  });
  focusWindow(windows[windows.length - 1].gameId);
};

const openTaskManager = () => openSystemWindow("__task-manager");

const getStartMenuStyle = () =>
  localStorage.getItem(START_MENU_STYLE_KEY) === "classic"
    ? "classic"
    : "start";

const applyStartMenuStyle = (style, persist = true) => {
  const normalized = style === "classic" ? "classic" : "start";
  document.documentElement.dataset.xpStartMenu = normalized;
  renderedPlacesStyle = null;
  if (persist) localStorage.setItem(START_MENU_STYLE_KEY, normalized);
  closeStartMenu();
};

const openTaskbarProperties = (initialTab = "taskbar") => {
  const dialog = XPDialogs.createDialog({
    title: "Taskbar and Start Menu Properties",
    modal: false,
    help: true,
  });
  dialog.el.classList.add("taskbar-properties-dialog");

  const currentStartMenuStyle = getStartMenuStyle();
  const settings = getTaskbarSettings();
  let volumeBehavior = settings.volumeBehavior;
  dialog.body.innerHTML = `
    <div class="taskbar-properties-tabs" role="tablist">
      <button type="button" role="tab" data-taskbar-properties-tab="taskbar" aria-selected="true">Taskbar</button>
      <button type="button" role="tab" data-taskbar-properties-tab="start-menu">Start Menu</button>
    </div>
    <div class="taskbar-properties-panel" data-taskbar-properties-panel="taskbar">
      <div class="taskbar-properties-group taskbar-appearance-group"><span class="taskbar-properties-legend">Taskbar appearance</span>
        <img class="taskbar-properties-preview" src="assets/xp/system/TaskbarPreview.png" alt="Taskbar preview">
        <label><input type="checkbox" data-taskbar-setting="locked" ${taskbarLocked ? "checked" : ""}> Lock the taskbar</label>
        <label><input type="checkbox" data-taskbar-setting="auto-hide" ${settings.autoHide ? "checked" : ""}> Auto-hide the taskbar</label>
        <label><input type="checkbox" data-taskbar-setting="keep-on-top" ${settings.onTop ? "checked" : ""}> Keep the taskbar on top of other windows</label>
        <label><input type="checkbox" data-taskbar-setting="group" ${settings.group ? "checked" : ""}> Group similar taskbar buttons</label>
        <label><input type="checkbox" data-taskbar-setting="quick-launch" ${settings.quickLaunch ? "checked" : ""}> Show Quick Launch</label>
      </div>
      <div class="taskbar-properties-group notification-area-group"><span class="taskbar-properties-legend">Notification area</span>
        <img class="taskbar-properties-preview" src="assets/xp/system/NotificationAreaPreview.png" alt="Notification area preview">
        <label><input type="checkbox" data-taskbar-setting="show-clock" ${localStorage.getItem("taskbarShowClock") !== "false" ? "checked" : ""}> Show the clock</label>
        <p>You can keep the notification area uncluttered by hiding icons that you<br>have not clicked recently.</p>
        <label><input type="checkbox" data-taskbar-setting="hide-inactive" ${settings.hideInactive ? "checked" : ""}> Hide inactive icons</label>
        <button type="button" class="xp-btn" data-customize-tray>Customize...</button>
      </div>
    </div>
    <div class="taskbar-properties-panel taskbar-start-menu-panel" data-taskbar-properties-panel="start-menu" hidden>
      <img class="taskbar-start-menu-preview" src="assets/xp/system/StartMenuPreview.png" alt="Start menu preview">
      <label class="taskbar-start-menu-choice"><input type="radio" name="taskbar-start-menu-style" value="start" ${currentStartMenuStyle === "start" ? "checked" : ""}> Start menu</label>
      <p class="taskbar-start-menu-description">Select this menu style for easy access to the<br>Internet, e-mail, and your favorite programs.</p>
      <button type="button" class="xp-btn taskbar-start-customize" ${currentStartMenuStyle === "classic" ? "disabled" : ""}>Customize...</button>
      <label class="taskbar-classic-menu-choice"><input type="radio" name="taskbar-start-menu-style" value="classic" ${currentStartMenuStyle === "classic" ? "checked" : ""}> Classic Start menu</label>
      <p class="taskbar-classic-menu-description">Select this option to use the menu style from<br>earlier versions of Windows.</p>
      <button type="button" class="xp-btn taskbar-classic-customize" ${currentStartMenuStyle === "start" ? "disabled" : ""}>Customize...</button>
    </div>
    <div class="dlg-buttons taskbar-properties-buttons"></div>
  `;
  if (currentStartMenuStyle === "classic") {
    dialog.body.querySelector(".taskbar-start-menu-preview").src =
      "assets/xp/system/ClassicStartMenuPreview.png";
  }
  const tabs = [
    ...dialog.body.querySelectorAll("[data-taskbar-properties-tab]"),
  ];
  const panels = [
    ...dialog.body.querySelectorAll("[data-taskbar-properties-panel]"),
  ];
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      tabs.forEach((entry) =>
        entry.setAttribute(
          "aria-selected",
          String(
            entry.dataset.taskbarPropertiesTab ===
              tab.dataset.taskbarPropertiesTab,
          ),
        ),
      );
      panels.forEach((panel) => {
        panel.hidden =
          panel.dataset.taskbarPropertiesPanel !==
          tab.dataset.taskbarPropertiesTab;
      });
    }),
  );
  dialog.body
    .querySelector(`[data-taskbar-properties-tab="${initialTab}"]`)
    .click();
  const buttonRow = dialog.body.querySelector(".taskbar-properties-buttons");
  const apply = XPDialogs.createDialogButton(
    { id: "apply", label: "Apply" },
    () => {
      const checked = (name) =>
        dialog.body.querySelector(`[data-taskbar-setting="${name}"]`).checked;
      saveTaskbarSettings({
        locked: checked("locked"),
        autoHide: checked("auto-hide"),
        onTop: checked("keep-on-top"),
        group: checked("group"),
        quickLaunch: checked("quick-launch"),
        hideInactive: checked("hide-inactive"),
        volumeBehavior,
      });
      document.getElementById("taskbar-clock").hidden =
        !dialog.body.querySelector('[data-taskbar-setting="show-clock"]')
          .checked;
      localStorage.setItem(
        "taskbarShowClock",
        String(!document.getElementById("taskbar-clock").hidden),
      );
      applyStartMenuStyle(
        dialog.body.querySelector('[name="taskbar-start-menu-style"]:checked')
          .value,
      );
      apply.disabled = true;
    },
  );
  apply.disabled = true;
  const ok = XPDialogs.createDialogButton(
    { id: "ok", label: "OK", isDefault: true },
    () => {
      apply.click();
      dialog.close("ok");
    },
  );
  const cancel = XPDialogs.createDialogButton(
    { id: "cancel", label: "Cancel", isCancel: true },
    () => dialog.close("cancel"),
  );
  dialog.defaultButton = ok;
  buttonRow.append(ok, cancel, apply);
  dialog.body.addEventListener("change", (event) => {
    apply.disabled = false;
    if (event.target.name === "taskbar-start-menu-style") {
      const classic = event.target.value === "classic";
      dialog.body.querySelector(".taskbar-start-menu-preview").src = classic
        ? "assets/xp/system/ClassicStartMenuPreview.png"
        : "assets/xp/system/StartMenuPreview.png";
      dialog.body.querySelector(".taskbar-start-customize").disabled = classic;
      dialog.body.querySelector(".taskbar-classic-customize").disabled =
        !classic;
    }
  });
  dialog.body
    .querySelector(".taskbar-start-customize")
    .addEventListener("click", openCustomizeStartMenu);
  dialog.body
    .querySelector(".taskbar-classic-customize")
    .addEventListener("click", openCustomizeClassicStartMenu);
  dialog.body
    .querySelector("[data-customize-tray]")
    .addEventListener("click", () => {
      const customize = XPDialogs.createDialog({
        title: "Customize Notifications",
      });
      customize.el.classList.add("taskbar-customize-notifications");
      customize.body.innerHTML = `<p>Windows displays icons for active and urgent notifications, and hides inactive ones. You can change this behavior for items in the list below.</p><p>Select an item, then choose its notification behavior:</p><div class="notification-customize-list"><div class="notification-customize-head"><span>Name</span><span>Behavior</span></div><strong>Current Items</strong></div>`;
      const label = document.createElement("label");
      const name = document.createElement("span");
      name.textContent = "Volume";
      const volumeIcon = document.createElement("img");
      volumeIcon.src = "assets/xp/icons/Volume.png";
      volumeIcon.alt = "";
      name.prepend(volumeIcon);
      label.append(name);
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Volume notification behavior");
      for (const [value, text] of [
        ["auto", "Hide when inactive"],
        ["hide", "Always hide"],
        ["show", "Always show"],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.append(option);
      }
      select.value = volumeBehavior;
      label.append(select);
      customize.body
        .querySelector(".notification-customize-list")
        .append(label);
      const defaults = XPDialogs.createDialogButton(
        { id: "defaults", label: "Restore Defaults" },
        () => {
          select.value = "auto";
        },
      );
      defaults.classList.add("notification-restore-defaults");
      customize.body.append(defaults);
      const buttons = document.createElement("div");
      buttons.className = "notification-customize-buttons";
      customize.body.append(buttons);
      buttons.append(
        XPDialogs.createDialogButton({ id: "ok", label: "OK" }, () => {
          volumeBehavior = select.value;
          apply.disabled = false;
          customize.close("ok");
        }),
        XPDialogs.createDialogButton({ id: "cancel", label: "Cancel" }, () =>
          customize.close("cancel"),
        ),
      );
    });
  const customizeButton = dialog.body.querySelector("[data-customize-tray]");
  const hideInactive = dialog.body.querySelector(
    '[data-taskbar-setting="hide-inactive"]',
  );
  customizeButton.disabled = !hideInactive.checked;
  hideInactive.addEventListener("change", () => {
    customizeButton.disabled = !hideInactive.checked;
  });
  ok.focus();
};

let taskbarLocked = true;

const setTaskbarLocked = (locked) => {
  saveTaskbarSettings({ locked });
};

const setupTaskbarContextMenu = () => {
  setupTaskbarLayout();
  const taskbar = document.getElementById("taskbar");
  const menu = document.getElementById("taskbar-context-menu");
  const toolbarParent = document.getElementById("taskbar-toolbar-parent");
  const toolbarButton = toolbarParent.firstElementChild;
  const toolbarSubmenu = document.getElementById("taskbar-toolbar-submenu");
  wireTaskbarMenuKeyboard(menu);
  wireTaskbarMenuKeyboard(toolbarSubmenu);
  wireTaskbarMenuKeyboard(document.getElementById("taskbar-overflow-menu"));
  const openToolbarSubmenu = () => {
    toolbarParent.classList.add("open");
    toolbarButton.setAttribute("aria-expanded", "true");
    toolbarSubmenu.style.left = "calc(100% - 2px)";
    if (toolbarSubmenu.getBoundingClientRect().right > getViewportWidth())
      toolbarSubmenu.style.left = `${-toolbarSubmenu.offsetWidth + 5}px`;
  };
  const closeToolbarSubmenu = () => {
    giveKeysBackFrom(toolbarSubmenu);
    toolbarParent.classList.remove("open");
    toolbarButton.setAttribute("aria-expanded", "false");
  };
  toolbarParent.addEventListener("pointerenter", openToolbarSubmenu);
  toolbarParent.addEventListener("pointerleave", closeToolbarSubmenu);
  toolbarButton.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    openToolbarSubmenu();
    toolbarSubmenu.querySelector("button")?.focus();
  });
  toolbarSubmenu.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeToolbarSubmenu();
    toolbarButton.focus();
  });
  toolbarSubmenu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-taskbar-toolbar]")?.dataset
      .taskbarToolbar;
    if (!action) return;
    closeTaskbarMenus();
    if (action === "new") openNewTaskbarToolbar();
    else {
      const key = action === "desktop" ? "desktopToolbar" : "quickLaunch";
      saveTaskbarSettings({ [key]: !getTaskbarSettings()[key] });
    }
  });
  // XP gives the Start button its own menu. Open, Explore, and the All Users
  // entries are omitted because there is no Start Menu folder to show.
  const startButtonMenu = document.getElementById("start-button-menu");
  wireTaskbarMenuKeyboard(startButtonMenu);
  document
    .getElementById("start-button")
    .addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeStartMenu();
      closeWindowSystemMenu();
      closeTaskbarMenus();
      positionTaskbarMenu(startButtonMenu, event.clientX, event.clientY);
    });
  startButtonMenu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-start-button-action]")?.dataset
      .startButtonAction;
    if (!action) return;
    closeTaskbarMenus();
    if (action === "search") openSystemWindow("__search");
    else openTaskbarProperties("start-menu");
  });
  taskbar.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".task-button, #tray-volume-popup")) return;
    event.preventDefault();
    closeWindowSystemMenu();
    closeTaskbarMenus();
    closeToolbarSubmenu();
    const canArrange = [...openWindows.values()].some((win) => !win.minimized);
    ["cascade", "tile-horizontal", "tile-vertical"].forEach((action) => {
      menu.querySelector(`[data-taskbar-action="${action}"]`).disabled =
        !canArrange;
    });
    positionTaskbarMenu(menu, event.clientX, event.clientY);
  });
  menu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-taskbar-action]")?.dataset
      .taskbarAction;
    if (!action || event.target.closest("button")?.disabled) return;
    if (action === "toolbars") {
      openToolbarSubmenu();
      return;
    }
    closeTaskbarMenus();
    if (action === "show-desktop") toggleShowDesktop();
    else if (action === "cascade" || action.startsWith("tile-"))
      arrangeTaskbarWindows(action);
    else if (action === "task-manager") openTaskManager();
    else if (action === "lock") setTaskbarLocked(!taskbarLocked);
    else openTaskbarProperties();
  });
};

const CLOCK_OFFSET_KEY = "clockOffsetMs";

const getClockOffset = () => {
  const offset = parseInt(localStorage.getItem(CLOCK_OFFSET_KEY) || "0", 10);
  return Number.isFinite(offset) ? offset : 0;
};

const getShellTime = () => new Date(Date.now() + getClockOffset());

let updateClockDisplay = () => {};

const startClock = () => {
  const clock = document.getElementById("taskbar-clock");
  clock.hidden = localStorage.getItem("taskbarShowClock") === "false";
  // Reuse formatters: toLocale*String with options builds one per call.
  const timeFormat = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const weekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long" });
  const dateFormat = new Intl.DateTimeFormat("en-US");
  const titleFormat = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const update = () => {
    const now = getShellTime();
    const clockTime = timeFormat.format(now);
    const text =
      document.getElementById("taskbar").classList.contains("vertical") ||
      getTaskbarSettings().rows >= 3
        ? `${clockTime}\n${weekdayFormat.format(now)}\n${dateFormat.format(now)}`
        : clockTime;
    // XP tooltip: hovering the clock shows the full date.
    const title = titleFormat.format(now);
    // Skip unchanged writes so the 5-second tick does not dirty layout.
    if (clock.textContent !== text) clock.textContent = text;
    if (clock.title !== title) clock.title = title;
  };
  updateClockDisplay = update;
  update();
  setInterval(update, 5000);
};
