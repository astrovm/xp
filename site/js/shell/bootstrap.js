"use strict";

// ============================================
// Archived URL routing https://github.com/ruffle-rs/ruffle/issues/1486
// ============================================

const flashUrlRouter = window.AstroFlashUrlRouter.create(
  window.FLASH_GAMES,
  window.location.href,
  window.ASTRO_GAME_ROOTS,
  document.baseURI,
);

const { fetch: originalFetch } = window;
const routedFetch = flashUrlRouter.wrapFetch(originalFetch, (routed) => {
  console.log(`URL routed: ${routed.originalUrl} => ${routed.localUrl}`);
});
window.fetch = async (...args) => {
  const originalRequest = args[0];
  // Bundled routes are exact and authoritative. Resolve them before the
  // installed-game fallback, which may probe every legacy package remotely.
  if (flashUrlRouter.resolve(originalRequest)) {
    return routedFetch(...args);
  }
  if (gameLibraryReady && gameLibrary && !gameLibraryError) {
    try {
      const installedResponse = await gameLibrary.match(originalRequest);
      if (installedResponse) {
        const originalUrl =
          originalRequest instanceof Request
            ? new URL(originalRequest.url)
            : new URL(originalRequest, window.location.href);
        return flashUrlRouter.spoofResponseUrl(installedResponse, originalUrl);
      }
    } catch (error) {
      console.error("Installed game resource lookup failed:", error);
    }
  }
  return routedFetch(...args);
};

// ============================================
// Global Event Listeners
// ============================================

let altTabOrder = null;
let altTabIndex = 0;
const getMruWindows = () =>
  [...openWindows.values()].sort((a, b) => b.zIndex - a.zIndex);
const cycleShellWindow = (direction, showSwitcher) => {
  const windows = showSwitcher && altTabOrder ? altTabOrder : getMruWindows();
  if (!windows.length) return;
  if (showSwitcher && !altTabOrder) {
    altTabOrder = windows;
    altTabIndex = windows.findIndex((win) => win.gameId === focusedGameId);
  }
  const order = altTabOrder || windows;
  if (!showSwitcher)
    altTabIndex = order.findIndex((win) => win.gameId === focusedGameId);
  altTabIndex = (altTabIndex + direction + order.length) % order.length;
  const win = order[altTabIndex];
  restoreWindow(win.gameId);
  focusWindow(win.gameId);
  if (showSwitcher) {
    let switcher = document.getElementById("window-switcher");
    if (!switcher) {
      switcher = document.createElement("div");
      switcher.id = "window-switcher";
      document.body.appendChild(switcher);
    }
    switcher.textContent = windowTitleOf(win);
    switcher.hidden = false;
  }
};
const finishAltTab = () => {
  altTabOrder = null;
  altTabIndex = 0;
  document.getElementById("window-switcher")?.setAttribute("hidden", "");
};
const isEditableTarget = (target) =>
  /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "") ||
  target?.isContentEditable;
const typeaheadState = new WeakMap();
// The text that typeahead compares, with no case. With foldAccents, "ó"
// and "o" are the same.
const normalizeTypeaheadText = (value, foldAccents) => {
  const text = value.trim();
  return (
    foldAccents ? text.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : text
  ).toLocaleLowerCase();
};
// A typed character goes to the next item whose name starts with it. Like
// XP, an AltGr character, such as "ą" on a Polish keyboard, is a typed
// character too. A menu compares the exact character with no case, like
// the menus of XP: "ą" goes to an item that starts with "ą", never to one
// that starts with "a".
const cycleTypeaheadItem = (
  event,
  scope,
  items,
  getLabel,
  { foldAccents = true } = {},
) => {
  const key = normalizeTypeaheadText(
    XPDialogs.typedCharacterOf(event),
    foldAccents,
  );
  if (!key) return null;
  const matches = items.filter((item) =>
    normalizeTypeaheadText(getLabel(item), foldAccents).startsWith(key),
  );
  if (!matches.length) return null;

  const previous = typeaheadState.get(scope);
  const repeated =
    previous?.key === key &&
    matches.includes(previous.target) &&
    document.activeElement === previous.target;
  const target = repeated
    ? matches[(matches.indexOf(previous.target) + 1) % matches.length]
    : matches[0];
  typeaheadState.set(scope, { key, target });
  event.preventDefault();
  return target;
};
const typeaheadItemLabel = (item) =>
  item.getAttribute("aria-label") ||
  item.querySelector(
    ".icon-label, .menu-item-label, .context-label, .sm-game-title, b",
  )?.textContent ||
  item.textContent;
