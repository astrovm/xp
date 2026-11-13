"use strict";

const QUICK_LAUNCH = "__quick-launch";
// Only toolbars for existing folders are rendered.
const toolbarName = (id) =>
  id === QUICK_LAUNCH ? "Quick Launch" : fs.getNode(id).name;
const toolbarLayout = (id) => {
  const saved = getTaskbarSettings().toolbarLayouts[id] || {};
  return {
    width: Math.max(
      36,
      Math.min(1600, Number(saved.width) || (id === QUICK_LAUNCH ? 90 : 180)),
    ),
    showText: saved.showText ?? id !== QUICK_LAUNCH,
    showTitle: saved.showTitle ?? id !== QUICK_LAUNCH,
    largeIcons: saved.largeIcons === true,
    floating: saved.floating === true,
    height: Math.max(60, Math.min(1200, Number(saved.height) || 300)),
    bandHeight: Math.max(26, Math.min(600, Number(saved.bandHeight) || 26)),
    onTop: saved.onTop === true,
    x: Math.max(0, Number.isFinite(saved.x) ? saved.x : 100),
    y: Math.max(0, Number.isFinite(saved.y) ? saved.y : 100),
  };
};
const saveToolbarLayout = (id, changes) =>
  saveTaskbarSettings({
    toolbarLayouts: {
      ...getTaskbarSettings().toolbarLayouts,
      [id]: { ...toolbarLayout(id), ...changes },
    },
  });
const closeToolbar = (id) => {
  const settings = getTaskbarSettings();
  saveTaskbarSettings(
    id === QUICK_LAUNCH
      ? { quickLaunch: false }
      : id === fs.DESKTOP
        ? { desktopToolbar: false }
        : { folders: settings.folders.filter((entry) => entry !== id) },
  );
};
const toolbarEntries = (id) => {
  const ids =
    id === QUICK_LAUNCH
      ? getTaskbarSettings().quickLaunchItems
      : id === fs.DESKTOP
        ? [...document.querySelectorAll(".desktop-icon")].map(
            (icon) => icon.dataset.desktopId,
          )
        : fs.getChildren(id).map((node) => node.id);
  return ids.flatMap((key) => {
    const node = fs.getNode(key);
    if (
      key !== "__show-desktop" &&
      !node &&
      !systemShortcuts[key] &&
      !gamesList[key]
    )
      return [];
    const desktopEntry = [...document.querySelectorAll(".desktop-icon")].find(
      (icon) => icon.dataset.desktopId === key,
    );
    const desktopIcon = desktopEntry?.querySelector("img");
    return [
      {
        id: key,
        name:
          key === "__show-desktop"
            ? "Show Desktop"
            : desktopEntry?.querySelector(".icon-label")?.textContent ||
              (gamesList[key] ? formatGameTitle(key) : node?.name) ||
              // Entries without a node or game are system shortcuts.
              systemShortcuts[key].title,
        icon:
          key === "__show-desktop"
            ? "assets/xp/icons/ShowDesktop.png"
            : desktopIcon?.src ||
              systemShortcuts[key]?.icon ||
              "assets/xp/icons/NewFolder.png",
      },
    ];
  });
};
const launchToolbarEntry = (id) =>
  id === "__show-desktop" ? toggleShowDesktop() : openDesktopItem(id);
