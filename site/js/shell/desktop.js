"use strict";

// ============================================
// Desktop Icons
// ============================================

const DESKTOP_ICON_METRICS = Object.freeze({
  regular: { width: 75, height: 75, gap: 0, margin: 0 },
  compact: { width: 60, height: 58, gap: 4, margin: 4 },
});
let desktopDragged = false;
let desktopSelectionAnchor = null;
// Icons dropped on a folder or the Recycle Bin stay hidden until the move
// ends, also when the Desktop redraws after each moved item. A moving icon
// is never part of the selection, so no other drag or command takes it.
const movingDesktopIds = new Set();
const markDesktopIconMoving = (icon, moving) => {
  icon.classList.toggle("desktop-moving", moving);
  icon.style.visibility = moving ? "hidden" : "";
};
const SELECTED_DESKTOP_ICONS = ".desktop-icon.selected:not(.desktop-moving)";

const getDesktopIconMetrics = (container) =>
  container.clientWidth <= 480
    ? DESKTOP_ICON_METRICS.compact
    : DESKTOP_ICON_METRICS.regular;

const getDesktopIconPositions = () => {
  const positions = readJsonStorage(
    "desktopIconPositions",
    {},
    (positions) => positions && typeof positions === "object",
  );
  let migrated = false;
  fs.getChildren(fs.DESKTOP).forEach((node) => {
    if (!node.app || !gamesList[node.app] || !positions[node.app]) return;
    if (!positions[node.id]) positions[node.id] = positions[node.app];
    delete positions[node.app];
    migrated = true;
  });
  if (migrated) writeJsonStorage("desktopIconPositions", positions);
  return positions;
};

const saveDesktopIconPosition = (icon) => {
  const positions = getDesktopIconPositions();
  positions[icon.dataset.desktopId] = {
    left: icon.offsetLeft,
    top: icon.offsetTop,
  };
  writeJsonStorage("desktopIconPositions", positions);
};

const selectDesktopIcon = (desktopId, additive = false) => {
  if (!additive) desktopSelectionAnchor = desktopId;
  document.querySelectorAll(".desktop-icon").forEach((el) => {
    const shouldSelect = el.dataset.desktopId === desktopId;
    el.classList.toggle(
      "selected",
      additive
        ? el.classList.contains("selected") || shouldSelect
        : shouldSelect,
    );
  });
};

const findDesktopIconInDirection = (currentIcon, icons, key) => {
  const currentRect = currentIcon.getBoundingClientRect();
  const currentX = currentRect.left + currentRect.width / 2;
  const currentY = currentRect.top + currentRect.height / 2;
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;

  return icons
    .filter((icon) => icon !== currentIcon)
    .map((icon) => {
      const rect = icon.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - currentX;
      const dy = rect.top + rect.height / 2 - currentY;
      const primary = (horizontal ? dx : dy) * sign;
      const perpendicular = Math.abs(horizontal ? dy : dx);
      return { icon, primary, score: primary + perpendicular * 2 };
    })
    .filter(({ primary }) => primary > 1)
    .sort((a, b) => a.score - b.score || a.primary - b.primary)[0]?.icon;
};

const clearDesktopSelection = () => {
  document.querySelectorAll(".desktop-icon.selected").forEach((icon) => {
    icon.classList.remove("selected");
  });
};

const getSelectedDesktopIds = () =>
  [...document.querySelectorAll(SELECTED_DESKTOP_ICONS)].map(
    (icon) => icon.dataset.desktopId,
  );

const getSelectedFilesystemIds = () =>
  getSelectedDesktopIds().filter((id) => !!fs.getNode(id));

const getDesktopSelectionEligibility = () => {
  const selectedIds = getSelectedDesktopIds();
  const filesystemIds = selectedIds.filter((id) => !!fs.getNode(id));
  const allFilesystem =
    filesystemIds.length > 0 && filesystemIds.length === selectedIds.length;
  const movable =
    allFilesystem && filesystemIds.every((id) => !fs.isProtected(id));
  return { selectedIds, filesystemIds, allFilesystem, movable };
};

