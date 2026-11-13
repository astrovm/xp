"use strict";

// ============================================
// Reusable Windows XP Dialogs
// ============================================
// Modal dialogs with authentic XP chrome, focus trapping, focus restore,
// and Enter/Escape/Tab/access-key navigation. A single primitive
// (createDialog) backs message boxes, progress, properties, and the
// filesystem-backed Open/Save As dialogs, so every shell feature shares
// the same appearance and keyboard behavior. Pure definitions (button
// sets, access keys, byte formatting) are exported for Node tests.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.XPDialogs = api;
})(globalThis, function () {
  // ---- Pure definitions (no DOM, unit tested) ----

  const ICONS = ["info", "warning", "error", "question", "recycle"];

  // Standard XP button sets. The first button is the default unless a
  // later one sets isDefault; isCancel marks the Escape/close result.
  const BUTTON_SETS = {
    ok: [{ id: "ok", label: "OK", isDefault: true, isCancel: true }],
    okCancel: [
      { id: "ok", label: "OK", isDefault: true },
      { id: "cancel", label: "Cancel", isCancel: true },
    ],
    yesNo: [
      { id: "yes", label: "&Yes", isDefault: true },
      { id: "no", label: "&No", isCancel: true },
    ],
    yesNoCancel: [
      { id: "yes", label: "&Yes", isDefault: true },
      { id: "no", label: "&No" },
      { id: "cancel", label: "Cancel", isCancel: true },
    ],
    retryCancel: [
      { id: "retry", label: "&Retry", isDefault: true },
      { id: "cancel", label: "Cancel", isCancel: true },
    ],
  };

  // "&Yes" -> { text: "Yes", key: "y" }. "&&" escapes a literal ampersand.
  const parseAccessKey = (label) => {
    const match = /&([^&])/.exec(label);
    return {
      text: label.replace(/&([^&])/g, "$1").replace(/&&/g, "&"),
      key: match ? match[1].toLowerCase() : null,
    };
  };

  // XP-style byte formatting: "5 bytes", "1.50 KB (1,536 bytes)".
  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes < 0) return "0 bytes";
    if (bytes === 1) return "1 byte";
    if (bytes < 1024) return `${bytes} bytes`;
    const units = ["KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length) {
      value /= 1024;
      unit += 1;
    }
    const grouped = Math.round(bytes).toLocaleString("en-US");
    return `${value.toFixed(2)} ${units[unit - 1]} (${grouped} bytes)`;
  };

  const hasDOM = typeof document !== "undefined";
  const getFS = () => globalThis.VirtualFS;

  if (!hasDOM) {
    // Node: expose only the pure definitions for tests.
    return { ICONS, BUTTON_SETS, parseAccessKey, formatBytes };
  }

  // ---- Dialog stack and shared keyboard handling ----

  const BASE_Z_INDEX = 9000;
  const dialogStack = [];

  const FOCUSABLE = [
    "button",
    "input",
    "select",
    "textarea",
    "a[href]",
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  const focusableItems = (el) =>
    Array.from(el.querySelectorAll(FOCUSABLE)).filter(
      (item) => !item.disabled && item.offsetParent !== null,
    );

  // Registered only while a dialog is open, so the stack is never empty here.
  const handleGlobalKeydown = (e) => dialogStack.at(-1).onKeydown(e);

  // ---- Core primitive ----

  // Builds a modal dialog with XP window chrome. Options:
  //   title    - title bar text
  //   wide     - use the wider dialog variant (file dialogs)
  //   modal    - block other UI and trap focus (default: true)
  //   onCancel - Escape/title-close behavior (default: close with null)
  //   help     - add the title bar ? button for "What's This?" help
  //   systemMenu - false for dialogs without a close button (default: true)
  // Returns { el, body, close, onResult }.
  // XP's "What's This?" help: the title bar ? button arms help mode, and the
  // next click on a control shows its help text. Controls without help get
  // XP's own "No Help topic" message.
  const NO_HELP_TOPIC = "No Help topic is associated with this item.";
  let helpPopup = null;
  const closeHelpPopup = () => {
    helpPopup?.remove();
    helpPopup = null;
  };
  const showHelpPopup = (text, x, y) => {
    closeHelpPopup();
    helpPopup = document.createElement("div");
    helpPopup.className = "xp-help-popup";
    helpPopup.setAttribute("role", "tooltip");
    helpPopup.textContent = text;
    document.body.appendChild(helpPopup);
    const width = window.visualViewport?.width || innerWidth;
    const height = window.visualViewport?.height || innerHeight;
    helpPopup.style.left = `${Math.max(2, Math.min(x, width - helpPopup.offsetWidth - 2))}px`;
    helpPopup.style.top = `${Math.max(2, Math.min(y, height - helpPopup.offsetHeight - 2))}px`;
    const dismiss = () => {
      closeHelpPopup();
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
    };
    setTimeout(() => {
      document.addEventListener("pointerdown", dismiss, true);
      document.addEventListener("keydown", dismiss, true);
    });
  };

  // Adds the title bar ? button. It arms "What's This?" mode: the next click
  // in the area shows that control's data-help text instead of acting.
  const addWhatsThisHelp = (el, area) => {
    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "tb-btn help-btn";
    helpBtn.title = "Help";
    helpBtn.setAttribute("aria-label", "Help");
    helpBtn.addEventListener("click", () => {
      el.classList.add("whats-this");
    });
    el.querySelector(".title-buttons").prepend(helpBtn);
    area.addEventListener(
      "click",
      (event) => {
        if (!el.classList.contains("whats-this")) return;
        event.preventDefault();
        event.stopPropagation();
        el.classList.remove("whats-this");
        const helpText = event.target.closest("[data-help]")?.dataset.help;
        showHelpPopup(helpText || NO_HELP_TOPIC, event.clientX, event.clientY);
      },
      true,
    );
  };

  const createDialog = ({
    title = "",
    wide = false,
    modal = true,
    onCancel = null,
    help = false,
    systemMenu = true,
  } = {}) => {
    const previouslyFocused = document.activeElement;

    const overlay = document.createElement("div");
    overlay.className = "xp-dialog-overlay";
    overlay.classList.toggle("xp-dialog-modeless", !modal);

    const el = document.createElement("div");
    el.className = `xp-window active xp-dialog${wide ? " xp-dialog-wide" : ""}`;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", String(modal));
    el.setAttribute("aria-label", title);

    const titleBar = document.createElement("div");
    titleBar.className = "title-bar";
    const titleText = document.createElement("span");
    titleText.className = "title-text";
    titleText.textContent = title;
    const titleButtons = document.createElement("div");
    titleButtons.className = "title-buttons";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tb-btn close-btn";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => dialog.cancel());
    if (systemMenu) titleButtons.appendChild(closeBtn);
    titleBar.append(titleText, titleButtons);

    const body = document.createElement("div");
    body.className = "dlg-body";

    el.append(titleBar, body);
    overlay.appendChild(el);
    if (help) addWhatsThisHelp(el, body);

    let resultCallback = null;

    const dialog = {
      el,
      body,
      defaultButton: null,
      accessKeys: new Map(),
      onResult(callback) {
        resultCallback = callback;
      },
      close(result = null) {
        if (!dialogStack.includes(dialog)) return;
        dialogStack.splice(dialogStack.indexOf(dialog), 1);
        dialogStack.at(-1)?.el.classList.add("active");
        overlay.remove();
        if (!dialogStack.length) {
          document.removeEventListener("keydown", handleGlobalKeydown, true);
        }
        if (previouslyFocused && previouslyFocused.isConnected) {
          previouslyFocused.focus();
        }
        if (resultCallback) resultCallback(result);
      },
      cancel: onCancel || (() => dialog.close(null)),
      onKeydown(e) {
        if (
          !modal &&
          (!el.contains(e.target) ||
            (e.ctrlKey && e.key === "Escape") ||
            e.key === "Meta")
        )
          return;
        if (e.key === "Tab") {
          if (modal) trapFocus(e);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          // Escape leaves "What's This?" mode before it closes the dialog.
          if (el.classList.contains("whats-this"))
            el.classList.remove("whats-this");
          else dialog.cancel();
          return;
        }
        if (e.key === "Enter") {
          // Click the focused button, or the default button when
          // focus is elsewhere. preventDefault suppresses the
          // browser's own button activation to avoid double-fire.
          const active = document.activeElement;
          if (active && el.contains(active) && active.tagName === "BUTTON") {
            e.preventDefault();
            active.click();
          } else if (active?.tagName !== "TEXTAREA" && dialog.defaultButton) {
            e.preventDefault();
            dialog.defaultButton.click();
          }
          return;
        }
        handleAccessKey(e);
      },
    };

    const trapFocus = (e) => {
      const items = focusableItems(el);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !el.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !el.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    // Alt+key always works; the bare key works outside text fields.
    const handleAccessKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.key.length !== 1) return;
      const inTextField = /^(INPUT|TEXTAREA|SELECT)$/.test(
        document.activeElement?.tagName,
      );
      if (!e.altKey && inTextField) return;
      const button = dialog.accessKeys.get(e.key.toLowerCase());
      if (button && !button.disabled) {
        e.preventDefault();
        button.click();
      }
    };

    if (!dialogStack.length) {
      document.addEventListener("keydown", handleGlobalKeydown, true);
    }
    // Only the newest dialog is active; the ones behind it draw inactive.
    dialogStack.at(-1)?.el.classList.remove("active");
    dialogStack.push(dialog);
    overlay.style.zIndex = (modal ? BASE_Z_INDEX : 6900) + dialogStack.length;
    document.body.appendChild(overlay);

    // Dialogs start centered, then switch to explicit viewport-relative
    // coordinates when dragged by their title bar.
    titleBar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".title-buttons")) return;

      const overlayRect = overlay.getBoundingClientRect();
      const dialogRect = el.getBoundingClientRect();
      const offsetX = event.clientX - dialogRect.left;
      const offsetY = event.clientY - dialogRect.top;

      el.style.position = "absolute";
      el.style.left = `${dialogRect.left - overlayRect.left}px`;
      el.style.top = `${dialogRect.top - overlayRect.top}px`;
      try {
        titleBar.setPointerCapture(event.pointerId);
      } catch (error) {
        /* pointer capture unsupported */
      }
      event.preventDefault();

      const move = (moveEvent) => {
        const maxLeft = Math.max(0, overlay.clientWidth - el.offsetWidth);
        const maxTop = Math.max(0, overlay.clientHeight - el.offsetHeight);
        const left = Math.min(
          Math.max(moveEvent.clientX - overlayRect.left - offsetX, 0),
          maxLeft,
        );
        const top = Math.min(
          Math.max(moveEvent.clientY - overlayRect.top - offsetY, 0),
          maxTop,
        );
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      };

      const stop = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        document.removeEventListener("pointercancel", stop);
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
      document.addEventListener("pointercancel", stop);
    });
    return dialog;
  };

  // ---- Shared building blocks ----

  const createDialogButton = ({ id, label, isDefault }, onChoose) => {
    const { text, key } = parseAccessKey(label);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `xp-btn${isDefault ? " default" : ""}`;
    button.dataset.action = id;
    const amp = label.indexOf("&");
    if (key && amp !== -1) {
      button.append(label.slice(0, amp));
      const underlined = document.createElement("span");
      underlined.className = "menu-accesskey";
      underlined.textContent = label[amp + 1];
      button.append(underlined, label.slice(amp + 2));
    } else {
      button.textContent = text;
    }
    button.addEventListener("click", () => onChoose(id));
    return button;
  };

  // Register a button's access key (&X) so Alt+X / bare X activates it.
  const registerAccessKey = (dialog, button, label) => {
    const { key } = parseAccessKey(label);
    if (key && !dialog.accessKeys.has(key)) {
      dialog.accessKeys.set(key, button);
    }
  };

  const addButtonRow = (dialog, buttons) => {
    const row = document.createElement("div");
    row.className = "dlg-buttons";
    buttons.forEach((definition) => {
      const button = createDialogButton(definition, (id) => dialog.close(id));
      if (definition.isDefault) dialog.defaultButton = button;
      registerAccessKey(dialog, button, definition.label);
      row.appendChild(button);
    });
    dialog.body.appendChild(row);
    (dialog.defaultButton || row.querySelector("button"))?.focus();
  };

  // ---- Message boxes ----

  // XPDialogs.message({
  //   title, text, icon: info|warning|error|question,
  //   buttons: BUTTON_SETS.*, defaultButton: optional id override
  // }) -> Promise resolving with the chosen button id.
  const message = ({
    title = "Message",
    text = "",
    icon = "info",
    buttons = BUTTON_SETS.ok,
    defaultButton = null,
  } = {}) =>
    new Promise((resolve) => {
      const resolvedButtons = buttons.map((definition) => ({
        ...definition,
        isDefault: defaultButton
          ? definition.id === defaultButton
          : definition.isDefault,
      }));
      const dialog = createDialog({
        title,
        onCancel: () => {
          const cancel =
            resolvedButtons.find((b) => b.isCancel) ||
            resolvedButtons.find((b) => b.isDefault);
          dialog.close(cancel ? cancel.id : null);
        },
      });
      dialog.onResult(resolve);
      dialog.el.classList.add("xp-message-box");

      const row = document.createElement("div");
      row.className = "dlg-message";
      if (ICONS.includes(icon)) {
        const iconEl = document.createElement("span");
        iconEl.className = `dlg-icon dlg-icon-${icon}`;
        iconEl.setAttribute("aria-hidden", "true");
        row.appendChild(iconEl);
      }
      const textEl = document.createElement("p");
      textEl.className = "dlg-text";
      textEl.textContent = text;
      row.appendChild(textEl);
      dialog.body.appendChild(row);

      addButtonRow(dialog, resolvedButtons);
    });

  const alert = (text, title = "Message", icon = "info") =>
    message({ title, text, icon, buttons: BUTTON_SETS.ok });

  const confirm = (text, title = "Confirm", icon = "question") =>
    message({ title, text, icon, buttons: BUTTON_SETS.yesNo }).then(
      (result) => result === "yes",
    );

  // ---- Progress dialog ----

  // XPDialogs.progress({ title, text, cancellable, onCancel }) ->
  //   { update(fraction, detail?), close() }
  const progress = ({
    title = "Progress",
    text = "",
    cancellable = false,
    onCancel = null,
  } = {}) => {
    const dialog = createDialog({
      title,
      onCancel: () => {
        if (cancellable && onCancel) onCancel();
      },
    });

    const label = document.createElement("p");
    label.className = "dlg-text dlg-progress-text";
    label.textContent = text;

    const bar = document.createElement("div");
    bar.className = "xp-progress";
    bar.setAttribute("role", "progressbar");
    const fill = document.createElement("div");
    fill.className = "xp-progress-fill";
    bar.appendChild(fill);

    dialog.body.append(label, bar);

    if (cancellable) {
      const cancelBtn = createDialogButton(
        { id: "cancel", label: "Cancel" },
        () => {
          cancelBtn.disabled = true;
          if (onCancel) onCancel();
        },
      );
      const row = document.createElement("div");
      row.className = "dlg-buttons";
      row.appendChild(cancelBtn);
      dialog.body.appendChild(row);
    }

    return {
      el: dialog.el,
      update(fraction, detail) {
        const percent = Math.min(Math.max(fraction, 0), 1) * 100;
        fill.style.width = `${percent}%`;
        bar.setAttribute("aria-valuenow", String(Math.round(percent)));
        if (detail !== undefined) label.textContent = detail;
      },
      close: () => dialog.close(),
    };
  };

  // ---- Icon helpers shared by Properties and the file dialogs ----

  const fs = () => getFS();

  // The shell registers Explorer's icon factory so dialogs show the same
  // icons as Explorer.
  let nodeIconFactory = null;
  const setNodeIconFactory = (factory) => {
    nodeIconFactory = factory;
  };

  const createNodeIcon = (node) => {
    const icon = document.createElement("span");
    icon.className = "dlg-node-icon";
    if (node.id === fs().RECYCLE_BIN) {
      const image = document.createElement("img");
      image.src = fs().getChildren(fs().RECYCLE_BIN).length
        ? "assets/xp/icons/RecyclerFull.png"
        : "assets/xp/icons/RecyclerEmpty.png";
      image.alt = "";
      icon.appendChild(image);
      return icon;
    }
    icon.append(...nodeIconFactory(node).childNodes);
    return icon;
  };

  const describeNodeType = (node) => {
    if (node.id === fs().DRIVE_C) return "Local Disk";
    if (node.id === fs().DRIVE_D) return "Local Disk";
    if (node.id === fs().DRIVE_F) return "Removable Disk";
    if (node.type === "folder") return "File folder";
    if (!node.ext) return "File";
    return `${node.ext.replace(".", "").toUpperCase()} File`;
  };

  // ---- Properties dialog ----

  // XPDialogs.properties(nodeId) -> Promise resolving when closed.
  const properties = (nodeId) =>
    new Promise((resolve) => {
      const node = fs()?.getNode(nodeId);
      if (!node) {
        resolve(null);
        return;
      }

      const dialog = createDialog({
        title: `${node.name} Properties`,
        onCancel: () => dialog.close("ok"),
      });
      dialog.onResult(resolve);

      const header = document.createElement("div");
      header.className = "dlg-props-header";
      const name = document.createElement("span");
      name.className = "dlg-props-name";
      name.textContent = node.name;
      header.append(createNodeIcon(node), name);

      const table = document.createElement("dl");
      table.className = "dlg-props-table";
      const addRow = (label, value) => {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        table.append(dt, dd);
      };

      addRow("Type:", describeNodeType(node));
      if (node.parent) {
        const parent = fs().getNode(node.parent);
        addRow("Location:", parent ? fs().getPath(parent.id) : "");
      }
      addRow("Size:", formatBytes(fs().getSize(node.id)));
      if (node.type === "folder") {
        let files = 0;
        let folders = 0;
        const pending = [node.id];
        while (pending.length) {
          fs()
            .getChildren(pending.pop())
            .forEach((child) => {
              if (child.type === "folder") {
                folders += 1;
                pending.push(child.id);
              } else {
                files += 1;
              }
            });
        }
        addRow("Contains:", `${files} files, ${folders} folders`);
      }
      const formatDate = (ts) => new Date(ts).toLocaleString();
      addRow("Created:", formatDate(node.created));
      addRow("Modified:", formatDate(node.modified));

      dialog.body.append(header, table);
      addButtonRow(dialog, BUTTON_SETS.ok);
    });

  // ---- Open / Save As dialogs ----

  const findChildByName = (folderId, name) => {
    const wanted = String(name).trim().toLowerCase();
    if (!wanted) return null;
    return (
      fs()
        .getChildren(folderId)
        .find((child) => child.name.toLowerCase() === wanted) || null
    );
  };

  // Shared folder browser laid out like XP's Open and Save As dialogs: a
  // Places bar, a "Look in"/"Save in" folder list with Back, Up, and New
  // Folder, a column-flowing file list, and the file name and type fields.
  // filterLabel names the filter in the type list, like XP's "Background
  // Files". onDialog(dialog, { nameInput }) receives the dialog and its
  // File name box before the file list renders. It must not call dialog.onResult,
  // which would replace the callback that settles this promise.
  // onAccept({ folderId, name }) validates the current entry and returns
  // false (or Promise<false>) to keep the dialog open, or any other value
  // (or Promise of one) to close the dialog and resolve with that value.
  // Cancel resolves with null.
  const describeFilter = (filter) =>
    filter?.length
      ? `${filter.map((ext) => ext.replace(".", "").toUpperCase()).join(", ")} Files (${filter.map((ext) => `*${ext}`).join(";")})`
      : "All Files (*.*)";

  const browseFiles = ({
    title,
    startFolder,
    filter,
    filterLabel = null,
    initialName = "",
    acceptLabel,
    folderLabel,
    onAccept,
    onDialog = null,
  }) =>
    new Promise((resolve) => {
      let currentFolderId = startFolder || fs().MY_DOCUMENTS;
      if (!fs().getNode(currentFolderId)) currentFolderId = fs().MY_DOCUMENTS;
      const history = [];
      let activeFilter = filter;

      const dialog = createDialog({
        title,
        help: true,
        onCancel: () => dialog.close(null),
      });
      dialog.el.classList.add("xp-file-dialog");
      dialog.onResult(resolve);

      const field = (className, labelText, control) => {
        const label = document.createElement("label");
        label.className = className;
        const text = document.createElement("span");
        text.textContent = parseAccessKey(labelText).text;
        label.append(text, control);
        return label;
      };

      // "Save in" / "Look in" lists the current folder's ancestors and the
      // usual top-level places.
      const folderSelect = document.createElement("select");
      folderSelect.className = "dlg-file-folder";
      folderSelect.addEventListener("change", () =>
        navigate(folderSelect.value),
      );

      const toolButton = (action, label, icon, onClick) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dlg-file-tool";
        button.dataset.action = action;
        button.title = label;
        button.setAttribute("aria-label", label);
        const image = document.createElement("img");
        image.src = icon;
        image.alt = "";
        button.appendChild(image);
        button.addEventListener("click", onClick);
        return button;
      };
      const backBtn = toolButton(
        "back",
        "Back",
        "assets/xp/icons/Back.png",
        () => {
          currentFolderId = history.pop();
          renderList();
        },
      );
      const upBtn = toolButton(
        "up",
        "Up One Level",
        "assets/xp/icons/Up.png",
        () => navigate(fs().getNode(currentFolderId).parent),
      );
      const newFolderBtn = toolButton(
        "new-folder",
        "Create New Folder",
        "assets/xp/icons/NewFolder.png",
        () => {
          try {
            const folder = fs().createFolder(currentFolderId, "New Folder");
            renderList();
            nameInput.value = folder.name;
          } catch (error) {
            message({
              title,
              text: error.message,
              icon: "error",
              buttons: BUTTON_SETS.ok,
            });
          }
        },
      );
      const toolbar = document.createElement("div");
      toolbar.className = "dlg-file-toolbar";
      toolbar.append(
        field("dlg-file-folder-field", folderLabel, folderSelect),
        backBtn,
        upBtn,
        newFolderBtn,
      );

      const places = document.createElement("div");
      places.className = "dlg-file-places";
      [
        ["Desktop", "assets/xp/icons/Desktop.png", fs().DESKTOP],
        ["My Documents", "assets/xp/icons/MyDocuments.png", fs().MY_DOCUMENTS],
        ["My Computer", "assets/xp/icons/MyComputer.png", fs().MY_COMPUTER],
      ].forEach(([label, icon, folderId]) => {
        const place = document.createElement("button");
        place.type = "button";
        place.className = "dlg-file-place";
        place.dataset.folderId = folderId;
        const image = document.createElement("img");
        image.src = icon;
        image.alt = "";
        const text = document.createElement("span");
        text.textContent = label;
        place.append(image, text);
        place.addEventListener("click", () => navigate(folderId));
        places.appendChild(place);
      });

      const list = document.createElement("div");
      list.className = "dlg-file-list";
      list.setAttribute("role", "listbox");

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "xp-input";
      nameInput.value = initialName;
      nameInput.id = "dlg-file-name";
      const typeSelect = document.createElement("select");
      typeSelect.className = "dlg-file-type";
      [filter, null]
        .filter((entry, index) => index === 0 || filter?.length)
        .forEach((entry) => {
          const option = document.createElement("option");
          option.textContent =
            entry && filterLabel ? filterLabel : describeFilter(entry);
          option.value = entry ? entry.join(",") : "";
          typeSelect.appendChild(option);
        });
      typeSelect.addEventListener("change", () => {
        activeFilter = typeSelect.value ? typeSelect.value.split(",") : null;
        renderList();
      });

      const fields = document.createElement("div");
      fields.className = "dlg-file-fields";
      fields.append(
        field("dlg-file-name-row", "File &name:", nameInput),
        field(
          "dlg-file-type-row",
          acceptLabel === "&Save" ? "Save as &type:" : "Files of &type:",
          typeSelect,
        ),
      );

      dialog.body.append(toolbar, places, list, fields);
      onDialog?.(dialog, { nameInput });

      const matchesFilter = (node) =>
        node.type === "folder" ||
        !activeFilter ||
        activeFilter.includes(node.ext);

      const navigate = (folderId) => {
        if (!folderId || folderId === currentFolderId) return;
        history.push(currentFolderId);
        currentFolderId = folderId;
        renderList();
      };

      const accept = () => {
        const context = {
          folderId: currentFolderId,
          name: nameInput.value.trim(),
        };
        Promise.resolve(onAccept(context)).then((result) => {
          if (result !== false) dialog.close(result);
        });
      };

      const renderFolders = () => {
        const chain = [];
        for (
          let node = fs().getNode(currentFolderId);
          node;
          node = node.parent ? fs().getNode(node.parent) : null
        )
          chain.unshift(node);
        const roots = [fs().DESKTOP, fs().MY_DOCUMENTS, fs().MY_COMPUTER];
        folderSelect.replaceChildren();
        [
          ...new Map(
            [...roots.map((id) => fs().getNode(id)), ...chain].map((node) => [
              node.id,
              node,
            ]),
          ).values(),
        ].forEach((node) => {
          const option = document.createElement("option");
          option.value = node.id;
          option.textContent = node.name;
          folderSelect.appendChild(option);
        });
        folderSelect.value = currentFolderId;
        places.querySelectorAll(".dlg-file-place").forEach((place) => {
          place.classList.toggle(
            "selected",
            place.dataset.folderId === currentFolderId,
          );
        });
      };

      const renderList = () => {
        const folder = fs().getNode(currentFolderId);
        renderFolders();
        upBtn.disabled = !folder.parent;
        backBtn.disabled = !history.length;
        list.innerHTML = "";
        fs()
          .getChildren(folder.id)
          .filter(matchesFilter)
          .sort((a, b) =>
            a.type === b.type
              ? a.name.localeCompare(b.name)
              : a.type === "folder"
                ? -1
                : 1,
          )
          .forEach((child) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "dlg-file-item";
            item.setAttribute("role", "option");
            const label = document.createElement("span");
            label.textContent = child.name;
            item.append(createNodeIcon(child), label);
            item.addEventListener("click", () => {
              list.querySelectorAll(".selected").forEach((el) => {
                el.classList.remove("selected");
              });
              item.classList.add("selected");
              if (child.type === "file") nameInput.value = child.name;
            });
            item.addEventListener("dblclick", () => {
              if (child.type === "folder") {
                navigate(child.id);
              } else {
                nameInput.value = child.name;
                accept();
              }
            });
            list.appendChild(item);
          });
      };

      // Accept and Cancel sit beside the file name and type fields.
      const row = document.createElement("div");
      row.className = "dlg-buttons dlg-file-buttons";
      const acceptBtn = createDialogButton(
        { id: "accept", label: acceptLabel, isDefault: true },
        accept,
      );
      const cancelBtn = createDialogButton(
        { id: "cancel", label: "Cancel" },
        () => dialog.close(null),
      );
      row.append(acceptBtn, cancelBtn);
      dialog.body.appendChild(row);
      dialog.defaultButton = acceptBtn;
      registerAccessKey(dialog, acceptBtn, acceptLabel);

      renderList();
      nameInput.focus();
      nameInput.select();
    });

  // XPDialogs.openFile({ title, startFolder, filter }) ->
  //   Promise resolving with the chosen node, or null on cancel.
  const openFile = ({
    title = "Open",
    startFolder = null,
    filter = null,
  } = {}) =>
    browseFiles({
      title,
      startFolder,
      filter,
      acceptLabel: "&Open",
      folderLabel: "Look &in:",
      onAccept: ({ folderId, name }) => {
        const node = findChildByName(folderId, name);
        if (node && node.type === "file") return node;
        message({
          title,
          text: `Cannot find the "${name}" file.\nCheck the file name and try again.`,
          icon: "error",
          buttons: BUTTON_SETS.ok,
        });
        return false;
      },
    });

  // XPDialogs.saveFile({ title, startFolder, defaultName, filter }) ->
  //   Promise resolving with { parentId, name, existingId }, or null.
  const saveFile = ({
    title = "Save As",
    startFolder = null,
    defaultName = "",
    filter = null,
  } = {}) =>
    browseFiles({
      title,
      startFolder,
      filter,
      initialName: defaultName,
      acceptLabel: "&Save",
      folderLabel: "Save &in:",
      onAccept: ({ folderId, name }) => {
        if (!name) return false;
        const existing = findChildByName(folderId, name);
        const result = {
          parentId: folderId,
          name,
          existingId: existing ? existing.id : null,
        };
        if (!existing) return result;
        return message({
          title: "Confirm Save As",
          text: `${name} already exists.\nDo you want to replace it?`,
          icon: "warning",
          buttons: BUTTON_SETS.yesNo,
          defaultButton: "no",
        }).then((answer) => (answer === "yes" ? result : false));
      },
    });

  return {
    ICONS,
    BUTTON_SETS,
    parseAccessKey,
    formatBytes,
    createDialog,
    addWhatsThisHelp,
    createDialogButton,
    addButtonRow,
    message,
    alert,
    confirm,
    progress,
    properties,
    setNodeIconFactory,
    browseFiles,
    openFile,
    saveFile,
  };
});