const confirmPermanentDelete = (ids) =>
  XPDialogs.confirm(
    ids.length === 1
      ? "Are you sure you want to permanently delete this item?"
      : "Are you sure you want to permanently delete these items?",
    "Confirm File Delete",
    "warning",
    XPDialogs.BUTTON_SETS.yesNoClosable,
  )
    .then(
      (yes) => yes && fs.transaction(() => ids.forEach((id) => fs.destroy(id))),
    )
    .catch(alertFileOperationError);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    const active = document.activeElement;
    let scope = active?.closest?.('[role="menu"], [role="menubar"]');
    const startMenu = document.getElementById("start-menu");
    if (
      !scope &&
      !startMenu.hidden &&
      (startMenu.contains(active) || active?.id === "start-button")
    ) {
      scope = startMenu;
    }
    if (!scope) return;

    const items = [...scope.querySelectorAll("button:not(:disabled)")].filter(
      (item) => {
        if (!item.getClientRects().length) return false;
        if (scope === startMenu) return startMenu.contains(item);
        return item.closest('[role="menu"], [role="menubar"]') === scope;
      },
    );
    const target = cycleTypeaheadItem(event, scope, items, typeaheadItemLabel, {
      foldAccents: false,
    });
    if (!target) return;
    target.focus();
    event.stopImmediatePropagation();
  },
  true,
);

const gameLibraryStartup = initializeGameLibrary();
gameLibraryInitialization = Promise.race([
  gameLibraryStartup,
  new Promise((resolve) => setTimeout(resolve, 5000)),
]);

document.addEventListener("DOMContentLoaded", () => {
  setupExplorerFilesystemSync();
  // Failures are logged; played-game downloads await the same promise.
  initializeOfflineMode().catch(() => {});
  setupScreenFlow();
  setupDesktopContextMenu();
  setupWindowSystemMenu();
  setupTaskbarContextMenu();
  setupSystemTray();
  document
    .getElementById("start-button")
    .addEventListener("click", toggleStartMenu);
  window.__ASTRO_STARTUP_READY__?.();
});

const visualViewportSize = () => {
  const viewport = window.visualViewport;
  return viewport
    ? `${viewport.width}x${viewport.height}@${viewport.scale}`
    : "";
};
let handledVisualViewportSize = "";
window.addEventListener("resize", () => {
  handledVisualViewportSize = visualViewportSize();
  closeTrayVolumePopup();
  // Reflow once below, after the toolbars have settled the work area.
  applySimulatedMonitor(activeMonitorResolution, { reflow: false });
  renderTaskbarToolbars();
  if (iconsBuilt) {
    layoutDesktopIcons();
  }
  if (loggedIn) {
    keepWindowsInWorkArea();
    renderTaskButtons();
  }
});

// Pinch zoom and on-screen keyboards resize only the visual viewport. A
// normal window resize fires both events. Skip only dimensions already handled.
window.visualViewport?.addEventListener("resize", () => {
  requestAnimationFrame(() => {
    if (visualViewportSize() !== handledVisualViewportSize)
      window.dispatchEvent(new Event("resize"));
  });
});

window.addEventListener("hashchange", () => {
  if (!loggedIn) return;

  const gameId = getHashGameId();
  if (gameId) {
    openLinkedGame(gameId);
  } else {
    // Empty hash means "back to desktop"
    minimizeAllWindows();
  }
});