const layoutDesktopIcons = (force = false) => {
  const container = document.getElementById("desktop-icons");
  const positions = force ? {} : getDesktopIconPositions();
  const metrics = getDesktopIconMetrics(container);
  const { width, height, gap, margin } = metrics;
  const usableWidth = Math.max(container.clientWidth - margin * 2, width);
  const usableHeight = Math.max(container.clientHeight - margin * 2, height);
  const columns = Math.max(1, Math.floor((usableWidth + gap) / (width + gap)));
  const rows = Math.max(1, Math.floor((usableHeight + gap) / (height + gap)));
  const icons = Array.from(container.querySelectorAll(".desktop-icon"));
  const overflowsViewport = icons.length > columns * rows;
  const requiredRows = overflowsViewport
    ? Math.ceil(icons.length / columns)
    : rows;
  const maxTop = Math.max(
    container.clientHeight - height,
    margin + (requiredRows - 1) * (height + gap),
  );
  const placed = [];
  const overlapsPlaced = (left, top) =>
    placed.some(
      (rect) =>
        left < rect.left + width &&
        left + width > rect.left &&
        top < rect.top + height &&
        top + height > rect.top,
    );
  const firstFreeGridSlot = () => {
    for (let row = 0; row < requiredRows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const left = margin + column * (width + gap);
        const top = margin + row * (height + gap);
        if (!overlapsPlaced(left, top)) return { left, top };
      }
    }
    return { left: margin, top: margin + requiredRows * (height + gap) };
  };
  container.classList.toggle("desktop-icons-overflow", overflowsViewport);
  container.style.setProperty(
    "--desktop-icon-overflow-height",
    `${margin + requiredRows * (height + gap)}px`,
  );
  // Read once: reading it after each icon's style write forces a layout per
  // icon.
  const containerWidth = container.clientWidth;

  icons.forEach((icon, index) => {
    const saved = positions[icon.dataset.desktopId];
    const column = overflowsViewport
      ? index % columns
      : Math.floor(index / rows);
    const row = overflowsViewport ? Math.floor(index / columns) : index % rows;
    let fallbackLeft = margin + column * (width + gap);
    let fallbackTop = margin + row * (height + gap);
    const savedLeft = saved?.left;
    const savedTop = saved?.top;
    const savedIsValid =
      Number.isFinite(savedLeft) &&
      Number.isFinite(savedTop) &&
      savedLeft >= 0 &&
      savedLeft <= containerWidth - width &&
      savedTop >= 0 &&
      savedTop <= maxTop &&
      !overlapsPlaced(savedLeft, savedTop);
    let left = savedIsValid ? savedLeft : fallbackLeft;
    let top = savedIsValid ? savedTop : fallbackTop;
    left = Math.max(0, Math.min(left, containerWidth - width));
    top = Math.max(0, Math.min(top, maxTop));
    if (overlapsPlaced(left, top)) ({ left, top } = firstFreeGridSlot());
    placed.push({ left, top });
    icon.style.left = `${left}px`;
    icon.style.top = `${top}px`;
  });

  if (force) {
    localStorage.removeItem("desktopIconPositions");
  }
};

const findDesktopDropTarget = (clientX, clientY, draggedIds) => {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const target = element.closest?.(
      "[data-drop-action], [data-drop-destination-id]",
    );
    if (!target) continue;
    if (target.dataset.dropAction === "recycle") {
      return { action: "recycle", element: target };
    }
    const destinationId = target.dataset.dropDestinationId;
    if (
      destinationId === fs.DESKTOP ||
      draggedIds.has(destinationId) ||
      fs.getNode(destinationId)?.type !== "folder"
    ) {
      continue;
    }
    return { action: "move", element: target, destinationId };
  }
  return null;
};

