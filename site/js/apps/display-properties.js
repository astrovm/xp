"use strict";

const openDesktopItemsDialog = (ownerWindow) => {
  const current = getDesktopSystemIcons();
  const dialog = XPDialogs.createDialog({
    title: "Desktop Items",
    onCancel: () => dialog.close("cancel"),
    help: true,
  });
  dialog.el.classList.add("desktop-items-dialog", "display-owned-dialog");
  setDisplayDialogOwnerActive(ownerWindow, false);

  const tabs = document.createElement("div");
  tabs.className = "desktop-items-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.innerHTML = `
    <button type="button" role="tab" aria-selected="true" data-desktop-items-tab="general">General</button>
    <button type="button" role="tab" aria-selected="false" tabindex="-1" data-desktop-items-tab="web">Web</button>
  `;
  const panels = document.createElement("div");
  panels.className = "desktop-items-panels";
  panels.innerHTML = `
    <section role="tabpanel" data-desktop-items-panel="general">
      <fieldset class="desktop-icons-group"><legend>Desktop icons</legend>
        <label><input type="checkbox" data-system-icon="__my-documents"> My Documents</label>
        <label><input type="checkbox" data-system-icon="__my-computer"> My Computer</label>
        <label><input type="checkbox" disabled> My Network Places</label>
      </fieldset>
      <div class="desktop-icon-choices" role="listbox" aria-label="Desktop icons">
        <button type="button" class="selected"><img src="assets/xp/icons/MyComputer.png" alt=""><span>My Computer</span></button>
        <button type="button"><img src="assets/xp/icons/MyDocuments.png" alt=""><span>My Documents</span></button>
        <button type="button"><img src="assets/xp/icons/MyNetworkPlaces.png" alt=""><span>My Network<br>Places</span></button>
        <button type="button"><img src="assets/xp/icons/RecyclerFull.png" alt=""><span>Recycle Bin<br>(full)</span></button>
        <button type="button"><img src="assets/xp/icons/RecyclerEmpty.png" alt=""><span>Recycle Bin<br>(empty)</span></button>
      </div>
      <div class="desktop-icon-actions"><button type="button" class="xp-btn">Change Icon...</button><button type="button" class="xp-btn">Restore Default</button></div>
      <fieldset class="desktop-cleanup-group"><legend>Desktop cleanup</legend>
        <p>Desktop Cleanup moves unused desktop items to a folder.</p>
        <label><input type="checkbox"> Run Desktop Cleanup Wizard every 60 days</label>
        <button type="button" class="xp-btn">Clean Desktop Now</button>
      </fieldset>
    </section>
    <section role="tabpanel" data-desktop-items-panel="web" hidden>
      <p>Web pages can be shown directly on your desktop.</p>
      <div class="desktop-web-empty">No Web pages are currently displayed.</div>
    </section>
  `;

  panels.querySelectorAll("[data-system-icon]").forEach((checkbox) => {
    checkbox.checked = current[checkbox.dataset.systemIcon] !== false;
  });
  tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-desktop-items-tab]");
    if (!tab) return;
    tabs.querySelectorAll('[role="tab"]').forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    panels.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
      panel.hidden =
        panel.dataset.desktopItemsPanel !== tab.dataset.desktopItemsTab;
    });
    tab.focus();
  });
  panels
    .querySelector(".desktop-icon-choices")
    .addEventListener("click", (event) => {
      const item = event.target.closest("button");
      if (!item) return;
      panels
        .querySelectorAll(".desktop-icon-choices button")
        .forEach((button) =>
          button.classList.toggle("selected", button === item),
        );
    });

  const buttons = document.createElement("div");
  buttons.className = "dlg-buttons";
  const ok = XPDialogs.createDialogButton(
    { id: "ok", label: "OK", isDefault: true },
    () => {
      const next = { ...current };
      panels.querySelectorAll("[data-system-icon]").forEach((checkbox) => {
        next[checkbox.dataset.systemIcon] = checkbox.checked;
      });
      saveDesktopSystemIcons(next);
      buildDesktopIcons();
      dialog.close("ok");
    },
  );
  const cancel = XPDialogs.createDialogButton(
    { id: "cancel", label: "Cancel", isCancel: true },
    () => dialog.close("cancel"),
  );
  buttons.append(ok, cancel);
  dialog.body.append(tabs, panels, buttons);
  dialog.defaultButton = ok;
  dialog.onResult(() => setDisplayDialogOwnerActive(ownerWindow, true));
  panels.querySelector("[data-system-icon]").focus();
};

// A Display Properties dialog that is still open (Browse under an error
// box, for example) keeps the owner inactive. The last one to close
// activates it. Other apps' dialogs do not count.
const setDisplayDialogOwnerActive = (ownerWindow, active) => {
  if (active && document.querySelector(".display-owned-dialog")) return;
  ownerWindow.el.classList.toggle("active", active);
  if (active) focusWindow(ownerWindow.gameId);
};

const openDisplayNotice = (ownerWindow, title, message, icon = "info") => {
  setDisplayDialogOwnerActive(ownerWindow, false);
  XPDialogs.alert(message, title, icon).finally(() =>
    setDisplayDialogOwnerActive(ownerWindow, true),
  );
};

const openDisplayEffectsDialog = (ownerWindow, settings, onCommit) => {
  const draft = { ...settings };
  const dialog = XPDialogs.createDialog({
    title: "Effects",
    onCancel: () => dialog.close("cancel"),
    help: true,
  });
  dialog.el.classList.add("display-effects-dialog", "display-owned-dialog");
  setDisplayDialogOwnerActive(ownerWindow, false);
  dialog.body.innerHTML = `
    <div class="effects-option"><label><input type="checkbox" data-effect-enabled="transition"> Use the following transition effect for menus and tooltips:</label><select class="xp-select" data-effect="transitionEffect"><option value="fade">Fade effect</option><option value="scroll">Scroll effect</option></select></div>
    <div class="effects-option"><label><input type="checkbox" data-effect-enabled="smoothing"> Use the following method to smooth edges of screen fonts:</label><select class="xp-select" data-effect="fontSmoothing"><option value="standard">Standard</option><option value="cleartype">ClearType</option></select></div>
    <label class="effects-check"><input type="checkbox" data-effect="largeIcons"> Use large icons</label>
    <label class="effects-check"><input type="checkbox" data-effect="menuShadows"> Show shadows under menus</label>
    <label class="effects-check"><input type="checkbox" data-effect="showWindowContents"> Show window contents while dragging</label>
    <label class="effects-check"><input type="checkbox" data-effect="hideKeyboardCues"> Hide underlined letters for keyboard navigation until I press the Alt key</label>
  `;
  const transitionEnabled = dialog.body.querySelector(
    '[data-effect-enabled="transition"]',
  );
  const smoothingEnabled = dialog.body.querySelector(
    '[data-effect-enabled="smoothing"]',
  );
  const transition = dialog.body.querySelector(
    '[data-effect="transitionEffect"]',
  );
  const smoothing = dialog.body.querySelector('[data-effect="fontSmoothing"]');
  transitionEnabled.checked = draft.transitionEffect !== "none";
  smoothingEnabled.checked = draft.fontSmoothing !== "none";
  transition.value = draft.transitionEffect === "scroll" ? "scroll" : "fade";
  smoothing.value =
    draft.fontSmoothing === "cleartype" ? "cleartype" : "standard";
  [
    "largeIcons",
    "menuShadows",
    "showWindowContents",
    "hideKeyboardCues",
  ].forEach((key) => {
    dialog.body.querySelector(`[data-effect="${key}"]`).checked = !!draft[key];
  });
  const syncEnabled = () => {
    transition.disabled = !transitionEnabled.checked;
    smoothing.disabled = !smoothingEnabled.checked;
  };
  transitionEnabled.addEventListener("change", syncEnabled);
  smoothingEnabled.addEventListener("change", syncEnabled);
  syncEnabled();

  const buttons = document.createElement("div");
  buttons.className = "dlg-buttons";
  const ok = XPDialogs.createDialogButton(
    { id: "ok", label: "OK", isDefault: true },
    () => {
      draft.transitionEffect = transitionEnabled.checked
        ? transition.value
        : "none";
      draft.fontSmoothing = smoothingEnabled.checked ? smoothing.value : "none";
      [
        "largeIcons",
        "menuShadows",
        "showWindowContents",
        "hideKeyboardCues",
      ].forEach((key) => {
        draft[key] = dialog.body.querySelector(
          `[data-effect="${key}"]`,
        ).checked;
      });
      onCommit(draft);
      dialog.close("ok");
    },
  );
  const cancel = XPDialogs.createDialogButton(
    { id: "cancel", label: "Cancel", isCancel: true },
    () => dialog.close("cancel"),
  );
  buttons.append(ok, cancel);
  dialog.body.append(buttons);
  dialog.defaultButton = ok;
  dialog.onResult(() => setDisplayDialogOwnerActive(ownerWindow, true));
  transitionEnabled.focus();
};

const openAdvancedAppearanceDialog = (ownerWindow, settings, onCommit) => {
  const dialog = XPDialogs.createDialog({
    title: "Advanced Appearance",
    onCancel: () => dialog.close("cancel"),
    help: true,
  });
  dialog.el.classList.add("advanced-appearance-dialog", "display-owned-dialog");
  setDisplayDialogOwnerActive(ownerWindow, false);
  dialog.body.innerHTML = `
    <div class="advanced-appearance-preview">
      <div class="advanced-inactive">Inactive Window <b>_</b><b>□</b><b>×</b></div>
      <div class="advanced-active">Active Window <b>_</b><b>□</b><b>×</b></div>
      <div class="advanced-menu">Normal &nbsp;&nbsp; <span>Disabled</span> &nbsp;&nbsp; Selected</div>
      <div class="advanced-window-text">Window Text</div>
      <div class="advanced-message"><strong>Message Box</strong><b>×</b><span>Message Text</span><button type="button" tabindex="-1">OK</button></div>
    </div>
    <p class="advanced-appearance-copy">If you select a windows and buttons setting other than Windows Classic,<br>it will override the following settings, except in some older programs.</p>
    <div class="advanced-controls">
      <label>Item:<select class="xp-select" disabled><option>Desktop</option></select></label>
      <label class="advanced-size">Size:<input class="xp-input" disabled></label>
      <label>Color 1:<input type="color" data-advanced-color></label>
      <label class="advanced-disabled">Color 2:<input disabled></label>
      <label class="advanced-disabled">Font:<select class="xp-select" disabled></select></label>
      <label class="advanced-disabled">Size:<input class="xp-input" disabled></label>
      <label class="advanced-disabled">Color:<input disabled></label>
    </div>
  `;
  dialog.body.querySelector(".advanced-appearance-preview").dataset.appearance =
    settings.appearance;
  dialog.body.querySelector("[data-advanced-color]").value =
    settings.backgroundColor;
  const buttons = document.createElement("div");
  buttons.className = "dlg-buttons";
  const ok = XPDialogs.createDialogButton(
    { id: "ok", label: "OK", isDefault: true },
    () => {
      onCommit({
        ...settings,
        backgroundColor: dialog.body.querySelector("[data-advanced-color]")
          .value,
      });
      dialog.close("ok");
    },
  );
  const cancel = XPDialogs.createDialogButton(
    { id: "cancel", label: "Cancel", isCancel: true },
    () => dialog.close("cancel"),
  );
  buttons.append(ok, cancel);
  dialog.body.append(buttons);
  dialog.defaultButton = ok;
  dialog.onResult(() => setDisplayDialogOwnerActive(ownerWindow, true));
  dialog.body.querySelector("[data-advanced-color]").focus();
};

// XP's wallpaper Browse is the standard Open dialog in My Pictures. The
// virtual disk keeps no picture data, so Open always hands off to the
// browser's file picker, whatever the list or File name shows. The chosen
// picture fills File name and closes the dialog.
const WALLPAPER_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const WALLPAPER_EXTENSIONS = Object.keys(WALLPAPER_TYPES);
const WALLPAPER_MIME_TYPES = [...new Set(Object.values(WALLPAPER_TYPES))];
const openWallpaperBrowseDialog = (ownerWindow, fileInput) => {
  let dialog = null;
  let nameInput = null;
  setDisplayDialogOwnerActive(ownerWindow, false);
  XPDialogs.browseFiles({
    title: "Browse",
    startFolder: window.VirtualFS.MY_PICTURES,
    filter: WALLPAPER_EXTENSIONS,
    filterLabel: `Background Files (${WALLPAPER_EXTENSIONS.map((ext) => `*${ext}`).join(";")})`,
    acceptLabel: "&Open",
    folderLabel: "Look &in:",
    onDialog: (created, controls) => {
      dialog = created;
      nameInput = controls.nameInput;
      // Test and style hook for this use of the shared dialog.
      dialog.el.classList.add(
        "wallpaper-browse-dialog",
        "display-owned-dialog",
      );
    },
    onAccept: () => {
      // Clear the last pick so choosing the same picture again still
      // fires a change event.
      fileInput.value = "";
      fileInput.click();
      return false;
    },
  }).then(() => setDisplayDialogOwnerActive(ownerWindow, true));
  return {
    setChosenFile: (name) => {
      if (!dialog.el.isConnected) return;
      nameInput.value = name;
      dialog.close("open");
    },
  };
};

const wireDisplayProperties = (win) => {
  const content = win.el.querySelector(".display-properties-content");

  let current = getDisplaySettings();
  let pending = { ...current };
  let resolutionPreviewActive = false;
  let resolutionPreviewSnapshot = null;
  const tabs = [...content.querySelectorAll('[role="tab"]')];
  const panels = [...content.querySelectorAll('[role="tabpanel"]')];
  const controls = {
    theme: content.querySelector("#display-theme"),
    wallpaper: content.querySelector("#display-wallpaper"),
    position: content.querySelector("#display-position"),
    color: content.querySelector("#display-color"),
    image: content.querySelector("#display-image"),
    customWallpaper: content.querySelector(".display-custom-wallpaper"),
    saver: content.querySelector("#display-saver"),
    saverSettings: content.querySelector(".display-saver-settings"),
    saverPreviewButton: content.querySelector(".display-saver-preview-button"),
    saverWait: content.querySelector("#display-saver-wait"),
    saverLogin: content.querySelector(".display-saver-login"),
    appearance: content.querySelector("#display-appearance"),
    windowStyle: content.querySelector("#display-window-style"),
    fontSize: content.querySelector("#display-font-size"),
    resolution: content.querySelector("#display-resolution"),
    resolutionSlider: content.querySelector("#display-resolution-slider"),
    preview: content.querySelector(".display-preview-surface"),
    saverPreview: content.querySelector(".screen-saver-preview"),
    appearancePreview: content.querySelector(".appearance-preview"),
    themeSample: content.querySelector(".display-theme-sample"),
    resolutionValue: content.querySelector(".display-resolution-value"),
    colorQuality: content.querySelector("#display-color-quality"),
    customize: content.querySelector(".display-customize"),
    browse: content.querySelector(".display-browse"),
    apply: content.querySelector('[data-display-action="apply"]'),
  };
  // The browser reports its real color depth; XP names 24-bit "High" and
  // 32-bit "Highest".
  // The browser picker offers the same picture types that Browse lists.
  controls.image.accept = WALLPAPER_MIME_TYPES.join(",");
  controls.colorQuality.innerHTML = `<option>${screen.colorDepth > 24 ? "Highest (32 bit)" : "High (24 bit)"}</option>`;
  const syncScreenSaverPreview = () =>
    renderScreenSaver(
      controls.saverPreview,
      pending.screenSaver,
      !content.querySelector("#display-panel-saver").hidden,
    );
  const themes = {
    "windows-xp": {
      appearance: "blue",
      wallpaper: "bliss",
      backgroundColor: "#004e98",
    },
    classic: {
      appearance: "classic",
      wallpaper: "none",
      backgroundColor: "#3a6ea5",
    },
    olive: {
      appearance: "olive",
      wallpaper: "autumn",
      backgroundColor: "#586b2f",
    },
  };
  const selectedWallpaper = () =>
    pending.customWallpaper ? "custom" : pending.wallpaper;
  const sync = () => {
    controls.theme.value = pending.theme;
    controls.wallpaper.value = pending.wallpaper;
    controls.customWallpaper.hidden = !pending.customWallpaper;
    controls.customWallpaper.querySelector(
      ".display-custom-wallpaper-name",
    ).textContent = pending.customWallpaperName;
    content.querySelectorAll("[data-wallpaper]").forEach((item) => {
      const selected = item.dataset.wallpaper === selectedWallpaper();
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    controls.position.value = pending.position;
    controls.color.value = pending.backgroundColor;
    controls.saver.value = pending.screenSaver;
    controls.saverSettings.disabled = pending.screenSaver === "none";
    controls.saverPreviewButton.disabled = pending.screenSaver === "none";
    controls.saverWait.value = String(pending.screenSaverWait);
    controls.saverLogin.checked = pending.requireLoginOnResume;
    // Windows Classic style offers only its own color scheme.
    const classic = pending.appearance === "classic";
    controls.windowStyle.value = classic ? "classic" : "xp";
    [...controls.appearance.options].forEach((option) => {
      option.hidden = (option.value === "classic") !== classic;
    });
    controls.appearance.value = pending.appearance;
    controls.fontSize.value = pending.fontSize;
    controls.resolution.value = pending.resolution;
    controls.resolutionSlider.value = String(
      pending.resolution === "auto"
        ? 1
        : ["800x600", "1024x768", "1440x900"].indexOf(pending.resolution),
    );
    controls.preview.style.backgroundColor = pending.backgroundColor;
    controls.preview.style.backgroundImage = displayBackground(pending);
    controls.preview.dataset.position = pending.position;
    content.querySelector(".display-color-button span").style.backgroundColor =
      pending.backgroundColor;
    controls.saverPreview.dataset.saver = pending.screenSaver;
    syncScreenSaverPreview();
    controls.appearancePreview.dataset.schemePreview = pending.appearance;
    controls.themeSample.dataset.schemePreview = pending.appearance;
    controls.themeSample.style.backgroundColor = pending.backgroundColor;
    controls.themeSample.style.backgroundImage = displayBackground(pending);
    const monitor = getSimulatedMonitorSize(pending.resolution);
    controls.resolutionValue.textContent =
      pending.resolution === "auto"
        ? `${getViewportWidth()} by ${getViewportHeight()} pixels`
        : `${pending.resolution.replace("x", " by ")} pixels${monitor.limited ? ` (limited to ${monitor.width} by ${monitor.height})` : ""}`;
    controls.apply.disabled =
      JSON.stringify(pending) === JSON.stringify(current);
  };
  const showTab = (tab) => {
    const panelId = tab.getAttribute("aria-controls");
    tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      const active = panel.id === panelId;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    syncScreenSaverPreview();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => showTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const target =
        event.key === "Home"
          ? tabs[0]
          : event.key === "End"
            ? tabs.at(-1)
            : tabs[
                (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                  tabs.length
              ];
      showTab(target);
      target.focus();
    });
  });
  controls.theme.addEventListener("change", () => {
    pending = {
      ...pending,
      theme: controls.theme.value,
      customWallpaper: "",
      customWallpaperName: "",
      ...themes[controls.theme.value],
    };
    sync();
  });
  controls.wallpaper.addEventListener("change", () => {
    pending = {
      ...pending,
      wallpaper: controls.wallpaper.value,
      customWallpaper: "",
      customWallpaperName: "",
    };
    sync();
  });
  const wallpaperList = content.querySelector(".display-wallpaper-list");
  const wallpaperItems = () => [
    ...wallpaperList.querySelectorAll("[data-wallpaper]:not([hidden])"),
  ];
  const selectWallpaper = (item, { focus = false } = {}) => {
    if (item !== controls.customWallpaper)
      pending = {
        ...pending,
        wallpaper: item.dataset.wallpaper,
        customWallpaper: "",
        customWallpaperName: "",
      };
    sync();
    item.scrollIntoView({ block: "nearest" });
    if (focus) item.focus();
  };
  wallpaperList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-wallpaper]");
    if (!item) return;
    selectWallpaper(item);
  });
  wallpaperList.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = wallpaperItems();
    const selectedIndex = items.findIndex(
      (item) => item.dataset.wallpaper === selectedWallpaper(),
    );
    const targetIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : Math.max(
              0,
              Math.min(
                items.length - 1,
                selectedIndex + (event.key === "ArrowDown" ? 1 : -1),
              ),
            );
    selectWallpaper(items[targetIndex], { focus: true });
  });
  controls.windowStyle.addEventListener("change", () => {
    pending = {
      ...pending,
      appearance: controls.windowStyle.value === "classic" ? "classic" : "blue",
    };
    sync();
  });
  ["position", "appearance", "saver"].forEach((name) => {
    controls[name].addEventListener("change", () => {
      pending = {
        ...pending,
        [name === "saver" ? "screenSaver" : name]: controls[name].value,
      };
      sync();
    });
  });
  const setPendingResolution = (resolution) => {
    pending = { ...pending, resolution };
    if (pending.resolution === current.resolution) {
      applySimulatedMonitor(current.resolution, { reflow: false });
      restoreWindowState(resolutionPreviewSnapshot);
      resolutionPreviewSnapshot = null;
      resolutionPreviewActive = false;
    } else {
      resolutionPreviewSnapshot ||= snapshotWindowState();
      resolutionPreviewActive = true;
      applySimulatedMonitor(pending.resolution);
    }
    sync();
  };
  controls.resolution.addEventListener("change", () => {
    setPendingResolution(controls.resolution.value);
  });
  controls.resolutionSlider.addEventListener("input", () => {
    setPendingResolution(
      ["800x600", "1024x768", "1440x900", "auto"][
        Number(controls.resolutionSlider.value)
      ],
    );
  });
  controls.color.addEventListener("input", () => {
    pending = { ...pending, backgroundColor: controls.color.value };
    sync();
  });
  content
    .querySelector(".display-saver-spin")
    .addEventListener("click", (event) => {
      const step = event.target.closest("[data-step]");
      if (!step) return;
      controls.saverWait.value = String(
        pending.screenSaverWait + Number(step.dataset.step),
      );
      controls.saverWait.dispatchEvent(new Event("change"));
    });
  controls.saverWait.addEventListener("change", () => {
    const wait = Math.min(
      60,
      Math.max(1, Number.parseInt(controls.saverWait.value, 10) || 1),
    );
    pending = { ...pending, screenSaverWait: wait };
    sync();
  });
  controls.saverLogin.addEventListener("change", () => {
    pending = {
      ...pending,
      requireLoginOnResume: controls.saverLogin.checked,
    };
    sync();
  });
  controls.fontSize.addEventListener("change", () => {
    pending = { ...pending, fontSize: controls.fontSize.value };
    sync();
  });
  let wallpaperBrowseDialog = null;
  controls.browse.addEventListener("click", () => {
    wallpaperBrowseDialog = openWallpaperBrowseDialog(win, controls.image);
  });
  controls.image.addEventListener("change", () => {
    const [file] = controls.image.files;
    if (!file) return;
    if (!WALLPAPER_MIME_TYPES.includes(file.type)) {
      controls.image.value = "";
      openDisplayNotice(
        win,
        "Display Properties",
        `${file.name} is not a picture that can be used as a background. Choose a PNG, JPEG, GIF, or WebP file.`,
        "error",
      );
      return;
    }
    const reader = new FileReader();
    // The type check above guarantees an image data URL.
    reader.addEventListener("load", () => {
      pending = {
        ...pending,
        customWallpaper: reader.result,
        customWallpaperName: file.name.replace(/\.[^.]+$/, ""),
      };
      sync();
      controls.customWallpaper.scrollIntoView({ block: "nearest" });
      wallpaperBrowseDialog?.setChosenFile(file.name);
      wallpaperBrowseDialog = null;
    });
    reader.readAsDataURL(file);
  });
  controls.customize.addEventListener("click", () => {
    openDesktopItemsDialog(win);
  });
  content.querySelector(".display-effects").addEventListener("click", () => {
    openDisplayEffectsDialog(win, pending, (next) => {
      pending = next;
      sync();
    });
  });
  content
    .querySelector(".display-advanced-appearance")
    .addEventListener("click", () => {
      openAdvancedAppearanceDialog(win, pending, (next) => {
        pending = next;
        sync();
      });
    });

  controls.saverSettings.addEventListener("click", () =>
    openDisplayNotice(
      win,
      "Screen Saver Settings",
      "This screen saver has no options that you can set.",
    ),
  );

  content
    .querySelector(".display-saver-preview-button")
    .addEventListener("click", () => {
      // sync() disables Preview while (None) is selected.
      const saver = document.getElementById("screen-saver-overlay");
      showScreenSaver(saver, pending.screenSaver);
      const closePreview = () => {
        hideScreenSaver(saver);
      };
      screenSaverPreviewCleanup = () => {
        document.removeEventListener("keydown", closePreview);
        saver.removeEventListener("pointerdown", closePreview);
      };
      document.addEventListener("keydown", closePreview, { once: true });
      saver.addEventListener("pointerdown", closePreview, { once: true });
    });
  content
    .querySelector('[data-display-action="apply"]')
    .addEventListener("click", () => {
      // Every control only produces valid settings, so pending needs no
      // re-validation here.
      if (!saveDisplaySettings(pending)) {
        openDisplayNotice(
          win,
          "Display Properties",
          "Windows could not save this picture. Try a smaller image.",
          "error",
        );
        return;
      }
      current = { ...pending };
      applyDisplaySettings(current);
      resolutionPreviewActive = false;
      resolutionPreviewSnapshot = null;
      sync();
    });
  content
    .querySelector('[data-display-action="ok"]')
    .addEventListener("click", () => {
      if (!controls.apply.disabled) controls.apply.click();
      if (controls.apply.disabled) closeGameWindow(win.gameId);
    });
  const rollbackResolutionPreview = () => {
    if (resolutionPreviewActive) {
      applySimulatedMonitor(current.resolution, { reflow: false });
      restoreWindowState(resolutionPreviewSnapshot);
    }
    resolutionPreviewActive = false;
    resolutionPreviewSnapshot = null;
  };
  win.beforeClose = () => {
    rollbackResolutionPreview();
    renderScreenSaver(controls.saverPreview, pending.screenSaver, false);
  };
  content
    .querySelector('[data-display-action="cancel"]')
    .addEventListener("click", () => closeGameWindow(win.gameId));
  sync();
};