const toolbarMenu = (anchor, actions) => {
  closeTaskbarMenus();
  const menu = document.getElementById("taskbar-overflow-menu");
  menu.replaceChildren();
  const appendActions = (target, entries) => {
    for (const { label, action, checked, icon, children } of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("aria-label", label);
      item.setAttribute(
        "role",
        checked === undefined ? "menuitem" : "menuitemcheckbox",
      );
      if (checked !== undefined)
        item.setAttribute("aria-checked", String(checked));
      if (icon) {
        const image = document.createElement("img");
        image.src = icon;
        image.alt = "";
        image.width = image.height = 16;
        item.append(image);
      }
      const text = document.createElement("span");
      text.textContent = `${checked ? "✓ " : ""}${label}`;
      item.append(text);
      if (children) {
        const parent = document.createElement("div");
        parent.className = "context-parent";
        const submenu = document.createElement("div");
        submenu.className = "xp-context-menu toolbar-view-menu";
        submenu.setAttribute("role", "menu");
        submenu.hidden = true;
        item.setAttribute("aria-haspopup", "menu");
        item.setAttribute("aria-expanded", "false");
        parent.append(item, submenu);
        target.append(parent);
        appendActions(submenu, children);
        wireTaskbarMenuKeyboard(submenu);
        const open = () => {
          submenu.hidden = false;
          item.setAttribute("aria-expanded", "true");
          const rect = item.getBoundingClientRect();
          submenu.style.left = `${Math.min(getViewportWidth() - submenu.offsetWidth - 2, rect.right)}px`;
          submenu.style.top = `${Math.min(getViewportHeight() - submenu.offsetHeight - 2, rect.top)}px`;
        };
        const close = () => {
          giveKeysBackFrom(submenu);
          submenu.hidden = true;
          item.setAttribute("aria-expanded", "false");
        };
        item.addEventListener("click", () => {
          open();
          submenu.querySelector("button")?.focus();
        });
        parent.addEventListener("pointerenter", open);
        parent.addEventListener("pointerleave", close);
        item.addEventListener("keydown", (event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            open();
            submenu.querySelector("button")?.focus();
          }
        });
        submenu.addEventListener(
          "keydown",
          (event) => {
            if (["ArrowLeft", "Escape"].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              close();
              item.focus();
            }
          },
          true,
        );
      } else {
        item.addEventListener("click", () => {
          closeTaskbarMenus();
          action();
        });
        target.append(item);
      }
    }
  };
  appendActions(menu, actions);
  if (!actions.length) {
    const item = document.createElement("button");
    item.textContent = "(Empty)";
    item.disabled = true;
    menu.append(item);
  }
  const rect = anchor.getBoundingClientRect();
  positionTaskbarMenu(menu, rect.left, rect.top);
};
const toolbarContext = (id, anchor) => {
  const layout = toolbarLayout(id);
  const locked = getTaskbarSettings().locked && !layout.floating;
  toolbarMenu(anchor, [
    ...(!locked
      ? [
          {
            label: "Show Text",
            checked: layout.showText,
            action: () => saveToolbarLayout(id, { showText: !layout.showText }),
          },
          ...(!layout.floating
            ? [
                {
                  label: "Show Title",
                  checked: layout.showTitle,
                  action: () =>
                    saveToolbarLayout(id, { showTitle: !layout.showTitle }),
                },
              ]
            : []),
          {
            label: "View",
            children: [
              {
                label: "Large Icons",
                checked: layout.largeIcons,
                action: () => saveToolbarLayout(id, { largeIcons: true }),
              },
              {
                label: "Small Icons",
                checked: !layout.largeIcons,
                action: () => saveToolbarLayout(id, { largeIcons: false }),
              },
            ],
          },
        ]
      : []),
    ...(id !== QUICK_LAUNCH
      ? [{ label: "Open Folder", action: () => openDesktopItem(id) }]
      : []),
    ...(layout.floating
      ? [
          {
            label: "Always on Top",
            checked: layout.onTop,
            action: () => saveToolbarLayout(id, { onTop: !layout.onTop }),
          },
        ]
      : []),
    { label: "Close Toolbar", action: () => closeToolbar(id) },
  ]);
};