const wireDesktopIconDrag = (icon) => {
  icon.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const wasSelected = icon.classList.contains("selected");
    icon.dataset.pointerSelected = String(wasSelected);
    if (!wasSelected) {
      selectDesktopIcon(icon.dataset.desktopId, additive);
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const selected = [...document.querySelectorAll(SELECTED_DESKTOP_ICONS)].map(
      (item) => ({
        item,
        left: item.offsetLeft,
        top: item.offsetTop,
      }),
    );
    const container = document.getElementById("desktop-icons");
    const eligibility = getDesktopSelectionEligibility();
    const draggedIds = new Set(eligibility.filesystemIds);
    let dropTarget = null;
    desktopDragged = false;

    const onMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!desktopDragged && Math.hypot(deltaX, deltaY) < 4) return;

      desktopDragged = true;
      const groupLeft = Math.min(...selected.map(({ left }) => left));
      const groupTop = Math.min(...selected.map(({ top }) => top));
      const groupRight = Math.max(
        ...selected.map(({ item, left }) => left + item.offsetWidth),
      );
      const groupBottom = Math.max(
        ...selected.map(({ item, top }) => top + item.offsetHeight),
      );
      const clampedX = Math.max(
        -groupLeft,
        Math.min(deltaX, container.clientWidth - groupRight),
      );
      const clampedY = Math.max(
        -groupTop,
        Math.min(deltaY, container.clientHeight - groupBottom),
      );
      selected.forEach(({ item, left: startLeft, top: startTop }) => {
        const left = startLeft + clampedX;
        const top = startTop + clampedY;
        item.style.left = `${left}px`;
        item.style.top = `${top}px`;
      });

      dropTarget?.element.classList.remove("drop-target");
      dropTarget = eligibility.movable
        ? findDesktopDropTarget(
            moveEvent.clientX,
            moveEvent.clientY,
            draggedIds,
          )
        : null;
      dropTarget?.element.classList.add("drop-target");
    };

    const onUp = async (upEvent) => {
      icon.removeEventListener("pointermove", onMove);
      icon.removeEventListener("pointerup", onUp);
      icon.removeEventListener("pointercancel", onUp);
      dropTarget?.element.classList.remove("drop-target");
      dropTarget =
        eligibility.movable && upEvent.type === "pointerup"
          ? findDesktopDropTarget(upEvent.clientX, upEvent.clientY, draggedIds)
          : null;
      const returnIcons = () =>
        selected.forEach(({ item, left, top }) => {
          item.style.left = `${left}px`;
          item.style.top = `${top}px`;
        });
      if (upEvent.type === "pointercancel") {
        returnIcons();
        return;
      }
      if (
        desktopDragged &&
        document
          .elementsFromPoint(upEvent.clientX, upEvent.clientY)
          .some((element) => element.closest?.(".quick-launch-toolbar"))
      ) {
        saveTaskbarSettings({
          quickLaunchItems: [
            ...new Set([
              ...getTaskbarSettings().quickLaunchItems,
              ...selected.map(({ item }) => item.dataset.desktopId),
            ]),
          ],
        });
        returnIcons();
        return;
      }
      if (desktopDragged) {
        if (dropTarget) {
          // The icons hide while the items move. Items that move away leave
          // the Desktop when it redraws. After a failure or Cancel, the
          // icons come back at their places.
          selected.forEach(({ item }) => {
            movingDesktopIds.add(item.dataset.desktopId);
            markDesktopIconMoving(item, true);
          });
          let failure = null;
          // Desktop items are never in the Recycle Bin when a drag starts.
          // Items deleted during the drag stay where they are.
          const ids = eligibility.filesystemIds.filter(
            (id) => !!fs.getNode(id) && !fs.isInRecycleBin(id),
          );
          if (ids.length && dropTarget.action === "recycle") {
            try {
              await fileOps.removeToBin(ids);
            } catch (error) {
              failure = error;
            }
          } else if (ids.length) {
            // A drag moves the items without the clipboard, like XP. A
            // failure shows its own alert.
            await pasteIntoFolder(dropTarget.destinationId, {
              mode: "cut",
              ids,
              fromBin: [],
            });
          }
          returnIcons();
          selected.forEach(({ item }) =>
            movingDesktopIds.delete(item.dataset.desktopId),
          );
          // Icons of another drop that still runs stay hidden.
          container.querySelectorAll(".desktop-icon").forEach((item) => {
            if (!movingDesktopIds.has(item.dataset.desktopId))
              markDesktopIconMoving(item, false);
          });
          // A failed delete shows an alert, like the Delete key.
          if (failure) await alertFileOperationError(failure);
        } else if (getDesktopLayoutSettings().autoArrange) {
          layoutDesktopIcons(true);
        } else {
          const { alignToGrid } = getDesktopLayoutSettings();
          selected.forEach(({ item }) => {
            if (alignToGrid) {
              const metrics = getDesktopIconMetrics(container);
              item.style.left = `${metrics.margin + Math.round((item.offsetLeft - metrics.margin) / (metrics.width + metrics.gap)) * (metrics.width + metrics.gap)}px`;
              item.style.top = `${metrics.margin + Math.round((item.offsetTop - metrics.margin) / (metrics.height + metrics.gap)) * (metrics.height + metrics.gap)}px`;
            }
            item.style.left = `${Math.max(0, Math.min(item.offsetLeft, container.clientWidth - item.offsetWidth))}px`;
            item.style.top = `${Math.max(0, Math.min(item.offsetTop, container.clientHeight - item.offsetHeight))}px`;
            saveDesktopIconPosition(item);
          });
        }
      }
    };

    try {
      icon.setPointerCapture(event.pointerId);
    } catch (error) {
      /* pointer capture unsupported */
    }

    icon.addEventListener("pointermove", onMove);
    icon.addEventListener("pointerup", onUp);
    icon.addEventListener("pointercancel", onUp);
  });
};