// Tab does nothing in an open menu, like XP, so the keys stay in it.
// Alt+Tab still switches windows.
document.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Tab" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.target.closest?.('[role="menu"]')
    )
      event.preventDefault();
  },
  true,
);

// Every open menu of a window has its window's closeMenus. The shell closes
// them through it, which also gives back the keys and resets the titles.
const openWindowMenus = () =>
  document.querySelectorAll('.xp-window [role="menu"]:not([hidden])');

// A click into a program's frame sends no press to the page. The page then
// loses the keys, and every window closes its menus, like XP.
window.addEventListener("blur", () => {
  openWindowMenus().forEach((menu) => menu.closeMenus?.());
});

// Close the start menu when clicking outside of it
document.addEventListener("pointerdown", (e) => {
  if (suspended) return;
  // Each window closes its own menus. A press on a menu, or on an enabled
  // button that opens one, leaves that window's menus to the window.
  const menuWindow =
    e.target
      .closest('[role="menu"], [aria-haspopup="menu"]:not(:disabled)')
      ?.closest(".xp-window") ?? null;
  openWindowMenus().forEach((menu) => {
    if (menu.closest(".xp-window") !== menuWindow) menu.closeMenus?.();
  });
  if (!e.target.closest("#desktop-context-menu")) {
    closeDesktopContextMenu();
  }

  if (
    !e.target.closest("#window-system-menu") &&
    !e.target.closest(".title-icon")
  ) {
    closeWindowSystemMenu();
  }

  if (
    !e.target.closest("#start-button-menu") &&
    !e.target.closest("#taskbar-context-menu") &&
    !e.target.closest("#taskbar-overflow-menu") &&
    !e.target.closest("#tray-volume-menu") &&
    !e.target.closest(".task-button")
  ) {
    closeTaskbarMenus();
  }

  if (
    !e.target.closest("#tray-volume-popup") &&
    !e.target.closest("#tray-volume-button")
  ) {
    closeTrayVolumePopup();
  }

  const startMenu = document.getElementById("start-menu");
  if (startMenu.hidden) return;
  if (
    !e.target.closest("#start-menu") &&
    !e.target.closest("#start-menu-flyouts") &&
    !e.target.closest("#start-button")
  ) {
    closeStartMenu();
  }
});