// Item and toolbar drags commit only on pointerup; Escape/cancellation restores
// the previous layout. Capturing the handle keeps a drag independent of its hitbox.
const activateTaskbarToolbar = (element, id) => {
  document
    .querySelectorAll(".taskbar-toolbar.floating.active")
    .forEach((toolbar) => toolbar.classList.remove("active"));
  element.classList.add("active");
  const layout = toolbarLayout(id);
  if (layout.floating && !layout.onTop)
    element.style.zIndex = String(++zIndexCounter);
};
const wireToolbarDrag = (handle, element, id, resize = false) => {
  handle.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
        event.key,
      ) ||
      (getTaskbarSettings().locked && !toolbarLayout(id).floating)
    )
      return;
    event.preventDefault();
    const layout = toolbarLayout(id),
      delta = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -10 : 10;
    if (resize)
      saveToolbarLayout(
        id,
        !layout.floating &&
          document.getElementById("taskbar").classList.contains("vertical")
          ? { bandHeight: layout.bandHeight + delta }
          : layout.floating && ["ArrowUp", "ArrowDown"].includes(event.key)
            ? { height: layout.height + delta }
            : { width: layout.width + delta },
      );
    else if (layout.floating)
      saveToolbarLayout(
        id,
        ["ArrowLeft", "ArrowRight"].includes(event.key)
          ? { x: layout.x + delta }
          : { y: layout.y + delta },
      );
    else {
      const order = [
        ...document.querySelectorAll("#taskbar-toolbars > .taskbar-toolbar"),
      ].map((toolbar) => toolbar.dataset.toolbarId);
      const index = order.indexOf(id),
        target = Math.max(
          0,
          Math.min(order.length - 1, index + Math.sign(delta)),
        );
      order.splice(index, 1);
      order.splice(target, 0, id);
      saveTaskbarSettings({ toolbarOrder: order });
    }
    const replacement = [...document.querySelectorAll(".taskbar-toolbar")].find(
      (toolbar) => toolbar.dataset.toolbarId === id,
    );
    replacement
      ?.querySelector(
        resize
          ? ".toolbar-size"
          : layout.floating
            ? ".toolbar-title"
            : ".toolbar-grip",
      )
      ?.focus();
  });
  handle.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      (getTaskbarSettings().locked && !toolbarLayout(id).floating)
    )
      return;
    event.stopPropagation();
    event.preventDefault();
    activateTaskbarToolbar(element, id);
    const initial = toolbarLayout(id),
      rect = element.getBoundingClientRect();
    const verticalBand =
      !initial.floating &&
      document.getElementById("taskbar").classList.contains("vertical");
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    handle.setPointerCapture(event.pointerId);
    const move = (e) => {
      if (e.pointerId !== event.pointerId) return;
      moved ||= Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4;
      if (!moved) return;
      if (resize) {
        if (verticalBand)
          element.style.height = `${Math.max(26, rect.height + e.clientY - start.y)}px`;
        else
          element.style.width = `${Math.max(36, rect.width + e.clientX - start.x)}px`;
        if (initial.floating)
          element.style.height = `${Math.max(60, rect.height + e.clientY - start.y)}px`;
      } else
        element.style.transform = `translate(${e.clientX - start.x}px,${e.clientY - start.y}px)`;
    };
    const finish = (e, cancel = false) => {
      if (e.pointerId !== undefined && e.pointerId !== event.pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancelDrag);
      handle.removeEventListener("lostpointercapture", cancelDrag);
      document.removeEventListener("keydown", key);
      element.style.transform = "";
      if (cancel || !moved) {
        element.style.width = `${initial.width}px`;
        if (initial.floating) element.style.height = `${initial.height}px`;
        else if (verticalBand) element.style.height = `${initial.bandHeight}px`;
        return;
      }
      if (resize) {
        saveToolbarLayout(
          id,
          verticalBand
            ? { bandHeight: Math.max(26, rect.height + e.clientY - start.y) }
            : {
                width: Math.max(36, rect.width + e.clientX - start.x),
                ...(initial.floating
                  ? { height: Math.max(60, rect.height + e.clientY - start.y) }
                  : {}),
              },
        );
        return;
      }
      const bar = document.getElementById("taskbar"),
        barRect = bar.getBoundingClientRect();
      const dock =
        e.clientX >= barRect.left - 8 &&
        e.clientX <= barRect.right + 8 &&
        e.clientY >= barRect.top - 8 &&
        e.clientY <= barRect.bottom + 8;
      if (dock) {
        const peers = [
          ...document.querySelectorAll("#taskbar-toolbars > .taskbar-toolbar"),
        ].filter((peer) => peer.dataset.toolbarId !== id);
        const vertical = bar.classList.contains("vertical");
        let index = peers.findIndex((peer) => {
          const r = peer.getBoundingClientRect();
          return vertical
            ? e.clientY < r.top + r.height / 2
            : e.clientX < r.left + r.width / 2;
        });
        if (index < 0) index = peers.length;
        const order = peers.map((peer) => peer.dataset.toolbarId);
        order.splice(index, 0, id);
        saveTaskbarSettings({
          toolbarOrder: order,
          toolbarLayouts: {
            ...getTaskbarSettings().toolbarLayouts,
            [id]: { ...initial, floating: false },
          },
        });
      } else
        saveToolbarLayout(id, {
          floating: true,
          width: initial.floating ? initial.width : 300,
          x: Math.max(
            0,
            Math.min(getViewportWidth() - 60, rect.left + e.clientX - start.x),
          ),
          y: Math.max(
            0,
            Math.min(getViewportHeight() - 40, rect.top + e.clientY - start.y),
          ),
        });
    };
    const up = (e) => finish(e),
      cancelDrag = (e) => finish(e, true),
      key = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(e, true);
        }
      };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancelDrag);
    handle.addEventListener("lostpointercapture", cancelDrag);
    document.addEventListener("keydown", key);
  });
};