const wireDesktopSelectionRectangle = () => {
  const container = document.getElementById("desktop-icons");
  const rectangle = document.getElementById("desktop-selection");

  container.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target !== container) return;

    container.tabIndex = 0;
    container.querySelectorAll(".desktop-icon").forEach((icon) => {
      icon.tabIndex = -1;
    });
    container.focus({ preventScroll: true });
    closeDesktopContextMenu();
    const additive = event.ctrlKey || event.metaKey;
    const initialSelection = new Set(
      Array.from(document.querySelectorAll(SELECTED_DESKTOP_ICONS)).map(
        (icon) => icon.dataset.desktopId,
      ),
    );
    if (!additive) {
      clearDesktopSelection();
    }

    const bounds = container.getBoundingClientRect();
    const startX = event.clientX - bounds.left;
    const startY = event.clientY - bounds.top;
    rectangle.hidden = false;
    rectangle.style.left = `${startX}px`;
    rectangle.style.top = `${startY}px`;
    rectangle.style.width = "0";
    rectangle.style.height = "0";

    const onMove = (moveEvent) => {
      const currentX = Math.max(
        0,
        Math.min(moveEvent.clientX - bounds.left, bounds.width),
      );
      const currentY = Math.max(
        0,
        Math.min(moveEvent.clientY - bounds.top, bounds.height),
      );
      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      Object.assign(rectangle.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });

      // Measure every icon before toggling any class, so the loop does not
      // force a style and layout pass per icon on each pointer move.
      const { scrollLeft, scrollTop } = container;
      const hits = [...document.querySelectorAll(".desktop-icon")].map(
        (icon) => [
          icon,
          icon.offsetLeft - scrollLeft < left + width &&
            icon.offsetLeft - scrollLeft + icon.offsetWidth > left &&
            icon.offsetTop - scrollTop < top + height &&
            icon.offsetTop - scrollTop + icon.offsetHeight > top,
        ],
      );
      for (const [icon, intersects] of hits) {
        icon.classList.toggle(
          "selected",
          intersects ||
            (additive && initialSelection.has(icon.dataset.desktopId)),
        );
      }
    };

    const onUp = () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      rectangle.hidden = true;
    };

    try {
      container.setPointerCapture(event.pointerId);
    } catch (error) {
      /* pointer capture unsupported */
    }

    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
    event.preventDefault();
  });
};

const buildDesktopIcons = () => {
  const wasBuilt = iconsBuilt;
  iconsBuilt = true;

  const container = document.getElementById("desktop-icons");
  container.hidden = getDesktopLayoutSettings().showIcons === false;
  // The rebuild removes an open rename box, so its blur must not rename.
  const renameBox = container.querySelector(".desktop-rename");
  const reopen = renameBox?.dropRename() ? renameBox : null;
  // The icon with the keys gets them back after the rebuild, like XP. An
  // icon that is gone leaves the keys on the desktop.
  const giveKeysBack = holdKeys(
    container,
    (keys) =>
      `.desktop-icon[data-desktop-id="${CSS.escape(keys.closest(".desktop-icon").dataset.desktopId)}"]`,
  );
  container.replaceChildren();
  container.tabIndex = 0;
  // System places stay available even though regular desktop files are
  // rendered directly from VirtualFS.DESKTOP.
  const desktopItems = [
    "__my-computer",
    "__my-documents",
    "__internet-games",
    "__astro-settings",
  ].filter(
    (id) =>
      systemShortcuts[id]?.desktop !== false &&
      getDesktopSystemIcons()[id] !== false,
  );
  const recycleBinItems = ["__recycle-bin"].filter(
    (id) => systemShortcuts[id]?.desktop !== false,
  );
  const desktopSort = getDesktopLayoutSettings().sort;
  const desktopNodeSortName = (node) =>
    node.ext === ".game" ? node.name.slice(0, -node.ext.length) : node.name;
  // localeCompare with options builds a new collator on every call.
  const desktopNameCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const compareDesktopNodeNames = (a, b) =>
    desktopNameCollator.compare(desktopNodeSortName(a), desktopNodeSortName(b));
  const desktopNodeType = (node) => node.ext || node.type;
  const compareDesktopNodes = (a, b) => {
    if (desktopSort === "size")
      return a.size - b.size || compareDesktopNodeNames(a, b);
    if (desktopSort === "type")
      return (
        desktopNodeType(a).localeCompare(desktopNodeType(b)) ||
        compareDesktopNodeNames(a, b)
      );
    if (desktopSort === "modified")
      return b.modified - a.modified || compareDesktopNodeNames(a, b);
    return compareDesktopNodeNames(a, b);
  };
  const entries = [
    ...desktopItems.map((id) => ({ id, system: true })),
    ...recycleBinItems.map((id) => ({ id, system: true })),
    ...fs
      .getChildren(fs.DESKTOP)
      .slice()
      .sort(compareDesktopNodes)
      .map((node) => ({ id: node.id, node })),
  ];

  entries.forEach(({ id, system, node }) => {
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "desktop-icon";
    icon.tabIndex = -1;
    icon.addEventListener("focus", () => {
      container.tabIndex = -1;
      container.querySelectorAll(".desktop-icon").forEach((item) => {
        item.tabIndex = item === icon ? 0 : -1;
      });
    });
    icon.dataset.desktopId = id;
    if (movingDesktopIds.has(id)) markDesktopIconMoving(icon, true);
    if (system) icon.dataset.systemId = id;
    if (node?.type === "folder") icon.dataset.dropDestinationId = node.id;
    if (id === "__recycle-bin") icon.dataset.dropAction = "recycle";

    const glyph = system
      ? createGameIconElement(id, "icon-glyph")
      : node.app && gamesList[node.app]
        ? createGameIconElement(node.app, "icon-glyph")
        : createExplorerIcon(node);
    glyph.classList.add("icon-glyph");
    const image = glyph.querySelector("img");
    if (image)
      glyph.style.setProperty(
        "--desktop-icon-mask",
        `url(${JSON.stringify(image.src)})`,
      );

    const label = document.createElement("span");
    label.className = "icon-label";
    label.textContent = system
      ? getDesktopSystemNames()[id] || formatGameTitle(id)
      : node.ext === ".game"
        ? node.name.slice(0, -node.ext.length)
        : node.name;

    icon.append(glyph, label);
    icon.addEventListener("click", (event) => {
      if (!desktopDragged) {
        const additive = event.ctrlKey || event.metaKey;
        if (event.shiftKey && desktopSelectionAnchor) {
          const icons = [...container.querySelectorAll(".desktop-icon")];
          const anchor = icons.findIndex(
            (item) => item.dataset.desktopId === desktopSelectionAnchor,
          );
          const current = icons.indexOf(icon);
          icons.forEach((item, index) =>
            item.classList.toggle(
              "selected",
              index >= Math.min(anchor, current) &&
                index <= Math.max(anchor, current),
            ),
          );
        } else if (additive) {
          const wasSelected = icon.dataset.pointerSelected;
          icon.classList.toggle(
            "selected",
            wasSelected === undefined
              ? !icon.classList.contains("selected")
              : wasSelected !== "true",
          );
        } else selectDesktopIcon(id);
        delete icon.dataset.pointerSelected;
      }
    });
    icon.addEventListener("dblclick", () => {
      if (!desktopDragged) {
        openDesktopItem(id);
      }
    });
    icon.addEventListener("keydown", (event) => {
      // Alt+Enter shows Properties, from the shell's keys.
      if (event.key === "Enter" && !event.altKey) {
        event.preventDefault();
        openDesktopItem(id);
      }
    });
    wireDesktopIconDrag(icon);
    container.appendChild(icon);
  });

  giveKeysBack(container);
  if (reopen) reopenDesktopRename(reopen);
  renderTaskbarToolbars();
  if (!wasBuilt) wireDesktopSelectionRectangle();
  if (!wasBuilt) wireFolderDropTarget(container, fs.DESKTOP);
  requestAnimationFrame(() =>
    layoutDesktopIcons(getDesktopLayoutSettings().autoArrange),
  );
};