document.addEventListener("keydown", async (e) => {
  try {
    if (suspended) {
      if (!["Alt", "Control", "Meta", "Shift"].includes(e.key)) {
        e.preventDefault();
        setSuspended(false);
      }
      return;
    }

    // Dialogs and editable controls own their keyboard semantics. Do not
    // steal browser text editing or modal access keys for shell shortcuts.
    if (e.defaultPrevented || XPDialogs.isModalOpen()) return;

    if (e.ctrlKey && e.shiftKey && e.key === "Escape") {
      e.preventDefault();
      openTaskManager();
      return;
    }

    if ((e.ctrlKey && e.key === "Escape") || e.key === "Meta") {
      e.preventDefault();
      toggleStartMenu();
      return;
    }

    // Window keys work from anywhere, text boxes included, like XP.
    if (e.altKey && e.key === "Tab") {
      e.preventDefault();
      cycleShellWindow(e.shiftKey ? -1 : 1, true);
      return;
    }
    if (e.altKey && e.key === "Escape") {
      e.preventDefault();
      cycleShellWindow(1, false);
      return;
    }

    if (e.altKey && e.key === "F4" && focusedGameId) {
      e.preventDefault();
      closeGameWindow(focusedGameId);
      return;
    }

    if (e.altKey && e.key === "F4" && !focusedGameId) {
      e.preventDefault();
      showShutdownDialog();
      return;
    }

    if (e.altKey && (e.key === " " || e.code === "Space") && focusedGameId) {
      e.preventDefault();
      // Minimizing a window moves focus away, so the focused one is visible.
      const win = openWindows.get(focusedGameId);
      const rect = win.el.getBoundingClientRect();
      openWindowSystemMenu(win, rect.left + 6, rect.top + 28);
      return;
    }

    if (isEditableTarget(e.target)) return;

    const desktopIcon = document.activeElement?.closest?.(".desktop-icon");
    const desktopHasFocus =
      desktopIcon || document.activeElement?.id === "desktop-icons";
    if (desktopHasFocus) {
      // Keys never move to an icon that is still moving away.
      const desktopIcons = [
        ...document.querySelectorAll(".desktop-icon:not(.desktop-moving)"),
      ];
      if (e.key === "F5") {
        e.preventDefault();
        refreshDesktop();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === " " && desktopIcon) {
        e.preventDefault();
        desktopIcon.classList.toggle("selected");
        return;
      }
      if (
        ["Home", "End"].includes(e.key) ||
        (!desktopIcon &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
      ) {
        // The Recycle Bin is always on the desktop.
        const target = e.key === "End" ? desktopIcons.at(-1) : desktopIcons[0];
        e.preventDefault();
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey)
          selectDesktopIcon(target.dataset.desktopId);
        if (e.shiftKey) target.classList.add("selected");
        target.focus();
        return;
      }
      const typeaheadTarget = cycleTypeaheadItem(
        e,
        document.getElementById("desktop-icons"),
        desktopIcons,
        typeaheadItemLabel,
      );
      if (typeaheadTarget) {
        selectDesktopIcon(typeaheadTarget.dataset.desktopId);
        typeaheadTarget.focus();
        return;
      }
      const {
        filesystemIds: selectedFsIds,
        allFilesystem,
        movable,
      } = getDesktopSelectionEligibility();
      if ((e.ctrlKey || e.metaKey) && XPDialogs.shortcutKeyOf(e) === "a") {
        e.preventDefault();
        document
          .querySelectorAll(".desktop-icon")
          .forEach((icon) => icon.classList.add("selected"));
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        XPDialogs.shortcutKeyOf(e) === "c" &&
        allFilesystem
      ) {
        e.preventDefault();
        fileOps.copy(selectedFsIds);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        XPDialogs.shortcutKeyOf(e) === "x" &&
        movable
      ) {
        e.preventDefault();
        fileOps.cut(selectedFsIds);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        XPDialogs.shortcutKeyOf(e) === "v" &&
        fileOps.canPaste(fs.DESKTOP)
      ) {
        e.preventDefault();
        pasteIntoFolder(fs.DESKTOP);
        return;
      }
      if (e.key === "Delete" && movable) {
        e.preventDefault();
        if (e.shiftKey) confirmPermanentDelete(selectedFsIds);
        else confirmRecycleDelete(selectedFsIds);
        return;
      }
      // Alt+Enter shows the Properties of the selected icon, wherever the
      // keys are on the desktop, like XP. No icon or many icons show none.
      if (e.altKey && e.key === "Enter") {
        e.preventDefault();
        showDesktopProperties();
        return;
      }
      if (e.key === "F2" && movable && selectedFsIds.length === 1) {
        e.preventDefault();
        beginDesktopRename(selectedFsIds[0]);
        return;
      }
      if (e.shiftKey && e.key === "F10") {
        e.preventDefault();
        const rect =
          desktopIcon?.getBoundingClientRect() ||
          document.getElementById("desktop").getBoundingClientRect();
        openDesktopContextMenu(
          rect.left + 8,
          rect.top + 8,
          desktopIcon?.dataset.desktopId || null,
        );
        return;
      }
      if (
        desktopIcon &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const target = findDesktopIconInDirection(
          desktopIcon,
          desktopIcons,
          e.key,
        );
        if (!target) return;
        if (!e.ctrlKey && !e.shiftKey)
          selectDesktopIcon(target.dataset.desktopId);
        if (e.shiftKey) target.classList.add("selected");
        target.focus();
        return;
      }
    }

    const explorerSurface =
      document.activeElement?.closest?.(".explorer-items");
    const explorerItem = document.activeElement?.closest?.(".explorer-item");
    const explorerWin =
      explorerSurface &&
      [...openWindows.values()].find((win) => win.el.contains(explorerSurface));
    if (explorerWin) {
      const explorerItems = [
        ...explorerSurface.querySelectorAll(".explorer-item"),
      ];
      const typeaheadTarget = cycleTypeaheadItem(
        e,
        explorerSurface,
        explorerItems,
        typeaheadItemLabel,
      );
      if (typeaheadTarget) {
        explorerItems.forEach((item) => item.classList.remove("selected"));
        typeaheadTarget.classList.add("selected");
        typeaheadTarget.focus();
        renderExplorerSelection(explorerWin);
        return;
      }
      const selected = selectedExplorerNodes(explorerWin);
      const protectedSelection = selected.some((id) => fs.isProtected(id));
      if ((e.ctrlKey || e.metaKey) && XPDialogs.shortcutKeyOf(e) === "a") {
        e.preventDefault();
        explorerWin.el
          .querySelectorAll(".explorer-item")
          .forEach((item) => item.classList.add("selected"));
        renderExplorerSelection(explorerWin);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        XPDialogs.shortcutKeyOf(e) === "c" &&
        selected.length
      ) {
        e.preventDefault();
        fileOps.copy(selected);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        XPDialogs.shortcutKeyOf(e) === "x" &&
        selected.length &&
        !protectedSelection
      ) {
        e.preventDefault();
        fileOps.cut(selected);
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        XPDialogs.shortcutKeyOf(e) === "v" &&
        fileOps.canPaste(explorerWin.currentFolderId)
      ) {
        e.preventDefault();
        pasteIntoFolder(explorerWin.currentFolderId);
        return;
      }
      // Alt+Enter shows the Properties of the one selected item, like XP.
      // No item or many items show none.
      if (e.altKey && e.key === "Enter" && selected.length === 1) {
        e.preventDefault();
        openShellProperties(selected[0]);
        return;
      }
      if (e.key === "F2" && selected.length === 1 && !protectedSelection) {
        e.preventDefault();
        startExplorerRename(explorerWin, selected[0]);
        return;
      }
      if (e.key === "Delete" && selected.length && !protectedSelection) {
        e.preventDefault();
        // In the Recycle Bin, Delete and Shift+Delete both delete for good,
        // and only what is still in the bin.
        if (explorerWin.currentFolderId === fs.RECYCLE_BIN)
          confirmRecycleBinDelete(selected);
        else if (e.shiftKey) confirmPermanentDelete(selected);
        else confirmRecycleDelete(selected);
        return;
      }
      if (e.shiftKey && e.key === "F10") {
        e.preventDefault();
        // The menu opens at the focused item, else at the first selected
        // item, else at the list.
        const rect = (
          explorerItem ||
          explorerSurface.querySelector(".explorer-item.selected") ||
          explorerSurface
        ).getBoundingClientRect();
        openExplorerContextMenu(explorerWin, rect.left, rect.bottom);
        return;
      }
    }

    if (e.key === "F11" && focusedGameId) {
      const win = openWindows.get(focusedGameId);
      if (win?.type !== "system" && win?.player) {
        e.preventDefault();
        toggleFullscreen(win.player);
      }
      return;
    }

    const taskButton = document.activeElement?.closest?.(".task-button");
    if (
      taskButton &&
      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
    ) {
      const buttons = [
        ...document.querySelectorAll("#task-buttons .task-button"),
      ];
      const current = buttons.indexOf(taskButton);
      const target =
        e.key === "Home"
          ? buttons[0]
          : e.key === "End"
            ? buttons.at(-1)
            : buttons[
                (current + (e.key === "ArrowLeft" ? -1 : 1) + buttons.length) %
                  buttons.length
              ];
      e.preventDefault();
      target?.focus();
      return;
    }

    if (e.key === "Escape") {
      closeWindowSystemMenu();
      closeTaskbarMenus();
      hideSystemDialogs();
      closeStartMenu();
      closeTrayVolumePopup();
    }
  } catch (error) {
    await alertError(error, "The file operation failed.", "File operation");
  }
});

document.addEventListener("keyup", (e) => {
  if (e.key === "Alt") finishAltTab();
});