const wireQuickLaunchOrder = (button, toolbar) => {
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || getTaskbarSettings().locked) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    button.setPointerCapture(event.pointerId);
    const move = (e) => {
      if (e.pointerId !== event.pointerId) return;
      moved ||= Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4;
    };
    const finish = (e) => {
      if (e.pointerId !== event.pointerId) return;
      cancel();
      if (!moved) return;
      button.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        },
        { once: true, capture: true },
      );
      const peers = [...toolbar.querySelectorAll("[data-shortcut]")].filter(
        (item) => item !== button,
      );
      const target = peers.find((item) => {
        const r = item.getBoundingClientRect();
        return e.clientY < r.bottom && e.clientX < r.left + r.width / 2;
      });
      const order = getTaskbarSettings().quickLaunchItems.filter(
        (id) => id !== button.dataset.shortcut,
      );
      const index = target
        ? order.indexOf(target.dataset.shortcut)
        : order.length;
      order.splice(index, 0, button.dataset.shortcut);
      saveTaskbarSettings({ quickLaunchItems: order });
    };
    const cancel = () => {
      button.removeEventListener("pointermove", move);
      button.removeEventListener("pointerup", finish);
      button.removeEventListener("pointercancel", cancel);
      button.removeEventListener("lostpointercapture", cancel);
      document.removeEventListener("keydown", key);
    };
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    button.addEventListener("pointermove", move);
    button.addEventListener("pointerup", finish);
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("lostpointercapture", cancel);
    document.addEventListener("keydown", key);
  });
};