const closeDesktopContextMenu = () => {
  const menu = document.getElementById("desktop-context-menu");
  giveKeysBackFrom(menu);
  menu.hidden = true;
};

const getDesktopLayoutSettings = () =>
  readJsonStorage("desktopLayoutSettings", {
    sort: "name",
    autoArrange: false,
    alignToGrid: true,
    showIcons: true,
  });

const saveDesktopLayoutSettings = (settings) =>
  writeJsonStorage("desktopLayoutSettings", settings);

const refreshDesktop = () => {
  const icons = document.getElementById("desktop-icons");
  icons.classList.remove("desktop-refresh");
  requestAnimationFrame(() => icons.classList.add("desktop-refresh"));
  buildDesktopIcons();
};

// The rebuilt icon of a rename takes the keys.
const focusDesktopIcon = (id) =>
  document
    .querySelector(`.desktop-icon[data-desktop-id="${CSS.escape(id)}"]`)
    .focus({ preventScroll: true });

const beginDesktopRename = (id) => {
  const icon = document.querySelector(
    `.desktop-icon[data-desktop-id="${CSS.escape(id)}"]`,
  );
  // Callers only rename unprotected files that have a desktop icon.
  const node = fs.getNode(id);
  const label = icon.querySelector(".icon-label");
  const input = document.createElement("input");
  input.className = "desktop-rename";
  input.value = node.name;
  input.dataset.desktopId = id;
  input.dataset.originalName = node.name;
  label.replaceWith(input);
  XPDialogs.guardFileName(input);
  input.focus();
  input.select();
  let finished = false;
  // A rebuild of the icons drops the box without a rename. It returns true
  // if the box was still open.
  input.dropRename = () => {
    const open = !finished;
    finished = true;
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    return open;
  };
  // Enter and Escape leave the keys on the icon, like XP. A rename that
  // ends because the keys left keeps them where they went.
  async function finish(save, keepKeys = false) {
    if (finished) return;
    finished = true;
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    if (save) {
      try {
        await fileOps.rename(id, input.value);
      } catch (error) {
        // Like XP, a name Windows refuses shows an error, and the box opens
        // again with that name.
        refreshDesktop();
        await alertRenameError(error);
        // An icon that went away while the error showed takes no box.
        if (
          !document.querySelector(
            `.desktop-icon[data-desktop-id="${CSS.escape(id)}"]`,
          )
        )
          return;
        const again = beginDesktopRename(id);
        again.value = input.value;
        again.select();
        return;
      }
    }
    refreshDesktop();
    if (keepKeys) focusDesktopIcon(id);
  }
  function onOutsidePointerDown(event) {
    if (!input.contains(event.target)) finish(true);
  }
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(event.key === "Enter", true);
    }
  });
  input.addEventListener("blur", () => finish(true), { once: true });
  document.addEventListener("pointerdown", onOutsidePointerDown, true);
  return input;
};

const beginSystemDesktopRename = (id) => {
  const icon = document.querySelector(
    `.desktop-icon[data-desktop-id="${CSS.escape(id)}"]`,
  );
  const label = icon.querySelector(".icon-label");
  const input = document.createElement("input");
  input.className = "desktop-rename";
  input.value = label.textContent;
  input.dataset.desktopId = id;
  input.dataset.originalName = label.textContent;
  input.dataset.system = "";
  label.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  input.dropRename = () => {
    const open = !finished;
    finished = true;
    return open;
  };
  const finish = (save, keepKeys = false) => {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    if (save && name) {
      saveDesktopSystemNames({ ...getDesktopSystemNames(), [id]: name });
    }
    refreshDesktop();
    if (keepKeys) focusDesktopIcon(id);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finish(event.key === "Enter", true);
  });
  input.addEventListener("blur", () => finish(true), { once: true });
  return input;
};

// A rebuild of the icons keeps an open rename box, with the text typed so
// far, like Explorer. A box with no change yet shows the current name.
const reopenDesktopRename = (old) => {
  const id = old.dataset.desktopId;
  const icon = document.querySelector(
    `.desktop-icon[data-desktop-id="${CSS.escape(id)}"]`,
  );
  if (!icon) return;
  const begin =
    "system" in old.dataset ? beginSystemDesktopRename : beginDesktopRename;
  const input = begin(id);
  if (old.value !== old.dataset.originalName) {
    input.value = old.value;
    input.setSelectionRange(old.selectionStart, old.selectionEnd);
  }
};

const addDesktopMenuItem = (
  menu,
  label,
  action,
  { disabled = false, checked = false, defaultItem = false } = {},
) => {
  const button = document.createElement("button");
  button.type = "button";
  button.role = "menuitem";
  button.dataset.action = action;
  button.disabled = disabled;
  button.classList.toggle("context-default", defaultItem);
  button.setAttribute("role", checked ? "menuitemcheckbox" : "menuitem");
  if (checked) button.setAttribute("aria-checked", "true");
  const gutter = document.createElement("span");
  gutter.className = "context-check";
  gutter.setAttribute("aria-hidden", "true");
  gutter.textContent = checked ? "✓" : "";
  const text = document.createElement("span");
  text.className = "context-label";
  text.textContent = label;
  button.append(gutter, text);
  menu.appendChild(button);
};

const addDesktopSubmenu = (menu, label, buildItems) => {
  const parent = document.createElement("div");
  parent.className = "context-parent";
  const button = document.createElement("button");
  button.type = "button";
  button.role = "menuitem";
  button.className = "context-submenu-button";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const gutter = document.createElement("span");
  gutter.className = "context-check";
  gutter.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "context-label";
  text.textContent = label;
  button.append(gutter, text);
  const arrow = document.createElement("span");
  arrow.className = "context-arrow";
  button.appendChild(arrow);
  const child = document.createElement("div");
  child.className = "xp-context-menu context-submenu";
  child.setAttribute("role", "menu");
  buildItems(child);
  const open = () => {
    parent.classList.add("open");
    button.setAttribute("aria-expanded", "true");
    child.style.left = "100%";
    child.style.top = "-2px";
    const rect = child.getBoundingClientRect();
    if (rect.right > getViewportWidth())
      child.style.left = `${-child.offsetWidth + 2}px`;
    const bottom = document
      .getElementById("desktop")
      .getBoundingClientRect().bottom;
    if (rect.bottom > bottom)
      child.style.top = `${-2 - (rect.bottom - bottom)}px`;
  };
  const close = () => {
    giveKeysBackFrom(child);
    parent.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("click", open);
  parent.addEventListener("pointerenter", open);
  parent.addEventListener("pointerleave", close);
  button.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      open();
      child.querySelector("button:not(:disabled)")?.focus();
    }
  });
  child.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      button.focus();
    }
  });
  parent.append(button, child);
  menu.appendChild(parent);
};

const addDesktopSeparator = (menu) => {
  const separator = document.createElement("span");
  separator.className = "context-separator";
  separator.setAttribute("aria-hidden", "true");
  menu.appendChild(separator);
};