let toolbarObserver;
const fitToolbarItems = (toolbar) => {
  const items = toolbar.querySelector(".toolbar-items"),
    overflow = toolbar.querySelector(".toolbar-overflow");
  if (toolbar.classList.contains("floating")) {
    [...items.children].forEach((item) => {
      item.hidden = false;
    });
    overflow.hidden = true;
    return;
  }
  const buttons = [...items.children];
  if (!items.clientWidth) {
    buttons.forEach((button) => {
      button.hidden = true;
    });
    overflow.hidden = !buttons.length;
    return;
  }
  buttons.forEach((button) => {
    button.hidden = false;
  });
  overflow.hidden = true;
  const vertical = toolbar.closest("#taskbar")?.classList.contains("vertical");
  if (vertical) {
    const bottom = items.getBoundingClientRect().bottom;
    if (
      buttons.some((button) => button.getBoundingClientRect().bottom > bottom)
    ) {
      overflow.hidden = false;
      const firstHidden = buttons.findIndex(
        (button) => button.getBoundingClientRect().bottom > bottom,
      );
      buttons.forEach((button, index) => {
        button.hidden = firstHidden >= 0 && index >= firstHidden;
      });
    }
    return;
  }
  // Measure before hiding anything; interleaving reads with the hidden writes
  // forces a layout per button.
  const measure = () =>
    buttons.map((button) => button.getBoundingClientRect().width);
  const total = measure().reduce((sum, width) => sum + width, 0);
  if (total > items.clientWidth) {
    overflow.hidden = false;
    const available = items.clientWidth;
    const widths = measure();
    let used = 0;
    buttons.forEach((button, index) => {
      used += widths[index];
      button.hidden = used > available;
    });
  }
};
const renderTaskbarToolbars = () => {
  toolbarObserver?.disconnect();
  const settings = getTaskbarSettings(),
    host = document.getElementById("taskbar-toolbars");
  // A toolbar control with the keys keeps them, else Start takes them.
  const giveKeysBack = holdKeys(document.body, (keys) => {
    const toolbar = keys.closest(".taskbar-toolbar");
    if (!toolbar) return null;
    const control = keys.dataset.shortcut
      ? `[data-shortcut="${CSS.escape(keys.dataset.shortcut)}"]`
      : `.${keys.classList[0]}`;
    return `.taskbar-toolbar[data-toolbar-id="${CSS.escape(toolbar.dataset.toolbarId)}"] ${control}`;
  });
  host.replaceChildren();
  document
    .querySelectorAll(".taskbar-toolbar.floating")
    .forEach((toolbar) => toolbar.remove());
  const ids = [
    ...new Set([
      ...(settings.quickLaunch ? [QUICK_LAUNCH] : []),
      ...(settings.desktopToolbar ? [fs.DESKTOP] : []),
      ...settings.folders,
    ]),
  ];
  ids.sort((a, b) => {
    const rank = (id) => {
      const i = settings.toolbarOrder.indexOf(id);
      return i < 0 ? 999 : i;
    };
    return rank(a) - rank(b);
  });
  for (const id of ids) {
    if (id !== QUICK_LAUNCH && fs.getNode(id)?.type !== "folder") continue;
    const layout = toolbarLayout(id),
      toolbar = document.createElement("div");
    toolbar.className = `taskbar-toolbar${id === QUICK_LAUNCH ? " quick-launch-toolbar" : " taskbar-folder-toolbar"}${layout.floating ? " floating" : ""}${layout.largeIcons ? " large-icons" : ""}`;
    toolbar.dataset.toolbarId = id;
    toolbar.setAttribute("aria-label", toolbarName(id));
    toolbar.style.width = `${layout.width}px`;
    if (
      !layout.floating &&
      document.getElementById("taskbar").classList.contains("vertical")
    )
      toolbar.style.height = `${Math.max(layout.largeIcons ? 42 : 26, layout.bandHeight)}px`;
    toolbar.addEventListener("pointerdown", () =>
      activateTaskbarToolbar(toolbar, id),
    );
    if (layout.floating) {
      toolbar.style.height = `${layout.height}px`;
      toolbar.style.zIndex = layout.onTop ? "8000" : String(++zIndexCounter);
    }
    const grip = document.createElement("button");
    grip.className = "toolbar-grip";
    grip.setAttribute("aria-label", `Move ${toolbarName(id)} toolbar`);
    grip.title = toolbarName(id);
    grip.hidden = settings.locked || layout.floating;
    toolbar.append(grip);
    wireToolbarDrag(grip, toolbar, id);
    const title = document.createElement("span");
    title.className = "toolbar-title";
    title.textContent = toolbarName(id);
    title.hidden = !layout.showTitle && !layout.floating;
    title.tabIndex = settings.locked && !layout.floating ? -1 : 0;
    toolbar.append(title);
    wireToolbarDrag(title, toolbar, id);
    const items = document.createElement("div");
    items.className = "toolbar-items";
    toolbar.append(items);
    const entries = toolbarEntries(id);
    for (const entry of entries) {
      const button = document.createElement("button");
      button.className =
        id === QUICK_LAUNCH ? "quick-launch-button" : "toolbar-item";
      button.dataset.shortcut = entry.id;
      button.title = entry.name;
      button.setAttribute("aria-label", entry.name);
      const icon = document.createElement("img");
      icon.src = entry.icon;
      icon.alt = "";
      button.append(icon);
      if (layout.showText) {
        const label = document.createElement("span");
        label.textContent = entry.name;
        button.append(label);
      }
      button.addEventListener("click", () => launchToolbarEntry(entry.id));
      if (id === QUICK_LAUNCH) {
        wireQuickLaunchOrder(button, toolbar);
        button.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          toolbarMenu(button, [
            {
              label: "Delete",
              action: () =>
                saveTaskbarSettings({
                  quickLaunchItems:
                    getTaskbarSettings().quickLaunchItems.filter(
                      (key) => key !== entry.id,
                    ),
                }),
            },
          ]);
        });
      }
      items.append(button);
    }
    const overflow = document.createElement("button");
    overflow.className = "toolbar-overflow";
    overflow.textContent = "»";
    overflow.setAttribute("aria-label", `${toolbarName(id)} overflow`);
    overflow.setAttribute("aria-haspopup", "menu");
    overflow.hidden = true;
    overflow.addEventListener("click", () =>
      toolbarMenu(
        overflow,
        entries
          .filter(
            (entry) =>
              items.querySelector(`[data-shortcut="${CSS.escape(entry.id)}"]`)
                ?.hidden,
          )
          .map((entry) => ({
            label: entry.name,
            icon: entry.icon,
            action: () => launchToolbarEntry(entry.id),
          })),
      ),
    );
    toolbar.append(overflow);
    const resize = document.createElement("button");
    resize.className = "toolbar-size";
    resize.setAttribute("aria-label", `Resize ${toolbarName(id)} toolbar`);
    resize.hidden = settings.locked && !layout.floating;
    toolbar.append(resize);
    wireToolbarDrag(resize, toolbar, id, true);
    toolbar.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toolbarContext(id, toolbar);
    });
    if (layout.floating) {
      toolbar.style.left = `${Math.max(0, Math.min(getViewportWidth() - Math.min(layout.width, getViewportWidth()), layout.x))}px`;
      toolbar.style.top = `${Math.max(0, Math.min(getViewportHeight() - 60, layout.y))}px`;
      const close = document.createElement("button");
      close.className = "toolbar-close";
      close.textContent = "";
      close.setAttribute("aria-label", `Close ${toolbarName(id)} toolbar`);
      close.addEventListener("click", () => closeToolbar(id));
      toolbar.append(close);
      document.getElementById("desktop").append(toolbar);
    } else host.append(toolbar);
  }
  host.hidden = !host.children.length;
  giveKeysBack(document.getElementById("start-button"));
  const fit = () =>
    document.querySelectorAll(".taskbar-toolbar").forEach(fitToolbarItems);
  requestAnimationFrame(fit);
  toolbarObserver = new ResizeObserver(() => {
    fit();
    renderTaskButtons();
  });
  document
    .querySelectorAll(".taskbar-toolbar")
    .forEach((toolbar) => toolbarObserver.observe(toolbar));
  for (const [name, value] of [
    ["quick-launch", settings.quickLaunch],
    ["desktop", settings.desktopToolbar],
  ]) {
    const button = document.querySelector(`[data-taskbar-toolbar="${name}"]`);
    button.setAttribute("role", "menuitemcheckbox");
    button.setAttribute("aria-checked", String(value));
    button.querySelector(".context-check").textContent = value ? "✓" : "";
  }
};