const renderDesktopContextMenu = (menu, itemId) => {
  const {
    filesystemIds: selectedFsIds,
    allFilesystem,
    movable,
  } = getDesktopSelectionEligibility();
  const settings = getDesktopLayoutSettings();
  menu.replaceChildren();
  menu.dataset.itemId = itemId || "";

  if (itemId === "__recycle-bin") {
    addDesktopMenuItem(menu, "Open", "open", { defaultItem: true });
    addDesktopMenuItem(menu, "Explore", "explore");
    addDesktopMenuItem(menu, "Empty Recycle Bin", "empty-recycle-bin", {
      disabled: !fs.getChildren(fs.RECYCLE_BIN).length,
    });
    addDesktopSeparator(menu);
    addDesktopMenuItem(menu, "Create Shortcut", "create-recycle-shortcut");
    addDesktopSeparator(menu);
    addDesktopMenuItem(menu, "Properties", "recycle-properties");
  } else if (itemId === "__my-computer") {
    addDesktopMenuItem(menu, "Open", "open", { defaultItem: true });
    addDesktopMenuItem(menu, "Explore", "explore-my-computer");
    addDesktopMenuItem(menu, "Search...", "search-my-computer");

    addDesktopSeparator(menu);
    addDesktopMenuItem(menu, "Create Shortcut", "create-computer-shortcut");
    addDesktopMenuItem(menu, "Delete", "hide-my-computer");
    addDesktopMenuItem(menu, "Rename", "rename-my-computer");
    addDesktopSeparator(menu);
    addDesktopMenuItem(menu, "Properties", "computer-properties");
  } else if (itemId) {
    addDesktopMenuItem(menu, "Open", "open");
    addDesktopSeparator(menu);
    addDesktopMenuItem(menu, "Cut", "cut", { disabled: !movable });
    addDesktopMenuItem(menu, "Copy", "copy", { disabled: !allFilesystem });
    addDesktopMenuItem(menu, "Delete", "delete", { disabled: !movable });
    addDesktopMenuItem(menu, "Rename", "rename", {
      disabled: !movable || selectedFsIds.length !== 1,
    });
    addDesktopSeparator(menu);
    addDesktopMenuItem(menu, "Properties", "item-properties", {
      disabled: selectedFsIds.length !== 1,
    });
  } else {
    addDesktopSubmenu(menu, "Arrange Icons By", (submenu) => {
      addDesktopMenuItem(submenu, "Name", "sort-name", {
        checked: settings.sort === "name",
      });
      addDesktopMenuItem(submenu, "Size", "sort-size", {
        checked: settings.sort === "size",
      });
      addDesktopMenuItem(submenu, "Type", "sort-type", {
        checked: settings.sort === "type",
      });
      addDesktopMenuItem(submenu, "Modified", "sort-modified", {
        checked: settings.sort === "modified",
      });
      addDesktopSeparator(submenu);
      addDesktopMenuItem(submenu, "Auto Arrange", "auto-arrange", {
        checked: settings.autoArrange,
      });
      addDesktopMenuItem(submenu, "Align to Grid", "align-grid", {
        checked: settings.alignToGrid,
      });
      addDesktopSeparator(submenu);
      addDesktopMenuItem(submenu, "Show Desktop Icons", "show-icons", {
        checked: settings.showIcons !== false,
      });
    });
    addDesktopMenuItem(menu, "Refresh", "refresh");
    addDesktopSeparator(menu);
    addDesktopMenuItem(menu, "Paste", "paste", {
      disabled: !fileOps.canPaste(fs.DESKTOP),
    });
    addDesktopMenuItem(menu, "Paste Shortcut", "paste-shortcut", {
      disabled: true,
    });
    addDesktopSeparator(menu);
    addDesktopSubmenu(menu, "New", (submenu) => {
      addDesktopMenuItem(submenu, "Folder", "new-folder");
      addDesktopMenuItem(submenu, "Text Document", "new-text");
      addDesktopMenuItem(submenu, "Bitmap Image", "new-bitmap");
      addDesktopSeparator(submenu);
      addDesktopMenuItem(submenu, "Upload from Computer...", "upload");
    });
    addDesktopSeparator(menu);
    addDesktopMenuItem(menu, "Properties", "properties");
  }
};

const openDesktopContextMenu = (clientX, clientY, itemId) => {
  const desktop = document.getElementById("desktop");
  const menu = document.getElementById("desktop-context-menu");
  const bounds = desktop.getBoundingClientRect();

  closeStartMenu();
  renderDesktopContextMenu(menu, itemId);
  menu.hidden = false;
  menu.style.left = "0";
  menu.style.top = "0";

  const left = Math.max(
    0,
    Math.min(clientX - bounds.left, bounds.width - menu.offsetWidth - 2),
  );
  const top = Math.max(
    0,
    Math.min(clientY - bounds.top, bounds.height - menu.offsetHeight - 2),
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector("button:not(:disabled)")?.focus();
};

const setupDesktopContextMenu = () => {
  const desktop = document.getElementById("desktop");
  const menu = document.getElementById("desktop-context-menu");

  desktop.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".xp-window, #start-menu")) return;
    event.preventDefault();
    const icon = event.target.closest(".desktop-icon");
    if (!icon) {
      clearDesktopSelection();
    } else if (!icon.classList.contains("selected")) {
      selectDesktopIcon(icon.dataset.desktopId);
    }
    openDesktopContextMenu(
      event.clientX,
      event.clientY,
      icon?.dataset.desktopId || null,
    );
  });

  menu.addEventListener("click", async (event) => {
    try {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      const itemId = menu.dataset.itemId || null;
      const selectedFsIds = getSelectedFilesystemIds();
      if (action.startsWith("sort-")) {
        saveDesktopLayoutSettings({
          ...getDesktopLayoutSettings(),
          sort: action.slice(5),
        });
        buildDesktopIcons();
        layoutDesktopIcons(true);
      } else if (action === "auto-arrange") {
        const settings = getDesktopLayoutSettings();
        saveDesktopLayoutSettings({
          ...settings,
          autoArrange: !settings.autoArrange,
        });
        if (!settings.autoArrange) layoutDesktopIcons(true);
      } else if (action === "align-grid") {
        const settings = getDesktopLayoutSettings();
        saveDesktopLayoutSettings({
          ...settings,
          alignToGrid: !settings.alignToGrid,
        });
      } else if (action === "show-icons") {
        const settings = getDesktopLayoutSettings();
        const showIcons = settings.showIcons === false;
        saveDesktopLayoutSettings({ ...settings, showIcons });
        document.getElementById("desktop-icons").hidden = !showIcons;
      } else if (action === "refresh") {
        refreshDesktop();
      } else if (
        action === "new-folder" ||
        action === "new-text" ||
        action === "new-bitmap"
      ) {
        const node =
          action === "new-folder"
            ? await fileOps.createFolder(fs.DESKTOP, "New Folder")
            : await fileOps.createFile(
                fs.DESKTOP,
                action === "new-bitmap"
                  ? "New Bitmap Image.bmp"
                  : "New Text Document.txt",
              );
        refreshDesktop();
        selectDesktopIcon(node.id);
        beginDesktopRename(node.id);
      } else if (action === "upload") {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.addEventListener(
          "change",
          async () => {
            try {
              for (const file of input.files) {
                const content = await fileOps.readFileContent(file);
                await fileOps.createFile(fs.DESKTOP, file.name, {
                  content,
                  size: file.size,
                });
              }
            } catch (error) {
              await XPDialogs.alert(
                error.message || "The file operation failed.",
                "File operation",
                "error",
              );
            } finally {
              refreshDesktop();
            }
          },
          { once: true },
        );
        input.click();
      } else if (action === "paste") {
        pasteIntoFolder(fs.DESKTOP);
      } else if (action === "open") {
        openDesktopItem(itemId);
      } else if (action === "explore-my-computer") {
        openDesktopItem("__my-computer");
      } else if (action === "search-my-computer") {
        openSearchDialog();
      } else if (action === "create-computer-shortcut") {
        const shortcut = await fileOps.createFile(
          fs.DESKTOP,
          "Shortcut to My Computer.game",
          { app: "__my-computer" },
        );
        refreshDesktop();
        selectDesktopIcon(shortcut.id);
      } else if (action === "hide-my-computer") {
        saveDesktopSystemIcons({
          ...getDesktopSystemIcons(),
          "__my-computer": false,
        });
        refreshDesktop();
      } else if (action === "rename-my-computer") {
        beginSystemDesktopRename("__my-computer");
      } else if (action === "computer-properties") {
        openShellProperties(fs.MY_COMPUTER);
      } else if (action === "explore") {
        openDesktopItem(itemId);
      } else if (action === "empty-recycle-bin") {
        confirmEmptyRecycleBin();
      } else if (action === "create-recycle-shortcut") {
        const shortcut = await fileOps.createFile(
          fs.DESKTOP,
          "Shortcut to Recycle Bin.game",
          { app: "__recycle-bin" },
        );
        selectDesktopIcon(shortcut.id);
      } else if (action === "recycle-properties") {
        openShellProperties(fs.RECYCLE_BIN);
      } else if (action === "cut") {
        fileOps.cut(selectedFsIds);
      } else if (action === "copy") {
        fileOps.copy(selectedFsIds);
      } else if (action === "delete") {
        confirmRecycleDelete(selectedFsIds);
      } else if (action === "rename") {
        beginDesktopRename(selectedFsIds[0]);
      } else if (action === "item-properties") {
        openShellProperties(selectedFsIds[0]);
      } else {
        // Menus disable Rename and Properties unless exactly one file is
        // selected, and Paste Shortcut is never enabled, so only the
        // desktop's own Properties reaches here.
        openSystemWindow("__display-properties");
      }
      closeDesktopContextMenu();
    } catch (error) {
      await XPDialogs.alert(
        error.message || "The file operation failed.",
        "File operation",
        "error",
      );
    }
  });
  menu.addEventListener("keydown", (event) => {
    const scope = event.target.closest('[role="menu"]');
    const items = [...scope.querySelectorAll("button:not(:disabled)")].filter(
      (item) => item.closest('[role="menu"]') === scope,
    );
    const current = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeDesktopContextMenu();
      (
        document.querySelector(SELECTED_DESKTOP_ICONS) ||
        document.getElementById("desktop-icons")
      ).focus();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const target =
        event.key === "Home"
          ? items[0]
          : event.key === "End"
            ? items.at(-1)
            : items[
                (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  items.length) %
                  items.length
              ];
      target?.focus();
    }
  });
};
